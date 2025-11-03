import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Upload, ZoomIn, ZoomOut, RotateCw, Download, Search, FileText, Maximize2, Minimize2 } from 'lucide-react';
// Use pdfjs-dist directly instead of react-pdf re-export
import * as pdfjsLib from 'pdfjs-dist';
import '../utils/pdfWorkerConfig'; // Auto-configures PDF.js worker

interface PdfJsViewerProps {
  onTextExtracted?: (text: string) => void;
}

const PdfJsViewer: React.FC<PdfJsViewerProps> = ({ onTextExtracted }) => {
  const [file, setFile] = useState<File | null>(null);
  const [pdfDocument, setPdfDocument] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [scale, setScale] = useState<number>(1.0);
  const [rotation, setRotation] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [searchResults, setSearchResults] = useState<Array<{page: number; text: string; context: string}>>([]);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [extractedText, setExtractedText] = useState<string>('');
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const onFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile && selectedFile.type === 'application/pdf') {
      setFile(selectedFile);
      setError('');
      setExtractedText('');
      setSearchResults([]);
      setSearchTerm('');
      loadPdf(selectedFile);
    } else {
      setError('Please select a valid PDF file');
    }
  }, []);

  const loadPdf = useCallback(async (file: File) => {
    setIsLoading(true);
    setError('');
    
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      
      setPdfDocument(pdf);
      setTotalPages(pdf.numPages);
      setCurrentPage(1);
      setScale(1.0);
      setRotation(0);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load PDF';
      setError(`Failed to load PDF: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const renderPage = useCallback(async (pageNumber: number) => {
    if (!pdfDocument || !canvasRef.current) return;

    try {
      const page = await pdfDocument.getPage(pageNumber);
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      
      if (!context) return;

      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale, rotation });
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.width = Math.floor(viewport.width * dpr);
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.scale(dpr, dpr);

      const renderContext = {
        canvasContext: context,
        viewport: viewport,
        canvas: canvas,
      };

      await page.render(renderContext).promise;
    } catch (error) {
      console.error('Error rendering page:', error);
      setError('Failed to render page');
    }
  }, [pdfDocument, scale, rotation]);

  const extractAllText = useCallback(async () => {
    if (!pdfDocument) return;

    setIsExtracting(true);
    setError('');
    
    try {
      let fullText = '';
      
      for (let i = 1; i <= pdfDocument.numPages; i++) {
        const page = await pdfDocument.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .filter((item: any): item is { str: string } => 'str' in item)
          .map((item: { str: string }) => item.str)
          .join(' ');
        fullText += `Page ${i}:\n${pageText}\n\n`;
      }

      setExtractedText(fullText);
      onTextExtracted?.(fullText);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Text extraction failed';
      setError(`Text extraction failed: ${errorMessage}`);
    } finally {
      setIsExtracting(false);
    }
  }, [pdfDocument, onTextExtracted]);

  const searchInPdf = useCallback(async () => {
    if (!pdfDocument || !searchTerm.trim()) return;

    try {
      const results: Array<{page: number; text: string; context: string}> = [];
      
      for (let i = 1; i <= pdfDocument.numPages; i++) {
        const page = await pdfDocument.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .filter((item: any): item is { str: string } => 'str' in item)
          .map((item: { str: string }) => item.str)
          .join(' ');
        
        const regex = new RegExp(searchTerm, 'gi');
        const matches = [...pageText.matchAll(regex)];
        
        matches.forEach((match) => {
          results.push({
            page: i,
            text: match[0],
            context: pageText.substring(
              Math.max(0, match.index! - 50),
              Math.min(pageText.length, match.index! + match[0].length + 50)
            )
          });
        });
      }
      
      setSearchResults(results);
    } catch (error) {
      console.error('Search error:', error);
      setError('Search failed');
    }
  }, [pdfDocument, searchTerm]);

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

  const goToPage = (pageNumber: number) => {
    if (pageNumber >= 1 && pageNumber <= totalPages) {
      setCurrentPage(pageNumber);
    }
  };

    const clampScale = (s: number) => Math.min(Math.max(s, 0.5), 4.0);
  const zoomIn = () => setScale(prev => clampScale(prev * 1.2));
  const zoomOut = () => setScale(prev => clampScale(prev / 1.2));
  const rotate = () => setRotation(prev => (prev + 90) % 360);
  

  // Fit-to-width and fit-to-page helpers
  const fitWidth = useCallback(async () => {
    if (!pdfDocument || !containerRef.current) return;
    const page = await pdfDocument.getPage(currentPage);
    const viewport = page.getViewport({ scale: 1, rotation });
    const containerWidth = containerRef.current!.clientWidth - 24; // account for padding/scrollbar
    const newScale = containerWidth / viewport.width;
    setScale(clampScale(newScale));
  }, [pdfDocument, currentPage, rotation]);

  const fitPage = useCallback(async () => {
    if (!pdfDocument || !containerRef.current) return;
    const page = await pdfDocument.getPage(currentPage);
    const viewport = page.getViewport({ scale: 1, rotation });
    const container = containerRef.current!;
    const containerWidth = container.clientWidth - 24;
    const containerHeight = (isFullscreen ? window.innerHeight : container.clientHeight) - 24;
    const scaleX = containerWidth / viewport.width;
    const scaleY = containerHeight / viewport.height;
    const newScale = Math.min(scaleX, scaleY);
    setScale(clampScale(newScale));
  }, [pdfDocument, currentPage, rotation, isFullscreen]);

  // Ctrl/Meta + wheel zoom with scroll position preservation
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!pdfDocument) return;
      if (!(e.ctrlKey || e.metaKey)) return; // avoid hijacking normal scroll
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const prevScale = scale;
      const newScale = clampScale(prevScale * factor);
      const prevLeftRatio = el.scrollLeft / Math.max(1, el.scrollWidth - el.clientWidth);
      const prevTopRatio = el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight);
      setScale(newScale);
      Promise.resolve().then(() => {
        el.scrollLeft = prevLeftRatio * Math.max(1, el.scrollWidth - el.clientWidth);
        el.scrollTop = prevTopRatio * Math.max(1, el.scrollHeight - el.clientHeight);
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel as any);
  }, [pdfDocument, scale]);

  // Keyboard shortcuts: + (zoom in), - (zoom out), 0 (reset), f (fit width)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!pdfDocument) return;

      const active = document.activeElement as HTMLElement | null;
      const isTyping = active && (
        active.tagName === 'INPUT' ||
        active.tagName === 'TEXTAREA' ||
        (active as HTMLElement).isContentEditable
      );
      if (isTyping) return;

      const key = e.key;
      if (key === '+' || key === '=') {
        e.preventDefault();
        zoomIn();
      } else if (key === '-') {
        e.preventDefault();
        zoomOut();
      } else if (key === '0') {
        e.preventDefault();
        setScale(1.0);
      } else if (key.toLowerCase() === 'f') {
        e.preventDefault();
        fitWidth();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pdfDocument, zoomIn, zoomOut, fitWidth]);

  // Re-render page when dependencies change
  useEffect(() => {
    if (pdfDocument && currentPage) {
      renderPage(currentPage);
    }
  }, [pdfDocument, currentPage, scale, rotation, renderPage]);

  return (
    <div className={`w-full mx-auto p-6 bg-white rounded-lg shadow-lg ${
      isFullscreen ? 'fixed inset-0 z-50 max-w-none' : 'max-w-6xl'
    }`}>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-4 flex items-center gap-2">
          <FileText className="w-6 h-6" />
          PDF.js Advanced Viewer
        </h2>
        
        <div className="flex flex-col lg:flex-row gap-4 items-start">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Upload PDF File
            </label>
            <div className="flex items-center gap-2">
              <input
                type="file"
                accept=".pdf"
                onChange={onFileChange}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100"
              />
              <Upload className="w-5 h-5 text-gray-400" />
            </div>
          </div>
          
          {pdfDocument && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={extractAllText}
                disabled={isExtracting}
                className="px-3 py-2 bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50 flex items-center gap-2 text-sm"
              >
                <FileText className="w-4 h-4" />
                {isExtracting ? 'Extracting...' : 'Extract Text'}
              </button>
              
              <button
                onClick={toggleFullscreen}
                className="px-3 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 flex items-center gap-2 text-sm"
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                {isFullscreen ? 'Exit' : 'Fullscreen'}
              </button>
            </div>
          )}
        </div>
        
        {/* Search Bar */}
        {pdfDocument && (
          <div className="mt-4 flex gap-2">
            <input
              type="text"
              placeholder="Search in PDF..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && searchInPdf()}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <button
              onClick={searchInPdf}
              className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 flex items-center gap-2"
            >
              <Search className="w-4 h-4" />
              Search
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {isLoading && (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading PDF...</p>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        {/* PDF Viewer */}
        {pdfDocument && (
          <div className="xl:col-span-3 space-y-4">
            {/* Controls */}
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage <= 1}
                  className="px-3 py-1 bg-purple-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max={Number.isFinite(totalPages) && totalPages > 0 ? totalPages : 1}
                    value={Number.isFinite(currentPage) ? currentPage : 1}
                    onChange={(e) => goToPage(parseInt(e.target.value) || 1)}
                    className="w-16 px-2 py-1 border border-gray-300 rounded text-center"
                  />
                  <span className="text-sm text-gray-600">of {totalPages}</span>
                </div>
                
                <button
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage >= totalPages}
                  className="px-3 py-1 bg-purple-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
              
              <div className="flex items-center gap-2">
                <button
                  onClick={zoomOut}
                  className="p-2 bg-gray-600 text-white rounded hover:bg-gray-700"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                
                <span className="text-sm text-gray-600 min-w-16 text-center">
                  {Math.round(scale * 100)}%
                </span>
                
                                <button
                  onClick={zoomIn}
                  className="p-2 bg-gray-600 text-white rounded hover:bg-gray-700"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>

                <button
                  onClick={fitWidth}
                  className="px-3 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 text-sm"
                >
                  Fit Width
                </button>

                <button
                  onClick={fitPage}
                  className="px-3 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 text-sm"
                >
                  Fit Page
                </button>

                <button
                  onClick={rotate}
                  className="p-2 bg-gray-600 text-white rounded hover:bg-gray-700"
                >
                  <RotateCw className="w-4 h-4" />
                </button>
              </div>
            </div>
            
            {/* Canvas */}
            <div 
              ref={containerRef}
              className="border border-gray-300 rounded-lg overflow-auto bg-gray-100 flex justify-center items-start"
              style={{ height: isFullscreen ? 'calc(100vh - 200px)' : '600px' }}
            >
              <canvas
                ref={canvasRef}
                className="shadow-lg max-w-full h-auto"
              />
            </div>
          </div>
        )}

        {/* Sidebar */}
        <div className="xl:col-span-1 space-y-4">
          {/* Search Results */}
          {searchResults.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-gray-800">Search Results</h3>
              <div className="max-h-64 overflow-y-auto space-y-2">
                {searchResults.map((result, index) => (
                  <div
                    key={index}
                    className="p-3 bg-yellow-50 border border-yellow-200 rounded cursor-pointer hover:bg-yellow-100"
                    onClick={() => goToPage(result.page)}
                  >
                    <div className="text-sm font-medium text-gray-800">
                      Page {result.page}
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      ...{result.context}...
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Extracted Text */}
          {extractedText && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-800">Extracted Text</h3>
                <button
                  onClick={downloadText}
                  className="px-2 py-1 bg-brand-600 text-white rounded hover:bg-brand-700 flex items-center gap-1 text-sm"
                >
                  <Download className="w-3 h-3" />
                  Download
                </button>
              </div>
              
              <div className="border border-gray-300 rounded-lg p-3 bg-gray-50 max-h-64 overflow-y-auto">
                <pre className="whitespace-pre-wrap text-xs text-gray-700 font-mono">
                  {extractedText.substring(0, 1000)}
                  {extractedText.length > 1000 && '\n\n... (truncated)'}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>

      {!file && (
        <div className="text-center py-12 text-gray-500">
          <FileText className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-lg">Upload a PDF file to get started</p>
          <p className="text-sm">Advanced PDF viewer with search, zoom, and text extraction</p>
        </div>
      )}
    </div>
  );
};

export default PdfJsViewer;

