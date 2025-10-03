// app/api/admin/fetch-browse/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { normalizeModelKey } from "@/lib/normalize";
import { mapConditionIdToBand } from "@/lib/condition-band";
// You said your token helper is exported like this:
import { getEbayToken as getAccessToken } from "@/lib/ebay";

const ADMIN_KEY = process.env.ADMIN_KEY || process.env.CRON_SECRET || "";
const BROWSE_BASE = "https://api.ebay.com/buy/browse/v1";
const MARKETPLACE = process.env.EBAY_MARKETPLACE_ID || "EBAY_US";

// util
const toIntCents = (n) => Math.round(Number(n || 0) * 100);
const has = (s, sub) => s.toLowerCase().includes(sub.toLowerCase());

function buildQuery(base, {
  q, limit, categoryIds, buyingOptions, conditions, conditionIds, fieldgroups
}) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (limit) params.set("limit", String(limit));

  // ask for condition refinements when useful
  if (fieldgroups && fieldgroups.length) {
    params.set("fieldgroups", fieldgroups.join(","));
  }

  if (categoryIds && categoryIds.length) {
    params.set("category_ids", categoryIds.join(","));
  }

  const filters = [];
  if (buyingOptions && buyingOptions.length) {
    filters.push(`buyingOptions:{${buyingOptions.join(",")}}`);
  }
  if (conditions && conditions.length) {
    filters.push(`conditions:{${conditions.join(",")}}`);
  }
  if (conditionIds && conditionIds.length) {
    // NOTE: eBay param is "conditionIds"
    filters.push(`conditionIds:{${conditionIds.join(",")}}`);
  }
  if (filters.length) {
    params.set("filter", filters.join(","));
  }

  return `${base}/item_summary/search?${params.toString()}`;
}

async function doBrowse(url, token) {
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE,
      Accept: "application/json"
    }
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`Browse ${r.status} ${r.statusText} for ${url} :: ${text.slice(0, 200)}`);
  }
  return r.json();
}

// Turn an item_summary into a snapshot row payload (normalized)
function snapshotFromItem(item) {
  const title = String(item?.title || "");
  const model = normalizeModelKey(title);

  // price + shipping (fallbacks)
  const priceV = item?.price?.value ?? item?.currentBidPrice?.value ?? null;
  const shipV =
    item?.shippingOptions?.[0]?.shippingCost?.value ??
    item?.shipping?.value ?? // some responses include this short form
    0;

  const price_cents = toIntCents(priceV);
  const shipping_cents = toIntCents(shipV);
  const total_cents = price_cents + shipping_cents;

  // map condition band
  const conditionId = item?.conditionId ? String(item.conditionId) : null;
  const condition_band = mapConditionIdToBand(conditionId) || "ANY";

  // prefer a stable “when” if present
  const whenIso =
    item?.itemCreationDate ||
    item?.itemEndDate ||
    item?.itemAffiliateWebUrlTimestamp || // not standard, just in case
    null;

  const ts = whenIso ? new Date(whenIso) : new Date();
  // snapshot_day from that timestamp, in UTC
  const snapshot_ts = ts;
  const snapshot_day_iso = new Date(Date.UTC(
    ts.getUTCFullYear(), ts.getUTCMonth(), ts.getUTCDate()
  )).toISOString().slice(0, 10); // YYYY-MM-DD

  return {
    item_id: String(item?.itemId || ""),
    model,
    variant_key: "", // keep empty for now; you can wire buildVariantKey(title) later
    price_cents,
    shipping_cents,
    total_cents,
    condition_id: conditionId,
    condition_band,
    snapshot_ts,
    snapshot_day_iso
  };
}

async function insertSnapshots(sql, rows) {
  if (!rows.length) return { inserted: 0, skipped: 0 };

  let inserted = 0, skipped = 0, firstError = null;
  for (const r of rows) {
    try {
      await sql`
        INSERT INTO listing_snapshots
          (item_id, model, variant_key, price_cents, shipping_cents, total_cents,
           condition_id, condition_band, snapshot_ts, snapshot_day)
        VALUES
          (${r.item_id}, ${r.model}, ${r.variant_key},
           ${r.price_cents}, ${r.shipping_cents}, ${r.total_cents},
           ${r.condition_id}, ${r.condition_band},
           ${r.snapshot_ts}, ${r.snapshot_day_iso}::date)
        ON CONFLICT (item_id, snapshot_day) DO NOTHING
      `;
      inserted++;
    } catch (e) {
      // likely duplicate; treat as skipped but keep the first error for debug
      skipped++;
      if (!firstError) firstError = e.message;
    }
  }
  return { inserted, skipped, firstError };
}

function uniquePush(arr, val) {
  if (!arr.includes(val)) arr.push(val);
}

