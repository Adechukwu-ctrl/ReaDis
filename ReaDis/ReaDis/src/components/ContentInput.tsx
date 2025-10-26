import React, { useState, useRef } from 'react';
import { Globe, Upload, Type, FileText, Image, Loader2 } from 'lucide-react';
import { ContentSource } from '../types';
import { ProgressIndicator } from './ProgressIndicator';
import { usePdf } from '../context/PdfContext';


interface ContentInputProps {
  onContentExtracted: (content: ContentSource) => void;
  isExtracting: boolean;
  progress: number;
  isUsingOCR?: boolean;
  extractFromWebpage: (url: string) => Promise<ContentSource>;
  extractFromImage: (file: File) => Promise<ContentSource>;
  extractFromPDF: (file: File) => Promise<ContentSource>;
  extractFromWord: (file: File) => Promise<ContentSource>;
  extractFromSpreadsheet: (file: File) => Promise<ContentSource>;
  extractFromText: (text: string) => ContentSource;
}

export const ContentInput: React.FC<ContentInputProps> = ({
  onContentExtracted,
  isExtracting,
  progress,
  isUsingOCR = false,
  extractFromWebpage,
  extractFromImage,
  extractFromPDF,
  extractFromWord,
  extractFromSpreadsheet,
  extractFromText,
}) => {
  const [activeTab, setActiveTab] = useState<'url' | 'file' | 'text'>('url');

  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [progressMessage, setProgressMessage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { setPdfFile } = usePdf();

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setError(null);
    try {
      const content = await extractFromWebpage(url.trim());
      onContentExtracted(content);
      setUrl('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const selectBestPdfMethod = (file: File): 'standard' | 'react-pdf' | 'server-side' | 'pdfjs-viewer' => {
    const fileSizeMB = file.size / (1024 * 1024);
    
    // For very large files (>50MB), use server-side processing
    if (fileSizeMB > 50) {
      return 'server-side';
    }
    
    // For large files (10-50MB), use chunked processing with PDF.js
    if (fileSizeMB > 10) {
      return 'pdfjs-viewer';
    }
    
    // For medium files (2-10MB), use standard processing
    if (fileSizeMB > 2) {
      return 'standard';
    }
    
    // For small files (<2MB), use React PDF wrapper for better performance
    return 'react-pdf';
  };

  const processPdfWithMethod = async (file: File): Promise<ContentSource> => {
    // All methods currently use the same extraction logic
    // Future enhancement: implement different strategies based on method
    return extractFromPDF(file);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setCurrentFile(file);
    setProgressMessage(`Processing ${file.name}...`);
    
    try {
      let content: ContentSource;
      
      if (file.type === 'application/pdf') {
        // Store original File in shared context for viewers
        setPdfFile(file);
        // Automatically select the best PDF processing method
        const bestMethod = selectBestPdfMethod(file);
        console.log(`Auto-selected PDF processing method: ${bestMethod} for file size: ${(file.size / (1024 * 1024)).toFixed(2)}MB`);
        content = await processPdfWithMethod(file);
      } else if (file.type.startsWith('image/')) {
        // Clear any previously set PDF file
        setPdfFile(null);
        content = await extractFromImage(file);
      } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        setPdfFile(null);
        content = await extractFromWord(file);
      } else if (
        file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        file.type === 'application/vnd.ms-excel'
      ) {
        setPdfFile(null);
        content = await extractFromSpreadsheet(file);
      } else {
        setPdfFile(null);
        throw new Error('Unsupported file type. Please upload a PDF, image, Word (.docx), or Excel (.xlsx, .xls) file.');
      }
      
      onContentExtracted(content);
      setCurrentFile(null);
      setProgressMessage('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setCurrentFile(null);
      setProgressMessage('');
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;

    setError(null);
    const content = extractFromText(text.trim());
    onContentExtracted(content);
    setText('');
  };

  const tabs = [
    { id: 'url', label: 'Webpage', icon: Globe },
    { id: 'file', label: 'File Upload', icon: Upload },
    { id: 'text', label: 'Text', icon: Type },
  ];

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
      <h2 className="text-xl font-semibold text-gray-900 mb-4">Add Content to Read</h2>
      
      {/* Tab Navigation */}
      <div className="flex space-x-1 bg-gray-100 rounded-lg p-1 mb-6">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as 'url' | 'file' | 'text')}
              className={`flex-1 flex items-center justify-center space-x-2 py-2 px-4 rounded-md font-medium transition-all duration-200 ${
                activeTab === tab.id
                  ? 'bg-white text-brand-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Progress Bar */}
      {isExtracting && (
        <div className="mb-4">
          <div className="flex items-center space-x-2 text-sm text-gray-600 mb-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{isUsingOCR ? 'Performing OCR text recognition...' : 'Extracting content...'}</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-brand-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* OCR Banner */}
      {isUsingOCR && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center space-x-2 text-blue-800">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium">OCR Text Recognition Active</p>
              <p className="text-xs text-blue-600 mt-1">
                Extracting text from scanned pages. This may take longer than usual and accuracy depends on image quality.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Tab Content */}
      {activeTab === 'url' && (
        <form onSubmit={handleUrlSubmit} className="space-y-4">
          <div>
            <label htmlFor="url" className="block text-sm font-medium text-gray-700 mb-1">
              Website URL
            </label>
            <input
              type="url"
              id="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              disabled={isExtracting}
            />
          </div>
          <button
            type="submit"
            disabled={isExtracting || !url.trim()}
            className="w-full bg-brand-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
          >
            {isExtracting ? 'Extracting...' : 'Extract Content'}
          </button>
        </form>
      )}

      {activeTab === 'file' && (
        <div className="space-y-4">
          <div>
            <label htmlFor="file" className="block text-sm font-medium text-gray-700 mb-1">
              Upload File
            </label>
            <input
              ref={fileInputRef}
              type="file"
              id="file"
              accept=".pdf,image/*,.docx,.xlsx,.xls"
              onChange={handleFileUpload}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              disabled={isExtracting}
            />
          </div>
          

          
          <div className="grid grid-cols-2 gap-2 text-sm text-gray-600">
            <div className="flex items-center space-x-1">
              <FileText className="h-4 w-4" />
              <span>PDF files</span>
            </div>
            <div className="flex items-center space-x-1">
              <Image className="h-4 w-4" />
              <span>Images (OCR)</span>
            </div>
            <div className="flex items-center space-x-1">
              <FileText className="h-4 w-4" />
              <span>Word (.docx)</span>
            </div>
            <div className="flex items-center space-x-1">
              <FileText className="h-4 w-4" />
              <span>Excel (.xlsx, .xls)</span>
            </div>
          </div>
          

        </div>
      )}

      {activeTab === 'text' && (
        <form onSubmit={handleTextSubmit} className="space-y-4">
          <div>
            <label htmlFor="text" className="block text-sm font-medium text-gray-700 mb-1">
              Paste Text
            </label>
            <textarea
              id="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste your text here..."
              rows={6}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-vertical"
              disabled={isExtracting}
            />
          </div>
          <button
            type="submit"
            disabled={isExtracting || !text.trim()}
            className="w-full bg-brand-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
          >
            Add Text
          </button>
        </form>
      )}
      
      {/* Progress Indicator for Large Files */}
      <ProgressIndicator
        progress={progress}
        message={progressMessage}
        fileName={currentFile?.name}
        fileSize={currentFile?.size}
        isVisible={isExtracting && !!currentFile}
        showDetails={true}
      />
    </div>
  );
};