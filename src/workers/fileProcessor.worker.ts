// Web Worker for processing large files in the background
// This prevents UI blocking during intensive file operations

import { pdfjs } from 'react-pdf';

// Configure PDF.js worker for the Web Worker context
if (typeof window === 'undefined') {
  // We're in a Web Worker context - use CDN worker matching pdfjs-dist version 5.4.149
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('react-pdf/node_modules/pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
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
    const loadingTask = pdfjs.getDocument({ data: fileData });
    const pdf = await loadingTask.promise;
    
    const totalPages = Math.min(pdf.numPages, maxPages);
    let extractedContent = '';
    const images: string[] = [];
    
    self.postMessage({
      type: 'PROGRESS',
      payload: { progress: 10, message: `Processing ${totalPages} pages...` },
      id: messageId
    } as WorkerResponse);

    // Process pages in chunks
    for (let startPage = 1; startPage <= totalPages; startPage += chunkSize) {
      const endPage = Math.min(startPage + chunkSize - 1, totalPages);
      let chunkContent = '';
      
      // Process each page in the current chunk
      for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
        try {
          const page = await pdf.getPage(pageNum);
          const textContent = await page.getTextContent();
          
          // Extract text
          const pageText = textContent.items
            .map((item: { str: string }) => item.str)
            .join(' ')
            .trim();
          
          if (pageText) {
            chunkContent += `\n\n--- Page ${pageNum} ---\n${pageText}`;
          }
          
          // Extract images if requested
          if (extractImages) {
            try {
              const operatorList = await page.getOperatorList();
              // Process operator list for images (simplified)
              // This is a basic implementation - could be enhanced
              for (let i = 0; i < operatorList.fnArray.length; i++) {
                if (operatorList.fnArray[i] === pdfjs.OPS.paintImageXObject) {
                  // Image found - in a real implementation, you'd extract the actual image data
                  images.push(`Image found on page ${pageNum}`);
                }
              }
            } catch (imageError) {
              console.warn(`Could not extract images from page ${pageNum}:`, imageError);
            }
          }
          
        } catch (pageError) {
          console.warn(`Error processing page ${pageNum}:`, pageError);
          chunkContent += `\n\n--- Page ${pageNum} (Error) ---\nCould not extract content from this page.`;
        }
      }
      
      extractedContent += chunkContent;
      
      // Send chunk processed update
      self.postMessage({
        type: 'CHUNK_PROCESSED',
        payload: {
          chunkIndex: Math.floor((startPage - 1) / chunkSize),
          pagesProcessed: endPage,
          totalPages,
          chunkContent: chunkContent.substring(0, 500) + (chunkContent.length > 500 ? '...' : '')
        },
        id: messageId
      } as WorkerResponse);
      
      // Send progress update
      const progress = Math.min(90, (endPage / totalPages) * 80 + 10);
      self.postMessage({
        type: 'PROGRESS',
        payload: {
          progress,
          message: `Processed pages ${startPage}-${endPage} of ${totalPages}`
        },
        id: messageId
      } as WorkerResponse);
      
      // Allow other operations to run
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    // Clean up
    await pdf.destroy();
    
    // Send final result
    self.postMessage({
      type: 'SUCCESS',
      payload: {
        content: extractedContent.trim(),
        totalPages,
        images: extractImages ? images : undefined,
        processingTime: Date.now(),
        fileName
      },
      id: messageId
    } as WorkerResponse);
    
  } catch (error) {
    self.postMessage({
      type: 'ERROR',
      payload: {
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        fileName
      },
      id: messageId
    } as WorkerResponse);
  }
}

// Process text files
async function processTextInWorker(
  fileData: ArrayBuffer,
  fileName: string,
  messageId: string
): Promise<void> {
  try {
    self.postMessage({
      type: 'PROGRESS',
      payload: { progress: 0, message: 'Processing text file...' },
      id: messageId
    } as WorkerResponse);
    
    const decoder = new TextDecoder('utf-8');
    const content = decoder.decode(fileData);
    
    self.postMessage({
      type: 'PROGRESS',
      payload: { progress: 50, message: 'Analyzing content...' },
      id: messageId
    } as WorkerResponse);
    
    // Simulate processing time for large files
    if (fileData.byteLength > 1024 * 1024) { // > 1MB
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    self.postMessage({
      type: 'SUCCESS',
      payload: {
        content,
        fileName,
        processingTime: Date.now()
      },
      id: messageId
    } as WorkerResponse);
    
  } catch (error) {
    self.postMessage({
      type: 'ERROR',
      payload: {
        error: error instanceof Error ? error.message : 'Failed to process text file',
        fileName
      },
      id: messageId
    } as WorkerResponse);
  }
}

// Main message handler
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { type, payload, id } = event.data;
  
  try {
    switch (type) {
      case 'PROCESS_PDF':
        await processPdfInWorker(
          payload.fileData,
          payload.fileName,
          payload.options,
          id
        );
        break;
        
      case 'PROCESS_TEXT':
        await processTextInWorker(
          payload.fileData,
          payload.fileName,
          id
        );
        break;
        
      default:
        self.postMessage({
          type: 'ERROR',
          payload: { error: `Unknown message type: ${type}` },
          id
        } as WorkerResponse);
    }
  } catch (error) {
    self.postMessage({
      type: 'ERROR',
      payload: {
        error: error instanceof Error ? error.message : 'Worker processing failed'
      },
      id
    } as WorkerResponse);
  }
};

// Handle worker errors
self.onerror = (error) => {
  console.error('Worker error:', error);
};

export {};