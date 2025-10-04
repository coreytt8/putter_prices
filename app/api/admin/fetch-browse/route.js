// app/api/admin/fetch-browse/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { normalizeModelKey } from "@/lib/normalize";
import { mapConditionIdToBand } from "@/lib/condition-band";
import { detectVariantTags, buildVariantKey } from "@/lib/variant-detect";
import { getEbayToken as getAccessToken } from "@/lib/ebay";

const ADMIN_KEY = process.env.ADMIN_KEY || process.env.CRON_SECRET || "";
const BROWSE_BASE = "https://api.ebay.com/buy/browse/v1";
const MARKETPLACE = process.env.EBAY_MARKETPLACE_ID || "EBAY_US";
const CAT_PUTTERS = ["115280"]; // Golf Clubs

const includesCi = (s, sub) => String(s || "").toLowerCase().includes(String(sub || "").toLowerCase());

// Build the search URL
function buildQuery(base, { q, limit, categoryIds, buyingOptions, conditions, conditionIds, fieldgroups }) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (limit) params.set("limit", String(limit));
  if (categoryIds?.length) params.set("category_ids", categoryIds.join(","));
  if (fieldgroups?.length) params.set("fieldgroups", fieldgroups.join(","));

  const filters = [];
  if (buyingOptions?.length) filters.push(`buyingOptions:{${buyingOptions.join(",")}}`);
  if (conditions?.length) filters.push(`conditions:{${conditions.join(",")}}`);
  if (conditionIds?.length) filters.push(`conditionIds:{${conditionIds.join(",")}}`);
  if (filters.length) params.set("filter", filters.join(","));

  return `${base}/item_summary/search?${params.toString()}`;
}

// Token can be a string or object
async function doBrowse(url, tokenInput) {
  const token =
    typeof tokenInput === "string"
      ? tokenInput
      : tokenInput?.access_token || tokenInput?.accessToken || tokenInput?.token || "";

  if (!token) {
    const err = new Error("Missing eBay token");
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
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    const err = new Error("Browse JSON parse error");
    err.body = text.slice(0, 200);
    err.url = url;
    throw err;
  }
  return json;
}

// Convert eBay summary → snapshot row
function snapshotFromItem(item) {
  const title = String(item?.title || "");
  const model = normalizeModelKey(title);
  const tags = detectVariantTags(title);
  const variant_key = buildVariantKey(model, tags);

  const priceRaw = item?.price?.value ?? item?.currentBidPrice?.value ?? null;
  const price_cents = (() => {
    if (priceRaw == null) return null;
    const cents = Math.round(Number(priceRaw || 0) * 100);
    return cents || null;
  })();

  const shipRaw =
    item?.shippingOptions?.[0]?.shippingCost?.value ??
    item?.shipping?.value ??
    0;
  const shipping_cents = Math.round(Number(shipRaw || 0) * 100) || 0;
  const total_cents = price_cents !== null ? price_cents + shipping_cents : null;

  const conditionId = item?.conditionId ? String(item.conditionId) : null;
  const condition_band = mapConditionIdToBand(conditionId) || "ANY";

  const whenIso = item?.itemCreationDate || item?.itemOriginDate || null;
  const snapshot_ts = whenIso ? new Date(whenIso) : new Date();
  const snapshot_day = new Date(
    Date.UTC(
      snapshot_ts.getUTCFullYear(),
      snapshot_ts.getUTCMonth(),
      snapshot_ts.getUTCDate()
    )
  );

  return {
    item_id: String(item?.itemId || ""),
    model,
    variant_key,
    price_cents,
    shipping_cents,
    total_cents,
    condition_id: conditionId,
    condition_band,
    snapshot_ts,
    snapshot_day,
  };
}

