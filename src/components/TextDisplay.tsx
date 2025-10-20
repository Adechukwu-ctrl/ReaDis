import React, { useEffect, useRef, useState } from 'react';
import { ContentSource, ReadingSession } from '../types';
import { FileText, Globe, Type, Copy as CopyIcon, Download } from 'lucide-react';
import { Logo } from './Logo';
import { LogoImage } from './LogoImage';

interface SelectionRange {
  startPage: number;
  endPage: number;
  startText?: string;
  endText?: string;
  selectedText?: string;
  currentReadingPage?: number;
}

interface TextDisplayProps {
  contentSource: ContentSource | null;
  session: ReadingSession;
  showDocumentViewer: boolean;
  currentSelection?: SelectionRange | null;
  onCurrentPageChange?: (page: number) => void;
  onReadingProgressUpdate?: (position: number, totalLength: number) => void;
}

export const TextDisplay: React.FC<TextDisplayProps> = ({ 
  contentSource, 
  session, 
  showDocumentViewer,
  currentSelection,
  onCurrentPageChange,
  onReadingProgressUpdate
}) => {
  const textRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (textRef.current && session.currentPosition > 0) {
      // Find the word at the current position and scroll to it
      const textElement = textRef.current;
      const text = textElement.textContent || '';
      
      if (text.length > 0 && session.currentPosition < text.length) {
        // Simple scroll to keep current position in view
        const percentage = (session.currentPosition / text.length) * 100;
        const scrollTop = (textElement.scrollHeight * percentage) / 100 - textElement.clientHeight / 2;
        textElement.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' });
      }
    }
  }, [session.currentPosition]);

  // Track current page during reading and notify parent
  useEffect(() => {
    if (
      contentSource?.content &&
      session.currentPosition > 0 &&
      onCurrentPageChange &&
      contentSource.content.includes('--- Page')
    ) {
      const currentPage = getCurrentPageFromPosition(contentSource.content, session.currentPosition);
      onCurrentPageChange(currentPage);
    }
  }, [session.currentPosition, contentSource?.content, onCurrentPageChange]);

  // Track reading progress and notify parent for synchronization
  useEffect(() => {
    if (contentSource?.content && session.currentPosition > 0 && onReadingProgressUpdate) {
      onReadingProgressUpdate(session.currentPosition);
    }
  }, [session.currentPosition, contentSource?.content, onReadingProgressUpdate]);

  if (!contentSource) {
    return (
      <div className="bg-white rounded-xl shadow-lg p-8 text-center mb-6">
        <div className="text-gray-400 mb-4">
          <LogoImage height={48} />
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">Ready to Read</h3>
        <p className="text-gray-500">
          Add content from a webpage, upload a file, or paste text to begin reading.
        </p>
      </div>
    );
  }

  const getIcon = () => {
    switch (contentSource.type) {
      case 'webpage':
        return <Globe className="h-5 w-5" />;
      case 'file':
        return <FileText className="h-5 w-5" />;
      case 'text':
        return <Type className="h-5 w-5" />;
    }
  };
  
  // Utility: remove page marker headers like "--- Page 12 ---" or "--- Page 12 (Error) ---"
  const stripPageMarkers = (text: string): string => {
    return (text || '').replace(/--- Page \d+(?: \((?:Error|OCR)\))? ---\s*/g, '');
  };
  
  // Extract content from selected page range
  const getDisplayContent = () => {
    if (!contentSource?.content) return '';
    
    // If no selection or not a PDF with page markers, show full content
    if (!currentSelection || !contentSource.content.includes('--- Page')) {
      return stripPageMarkers(contentSource.content);
    }
    
    // Extract content from selected page range
    const pageMarkerRegex = /--- Page (\d+)(?: \((?:Error|OCR)\))? ---/g;
    const pages: { pageNum: number; content: string; startIndex: number }[] = [];
    
    let lastIndex = 0;
    let match;
    
    while ((match = pageMarkerRegex.exec(contentSource.content)) !== null) {
      const pageNum = parseInt(match[1]);
      const pageStart = match.index + match[0].length;
      
      // Add previous page content if exists
      if (pages.length > 0) {
        pages[pages.length - 1].content = contentSource.content.substring(lastIndex, match.index).trim();
      }
      
      // Start new page
      pages.push({ pageNum, content: '', startIndex: match.index });
      lastIndex = pageStart;
    }
    
    // Add content for the last page
    if (pages.length > 0) {
      pages[pages.length - 1].content = contentSource.content.substring(lastIndex).trim();
    }
    
    // Filter pages within the selected range
    const selectedPages = pages.filter(page => 
      page.pageNum >= currentSelection.startPage && page.pageNum <= currentSelection.endPage
    );
    
    // Combine selected pages content WITHOUT page markers
    return selectedPages.map(page => page.content).join('\n\n');
  };

  // Function to determine which page the current reading position is on
  const getCurrentPageFromPosition = (content: string, position: number): number => {
    if (!content.includes('--- Page') || position <= 0) return 1;
    
    const pageMarkerRegex = /--- Page (\d+)(?: \((?:Error|OCR)\))? ---/g;
    let match;
    let lastPageNum = 1;
    
    while ((match = pageMarkerRegex.exec(content)) !== null) {
      const pageNum = parseInt(match[1]);
      const pageStartIndex = match.index;
      
      if (position < pageStartIndex) {
        return lastPageNum;
      }
      lastPageNum = pageNum;
    }
    
    return lastPageNum;
  };

  const highlightText = (text: string, currentPos: number) => {
    if (currentPos <= 0 || !session.isPlaying) return text;
    
    const beforeCurrent = text.slice(0, currentPos);
    const currentWord = text.slice(currentPos, currentPos + 50); // Show next ~50 chars as current
    const afterCurrent = text.slice(currentPos + 50);
    
    return (
      <>
        <span className="text-gray-600">{beforeCurrent}</span>
        <span className="bg-yellow-200 text-gray-900 px-1 rounded">{currentWord}</span>
        <span className="text-gray-800">{afterCurrent}</span>
      </>
    );
  };

  // Copy displayed content to clipboard
  const handleCopy = async () => {
    const text = getDisplayContent();
    if (!text) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-1000px';
        ta.style.top = '-1000px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('Copy to clipboard failed:', err);
    }
  };

  // Download displayed content as a .txt file
  const handleDownload = () => {
    const text = getDisplayContent();
    if (!text) return;
    const base = (contentSource?.filename || contentSource?.title || 'extracted-content')
      .replace(/\.[^/.]+$/, '')
      .replace(/\s+/g, '-');
    const filename = `${base}.txt`;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`bg-white rounded-xl shadow-lg overflow-hidden mb-6 ${
      showDocumentViewer ? 'lg:mb-0' : ''
    }`}>
      {/* Header */}
      <div className="bg-gray-50 px-6 py-4 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="text-gray-600">{getIcon()}</div>
            <div>
              <h3 className="font-medium text-gray-900">{contentSource.title}</h3>
              {contentSource.url && (
                <p className="text-sm text-gray-500">{contentSource.url}</p>
              )}
              {contentSource.filename && (
                <p className="text-sm text-gray-500">{contentSource.filename}</p>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={handleCopy}
              disabled={!getDisplayContent()}
              className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded disabled:opacity-50"
              title="Copy displayed content"
            >
              <CopyIcon className="h-4 w-4" />
            </button>
            <button
              onClick={handleDownload}
              disabled={!getDisplayContent()}
              className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded disabled:opacity-50"
              title="Download as .txt"
            >
              <Download className="h-4 w-4" />
            </button>
            {copied && <span className="text-xs text-brand-600">Copied</span>}
          </div>
        </div>
      </div>

      {/* Content */}
      <div 
        ref={textRef}
        className={`p-6 overflow-y-auto leading-relaxed text-gray-800 ${
          showDocumentViewer ? 'max-h-64' : 'max-h-96'
        }`}
        style={{ lineHeight: '1.6' }}
      >
        {currentSelection && (
          <div className="mb-4 p-3 bg-brand-50 border border-brand-200 rounded-lg">
            <p className="text-sm font-medium text-brand-900">
              Showing Pages {currentSelection.startPage} - {currentSelection.endPage}
            </p>
          </div>
        )}
        {session.isPlaying ? (
          <div className="whitespace-pre-wrap">
            {highlightText(getDisplayContent(), session.currentPosition)}
          </div>
        ) : (
          <div className="whitespace-pre-wrap">{getDisplayContent()}</div>
        )}
      </div>

      {/* Footer Stats */}
      <div className="bg-gray-50 px-6 py-3 border-t text-sm text-gray-600">
        <div className="flex justify-between">
          <span>{getDisplayContent().length} characters</span>
          <span>~{Math.ceil(getDisplayContent().split(' ').length / 150)} min read</span>
        </div>
      </div>
    </div>
  );
};