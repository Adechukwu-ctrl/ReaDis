
/**
 * Backend v2 - added SSRF protection, Auth (JWT), Rate limiting, Bull worker for OCR,
 * AWS Polly with google-tts fallback, and socket.io progress channels.
 *
 * ENV:
 * - PORT (3001)
 * - API_USER and API_PASS for login (simple)
 * - JWT_SECRET
 * - AWS_* for Polly (optional)
 * - REDIS_URL (optional)
 * - ALLOWED_HOSTS (comma-separated) optional whitelist for URL fetching
 */

const express = require('express');
const http = require('http');
const fetch = require('node-fetch');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const Tesseract = require('tesseract.js');
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const he = require('he');
const cors = require('cors');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const AWS = require('aws-sdk');
const LRU = require('lru-cache');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const dns = require('dns').promises;
const Bull = require('bull');
const Redis = require('ioredis');
const googleTTS = require('google-tts-api');
const validator = require('validator');

const app = express();
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, { cors: { origin: '*' } });
const upload = multer({ dest: 'uploads/' });

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(helmet());

/** Rate limiting */
const limiter = rateLimit({ windowMs: 60 * 1000, max: 60 }); // 60 requests per minute
app.use(limiter);

/** Simple auth middleware using JWT */
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
function authRequired(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/** Login - exchange static API_USER/API_PASS for JWT (simple for demo) */
app.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  const USER = process.env.API_USER || 'admin';
  const PASS = process.env.API_PASS || 'password';
  if (username === USER && password === PASS) {
    const token = jwt.sign({ sub: username }, JWT_SECRET, { expiresIn: '12h' });
    return res.json({ token });
  }
  return res.status(401).json({ error: 'invalid credentials' });
});

/** Setup TTS: AWS Polly if creds present, else google-tts fallback */
const pollyAvailable = !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
let polly = null;
if (pollyAvailable) {
  polly = new AWS.Polly({ apiVersion: '2016-06-10', region: process.env.AWS_REGION || 'us-east-1' });
}

/** Cache setup */
const audioCacheDir = process.env.CACHE_DIR || path.join(__dirname, 'tts_cache');
if (!fs.existsSync(audioCacheDir)) fs.mkdirSync(audioCacheDir, { recursive: true });
const audioLRU = new LRU({ max: 1000 });

/** Redis / Bull setup */
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
let redisClient = null;
let ocrQueue = null;
try {
  redisClient = new Redis(REDIS_URL);
  ocrQueue = new Bull('ocrQueue', REDIS_URL, { redis: REDIS_URL });
} catch (e) {
  console.warn('Redis/Bull not available, falling back to inline processing for OCR jobs.');
}

/** Swagger */
const swaggerDefinition = { openapi: '3.0.0', info: { title: 'Content Extraction API v2', version: '1.2.0' }, servers: [{ url: 'http://localhost:3001' }] };
const options = { swaggerDefinition, apis: ['./index.js'] };
const swaggerSpec = swaggerJsdoc(options);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

/** Utilities */
function removeFileSafe(p) { fs.unlink(p, (e)=>{}); }
async function isPrivateIp(hostname) {
  try {
    const res = await dns.lookup(hostname, { all: true });
    for (const r of res) {
      const ip = r.address;
      // rudimentary private IP check
      if (/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])|127\.|169\.254\.)/.test(ip)) return true;
      if (ip === '::1' || ip.startsWith('fc') || ip.startsWith('fe80')) return true;
    }
    return false;
  } catch (e) {
    return true; // be safe: treat lookup failure as potentially unsafe
  }
}

/** SSRF-safe fetch helper */
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || '').split(',').map(s=>s.trim()).filter(Boolean);
async function safeFetchUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') throw new Error('invalid url');
  if (!validator.isURL(rawUrl, { require_protocol: true })) throw new Error('invalid url format');
  const u = new URL(rawUrl);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('only http/https allowed');
  if (ALLOWED_HOSTS.length > 0 && !ALLOWED_HOSTS.includes(u.hostname)) throw new Error('hostname not allowed');
  // prevent local/private IPs
  const host = u.hostname;
  const private = await isPrivateIp(host);
  if (private) throw new Error('hostname resolves to private/local IP - blocked');
  // finally fetch
  const resp = await fetch(rawUrl, { timeout: 15000 });
  if (!resp.ok) throw new Error('fetch failed: ' + resp.status);
  return resp;
}

