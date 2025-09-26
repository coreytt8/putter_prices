// lib/baseModelStats.js
// Build per-model market stats EXCLUDING “limited / variant” keywords.

const VARIANT_KEYWORDS = [
  "circle t","tour","prototype","proto","limited","limited run","le",
  "garage","my girl","009","009m","009h","gss","button back","hive",
  "damascus","dass","pld","small batch","custom shop"
].map(x => x.toLowerCase());

function normalizeModel(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/scotty|cameron|titleist|putter|golf/gi, "")
    .replace(/\s+/g," ")
    .trim();
}

function isVariant(title="") {
  const t = title.toLowerCase();
  return VARIANT_KEYWORDS.some(k => t.includes(k));
}

function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const idx = Math.ceil((p/100)*sorted.length)-1;
  return sorted[Math.max(0,Math.min(idx,sorted.length-1))];
}

export function buildBaseStats(listings) {
  const buckets = new Map();
  for (const o of listings) {
    const model = normalizeModel(o.model || o.title);
    if (!model) continue;
    if (isVariant(o.title)) continue;       // exclude Circle-T, limited, etc.
    const price = Number(o.price);
    if (!Number.isFinite(price) || price<=0) continue;
    if (!buckets.has(model)) buckets.set(model, []);
    buckets.get(model).push(price);
  }

  const stats = {};
  for (const [m, prices] of buckets.entries()) {
    prices.sort((a,b)=>a-b);
    if (prices.length < 4) continue;        // need enough comps
    stats[m] = {
      n: prices.length,
      p10: percentile(prices,10),
      p25: percentile(prices,25),
      p50: percentile(prices,50),
      p75: percentile(prices,75),
      p90: percentile(prices,90),
    };
  }
  return stats;
}
