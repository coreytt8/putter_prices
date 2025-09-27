/* eslint-disable no-console */
// pages/api/model-stats.js
// Server-side market stats for models, excluding Circle-T / tour / limited variants.
// Supports both batch (?model=A&model=B) and single (?model=A&condition=NEW).

/**
 * ENV (same as your Browse API route):
 * EBAY_CLIENT_ID
 * EBAY_CLIENT_SECRET
 * EBAY_SITE=EBAY_US
 */

const EBAY_BROWSE_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const EBAY_SITE = process.env.EBAY_SITE || "EBAY_US";

// -------------------- Token cache --------------------
let _tok = { val: null, exp: 0 };

async function getEbayToken() {
  const now = Date.now();
  if (_tok.val && now < _tok.exp) return _tok.val;

  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Missing EBAY_CLIENT_ID/EBAY_CLIENT_SECRET");

  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`eBay OAuth ${res.status}: ${txt}`);
  }
  const json = await res.json();
  const ttl = (json.expires_in || 7200) * 1000;
  _tok = { val: json.access_token, exp: Date.now() + ttl - 10 * 60 * 1000 };
  return _tok.val;
}

// -------------------- Helpers --------------------
const safeNum = (n) => {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
};

function norm(s) {
  return String(s || "").trim().toLowerCase();
}

function normalizeSearchQ(q = "") {
  let s = String(q || "").trim();
  if (!s) return s;
  s = s.replace(/\bputters\b/gi, "putter");
  if (!/\bputter\b/i.test(s)) s = `${s} putter`;
  s = s.replace(/\b(putter)(\s+\1)+\b/gi, "putter");
  return s.replace(/\s+/g, " ").trim();
}

function normalizeModel(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/scotty|cameron|titleist|putter|golf/gi, "")
    .replace(/\s+/g," ")
    .trim();
}

const VARIANT_KEYWORDS = [
  "circle t","tour only","tour issue","tour use","tour dept","tour",
  "prototype","proto","limited","limited run","limited edition","le",
  "garage","my girl","009","009m","009h","gss","button back","hive",
  "damascus","dass","pld","small batch","custom shop","tiffany","snow"
].map(s => s.toLowerCase());

function isVariantTitle(title="") {
  const t = norm(title);
  return VARIANT_KEYWORDS.some(k => t.includes(k));
}

function isLikelyPutter(item) {
  const title = norm(item?.title);
  if (/\bputter\b/.test(title)) return true;
  const cat = item?.categoryPath || item?.categoryPathIds || item?.categories;
  const asString = JSON.stringify(cat || "").toLowerCase();
  if (asString.includes("putter")) return true;
  const aspects = [
    ...(Array.isArray(item?.itemSpecifics) ? item.itemSpecifics : []),
    ...(Array.isArray(item?.localizedAspects) ? item.localizedAspects : []),
    ...(Array.isArray(item?.additionalProductIdentities) ? item.additionalProductIdentities : []),
  ];
  for (const ent of aspects) {
    const n = norm(ent?.name);
    const v = norm(ent?.value ?? (Array.isArray(ent?.values) ? ent.values[0] : ""));
    if (!n) continue;
    if ((n.includes("putter") || n.includes("head type")) && (v || n.includes("putter"))) {
      return true;
    }
  }
  return false;
}

// --- NEW: better price (always includes shipping if present) ---
function toPrice(item) {
  const price = safeNum(item?.price?.value);
  const ship  = safeNum(item?.shippingOptions?.[0]?.shippingCost?.value);
  if (price == null) return null;
  return ship != null ? price + ship : price;
}

function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const idx = Math.ceil((p/100)*sorted.length)-1;
  return sorted[Math.max(0,Math.min(idx,sorted.length-1))];
}

