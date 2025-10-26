import { useState, useRef, useEffect } from 'react';
import { Header } from './components/Header';
import { ContentInput } from './components/ContentInput';
import { SpeechControls } from './components/SpeechControls';
import { TextDisplay } from './components/TextDisplay';
import { EbookViewer } from './components/EbookViewer';

import { ContentSource } from './types';

import { useSpeechSynthesis } from './hooks/useSpeechSynthesis';
import { useContentExtraction } from './hooks/useContentExtraction';
import { PdfProvider } from './context/PdfContext';
import blobUrlManager from './utils/blobUrlManager';


interface SelectionRange {
  startPage: number;
  endPage: number;
  startText?: string;
  endText?: string;
  selectedText?: string;
  currentReadingPage?: number;
}

function App() {
  return (
    <PdfProvider>
      <AppContent />
    </PdfProvider>
  );
}

function AppContent() {
  const [currentContent, setCurrentContent] = useState<ContentSource | null>(null);
  const [showEbookViewer, setShowEbookViewer] = useState(false);
  const [currentSelection, setCurrentSelection] = useState<SelectionRange | null>(null);
  const prevBlobUrlRef = useRef<string | null>(null);

  // Track blob URL lifecycle centralization: retain on use, release when replaced
  useEffect(() => {
    const prev = prevBlobUrlRef.current;
    const nextUrl = currentContent?.fileData || null;

    if (prev && (!nextUrl || prev !== nextUrl) && blobUrlManager.isBlobUrl(prev)) {
      blobUrlManager.release(prev);
    }

    if (nextUrl && blobUrlManager.isBlobUrl(nextUrl)) {
      blobUrlManager.retain(nextUrl);
      prevBlobUrlRef.current = nextUrl;
    } else {
      prevBlobUrlRef.current = null;
    }
  }, [currentContent]);

  // Revoke any remaining blob URLs on app unmount
  useEffect(() => {
    return () => {
      try { blobUrlManager.revokeAll(); } catch {}
    };
  }, []);

  const {
    session,
    settings,
    availableVoices,
    startReading,
    pauseReading,
    resumeReading,
    stopReading,
    updateSettings,
  } = useSpeechSynthesis();

  const {
    isExtracting,
    progress,
    isUsingOCR,
    extractFromWebpage,
    extractFromImage,
    extractFromPDF,
    extractFromWord,
    extractFromSpreadsheet,
    extractFromText,
  } = useContentExtraction();

  const handleContentExtracted = (content: ContentSource) => {
    // Stop any ongoing reading when new content arrives
    stopReading();

    // Reset selection for new content
    setCurrentSelection(null);

    // Update current content and viewer logic
    setCurrentContent(content);
    const isPdf = content.fileType === 'application/pdf';
    setShowEbookViewer(isPdf);
  };

  const handleSelectionChange = (selection: SelectionRange | null) => {
    setCurrentSelection(selection);
  };

  // Utility function to extract content from specific page range
  const extractContentFromPageRange = (content: string, startPage: number, endPage: number): string => {
    if (!content) return '';
    
    // Split content by page markers (supports optional (Error) or (OCR) suffix)
    const pageMarkerRegex = /--- Page (\d+)(?: \((?:Error|OCR)\))? ---/g;
    const pages: { pageNum: number; content: string }[] = [];
    
    let lastIndex = 0;
    let match;
    
    while ((match = pageMarkerRegex.exec(content)) !== null) {
      const pageNum = parseInt(match[1]);
      const pageStart = match.index + match[0].length;
      
      // Add previous page content if exists
      if (pages.length > 0) {
        pages[pages.length - 1].content = content.substring(lastIndex, match.index).trim();
      }
      
      // Start new page
      pages.push({ pageNum, content: '' });
      lastIndex = pageStart;
    }
    
    // Add content for the last page
    if (pages.length > 0) {
      pages[pages.length - 1].content = content.substring(lastIndex).trim();
    }
    
    // Filter pages within the selected range
    const selectedPages = pages.filter(page => page.pageNum >= startPage && page.pageNum <= endPage);
    
    // Combine selected pages content WITHOUT page markers
    return selectedPages.map(page => page.content).join('\n\n');
  };

  // Remove page marker headers like "--- Page 12 ---", "--- Page 12 (Error) ---", or "--- Page 12 (OCR) ---"
  const stripPageMarkers = (text: string): string => {
    return text.replace(/--- Page \d+(?: \((?:Error|OCR)\))? ---\s*/g, '');
  };

  // Get the starting index in the full content for a given page number
  const getPageStartIndex = (content: string, pageNum: number): number => {
    const regex = new RegExp(`--- Page ${pageNum}(?: \\((?:Error|OCR)\\\))? ---`);
    const match = regex.exec(content);
    if (!match) return 0;
    return match.index + match[0].length;
  };

  const handleStartReading = (selection: SelectionRange) => {
    setCurrentSelection(selection);
    let textToRead = '';
    
    if (selection.selectedText) {
      // Use manually selected text
      textToRead = selection.selectedText;
    } else if (selection.startPage && selection.endPage && currentContent?.content) {
      // Extract content from page range
      textToRead = extractContentFromPageRange(currentContent.content, selection.startPage, selection.endPage);
    } else {
      // Fallback to entire content
      textToRead = currentContent?.content || '';
    }
    
    const sanitized = stripPageMarkers(textToRead);
    if (sanitized.trim()) {
      // Set the initial current reading page to the selection start
      setCurrentSelection(prev => ({ ...(prev || selection), currentReadingPage: selection.startPage }));
      startReading(sanitized, 0);
    } else {
      console.warn('No content found for the selected page range');
    }
  };

  const handleCurrentPageChange = (page: number) => {
    // Update the current selection to reflect the page being read
    if (currentSelection && page >= currentSelection.startPage && page <= currentSelection.endPage) {
      // Page is within current selection, update EbookViewer to navigate to this page
      setCurrentSelection(prev => {
        if (prev && prev.currentReadingPage !== page) {
          // Only update if the page has actually changed to avoid unnecessary re-renders
          return { ...prev, currentReadingPage: page };
        }
        return prev;
      });
    }
  };

  // Enhanced reading progress synchronization
  const handleReadingProgressUpdate = (position: number) => {
    if (currentSelection && currentContent?.content) {
      // Map the reading position within the selected text back to the full content
      const startOffset = getPageStartIndex(currentContent.content, currentSelection.startPage);
      const effectivePosition = startOffset + position;
      const pageFromPosition = calculatePageFromPosition(currentContent.content, effectivePosition);
      if (pageFromPosition >= currentSelection.startPage && pageFromPosition <= currentSelection.endPage) {
        handleCurrentPageChange(pageFromPosition);
      }
    }
  };

  const calculatePageFromPosition = (content: string, position: number): number => {
    const pageMarkerRegex = /--- Page (\d+)(?: \((?:Error|OCR)\))? ---/g;
    let pageNum = 1;
    let match;
    let lastIndex = 0;
    while ((match = pageMarkerRegex.exec(content)) !== null) {
      const pageStart = match.index + match[0].length;
      if (position >= lastIndex && position < pageStart) {
        return pageNum;
      }
      lastIndex = pageStart;
      pageNum = parseInt(match[1]);
    }
    return pageNum;
  };

  const toggleEbookViewer = () => {
    setShowEbookViewer(!showEbookViewer);
  };

  const handlePlay = () => {
    if (!currentContent?.content) return;

    // Prefer current selection if available
    let textToRead = '';
    if (currentSelection) {
      if (currentSelection.selectedText) {
        textToRead = currentSelection.selectedText;
      } else if (currentSelection.startPage && currentSelection.endPage) {
        textToRead = extractContentFromPageRange(
          currentContent.content,
          currentSelection.startPage,
          currentSelection.endPage
        );
      }
    }

    // Fallback to entire content if no selection or empty selection
    if (!textToRead) {
      textToRead = currentContent.content;
    }

    const sanitized = stripPageMarkers(textToRead);
    if (!sanitized.trim()) return;

    // If paused and selection content differs from session content, start fresh at beginning of selection
    if (session.isPaused && session.content !== sanitized) {
      if (currentSelection) {
        setCurrentSelection(prev => ({ ...(prev || currentSelection), currentReadingPage: currentSelection.startPage }));
      }
      startReading(sanitized, 0);
      return;
    }

    if (session.isPaused) {
      resumeReading();
    } else {
      // If selection is present and session content differs, start at beginning of selection
      if (currentSelection && session.content !== sanitized) {
        setCurrentSelection(prev => ({ ...(prev || currentSelection), currentReadingPage: currentSelection.startPage }));
        startReading(sanitized, 0);
      } else {
        startReading(sanitized, session.currentPosition);
      }
    }
  };

  const handlePause = () => {
    pauseReading();
  };

  const handleStop = () => {
    stopReading();
  };



  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 via-white to-brand-50">
      <Header />
      
      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className={`grid gap-6 ${
          showEbookViewer && currentContent?.fileType === 'application/pdf'
            ? 'grid-cols-1 xl:grid-cols-4'
            : 'grid-cols-1 lg:grid-cols-3'
        }`}>
          {/* Left Column - Content Input */}
          <div className={
            showEbookViewer && currentContent 
              ? 'xl:col-span-2' 
              : 'lg:col-span-2'
          }>
            <ContentInput
              onContentExtracted={handleContentExtracted}
              isExtracting={isExtracting}
              progress={progress}
              isUsingOCR={isUsingOCR}
              extractFromWebpage={extractFromWebpage}
              extractFromImage={extractFromImage}
              extractFromPDF={extractFromPDF}
              extractFromWord={extractFromWord}
              extractFromSpreadsheet={extractFromSpreadsheet}
              extractFromText={extractFromText}
            />
            
            {/* Content Extractor Integration */}
            <TextDisplay
              contentSource={currentContent}
              session={session}
              showDocumentViewer={showEbookViewer}
              currentSelection={currentSelection}
              onCurrentPageChange={handleCurrentPageChange}
              onReadingProgressUpdate={handleReadingProgressUpdate}
            />
          </div>
          
          {/* Middle Column - Document Viewer */}
          {currentContent?.fileType === 'application/pdf' && (
            <div className={
              showEbookViewer 
                ? 'xl:col-span-1' 
                : 'hidden'
            }>
              <EbookViewer
                contentSource={currentContent}
                isVisible={showEbookViewer}
                onToggleVisibility={toggleEbookViewer}
                onSelectionChange={handleSelectionChange}
                onStartReading={handleStartReading}
                currentSelection={currentSelection}
              />
            </div>
          )}
          
          {/* Right Column - Speech Controls */}
          <div>
            <SpeechControls
              session={session}
              settings={settings}
              availableVoices={availableVoices}
              onPlay={handlePlay}
              onPause={pauseReading}
              onResume={resumeReading}
              onStop={stopReading}
              onSettingsUpdate={updateSettings}
            />
          </div>
        </div>
      </main>
      

      
      {/* Footer */}
      <footer className="bg-white border-t mt-12">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="text-center text-gray-600">
            <p className="mb-2">View and read websites, PDFs, images, and text with AI-powered speech</p>
            <p className="text-sm">Enhanced ebook viewer with page selection, text selection, and reading controls</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;