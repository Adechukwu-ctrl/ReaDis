import React, { createContext, useState, useContext, ReactNode } from 'react';

interface PdfContextType {
  pdfFile: File | null;
  setPdfFile: (file: File | null) => void;
  extractedText: string;
  setExtractedText: (text: string) => void;
}

const PdfContext = createContext<PdfContextType | undefined>(undefined);

export const PdfProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [extractedText, setExtractedText] = useState<string>('');

  return (
    <PdfContext.Provider value={{ pdfFile, setPdfFile, extractedText, setExtractedText }}>
      {children}
    </PdfContext.Provider>
  );
};

export const usePdf = (): PdfContextType => {
  const context = useContext(PdfContext);
  if (context === undefined) {
    throw new Error('usePdf must be used within a PdfProvider');
  }
  return context;
};