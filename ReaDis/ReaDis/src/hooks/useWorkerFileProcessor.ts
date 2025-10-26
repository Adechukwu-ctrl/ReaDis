import { useCallback, useRef, useState } from 'react';
import type { WorkerMessage, WorkerResponse } from '../workers/fileProcessor.worker';

export interface WorkerProcessingResult {
  content: string;
  totalPages?: number;
  images?: string[];
  processingTime: number;
  fileName: string;
}

export interface WorkerProcessingOptions {
  chunkSize?: number;
  maxPages?: number;
  extractImages?: boolean;
  onProgress?: (progress: number, message?: string) => void;
  onChunkProcessed?: (chunkData: unknown) => void;
}

export const useWorkerFileProcessor = () => {
  const workerRef = useRef<Worker | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const pendingRequests = useRef<Map<string, {
    resolve: (result: WorkerProcessingResult) => void;
    reject: (error: Error) => void;
    options?: WorkerProcessingOptions;
  }>>(new Map());

  // Initialize worker
  const initializeWorker = useCallback(() => {
    if (workerRef.current) {
      return workerRef.current;
    }

    try {
      // Create worker from the TypeScript file
      // Note: In production, you might need to build this as a separate bundle
      const workerUrl = new URL('../workers/fileProcessor.worker.ts', import.meta.url);
      workerRef.current = new Worker(workerUrl, { type: 'module' });

      workerRef.current.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const { type, payload, id } = event.data;
        const request = pendingRequests.current.get(id);

        if (!request) {
          console.warn('Received response for unknown request:', id);
          return;
        }

        switch (type) {
          case 'PROGRESS':
            setProgress((payload as any).progress);
            if (request.options?.onProgress) {
              request.options.onProgress((payload as any).progress, (payload as any).message);
            }
            break;

          case 'CHUNK_PROCESSED':
            if (request.options?.onChunkProcessed) {
              request.options.onChunkProcessed(payload);
            }
            break;

          case 'SUCCESS':
            pendingRequests.current.delete(id);
            setIsProcessing(false);
            setProgress(100);
            request.resolve(payload as WorkerProcessingResult);
            break;

          case 'ERROR':
            pendingRequests.current.delete(id);
            setIsProcessing(false);
            setProgress(0);
            request.reject(new Error((payload as any).error || String(payload)));
            break;
        }
      };

      workerRef.current.onerror = (error) => {
        console.error('Worker error:', error);
        setIsProcessing(false);
        setProgress(0);
        
        // Reject all pending requests
        pendingRequests.current.forEach((request) => {
          request.reject(new Error('Worker encountered an error'));
        });
        pendingRequests.current.clear();
      };

      return workerRef.current;
    } catch (error) {
      console.error('Failed to initialize worker:', error);
      throw new Error('Web Worker not supported or failed to initialize');
    }
  }, []);

  // Process PDF file using worker
  const processPdfWithWorker = useCallback(async (
    file: File,
    options: WorkerProcessingOptions = {}
  ): Promise<WorkerProcessingResult> => {
    const worker = initializeWorker();
    const requestId = `pdf-${Date.now()}-${Math.random()}`;
    
    setIsProcessing(true);
    setProgress(0);

    return new Promise((resolve, reject) => {
      pendingRequests.current.set(requestId, { resolve, reject, options });

      // Read file as ArrayBuffer (structured clone friendly)
      file.arrayBuffer()
        .then((arrayBuffer) => {
          // Only pass serializable options to the worker
          const serializableOptions = {
            chunkSize: options.chunkSize,
            maxPages: options.maxPages,
            extractImages: options.extractImages,
          };

          const message: WorkerMessage = {
            type: 'PROCESS_PDF',
            payload: {
              fileData: arrayBuffer,
              fileName: file.name,
              fileSize: file.size,
              options: serializableOptions,
            },
            id: requestId,
          };

          worker.postMessage(message);
        })
        .catch(() => {
          pendingRequests.current.delete(requestId);
          setIsProcessing(false);
          reject(new Error('Failed to read file'));
        });
    });
  }, [initializeWorker]);

  // Process text file using worker
  const processTextWithWorker = useCallback(async (
    file: File,
    options: WorkerProcessingOptions = {}
  ): Promise<WorkerProcessingResult> => {
    const worker = initializeWorker();
    const requestId = `text-${Date.now()}-${Math.random()}`;
    
    setIsProcessing(true);
    setProgress(0);

    return new Promise((resolve, reject) => {
      pendingRequests.current.set(requestId, { resolve, reject, options });

      file.arrayBuffer()
        .then((arrayBuffer) => {
          const message: WorkerMessage = {
            type: 'PROCESS_TEXT',
            payload: {
              fileData: arrayBuffer,
              fileName: file.name,
              fileSize: file.size,
            },
            id: requestId,
          };

          worker.postMessage(message);
        })
        .catch(() => {
          pendingRequests.current.delete(requestId);
          setIsProcessing(false);
          reject(new Error('Failed to read file'));
        });
    });
  }, [initializeWorker]);

  // Check if file should use worker processing
  const shouldUseWorker = useCallback((file: File): boolean => {
    const fileSizeMB = file.size / (1024 * 1024);
    
    // Use worker for files larger than 5MB or when explicitly requested
    return fileSizeMB > 5;
  }, []);

  // Terminate worker
  const terminateWorker = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    
    // Reject all pending requests
    pendingRequests.current.forEach((request) => {
      request.reject(new Error('Worker was terminated'));
    });
    pendingRequests.current.clear();
    
    setIsProcessing(false);
    setProgress(0);
  }, []);

  // Cleanup on unmount
  const cleanup = useCallback(() => {
    terminateWorker();
  }, [terminateWorker]);

  return {
    processPdfWithWorker,
    processTextWithWorker,
    shouldUseWorker,
    isProcessing,
    progress,
    terminateWorker,
    cleanup
  };
};