export async function POST(req) {
  // admin guard
  const auth = req.headers.get("x-admin-key") || "";
  if (!ADMIN_KEY || auth.trim() !== ADMIN_KEY.trim()) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const rawModel = url.searchParams.get("model") || "";
  const limit = Number(url.searchParams.get("limit") || "50");
  const debug = url.searchParams.has("debug");
  const condParam = (url.searchParams.get("conditions") || "").trim().toUpperCase(); // e.g. "NEW" or "USED"

  const rawQ = rawModel.trim();
  if (!rawQ) {
    return NextResponse.json({ ok: false, error: "missing model" }, { status: 400 });
  }

  const token = await getAccessToken();
  // Build attempts (fallback ladder)
  const attempts = [];
  const baseQ = rawQ;
  const putterQ = has(baseQ, "putter") ? baseQ : `${baseQ} putter`;
  const CAT_GOLF_PUTTERS = ["115280"]; // eBay putters category

  const conds = condParam ? [condParam] : null;

  // 1) bare query (with refinements requested)
  attempts.push({
    q: baseQ, category_ids: null, conditions: conds,
    buyingOptions: null, conditionIds: null,
    fieldgroups: ["CONDITION_REFINEMENTS"]
  });
  // 2) same + buying options (all)
  attempts.push({
    q: baseQ, category_ids: null, conditions: conds,
    buyingOptions: ["FIXED_PRICE", "AUCTION", "AUCTION_WITH_BIN"], conditionIds: null,
    fieldgroups: ["CONDITION_REFINEMENTS"]
  });
  // 3) add category
  attempts.push({
    q: baseQ, category_ids: CAT_GOLF_PUTTERS, conditions: conds,
    buyingOptions: null, conditionIds: null,
    fieldgroups: ["CONDITION_REFINEMENTS"]
  });
  // 4) category + all buying options
  attempts.push({
    q: baseQ, category_ids: CAT_GOLF_PUTTERS, conditions: conds,
    buyingOptions: ["FIXED_PRICE", "AUCTION", "AUCTION_WITH_BIN"], conditionIds: null,
    fieldgroups: ["CONDITION_REFINEMENTS"]
  });
  // 5) inject "putter"
  attempts.push({
    q: putterQ, category_ids: CAT_GOLF_PUTTERS, conditions: conds,
    buyingOptions: null, conditionIds: null,
    fieldgroups: ["CONDITION_REFINEMENTS"]
  });
  // 6) inject "putter" + all buying options
  attempts.push({
    q: putterQ, category_ids: CAT_GOLF_PUTTERS, conditions: conds,
    buyingOptions: ["FIXED_PRICE", "AUCTION", "AUCTION_WITH_BIN"], conditionIds: null,
    fieldgroups: ["CONDITION_REFINEMENTS"]
  });
  // 7) explicit condition IDs try (USED/NEW map to 3000/1000)
  const conditionIdTry =
    condParam === "USED" ? ["3000"] :
    condParam === "NEW"  ? ["1000"] : null;
  if (conditionIdTry) {
    attempts.push({
      q: putterQ, category_ids: CAT_GOLF_PUTTERS, conditions: null,
      buyingOptions: null, conditionIds: conditionIdTry,
      fieldgroups: ["CONDITION_REFINEMENTS"]
    });
  }

  const triedUrls = [];
  let usedUrl = "";
  let summaries = [];
  for (const a of attempts) {
    const u = buildQuery(`${BROWSE_BASE}`, {
      q: a.q,
      limit,
      categoryIds: a.category_ids,
      buyingOptions: a.buyingOptions,
      conditions: a.conditions,
      conditionIds: a.conditionIds,
      fieldgroups: a.fieldgroups
    });
    uniquePush(triedUrls, u);

    try {
      const json = await doBrowse(u, token);
      const items = json?.itemSummaries || json?.item_summary || json?.item_summarys || [];
      if (items.length > 0) {
        summaries = items;
        usedUrl = u;
        break;
      }
    } catch (_e) {
      // keep trying
    }
  }

  if (!summaries.length) {
    const payload = { ok: true, model: normalizeModelKey(rawQ), saw: 0, inserted: 0, skipped: 0, firstError: null, histogram: [], usedUrl };
    if (debug) payload.attempts = triedUrls;
    return NextResponse.json(payload);
  }

  // convert to snapshot rows
  const rows = summaries.map(snapshotFromItem);

  // prepare a simple histogram from items themselves
  const hist = [];
  const counts = new Map();
  for (const it of summaries) {
    const id = String(it?.conditionId || "UNSPECIFIED");
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  for (const [id, n] of counts.entries()) {
    hist.push({ conditionId: id, matchCount: n });
  }

  // insert
  const sql = getSql();
  const { inserted, skipped, firstError } = await insertSnapshots(sql, rows);

  const out = {
    ok: true,
    model: normalizeModelKey(rawQ),
    saw: summaries.length,
    inserted,
    skipped,
    firstError,
    histogram: hist,
    usedUrl,
    sample: summaries[0] || null
  };
  if (debug) out.attempts = triedUrls;
  return NextResponse.json(out);
}
