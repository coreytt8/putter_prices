// app/api/putters/route.js
import { NextResponse } from "next/server";

/**
 * ============================
 * Environment / Config
 * ============================
 * Required (set in Vercel Project Settings → Environment Variables):
 * - EBAY_CLIENT_ID
 * - EBAY_CLIENT_SECRET
 * Optional:
 * - EBAY_SCOPE (defaults to 'https://api.ebay.com/oauth/api_scope')
 * - EPN_CAMPID (your eBay Partner Network campaign id)
 * - EPN_TOOLID (often '10079')
 * - EPN_MKCID, EPN_MKRID, EPN_MKEVT (defaults provided)
 * - EPN_CUSTOMID_PREFIX (string to namespace your customid)
 * - API_CACHE_SECONDS (e.g., '90' to enable short-lived server cache)
 */

const EBAY_OAUTH_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const EBAY_BROWSE_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";

// Token cache (in-memory, per lambda container)
let tokenCache = {
  access_token: null,
  expires_at: 0, // epoch ms
};

const BRANDS = [
  "scotty", "cameron", "odyssey", "ping", "taylormade",
  "cleveland", "mizuno", "bettinardi", "evnroll", "lab", "wilson",
  "titleist", "callaway", "cobra", "pxg"
];

const LENGTH_TOKENS = /(^|[^0-9])(33|34|35|36)("|in| inch| inches)?\b/gi;
const WHITESPACE = /\s+/g;

// tiny in-memory result cache (optional; keyed by querystring)
const MEMORY_CACHE = new Map();

/* ============================
 * Utilities
 * ============================
 */

function now() { return Date.now(); }
function clamp(n, lo, hi, d = lo) {
  n = Number.isFinite(+n) ? +n : d;
  return Math.max(lo, Math.min(hi, n));
}
function safeBool(v, def = false) {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return ["1", "true", "yes", "on"].includes(v.toLowerCase());
  return def;
}
function safeStr(v, def = "") {
  return (typeof v === "string" ? v : def).trim();
}
function pick(obj, keys) {
  const o = {};
  for (const k of keys) if (obj[k] !== undefined) o[k] = obj[k];
  return o;
}
function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

function buildCacheKey(url) {
  return url; // request URL already encodes all filters
}

function getCacheSeconds() {
  const s = parseInt(process.env.API_CACHE_SECONDS || "", 10);
  return Number.isFinite(s) && s > 0 ? s : 0;
}

/* ============================
 * OAuth (Client Credentials)
 * ============================
 */
async function getAccessToken() {
  if (tokenCache.access_token && tokenCache.expires_at - 5000 > now()) {
    return tokenCache.access_token;
  }

  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  const scope = process.env.EBAY_SCOPE || "https://api.ebay.com/oauth/api_scope";

  if (!clientId || !clientSecret) {
    throw new Error("Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET env vars.");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope,
  });

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const resp = await fetch(EBAY_OAUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${auth}`,
    },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OAuth error ${resp.status}: ${text.slice(0, 300)}`);
  }

  const data = await resp.json();
  tokenCache = {
    access_token: data.access_token,
    expires_at: now() + (data.expires_in * 1000),
  };
  return tokenCache.access_token;
}

/* ============================
 * Fetch with timeout + retry
 * ============================
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function ebayFetch(url, opts = {}, attempts = 2) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetchWithTimeout(url, opts, 8000);
      if (res.ok) return res;
      // Retry only 5xx
      if (res.status >= 500 && res.status <= 599) {
        await sleep(250 + Math.random() * 400);
        continue;
      }
      const txt = await res.text();
      throw new Error(`eBay ${res.status}: ${txt.slice(0, 300)}`);
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1) break;
      await sleep(250 + Math.random() * 400);
    }
  }
  throw lastErr;
}

/* ============================
 * Affiliate Tagging
 * ============================
 * Preserves existing params, adds/overrides EPN params.
 */
function tagAffiliate(rawUrl, { customid } = {}) {
  try {
    const u = new URL(rawUrl);
    const params = u.searchParams;
    // Defaults (override with env if provided)
    const mkcid = process.env.EPN_MKCID || "1";
    const mkrid = process.env.EPN_MKRID || "711-53200-19255-0";
    const mkevt = process.env.EPN_MKEVT || "1";
    const campid = process.env.EPN_CAMPID || "";
    const toolid = process.env.EPN_TOOLID || "10079";

    if (mkcid) params.set("mkcid", mkcid);
    if (mkrid) params.set("mkrid", mkrid);
    if (mkevt) params.set("mkevt", mkevt);
    if (campid) params.set("campid", campid);
    if (toolid) params.set("toolid", toolid);

    const prefix = process.env.EPN_CUSTOMID_PREFIX || "putteriq";
    if (customid) {
      params.set("customid", `${prefix}-${customid}`.slice(0, 64));
    }

    u.search = params.toString();
    return u.toString();
  } catch {
    return rawUrl;
  }
}

