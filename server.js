import express from 'express';
import path from 'path';
import compression from 'compression';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const distPath = path.join(__dirname, 'dist');

// Enable gzip compression for responses
app.use(compression());

// Serve static assets from dist
app.use(express.static(distPath, { index: false, maxAge: '1y', immutable: true }));

// SPA fallback: serve index.html for all non-asset routes
app.use((req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Production server running at http://localhost:${PORT}/`);
});
