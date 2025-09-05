// app/api/putters/route.js
import { NextResponse } from "next/server";

// ====== eBay App creds ======
const CLIENT_ID = process.env.EBAY_CLIENT_ID;
const CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;
const MARKETPLACE = process.env.EBAY_MARKETPLACE || "EBAY_US";

// ====== EPN (server-side rover wrapping) ======
const EPN_ROVER_PATH = process.env.EPN_ROVER_PATH || "";   // e.g. "711-53200-19255-0"
const EPN_CAMPAIGN_ID = process.env.EPN_CAMPAIGN_ID || ""; // your 10-digit campaign id

function wrapEpn(url) {
  if (!url || !EPN_ROVER_PATH || !EPN_CAMPAIGN_ID) return url;
  const base = `https://rover.ebay.com/rover/1/${EPN_ROVER_PATH}/1`;

  // Ensure single encode only
  const cleanUrl = decodeURIComponent(url); 
  const params = new URLSearchParams({
    campid: EPN_CAMPAIGN_ID,
    to: encodeURIComponent(cleanUrl), // single encoding
  });

  return `${base}?${params.toString()}`;
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

// ====== Map Browse API results to your UI shape (now with EPN wrapping) ======
function mapSummaries(summaries = []) {
  return summaries.map((it) => ({
    id: it.itemId || it.legacyItemId || "",
    title: it.title || "",
    url: wrapEpn(it.itemWebUrl || ""),
    image: it?.image?.imageUrl || it?.thumbnailImages?.[0]?.imageUrl || null,
    price: it?.price?.value ? Number(it.price.value) : null,
    currency: it?.price?.currency || "USD",
    condition: it?.condition || null,
    location: it?.itemLocation?.country || null,
    source: "eBay",
  }));
}

export async function GET(req) {
  const headers = { "Cache-Control": "no-store, no-cache, max-age=0" };

  try {
    const token = await getAppToken();
    const { searchParams } = new URL(req.url);

    const q = (searchParams.get("q") || "golf putter").trim();

    // Filters
    const minPriceRaw = searchParams.get("minPrice");
    const maxPriceRaw = searchParams.get("maxPrice");
    const conditions  = searchParams.get("conditions");
    const buying      = searchParams.get("buyingOptions");
    const categoryIds = searchParams.get("categoryIds") || "115280"; // Golf Putters
    const deliveryCountry = searchParams.get("deliveryCountry") || "US";

    // Build filter string
    const filters = [];

    // Closed price range
    let minP = Number.isFinite(parseFloat(minPriceRaw)) ? Math.max(0, parseFloat(minPriceRaw)) : null;
    let maxP = Number.isFinite(parseFloat(maxPriceRaw)) ? Math.max(0, parseFloat(maxPriceRaw)) : null;
    if (minP !== null && maxP !== null && minP > maxP) { const t = minP; minP = maxP; maxP = t; }
    if (minP !== null || maxP !== null) {
      const lo = (minP !== null) ? minP.toFixed(2) : "0";
      const hi = (maxP !== null) ? maxP.toFixed(2) : "999999.00";
      filters.push(`price:[${lo}..${hi}]`);
    }

    if (conditions) {
      const allowed = new Set(["NEW","USED","CERTIFIED_REFURBISHED","SELLER_REFURBISHED"]);
      const vals = conditions.split(",").map(s=>s.trim().toUpperCase()).filter(v=>allowed.has(v));
      if (vals.length) filters.push(`conditions:{${vals.join("|")}}`);
    }

    if (buying) {
      const allowed = new Set(["FIXED_PRICE","AUCTION","BEST_OFFER","CLASSIFIED_AD"]);
      const vals = buying.split(",").map(s=>s.trim().toUpperCase()).filter(v=>allowed.has(v));
      if (vals.length) filters.push(`buyingOptions:{${vals.join("|")}}`);
    }

    const params = new URLSearchParams({
      q,
      limit: "24",
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
        { error: "browse_http_error", status: r.status, details: text, results: [] },
        { status: 200, headers }
      );
    }

    const data = JSON.parse(text);
    const items = mapSummaries(data.itemSummaries || []);
    return NextResponse.json({ results: items, ts: Date.now() }, { status: 200, headers });
  } catch (e) {
    return NextResponse.json(
      { error: "exception", details: String(e), results: [] },
      { status: 200, headers }
    );
  }
}
