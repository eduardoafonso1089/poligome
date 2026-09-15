export class LruCache<T> {
  private readonly entries = new Map<string, T>();

  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("cacheLimit");
  }

  get size() {
    return this.entries.size;
  }

  get(key: string): T | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: T) {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  has(key: string) {
    return this.entries.has(key);
  }

  keys() {
    return [...this.entries.keys()];
  }

  clear() {
    this.entries.clear();
  }
}

export const COG_TILE_CACHE_LIMIT = 64;
