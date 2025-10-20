import { pdfjs as pdfjsLib } from 'react-pdf';
import './pdfWorkerConfig'; // Auto-configures PDF.js worker

export interface ChunkProcessingOptions {
  chunkSize?: number; // Size of each chunk in bytes (default: 1MB)
  maxMemoryUsage?: number; // Maximum memory usage in MB (default: 100MB)
  onProgress?: (progress: number, currentChunk: number, totalChunks: number) => void;
  onChunkProcessed?: (chunkResult: string, chunkIndex: number) => void;
}

export interface ProcessingResult {
  content: string;
  totalChunks: number;
  processingTime: number;
  memoryUsed: number;
}

export class ChunkedFileProcessor {
  private static readonly DEFAULT_CHUNK_SIZE = 1024 * 1024; // 1MB
  private static readonly DEFAULT_MAX_MEMORY = 100 * 1024 * 1024; // 100MB
  private static readonly MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB limit

  /**
   * Process a large PDF file in chunks to avoid memory issues
   */
  static async processPdfInChunks(
    file: File,
    options: ChunkProcessingOptions = {}
  ): Promise<ProcessingResult> {
    const startTime = performance.now();
    const {
      maxMemoryUsage = this.DEFAULT_MAX_MEMORY,
      onProgress,
      onChunkProcessed
    } = options;

    // Validate file size
    if (file.size > this.MAX_FILE_SIZE) {
      throw new Error(`File too large. Maximum size is ${this.MAX_FILE_SIZE / (1024 * 1024)}MB`);
    }

    let processedContent = '';
    let currentMemoryUsage = 0;

    try {
      // For PDFs, we need to load the entire file first, then process pages in chunks
      const arrayBuffer = await this.readFileAsArrayBuffer(file);
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      
      const totalPages = pdf.numPages;
      const pagesPerChunk = Math.max(1, Math.floor(10)); // Process 10 pages at a time
      const pageChunks = Math.ceil(totalPages / pagesPerChunk);

      for (let chunkIndex = 0; chunkIndex < pageChunks; chunkIndex++) {
        const startPage = chunkIndex * pagesPerChunk + 1;
        const endPage = Math.min((chunkIndex + 1) * pagesPerChunk, totalPages);
        
        // Process pages in this chunk
        const chunkContent = await this.processPdfPageRange(pdf, startPage, endPage);
        
        // Memory management
        currentMemoryUsage += chunkContent.length * 2; // Rough estimate (UTF-16)
        if (currentMemoryUsage > maxMemoryUsage) {
          // Force garbage collection by clearing references
          await this.forceGarbageCollection();
          currentMemoryUsage = processedContent.length * 2;
        }

        processedContent += chunkContent;
        
        // Notify progress
        const progress = ((chunkIndex + 1) / pageChunks) * 100;
        onProgress?.(progress, chunkIndex + 1, pageChunks);
        onChunkProcessed?.(chunkContent, chunkIndex);

        // Yield control to prevent UI blocking
        await this.yieldToMainThread();
      }

      const endTime = performance.now();
      return {
        content: processedContent,
        totalChunks: pageChunks,
        processingTime: endTime - startTime,
        memoryUsed: currentMemoryUsage
      };

    } catch (error) {
      throw new Error(`Chunked processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Process a large text file in chunks
   */
  static async processTextFileInChunks(
    file: File,
    options: ChunkProcessingOptions = {}
  ): Promise<ProcessingResult> {
    const startTime = performance.now();
    const {
      chunkSize = this.DEFAULT_CHUNK_SIZE,
      onProgress,
      onChunkProcessed
    } = options;

    const totalChunks = Math.ceil(file.size / chunkSize);
    let processedContent = '';
    let currentMemoryUsage = 0;

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const start = chunkIndex * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      
      const chunk = file.slice(start, end);
      const chunkText = await this.readChunkAsText(chunk);
      
      processedContent += chunkText;
      currentMemoryUsage += chunkText.length * 2;
      
      // Progress notification
      const progress = ((chunkIndex + 1) / totalChunks) * 100;
      onProgress?.(progress, chunkIndex + 1, totalChunks);
      onChunkProcessed?.(chunkText, chunkIndex);

      // Yield control
      await this.yieldToMainThread();
    }

    const endTime = performance.now();
    return {
      content: processedContent,
      totalChunks,
      processingTime: endTime - startTime,
      memoryUsed: currentMemoryUsage
    };
  }

  /**
   * Stream process a file with real-time content delivery
   */
  static async streamProcessFile(
    file: File,
    onContentChunk: (chunk: string, isComplete: boolean) => void,
    options: ChunkProcessingOptions = {}
  ): Promise<void> {

    if (file.type === 'application/pdf') {
      await this.streamProcessPdf(file, onContentChunk, options);
    } else {
      await this.streamProcessTextFile(file, onContentChunk, options);
    }
  }

  private static async streamProcessPdf(
    file: File,
    onContentChunk: (chunk: string, isComplete: boolean) => void,
    options: ChunkProcessingOptions
  ): Promise<void> {
    const arrayBuffer = await this.readFileAsArrayBuffer(file);
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    
    const totalPages = pdf.numPages;
    const pagesPerChunk = 5; // Process 5 pages at a time for streaming
    
    for (let startPage = 1; startPage <= totalPages; startPage += pagesPerChunk) {
      const endPage = Math.min(startPage + pagesPerChunk - 1, totalPages);
      const chunkContent = await this.processPdfPageRange(pdf, startPage, endPage);
      
      const isComplete = endPage === totalPages;
      onContentChunk(chunkContent, isComplete);
      
      // Progress notification
      const progress = (endPage / totalPages) * 100;
      options.onProgress?.(progress, Math.ceil(startPage / pagesPerChunk), Math.ceil(totalPages / pagesPerChunk));
      
      await this.yieldToMainThread();
    }
  }

  private static async streamProcessTextFile(
    file: File,
    onContentChunk: (chunk: string, isComplete: boolean) => void,
    options: ChunkProcessingOptions
  ): Promise<void> {
    const { chunkSize = this.DEFAULT_CHUNK_SIZE } = options;
    const totalChunks = Math.ceil(file.size / chunkSize);
    
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const start = chunkIndex * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      
      const chunk = file.slice(start, end);
      const chunkText = await this.readChunkAsText(chunk);
      
      const isComplete = chunkIndex === totalChunks - 1;
      onContentChunk(chunkText, isComplete);
      
      // Progress notification
      const progress = ((chunkIndex + 1) / totalChunks) * 100;
      options.onProgress?.(progress, chunkIndex + 1, totalChunks);
      
      await this.yieldToMainThread();
    }
  }

  private static async processPdfPageRange(
    pdf: pdfjsLib.PDFDocumentProxy,
    startPage: number,
    endPage: number
  ): Promise<string> {
    let content = '';
    
    for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
      try {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: { str: string }) => item.str)
          .join(' ');
        
        content += `\n\n--- Page ${pageNum} ---\n${pageText}`;
      } catch (error) {
        console.warn(`Failed to process page ${pageNum}:`, error);
        content += `\n\n--- Page ${pageNum} (Error) ---\n[Content could not be extracted]`;
      }
    }
    
    return content;
  }

  private static async readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  }

  private static async readChunkAsText(chunk: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read chunk'));
      reader.readAsText(chunk);
    });
  }

  private static async yieldToMainThread(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  private static async forceGarbageCollection(): Promise<void> {
    // Force garbage collection by creating and releasing memory pressure
    if ('gc' in window && typeof (window as { gc?: () => void }).gc === 'function') {
      (window as { gc: () => void }).gc();
    }
    
    // Alternative: yield and hope for GC
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  /**
   * Estimate memory usage for a file
   */
  static estimateMemoryUsage(file: File): number {
    // Rough estimation: text content uses ~2 bytes per character (UTF-16)
    // PDF processing might use 2-3x the file size in memory
    const multiplier = file.type === 'application/pdf' ? 3 : 2;
    return file.size * multiplier;
  }

  /**
   * Check if file can be processed safely
   */
  static canProcessSafely(file: File, availableMemory: number = 100 * 1024 * 1024): boolean {
    const estimatedUsage = this.estimateMemoryUsage(file);
    return estimatedUsage <= availableMemory && file.size <= this.MAX_FILE_SIZE;
  }
}

export default ChunkedFileProcessor;