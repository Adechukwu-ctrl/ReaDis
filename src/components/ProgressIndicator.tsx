import React from 'react';

interface ProgressIndicatorProps {
  progress: number;
  message?: string;
  fileName?: string;
  fileSize?: number;
  isVisible: boolean;
  showDetails?: boolean;
  estimatedTimeRemaining?: number;
}

export const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({
  progress,
  message,
  fileName,
  fileSize,
  isVisible,
  showDetails = true,
  estimatedTimeRemaining
}) => {
  if (!isVisible) return null;

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
  };

  const getProgressColor = (progress: number): string => {
    if (progress < 30) return 'bg-red-500';
    if (progress < 70) return 'bg-yellow-500';
    return 'bg-brand-500';
  };

  const getProgressMessage = (progress: number, message?: string): string => {
    if (message) return message;
    
    if (progress < 10) return 'Initializing...';
    if (progress < 30) return 'Reading file...';
    if (progress < 70) return 'Processing content...';
    if (progress < 90) return 'Finalizing...';
    return 'Almost done...';
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
        {/* Header */}
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-gray-900 mb-1">
            Processing Large File
          </h3>
          {fileName && (
            <p className="text-sm text-gray-600 truncate" title={fileName}>
              {fileName}
            </p>
          )}
          {fileSize && showDetails && (
            <p className="text-xs text-gray-500">
              Size: {formatFileSize(fileSize)}
            </p>
          )}
        </div>

        {/* Progress Bar */}
        <div className="mb-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-gray-700">
              {getProgressMessage(progress, message)}
            </span>
            <span className="text-sm font-medium text-gray-900">
              {Math.round(progress)}%
            </span>
          </div>
          
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div
              className={`h-3 rounded-full transition-all duration-300 ease-out ${
                getProgressColor(progress)
              }`}
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            >
              <div className="h-full bg-white bg-opacity-30 rounded-full animate-pulse" />
            </div>
          </div>
        </div>

        {/* Details */}
        {showDetails && (
          <div className="space-y-2 text-xs text-gray-600">
            {estimatedTimeRemaining && estimatedTimeRemaining > 0 && (
              <div className="flex justify-between">
                <span>Estimated time remaining:</span>
                <span className="font-medium">
                  {formatTime(estimatedTimeRemaining)}
                </span>
              </div>
            )}
            
            <div className="flex justify-between">
              <span>Processing method:</span>
              <span className="font-medium">
                {fileSize && fileSize > 25 * 1024 * 1024 
                  ? 'Web Worker (Background)'
                  : fileSize && fileSize > 10 * 1024 * 1024
                  ? 'Chunked Processing'
                  : 'Standard Processing'
                }
              </span>
            </div>
            
            {progress > 0 && progress < 100 && (
              <div className="mt-3 p-2 bg-brand-50 rounded border-l-4 border-brand-400">
                <p className="text-brand-700 text-xs">
                  💡 Large files are processed in the background to keep the app responsive.
                  You can continue using other features while this completes.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Warning for very large files */}
        {fileSize && fileSize > 50 * 1024 * 1024 && (
          <div className="mt-3 p-2 bg-yellow-50 rounded border-l-4 border-yellow-400">
            <p className="text-yellow-700 text-xs">
              ⚠️ This is a very large file ({formatFileSize(fileSize)}). 
              Processing may take several minutes.
            </p>
          </div>
        )}

        {/* Loading animation */}
        <div className="mt-4 flex justify-center">
          <div className="flex space-x-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-2 h-2 bg-brand-500 rounded-full animate-bounce"
                style={{
                  animationDelay: `${i * 0.1}s`,
                  animationDuration: '0.6s'
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProgressIndicator;