import * as pdfjsDist from 'pdfjs-dist';

// Create a local module worker to avoid CDN ORB/CORB blocking
const workerUrl = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url);
const worker = new Worker(workerUrl, { type: 'module' });

// Configure pdfjs-dist to use the same worker port
(pdfjsDist as any).GlobalWorkerOptions.workerPort = worker;

// Do NOT set workerSrc when using module workers; leave it undefined
// This prevents the library from attempting legacy script worker fallback

// Debug: log API and worker configuration to verify alignment
if (typeof window !== 'undefined') {
  console.log('[PDFJS] pdfjs-dist version:', (pdfjsDist as any).version);
  console.log('[PDFJS] worker configured via workerPort:', Boolean((pdfjsDist as any).GlobalWorkerOptions.workerPort));
}

export default pdfjsDist;