// lib/normalize.js

/** Canonical model-key normalizer (do NOT strip 'new' so 'newport' stays intact) */
export function normalizeModelKey(title = "") {
  let s = String(title).toLowerCase();

  // remove quotes variants and unicode inches
  s = s.replace(/[“”„‟]/g, '"').replace(/[’‘]/g, "'").replace(/[″”]/g, '"');

  // strip length measurements: 33", 35'', 34 in, 32-36 in, etc.
  s = s.replace(/\b(3[2-9]|40)(\s*-\s*(3[2-9]|40))?\s*(?:in|inch|inches|["']{1,2})\b/g, " ");

  // strip handedness tokens
  s = s
    .replace(/\b(right|left)[-\s]*hand(?:ed)?\b/g, " ")
    .replace(/\b(?:rh|lh)\b/g, " ");

  // strip obvious condition/descriptors that shouldn't affect the model key
  s = s.replace(
    /\b(very\s+good|like\s*new|mint|new|value|milled|ladies|women'?s|men'?s)\b/g,
    " "
  );

  // compress spaces, trim
  s = s.replace(/[^a-z0-9+#.\- ]+/g, " ").replace(/\s{2,}/g, " ").trim();

  // optional: short known model aliases normalization (add as you go)
  s = s
    .replace(/\bsquareback\s*#?\s*2\b/g, "squareback 2")
    .replace(/\bnewport\s*#?\s*2\.?5\b/g, "newport 2.5")
    .replace(/\bphantom\s*x\s*5\.?5\b/g, "phantom x 5.5");

  return s;
}

/** Temporary helper to tolerate legacy bad keys in analytics */
export function degradeKeyForKnownBugs(k = '') {
  // historical bug mapped "newport" -> "port"
  return k.replace(/\bnewport\b/g, 'port');
}