async function insertSnapshots(sql, rows) {
  if (!rows.length) return { inserted: 0, skipped: 0 };

  let inserted = 0,
    skipped = 0,
    firstError = null;

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
           ${r.snapshot_ts}, ${r.snapshot_day}::date)
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
  // Admin auth
  const auth = req.headers.get("x-admin-key") || "";
  if (!ADMIN_KEY || auth.trim() !== ADMIN_KEY.trim()) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const rawModel = (url.searchParams.get("model") || "").trim();
  const limit = Number(url.searchParams.get("limit") || "50");
  const debug = url.searchParams.has("debug");
  const condParam = (url.searchParams.get("conditions") || "").trim().toUpperCase();

  if (!rawModel) {
    return NextResponse.json({ ok: false, error: "missing model" }, { status: 400 });
  }

  const token = await getAccessToken();
  const baseQ = rawModel;
  const putterQ = includesCi(baseQ, "putter") ? baseQ : `${baseQ} putter`;
  const conds = condParam ? [condParam] : null;
  const conditionIdTry =
    condParam === "USED" ? ["3000"] : condParam === "NEW" ? ["1000"] : null;

  // Build the base ladder (we will try each WITH and WITHOUT fieldgroups)
  const baseAttempts = [
    { q: baseQ,  category_ids: null,        conditions: conds, buyingOptions: null,                                          conditionIds: null },
    { q: baseQ,  category_ids: null,        conditions: conds, buyingOptions: ["FIXED_PRICE","AUCTION","AUCTION_WITH_BIN"],  conditionIds: null },
    { q: baseQ,  category_ids: CAT_PUTTERS, conditions: conds, buyingOptions: null,                                          conditionIds: null },
    { q: baseQ,  category_ids: CAT_PUTTERS, conditions: conds, buyingOptions: ["FIXED_PRICE","AUCTION","AUCTION_WITH_BIN"],  conditionIds: null },
    { q: putterQ,category_ids: CAT_PUTTERS, conditions: conds, buyingOptions: null,                                          conditionIds: null },
    { q: putterQ,category_ids: CAT_PUTTERS, conditions: conds, buyingOptions: ["FIXED_PRICE","AUCTION","AUCTION_WITH_BIN"],  conditionIds: null },
  ];
  if (conditionIdTry) {
    baseAttempts.push(
      { q: putterQ, category_ids: CAT_PUTTERS, conditions: null, buyingOptions: null,                                         conditionIds: conditionIdTry },
      { q: putterQ, category_ids: CAT_PUTTERS, conditions: null, buyingOptions: ["FIXED_PRICE","AUCTION","AUCTION_WITH_BIN"], conditionIds: conditionIdTry },
    );
  }

  // For each base attempt, try WITH fieldgroups (to read refinements) and WITHOUT (to fetch items)
  const attempts = [];
  for (const a of baseAttempts) {
    attempts.push({ ...a, fieldgroups: ["CONDITION_REFINEMENTS"] });
    attempts.push({ ...a, fieldgroups: null });
  }

  const tried = []; // debug list
  let usedUrl = "";
  let summaries = [];
  let lastRefinements = null;

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

      // Capture refinements if present (for debug/histogram)
      const condRef = json?.conditionDistributions || json?.refinement?.conditionDistributions || null;
      if (condRef) lastRefinements = condRef;

      const items = json?.itemSummaries || json?.item_summaries || json?.item_summary || [];
      tried.push({
        url: u,
        ok: true,
        count: Array.isArray(items) ? items.length : 0,
        status: 200,
        keys: Object.keys(json || {}).slice(0, 8),
      });

      if (items?.length > 0) {
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
      // continue attempts
    }
  }

  if (!summaries.length) {
    // Build histogram from refinements if we saw any
    const histogram =
      Array.isArray(lastRefinements)
        ? lastRefinements.map((r) => ({
            condition: r?.condition || r?.value || "UNKNOWN",
            matchCount: Number(r?.matchCount || 0),
          }))
        : [];

    const payload = {
      ok: true,
      model: normalizeModelKey(rawModel),
      saw: 0,
      inserted: 0,
      skipped: 0,
      firstError: null,
      histogram,
      usedUrl,
    };
    if (debug) payload.attempts = tried;
    return NextResponse.json(payload);
  }

  // Normalize → snapshots
  const rows = summaries.map(snapshotFromItem);

  // Insert
  const sql = getSql();
  const { inserted, skipped, firstError } = await insertSnapshots(sql, rows);

  // Build condition histogram from summaries, or fallback to refinements
  const byCond = new Map();
  for (const it of summaries) {
    const cid = String(it?.conditionId || "UNSPECIFIED");
    byCond.set(cid, (byCond.get(cid) || 0) + 1);
  }
  let histogram = Array.from(byCond.entries()).map(([conditionId, matchCount]) => ({ conditionId, matchCount }));
  if (!histogram.length && Array.isArray(lastRefinements)) {
    histogram = lastRefinements.map((r) => ({
      condition: r?.condition || r?.value || "UNKNOWN",
      matchCount: Number(r?.matchCount || 0),
    }));
  }

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

// (optional) allow GET for quick local testing only with ?debugGet=1
export async function GET(req) {
  const url = new URL(req.url);
  if (url.searchParams.get("debugGet") === "1") return POST(req);
  return NextResponse.json({ ok: false, error: "Method Not Allowed. Use POST." }, { status: 405 });
}
