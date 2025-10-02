// app/api/admin/fetch-browse/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { normalizeModelKey } from "@/lib/normalize";
import { mapConditionIdToBand } from "@/lib/condition-band"; // you added this
import { getAccessToken } from "@/lib/ebayAuth";              // you already have this

const BROWSE_BASE = "https://api.ebay.com/buy/browse/v1";
const ADMIN_KEY = process.env.ADMIN_KEY;

async function browseSearch({ q, limit = 50, offset = 0 }) {
  const token = await getAccessToken();
  const url = new URL(`${BROWSE_BASE}/item_summary/search`);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("fieldgroups", "CONDITION_REFINEMENTS"); // free histogram too

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-EBAY-MARKETPLACE-ID": "EBAY_US",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`eBay browse ${res.status}`);
  return res.json();
}

export async function POST(req) {
  try {
    // protect the route
    const key = req.headers.get("x-admin-key") || "";
    if (!ADMIN_KEY || key !== ADMIN_KEY) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const raw = (searchParams.get("model") || "").trim();
    const limit = Number(searchParams.get("limit") || 50);
    if (!raw) return NextResponse.json({ ok:false, error:"Missing model" }, { status: 400 });

    const modelKey = normalizeModelKey(raw);
    const data = await browseSearch({ q: raw, limit });

    const items = (data.itemSummaries || []).map((it) => {
      const price = Number(it.price?.value || 0);
      const ship  = Number(it.shippingOptions?.[0]?.shippingCost?.value || 0);
      const total = price + (Number.isFinite(ship) ? ship : 0);
      const condId = it.conditionId ? Number(it.conditionId) : null;

      return {
        item_id: it.itemId,
        model: modelKey,
        variant_key: "", // keep empty for now; you can detect variants later
        price_cents: Math.round(price * 100),
        shipping_cents: Number.isFinite(ship) ? Math.round(ship * 100) : 0,
        total_cents: Math.round(total * 100),
        condition_id: condId,
        condition_band: mapConditionIdToBand(condId),
      };
    });

    const sql = getSql();
    let inserted = 0;

    // Insert rows (one per item); use now() as snapshot time
    for (const r of items) {
      // Adjust ON CONFLICT to match your real constraint if you add one (e.g., (item_id, date(snapshot_ts)))
      await sql`
        INSERT INTO listing_snapshots
          (item_id, model, variant_key, price_cents, shipping_cents, total_cents,
           condition_id, condition_band, snapshot_ts)
        VALUES
          (${r.item_id}, ${r.model}, ${r.variant_key}, ${r.price_cents}, ${r.shipping_cents},
           ${r.total_cents}, ${r.condition_id}, ${r.condition_band}, now())
      `;
      inserted++;
    }

    return NextResponse.json({
      ok: true,
      model: modelKey,
      inserted,
      histogram: data.refinement?.conditionDistributions || [],
    });
  } catch (e) {
    return NextResponse.json({ ok:false, error:String(e) }, { status: 500 });
  }
}
