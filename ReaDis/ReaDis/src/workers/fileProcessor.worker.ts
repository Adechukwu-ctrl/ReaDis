// Web Worker for processing large files in the background
// This prevents UI blocking during intensive file operations

import * as pdfjs from 'pdfjs-dist';

// Configure PDF.js worker for the Web Worker context using local module worker
if (typeof self !== 'undefined') {
  try {
    const workerUrl = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url);
    const worker = new Worker(workerUrl, { type: 'module' });
    (pdfjs as any).GlobalWorkerOptions.workerPort = worker;
    // Do not set workerSrc when using module workers
  } catch (e) {
    // Fallback: keep default config; pdfjs will try fake worker if needed
    console.warn('Failed to configure pdfjs workerPort in fileProcessor.worker:', e);
  }
}

export interface WorkerMessage {
  type: 'PROCESS_PDF' | 'PROCESS_TEXT' | 'EXTRACT_IMAGES';
  payload: {
    fileData: ArrayBuffer;
    fileName: string;
    fileSize: number;
    options?: {
      chunkSize?: number;
      maxPages?: number;
      extractImages?: boolean;
    };
  };
  id: string;
}

export interface WorkerResponse {
  type: 'PROGRESS' | 'SUCCESS' | 'ERROR' | 'CHUNK_PROCESSED';
  payload: unknown;
  id: string;
}

// Process PDF files in chunks
async function processPdfInWorker(
  fileData: ArrayBuffer,
  fileName: string,
  options: { chunkSize?: number; maxPages?: number; extractImages?: boolean } = {},
  messageId: string
): Promise<void> {
  try {
    const { chunkSize = 5, maxPages = 1000, extractImages = false } = options;
    
    // Send initial progress
    self.postMessage({
      type: 'PROGRESS',
      payload: { progress: 0, message: 'Loading PDF document...' },
      id: messageId
    } as WorkerResponse);

    // Load PDF document
    const loadingTask = (pdfjs as any).getDocument({ data: fileData, disableAutoFetch: true });
    const pdf = await loadingTask.promise;
    
    const totalPages = Math.min(pdf.numPages, maxPages);
    const contentChunks: string[] = [];
    const images: string[] = [];
    
    self.postMessage({
      type: 'PROGRESS',
      payload: { progress: 10, message: `Processing ${totalPages} pages...` },
      id: messageId
    } as WorkerResponse);

    // Process pages in chunks
    for (let startPage = 1; startPage <= totalPages; startPage += chunkSize) {
      const endPage = Math.min(startPage + chunkSize - 1, totalPages);

      // Process pages in the current chunk concurrently
      const pagePromises: Promise<string>[] = [];
      for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
        pagePromises.push((async () => {
          try {
            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();
            
            // Extract text
            const pageText = textContent.items
              .map((item: { str: string }) => item.str)
              .join(' ')
              .trim();
            
            // Optional: extract first image per page
            if (extractImages && typeof OffscreenCanvas !== 'undefined') {
              const viewport = page.getViewport({ scale: 1.0 });
              const canvas = new OffscreenCanvas(viewport.width, viewport.height);
              const ctx = canvas.getContext('2d');
              if (ctx) {
                await page.render({ canvasContext: ctx as any, viewport }).promise;
                const blob = await canvas.convertToBlob({ type: 'image/png' });
                const url = URL.createObjectURL(blob);
                images.push(url);
              }
            }

            return `\n\n--- Page ${pageNum} ---\n${pageText}`;
          } catch (pageError) {
            console.warn(`Error processing page ${pageNum}:`, pageError);
            return `\n\n--- Page ${pageNum} (Error) ---\n[Content could not be extracted]`;
          }
        })());
      }

      const chunkResults = await Promise.all(pagePromises);
      const chunkContent = chunkResults.join('');
      contentChunks.push(chunkContent);
      
      // Send chunk processed update
      self.postMessage({
        type: 'CHUNK_PROCESSED',
        payload: { startPage, endPage, content: chunkContent },
        id: messageId
      } as WorkerResponse);

      // Update progress
      const progress = Math.round((endPage / totalPages) * 80) + 10;
      self.postMessage({
        type: 'PROGRESS',
        payload: { progress, message: `Processed pages ${startPage}-${endPage}` },
        id: messageId
      } as WorkerResponse);
    }

    // Final success message
    const extractedContent = contentChunks.join('');
    self.postMessage({
      type: 'SUCCESS',
      payload: { content: extractedContent, totalPages, images, fileName },
      id: messageId
    } as WorkerResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    self.postMessage({
      type: 'ERROR',
      payload: `Chunked processing failed: ${message}`,
      id: messageId
    } as WorkerResponse);
  }
}

async function processTextInWorker(
  fileData: ArrayBuffer,
  fileName: string,
  messageId: string
): Promise<void> {
  try {
    const decoder = new TextDecoder('utf-8');
    const content = decoder.decode(fileData);

    self.postMessage({
      type: 'SUCCESS',
      payload: { content, fileName },
      id: messageId
    } as WorkerResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    self.postMessage({
      type: 'ERROR',
      payload: `Text processing failed: ${message}`,
      id: messageId
    } as WorkerResponse);
  }
}

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { type, payload, id } = event.data;

  try {
    if (type === 'PROCESS_PDF') {
      await processPdfInWorker(payload.fileData, payload.fileName, payload.options || {}, id);
    } else if (type === 'PROCESS_TEXT') {
      await processTextInWorker(payload.fileData, payload.fileName, id);
    } else {
      self.postMessage({ type: 'ERROR', payload: 'Unknown worker task', id } as WorkerResponse);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    self.postMessage({ type: 'ERROR', payload: message, id } as WorkerResponse);
  }
};

self.onerror = (error) => {
  self.postMessage({ type: 'ERROR', payload: `Worker runtime error: ${error.message}`, id: 'runtime' } as WorkerResponse);
};

export {};