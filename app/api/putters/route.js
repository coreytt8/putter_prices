import { NextResponse } from "next/server";

// ===== eBay App creds (set in Vercel env) =====
const CLIENT_ID = process.env.EBAY_CLIENT_ID;
const CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;
const MARKETPLACE = process.env.EBAY_MARKETPLACE || "EBAY_US";

// ===== EPN (inline tagging) =====
const EPN_ROVER_PATH = process.env.EPN_ROVER_PATH || "";   // e.g. 711-53200-19255-0
const EPN_CAMPAIGN_ID = process.env.EPN_CAMPAIGN_ID || ""; // e.g. 5339121522

function canonicalEbayItemUrl(raw) {
  try {
    const u = new URL(raw);
    if (!/(^|\.)ebay\.(com|co\.uk|ca|de|fr|it|es|com\.au|co\.jp)$/i.test(u.hostname)) return raw;
    const m = u.pathname.match(/\/itm\/(\d{6,})/);
    if (m && m[1]) return `https://www.ebay.com/itm/${m[1]}`;
    return `${u.origin}${u.pathname}`;
  } catch {
    return raw;
  }
}

function tagInlineEpn(itemUrl, customIdSeed = "") {
  if (!itemUrl || !EPN_ROVER_PATH || !EPN_CAMPAIGN_ID) return itemUrl;
  const base = canonicalEbayItemUrl(itemUrl);
  const u = new URL(base);
  u.searchParams.set("mkcid", "1");
  u.searchParams.set("mkrid", EPN_ROVER_PATH);
  u.searchParams.set("campid", EPN_CAMPAIGN_ID);
  u.searchParams.set("mkevt", "1");
  if (customIdSeed) {
    const safe = customIdSeed.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
    if (safe) u.searchParams.set("customid", safe);
  }
  return u.toString();
}

