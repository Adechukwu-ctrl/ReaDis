import { pdfjs } from 'react-pdf';

// Configure PDF.js worker with a stable CDN version
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

export default pdfjs;