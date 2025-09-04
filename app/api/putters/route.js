// app/api/putters/route.js
import { NextResponse } from "next/server";

const EBAY_APP_ID = process.env.EBAY_APP_ID;

// Map eBay Finding API items safely
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

export async function GET(req) {
  const headers = { "Cache-Control": "no-store, no-cache, max-age=0" };

  try {
    if (!EBAY_APP_ID) {
      return NextResponse.json(
        { error: "missing_app_id", results: [], ts: Date.now() },
        { status: 200, headers }
      );
    }

    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") || "golf putter";

    const url = "https://svcs.ebay.com/services/search/FindingService/v1";
    const params = new URLSearchParams({
      "OPERATION-NAME": "findItemsByKeywords",
      "SERVICE-VERSION": "1.0.0",
      "SECURITY-APPNAME": EBAY_APP_ID,
      "RESPONSE-DATA-FORMAT": "JSON",
      "GLOBAL-ID": "EBAY-US",
      keywords: q,
      "paginationInput.entriesPerPage": "24",
      sortOrder: "PricePlusShippingLowest",
    });

    const r = await fetch(`${url}?${params.toString()}`, { cache: "no-store" });

    if (!r.ok) {
      const text = await r.text();
      return NextResponse.json(
        { error: "http_error", status: r.status, details: text, results: [], ts: Date.now() },
        { status: 200, headers }
      );
    }

    const data = await r.json();

    const err = data?.errorMessage?.[0]?.error?.[0];
    if (err) {
      return NextResponse.json(
        { error: "ebay_api_error", details: err, results: [], ts: Date.now() },
        { status: 200, headers }
      );
    }

    const items = data?.findItemsByKeywordsResponse?.[0]?.searchResult?.[0]?.item ?? [];
    return NextResponse.json({ results: mapItems(items), ts: Date.now() }, { status: 200, headers });
  } catch (e) {
    return NextResponse.json(
      { error: "exception", details: String(e), results: [], ts: Date.now() },
      { status: 200, headers }
    );
  }
}
