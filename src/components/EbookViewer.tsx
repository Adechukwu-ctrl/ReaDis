import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { pdfjs } from 'react-pdf';
import { Viewer, Worker } from '@react-pdf-viewer/core';
import { defaultLayoutPlugin } from '@react-pdf-viewer/default-layout';
import { selectionModePlugin } from '@react-pdf-viewer/selection-mode';
import { pageNavigationPlugin } from '@react-pdf-viewer/page-navigation';
import { highlightPlugin, RenderHighlightTargetProps } from '@react-pdf-viewer/highlight';
import { usePdf } from '../context/PdfContext';

import { 
  Play, 
  BookOpen,
  MousePointer,
  Hash,
  Check,
  X,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Download,
  Maximize2
} from 'lucide-react';
import { ContentSource } from '../types';
import '../utils/pdfWorkerConfig';

// Import CSS for react-pdf-viewer
import '@react-pdf-viewer/core/lib/styles/index.css';
import '@react-pdf-viewer/default-layout/lib/styles/index.css';
import '@react-pdf-viewer/selection-mode/lib/styles/index.css';
import '@react-pdf-viewer/page-navigation/lib/styles/index.css';
import '@react-pdf-viewer/highlight/lib/styles/index.css';

// Configure PDF.js worker - using CDN for reliability
pdfjs.GlobalWorkerOptions.workerSrc = '//cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

interface SelectionRange {
  startPage: number;
  endPage: number;
  startText?: string;
  endText?: string;
  selectedText?: string;
  currentReadingPage?: number;
}

interface EbookViewerProps {
  contentSource: ContentSource | null;
  isVisible: boolean;
  onToggleVisibility: () => void;
  onSelectionChange?: (selection: SelectionRange | null) => void;
  onStartReading?: (selection: SelectionRange) => void;
  currentSelection?: SelectionRange | null;
}

