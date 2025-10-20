import React, { useState, useCallback } from 'react';
import { Upload, Server, Download, AlertCircle, CheckCircle } from 'lucide-react';

interface ProcessingResult {
  text: string;
  metadata: {
    pages: number;
    title?: string;
    author?: string;
    subject?: string;
    creator?: string;
    producer?: string;
    creationDate?: string;
    modificationDate?: string;
  };
  processingTime: number;
}

interface ServerPdfProcessorProps {
  onTextExtracted?: (text: string, metadata?: Record<string, unknown>) => void;
  serverEndpoint?: string;
}

const ServerPdfProcessor: React.FC<ServerPdfProcessorProps> = ({ 
  onTextExtracted,
  serverEndpoint = '/api/pdf/process'
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const [error, setError] = useState<string>('');
  const [uploadProgress, setUploadProgress] = useState<number>(0);

  const onFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile && selectedFile.type === 'application/pdf') {
      setFile(selectedFile);
      setError('');
      setResult(null);
      setUploadProgress(0);
    } else {
      setError('Please select a valid PDF file');
    }
  }, []);

  const processOnServer = useCallback(async () => {
    if (!file) return;

    setIsProcessing(true);
    setError('');
    setUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append('pdf', file);
      formData.append('options', JSON.stringify({
        extractText: true,
        extractMetadata: true,
        preserveFormatting: true,
        includeImages: false
      }));

      const xhr = new XMLHttpRequest();
      
      // Track upload progress
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100);
          setUploadProgress(progress);
        }
      });

      const response = await new Promise<Response>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(new Response(xhr.response, {
              status: xhr.status,
              statusText: xhr.statusText,
              headers: new Headers({
                'Content-Type': xhr.getResponseHeader('Content-Type') || 'application/json'
              })
            }));
          } else {
            reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
          }
        };
        
        xhr.onerror = () => reject(new Error('Network error occurred'));
        xhr.open('POST', serverEndpoint);
        xhr.send(formData);
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status} ${response.statusText}`);
      }

      const processingResult: ProcessingResult = await response.json();
      setResult(processingResult);
      onTextExtracted?.(processingResult.text, processingResult.metadata);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      
      // Handle common server-side processing errors
      if (errorMessage.includes('404')) {
        setError('Server endpoint not found. Please ensure the PDF processing server is running.');
      } else if (errorMessage.includes('413')) {
        setError('File too large. Please try a smaller PDF file.');
      } else if (errorMessage.includes('Network error')) {
        setError('Network error. Please check your connection and try again.');
      } else {
        setError(`Processing failed: ${errorMessage}`);
      }
    } finally {
      setIsProcessing(false);
      setUploadProgress(0);
    }
  }, [file, serverEndpoint, onTextExtracted]);

  const downloadText = useCallback(() => {
    if (!result?.text) return;

    const blob = new Blob([result.text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${file?.name?.replace('.pdf', '') || 'processed'}_text.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [result?.text, file?.name]);

  const downloadMetadata = useCallback(() => {
    if (!result?.metadata) return;

    const blob = new Blob([JSON.stringify(result.metadata, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${file?.name?.replace('.pdf', '') || 'processed'}_metadata.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [result?.metadata, file?.name]);

  return (
    <div className="w-full max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-lg">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-4 flex items-center gap-2">
          <Server className="w-6 h-6" />
          Server-Side PDF Processor
        </h2>
        
        <div className="bg-brand-50 border border-brand-200 rounded-md p-4 mb-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-brand-600 mt-0.5" />
            <div className="text-sm text-brand-800">
              <p className="font-medium">Server-Side Processing Benefits:</p>
              <ul className="mt-1 list-disc list-inside space-y-1">
                <li>Handles large and complex PDF documents</li>
                <li>Advanced text extraction with formatting preservation</li>
                <li>Metadata extraction (title, author, creation date, etc.)</li>
                <li>Better performance for resource-intensive operations</li>
                <li>Support for password-protected PDFs</li>
              </ul>
            </div>
          </div>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-4 items-start">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Upload PDF File for Server Processing
            </label>
            <div className="flex items-center gap-2">
              <input
                type="file"
                accept=".pdf"
                onChange={onFileChange}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-brand-50 file:text-brand-700 hover:file:bg-brand-100"
              />
              <Upload className="w-5 h-5 text-gray-400" />
            </div>
          </div>
          
          {file && (
            <button
              onClick={processOnServer}
              disabled={isProcessing}
              className="px-6 py-2 bg-brand-600 text-white rounded-md hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Server className="w-4 h-4" />
              {isProcessing ? 'Processing...' : 'Process on Server'}
            </button>
          )}
        </div>
        
        {/* Upload Progress */}
        {isProcessing && uploadProgress > 0 && (
          <div className="mt-4">
            <div className="flex justify-between text-sm text-gray-600 mb-1">
              <span>Uploading...</span>
              <span>{uploadProgress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-brand-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              ></div>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
            <p className="text-red-700">{error}</p>
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-6">
          {/* Processing Summary */}
          <div className="bg-brand-50 border border-brand-200 rounded-md p-4">
            <div className="flex items-start gap-2">
              <CheckCircle className="w-5 h-5 text-brand-600 mt-0.5" />
              <div className="text-sm text-brand-800">
                <p className="font-medium">Processing Completed Successfully</p>
                <p className="mt-1">
                  Processed {result.metadata.pages} pages in {result.processingTime}ms
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Metadata */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-800">Document Metadata</h3>
                <button
                  onClick={downloadMetadata}
                  className="px-3 py-1 bg-brand-600 text-white rounded hover:bg-brand-700 flex items-center gap-2 text-sm"
                >
                  <Download className="w-4 h-4" />
                  Download JSON
                </button>
              </div>
              
              <div className="border border-gray-300 rounded-lg p-4 bg-gray-50 space-y-2">
                {Object.entries(result.metadata).map(([key, value]) => (
                  <div key={key} className="flex justify-between text-sm">
                    <span className="font-medium text-gray-600 capitalize">
                      {key.replace(/([A-Z])/g, ' $1').trim()}:
                    </span>
                    <span className="text-gray-800 text-right max-w-xs truncate">
                      {value?.toString() || 'N/A'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Extracted Text */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-800">Extracted Text</h3>
                <button
                  onClick={downloadText}
                  className="px-3 py-1 bg-brand-600 text-white rounded hover:bg-brand-700 flex items-center gap-2 text-sm"
                >
                  <Download className="w-4 h-4" />
                  Download
                </button>
              </div>
              
              <div className="border border-gray-300 rounded-lg p-4 bg-gray-50 max-h-96 overflow-y-auto">
                <pre className="whitespace-pre-wrap text-sm text-gray-700 font-mono">
                  {result.text.substring(0, 2000)}
                  {result.text.length > 2000 && '\n\n... (truncated, download full text)'}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {!file && (
        <div className="text-center py-12 text-gray-500">
          <Server className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-lg">Upload a PDF file for server-side processing</p>
          <p className="text-sm">Ideal for large documents and advanced text extraction</p>
        </div>
      )}
    </div>
  );
};

export default ServerPdfProcessor;