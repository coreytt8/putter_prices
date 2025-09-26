// lib/baseModelStats.js
// Build per-model "base" stats excluding Circle T / limited / tour variants.

export const VARIANT_KEYWORDS = [
  "circle t","tour only","tour issue","tour use","tour dept","tour",
  "prototype","proto","limited","limited run","limited edition","le",
  "garage","my girl","009","009m","009h","gss","button back","hive",
  "damascus","dass","pld","small batch","custom shop","tiffany","snow"
].map(s => s.toLowerCase());

export function normalizeModel(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/scotty|cameron|titleist|putter|golf/gi, "")
    .replace(/\s+/g," ")
    .trim();
}

export function isVariant(title = "") {
  const t = String(title || "").toLowerCase();
  return VARIANT_KEYWORDS.some(k => t.includes(k));
}

function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const idx = Math.ceil((p/100)*sorted.length)-1;
  return sorted[Math.max(0,Math.min(idx,sorted.length-1))];
}

export function buildBaseStats(listings) {
  const buckets = new Map();
  for (const o of listings || []) {
    const model = normalizeModel(o?.model || o?.groupModel || o?.title);
    if (!model) continue;
    if (isVariant(o?.title)) continue; // exclude collectible variants from the base cohort
    const price = Number(o?.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    if (!buckets.has(model)) buckets.set(model, []);
    buckets.get(model).push(price);
  }

  const stats = {};
  for (const [m, prices] of buckets.entries()) {
    const arr = prices.slice().sort((a,b)=>a-b);
    if (arr.length < 4) continue;
    stats[m] = {
      n: arr.length,
      p10: percentile(arr,10),
      p25: percentile(arr,25),
      p50: percentile(arr,50),
      p75: percentile(arr,75),
      p90: percentile(arr,90),
      dispersionRatio: (() => {
        const p10 = percentile(arr,10), p90 = percentile(arr,90), p50 = percentile(arr,50);
        return (Number.isFinite(p10) && Number.isFinite(p90) && p50>0) ? ((p90 - p10)/2)/p50 : 0.35;
      })()
    };
  }
  return stats;
}