export const EbookViewer: React.FC<EbookViewerProps> = ({
  contentSource,
  isVisible,
  onToggleVisibility,
  onSelectionChange,
  onStartReading,
  currentSelection: externalSelection,
}) => {
  // Use shared PDF context
  const { pdfFile } = usePdf();
  
  const [selectionMode, setSelectionMode] = useState<'page' | 'text'>('page');
  const [currentSelection, setCurrentSelection] = useState<SelectionRange | null>(null);
  const [startPage, setStartPage] = useState<number>(1);
  const [endPage, setEndPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [highlights, setHighlights] = useState<RenderHighlightTargetProps[]>([]);

  
  // Additional state for all content types
  const [scale, setScale] = useState<number>(1.0);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  
  const viewerRef = useRef<HTMLDivElement>(null);

  // Create plugins with page change handler
  const pageNavigationPluginInstance = pageNavigationPlugin();
  const { jumpToPage } = pageNavigationPluginInstance;
  
  // Create highlight plugin with current reading position highlighting
  const highlightPluginInstance = highlightPlugin();
  
  // Create default layout plugin
  const defaultLayoutPluginInstance = defaultLayoutPlugin();
  
  // Create selection mode plugin
  const selectionModePluginInstance = selectionModePlugin();

  // Compute a valid URL or data source for the viewer
  const viewerUrl = useMemo(() => {
    // Prefer File from context if available
    if (pdfFile && pdfFile instanceof File && pdfFile.type === 'application/pdf') {
      try {
        return URL.createObjectURL(pdfFile);
      } catch {
        return '';
      }
    }
    // Fallback to base64/data URL from contentSource for PDFs
    if (contentSource?.fileType === 'application/pdf' && typeof contentSource.fileData === 'string') {
      return contentSource.fileData;
    }
    return '';
  }, [pdfFile, contentSource?.fileData, contentSource?.fileType]);

  // Cleanup blob URLs when they change or on unmount
  useEffect(() => {
    return () => {
      if (viewerUrl && viewerUrl.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(viewerUrl);
        } catch {
          // ignore
        }
      }
    };
  }, [viewerUrl]);

  // Handle document load
  const handleDocumentLoad = useCallback((e: any) => {
    const numPages = (e && e.doc && typeof e.doc.numPages === 'number')
      ? e.doc.numPages
      : (typeof e?.numPages === 'number' ? e.numPages : 0);
    setTotalPages(numPages);
    setEndPage(numPages > 0 ? numPages : 1);
  }, []);

  // Handle selection change
  useEffect(() => {
    if (externalSelection && externalSelection !== currentSelection) {
      setCurrentSelection(externalSelection);
      
      if (externalSelection) {
        jumpToPage(externalSelection.startPage - 1);
        setCurrentPage(externalSelection.startPage);
      }
    }
  }, [externalSelection, currentSelection, jumpToPage]);

  // Handle zoom in/out
  const handleZoom = (direction: 'in' | 'out') => {
    setScale(prev => {
      const newScale = direction === 'in' ? prev * 1.2 : prev / 1.2;
      return Math.max(0.5, Math.min(2.5, newScale));
    });
  };

  // Handle fullscreen toggle
  const toggleFullscreen = () => {
    setIsFullscreen(prev => !prev);
  };

  // Handle start reading
  const handleStartReading = () => {
    const validStart = Number.isFinite(startPage) && startPage > 0 ? startPage : 1;
    const validEnd = Number.isFinite(endPage) && endPage >= validStart ? endPage : validStart;
    const selection = { startPage: validStart, endPage: validEnd, currentReadingPage: validStart };
    onSelectionChange?.(selection);
    onStartReading?.(selection);
  };

  // Reset selection
  const resetSelection = () => {
    setCurrentSelection(null);
    setCurrentPage(startPage);
    onSelectionChange?.(null);
  };

  return (
    <div className={`bg-white rounded-xl shadow-lg overflow-hidden transition-all duration-300 ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}>
      <div className="p-4 border-b">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold text-gray-900">
            <BookOpen className="inline-block mr-2 h-5 w-5" />
            Document Viewer
          </h3>
          <div className="flex space-x-2">
            <button
              onClick={toggleFullscreen}
              className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
            >
              <Maximize2 className="h-5 w-5" />
            </button>
            <button
              onClick={onToggleVisibility}
              className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {contentSource && (
          <>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => handleZoom('out')}
                className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <button
                onClick={() => handleZoom('in')}
                className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
              <span className="text-sm text-gray-500">{Math.round(scale * 100)}%</span>
            </div>

            {/* Selection Controls */}
            <div className="mt-4 p-3 bg-brand-50 rounded-lg">
              <div className="flex items-center mb-2">
                <Hash className="h-4 w-4 text-brand-600 mr-1" />
                <span className="text-sm font-medium text-brand-700">Select Pages to Read</span>
              </div>
              
              <div className="flex items-center space-x-2 mb-3">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Start Page</label>
                  <input
                    type="number"
                    min={1}
                    value={startPage}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      const safeTotal = Math.max(1, totalPages);
                      const safeEnd = Math.min(endPage, safeTotal);
                      const safeStart = Math.max(1, Math.min(Number.isFinite(val) ? val : 1, safeEnd));
                      setStartPage(safeStart);
                      setEndPage(Math.max(safeStart, safeEnd));
                    }}
                    className="w-full p-1 text-sm border rounded"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">End Page</label>
                  <input
                    type="number"
                    min={1}
                    value={endPage}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      const safeTotal = Math.max(1, totalPages);
                      const safeStart = Math.max(1, Math.min(startPage, safeTotal));
                      setEndPage(Math.max(safeStart, Math.min(Number.isFinite(val) ? val : safeStart, safeTotal)));
                    }}
                    className="w-full p-1 text-sm border rounded"
                  />
                </div>
              </div>
              
              <div className="flex justify-between">
                <button
                  onClick={resetSelection}
                  className="px-2 py-1 text-xs text-gray-600 border border-gray-300 rounded hover:bg-gray-100"
                >
                  Reset
                </button>
                <button
                  onClick={handleStartReading}
                  disabled={!Number.isFinite(startPage) || !Number.isFinite(endPage) || startPage < 1 || endPage < startPage}
                  className="px-2 py-1 text-xs bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                >
                  <Play className="h-3 w-3 mr-1" />
                  Start Reading
                </button>
              </div>
              
              {/* Current Selection Display */}
              {currentSelection && (
                <div className="mt-3 pt-3 border-t border-brand-200">
                  <div className="flex items-center mb-2">
                    <Check className="h-4 w-4 text-brand-600 mr-1" />
                    <span className="text-xs font-medium text-brand-700">Current Reading Selection</span>
                  </div>
                  <div className="text-xs text-gray-600">
                    Pages {currentSelection.startPage} to {currentSelection.endPage}
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <button
                      onClick={() => setCurrentPage(Math.max(currentSelection.startPage, currentPage - 1))}
                      disabled={currentPage <= currentSelection.startPage}
                      className="px-2 py-1 bg-brand-600 text-white text-xs rounded disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      ← Prev
                    </button>
                    <span className="text-xs text-brand-700">
                      Page {currentPage} of {currentSelection.endPage}
                    </span>
                    <button
                      onClick={() => setCurrentPage(Math.min(currentSelection.endPage, currentPage + 1))}
                      disabled={currentPage >= currentSelection.endPage}
                      className="px-2 py-1 bg-brand-600 text-white text-xs rounded disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next →
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* PDF Viewer */}
      {isVisible && viewerUrl ? (
        <div className="h-96" ref={viewerRef}>
          <Worker workerUrl="https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js">
            <Viewer
              fileUrl={viewerUrl}
              plugins={[defaultLayoutPluginInstance, selectionModePluginInstance, pageNavigationPluginInstance, highlightPluginInstance]}
              onDocumentLoad={handleDocumentLoad}
            />
          </Worker>
        </div>
      ) : isVisible ? (
        <div className="h-32 flex items-center justify-center text-gray-600 border rounded bg-gray-50">
          <span>Load a PDF to preview pages. Non-PDF content is shown in the text panel.</span>
        </div>
      ) : null}
    </div>
  );
};