/* ============================
 * Grouping Key
 * ============================
 * Normalize title -> a coarse "modelKey" to group similar listings.
 * - strips brand tokens
 * - strips shaft length tokens (33/34/35/36 inches)
 * - lowercases and collapses whitespace
 */
function modelKey(title, brandGuess) {
  if (!title) return "";

  let s = title.toLowerCase();

  // strip brand words
  for (const b of BRANDS) {
    s = s.replace(new RegExp(`\\b${b}\\b`, "gi"), " ");
  }
  if (brandGuess) {
    s = s.replace(new RegExp(`\\b${brandGuess.toLowerCase()}\\b`, "gi"), " ");
  }

  // remove common noise tokens
  s = s
    .replace(/\b(right|left|hand(ed)?|rh|lh)\b/gi, " ")
    .replace(/\b(putter|golf|new|mint|used|excellent|very good|vgc|nice|rare)\b/gi, " ");

  // remove shaft length tokens
  s = s.replace(LENGTH_TOKENS, " ");

  // collapse to 4 tokens as "coarse model key"
  const tokens = s.replace(/[^\w\s\-\.]/g, " ").replace(WHITESPACE, " ").trim().split(" ");
  const coarse = tokens.filter(Boolean).slice(0, 4).join(" ");
  return coarse || title.toLowerCase();
}

/* ============================
 * Normalization
 * ============================
 */
function normalizeItem(item) {
  // eBay Browse item_summary fields:
  // https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search
  const price = item.price?.value ? Number(item.price.value) : null;
  const currency = item.price?.currency || null;

  // Prefer image from item.image.imageUrl or thumbnailImages[0].imageUrl
  const image =
    item.image?.imageUrl ||
    (Array.isArray(item.thumbnailImages) && item.thumbnailImages[0]?.imageUrl) ||
    null;

  const url = item.itemWebUrl || item.itemHref || null;

  // best available condition text
  const condition = item.condition || item.conditionId || null;

  // Derive brand guess
  const brandGuess = (() => {
    const t = (item.title || "").toLowerCase();
    for (const b of BRANDS) if (t.includes(b)) return b;
    return null;
  })();

  return {
    id: item.itemId || item.itemHref || cryptoRandomId(),
    title: item.title || "",
    price,
    currency,
    image,
    url,
    condition,
    brandGuess,
    seller: item.seller?.username || null,
    buyingOptions: item.buyingOptions || [],
    itemLocation: item.itemLocation || null,
    listingMarketplaceId: item.marketplaceId || null,
    raw: pick(item, ["itemId", "title", "price", "image", "thumbnailImages", "itemWebUrl", "itemHref", "condition", "buyingOptions"]),
  };
}

function cryptoRandomId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

/* ============================
 * Search Param Parsing
 * ============================
 */
function parseQueryParams(searchParams) {
  const q = safeStr(searchParams.get("q"));
  const page = clamp(searchParams.get("page"), 1, 1000, 1);
  const perPage = clamp(searchParams.get("perPage"), 4, 50, 16);

  const condition = safeStr(searchParams.get("condition")); // "USED", "NEW", etc.
  const buying = safeStr(searchParams.get("buying")); // "FIXED_PRICE", "AUCTION", "BEST_OFFER"
  const minPrice = Number.isFinite(+searchParams.get("min")) ? +searchParams.get("min") : undefined;
  const maxPrice = Number.isFinite(+searchParams.get("max")) ? +searchParams.get("max") : undefined;

  const broaden = safeBool(searchParams.get("broaden"), false);
  const onlyComplete = safeBool(searchParams.get("onlyComplete"), false);
  const sort = safeStr(searchParams.get("sort")) || "bestprice"; // "bestprice" | "newly" | "priceasc" | "pricedesc"

  return { q, page, perPage, condition, buying, minPrice, maxPrice, broaden, onlyComplete, sort };
}

/* ============================
 * eBay Browse Search
 * ============================
 */
