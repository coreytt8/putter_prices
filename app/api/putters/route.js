// app/api/putters/route.js
import { NextResponse } from "next/server";

// ====== eBay App creds (set in Vercel) ======
const CLIENT_ID = process.env.EBAY_CLIENT_ID;
const CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;
const MARKETPLACE = process.env.EBAY_MARKETPLACE || "EBAY_US";

// ====== EPN (inline tagging) ======
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

// ====== OAuth token cache ======
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
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body,
    cache: "no-store",
  });

  if (!r.ok) throw new Error(`oauth_error ${r.status}: ${await r.text()}`);
  const j = await r.json();
  _token = j.access_token;
  _expMs = Date.now() + j.expires_in * 1000;
  return _token;
}

// ====== Model/Family taxonomy (Scotty Cameron first) ======
const FAMILIES = [
  { key: "Newport", rx: /\bnewport\s?(1\.5|2|2\.5|3|4|5|6|7|8|9)?\b/i },
  { key: "Phantom X", rx: /\bphantom\s*x\b|\bpx\s*\d{1,2}\b/i },
  { key: "Special Select", rx: /\bspecial\s+select\b/i },
  { key: "Super Select", rx: /\bsuper\s+select\b/i },
  { key: "Futura", rx: /\bfutura\b/i },
  { key: "Circa", rx: /\bcirca\b/i },
  { key: "Studio Style|Studio Select", rx: /\bstudio\s+(style|select)\b/i },
  { key: "GoLo", rx: /\bgolo\b/i },
  { key: "Detour", rx: /\bdetour\b/i },
  { key: "Squareback|Fastback", rx: /\b(squareback|fastback)\b/i },
  { key: "CT / Circle T", rx: /\b(circle\s*t|ct)\b/i },
];

// Basic normalize -> “family” label from title
function deriveFamily(title = "") {
  const t = title || "";
  for (const f of FAMILIES) {
    if (f.rx.test(t)) return f.key;
  }
  // lightweight blade/mallet hint
  if (/\bmallet\b/i.test(t) || /\bphantom\b/i.test(t)) return "Mallet (other)";
  if (/\bblade\b/i.test(t) || /\banser\b/i.test(t) || /\bnewport\b/i.test(t)) return "Blade (other)";
  return "Other";
}

// Tighter model key (brand + key tokens)
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

// Map summaries -> offers (drop blanks)
function mapOffers(summaries = [], customIdSeed = "", onlyComplete = false) {
  const out = [];
  for (const it of summaries) {
    const price = it?.price?.value ? Number(it.price.value) : null;
    const url = tagInlineEpn(it.itemWebUrl || "", customIdSeed);
    const title = it.title || "";
    const image = it?.image?.imageUrl || it?.thumbnailImages?.[0]?.imageUrl || null;

    // Drop obviously incomplete/blank ones if toggle is on
    if (onlyComplete) {
      if (!price || !url || !title || !image) continue;
    }

    out.push({
      productId: it.itemId || it.legacyItemId || "",
      title,
      family: deriveFamily(title),
      modelKey: normalizeModelFromTitle(title),
      price,
      currency: it?.price?.currency || "USD",
      condition: it?.condition || null,
      retailer: "eBay",
      url,
      image,
    });
  }
  return out;
}

// Group offers by family → then by modelKey
function groupByFamilyAndModel(offers = []) {
  const famMap = new Map();
  for (const o of offers) {
    const fam = o.family || "Other";
    if (!famMap.has(fam)) famMap.set(fam, new Map());
    const modelMap = famMap.get(fam);
    const key = o.modelKey || "Other";
    if (!modelMap.has(key)) modelMap.set(key, []);
    modelMap.get(key).push(o);
  }

  const families = [];
  for (const [family, modelMap] of famMap) {
    const models = [];
    for (const [model, list] of modelMap) {
      const best = list
        .filter((x) => typeof x.price === "number")
        .sort((a, b) => a.price - b.price)[0] || null;
      models.push({
        model,
        offers: list,
        bestPrice: best?.price ?? null,
        bestCurrency: best?.currency ?? "USD",
        bestOffer: best || null,
        image: best?.image || list[0]?.image || null,
        retailers: Array.from(new Set(list.map((x) => x.retailer))),
        count: list.length,
      });
    }
    // sort models within family by best price
    models.sort((a, b) => {
      if (a.bestPrice == null && b.bestPrice == null) return 0;
      if (a.bestPrice == null) return 1;
      if (b.bestPrice == null) return -1;
      return a.bestPrice - b.bestPrice;
    });
    families.push({ family, models, total: models.reduce((n, m) => n + m.count, 0) });
  }

  // sort families by total offers desc
  families.sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
  return families;
}

export async function GET(req) {
  const headers = { "Cache-Control": "no-store, no-cache, max-age=0" };

  try {
    const token = await getAppToken();
    const { searchParams } = new URL(req.url);

    let q = (searchParams.get("q") || "golf putter").trim();
    const minPriceRaw = searchParams.get("minPrice");
    const maxPriceRaw = searchParams.get("maxPrice");
    const conditions  = searchParams.get("conditions");
    const buying      = searchParams.get("buyingOptions");
    const categoryIds = searchParams.get("categoryIds") || "115280"; // Golf Putters
    const deliveryCountry = searchParams.get("deliveryCountry") || "US";
    const onlyComplete = (searchParams.get("onlyComplete") || "").toLowerCase() === "true";
    const familyFilter = searchParams.get("family") || ""; // e.g., "Newport", "Phantom X"

    // If a Scotty sub-family is chosen, bias the query
    if (/scotty cameron/i.test(q) && familyFilter) {
      // keep it simple/robust: include family term in q
      q = `${q} "${familyFilter}"`;
    }

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

    const params = new URLSearchParams({
      q,
      limit: "72",                 // fetch more for better grouping
      deliveryCountry,
    });
    if (filters.length) params.set("filter", filters.join(","));
    if (categoryIds)   params.set("category_ids", categoryIds);

    const r = await fetch(
      `https://api.ebay.com/buy/browse/v1/item_summary/search?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE,
        },
        cache: "no-store",
      }
    );

    const text = await r.text();
    if (!r.ok) {
      return NextResponse.json(
        { error: "browse_http_error", status: r.status, details: text, families: [] },
        { status: 200, headers }
      );
    }

    const data = JSON.parse(text);
    // Map with stricter completeness toggle
    const offers = mapOffers(data.itemSummaries || [], q, onlyComplete);

    // Optional client-side family filtering (post-map) for extra safety
    const filtered = familyFilter
      ? offers.filter(o => (o.family || "").toLowerCase() === familyFilter.toLowerCase())
      : offers;

    const families = groupByFamilyAndModel(filtered);
    return NextResponse.json({ families, ts: Date.now() }, { status: 200, headers });
  } catch (e) {
    return NextResponse.json(
      { error: "exception", details: String(e), families: [] },
      { status: 200, headers }
    );
  }
}
