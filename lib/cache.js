// lib/cache.js

const cache = {};

export function getCached(key) {
  const entry = cache[key];
  if (!entry || entry.expiry < Date.now()) return null;
  return entry.data;
}

export function setCached(key, data, ttlMs = 15 * 60 * 1000) {
  cache[key] = {
    data,
    expiry: Date.now() + ttlMs,
  };
}
