import React, { useState, useCallback, useEffect, useRef } from 'react';
import * as pdfjs from 'pdfjs-dist';
import { TextLayerBuilder } from 'pdfjs-dist/web/pdf_viewer';
import 'pdfjs-dist/web/pdf_viewer.css';
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
import { usePdf } from '../context/PdfContext';

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
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [thumbsLoading, setThumbsLoading] = useState<boolean>(false);
  const [isLoadingDoc, setIsLoadingDoc] = useState<boolean>(false);
  const [viewerError, setViewerError] = useState<string | null>(null);

  const pdfDocRef = useRef<any>(null);
  const singleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pagesContainerRef = useRef<HTMLDivElement | null>(null);
  const pageContainersRef = useRef<Record<number, HTMLDivElement | null>>({});
  const pageCanvasRef = useRef<Record<number, HTMLCanvasElement | null>>({});
  const pageTextLayerRef = useRef<Record<number, HTMLDivElement | null>>({});
  const renderedPagesRef = useRef<Set<number>>(new Set());
  const renderTasksRef = useRef<Record<number, any>>({});
  const pageTextCacheRef = useRef<Map<number, any>>(new Map());

  const { pdfFile } = usePdf();
  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setPageNumber(1);
  }, []);

  const changePage = useCallback((offset: number) => {
    setPageNumber(prevPageNumber => {
      const newPageNumber = prevPageNumber + offset;
      const bounded = Math.min(Math.max(1, newPageNumber), numPages);
      // Scroll to the new page in multi-page mode
      const container = pageContainersRef.current[bounded];
      if (container) {
        container.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return bounded;
    });
  }, [numPages]);

  const changeScale = useCallback((delta: number) => {
    setScale(prevScale => Math.min(Math.max(0.5, prevScale + delta), 3.0));
    // Invalidate rendered pages to allow re-render at new scale
    renderedPagesRef.current.clear();
    // Cancel ongoing render tasks
    Object.values(renderTasksRef.current).forEach(task => {
      if (task && typeof task.cancel === 'function') {
        try { task.cancel(); } catch {}
      }
    });
    renderTasksRef.current = {};
    // Trigger re-render of visible pages
    setTimeout(() => {
      Object.keys(pageContainersRef.current).forEach(k => {
        const n = Number(k);
        const el = pageContainersRef.current[n];
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const inView = rect.top < window.innerHeight && rect.bottom > 0;
        if (inView) renderPage(n);
      });
    }, 0);
  }, [renderPage]);

  const rotate = useCallback(() => {
    setRotation(prevRotation => (prevRotation + 90) % 360);
    renderedPagesRef.current.clear();
    // Cancel ongoing render tasks
    Object.values(renderTasksRef.current).forEach(task => {
      if (task && typeof task.cancel === 'function') {
        try { task.cancel(); } catch {}
      }
    });
    renderTasksRef.current = {};
    setTimeout(() => {
      Object.keys(pageContainersRef.current).forEach(k => {
        const n = Number(k);
        const el = pageContainersRef.current[n];
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const inView = rect.top < window.innerHeight && rect.bottom > 0;
        if (inView) renderPage(n);
      });
    }, 0);
  }, [renderPage]);

  const downloadFile = useCallback(() => {
    if (!contentSource?.fileData) return;
    const link = document.createElement('a');
    link.href = typeof contentSource.fileData === 'string' ? contentSource.fileData : URL.createObjectURL(new Blob([contentSource.fileData as any]));
    link.download = contentSource.filename || 'document';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [contentSource]);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev);
  }, []);

  async function normalizeToBuffer(src: any): Promise<ArrayBuffer | Uint8Array> {
    if (!src) throw new Error('No source provided');
    if (src instanceof ArrayBuffer) return src;
    if (src instanceof Uint8Array) return src;
    if (src instanceof Blob) return await src.arrayBuffer();
    // File extends Blob in browsers
    if (typeof File !== 'undefined' && src instanceof File) return await src.arrayBuffer();
    if (typeof src === 'string') {
      try {
        if (src.startsWith('data:')) {
          const res = await fetch(src);
          return await res.arrayBuffer();
        }
        const res = await fetch(src);
        return await res.arrayBuffer();
      } catch (e) {
        // Attempt base64 decode if it's a bare base64 string
        const base64Index = src.indexOf('base64,');
        if (base64Index !== -1) {
          const b64 = src.slice(base64Index + 7);
          const binary = atob(b64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          return bytes.buffer;
        }
        throw e;
      }
    }
    // Typed arrays
    if ((src as any)?.buffer instanceof ArrayBuffer) return (src as any).buffer;
    throw new Error('Unsupported source type for PDF input');
  }

  // Load PDF when contentSource changes
  useEffect(() => {
    const loadPdf = async () => {
      if (!contentSource || contentSource.type !== 'file' || contentSource.fileType !== 'application/pdf') {
        pdfDocRef.current = null;
        setNumPages(0);
        setPageNumber(1);
        setThumbnails([]);
        setIsLoadingDoc(false);
        setViewerError(null);
        pageTextCacheRef.current.clear();
        // Cancel all ongoing render tasks when clearing
        Object.values(renderTasksRef.current).forEach(task => {
          if (task && typeof task.cancel === 'function') {
            try { task.cancel(); } catch {}
          }
        });
        renderTasksRef.current = {};
        renderedPagesRef.current.clear();
        return;
      }

      try {
        setIsLoadingDoc(true);
        setViewerError(null);
        // Prefer direct File ArrayBuffer to avoid blob URL fetch issues
        const data = (pdfFile && pdfFile instanceof File && pdfFile.type === 'application/pdf')
          ? await pdfFile.arrayBuffer()
          : await normalizeToBuffer(contentSource.fileData);

-        const cmapsUrl = new URL('pdfjs-dist/cmaps/', import.meta.url).toString();
-        const stdFontsUrl = new URL('pdfjs-dist/standard_fonts/', import.meta.url).toString();
-        const loadingTask = (pdfjs as any).getDocument({
-          data,
-          cMapUrl: cmapsUrl,
-          cMapPacked: true,
-          standardFontDataUrl: stdFontsUrl,
-        });
+        // Use default PDF.js configuration; avoid invalid cMap/standard fonts URL paths
+        const loadingTask = (pdfjs as any).getDocument({
+          data,
+        });
        const pdf = await loadingTask.promise;
        pdfDocRef.current = pdf;
        setNumPages(pdf.numPages);
        setPageNumber(1);
        renderedPagesRef.current.clear();
        pageTextCacheRef.current.clear();
        // Cancel any leftovers before generating thumbnails
        Object.values(renderTasksRef.current).forEach(task => {
          if (task && typeof task.cancel === 'function') {
            try { task.cancel(); } catch {}
          }
        });
        renderTasksRef.current = {};
        setThumbsLoading(true);
        generateThumbnails(pdf).finally(() => setThumbsLoading(false));
        setIsLoadingDoc(false);
      } catch (err: any) {
        console.error('Failed to load PDF:', err);
        pdfDocRef.current = null;
        setNumPages(0);
        setThumbnails([]);
        Object.values(renderTasksRef.current).forEach(task => {
          if (task && typeof task.cancel === 'function') {
            try { task.cancel(); } catch {}
          }
        });
        renderTasksRef.current = {};
        renderedPagesRef.current.clear();
        pageTextCacheRef.current.clear();
        setViewerError(err?.message || 'Failed to load PDF');
        setIsLoadingDoc(false);
      }
    };

    loadPdf();
    return () => {
      setThumbnails([]);
      // Cancel all ongoing render tasks on unmount/change
      Object.values(renderTasksRef.current).forEach(task => {
        if (task && typeof task.cancel === 'function') {
          try { task.cancel(); } catch {}
        }
      });
      renderTasksRef.current = {};
      renderedPagesRef.current.clear();
      pageTextCacheRef.current.clear();
    };
  }, [contentSource, pdfFile]);

  // Single-page canvas render (fallback, used by image viewer) — not used for PDFs anymore
  useEffect(() => {
    const renderPage = async () => {
      if (!pdfDocRef.current || !singleCanvasRef.current) return;
      try {
        const safePage = Math.max(1, Math.min(pageNumber, numPages || 1));
        const page = await pdfDocRef.current.getPage(safePage);
        const viewport = page.getViewport({ scale, rotation });
        const canvas = singleCanvasRef.current;
        const context = canvas.getContext('2d');
        if (!context) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: context, viewport }).promise;
      } catch (err: any) {
        if (err?.name === 'RenderingCancelledException' || /Rendering cancelled/i.test(err?.message || '')) {
          return;
        }
        console.error('Failed to render page:', err);
      }
    };
    renderPage();
  }, [pageNumber, scale, rotation, numPages]);

  async function renderPage(n: number) {
    if (!pdfDocRef.current) return;
    // Clamp requested page to valid range
    const safePage = Math.max(1, Math.min(n, numPages || 1));
    if (renderedPagesRef.current.has(safePage)) return;
    // If a render is in-flight for this page, cancel it before starting a new one
    const existing = renderTasksRef.current[safePage];
    if (existing && typeof existing.cancel === 'function') {
      try { existing.cancel(); } catch {}
    }
    try {
      const page = await pdfDocRef.current.getPage(safePage);
      const viewport = page.getViewport({ scale, rotation });
      const canvas = pageCanvasRef.current[safePage];
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const task = page.render({ canvasContext: ctx, viewport });
      renderTasksRef.current[safePage] = task;
      await task.promise;
      // Clear task marker after completion
      delete renderTasksRef.current[safePage];
      const textLayerDiv = pageTextLayerRef.current[safePage];
      if (textLayerDiv) {
        let textContent = pageTextCacheRef.current.get(safePage);
        if (!textContent) {
          textContent = await page.getTextContent();
          pageTextCacheRef.current.set(safePage, textContent);
        }
        textLayerDiv.innerHTML = '';
        const builder = new (TextLayerBuilder as any)({
          textLayerDiv,
          pageIndex: safePage - 1,
          viewport,
          enhanceTextSelection: true,
        });
        builder.setTextContentSource(textContent);
        builder.render();
        (textLayerDiv as HTMLDivElement).style.width = `${canvas.width}px`;
        (textLayerDiv as HTMLDivElement).style.height = `${canvas.height}px`;
      }
      renderedPagesRef.current.add(safePage);
    } catch (error: any) {
      // Ignore benign cancellations
      if (error?.name === 'RenderingCancelledException' || /Rendering cancelled/i.test(error?.message || '')) {
        delete renderTasksRef.current[safePage];
        return;
      }
      console.warn('Failed to render page', safePage, error);
      // Ensure we clear any task reference on error
      delete renderTasksRef.current[safePage];
    }
  }

  useEffect(() => {
    if (!numPages || !pagesContainerRef.current) return;
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const el = entry.target as HTMLDivElement;
        const nAttr = el.getAttribute('data-page');
        const n = nAttr ? Number(nAttr) : NaN;
        if (!n || isNaN(n)) return;
        if (entry.isIntersecting) {
          // Skip if already rendered or actively rendering
          const safePage = Math.max(1, Math.min(n, numPages || 1));
          if (renderedPagesRef.current.has(safePage) || renderTasksRef.current[safePage]) return;
          renderPage(safePage);
        }
      });
    }, { root: pagesContainerRef.current, rootMargin: '100px' });

    for (let n = 1; n <= numPages; n++) {
      const container = pageContainersRef.current[n];
      if (container) observer.observe(container);
    }

    return () => observer.disconnect();
  }, [numPages, scale, rotation]);

  const generateThumbnails = async (pdf: any) => {
    try {
      const thumbs: string[] = new Array(pdf.numPages);
      const maxThumbs = Math.min(pdf.numPages, 24);
      for (let i = 1; i <= maxThumbs; i++) {
        try {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 0.2 });
          const offCanvas = document.createElement('canvas');
          const ctx = offCanvas.getContext('2d');
          if (!ctx) continue;
          offCanvas.width = viewport.width;
          offCanvas.height = viewport.height;
          await page.render({ canvasContext: ctx, viewport }).promise;
          thumbs[i - 1] = offCanvas.toDataURL();
          await new Promise(r => setTimeout(r, 0));
        } catch (pageErr) {
          console.warn('Thumbnail render failed for page', i, pageErr);
        }
      }
      setThumbnails(thumbs);
    } catch (error) {
      console.warn('Failed generating thumbnails', error);
    }
  };

  const renderWebpageViewer = () => (
    <div className="h-full">
      <iframe
        src={contentSource?.url}
        className="w-full h-full border-0 rounded-lg"
        title={contentSource?.title}
        sandbox="allow-same-origin allow-scripts"
      />
    </div>
  );

  const renderImageViewer = () => (
    <div className="h-full flex items-center justify-center bg-gray-50 rounded-lg overflow-hidden">
      <img
        src={contentSource?.fileData || ''}
        alt={contentSource?.title || 'image'}
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
      {viewerError && (
        <div className="px-3 py-2 bg-red-50 text-red-700 text-sm border-b border-red-200">
          {viewerError}
        </div>
      )}
      {isLoadingDoc && (
        <div className="px-3 py-2 bg-brand-50 text-brand-700 text-sm border-b border-brand-200">
          Loading PDF…
        </div>
      )}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar thumbnails */}
        <div className="w-28 border-r bg-white overflow-auto">
          <div className="p-2 space-y-2">
            {thumbsLoading && (
              <div className="text-xs text-gray-500">Generating thumbnails…</div>
            )}
            {Array.from({ length: numPages }).map((_, idx) => (
              <button
                key={idx}
                onClick={() => {
                  setPageNumber(idx + 1);
                  const container = pageContainersRef.current[idx + 1];
                  if (container) container.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className={`block w-full border rounded hover:border-brand-600 ${pageNumber === idx + 1 ? 'ring-2 ring-brand-500' : ''}`}
                title={`Page ${idx + 1}`}
              >
                {thumbnails[idx] ? (
                  <img src={thumbnails[idx]} alt={`Page ${idx + 1}`} className="w-full" />
                ) : (
                  <div className="w-full h-24 bg-gray-100 flex items-center justify-center text-xs text-gray-500">
                    {idx + 1}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
        {/* Main pages container */}
        <div ref={pagesContainerRef} className="flex-1 p-4 overflow-auto">
          {Array.from({ length: numPages }).map((_, idx) => (
            <div
              key={idx}
              ref={el => { pageContainersRef.current[idx + 1] = el; }}
              data-page={idx + 1}
              className="relative mx-auto mb-6 bg-white shadow-lg border border-gray-200"
              style={{ width: 'fit-content' }}
            >
              <canvas
                ref={el => { pageCanvasRef.current[idx + 1] = el; }}
                className="block"
              />
              <div
                ref={el => { pageTextLayerRef.current[idx + 1] = el; }}
                className="textLayer absolute top-0 left-0"
                style={{ pointerEvents: 'none' }}
              />
            </div>
          ))}
        </div>
      </div>
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
          {contentSource?.title}
        </h3>
        <div className="whitespace-pre-wrap text-gray-800 leading-relaxed">
          {contentSource?.content}
        </div>
      </div>
    </div>
  );

  const renderViewer = () => {
    switch (contentSource?.type) {
      case 'webpage':
        return renderWebpageViewer();
      case 'file':
        if (contentSource?.fileType?.startsWith('image/')) {
          return renderImageViewer();
        } else if (contentSource?.fileType === 'application/pdf') {
          return renderPDFViewer();
        }
        return renderTextViewer();
      case 'text':
        return renderTextViewer();
      default:
        return renderTextViewer();
    }
  };

  return (
    <div className={`fixed right-4 top-20 bottom-4 w-[720px] bg-white shadow-lg rounded-lg border border-gray-200 transition-transform duration-300 ${isVisible ? 'translate-x-0' : 'translate-x-[740px]'}`}>
      <div className="flex items-center justify-between p-3 border-b">
        <h3 className="text-sm font-semibold text-gray-800">Document Viewer</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleFullscreen}
            className="p-2 text-gray-600 hover:text-gray-900"
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
          >
            <Maximize2 className="h-4 w-4" />
          </button>
          <button
            onClick={onToggleVisibility}
            className="p-2 text-gray-600 hover:text-gray-900"
            title={isVisible ? 'Hide Viewer' : 'Show Viewer'}
          >
            {isVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {contentSource && (
        <div className="flex flex-col h-[calc(100%-44px)]">
          <div className="flex items-center justify-between p-3 border-b bg-white">
            <div className="flex items-center gap-2">
              <button
                onClick={() => changeScale(0.1)}
                className="p-2 text-gray-600 hover:text-gray-900"
                title="Zoom In"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
              <button
                onClick={() => changeScale(-0.1)}
                className="p-2 text-gray-600 hover:text-gray-900"
                title="Zoom Out"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <button
                onClick={rotate}
                className="p-2 text-gray-600 hover:text-gray-900"
                title="Rotate"
              >
                <RotateCw className="h-4 w-4" />
              </button>
            </div>
            <button
              onClick={downloadFile}
              className="p-2 text-gray-600 hover:text-gray-900"
              title="Download"
            >
              <Download className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1">
            {renderViewer()}
          </div>
        </div>
      )}
    </div>
  );
}