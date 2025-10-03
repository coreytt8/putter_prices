// app/api/admin/fetch-browse/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { normalizeModelKey } from "@/lib/normalize";
import { mapConditionIdToBand } from "@/lib/condition-band";
import { getEbayToken as getAccessToken } from "@/lib/ebay";

const ADMIN_KEY = process.env.ADMIN_KEY || process.env.CRON_SECRET || "";
const BROWSE_BASE = "https://api.ebay.com/buy/browse/v1";
const MARKETPLACE = process.env.EBAY_MARKETPLACE_ID || "EBAY_US";
const CAT_PUTTERS = ["115280"]; // eBay: Golf Clubs & Equipment > Golf Clubs > Putter

// --- small utils ---
const toIntCents = (n) => Math.round(Number(n || 0) * 100);
const includesCi = (s, sub) => String(s || "").toLowerCase().includes(String(sub || "").toLowerCase());
const uniquePush = (arr, val) => { if (!arr.includes(val)) arr.push(val); };

// Build a Browse search URL
function buildQuery(base, {
  q, limit, categoryIds, buyingOptions, conditions, conditionIds, fieldgroups
}) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (limit) params.set("limit", String(limit));
  if (fieldgroups?.length) params.set("fieldgroups", fieldgroups.join(","));
  if (categoryIds?.length) params.set("category_ids", categoryIds.join(","));

  const filters = [];
  if (buyingOptions?.length) filters.push(`buyingOptions:{${buyingOptions.join(",")}}`);
  if (conditions?.length) filters.push(`conditions:{${conditions.join(",")}}`);
  if (conditionIds?.length) filters.push(`conditionIds:{${conditionIds.join(",")}}`);
  if (filters.length) params.set("filter", filters.join(","));

  return `${base}/item_summary/search?${params.toString()}`;
}

// Accept a raw string token or { access_token / accessToken }
async function doBrowse(url, tokenInput) {
  const token = typeof tokenInput === "string"
    ? tokenInput
    : tokenInput?.access_token || tokenInput?.accessToken || "";

  if (!token) {
    const err = new Error("Missing eBay token (access_token)");
    err.code = "NO_TOKEN";
    throw err;
  }

  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE,
      Accept: "application/json",
    },
  });

  const text = await r.text().catch(() => "");
  if (!r.ok) {
    const err = new Error(`Browse ${r.status} ${r.statusText}`);
    err.status = r.status;
    err.body = text.slice(0, 400);
    err.url = url;
    throw err;
  }

  let json = {};
  try { json = text ? JSON.parse(text) : {}; }
  catch {
    const err = new Error("Browse JSON parse error");
    err.body = text.slice(0, 200);
    err.url = url;
    throw err;
  }
  return json;
}

// Convert an item summary → normalized snapshot row
function snapshotFromItem(item) {
  const title = String(item?.title || "");
  const model = normalizeModelKey(title);

  // prices
  const priceV = item?.price?.value ?? item?.currentBidPrice?.value ?? null;
  // Browse often provides shippingOptions[0].shippingCost.value
  const shipV  = item?.shippingOptions?.[0]?.shippingCost?.value
              ?? item?.shipping?.value
              ?? 0;

  const price_cents = toIntCents(priceV);
  const shipping_cents = toIntCents(shipV);
  const total_cents = price_cents + shipping_cents;

  // condition
  const conditionId = item?.conditionId ? String(item.conditionId) : null;
  const condition_band = mapConditionIdToBand(conditionId) || "ANY";

  // time → prefer listing creation/end; else now
  const whenIso = item?.itemCreationDate || item?.itemEndDate || null;
  const ts = whenIso ? new Date(whenIso) : new Date();

  // snapshot_day in UTC (YYYY-MM-DD)
  const snapshot_day_iso = new Date(Date.UTC(
    ts.getUTCFullYear(), ts.getUTCMonth(), ts.getUTCDate()
  )).toISOString().slice(0, 10);

  return {
    item_id: String(item?.itemId || ""),
    model,
    variant_key: "", // wire up a variant extractor later if desired
    price_cents,
    shipping_cents,
    total_cents,
    condition_id: conditionId,
    condition_band,
    snapshot_ts: ts,
    snapshot_day_iso,
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
      skipped++;
      if (!firstError) firstError = e.message;
    }
  }
  return { inserted, skipped, firstError };
}

