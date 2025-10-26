// Simple blob URL manager with reference counting
// Use register(url) when creating an object URL, and release(url) when it is no longer needed.
// Call revokeAll() on app unmount to clean up any remaining URLs.

class BlobUrlManager {
  private refs: Map<string, number> = new Map();

  isBlobUrl(url?: string | null): boolean {
    return !!url && url.startsWith("blob:");
  }

  register(url: string): void {
    if (!this.isBlobUrl(url)) return;
    const count = this.refs.get(url) ?? 0;
    this.refs.set(url, count + 1);
  }

  retain(url: string): void {
    this.register(url);
  }

  release(url: string): void {
    if (!this.isBlobUrl(url)) return;
    const count = this.refs.get(url);
    if (count == null) return;
    if (count <= 1) {
      this.refs.delete(url);
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    } else {
      this.refs.set(url, count - 1);
    }
  }

  revoke(url: string): void {
    if (!this.isBlobUrl(url)) return;
    this.refs.delete(url);
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }

  revokeAll(): void {
    for (const url of Array.from(this.refs.keys())) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }
    this.refs.clear();
  }
}

const blobUrlManager = new BlobUrlManager();
export default blobUrlManager;
