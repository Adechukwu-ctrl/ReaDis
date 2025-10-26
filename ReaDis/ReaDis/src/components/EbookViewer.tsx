import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
// Removed react-pdf-viewer; use pdfjs-dist directly for compatibility with v5
import * as pdfjs from 'pdfjs-dist';
import { usePdf } from '../context/PdfContext';

import { 
  Play, 
  BookOpen,
  Hash,
  Check,
  X,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Maximize2
} from 'lucide-react';
import { ContentSource } from '../types';
import '../utils/pdfWorkerConfig';

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
  // Use shared PDF context for uploaded files
  const { pdfFile } = usePdf();
  
  const [selectionMode, setSelectionMode] = useState<'page' | 'text'>('page');
  const [currentSelection, setCurrentSelection] = useState<SelectionRange | null>(null);
  const [startPage, setStartPage] = useState<number>(1);
  const [endPage, setEndPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  
  const [scale, setScale] = useState<number>(1.0);
  const [rotation, setRotation] = useState<number>(0);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isLoadingDoc, setIsLoadingDoc] = useState<boolean>(false);
  const [viewerError, setViewerError] = useState<string | null>(null);
  
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<any>(null);

  // Compute a valid URL or data source for the viewer
  const viewerUrl = useMemo(() => {
    // Only use contentSource string (data/base64/http) as fallback
    if (contentSource?.fileType === 'application/pdf' && typeof contentSource.fileData === 'string') {
      return contentSource.fileData;
    }
    return '';
  }, [contentSource?.fileData, contentSource?.fileType]);

  // Removed: premature blob URL revocation that caused ERR_FILE_NOT_FOUND
  // useEffect(() => {
  //   return () => {
  //     if (viewerUrl && viewerUrl.startsWith('blob:')) {
  //       try { URL.revokeObjectURL(viewerUrl); } catch {}
  //     }
  //   };
  // }, [viewerUrl]);

  const loadPdfFromFile = useCallback(async (file: File) => {
    try {
      setIsLoadingDoc(true);
      setViewerError(null);
      const buf = await file.arrayBuffer();
      const task = (pdfjs as any).getDocument({ data: buf });
      const pdf = await task.promise;
      setPdfDoc(pdf);
      setTotalPages(pdf.numPages);
      setEndPage(pdf.numPages || 1);
      setCurrentPage(1);
      setIsLoadingDoc(false);
    } catch (err: any) {
      console.error('Failed to load PDF from file:', err);
      setPdfDoc(null);
      setTotalPages(0);
      setViewerError(err?.message || 'Failed to load PDF');
      setIsLoadingDoc(false);
    }
  }, []);

  const loadPdf = useCallback(async (url: string) => {
    try {
      setIsLoadingDoc(true);
      setViewerError(null);
      const res = await fetch(url);
      const buf = await res.arrayBuffer();
      const task = (pdfjs as any).getDocument({ data: buf });
      const pdf = await task.promise;
      setPdfDoc(pdf);
      setTotalPages(pdf.numPages);
      setEndPage(pdf.numPages || 1);
      setCurrentPage(1);
      setIsLoadingDoc(false);
    } catch (err: any) {
      console.error('Failed to load PDF:', err);
      setPdfDoc(null);
      setTotalPages(0);
      setViewerError(err?.message || 'Failed to load PDF');
      setIsLoadingDoc(false);
    }
  }, []);

  useEffect(() => {
    if (!isVisible) return;

    // Prefer File from context to avoid blob URL fetch issues
    if (pdfFile && pdfFile instanceof File && pdfFile.type === 'application/pdf') {
      loadPdfFromFile(pdfFile);
      return;
    }

    if (!viewerUrl) {
      setPdfDoc(null);
      setTotalPages(0);
      setIsLoadingDoc(false);
      setViewerError(null);
      return;
    }

    loadPdf(viewerUrl);
    return () => {
      // no-op cleanup; rendering effect handles canvas
    };
  }, [viewerUrl, isVisible, loadPdf, loadPdfFromFile, pdfFile]);

  const renderPage = useCallback(async (pageNumber: number) => {
    if (!pdfDoc || !canvasRef.current) return;
    // Clamp page number to valid range
    const safePage = Math.max(1, Math.min(pageNumber, totalPages || 1));
    // Cancel any in-flight render before starting a new one
    const existing = renderTaskRef.current;
    if (existing && typeof existing.cancel === 'function') {
      try { existing.cancel(); } catch {}
      // Ensure previous render fully settles before reusing the same canvas
      try { await existing.promise; } catch (_) {}
      renderTaskRef.current = null;
    }
    try {
      const page = await pdfDoc.getPage(safePage);
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const viewport = page.getViewport({ scale, rotation });
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const task = page.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = task;
      await task.promise;
      renderTaskRef.current = null;
      setViewerError(null);
    } catch (err: any) {
      // Ignore benign cancellations
      if (err?.name === 'RenderingCancelledException' || /Rendering cancelled/i.test(err?.message || '')) {
        renderTaskRef.current = null;
        return;
      }
      console.error('Failed to render page:', err);
      setViewerError(err?.message || 'Failed to render page');
      renderTaskRef.current = null;
    }
  }, [pdfDoc, scale, rotation, totalPages]);

  useEffect(() => {
    if (pdfDoc && currentPage) {
      renderPage(currentPage);
    }
  }, [pdfDoc, currentPage, scale, rotation, renderPage]);

  // Handle external selection change (sync navigation)
  useEffect(() => {
    if (externalSelection && externalSelection !== currentSelection) {
      setCurrentSelection(externalSelection);
      if (externalSelection) {
        setCurrentPage(externalSelection.startPage);
      }
    }
  }, [externalSelection, currentSelection]);

  // Handle zoom in/out
  const handleZoom = (direction: 'in' | 'out') => {
    setScale(prev => {
      const newScale = direction === 'in' ? prev * 1.2 : prev / 1.2;
      return Math.max(0.5, Math.min(2.5, newScale));
    });
  };

  const handleRotate = () => setRotation(prev => (prev + 90) % 360);

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

        {viewerError && (
          <div className="mt-3 px-3 py-2 bg-red-50 text-red-700 text-sm border border-red-200 rounded">{viewerError}</div>
        )}
        {isLoadingDoc && (
          <div className="mt-3 px-3 py-2 bg-brand-50 text-brand-700 text-sm border border-brand-200 rounded">Loading PDF…</div>
        )}

        {contentSource && (
          <>
            <div className="mt-4 flex flex-wrap gap-2">
              {/* Zoom Controls */}
              <div className="flex items-center space-x-2">
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
                <button
                  onClick={handleRotate}
                  className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                >
                  <RotateCw className="h-4 w-4" />
                </button>
                <span className="text-sm text-gray-500">{Math.round(scale * 100)}%</span>
              </div>

              {/* Selection Controls */}
              <div className="mt-4 p-3 bg-brand-50 rounded-lg w-full">
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
                        setCurrentPage(safeStart);
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
            </div>
          </>
        )}
      </div>

      {/* PDF Canvas Viewer */}
      {isVisible && viewerUrl ? (
        <div className="h-96" ref={containerRef}>
          <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                className="px-2 py-1 bg-brand-600 text-white text-xs rounded disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={currentPage <= 1}
              >
                Prev
              </button>
              <span className="text-xs text-gray-600">
                Page {currentPage} / {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                className="px-2 py-1 bg-brand-600 text-white text-xs rounded disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={currentPage >= totalPages}
              >
                Next
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => handleZoom('out')} className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded">
                <ZoomOut className="h-4 w-4" />
              </button>
              <span className="text-sm text-gray-600 min-w-12 text-center">{Math.round(scale * 100)}%</span>
              <button onClick={() => handleZoom('in')} className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded">
                <ZoomIn className="h-4 w-4" />
              </button>
              <button onClick={handleRotate} className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded">
                <RotateCw className="h-4 w-4" />
              </button>
            </div>
          </div>
          {isLoadingDoc && (
            <div className="px-3 py-2 bg-brand-50 text-brand-700 text-xs border-b border-brand-200">Loading PDF…</div>
          )}
          <div className="border border-gray-300 rounded-lg overflow-auto bg-gray-100 flex justify-center items-start" style={{ height: isFullscreen ? 'calc(100vh - 200px)' : '600px' }}>
            <canvas ref={canvasRef} className="shadow-lg max-w-full h-auto" />
          </div>
        </div>
      ) : isVisible ? (
        <div className="h-32 flex items-center justify-center text-gray-600 border rounded bg-gray-50">
          <span>Load a PDF to preview pages. Non-PDF content is shown in the text panel.</span>
        </div>
      ) : null}
    </div>
  );
};