export async function POST(req) {
  // admin guard
  const auth = req.headers.get("x-admin-key") || "";
  if (!ADMIN_KEY || auth.trim() !== ADMIN_KEY.trim()) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const rawModel = (url.searchParams.get("model") || "").trim();
  const limit = Number(url.searchParams.get("limit") || "50");
  const debug = url.searchParams.has("debug");
  const condParam = (url.searchParams.get("conditions") || "").trim().toUpperCase(); // e.g. NEW/USED

  if (!rawModel) {
    return NextResponse.json({ ok: false, error: "missing model" }, { status: 400 });
  }

  const token = await getAccessToken();

  const baseQ = rawModel;
  const putterQ = includesCi(baseQ, "putter") ? baseQ : `${baseQ} putter`;
  const conds = condParam ? [condParam] : null;
  const conditionIdTry =
    condParam === "USED" ? ["3000"] :
    condParam === "NEW"  ? ["1000"] : null;

  // Fallback ladder (broad → narrow)
  const attempts = [
    // bare
    { q: baseQ,     category_ids: null,           conditions: conds, buyingOptions: null,                                           conditionIds: null, fieldgroups: ["CONDITION_REFINEMENTS"] },
    { q: baseQ,     category_ids: null,           conditions: conds, buyingOptions: ["FIXED_PRICE","AUCTION","AUCTION_WITH_BIN"],   conditionIds: null, fieldgroups: ["CONDITION_REFINEMENTS"] },
    // add category
    { q: baseQ,     category_ids: CAT_PUTTERS,    conditions: conds, buyingOptions: null,                                           conditionIds: null, fieldgroups: ["CONDITION_REFINEMENTS"] },
    { q: baseQ,     category_ids: CAT_PUTTERS,    conditions: conds, buyingOptions: ["FIXED_PRICE","AUCTION","AUCTION_WITH_BIN"],   conditionIds: null, fieldgroups: ["CONDITION_REFINEMENTS"] },
    // inject "putter"
    { q: putterQ,   category_ids: CAT_PUTTERS,    conditions: conds, buyingOptions: null,                                           conditionIds: null, fieldgroups: ["CONDITION_REFINEMENTS"] },
    { q: putterQ,   category_ids: CAT_PUTTERS,    conditions: conds, buyingOptions: ["FIXED_PRICE","AUCTION","AUCTION_WITH_BIN"],   conditionIds: null, fieldgroups: ["CONDITION_REFINEMENTS"] },
  ];
  if (conditionIdTry) {
    attempts.push(
      { q: putterQ, category_ids: CAT_PUTTERS, conditions: null, buyingOptions: null,                                           conditionIds: conditionIdTry, fieldgroups: ["CONDITION_REFINEMENTS"] },
      { q: putterQ, category_ids: CAT_PUTTERS, conditions: null, buyingOptions: ["FIXED_PRICE","AUCTION","AUCTION_WITH_BIN"],   conditionIds: conditionIdTry, fieldgroups: ["CONDITION_REFINEMENTS"] },
    );
  }

  const tried = []; // {url, ok, count, status, errorHead}
  let usedUrl = "";
  let summaries = [];

  for (const a of attempts) {
    const u = buildQuery(BROWSE_BASE, {
      q: a.q,
      limit,
      categoryIds: a.category_ids,
      buyingOptions: a.buyingOptions,
      conditions: a.conditions,
      conditionIds: a.conditionIds,
      fieldgroups: a.fieldgroups,
    });

    try {
      const json = await doBrowse(u, token);
      const items = json?.itemSummaries || json?.item_summaries || json?.item_summary || [];
      tried.push({ url: u, ok: true, count: items.length, status: 200 });
      if (items.length > 0) {
        summaries = items;
        usedUrl = u;
        break;
      }
    } catch (e) {
      tried.push({
        url: u,
        ok: false,
        count: 0,
        status: e?.status || 0,
        errorHead: (e?.body || e?.message || "").slice(0, 200),
      });
      // keep trying
    }
  }

  if (!summaries.length) {
    const payload = {
      ok: true,
      model: normalizeModelKey(rawModel),
      saw: 0, inserted: 0, skipped: 0, firstError: null,
      histogram: [],
      usedUrl,
    };
    if (debug) payload.attempts = tried;
    return NextResponse.json(payload);
  }

  // Normalize → snapshot rows
  const rows = summaries.map(snapshotFromItem);

  // Histogram by conditionId (quick view of mix returned)
  const counts = new Map();
  for (const it of summaries) {
    const cid = String(it?.conditionId || "UNSPECIFIED");
    counts.set(cid, (counts.get(cid) || 0) + 1);
  }
  const histogram = Array.from(counts.entries()).map(([conditionId, matchCount]) => ({ conditionId, matchCount }));

  // Insert
  const sql = getSql();
  const { inserted, skipped, firstError } = await insertSnapshots(sql, rows);

  const out = {
    ok: true,
    model: normalizeModelKey(rawModel),
    saw: summaries.length,
    inserted,
    skipped,
    firstError,
    histogram,
    usedUrl,
    sample: summaries[0] || null,
  };
  if (debug) out.attempts = tried;
  return NextResponse.json(out);
}
