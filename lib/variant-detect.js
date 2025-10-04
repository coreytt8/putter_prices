// lib/variant-detect.js

const NEGATIVE_TITLE_HINTS = [
  "headcover only",
  "cover only",
  "weight kit",
  "weights only",
  "grip only",
  "shaft only",
  "head only",
];

function normalizeStr(x) {
  return String(x || "").toLowerCase();
}

export function detectVariantTags(title = "") {
  const t = normalizeStr(title);
  const tags = new Set();

  if (NEGATIVE_TITLE_HINTS.some((hint) => t.includes(hint))) return [];

  // Scotty Cameron signals
  if (/\bcircle\s*t\b|\bct\b/.test(t)) tags.add("circle_t").add("tour_only");
  if (/\bgss\b/.test(t)) tags.add("gss");
  if (/\b009\b/.test(t)) tags.add("009");
  if (/button\s*back/.test(t)) tags.add("button_back");
  if (/\btei-?3\b/.test(t)) tags.add("tei3");
  if (/\bgarage\b/.test(t)) tags.add("garage");
  if (/\blimited\b|\bltd\b|\blimited\s+edition\b/.test(t)) tags.add("limited");
  if (/tour\s+(issue|only)/.test(t)) tags.add("tour_only");

  // Generic cues (keep conservative)
  if (/\b(counterbalance|cb)\b/.test(t)) tags.add("counterbalance");
  if (/\bflow\s*neck|\b1\.5\b/.test(t)) tags.add("flow_neck");
  if (/\bplatinum\b/.test(t)) tags.add("platinum");

  return Array.from(tags);
}

export function detectVariantSignals({ title = "", aspects = {} } = {}) {
  const normalizedTitle = normalizeStr(title);
  const tags = new Set(detectVariantTags(title));
  if (tags.size === 0 && NEGATIVE_TITLE_HINTS.some((hint) => normalizedTitle.includes(hint))) {
    return [];
  }

  const aspectVals = Object.values(aspects || {}).map(normalizeStr);
  const aspectConcat = aspectVals.join(" | ");
  if (/tour/.test(aspectConcat)) tags.add("tour_only");
  if (/certificate|coa/.test(aspectConcat)) tags.add("coa");

  return Array.from(tags);
}

export function buildVariantKey(modelKey = "", tags = []) {
  const core = normalizeStr(modelKey).trim();
  const deduped = Array.from(
    new Set(
      (tags || [])
        .map((s) => normalizeStr(s).trim())
        .filter(Boolean)
    )
  );
  if (!core) return "";
  if (deduped.length === 0) return "";
  return [core, ...deduped.sort()].join("|");
}
