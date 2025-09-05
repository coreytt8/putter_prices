// app/api/putters/route.js
import { NextResponse } from "next/server";

// env
const CLIENT_ID = process.env.EBAY_CLIENT_ID;
const CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;
const MARKETPLACE = process.env.EBAY_MARKETPLACE || "EBAY_US";

// simple in-memory token cache (good enough to start)
let _token = null;
let _expMs = 0;

async function getAppToken() {
  if (_token && Date.now() < _expMs - 60_000) return _token; // reuse until 60s before expiry
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

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`oauth_error ${r.status}: ${text}`);
  }
  const j = await r.json();
  _token = j.access_token;
  _expMs = Date.now() + j.expires_in * 1000; // seconds -> ms
  return _token;
}

function mapSummaries(summaries = []) {
  return summaries.map((it) => ({
    id: it.itemId || it.legacyItemId || "",
    title: it.title || "",
    url: it.itemWebUrl || "",
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

    // Build Browse search
    const params = new URLSearchParams({
      q,
      limit: "24",
      // Optional once you confirm results: category_ids: "115280"  // Golf Putters
      // Optional filters later: filter: 'price:[50..600],buyingOptions:{FIXED_PRICE|BEST_OFFER}'
    });

    const r = await fetch(
      `https://api.ebay.com/buy/browse/v1/item_summary/search?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE, // EBAY_US
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