// ===== OAuth token cache =====
let _token = null;
let _expMs = 0;
async function getAppToken() {
  if (_token && Date.now() < _expMs - 60_000) return _token;
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error("missing_creds");

  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "https://api.ebay.com/oauth/api_scope",
  });

  const r = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` },
    body,
    cache: "no-store",
  });

  if (!r.ok) throw new Error(`oauth_error ${r.status}: ${await r.text()}`);
  const j = await r.json();
  _token = j.access_token;
  _expMs = Date.now() + j.expires_in * 1000;
  return _token;
}

// ===== Normalization / filters =====
function normalizeModelFromTitle(title = "") {
  const t = (title || "").toLowerCase();
  let s = t
    .replace(/\b(33|34|35|36|37|38)\s*("|in|inch|inches)\b/g, " ")
    .replace(/\b(rh|lh|right hand(ed)?|left hand(ed)?)\b/g, " ")
    .replace(/\b(steel|graphite|shaft|grip|headcover|head cover)\b/g, " ")
    .replace(/\b(mens|women'?s|ladies|junior|kids)\b/g, " ")
    .replace(/[^\w\s\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const brands = ["scotty cameron", "taylormade", "ping", "odyssey", "l.a.b.", "lab golf", "lab"];
  let brand = "";
  for (const b of brands) {
    if (s.startsWith(b)) { brand = b; break; }
  }
  const titleCase = (str) => str.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1));
  if (brand) {
    const rest = s.slice(brand.length).trim();
    const words = rest.split(/\s+/).slice(0, 3).join(" ");
    return titleCase((brand + " " + words).trim());
  }
  return titleCase(s.split(/\s+/).slice(0, 4).join(" "));
}

const STOPWORDS = new Set(["the","and","a","an","for","with","of","by","to","from","in","on","at","new","used"]);
function titleMatchesAllKeywords(title, rawQ) {
  if (!rawQ) return true;
  const tokens = rawQ
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((t) => t.trim())
    .filter((t) => t && !STOPWORDS.has(t));
  if (!tokens.length) return true;
  const t = (title || "").toLowerCase();
  return tokens.every((tok) => t.includes(tok));
}

const EXCLUDE_PATTERNS = [
  /\bhead\s*cover\b/i,
  /\bheadcover\b/i,
  /\bcover\s*only\b/i,
  /\bhead\s*only\b/i,
  /\bshaft\s*only\b/i,
  /\bgrip\s*only\b/i,
  /\bweight(s)?\s*(kit|set)?\b/i,
  /\btraining\s*aid\b/i,
  /\balignment\s*(tool|aid)\b/i,
  /\bhead\s*weight(s)?\b/i,
];
function isExcludedTitle(title = "") {
  return EXCLUDE_PATTERNS.some((rx) => rx.test(title));
}

function toOffer(it, q, onlyComplete) {
  const title = it.title || "";
  if (isExcludedTitle(title)) return null;
  if (!titleMatchesAllKeywords(title, q)) return null;

  const price = it?.price?.value ? Number(it.price.value) : null;
  const url = tagInlineEpn(it.itemWebUrl || "", q);
  const image = it?.image?.imageUrl || it?.thumbnailImages?.[0]?.imageUrl || null;

  if (onlyComplete && (!price || !url || !title || !image)) return null;

  return {
    productId: it.itemId || it.legacyItemId || "",
    title,
    modelKey: normalizeModelFromTitle(title),
    price,
    currency: it?.price?.currency || "USD",
    condition: it?.condition || null,
    retailer: "eBay",
    url,
    image,
    createdAt: it?.itemCreationDate || null,
  };
}

function groupByModel(offers = []) {
  const m = new Map();
  for (const o of offers) {
    const k = o.modelKey || "Other";
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(o);
  }
  const groups = [];
  for (const [model, list] of m) {
    const best = list.filter(x => typeof x.price === "number").sort((a,b)=>a.price-b.price)[0] || null;
    groups.push({
      model,
      offers: list,
      bestPrice: best?.price ?? null,
      bestCurrency: best?.currency ?? "USD",
      bestOffer: best || null,
      image: best?.image || list[0]?.image || null,
      retailers: Array.from(new Set(list.map(x => x.retailer))),
      count: list.length,
    });
  }
  groups.sort((a,b)=>{
    if (a.bestPrice == null && b.bestPrice == null) return 0;
    if (a.bestPrice == null) return 1;
    if (b.bestPrice == null) return -1;
    return a.bestPrice - b.bestPrice;
  });
  return groups;
}

// ===== Browse helper =====
async function fetchBrowse({ token, q, limit, offset, deliveryCountry, market, filter, category_ids, sort }) {
  const params = new URLSearchParams({
    q, limit: String(limit), offset: String(offset), deliveryCountry
  });
  if (filter) params.set("filter", filter);
  if (category_ids) params.set("category_ids", category_ids);
  if (sort) params.set("sort", sort);

  const r = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": market,
    },
    cache: "no-store",
  });
  const text = await r.text();
  return { ok: r.ok, status: r.status, text };
}

export async function GET(req) {
  const headers = { "Cache-Control": "no-store, no-cache, max-age=0" };

  try {
    const token = await getAppToken();
    const { searchParams } = new URL(req.url);

    const q = (searchParams.get("q") || "").trim(); // empty means: return nothing
    const onlyComplete = (searchParams.get("onlyComplete") || "").toLowerCase() === "true";
    const groupMode = (searchParams.get("group") ?? "true").toLowerCase() !== "false"; // default: true

    const minPriceRaw = searchParams.get("minPrice");
    const maxPriceRaw = searchParams.get("maxPrice");
    const conditions  = searchParams.get("conditions");
    const buying      = searchParams.get("buyingOptions");
    const categoryIds = searchParams.get("categoryIds") || "115280"; // Golf Putters
    const deliveryCountry = searchParams.get("deliveryCountry") || "US";
    const sortParam = (searchParams.get("sort") || "").toLowerCase();

    // pagination
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const perPageRaw = parseInt(searchParams.get("perPage") || "72", 10);
    const perPage = Math.min(Math.max(1, perPageRaw || 72), 100);

    // If no query, return empty payload (prevents pre-populated results)
    if (!q) {
      return NextResponse.json(
        groupMode
          ? { mode: "group", groups: [], page, perPage, hasNext: false, hasPrev: false, fetchedCount: 0, keptCount: 0, ts: Date.now() }
          : { mode: "flat", offers: [], page, perPage, hasNext: false, hasPrev: false, fetchedCount: 0, keptCount: 0, ts: Date.now() },
        { status: 200, headers }
      );
    }

    const EBAY_SORTS = new Set(["newlylisted"]); // allow-listed external sorts

    const filters = [];
    // price
    let minP = Number.isFinite(parseFloat(minPriceRaw)) ? Math.max(0, parseFloat(minPriceRaw)) : null;
    let maxP = Number.isFinite(parseFloat(maxPriceRaw)) ? Math.max(0, parseFloat(maxPriceRaw)) : null;
    if (minP !== null && maxP !== null && minP > maxP) { const t = minP; minP = maxP; maxP = t; }
    if (minP !== null || maxP !== null) {
      const lo = (minP !== null) ? minP.toFixed(2) : "0";
      const hi = (maxP !== null) ? maxP.toFixed(2) : "999999.00";
      filters.push(`price:[${lo}..${hi}]`);
    }
    // conditions
    if (conditions) {
      const allowed = new Set(["NEW","USED","CERTIFIED_REFURBISHED","SELLER_REFURBISHED"]);
      const vals = conditions.split(",").map(s=>s.trim().toUpperCase()).filter(v=>allowed.has(v));
      if (vals.length) filters.push(`conditions:{${vals.join("|")}}`);
    }
    // buying options
    if (buying) {
      const allowed = new Set(["FIXED_PRICE","AUCTION","BEST_OFFER","CLASSIFIED_AD"]);
      const vals = buying.split(",").map(s=>s.trim().toUpperCase()).filter(v=>allowed.has(v));
      if (vals.length) filters.push(`buyingOptions:{${vals.join("|")}}`);
    }
    const filterStr = filters.length ? filters.join(",") : undefined;
    const sortForward = EBAY_SORTS.has(sortParam) ? "newlyListed" : undefined;

    // ===== Grouped mode =====
    if (groupMode) {
      const limit = perPage;
      const offset = (page - 1) * perPage;
      const { ok, status, text } = await fetchBrowse({
        token, q, limit, offset, deliveryCountry, market: MARKETPLACE,
        filter: filterStr, category_ids: categoryIds, sort: sortForward
      });
      if (!ok) {
        return NextResponse.json(
          { mode: "group", error: "browse_http_error", status, details: text, groups: [], page, perPage, total: 0, hasNext: false, hasPrev: page > 1, fetchedCount: 0, keptCount: 0 },
          { status: 200, headers }
        );
      }
      const data = JSON.parse(text);
      const items = data.itemSummaries || [];
      const fetchedCount = items.length;
      const offers = items.map(it => toOffer(it, q, onlyComplete)).filter(Boolean);
      const keptCount = offers.length;
      const groups = groupByModel(offers);

      const total = Number.isFinite(data.total) ? data.total : undefined;
      const hasNext = Boolean(data.next);
      const hasPrev = page > 1 || Boolean(data.prev);

      return NextResponse.json(
        { mode: "group", groups, ts: Date.now(), page, perPage, total: total ?? null, hasNext, hasPrev, fetchedCount, keptCount },
        { status: 200, headers }
      );
    }

    // ===== Flat mode (exact listings per page) =====
    // Collect enough *kept* listings to fill page N by scanning from raw offset 0.
    const targetStart = (page - 1) * perPage;
    const targetEnd = page * perPage;

    let browseOffset = 0;       // always from 0 to avoid skipping keepable items
    let fetchedTotal = 0;       // diagnostics
    let keptAll = [];           // cumulative kept
    let hasNextRaw = false;     // whether upstream has more
    const MAX_SCANS = 8;        // up to ~800 raw items

    for (let i = 0; i < MAX_SCANS && keptAll.length < targetEnd; i++) {
      const limit = 100; // efficient scan size
      const { ok, status, text } = await fetchBrowse({
        token, q, limit, offset: browseOffset, deliveryCountry,
        market: MARKETPLACE, filter: filterStr, category_ids: categoryIds, sort: sortForward
      });
      if (!ok) {
        return NextResponse.json(
          { mode: "flat", error: "browse_http_error", status, details: text, offers: [], page, perPage, hasNext: false, hasPrev: page > 1, fetchedCount: fetchedTotal, keptCount: keptAll.length },
          { status: 200, headers }
        );
      }

      const data = JSON.parse(text);
      const items = data.itemSummaries || [];
      fetchedTotal += items.length;

      const mapped = items.map(it => toOffer(it, q, onlyComplete)).filter(Boolean);
      keptAll = keptAll.concat(mapped);

      hasNextRaw = Boolean(data.next);
      browseOffset += limit;
      if (!hasNextRaw) break;
    }

    const pageOffers = keptAll.slice(targetStart, targetEnd);
    const hasPrev = page > 1;
    const hasNext = keptAll.length > targetEnd || hasNextRaw;

    return NextResponse.json(
      {
        mode: "flat",
        offers: pageOffers,
        ts: Date.now(),
        page,
        perPage,
        hasNext,
        hasPrev,
        fetchedCount: fetchedTotal,
        keptCount: keptAll.length
      },
      { status: 200, headers }
    );

  } catch (e) {
    return NextResponse.json(
      { error: "exception", details: String(e), mode: "group", groups: [], page: 1, perPage: 72, hasNext: false, hasPrev: false, fetchedCount: 0, keptCount: 0 },
      { status: 200, headers }
    );
  }
}
