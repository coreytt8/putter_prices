// lib/variant-detect.js
// Generic variant detection for ALL brands/models.
// Heavily title-driven; extend TAG_RULES for more brands as needed.

/**
 * TAG_RULES: brand-agnostic keywords first, then brand-specific.
 * Each rule adds one or more tags when it matches.
 * Tags should be stable, lowercase, snake_case (e.g., "circle_t", "gss").
 */
const TAG_RULES = [
  // Brand-agnostic premium signals
  { any: ["tour only", "tour use only", "tour putter"], add: ["tour_only"] },
  { any: ["limited", "limited release", "special select jet set"], add: ["limited"] },
  { any: ["prototype", "proto"], add: ["prototype"] },
  { any: ["welded neck", "welded flow", "welded"], add: ["welded_neck"] },
  { any: ["gss", "german stainless"], add: ["gss"] },
  { any: ["tungsten"], add: ["tungsten"] },
  { any: ["carbon steel"], add: ["carbon_steel"] },
  { any: ["raw finish", "raw"], add: ["raw"] },

  // Scotty Cameron specifics
  { any: ["circle t", "circle-t", "☉t", "tour dot", "ct "], add: ["circle_t", "tour_only"] },
  { any: ["009m", " 009 ", " 009m "], add: ["009"] },
  { any: ["timeless"], add: ["timeless"] },
  { any: ["masterful"], add: ["masterful"] },
  { any: ["super rat"], add: ["super_rat"] },
  { any: ["tei3", "teryllium"], add: ["tei3"] },
  { any: ["button back"], add: ["button_back"] },
  { any: ["jet set"], add: ["jet_set"] },
  { any: ["cherry bomb"], add: ["tour_stamp"] },
  { any: ["coa"], add: ["coa"] },

  // Ping examples
  { any: ["anser prototype"], add: ["prototype"] },
  { any: ["vault", "pld limited"], add: ["limited"] },

  // Odyssey examples
  { any: ["tour issue", "tour department"], add: ["tour_only"] },
  { any: ["toulon small batch"], add: ["limited"] },

  // L.A.B. examples
  { any: ["df3 black lab limited"], add: ["limited"] },
];

const NEGATIVE_TITLE_HINTS = [
  "headcover only", "cover only", "weight kit", "weights only",
  "grip only", "shaft only", "head only"
];

function normalizeStr(x) { return String(x || "").toLowerCase(); }

export function detectVariantSignals({ title = "", aspects = {} }) {
  const t = normalizeStr(title);
  const isAccessoryOnly = NEGATIVE_TITLE_HINTS.some(n => t.includes(n));
  if (isAccessoryOnly) return [];

  const tags = new Set();
  for (const rule of TAG_RULES) {
    if (rule.any?.some((kw) => t.includes(kw))) {
      rule.add.forEach(tag => tags.add(tag));
    }
  }

  // Aspects-based hints
  const aspectVals = Object.values(aspects || {}).map(normalizeStr);
  const aspectConcat = aspectVals.join(" | ");
  if (/tour/.test(aspectConcat)) tags.add("tour_only");
  if (/certificate|coa/.test(aspectConcat)) tags.add("coa");

  return Array.from(tags);
}

export function buildVariantKey(baseModel, tags) {
  if (!tags?.length) return "";
  const sorted = [...new Set(tags)].sort();
  return `${String(baseModel || "").toLowerCase()}|${sorted.join("|")}`;
}
