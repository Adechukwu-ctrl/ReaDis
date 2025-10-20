import { useState, useRef, useCallback, useEffect } from 'react';
import { SpeechSettings, ReadingSession } from '../types';

export const useSpeechSynthesis = () => {
  const [session, setSession] = useState<ReadingSession>({
    content: '',
    currentPosition: 0,
    isPlaying: false,
    isPaused: false,
    totalCharacters: 0,
  });
  
  const [settings, setSettings] = useState<SpeechSettings>({
    rate: 1,
    pitch: 1,
    volume: 1,
  });
  
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const chunksRef = useRef<string[]>([]);
  const currentChunkIndexRef = useRef(0);
  const accumulatedCharactersRef = useRef(0);
  const isChunkedPlaybackRef = useRef(false);
  const isStoppingRef = useRef(false);
  const lastCancelAtRef = useRef(0);
  const actionLockRef = useRef(false);

  // Load available voices
  useEffect(() => {
    const loadVoices = () => {
      const voices = speechSynthesis.getVoices();
      setAvailableVoices(voices);
      
      // Set default voice (prefer English voices)
      const englishVoice = voices.find(voice => voice.lang.startsWith('en'));
      if (englishVoice && !settings.voice) {
        setSettings(prev => ({ ...prev, voice: englishVoice }));
      }
    };

    loadVoices();
    speechSynthesis.addEventListener('voiceschanged', loadVoices);

    return () => {
      speechSynthesis.removeEventListener('voiceschanged', loadVoices);
    };
  }, [settings.voice]);

  const chunkTextForSpeech = useCallback((text: string, maxChunkSize: number = 32000): string[] => {
    if (text.length <= maxChunkSize) {
      return [text];
    }

    const chunks: string[] = [];
    let currentIndex = 0;

    while (currentIndex < text.length) {
      let chunkEnd = Math.min(currentIndex + maxChunkSize, text.length);
      
      // Try to break at sentence boundaries
      if (chunkEnd < text.length) {
        const sentenceBreak = text.lastIndexOf('.', chunkEnd);
        const questionBreak = text.lastIndexOf('?', chunkEnd);
        const exclamationBreak = text.lastIndexOf('!', chunkEnd);
        
        const bestBreak = Math.max(sentenceBreak, questionBreak, exclamationBreak);
        if (bestBreak > currentIndex + maxChunkSize * 0.5) {
          chunkEnd = bestBreak + 1;
        } else {
          // Fall back to word boundaries
          const wordBreak = text.lastIndexOf(' ', chunkEnd);
          if (wordBreak > currentIndex + maxChunkSize * 0.5) {
            chunkEnd = wordBreak;
          }
        }
      }
      
      chunks.push(text.slice(currentIndex, chunkEnd).trim());
      currentIndex = chunkEnd;
    }

    return chunks.filter(chunk => chunk.length > 0);
  }, []);

  const speakNextChunk = useCallback(() => {
    if (currentChunkIndexRef.current >= chunksRef.current.length) {
      setSession(prev => ({
        ...prev,
        isPlaying: false,
        isPaused: false,
        currentPosition: prev.totalCharacters,
      }));
      isChunkedPlaybackRef.current = false;
      return;
    }

    const chunk = chunksRef.current[currentChunkIndexRef.current];
    const utterance = new SpeechSynthesisUtterance(chunk);
    
    utterance.rate = settings.rate;
    utterance.pitch = settings.pitch;
    utterance.volume = settings.volume;
    // Apply voice and language explicitly to improve compatibility on Windows
    if (settings.voice?.lang) {
      try {
        utterance.lang = settings.voice.lang;
      } catch {}
    }
    utterance.voice = settings.voice || null;

    utterance.onboundary = (event) => {
      if (event.name === 'word') {
        setSession(prev => ({
          ...prev,
          currentPosition: accumulatedCharactersRef.current + event.charIndex,
        }));
      }
    };

    utterance.onend = () => {
      accumulatedCharactersRef.current += chunk.length;
      currentChunkIndexRef.current++;
      
      // Small delay between chunks to ensure smooth transition
      setTimeout(() => {
        if (isChunkedPlaybackRef.current) {
          speakNextChunk();
        }
      }, 50);
    };

    utterance.onerror = (event) => {
      const recentlyCanceled = Date.now() - lastCancelAtRef.current < 1000;
      // Ignore expected 'interrupted' errors from intentional cancel/pause/resume
      if (event.error === 'interrupted' && (isStoppingRef.current || recentlyCanceled)) {
        isChunkedPlaybackRef.current = false;
        return;
      }

      console.error('Speech synthesis error:', event.error);
      isChunkedPlaybackRef.current = false;
      // Only flip session flags if this wasn't a controlled interruption
      if (!isStoppingRef.current && !recentlyCanceled) {
        setSession(prev => ({ ...prev, isPlaying: false, isPaused: false }));
      }
    };

    utteranceRef.current = utterance;
     speechSynthesis.speak(utterance);
   }, [settings.rate, settings.pitch, settings.volume, settings.voice]);

  const startReading = useCallback((content: string, fromPosition: number = 0) => {
    if (!content) return;

    // Reset stopping flag
    isStoppingRef.current = false;
    
    // Stop any current speech
    try {
      lastCancelAtRef.current = Date.now();
      speechSynthesis.cancel();
    } catch {}
    isChunkedPlaybackRef.current = false;

    const textToRead = content.slice(fromPosition);
    const chunks = chunkTextForSpeech(textToRead);
    
    // Store chunks and reset counters
    chunksRef.current = chunks;
    currentChunkIndexRef.current = 0;
    accumulatedCharactersRef.current = fromPosition;
    isChunkedPlaybackRef.current = true;

    // Initialize session
    setSession(prev => ({
      ...prev,
      content,
      isPlaying: true,
      isPaused: false,
      totalCharacters: content.length,
      currentPosition: fromPosition,
    }));

    speakNextChunk();
   }, [chunkTextForSpeech, speakNextChunk]);

  const pauseReading = useCallback(() => {
    if (actionLockRef.current) return;
    actionLockRef.current = true;

    // Attempt native pause first
    try {
      speechSynthesis.pause();
    } catch {}
    isChunkedPlaybackRef.current = false;
    setSession(prev => ({
      ...prev,
      isPlaying: false,
      isPaused: true,
    }));

    // Fallback: if pause didn’t take effect, enforce stop
    setTimeout(() => {
      try {
        if (!speechSynthesis.paused && speechSynthesis.speaking) {
          // Force immediate stop without losing currentPosition
          isStoppingRef.current = true;
          lastCancelAtRef.current = Date.now();
          speechSynthesis.cancel();
          isStoppingRef.current = false;
        }
      } catch {}
      actionLockRef.current = false;
    }, 120);
  }, []);

  const resumeReading = useCallback(() => {
    if (session.isPaused && chunksRef.current.length > 0) {
      if (actionLockRef.current) return;
      actionLockRef.current = true;

      const fromPosition = session.currentPosition;
      const content = session.content;
      // Restart playback from current position to apply latest settings/voice
      isStoppingRef.current = true;
      try {
        lastCancelAtRef.current = Date.now();
        speechSynthesis.cancel();
      } catch {}
      isStoppingRef.current = false;
      isChunkedPlaybackRef.current = false;
      startReading(content, fromPosition);
      setSession(prev => ({
        ...prev,
        isPlaying: true,
        isPaused: false,
      }));

      setTimeout(() => { actionLockRef.current = false; }, 120);
    }
  }, [session.isPaused, session.currentPosition, session.content, startReading]);

  const stopReading = useCallback(() => {
    isStoppingRef.current = true;
    try {
      lastCancelAtRef.current = Date.now();
      speechSynthesis.cancel();
    } catch {}
    isChunkedPlaybackRef.current = false;
    chunksRef.current = [];
    currentChunkIndexRef.current = 0;
    accumulatedCharactersRef.current = 0;
    
    setSession(prev => ({
      ...prev,
      isPlaying: false,
      isPaused: false,
      currentPosition: 0,
    }));
    
    // Reset stopping flag after a longer delay to ensure all error events are caught
    setTimeout(() => {
      isStoppingRef.current = false;
    }, 500);
  }, []);

  const updateSettings = useCallback((newSettings: Partial<SpeechSettings>) => {
    setSettings(prev => ({ ...prev, ...newSettings }));
  }, []);

  // Apply voice/setting changes immediately during playback
  useEffect(() => {
    if (session.isPlaying && !session.isPaused) {
      const fromPosition = session.currentPosition;
      const content = session.content;
      // Cancel current utterance and restart at current position with new settings
      isStoppingRef.current = true;
      try {
        lastCancelAtRef.current = Date.now();
        speechSynthesis.cancel();
      } catch {}
      isStoppingRef.current = false;
      isChunkedPlaybackRef.current = false;
      startReading(content, fromPosition);
    }
  }, [settings.voice, settings.rate, settings.pitch, settings.volume]);

  return {
    session,
    settings,
    availableVoices,
    startReading,
    pauseReading,
    resumeReading,
    stopReading,
    updateSettings,
  };
};