function buildEbayQuery({ q, condition, buying, minPrice, maxPrice, page, perPage, broaden, onlyComplete }) {
  // eBay q string — we can inject simple filters as keywords (e.g., -"head only")
  let query = q;
  if (!query) query = "golf putter";

  if (onlyComplete) {
    // bias against heads-only listings
    query += ' -"head only" -"head-only" -"head-only" -"head-only"';
  }

  const url = new URL(EBAY_BROWSE_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(perPage));
  url.searchParams.set("offset", String((page - 1) * perPage));
  url.searchParams.set("fieldgroups", "ASPECT_REFINEMENTS"); // include facets (optional)

  // Filters:
  const filters = [];
  if (condition) filters.push(`conditions:{${condition}}`);
  if (buying) filters.push(`buyingOptions:{${buying}}`);
  if (Number.isFinite(minPrice) || Number.isFinite(maxPrice)) {
    const lo = Number.isFinite(minPrice) ? minPrice : 0;
    const hi = Number.isFinite(maxPrice) ? maxPrice : 99999;
    filters.push(`price:[${lo}..${hi}]`);
  }
  if (filters.length) url.searchParams.set("filter", filters.join(","));

  // Sort — eBay Browse supports price, newlyListed, etc.
  // We'll map our UI sort keys to eBay sorts where possible
  switch ((String(broaden ? "newly" : sort)).toLowerCase()) {
    case "priceasc":
      url.searchParams.set("sort", "price");
      break;
    case "pricedesc":
      url.searchParams.set("sort", "-price");
      break;
    case "newly":
      url.searchParams.set("sort", "newlyListed");
      break;
    default:
      // Let backend post-process "best price" by grouping later
      break;
  }

  return url.toString();
}

/* ============================
 * Main Handler
 * ============================
 */

export const dynamic = "force-dynamic"; // disable Next cache by default; see API_CACHE_SECONDS below

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const params = parseQueryParams(searchParams);

    if (!params.q) {
      return NextResponse.json(
        { ok: false, error: "Missing required query parameter 'q'." },
        { status: 400 }
      );
    }

    // Optional short-lived cache (in-memory). Enable by setting API_CACHE_SECONDS.
    const cacheSeconds = getCacheSeconds();
    const ebayUrl = buildEbayQuery(params);
    const cacheKey = buildCacheKey(ebayUrl);

    if (cacheSeconds > 0) {
      const cached = MEMORY_CACHE.get(cacheKey);
      if (cached && cached.expires_at > now()) {
        return NextResponse.json(cached.payload, {
          headers: { "x-cache": "HIT" },
        });
      }
    }

    const token = await getAccessToken();
    const res = await ebayFetch(ebayUrl, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    const data = await res.json();
    const items = Array.isArray(data.itemSummaries) ? data.itemSummaries : [];

    // Normalize, filter out unusable rows (no price or image)
    const norm = items
      .map(normalizeItem)
      .filter(x => Number.isFinite(x.price) && x.image && x.url);

    // Group by modelKey
    const buckets = new Map();
    for (const it of norm) {
      const key = modelKey(it.title, it.brandGuess);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(it);
    }

    // Reduce each bucket to a "card": best price, count, repr image, sample sellers
    const cards = [];
    for (const [key, arr] of buckets.entries()) {
      arr.sort((a, b) => (a.price ?? 1e12) - (b.price ?? 1e12)); // ascending price
      const best = arr[0];

      // Tag affiliate on outbound URL, with a stable customid
      const customid = key.replace(WHITESPACE, "-").slice(0, 40) || "unknown";
      const bestUrl = tagAffiliate(best.url, { customid });

      cards.push({
        modelKey: key,
        title: best.title,
        bestPrice: best.price,
        currency: best.currency || "USD",
        count: arr.length,
        image: best.image,
        bestUrl,
        sampleSellers: arr.slice(0, 3).map(s => s.seller).filter(Boolean),
      });
    }

    // Sort cards for UI
    switch (params.sort.toLowerCase()) {
      case "pricedesc":
        cards.sort((a, b) => (b.bestPrice ?? 0) - (a.bestPrice ?? 0));
        break;
      case "newly":
        // if needed, change upstream sort to newlyListed and keep as-is
        break;
      default: // "bestprice"
        cards.sort((a, b) => (a.bestPrice ?? 0) - (b.bestPrice ?? 0));
    }

    const payload = {
      ok: true,
      meta: {
        total: data.total || norm.length,
        returned: norm.length,
        cards: cards.length,
        page: params.page,
        perPage: params.perPage,
        broaden: params.broaden,
        sort: params.sort,
        source: "ebay-browse",
      },
      cards,
      // If you still need flat items for a "list" view, you can include them:
      // items: norm.map(it => ({ ...it, url: tagAffiliate(it.url, { customid: "list" }) })),
    };

    if (cacheSeconds > 0) {
      MEMORY_CACHE.set(cacheKey, {
        expires_at: now() + cacheSeconds * 1000,
        payload,
      });
    }

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": cacheSeconds > 0
          ? `public, max-age=${cacheSeconds}`
          : "no-store",
        "x-cache": cacheSeconds > 0 ? "MISS" : "DISABLED",
      },
    });
  } catch (err) {
    const message = err?.message || "Unknown error";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
