import React from 'react';
import { Play, Pause, Square, Volume2, Mic } from 'lucide-react';
import { SpeechSettings, ReadingSession } from '../types';

interface SpeechControlsProps {
  session: ReadingSession;
  settings: SpeechSettings;
  availableVoices: SpeechSynthesisVoice[];
  onPlay: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onSettingsUpdate: (settings: Partial<SpeechSettings>) => void;
}

export const SpeechControls: React.FC<SpeechControlsProps> = ({
  session,
  settings,
  availableVoices,
  onPlay,
  onPause,
  onResume,
  onStop,
  onSettingsUpdate,
}) => {
  const progressPercentage = session.totalCharacters > 0 
    ? (session.currentPosition / session.totalCharacters) * 100 
    : 0;

  const formatTime = (chars: number, totalChars: number, rate: number) => {
    // Rough estimation: average 5 characters per word, 150 words per minute at rate 1
    const wordsRemaining = (totalChars - chars) / 5;
    const minutesRemaining = wordsRemaining / (150 * rate);
    const minutes = Math.floor(minutesRemaining);
    const seconds = Math.floor((minutesRemaining - minutes) * 60);
    
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-white rounded-xl shadow-lg p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Speech Controls</h3>
      
      {/* Progress Bar */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-gray-600">Progress</span>
          <span className="text-sm text-gray-600">
            {session.totalCharacters > 0 && (
              <>~{formatTime(session.currentPosition, session.totalCharacters, settings.rate)} remaining</>
            )}
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-brand-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${progressPercentage}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>{Math.floor(progressPercentage)}% complete</span>
          <span>{session.totalCharacters} characters</span>
        </div>
      </div>

      {/* Control Buttons */}
      <div className="flex items-center justify-center space-x-4 mb-6">
        <button
          onClick={onStop}
          disabled={!session.content}
          className="p-3 bg-red-100 text-red-600 rounded-full hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
        >
          <Square className="h-5 w-5" />
        </button>
        
        <button
          onClick={() => {
            if (session?.isPlaying) {
              onPause?.();
            } else if (session?.isPaused) {
              onResume?.();
            } else {
              onPlay?.();
            }
          }}
          className="p-4 bg-brand-600 text-white rounded-full hover:bg-brand-700 transition-colors duration-200 shadow-lg"
        >
          {session?.isPlaying ? (
            <Pause className="h-6 w-6" />
          ) : (
            <Play className="h-6 w-6 ml-1" />
          )}
        </button>
      </div>

      {/* Settings */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            <Volume2 className="h-4 w-4 inline mr-1" />
            Speed: {Number.isFinite(settings.rate) ? settings.rate : 1}x
          </label>
          <input
            type="range"
            min="0.1"
            max="3"
            step="0.1"
            value={Number.isFinite(settings.rate) ? settings.rate : 1}
            onChange={(e) => onSettingsUpdate({ rate: parseFloat(e.target.value) })}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>Slow</span>
            <span>Normal</span>
            <span>Fast</span>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Volume: {Math.round((Number.isFinite(settings.volume) ? settings.volume : 1) * 100)}%
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={Number.isFinite(settings.volume) ? settings.volume : 1}
            onChange={(e) => onSettingsUpdate({ volume: parseFloat(e.target.value) })}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
        </div>

        {availableVoices.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <Mic className="h-4 w-4 inline mr-1" />
              Voice
            </label>
            <select
              value={settings.voice?.name || ''}
              onChange={(e) => {
                const voice = availableVoices.find(v => v.name === e.target.value);
                onSettingsUpdate({ voice });
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            >
              <option value="">Default</option>
              {availableVoices.map((voice) => (
                <option key={voice.name} value={voice.name}>
                  {voice.name} ({voice.lang})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
};