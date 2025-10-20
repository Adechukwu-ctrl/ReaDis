import { useState, useCallback } from 'react';
import { createWorker } from 'tesseract.js';
import { pdfjs } from 'react-pdf';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { ContentSource } from '../types';
import { ChunkedFileProcessor } from '../utils/chunkedFileProcessor';
import { useWorkerFileProcessor } from './useWorkerFileProcessor';
import { fileCache } from '../utils/fileCache';
import '../utils/pdfWorkerConfig';

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
      // Convert file to base64 for display
      const fileData = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      
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
          
          // Convert file to base64 for display (still needed for UI)
          const fileData = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
          });
          
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
      
      // Convert file to base64 for display
      const fileData = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      
      setProgress(5);
      
      // Check file size and determine processing method
      const fileSizeMB = file.size / (1024 * 1024);
      const useWorkerProcessing = shouldUseWorker(file); // Files > 5MB
      const useChunkedProcessing = fileSizeMB > 10 && fileSizeMB <= 25; // 10-25MB range
      const useWorkerForVeryLarge = fileSizeMB > 25; // > 25MB
      
      console.log(`Starting PDF extraction for file: ${file.name}, Size: ${fileSizeMB.toFixed(2)}MB, Worker: ${useWorkerProcessing}, Chunked: ${useChunkedProcessing}`);
      
      if (useWorkerForVeryLarge) {
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
      
      if (useChunkedProcessing || useWorkerForVeryLarge) {
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
            await fileCache.set(
              file,
              result.content,
              'chunked',
              result.processingTime,
              { fileType: file.type }
            );
          }
          
          setProgress(100);
           console.log(`Chunked PDF extraction completed in ${result.processingTime.toFixed(2)}ms, Memory used: ${(result.memoryUsed / (1024 * 1024)).toFixed(2)}MB`);
           return content;
         } catch (error) {
           console.error('Chunked processing failed:', error);
           throw new Error('Failed to extract text from PDF. Please try a different file.');
         }
      }
      
      // Use traditional processing for smaller files
      const arrayBuffer = await file.arrayBuffer();
      
      // Validate ArrayBuffer before use
      if (!arrayBuffer || arrayBuffer.byteLength === 0) {
        throw new Error('Invalid or empty PDF file');
      }
      
      // Clone the ArrayBuffer to prevent detachment issues
      const clonedBuffer = arrayBuffer.slice(0);
      const uint8Array = new Uint8Array(clonedBuffer);
      
      setProgress(10);
      
      // Validate and configure worker before PDF processing
      console.log('Using traditional PDF processing for smaller file');
      
      // Ensure worker is properly configured
      configurePdfWorker();
      
      if (!pdfjs.GlobalWorkerOptions.workerSrc) {
        throw new Error('PDF worker could not be configured. Please refresh the page and try again.');
      }
      
      console.log('PDF worker ready:', pdfjs.GlobalWorkerOptions.workerSrc);
       
      let attempts = 0;
      const maxAttempts = 3;
      
      while (attempts < maxAttempts) {
        try {
          attempts++;
          console.log(`PDF loading attempt ${attempts}/${maxAttempts}`);
          
          // Clean up previous loading task if it exists
          if (loadingTask) {
            try {
              loadingTask.destroy();
            } catch (cleanupError) {
              console.warn('Error cleaning up previous loading task:', cleanupError);
            }
            loadingTask = undefined;
          }
          
          // Create a fresh copy of the data for each attempt
          const freshUint8Array = new Uint8Array(uint8Array);
          
          if (attempts === 1) {
            // First attempt: Use CDN resources
            loadingTask = pdfjs.getDocument({
              data: freshUint8Array,
              cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.4.149/cmaps/',
              cMapPacked: true,
              standardFontDataUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.4.149/standard_fonts/',
              verbosity: 0,
              isEvalSupported: false,
              disableFontFace: false,
              useWorkerFetch: true,
            });
          } else if (attempts === 2) {
            // Second attempt: Minimal configuration with worker
            loadingTask = pdfjs.getDocument({
              data: freshUint8Array,
              verbosity: 0,
              isEvalSupported: false,
              disableFontFace: true,
              useSystemFonts: true,
              useWorkerFetch: true,
            });
          } else {
            // Final attempt: Disable worker entirely
            console.warn('Disabling PDF worker for final attempt');
            loadingTask = pdfjs.getDocument({
              data: freshUint8Array,
              verbosity: 0,
              isEvalSupported: false,
              disableFontFace: true,
              useSystemFonts: true,
              useWorkerFetch: false,
            });
          }
          
          // Test the loading task
          if (loadingTask) {
            await loadingTask.promise;
          }
          console.log(`PDF loading successful on attempt ${attempts}`);
          break;
          
        } catch (attemptError) {
          console.warn(`PDF loading attempt ${attempts} failed:`, attemptError);
          
          // Clean up failed loading task
          if (loadingTask) {
            try {
              loadingTask.destroy();
            } catch (cleanupError) {
              console.warn('Error cleaning up failed loading task:', cleanupError);
            }
            loadingTask = undefined;
          }
          
          if (attempts === maxAttempts) {
            const errorMessage = attemptError instanceof Error ? attemptError.message : 'Unknown error';
            throw new Error(`PDF loading failed after ${maxAttempts} attempts. Last error: ${errorMessage}. This may be due to: 1) Corrupted PDF file, 2) Network issues with PDF.js worker, 3) Unsupported PDF format, or 4) Browser security restrictions.`);
          }
          
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      // Get the PDF document from the successful loading task
      if (!loadingTask) {
        throw new Error('Failed to create PDF loading task');
      }
      const pdf = await loadingTask.promise;
      console.log('PDF document ready. Pages:', pdf.numPages);
      
      setProgress(20);
      
      let fullText = '';
      const totalPages = pdf.numPages;
      
      // OCR fallback: render PDF pages to canvas and recognize text with tesseract.js
      const ocrExtractTextFromPdf = async (
        pdf: any,
        setProgressFn: (p: number) => void
      ): Promise<string> => {
        try {
          const totalPages = pdf.numPages || 0;
          const worker = await createWorker();
          await worker.load('eng');
          await worker.reinitialize('eng');
          let ocrText = '';
          for (let i = 1; i <= totalPages; i++) {
            try {
              const page = await pdf.getPage(i);
              const viewport = page.getViewport({ scale: 2.0 });
              const canvas = document.createElement('canvas');
              canvas.width = Math.floor(viewport.width);
              canvas.height = Math.floor(viewport.height);
              const ctx = canvas.getContext('2d');
              if (!ctx) {
                console.warn('Canvas 2D context unavailable for OCR');
                continue;
              }
              await page.render({ canvasContext: ctx, viewport }).promise;
              const { data } = await worker.recognize(canvas);
              const text = (data?.text || '').trim();
              if (text) {
                ocrText += `--- Page ${i} (OCR) ---\n${text}\n\n`;
              }
              setProgressFn(20 + (i / Math.max(1, totalPages)) * 80);
            } catch (pageErr) {
              console.warn(`OCR failed on page ${i}:`, pageErr);
            }
          }
          await worker.terminate();
          return ocrText.trim();
        } catch (err) {
          console.error('OCR extraction failed:', err);
          return '';
        }
      };
      if (!fullText.trim()) {
        console.warn('No text from PDF.js, attempting OCR fallback...');
        setIsUsingOCR(true);
        const ocrStart = performance.now();
        const ocrText = await ocrExtractTextFromPdf(pdf, setProgress);
        setIsUsingOCR(false);
        if (ocrText) {
          // Cache OCR result when appropriate
          if (fileCache.shouldCache(file)) {
            try {
              await fileCache.set(
                file,
                ocrText,
                'ocr',
                Math.round(performance.now() - ocrStart),
                { totalPages, fileType: file.type }
              );
            } catch (cacheErr) {
              console.warn('Failed to cache OCR result:', cacheErr);
            }
          }
          return {
            id: Date.now().toString(),
            type: 'file',
            title: file.name,
            content: ocrText,
            filename: file.name,
            fileData,
            fileType: file.type,
          };
        }
        throw new Error('No text content found in PDF after OCR. The PDF may be image-based with low quality or encrypted.');
      }
      
      return {
        id: Date.now().toString(),
        type: 'file',
        title: file.name,
        content: fullText.trim(),
        filename: file.name,
        fileData,
        fileType: file.type,
      };
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
            // Convert file to base64 for display in recovery
            const recoveryFileData = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.readAsDataURL(file);
            });
            
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
      // Convert file to base64 for display
      const fileData = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      
      setProgress(30);
      
      // Convert file to array buffer
      const arrayBuffer = await file.arrayBuffer();
      
      setProgress(60);
      
      // Extract text using mammoth
      const result = await mammoth.extractRawText({ arrayBuffer });
      
      setProgress(100);
      
      return {
        id: Date.now().toString(),
        type: 'file',
        title: file.name,
        content: result.value.trim(),
        filename: file.name,
        fileData,
        fileType: file.type,
      };
    } catch (err: unknown) {
      console.error('Error extracting from Word document:', err);
      throw new Error('Failed to extract text from Word document. Please ensure it\'s a valid .docx file.');
    } finally {
      setIsExtracting(false);
      setProgress(0);
    }
  }, []);

  const extractFromSpreadsheet = useCallback(async (file: File): Promise<ContentSource> => {
    setIsExtracting(true);
    setProgress(0);
    
    try {
      // Convert file to base64 for display
      const fileData = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      
      setProgress(30);
      
      // Convert file to array buffer
      const arrayBuffer = await file.arrayBuffer();
      
      setProgress(60);
      
      // Parse spreadsheet using xlsx
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      
      let content = '';
      
      // Extract text from all sheets
      workbook.SheetNames.forEach((sheetName, index) => {
        const worksheet = workbook.Sheets[sheetName];
        const sheetData = XLSX.utils.sheet_to_csv(worksheet);
        
        if (index > 0) content += '\n\n';
        content += `Sheet: ${sheetName}\n`;
        content += sheetData;
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