async function extractFromUrl(url) {
  const resp = await safeFetchUrl(url);
  const html = await resp.text();
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  if (article && article.textContent) return he.decode(article.textContent);
  return dom.window.document.body ? dom.window.document.body.textContent : '';
}

/** Socket helper */
function emitProgress(socketId, event, payload) {
  if (!socketId) return;
  io.to(socketId).emit(event, payload);
}

/** Routes **/

/** Protected example: extract/url requires auth */
app.post('/extract/url', authRequired, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url is required' });
    const text = await extractFromUrl(url);
    res.json({ source: 'url', text });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Plain text - public */
app.post('/extract/text', (req, res) => {
  const raw = req.body.text || req.body;
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  res.json({ source: 'text', text });
});

/**
 * Upload: if image OCR and Redis/Bull available, enqueue job and return job id.
 * Accept socketId query param to emit progress.
 */
app.post('/extract/upload', authRequired, upload.single('file'), async (req, res) => {
  const socketId = req.query.socketId;
  if (!req.file) return res.status(400).json({ error: 'file required' });
  const { path: fpath, originalname, mimetype } = req.file;
  const ext = path.extname(originalname).toLowerCase();

  try {
    if (ext === '.pdf') {
      emitProgress(socketId, 'extract:progress', { stage: 'reading', msg: 'Reading PDF' });
      const data = fs.readFileSync(fpath);
      emitProgress(socketId, 'extract:progress', { stage: 'parsing', msg: 'Parsing PDF' });
      const pdf = await pdfParse(data);
      emitProgress(socketId, 'extract:done', { source: 'pdf' });
      res.json({ source: 'pdf', text: pdf.text, info: pdf.info });
      removeFileSafe(fpath);
      return;
    }

    if (ext === '.docx') {
      const result = await mammoth.extractRawText({ path: fpath });
      res.json({ source: 'docx', text: result.value });
      removeFileSafe(fpath);
      return;
    }

    if (ext === '.xlsx' || ext === '.xls' || mimetype === 'application/vnd.ms-excel') {
      const wb = XLSX.readFile(fpath);
      const sheets = {};
      wb.SheetNames.forEach(name => {
        const ws = wb.Sheets[name];
        const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
        sheets[name] = json;
      });
      res.json({ source: 'spreadsheet', sheets });
      removeFileSafe(fpath);
      return;
    }

    if (mimetype.startsWith('image/') || ['.png','.jpg','.jpeg','.bmp','.tiff','.webp'].includes(ext)) {
      if (ocrQueue) {
        // enqueue job
        const job = await ocrQueue.add({ filePath: fpath, socketId }, { removeOnComplete: true, attempts: 3 });
        return res.json({ queued: true, jobId: job.id });
      } else {
        // inline processing
        await Tesseract.recognize(fpath, 'eng', {
          logger: m => emitProgress(socketId, 'extract:progress', { stage: 'ocr', ...m })
        }).then(({ data: { text } }) => {
          emitProgress(socketId, 'extract:done', { source: 'image' });
          res.json({ source: 'image', text });
        }).catch(err => {
          res.status(500).json({ error: 'ocr failed', details: err.message });
        }).finally(() => removeFileSafe(fpath));
        return;
      }
    }

    res.status(400).json({ error: 'unsupported file type', ext, mimetype });
    removeFileSafe(fpath);
  } catch (err) {
    removeFileSafe(fpath);
    res.status(500).json({ error: err.message });
  }
});

/** TTS chunking (no auth required) */
app.post('/tts/chunk', (req, res) => {
  try {
    const { text = '', maxChars = 4000, wpm = 150 } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'text required' });
    const sentences = text.replace(/\r\n/g, ' ').replace(/\n/g, ' ').match(/[^\.!\?]+[\.!\?]*\s*/g) || [text];
    const chunks = [];
    let current = '';
    for (const s of sentences) {
      if ((current + s).length <= maxChars) current += s;
      else {
        if (current) chunks.push(current.trim());
        if (s.length > maxChars) {
          for (let i = 0; i < s.length; i += maxChars) chunks.push(s.slice(i, i + maxChars).trim());
          current = '';
        } else current = s;
      }
    }
    if (current) chunks.push(current.trim());
    const chunkMeta = chunks.map((c, idx) => {
      const words = c.split(/\s+/).filter(Boolean).length;
      const seconds = Math.max(1, Math.round((words / wpm) * 60));
      return { index: idx, text: c, words, estimatedSeconds: seconds };
    });
    const totalSeconds = chunkMeta.reduce((s, c) => s + c.estimatedSeconds, 0);
    res.json({ chunks: chunkMeta, totalSeconds });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * TTS: prefer AWS Polly; if not available, fall back to google-tts-api (returns external URL).
 * Caches on disk; returns { url, cached }
 */
app.post('/tts/polly', async (req, res) => {
  try {
    const { text = '', voiceId = 'Joanna', format = 'mp3', rate=1.0 } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });
    const crypto = require('crypto');
    const key = voiceId + '|' + format + '|' + rate + '|' + text;
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    const filename = `${hash}.${format}`;
    const filepath = path.join(audioCacheDir, filename);
    if (fs.existsSync(filepath)) return res.json({ cached: true, url: `/tts/audio/${filename}` });

    if (polly) {
      const params = { OutputFormat: format.toUpperCase(), Text: text, VoiceId: voiceId };
      polly.synthesizeSpeech(params, (err, data) => {
        if (err) return res.status(500).json({ error: 'polly error', details: err.message });
        if (data && data.AudioStream) {
          fs.writeFileSync(filepath, data.AudioStream);
          return res.json({ cached: false, url: `/tts/audio/${filename}` });
        } else return res.status(500).json({ error: 'no audio from polly' });
      });
    } else {
      // google tts fallback (returns external url)
      const url = googleTTS.getAudioUrl(text, { lang: 'en', slow: false, host: 'https://translate.google.com' });
      // we can also download and cache it, but for demo return external url
      return res.json({ cached: false, url });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Serve cached audio files */
app.get('/tts/audio/:file', (req, res) => {
  const file = path.join(audioCacheDir, path.basename(req.params.file));
  if (!fs.existsSync(file)) return res.status(404).send('not found');
  res.sendFile(file);
});

/** Health */
app.get('/', (req, res) => res.send('Content Extraction Backend v2 running'));

/** Socket.io */
io.on('connection', (socket) => {
  console.log('socket connected', socket.id);
  socket.on('join', () => socket.join(socket.id));
  socket.on('disconnect', () => console.log('socket disconnected', socket.id));
});

/** Bull worker processor (if ocrQueue initialized) */
if (ocrQueue) {
  ocrQueue.process(async (job) => {
    const { filePath, socketId } = job.data;
    // basic progress emits
    io.to(socketId).emit('extract:progress', { stage: 'ocr', status: 'started' });
    try {
      const result = await Tesseract.recognize(filePath, 'eng', {
        logger: m => io.to(socketId).emit('extract:progress', { stage: 'ocr', ...m })
      });
      io.to(socketId).emit('extract:done', { source: 'image', jobId: job.id });
      // store result temporarily on disk or redis; for demo we'll write to /uploads/job-<id>.txt
      const outPath = path.join(__dirname, 'uploads', `job-${job.id}.txt`);
      fs.writeFileSync(outPath, result.data.text, 'utf8');
      // return location
      return { textPath: outPath };
    } catch (e) {
      io.to(socketId).emit('extract:error', { jobId: job.id, message: e.message });
      throw e;
    } finally {
      removeFileSafe(filePath);
    }
  });
}

/** Start server */
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Backend v2 listening on ${PORT}`));
