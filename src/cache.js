// Simple in-memory cache with TTL
const store = new Map();

export function cacheGet(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

export function cacheSet(key, value, ttlMs = 15 * 60 * 1000) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}
