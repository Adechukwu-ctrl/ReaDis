import React from 'react';
import { ContentSource } from '../types';
import { FileText, Globe, Type } from 'lucide-react';

interface ContentExtractorProps {
  contentSource: ContentSource | null;
}

export const ContentExtractor: React.FC<ContentExtractorProps> = ({ contentSource }) => {
  const getIcon = () => {
    if (!contentSource) return <FileText className="h-5 w-5" />;
    switch (contentSource.type) {
      case 'webpage':
        return <Globe className="h-5 w-5" />;
      case 'text':
        return <Type className="h-5 w-5" />;
      default:
        return <FileText className="h-5 w-5" />;
    }
  };

  return (
    <div className="bg-white p-4 rounded-lg shadow">
      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
        {getIcon()}
        Extracted Content
      </h2>

      {!contentSource && (
        <div className="text-sm text-gray-600">
          No content yet. Use "Add Content to Read" to upload or paste.
        </div>
      )}

      {contentSource && (
        <div className="space-y-3">
          <div className="text-sm text-gray-600">
            <span className="font-medium text-gray-900">{contentSource.title}</span>
            {contentSource.filename && (
              <span className="ml-2 text-gray-500">({contentSource.filename})</span>
            )}
            {contentSource.url && (
              <span className="ml-2 text-brand-600">{contentSource.url}</span>
            )}
          </div>
          <div className="extracted-text border p-4 rounded max-h-60 overflow-y-auto bg-gray-50">
            <pre className="whitespace-pre-wrap text-sm text-gray-700">{contentSource.content}</pre>
          </div>
        </div>
      )}
    </div>
  );
};