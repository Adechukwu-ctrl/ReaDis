// Intelligent caching system for processed large files
// Reduces processing time by storing and retrieving previously processed content

export interface CacheEntry {
  id: string;
  fileName: string;
  fileSize: number;
  fileHash: string;
  content: string;
  processingMethod: 'standard' | 'chunked' | 'worker' | 'server-side' | 'ocr';
  processingTime: number;
  timestamp: number;
  accessCount: number;
  lastAccessed: number;
  metadata?: {
    totalPages?: number;
    extractedImages?: number;
    fileType?: string;
  };
}

export interface CacheStats {
  totalEntries: number;
  totalSize: number;
  hitRate: number;
  oldestEntry: number;
  newestEntry: number;
}

class FileCache {
  private cache: Map<string, CacheEntry> = new Map();
  private maxEntries: number = 50; // Maximum number of cached files
  private maxSizeBytes: number = 100 * 1024 * 1024; // 100MB total cache size
  private hits: number = 0;
  private misses: number = 0;

  constructor() {
    this.loadFromStorage();
    
    // Clean up cache periodically
    setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  // Generate a hash for file content identification
  private async generateFileHash(file: File): Promise<string> {
    const arrayBuffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Generate cache key from file properties
  private generateCacheKey(fileName: string, fileSize: number, fileHash: string): string {
    return `${fileName}_${fileSize}_${fileHash.substring(0, 16)}`;
  }

  // Check if file is in cache
  async has(file: File): Promise<boolean> {
    try {
      const fileHash = await this.generateFileHash(file);
      const key = this.generateCacheKey(file.name, file.size, fileHash);
      return this.cache.has(key);
    } catch (error) {
      console.warn('Error checking cache:', error);
      return false;
    }
  }

  // Get cached content
  async get(file: File): Promise<CacheEntry | null> {
    try {
      const fileHash = await this.generateFileHash(file);
      const key = this.generateCacheKey(file.name, file.size, fileHash);
      const entry = this.cache.get(key);
      
      if (entry) {
        // Update access statistics
        entry.accessCount++;
        entry.lastAccessed = Date.now();
        this.hits++;
        
        console.log(`Cache HIT for ${file.name} (accessed ${entry.accessCount} times)`);
        return entry;
      } else {
        this.misses++;
        console.log(`Cache MISS for ${file.name}`);
        return null;
      }
    } catch (error) {
      console.warn('Error retrieving from cache:', error);
      this.misses++;
      return null;
    }
  }

  // Store processed content in cache
  async set(
    file: File,
    content: string,
    processingMethod: CacheEntry['processingMethod'],
    processingTime: number,
    metadata?: CacheEntry['metadata']
  ): Promise<void> {
    try {
      const fileHash = await this.generateFileHash(file);
      const key = this.generateCacheKey(file.name, file.size, fileHash);
      
      const entry: CacheEntry = {
        id: key,
        fileName: file.name,
        fileSize: file.size,
        fileHash,
        content,
        processingMethod,
        processingTime,
        timestamp: Date.now(),
        accessCount: 1,
        lastAccessed: Date.now(),
        metadata
      };

      // Check if we need to make space
      await this.ensureSpace(content.length);
      
      this.cache.set(key, entry);
      console.log(`Cached ${file.name} (${processingMethod} method, ${(content.length / 1024).toFixed(1)}KB)`);
      
      // Save to persistent storage
      this.saveToStorage();
    } catch (error) {
      console.warn('Error storing in cache:', error);
    }
  }

  // Ensure there's enough space in cache
  private async ensureSpace(newContentSize: number): Promise<void> {
    const currentSize = this.getCurrentSize();
    const totalSize = currentSize + newContentSize;
    
    if (this.cache.size >= this.maxEntries || totalSize > this.maxSizeBytes) {
      await this.evictLeastUsed();
    }
  }

  // Get current cache size in bytes
  private getCurrentSize(): number {
    let totalSize = 0;
    for (const entry of this.cache.values()) {
      totalSize += entry.content.length;
    }
    return totalSize;
  }

  // Evict least recently used entries
  private async evictLeastUsed(): Promise<void> {
    const entries = Array.from(this.cache.entries());
    
    // Sort by access count (ascending) and last accessed time (ascending)
    entries.sort(([, a], [, b]) => {
      if (a.accessCount !== b.accessCount) {
        return a.accessCount - b.accessCount;
      }
      return a.lastAccessed - b.lastAccessed;
    });

    // Remove the least used entries (remove 25% of cache)
    const entriesToRemove = Math.max(1, Math.floor(entries.length * 0.25));
    
    for (let i = 0; i < entriesToRemove; i++) {
      const [key, entry] = entries[i];
      this.cache.delete(key);
      console.log(`Evicted ${entry.fileName} from cache (accessed ${entry.accessCount} times)`);
    }
  }

  // Clean up old entries
  private cleanup(): void {
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
    
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > maxAge) {
        this.cache.delete(key);
        console.log(`Cleaned up old cache entry: ${entry.fileName}`);
      }
    }
    
    this.saveToStorage();
  }

  // Get cache statistics
  getStats(): CacheStats {
    const entries = Array.from(this.cache.values());
    const totalRequests = this.hits + this.misses;
    
    return {
      totalEntries: this.cache.size,
      totalSize: this.getCurrentSize(),
      hitRate: totalRequests > 0 ? (this.hits / totalRequests) * 100 : 0,
      oldestEntry: entries.length > 0 ? Math.min(...entries.map(e => e.timestamp)) : 0,
      newestEntry: entries.length > 0 ? Math.max(...entries.map(e => e.timestamp)) : 0
    };
  }

  // Clear all cache
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    localStorage.removeItem('fileCache');
    localStorage.removeItem('fileCacheStats');
    console.log('Cache cleared');
  }

  // Save cache to localStorage (for persistence)
  private saveToStorage(): void {
    try {
      const cacheData = {
        entries: Array.from(this.cache.entries()),
        stats: { hits: this.hits, misses: this.misses }
      };
      
      // Only save smaller entries to localStorage (avoid quota exceeded)
      const filteredEntries = cacheData.entries.filter(([, entry]) => 
        entry.content.length < 50000 // Only cache entries < 50KB in localStorage
      );
      
      localStorage.setItem('fileCache', JSON.stringify({
        entries: filteredEntries,
        stats: cacheData.stats
      }));
    } catch (error) {
      console.warn('Could not save cache to localStorage:', error);
    }
  }

  // Load cache from localStorage
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem('fileCache');
      if (stored) {
        const data = JSON.parse(stored);
        
        // Restore cache entries
        for (const [key, entry] of data.entries) {
          this.cache.set(key, entry);
        }
        
        // Restore stats
        if (data.stats) {
          this.hits = data.stats.hits || 0;
          this.misses = data.stats.misses || 0;
        }
        
        console.log(`Loaded ${this.cache.size} entries from cache`);
      }
    } catch (error) {
      console.warn('Could not load cache from localStorage:', error);
    }
  }

  // Get cache entries for debugging
  getEntries(): CacheEntry[] {
    return Array.from(this.cache.values());
  }

  // Check if file should be cached based on size and type
  shouldCache(file: File): boolean {
    const fileSizeMB = file.size / (1024 * 1024);
    
    // Cache files that are large enough to benefit from caching
    // but not so large that they overwhelm the cache
    return fileSizeMB >= 1 && fileSizeMB <= 50;
  }
}

// Export singleton instance
export const fileCache = new FileCache();

// Export utility functions
export const getCacheStats = () => fileCache.getStats();
export const clearCache = () => fileCache.clear();
export const getCacheEntries = () => fileCache.getEntries();