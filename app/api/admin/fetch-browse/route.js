// app/api/admin/fetch-browse/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { normalizeModelKey } from "@/lib/normalize";
import { mapConditionIdToBand } from "@/lib/condition-band";
// If your helper is named differently, change this import (e.g. getEbayToken as getAccessToken)
import { getEbayToken as getAccessToken } from "@/lib/ebay";

const BROWSE_BASE = "https://api.ebay.com/buy/browse/v1";
const ADMIN_KEY = process.env.ADMIN_KEY;

async function browseSearch({ q, limit = 50, offset = 0 }) {
  const token = await getAccessToken();
  const url = new URL(`${BROWSE_BASE}/item_summary/search`);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  // FULL returns items + refinements (condition histogram) in one call
  url.searchParams.set("fieldgroups", "FULL");

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-EBAY-MARKETPLACE-ID": "EBAY_US",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`eBay browse ${res.status}: ${txt.slice(0, 500)}`);
  }
  return res.json();
}

export async function POST(req) {
  try {
    // simple admin guard
    if (!ADMIN_KEY || (req.headers.get("x-admin-key") || "") !== ADMIN_KEY) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const raw = (searchParams.get("model") || "").trim();
    const limit = Number(searchParams.get("limit") || 50);
    const debug = searchParams.get("debug") === "1";
    if (!raw) return NextResponse.json({ ok: false, error: "Missing model" }, { status: 400 });

    const modelKey = normalizeModelKey(raw);
    const data = await browseSearch({ q: raw, limit });

    const summaries = Array.isArray(data.itemSummaries) ? data.itemSummaries : [];
    const conditionHistogram = (data.refinement?.conditionDistributions || []).map((c) => ({
      condition: c.condition,
      conditionId: c.conditionId,
      matchCount: Number(c.matchCount || 0),
    }));

    // Normalize items (include auction currentBidPrice + optional shipping)
    const items = summaries.map((it) => {
      const priceVal = Number(it.price?.value ?? it.currentBidPrice?.value ?? 0);
      const shipVal = Number(it.shippingOptions?.[0]?.shippingCost?.value ?? 0);
      const total = priceVal + (Number.isFinite(shipVal) ? shipVal : 0);
      const condId = it.conditionId ? Number(it.conditionId) : null;

      return {
        item_id: it.itemId,
        title: it.title || "",
        item_web_url: it.itemWebUrl || null,
        model: modelKey,
        variant_key: "", // add variant detection later as needed
        price_cents: Math.round(priceVal * 100),
        shipping_cents: Number.isFinite(shipVal) ? Math.round(shipVal * 100) : 0,
        total_cents: Math.round(total * 100),
        condition_id: condId,
        condition_band: mapConditionIdToBand(condId),
      };
    });

    const sql = getSql();
    let inserted = 0;
    let skipped = 0;
    let firstError = null;

    for (const r of items) {
      if (!r.item_id) {
        skipped++;
        continue;
      }
      try {
        // Requires unique index: CREATE UNIQUE INDEX IF NOT EXISTS ux_snapshots_item_day ON public.listing_snapshots (item_id, snapshot_day);
        const res = await sql`
          INSERT INTO listing_snapshots
            (item_id, model, variant_key, price_cents, shipping_cents, total_cents,
             condition_id, condition_band, snapshot_ts, snapshot_day)
          VALUES
            (${r.item_id}, ${r.model}, ${r.variant_key},
             ${r.total_cents - r.shipping_cents}, ${r.shipping_cents}, ${r.total_cents},
             ${r.condition_id}, ${r.condition_band},
             now(), (now() AT TIME ZONE 'UTC')::date)
          ON CONFLICT (item_id, snapshot_day) DO NOTHING
          RETURNING 1
        `;
        if (res.length) inserted++;
        else skipped++;
      } catch (e) {
        skipped++;
        if (!firstError) firstError = String(e);
      }
    }

    const out = {
      ok: true,
      model: modelKey,
      saw: summaries.length,
      inserted,
      skipped,
      firstError,
      histogram: conditionHistogram,
    };

    if (debug && summaries.length) {
      out.sample = {
        id: summaries[0].itemId,
        title: summaries[0].title,
        price: summaries[0].price,
        currentBidPrice: summaries[0].currentBidPrice,
        shipping: summaries[0].shippingOptions?.[0]?.shippingCost,
        condition: summaries[0].condition,
        conditionId: summaries[0].conditionId,
      };
    }

    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
