import React, { useState, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { Upload, FileText, Download, Eye, EyeOff } from 'lucide-react';
import '../utils/pdfWorkerConfig'; // Auto-configures PDF.js worker

// Override react-pdf's worker configuration to match our main pdfjs-dist version
pdfjs.GlobalWorkerOptions.workerSrc = new URL('react-pdf/node_modules/pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

interface ReactPdfViewerProps {
  onTextExtracted?: (text: string) => void;
}

const ReactPdfViewer: React.FC<ReactPdfViewerProps> = ({ onTextExtracted }) => {
  const [file, setFile] = useState<File | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [extractedText, setExtractedText] = useState<string>('');
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [showViewer, setShowViewer] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  const onFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile && selectedFile.type === 'application/pdf') {
      setFile(selectedFile);
      setError('');
      setExtractedText('');
      setPageNumber(1);
    } else {
      setError('Please select a valid PDF file');
    }
  }, []);

  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setError('');
  }, []);

  const onDocumentLoadError = useCallback((error: Error) => {
    setError(`Failed to load PDF: ${error.message}`);
  }, []);

  const extractTextFromAllPages = useCallback(async () => {
    if (!file) return;

    setIsExtracting(true);
    setError('');
    
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      let fullText = '';

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .filter((item): item is TextItem => 'str' in item && typeof (item as TextItem).str === 'string')
          .map((item) => item.str)
          .join(' ');
        fullText += `Page ${i}:\n${pageText}\n\n`;
      }

      setExtractedText(fullText);
      onTextExtracted?.(fullText);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setError(`Text extraction failed: ${errorMessage}`);
    } finally {
      setIsExtracting(false);
    }
  }, [file, onTextExtracted]);

  const downloadText = useCallback(() => {
    if (!extractedText) return;

    const blob = new Blob([extractedText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${file?.name?.replace('.pdf', '') || 'extracted'}_text.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [extractedText, file?.name]);

  const goToPrevPage = () => setPageNumber(prev => Math.max(prev - 1, 1));
  const goToNextPage = () => setPageNumber(prev => Math.min(prev + 1, numPages));

  return (
    <div className="w-full max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-lg">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-4 flex items-center gap-2">
          <FileText className="w-6 h-6" />
          React PDF Viewer
        </h2>
        
        <div className="flex flex-col sm:flex-row gap-4 items-start">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Upload PDF File
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
            <div className="flex gap-2">
              <button
                onClick={extractTextFromAllPages}
                disabled={isExtracting}
                className="px-4 py-2 bg-brand-600 text-white rounded-md hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <FileText className="w-4 h-4" />
                {isExtracting ? 'Extracting...' : 'Extract Text'}
              </button>
              
              <button
                onClick={() => setShowViewer(!showViewer)}
                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 flex items-center gap-2"
              >
                {showViewer ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                {showViewer ? 'Hide' : 'Show'} PDF
              </button>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* PDF Viewer */}
        {file && showViewer && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-800">PDF Preview</h3>
              {numPages > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={goToPrevPage}
                    disabled={pageNumber <= 1}
                    className="px-3 py-1 bg-brand-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-gray-600">
                    Page {pageNumber} of {numPages}
                  </span>
                  <button
                    onClick={goToNextPage}
                    disabled={pageNumber >= numPages}
                    className="px-3 py-1 bg-brand-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
            
            <div className="border border-gray-300 rounded-lg overflow-hidden">
              <Document
                file={file}
                onLoadSuccess={onDocumentLoadSuccess}
                onLoadError={onDocumentLoadError}
                className="flex justify-center"
              >
                <Page
                  pageNumber={pageNumber}
                  width={400}
                  className="shadow-lg"
                />
              </Document>
            </div>
          </div>
        )}

        {/* Extracted Text */}
        {extractedText && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-800">Extracted Text</h3>
              <button
                onClick={downloadText}
                className="px-3 py-1 bg-brand-600 text-white rounded hover:bg-brand-700 flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Download
              </button>
            </div>
            
            <div className="border border-gray-300 rounded-lg p-4 bg-gray-50 max-h-96 overflow-y-auto">
              <pre className="whitespace-pre-wrap text-sm text-gray-700 font-mono">
                {extractedText}
              </pre>
            </div>
          </div>
        )}
      </div>

      {!file && (
        <div className="text-center py-12 text-gray-500">
          <FileText className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-lg">Upload a PDF file to get started</p>
          <p className="text-sm">Supports PDF viewing and text extraction</p>
        </div>
      )}
    </div>
  );
};

export default ReactPdfViewer;