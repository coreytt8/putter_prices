// lib/normalize.js

/** Canonical model-key normalizer (do NOT strip 'new' so 'newport' stays intact) */
export function normalizeModelKey(title = '') {
  return String(title || '')
    .toLowerCase()
    // remove brands & noise but keep intrinsic model tokens like "newport"
    .replace(
      /scotty\s*cameron|titleist|odyssey|taylormade|ping|bettinardi|toulon|evnroll|l\.?a\.?b\.?|lab\s+golf|mizuno|wilson|sik|putter|golf|\b(rh|lh)\b|right\s*hand(?:ed)?|left\s*hand(?:ed)?/g,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Temporary helper to tolerate legacy bad keys in analytics */
export function degradeKeyForKnownBugs(k = '') {
  // historical bug mapped "newport" -> "port"
  return k.replace(/\bnewport\b/g, 'port');
}
