import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

// If you already have a token helper, import it; otherwise this fallback uses client-credentials.
import { getEbayToken } from "@/lib/ebayAuth"; // tweak if your export name differs
import { buildVariantKey } from "@/lib/variant-detect";
import { normalizeModelKey } from "@/lib/normalize";

export const runtime = "nodejs"; // <= here (module scope)
// Minimal normalize helpers (reuse your existing ones if available)
function cents(value) { return Math.round(Number(value || 0) * 100); }
function totalCents(item) {
  const price = Number(item?.price?.value || 0);
  const ship  = Number(item?.shippingOptions?.[0]?.shippingCost?.value || 0);
  return cents(price + ship);
}
function toConditionBand(raw) {
  const s = String(raw || "").toUpperCase();
  if (s.includes("NEW")) return "NEW";
  if (s.includes("LIKE NEW") || s.includes("MINT")) return "LIKE_NEW";
  return "ANY"; // keep it broad; your sanitizer can make this more granular
}
function buildVariantKey(title) {
  const t = String(title || "").toLowerCase();
  const keys = [];
  if (/\bcircle\s*t\b|\bct\b/.test(t)) keys.push("ct");
  if (/\bleft\b|\blh\b/.test(t)) keys.push("lh");
  if (/\barm\s*lock\b/.test(t)) keys.push("arm-lock");
  return keys.join("+"); // '' for base
}

// You likely already have a canonicalizer; call it here instead of this stub

async function fetchBrowse(token, params) {
  const q = new URLSearchParams({
    q: params.q || "golf putter",
    limit: String(params.limit ?? 100),
    sort: "price+asc", // any stable sort to reduce duplication
    filter: "buyingOptions:{FIXED_PRICE,AUCTION_WITH_BUY_IT_NOW}",
  });
  const r = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${q.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`eBay ${r.status} ${t}`);
  }
  const j = await r.json();
  return j.itemSummaries || [];
}

export async function GET() {
  const sql = getSql();
  const now = new Date();

  try {
    const token = await getEbayToken();
    // TODO: expand queries by brand/model; start simple with one pass
    const items = await fetchBrowse(token, { q: "putter", limit: 100 });

    // Track what's seen to manage lifecycle
    const seen = new Set();

    for (const it of items) {
      const item_id = it.itemId;
      if (!item_id) continue;
      seen.add(item_id);

      const title = it.title || "";
      const model = normalizeModelKey(title);
      const variant_key = buildVariantKey(title);
      const condition_band = toConditionBand(it.condition);
      const price_cents = totalCents(it);

      // 1) snapshot (append-only)
      await sql`
        INSERT INTO listing_snapshots
          (snapshot_ts, item_id, model, variant_key, condition_band, price_cents, currency,
           seller_username, seller_feedback, location, title, url)
        VALUES
          (${now}, ${item_id}, ${model}, ${variant_key}, ${condition_band}, ${price_cents}, ${it?.price?.currency || 'USD'},
           ${it?.seller?.username || null},
           ${typeof it?.seller?.feedbackPercentage === 'number' ? it.seller.feedbackPercentage : null},
           ${it?.itemLocation?.city || null},
           ${title},
           ${it?.itemWebUrl || null})
        ON CONFLICT DO NOTHING
      `;

      // 2) lifecycle upsert
      await sql`
        INSERT INTO listing_lifecycle
          (item_id, model, variant_key, condition_band, first_seen_ts, last_seen_ts, is_active)
        VALUES
          (${item_id}, ${model}, ${variant_key}, ${condition_band}, ${now}, ${now}, true)
        ON CONFLICT (item_id) DO UPDATE
          SET last_seen_ts = EXCLUDED.last_seen_ts, is_active = true
      `;
    }

    // 3) mark missing for >48h inactive
    await sql`
      UPDATE listing_lifecycle
         SET is_active = false
       WHERE is_active = true
         AND last_seen_ts < (now() - interval '48 hours')
    `;

    return NextResponse.json({ ok: true, count: items.length, at: now.toISOString() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
