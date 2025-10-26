import { useState, useCallback } from 'react';
import { createWorker } from 'tesseract.js';
// Replace react-pdf's pdfjs with direct pdfjs-dist to ensure 5.x API
import * as pdfjs from 'pdfjs-dist';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { ContentSource } from '../types';
import { ChunkedFileProcessor } from '../utils/chunkedFileProcessor';
import { useWorkerFileProcessor } from './useWorkerFileProcessor';
import { fileCache } from '../utils/fileCache';
import '../utils/pdfWorkerConfig';
import blobUrlManager from '../utils/blobUrlManager';

export const useContentExtraction = () => {
  const [isExtracting, setIsExtracting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isUsingOCR, setIsUsingOCR] = useState(false);
  // Initialize worker for large file processing
  const {
    processPdfWithWorker,
    shouldUseWorker
  } = useWorkerFileProcessor();

  const extractFromWebpage = useCallback(async (url: string): Promise<ContentSource> => {
    setIsExtracting(true);
    setProgress(10);

    const rawInput = url.trim();
    const normalizedUrl = /^https?:\/\//i.test(rawInput) ? rawInput : `https://${rawInput}`;

    // Helper to build Jina Reader URL which bypasses CORS and returns readable text
    const buildJinaUrl = (target: string) => `https://r.jina.ai/${target}`;

    try {
      // Primary: Use Jina Reader for robust CORS-bypassed text extraction
      const jinaUrl = buildJinaUrl(normalizedUrl);
      const jinaResp = await fetch(jinaUrl, {
        headers: {
          'accept': 'text/plain, */*;q=0.8'
        }
      });

      if (jinaResp.ok) {
        const text = await jinaResp.text();
        setProgress(70);
        const contentText = (text || '').trim();

        if (contentText.length >= 50) {
          setProgress(100);
          const titleHost = new URL(normalizedUrl).hostname;
          return {
            id: Date.now().toString(),
            type: 'webpage',
            title: titleHost,
            content: contentText,
            url: normalizedUrl,
          };
        }
        // If text is unexpectedly short, fall through to HTML parsing
      }

      // Fallback: try AllOrigins raw to fetch HTML and parse content
      const rawResp = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(normalizedUrl)}`);
      if (!rawResp.ok) {
        throw new Error(`Fallback proxy failed with status ${rawResp.status}`);
      }
      const html = await rawResp.text();
      setProgress(85);

      if (!html || html.length === 0) {
        throw new Error('Empty HTML from fallback proxy');
      }

      // Parse HTML content
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Remove script and style elements
      const scripts = doc.querySelectorAll('script, style, noscript');
      scripts.forEach(el => el.remove());

      // Extract text content
      const content = (doc.body?.textContent || doc.textContent || '').trim();
      const title = (doc.title || new URL(normalizedUrl).hostname).trim();

      if (!content) {
        throw new Error('Failed to extract readable text from webpage');
      }

      setProgress(100);

      return {
        id: Date.now().toString(),
        type: 'webpage',
        title,
        content,
        url: normalizedUrl,
      };
    } catch (err: unknown) {
      console.error('Error extracting from webpage:', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      throw new Error(`Failed to extract webpage content: ${message}`);
    } finally {
      setIsExtracting(false);
      setProgress(0);
    }
  }, []);

  const extractFromImage = useCallback(async (file: File): Promise<ContentSource> => {
    setIsExtracting(true);
    setProgress(0);
    
    try {
      // Use fast object URL instead of base64 for display
      const fileData = URL.createObjectURL(file);
      blobUrlManager.register(fileData);
      
      const worker = await createWorker();
      await worker.load('eng');
      await worker.reinitialize('eng');
      
      setProgress(30);
      
      const { data } = await worker.recognize(file);
      
      await worker.terminate();
      
      return {
        id: Date.now().toString(),
        type: 'file',
        title: file.name,
        content: data.text.trim(),
        filename: file.name,
        fileData,
        fileType: file.type,
      };
    } catch (err: unknown) {
      console.error('Error extracting from image:', err);
      throw new Error('Failed to extract text from image. Please try a different image.');
    } finally {
      setIsExtracting(false);
      setProgress(0);
    }
  }, []);

  const extractFromPDF = useCallback(async (file: File): Promise<ContentSource> => {
    setIsExtracting(true);
    setProgress(0);
    let loadingTask: any = null;
    
    try {
      // Check cache first for large files
      if (fileCache.shouldCache(file)) {
        setProgress(2);
        const cachedEntry = await fileCache.get(file);
        
        if (cachedEntry) {
          setProgress(95);
          
          // Use fast object URL instead of base64 for display
          const fileData = URL.createObjectURL(file);
          blobUrlManager.register(fileData);
          
          const content: ContentSource = {
            id: Date.now().toString(),
            type: 'file',
            title: file.name,
            content: cachedEntry.content,
            filename: file.name,
            fileData,
            fileType: file.type,
            extractedAt: new Date().toISOString()
          };
          
          setProgress(100);
          console.log(`Retrieved ${file.name} from cache (${cachedEntry.processingMethod} method, accessed ${cachedEntry.accessCount} times)`);
          return content;
        }
      }
      
      // Fast object URL for display
      const fileData = URL.createObjectURL(file);
      blobUrlManager.register(fileData);
      
      setProgress(5);
      
      // Check file size and determine processing method
      const fileSizeMB = file.size / (1024 * 1024);
      const useWorkerProcessing = shouldUseWorker(file); // Files > 5MB
      const useChunkedProcessing = fileSizeMB > 10 && fileSizeMB <= 25; // 10-25MB range
      const useWorkerForVeryLarge = fileSizeMB > 25; // > 25MB
      const preferWorker = useWorkerForVeryLarge || useChunkedProcessing || useWorkerProcessing || fileSizeMB >= 10;
      
      console.log(`Starting PDF extraction for file: ${file.name}, Size: ${fileSizeMB.toFixed(2)}MB, PreferWorker: ${preferWorker}, Chunked: ${useChunkedProcessing}`);
      
      if (preferWorker) {
        // Use Web Worker for very large files (> 25MB)
        try {
          const result = await processPdfWithWorker(file, {
            chunkSize: 3, // Smaller chunks for very large files
            maxPages: 500, // Limit pages for very large files
            onProgress: (progress, message) => {
              setProgress(Math.min(95, progress));
              console.log(`Worker progress: ${progress}% - ${message}`);
            },
            onChunkProcessed: (chunkData: unknown) => {
              const typedChunkData = chunkData as { chunkIndex: number; pagesProcessed: number; totalPages: number; };
              console.log(`Worker processed chunk ${typedChunkData.chunkIndex + 1}, pages ${typedChunkData.pagesProcessed}/${typedChunkData.totalPages}`);
            }
          });
          
          const content: ContentSource = {
             id: Date.now().toString(),
             type: 'file',
             title: file.name,
             content: result.content,
             filename: file.name,
             fileData,
             fileType: file.type,
             extractedAt: new Date().toISOString()
           };
           
           // Cache the result for future use
           if (fileCache.shouldCache(file)) {
             await fileCache.set(
               file,
               result.content,
               'worker',
               result.processingTime,
               { totalPages: result.totalPages, fileType: file.type }
             );
           }
           
           setProgress(100);
           console.log(`Worker PDF extraction completed for ${result.totalPages} pages`);
           return content;
        } catch (workerError) {
          console.warn('Worker processing failed, falling back to chunked processing:', workerError);
          // Fall back to chunked processing if worker fails
        }
      }
      
      if (useChunkedProcessing || useWorkerForVeryLarge || preferWorker) {
        try {
          // Use chunked processing for large files (10-25MB) or as fallback
          const result = await ChunkedFileProcessor.processPdfInChunks(file, {
            onProgress: (progress) => {
              setProgress(Math.min(90, progress * 0.8 + 10)); // Scale progress to 10-90%
            },
            onChunkProcessed: (chunkContent, chunkIndex) => {
              console.log(`Processed chunk ${chunkIndex + 1}, content length: ${chunkContent.length}`);
            }
          });
          
          setProgress(95);
          
          const content: ContentSource = {
             id: Date.now().toString(),
             type: 'file',
             title: file.name,
             content: result.content,
             filename: file.name,
             fileData,
             fileType: file.type,
             extractedAt: new Date().toISOString()
           };
         
         // Cache the result for future use
         if (fileCache.shouldCache(file)) {
           try {
             await fileCache.set(
               file,
               result.content,
               'chunked',
               result.processingTime,
               { fileType: file.type }
             );
           } catch (cacheErr) {
             console.warn('Failed to cache chunked processing result:', cacheErr);
           }
         }
         
         setProgress(100);
         console.log('Chunked PDF extraction completed');
         return content;
        } catch (chunkError) {
          console.warn('Chunked processing failed, falling back to direct processing:', chunkError);
          // Fall through to direct processing
        }
      }
      
      // Direct processing for small files or if other methods failed
      // Use default PDF.js font and CMap configuration; avoid invalid URL paths
      
      // Configure and attempt to load PDF with retries
      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          console.log(`Attempt ${attempt} to load PDF using pdfjs-dist`);
          loadingTask = (pdfjs as any).getDocument({
            data: await file.arrayBuffer(),
          });
          // If no error is thrown, break from retry loop
          break;
        } catch (attemptError) {
          console.warn(`PDF loading attempt ${attempt} failed:`, attemptError);
          if (attempt === maxAttempts) {
            throw attemptError;
          }
        }
      }
      
      // Attempt to load PDF
      try {
        const pdf = await loadingTask.promise;
        console.log('PDF document ready. Pages:', pdf.numPages);
        setProgress(20);
        
        let fullText = '';
        const totalPages = pdf.numPages;
        // OCR worker and flag
        let ocrWorker: any = null;
        let usedOCR = false;
        
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
          setProgress(Math.min(95, 20 + (pageNum / totalPages) * 75));
          try {
            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map((item: { str: string }) => item.str).join(' ').trim();
            
            // If no text found, perform OCR on the rendered page image
            if (!pageText || pageText.length < 5) {
              usedOCR = true;
              try { setIsUsingOCR(true); } catch {}
              // Lazily initialize OCR worker
              if (!ocrWorker) {
                ocrWorker = await createWorker();
                await ocrWorker.load('eng');
                await ocrWorker.reinitialize('eng');
              }
              
              const viewport = page.getViewport({ scale: 2 });
              let ocrText = '';
              try {
                if (typeof OffscreenCanvas !== 'undefined') {
                  const canvas = new OffscreenCanvas(viewport.width, viewport.height);
                  const ctx = canvas.getContext('2d');
                  if (ctx) {
                    await page.render({ canvasContext: ctx as any, viewport }).promise;
                    const blob = await canvas.convertToBlob({ type: 'image/png' });
                    const { data } = await ocrWorker.recognize(blob);
                    ocrText = (data.text || '').trim();
                  }
                } else {
                  const canvas = document.createElement('canvas');
                  canvas.width = viewport.width;
                  canvas.height = viewport.height;
                  const ctx = canvas.getContext('2d');
                  if (ctx) {
                    await page.render({ canvasContext: ctx as any, viewport }).promise;
                    const { data } = await ocrWorker.recognize(canvas);
                    ocrText = (data.text || '').trim();
                  }
                }
              } catch (ocrErr) {
                console.warn(`OCR failed on page ${pageNum}:`, ocrErr);
              }
              
              if (ocrText && ocrText.length > 0) {
                fullText += `\n\n--- Page ${pageNum} (OCR) ---\n${ocrText}`;
              } else {
                fullText += `\n\n--- Page ${pageNum} (Error) ---\n[Content could not be extracted]`;
              }
            } else {
              fullText += `\n\n--- Page ${pageNum} ---\n${pageText}`;
            }
          } catch (pageError) {
            console.warn(`Error processing page ${pageNum}:`, pageError);
            fullText += `\n\n--- Page ${pageNum} (Error) ---\n[Content could not be extracted]`;
          }
        }
        
        // Cleanup OCR worker and UI flag
        try { if (ocrWorker) { await ocrWorker.terminate(); } } catch {}
        try { setIsUsingOCR(false); } catch {}
        
        return {
          id: Date.now().toString(),
          type: 'file',
          title: file.name,
          content: fullText.trim(),
          filename: file.name,
          fileData,
          fileType: file.type,
        };
      } catch (err) {
        throw err;
      }
    } catch (err: unknown) {
      console.error('PDF extraction error:', err);
      
      let errorMessage = 'Failed to extract text from PDF';
      let recoveryAttempted = false;
      
      if (err instanceof Error) {
        const message = err.message.toLowerCase();
        
        // Attempt recovery for specific error types
        if ((message.includes('worker') || message.includes('memory') || message.includes('timeout')) && !recoveryAttempted) {
          console.log('Attempting recovery with chunked processing...');
          recoveryAttempted = true;
          
          try {
            // Use object URL for display in recovery
            const recoveryFileData = URL.createObjectURL(file);
            blobUrlManager.register(recoveryFileData);
            
            // Fallback to chunked processing
            const result = await ChunkedFileProcessor.processPdfInChunks(file, {
              onProgress: (progress) => {
                setProgress(Math.min(90, progress * 0.8 + 10));
              }
            });
            
            const content: ContentSource = {
              id: Date.now().toString(),
              type: 'file',
              title: file.name,
              content: result.content,
              filename: file.name,
              fileData: recoveryFileData,
              fileType: file.type,
              extractedAt: new Date().toISOString()
            };
            
            // Cache the recovery result
            if (fileCache.shouldCache(file)) {
              await fileCache.set(
                file,
                result.content,
                'chunked',
                result.processingTime,
                { fileType: file.type }
              );
            }
            
            setProgress(100);
            console.log('Recovery successful with chunked processing');
            return content;
          } catch (recoveryError) {
            console.error('Recovery attempt failed:', recoveryError);
            errorMessage = `Primary extraction failed, recovery also failed: ${recoveryError instanceof Error ? recoveryError.message : 'Unknown error'}`;
          }
        }
        
        if (message.includes('invalid pdf') || message.includes('corrupted') || message.includes('not a pdf')) {
          errorMessage = 'The file appears to be corrupted or is not a valid PDF';
        } else if (message.includes('password') || message.includes('encrypted')) {
          errorMessage = 'This PDF is password-protected. Please provide an unprotected version';
        } else if (message.includes('worker') || message.includes('script') || message.includes('loading failed')) {
          errorMessage = 'PDF processing engine failed to load. Please refresh the page and try again';
        } else if (message.includes('network') || message.includes('fetch') || message.includes('connection')) {
          errorMessage = 'Network error occurred. Please check your internet connection and try again';
        } else if (message.includes('attempts') || message.includes('incompatible')) {
          errorMessage = 'This PDF format is not supported or the file is corrupted';
        } else if (message.includes('no text content')) {
          errorMessage = 'This PDF contains no extractable text. It may be image-based or scanned';
        } else if (message.includes('memory')) {
          errorMessage = `PDF processing failed due to memory constraints: ${err.message}. Try processing a smaller file or restart the application.`;
        } else if (message.includes('timeout')) {
          errorMessage = `PDF processing timed out: ${err.message}. Try processing a smaller file or check your internet connection.`;
        } else {
          errorMessage = `PDF processing failed: ${err.message}`;
        }
      }
      
      throw new Error(errorMessage);
    } finally {
      // Clean up PDF resources
      if (loadingTask) {
        try {
          loadingTask.destroy();
        } catch (cleanupError) {
          console.warn('Error cleaning up PDF loading task:', cleanupError);
        }
      }
      
      setIsExtracting(false);
      setProgress(0);
    }
  }, [shouldUseWorker, processPdfWithWorker]);

  const extractFromWord = useCallback(async (file: File): Promise<ContentSource> => {
    setIsExtracting(true);
    setProgress(0);
    
    try {
      // Use fast object URL instead of base64 for display
      const fileData = URL.createObjectURL(file);
      blobUrlManager.register(fileData);
      
      setProgress(30);
      
      // Convert file to array buffer
      const arrayBuffer = await file.arrayBuffer();
      
      setProgress(60);
      
      // Extract text using mammoth
      const { value: content } = await mammoth.extractRawText({ arrayBuffer });
      
      setProgress(100);
      
      return {
        id: Date.now().toString(),
        type: 'file',
        title: file.name,
        content: content.trim(),
        filename: file.name,
        fileData,
        fileType: file.type,
      };
    } catch (err: unknown) {
      console.error('Error extracting from word document:', err);
      throw new Error('Failed to extract text from document. Please ensure it\'s a valid .docx file.');
    } finally {
      setIsExtracting(false);
      setProgress(0);
    }
  }, []);

  const extractFromSpreadsheet = useCallback(async (file: File): Promise<ContentSource> => {
    setIsExtracting(true);
    setProgress(0);
    
    try {
      // Use fast object URL instead of base64 for display
      const fileData = URL.createObjectURL(file);
      blobUrlManager.register(fileData);
      
      setProgress(30);
      
      // Convert file to array buffer
      const arrayBuffer = await file.arrayBuffer();
      
      setProgress(60);
      
      // Parse spreadsheet
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      let content = '';
      workbook.SheetNames.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        if (sheet) {
          const csv = XLSX.utils.sheet_to_csv(sheet);
          content += `\n\n--- Sheet ${sheetName} ---\n${csv}`;
        }
      });
      
      setProgress(100);
      
      return {
        id: Date.now().toString(),
        type: 'file',
        title: file.name,
        content: content.trim(),
        filename: file.name,
        fileData,
        fileType: file.type,
      };
    } catch (err: unknown) {
      console.error('Error extracting from spreadsheet:', err);
      throw new Error('Failed to extract text from spreadsheet. Please ensure it\'s a valid Excel file.');
    } finally {
      setIsExtracting(false);
      setProgress(0);
    }
  }, []);

  const extractFromText = useCallback((text: string): ContentSource => {
    return {
      id: Date.now().toString(),
      type: 'text',
      title: 'Pasted Text',
      content: text.trim(),
    };
  }, []);

  return {
    isExtracting,
    progress,
    isUsingOCR,
    extractFromWebpage,
    extractFromImage,
    extractFromPDF,
    extractFromWord,
    extractFromSpreadsheet,
    extractFromText,
  };
};

// This function is imported from pdfWorkerConfig.ts
export function configurePdfWorker() {
  // Implementation moved to pdfWorkerConfig.ts
  // This is now just a compatibility function
  console.log('PDF worker configuration handled by pdfWorkerConfig.ts');
}