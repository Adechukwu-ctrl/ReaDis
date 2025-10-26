import * as pdfjsLib from 'pdfjs-dist';
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

    const contentChunks: string[] = [];
    let currentMemoryUsage = 0;

    try {
      // Load entire PDF bytes efficiently
      const arrayBuffer = await this.readFileAsArrayBuffer(file);
      const pdf = await (pdfjsLib as any).getDocument({ data: arrayBuffer, disableAutoFetch: true }).promise;
      
      const totalPages = pdf.numPages;
      const pagesPerChunk = Math.max(1, Math.floor(10)); // Process 10 pages at a time
      const pageChunks = Math.ceil(totalPages / pagesPerChunk);

      for (let chunkIndex = 0; chunkIndex < pageChunks; chunkIndex++) {
        const startPage = chunkIndex * pagesPerChunk + 1;
        const endPage = Math.min((chunkIndex + 1) * pagesPerChunk, totalPages);
        
        // Process pages in this chunk concurrently
        const chunkContent = await this.processPdfPageRange(pdf, startPage, endPage);
        
        // Memory management (estimate)
        currentMemoryUsage += chunkContent.length * 2; // Rough estimate (UTF-16)
        if (currentMemoryUsage > maxMemoryUsage) {
          await this.forceGarbageCollection();
          // Recalculate based on accumulated chunks
          const totalLength = contentChunks.reduce((sum, c) => sum + c.length, 0);
          currentMemoryUsage = totalLength * 2;
        }

        contentChunks.push(chunkContent);
        
        // Notify progress
        const progress = ((chunkIndex + 1) / pageChunks) * 100;
        onProgress?.(progress, chunkIndex + 1, pageChunks);
        onChunkProcessed?.(chunkContent, chunkIndex);

        // Yield control to prevent UI blocking (not every loop)
        if ((chunkIndex + 1) % 2 === 0) {
          await this.yieldToMainThread();
        }
      }

      const endTime = performance.now();
      const processedContent = contentChunks.join('');
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
    const contentChunks: string[] = [];
    let currentMemoryUsage = 0;

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const start = chunkIndex * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      
      const chunk = file.slice(start, end);
      const chunkText = await this.readChunkAsText(chunk);
      
      contentChunks.push(chunkText);
      currentMemoryUsage += chunkText.length * 2;
      
      // Progress notification
      const progress = ((chunkIndex + 1) / totalChunks) * 100;
      onProgress?.(progress, chunkIndex + 1, totalChunks);
      onChunkProcessed?.(chunkText, chunkIndex);

      if ((chunkIndex + 1) % 4 === 0) {
        await this.yieldToMainThread();
      }
    }

    const endTime = performance.now();
    const processedContent = contentChunks.join('');
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
    const pdf = await (pdfjsLib as any).getDocument({ data: arrayBuffer, disableAutoFetch: true }).promise;
    
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
      
      if ((chunkIndex + 1) % 4 === 0) {
        await this.yieldToMainThread();
      }
    }
  }

  private static async processPdfPageRange(
    pdf: any,
    startPage: number,
    endPage: number
  ): Promise<string> {
    const pagePromises: Promise<string>[] = [];

    for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
      pagePromises.push((async () => {
        try {
          const page = await pdf.getPage(pageNum);
          const textContent = await page.getTextContent();
          const pageText = textContent.items
            .map((item: { str: string }) => item.str)
            .join(' ');
          return `\n\n--- Page ${pageNum} ---\n${pageText}`;
        } catch (error) {
          console.warn(`Failed to process page ${pageNum}:`, error);
          return `\n\n--- Page ${pageNum} (Error) ---\n[Content could not be extracted]`;
        }
      })());
    }

    const results = await Promise.all(pagePromises);
    return results.join('');
  }

  private static async readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
    // Use modern API for better performance
    return file.arrayBuffer();
  }

  private static async readChunkAsText(chunk: Blob): Promise<string> {
    // Avoid FileReader overhead by using async blob APIs
    const buffer = await chunk.arrayBuffer();
    return new TextDecoder('utf-8').decode(buffer);
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