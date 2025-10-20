import React, { useState, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
// Remove unused import since pdfjs is configured in pdfWorkerConfig.ts
import { 
  ZoomIn, 
  ZoomOut, 
  ChevronLeft, 
  ChevronRight, 
  RotateCw,
  Download,
  Maximize2,
  Eye,
  EyeOff
} from 'lucide-react';
import { ContentSource } from '../types';
import '../utils/pdfWorkerConfig'; // Auto-configures PDF.js worker

// Override react-pdf's worker configuration to match our main pdfjs-dist version
pdfjs.GlobalWorkerOptions.workerSrc = new URL('react-pdf/node_modules/pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

interface DocumentViewerProps {
  contentSource: ContentSource | null;
  isVisible: boolean;
  onToggleVisibility: () => void;
}

export const DocumentViewer: React.FC<DocumentViewerProps> = ({
  contentSource,
  isVisible,
  onToggleVisibility,
}) => {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.0);
  const [rotation, setRotation] = useState<number>(0);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setPageNumber(1);
  }, []);

  const changePage = useCallback((offset: number) => {
    setPageNumber(prevPageNumber => {
      const newPageNumber = prevPageNumber + offset;
      return Math.min(Math.max(1, newPageNumber), numPages);
    });
  }, [numPages]);

  const changeScale = useCallback((delta: number) => {
    setScale(prevScale => Math.min(Math.max(0.5, prevScale + delta), 3.0));
  }, []);

  const rotate = useCallback(() => {
    setRotation(prevRotation => (prevRotation + 90) % 360);
  }, []);

  const downloadFile = useCallback(() => {
    if (!contentSource?.fileData) return;
    
    const link = document.createElement('a');
    link.href = contentSource.fileData;
    link.download = contentSource.filename || 'document';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [contentSource]);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev);
  }, []);

  if (!contentSource) {
    return null;
  }

  const renderWebpageViewer = () => (
    <div className="h-full">
      <iframe
        src={contentSource.url}
        className="w-full h-full border-0 rounded-lg"
        title={contentSource.title}
        sandbox="allow-same-origin allow-scripts"
      />
    </div>
  );

  const renderImageViewer = () => (
    <div className="h-full flex items-center justify-center bg-gray-50 rounded-lg overflow-hidden">
      <img
        src={contentSource.fileData}
        alt={contentSource.title}
        className="max-w-full max-h-full object-contain"
        style={{
          transform: `scale(${scale}) rotate(${rotation}deg)`,
          transition: 'transform 0.2s ease-in-out',
        }}
      />
    </div>
  );

  const renderPDFViewer = () => (
    <div className="h-full flex flex-col bg-gray-50 rounded-lg overflow-hidden">
      <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
        <Document
          file={contentSource.fileData}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={(error) => {
            console.error('PDF load error:', error);
          }}
          className="shadow-lg"
          loading={
            <div className="flex items-center justify-center p-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600"></div>
              <span className="ml-2 text-gray-600">Loading PDF...</span>
            </div>
          }
          error={
            <div className="flex items-center justify-center p-8 text-red-600">
              <span>Failed to load PDF. Please try a different file.</span>
            </div>
          }
        >
          <Page
            pageNumber={pageNumber}
            scale={scale}
            rotate={rotation}
            className="border border-gray-300 bg-white"
            loading={
              <div className="flex items-center justify-center p-4">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-600"></div>
              </div>
            }
            error={
              <div className="flex items-center justify-center p-4 text-red-600">
                <span>Failed to load page</span>
              </div>
            }
          />
        </Document>
      </div>
      
      {/* PDF Navigation */}
      {numPages > 1 && (
        <div className="flex items-center justify-center space-x-4 p-3 bg-white border-t">
          <button
            onClick={() => changePage(-1)}
            disabled={pageNumber <= 1}
            className="p-2 text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          
          <span className="text-sm text-gray-700 min-w-max">
            Page {pageNumber} of {numPages}
          </span>
          
          <button
            onClick={() => changePage(1)}
            disabled={pageNumber >= numPages}
            className="p-2 text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>
  );

  const renderTextViewer = () => (
    <div className="h-full bg-white rounded-lg p-6 overflow-auto">
      <div className="prose max-w-none">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          {contentSource.title}
        </h3>
        <div className="whitespace-pre-wrap text-gray-800 leading-relaxed">
          {contentSource.content}
        </div>
      </div>
    </div>
  );

  const renderViewer = () => {
    switch (contentSource.type) {
      case 'webpage':
        return renderWebpageViewer();
      case 'file':
        if (contentSource.fileType?.startsWith('image/')) {
          return renderImageViewer();
        } else if (contentSource.fileType === 'application/pdf') {
          return renderPDFViewer();
        }
        return renderTextViewer();
      case 'text':
        return renderTextViewer();
      default:
        return renderTextViewer();
    }
  };

  const showControls = contentSource.type === 'file' && 
    (contentSource.fileType?.startsWith('image/') || contentSource.fileType === 'application/pdf');

  return (
    <div className={`bg-white rounded-xl shadow-lg overflow-hidden transition-all duration-300 ${
      isFullscreen ? 'fixed inset-4 z-50' : ''
    }`}>
      {/* Header */}
      <div className="bg-gray-50 px-4 py-3 border-b flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <h3 className="font-medium text-gray-900 truncate">
            {contentSource.title}
          </h3>
          {contentSource.filename && (
            <span className="text-sm text-gray-500">({contentSource.filename})</span>
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          {/* Document Controls */}
          {showControls && (
            <>
              <button
                onClick={() => changeScale(-0.2)}
                className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded"
                title="Zoom Out"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              
              <span className="text-sm text-gray-600 min-w-max">
                {Math.round(scale * 100)}%
              </span>
              
              <button
                onClick={() => changeScale(0.2)}
                className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded"
                title="Zoom In"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
              
              <button
                onClick={rotate}
                className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded"
                title="Rotate"
              >
                <RotateCw className="h-4 w-4" />
              </button>
            </>
          )}
          
          {/* Download Button */}
          {contentSource.fileData && (
            <button
              onClick={downloadFile}
              className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded"
              title="Download"
            >
              <Download className="h-4 w-4" />
            </button>
          )}
          
          {/* Fullscreen Toggle */}
          <button
            onClick={toggleFullscreen}
            className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded"
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          >
            <Maximize2 className="h-4 w-4" />
          </button>
          
          {/* Visibility Toggle */}
          <button
            onClick={onToggleVisibility}
            className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded"
            title={isVisible ? "Hide Document" : "Show Document"}
          >
            {isVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Viewer Content */}
      {isVisible && (
        <div className={`${isFullscreen ? 'h-full' : 'h-96'}`}>
          {renderViewer()}
        </div>
      )}
    </div>
  );
};