
import React, { useState, useEffect, useRef } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import io from 'socket.io-client';
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;
const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:3001';
function App() {
  const [pdfFile, setPdfFile] = useState(null);
  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [selectedText, setSelectedText] = useState('');
  const [chunks, setChunks] = useState([]);
  const [playingIndex, setPlayingIndex] = useState(-1);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [voiceId, setVoiceId] = useState('Joanna');
  const [socketId, setSocketId] = useState(null);
  const audioRef = useRef(null);
  const socketRef = useRef(null);
  const [progressMsgs, setProgressMsgs] = useState([]);
  const [chunkAudioMap, setChunkAudioMap] = useState(() => {
    try { return JSON.parse(localStorage.getItem('chunkAudioMap') || '{}'); } catch(e){ return {}; }
  });

  useEffect(() => {
    socketRef.current = io(API_BASE);
    socketRef.current.on('connect', () => { setSocketId(socketRef.current.id); socketRef.current.emit('join'); });
    socketRef.current.on('extract:progress', (m) => setProgressMsgs(p => [...p, JSON.stringify(m)]));
    socketRef.current.on('extract:done', (m) => setProgressMsgs(p => [...p, 'DONE: ' + JSON.stringify(m)]));
    return () => socketRef.current.disconnect();
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  function onDocumentLoadSuccess({ numPages }) { setNumPages(numPages); setPageNumber(1); }

  function prevPage() { setPageNumber(p => Math.max(1, p-1)); }
  function nextPage() { setPageNumber(p => Math.min(numPages, p+1)); }

  async function uploadPdf(file) {
    const fd = new FormData(); fd.append('file', file);
    const token = localStorage.getItem('authToken') || '';
    const res = await fetch(`${API_BASE}/extract/upload?socketId=${socketId}`, { method: 'POST', body: fd, headers: token ? { 'Authorization': 'Bearer ' + token } : {} });
    const data = await res.json();
    if (data && data.text) setSelectedText(data.text);
    else if (data.queued) alert('OCR job queued. Use socket progress to monitor.');
    else alert('Extraction returned no text');
  }

  async function createChunks() {
    const res = await fetch(`${API_BASE}/tts/chunk`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ text: selectedText, maxChars: 3000 }) });
    const data = await res.json();
    setChunks(data.chunks || []);
    setPlayingIndex(-1);
  }

  async function playChunk(i) {
    if (!chunks[i]) return;
    setPlayingIndex(i);
    // if we have cached audio url for this chunk, use it
    const key = chunks[i].text.slice(0,80);
    if (chunkAudioMap[key]) {
      const url = chunkAudioMap[key];
      audioRef.current.src = url;
      audioRef.current.play();
      return;
    }
    // request polly
    const token = localStorage.getItem('authToken') || '';
    const res = await fetch(`${API_BASE}/tts/polly`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token?{Authorization:'Bearer '+token}:{}) },
      body: JSON.stringify({ text: chunks[i].text, voiceId, format: 'mp3' })
    });
    const data = await res.json();
    const url = data.url.startsWith('http') ? data.url : (API_BASE + data.url);
    // cache mapping locally for faster replay
    const m = { ...chunkAudioMap, [key]: url };
    setChunkAudioMap(m);
    localStorage.setItem('chunkAudioMap', JSON.stringify(m));
    audioRef.current.src = url;
    audioRef.current.play();
  }

  function onAudioEnded() {
    const next = playingIndex + 1;
    if (next < chunks.length) playChunk(next);
    else setPlayingIndex(-1);
  }

  function handleSelection() {
    const sel = window.getSelection().toString();
    if (sel && sel.length > 0) setSelectedText(sel);
  }

  // helper to render textarea with highlighted current chunk
  function renderHighlightedText() {
    if (!chunks.length || playingIndex === -1) return <pre style={{whiteSpace:'pre-wrap'}}>{selectedText}</pre>;
    const before = chunks.slice(0, playingIndex).map(c=>c.text).join(' ');
    const current = chunks[playingIndex].text;
    const after = chunks.slice(playingIndex+1).map(c=>c.text).join(' ');
    return (<div style={{whiteSpace:'pre-wrap'}}>
      <span>{before}</span>
      <mark style={{background:'#ffd'}}> {current} </mark>
      <span>{after}</span>
    </div>);
  }

  return (
    <div style={{ padding: 20 }}>
      <h2>Content Extraction - Demo Frontend (v2)</h2>
      <div>
        <h3>PDF Viewer</h3>
        <input type="file" accept="application/pdf" onChange={(e)=>{ setPdfFile(e.target.files[0]); uploadPdf(e.target.files[0]); }} />
        {pdfFile && (
          <div>
            <Document file={pdfFile} onLoadSuccess={onDocumentLoadSuccess}>
              <Page pageNumber={pageNumber} width={600} onMouseUp={handleSelection} />
            </Document>
            <div style={{ marginTop: 10 }}>
              <button onClick={prevPage}>Prev</button>
              <span> Page {pageNumber} / {numPages}</span>
              <button onClick={nextPage}>Next</button>
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 20 }}>
        <h3>Selected / Extracted Text</h3>
        <textarea value={selectedText} onChange={(e)=>setSelectedText(e.target.value)} rows={6} cols={80} />
        <div><button onClick={createChunks}>Create Chunks</button></div>
      </div>

      <div style={{ marginTop: 20 }}>
        <h3>Playback Controls</h3>
        <label>Voice: <input value={voiceId} onChange={(e)=>setVoiceId(e.target.value)} /></label>
        <label style={{marginLeft:10}}>Rate: <input type="range" min="0.5" max="2.0" step="0.1" value={playbackRate} onChange={(e)=>setPlaybackRate(parseFloat(e.target.value))} /></label>
      </div>

      <div style={{ marginTop: 20 }}>
        <h3>Chunks</h3>
        <ol>
          {chunks.map((c, idx) => (
            <li key={idx} style={{ background: idx===playingIndex? '#eef' : 'transparent', padding:8, marginBottom:6 }}>
              <div><strong>{c.words} words — est {c.estimatedSeconds}s</strong></div>
              <div>{c.text.slice(0,200)}{c.text.length>200?'...':''}</div>
              <button onClick={()=>playChunk(idx)}>Play</button>
            </li>
          ))}
        </ol>
      </div>

      <div style={{ marginTop: 20 }}>
        <audio ref={audioRef} controls onEnded={onAudioEnded} />
      </div>

      <div style={{ marginTop: 20 }}>
        <h3>Highlighted Reading</h3>
        {renderHighlightedText()}
      </div>

      <div style={{ marginTop: 20 }}>
        <h3>Socket Progress</h3>
        <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid #ccc', padding: 8 }}>
          {progressMsgs.map((m,i)=><div key={i}><code>{m}</code></div>)}
        </div>
      </div>
    </div>
  );
}
export default App;
