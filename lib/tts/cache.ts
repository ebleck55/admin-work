/**
 * In-memory LRU cache for short TTS payloads. Ported from learning-quest-grade5/lib/tts.ts.
 * Capacity 150 entries; eviction on insert.
 */

const CAPACITY = 150;

interface CachedAudio {
  audioContent: string; // base64
  voice: string;
  cachedAt: number;
}

const cache = new Map<string, CachedAudio>();

export function cacheKey(text: string, voice: string): string {
  return `${voice}::${text}`;
}

export function get(key: string): CachedAudio | undefined {
  const v = cache.get(key);
  if (!v) return undefined;
  // LRU touch
  cache.delete(key);
  cache.set(key, v);
  return v;
}

export function put(key: string, value: Omit<CachedAudio, "cachedAt">): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, { ...value, cachedAt: Date.now() });
  while (cache.size > CAPACITY) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function clear(): void {
  cache.clear();
}