function computeStats(prices) {
  const arr = prices.slice().filter(x => Number.isFinite(x) && x>0).sort((a,b)=>a-b);
  if (arr.length < 4) return null;
  return {
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

function matchesCondition(item, conditionBand) {
  if (!conditionBand) return true;
  const s = norm(item?.condition || item?.conditionId || item?.conditionDescription || "");
  if (/new/.test(s)) return conditionBand === "NEW" || conditionBand === "LIKE_NEW";
  if (/refurb/.test(s)) return conditionBand.includes("REFURB");
  if (/used|good|fair/.test(s)) return ["USED","GOOD","FAIR","LIKE_NEW"].includes(conditionBand);
  return true;
}

// --- NEW: tokenized base-model matcher (relaxed) ---
function tokenize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s.#+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function isSameBaseModel(title, modelNorm) {
  const titleNorm = normalizeModel(title);
  if (!titleNorm || !modelNorm) return false;
  const toksTitle = tokenize(titleNorm);
  const toksModel = tokenize(modelNorm);
  return toksModel.every(tok => toksTitle.includes(tok));
}

async function fetchEbayBrowse({ q, limit = 50, offset = 0, sort, forceCategory = true }) {
  const token = await getEbayToken();
  const url = new URL(EBAY_BROWSE_URL);
  url.searchParams.set("q", q || "");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("fieldgroups", "EXTENDED");
  if (sort === "newlylisted") url.searchParams.set("sort", "newlyListed");
  if (forceCategory) url.searchParams.set("category_ids", "115280"); // Golf Clubs

  async function call(bearer) {
    return fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${bearer}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-EBAY-C-MARKETPLACE-ID": EBAY_SITE,
        "X-EBAY-C-ENDUSERCTX": `contextualLocation=${EBAY_SITE}`,
      },
    });
  }

  let res = await call(token);
  if (res.status === 401 || res.status === 403) {
    _tok = { val: null, exp: 0 };
    const fresh = await getEbayToken();
    res = await call(fresh);
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`eBay Browse error ${res.status}: ${txt}`);
  }
  return res.json();
}

async function collectListingsForModel(model, { samplePages = 4, sort = "newlylisted" } = {}) {
  const q = normalizeSearchQ(model);
  const limit = 50;
  const calls = [];
  for (let i = 0; i < Math.max(1, Math.min(5, samplePages)); i++) {
    calls.push(fetchEbayBrowse({ q, limit, offset: i * limit, sort, forceCategory: true }));
  }
  const settled = await Promise.allSettled(calls);
  const items = [];
  for (const r of settled) {
    if (r.status === "fulfilled") {
      const arr = Array.isArray(r.value?.itemSummaries) ? r.value.itemSummaries : [];
      items.push(...arr);
    }
  }
  return items.filter(isLikelyPutter);
}

function buildBaseCohort(items, modelNorm, conditionBand) {
  const prices = [];
  for (const it of items) {
    const title = it?.title || "";
    if (isVariantTitle(title)) continue;           // exclude limited/collectible
    if (!matchesCondition(it, conditionBand)) continue;

    // relaxed base model check (token subset)
    if (!isSameBaseModel(title, modelNorm)) continue;

    const p = toPrice(it);
    if (Number.isFinite(p) && p > 0) prices.push(p);
  }
  return prices;
}

// -------------------- API handler --------------------
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method Not Allowed" });

  const sp = req.query;
  const models = []
    .concat(sp.model || [])
    .flat()
    .map(String)
    .filter(Boolean);

  const conditionBand = (sp.condition || "").toString().toUpperCase();
  const samplePages = Math.max(1, Math.min(5, Number(sp.samplePages || 4))); // bumped default

  if (models.length === 0) {
    return res.status(400).json({ ok: false, error: "Missing ?model parameter" });
  }

  try {
    const isBatch = models.length > 1 && !conditionBand;

    if (isBatch) {
      const out = {};
      const jobs = models.map(async (m) => {
        const items = await collectListingsForModel(m, { samplePages, sort: "newlylisted" });
        const modelNorm = normalizeModel(m);
        const prices = buildBaseCohort(items, modelNorm, null);
        const stats = computeStats(prices);
        if (stats) out[m] = stats;
      });
      await Promise.all(jobs);
      return res.status(200).json(out);
    }

    const model = models[0];
    const items = await collectListingsForModel(model, { samplePages, sort: "newlylisted" });
    const modelNorm = normalizeModel(model);
    const prices = buildBaseCohort(items, modelNorm, conditionBand || null);
    const stats = computeStats(prices);
    return res.status(200).json({ model, stats });

  } catch (e) {
    console.error("model-stats error", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
