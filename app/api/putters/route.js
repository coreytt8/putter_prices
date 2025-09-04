// app/api/putters/route.js
import { NextResponse } from "next/server";

const EBAY_APP_ID = process.env.EBAY_APP_ID;

// per-instance in-memory cache + cooldown
const STATE = globalThis.__putterState ?? {
  cache: new Map(),               // key -> { data, expires }
  cooldownUntil: 0,               // timestamp ms when we can call eBay again
};
globalThis.__putterState = STATE;

const TTL_MS = 10 * 60 * 1000;     // 10 minutes cache
const COOLDOWN_MS = 5 * 60 * 1000;    // 5 minutes

function getCache(key) {
  const hit = STATE.cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.data;
  if (hit) STATE.cache.delete(key);
  return null;
}
function setCache(key, data) {
  STATE.cache.set(key, { data, expires: Date.now() + TTL_MS });
}

function mapItems(items = []) {
  return items.map((it) => {
    const priceObj = it?.sellingStatus?.[0]?.currentPrice?.[0] || {};
    const price = parseFloat(priceObj.__value__ ?? "0");
    const currency = priceObj["@currencyId"] || "USD";
    return {
      id: it?.itemId?.[0] ?? "",
      title: it?.title?.[0] ?? "",
      url: it?.viewItemURL?.[0] ?? "",
      image: it?.galleryURL?.[0] ?? null,
      price,
      currency,
      condition: it?.condition?.[0]?.conditionDisplayName?.[0] ?? null,
      location: it?.location?.[0] ?? null,
      source: "eBay",
    };
  });
}

async function callEbay(q) {
  const url = "https://svcs.ebay.com/services/search/FindingService/v1";
  const params = new URLSearchParams({
    "OPERATION-NAME": "findItemsByKeywords",
    "SERVICE-VERSION": "1.0.0",
    "SECURITY-APPNAME": EBAY_APP_ID,
    "RESPONSE-DATA-FORMAT": "JSON",
    "GLOBAL-ID": "EBAY-US",
    // Start conservative; you can raise later
    "paginationInput.entriesPerPage": "6",
    sortOrder: "PricePlusShippingLowest",
    keywords: q,
  });

  const r = await fetch(`${url}?${params.toString()}`, { cache: "no-store" });
  const text = await r.text();

  let data = null;
  try { data = JSON.parse(text); } catch {}

  if (!r.ok) return { kind: "http_error", status: r.status, text };
  const apiErr = data?.errorMessage?.[0]?.error?.[0];
  if (apiErr) return { kind: "api_error", err: apiErr };

  const items = data?.findItemsByKeywordsResponse?.[0]?.searchResult?.[0]?.item ?? [];
  return { kind: "ok", items };
}

export async function GET(req) {
  const headers = { "Cache-Control": "no-store, no-cache, max-age=0" };

  try {
    if (!EBAY_APP_ID) {
      return NextResponse.json({ error: "missing_app_id", results: [] }, { status: 200, headers });
    }

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "golf putter").trim();
    const key = `putters:${q.toLowerCase()}`;

    // if in cooldown, serve fresh cache if available, otherwise stale, otherwise friendly error
    if (Date.now() < STATE.cooldownUntil) {
      const cached = getCache(key) ?? STATE.cache.get(key)?.data ?? [];
      return NextResponse.json(
        { results: cached, cooldown: true, ts: Date.now() },
        { status: 200, headers }
      );
    }

    // serve cache if fresh
    const cached = getCache(key);
    if (cached) {
      return NextResponse.json({ results: cached, cached: true, ts: Date.now() }, { status: 200, headers });
    }

    // make 1–2 attempts
    let last;
    for (let attempt = 0; attempt < 2; attempt++) {
      last = await callEbay(q);
      if (last.kind === "ok") break;
      // small backoff
      await new Promise((r) => setTimeout(r, 400 + attempt * 600));
    }

    if (last.kind === "ok") {
      const mapped = mapItems(last.items);
      setCache(key, mapped);
      return NextResponse.json({ results: mapped, ts: Date.now() }, { status: 200, headers });
    }

    // if rate-limited, start cooldown and try to serve stale cache
    if (last.kind === "api_error") {
      const code = last.err?.errorId?.[0];
      const msg  = last.err?.message?.[0];
      if (String(code) === "10001") {
        STATE.cooldownUntil = Date.now() + COOLDOWN_MS;
      }
      const stale = STATE.cache.get(key)?.data ?? [];
      return NextResponse.json(
        { results: stale, stale: Boolean(stale.length), error: "ebay_api_error", code, message: msg, ts: Date.now() },
        { status: 200, headers }
      );
    }

    if (last.kind === "http_error") {
      const stale = STATE.cache.get(key)?.data ?? [];
      return NextResponse.json(
        { results: stale, stale: Boolean(stale.length), error: "http_error", status: last.status, details: last.text, ts: Date.now() },
        { status: 200, headers }
      );
    }

    return NextResponse.json(
      { results: [], error: "unknown_error", ts: Date.now() },
      { status: 200, headers }
    );
  } catch (e) {
    return NextResponse.json(
      { results: [], error: "exception", details: String(e), ts: Date.now() },
      { status: 200, headers }
    );
  }
}
