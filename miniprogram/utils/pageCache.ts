interface CacheEntry<T> {
  data: T;
  savedAt: number;
}

const cacheStore: Record<string, CacheEntry<any>> = {};

export function readPageCache<T>(key: string, ttlMs: number): T | null {
  const entry = cacheStore[key] as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() - entry.savedAt > ttlMs) {
    delete cacheStore[key];
    return null;
  }
  return entry.data;
}

export function writePageCache<T>(key: string, data: T): void {
  cacheStore[key] = {
    data,
    savedAt: Date.now()
  };
}

