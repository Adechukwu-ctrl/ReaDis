export interface ContentSource {
  id: string;
  type: 'webpage' | 'file' | 'text' | 'pdf';
  title: string;
  content: string;
  url?: string;
  filename?: string;
  fileData?: string; // Base64 data for files
  fileType?: string; // MIME type - supports PDF, images, Word (.docx), Excel (.xlsx, .xls)
  extractedAt?: string; // ISO timestamp of when content was extracted
}

export interface SpeechSettings {
  rate: number;
  pitch: number;
  volume: number;
  voice?: SpeechSynthesisVoice;
}

export interface ReadingSession {
  content: string;
  currentPosition: number;
  isPlaying: boolean;
  isPaused: boolean;
  totalCharacters: number;
}

export interface ViewerSettings {
  showDocument: boolean;
  documentScale: number;
  currentPage: number;
}