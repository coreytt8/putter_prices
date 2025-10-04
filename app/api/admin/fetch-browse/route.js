export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { normalizeModelKey } from "@/lib/normalize";
import { mapConditionIdToBand } from "@/lib/condition-band";
import { detectVariantTags, buildVariantKey } from "@/lib/variant-detect";
import { getEbayToken as getAccessToken } from "@/lib/ebay";

const ADMIN_KEY = process.env.ADMIN_KEY || "";
const BROWSE_BASE = "https://api.ebay.com/buy/browse/v1";
const MARKETPLACE = "EBAY_US";
const PUTTER_CAT = "115280"; // Golf Clubs

// -------------------------- utils --------------------------
function ok(val) { return val !== null && val !== undefined; }
function toInt(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function toCents(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}
function parseBool(v) {
  if (typeof v === "boolean") return v;
  if (!v) return false;
  const s = String(v).toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}
function utcDayFromISO(isoLike) {
  const d = isoLike ? new Date(isoLike) : new Date();
  // build a date-only value in UTC (00:00:00)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function pickListingTimestamps(item) {
  // Prefer creation/origin dates from Browse; fallback to now.
  const ts =
    item?.itemCreationDate ||
    item?.itemOriginDate ||
    null;
  const snapshotTs = ts ? new Date(ts) : new Date();
  const snapshotDay = utcDayFromISO(ts);
  return { snapshotTs, snapshotDay };
}
function condFilterPieces({ conditions, conditionIds }) {
  // Build a string filter for Browse
  // e.g. "conditions:{USED}"  or  "conditionIds:{1000,3000}"
  const pieces = [];
  if (conditions) {
    const val = String(conditions).toUpperCase().replace(/[^A-Z_,]/g, "");
    if (val) pieces.push(`conditions:{${val}}`);
  }
  if (conditionIds) {
    const val = String(conditionIds).replace(/[^0-9,]/g, "");
    if (val) pieces.push(`conditionIds:{${val}}`);
  }
  return pieces.join(",");
}
function buyingOptionsFilter(all = true) {
  return all ? "buyingOptions:{FIXED_PRICE,AUCTION,AUCTION_WITH_BIN}" : "";
}
function makeHeaders(token) {
  return {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/json",
    "Content-Type": "application/json",
    "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE,
  };
}
function summarizeHistogram(json) {
  // Prefer refinement distributions when present; otherwise count by itemSummaries
  const out = [];
  const dist = json?.refinement?.conditionDistributions;
  if (Array.isArray(dist) && dist.length) {
    for (const d of dist) {
      out.push({
        conditionId: d.conditionId,
        matchCount: toInt(d.matchCount, 0),
        refinementHref: d.refinementHref || undefined,
      });
    }
    return out;
  }
  const tallies = new Map();
  const items = json?.itemSummaries || [];
  for (const it of items) {
    const id = it?.conditionId || "UNSPEC";
    tallies.set(id, (tallies.get(id) || 0) + 1);
  }
  for (const [conditionId, matchCount] of tallies) {
    out.push({ conditionId, matchCount });
  }
  return out;
}

async function browseSearch(token, params = {}, wantRefinements = false) {
  const u = new URL(`${BROWSE_BASE}/item_summary/search`);
  const q = params.q || "";
  const limit = toInt(params.limit, 50);
  u.searchParams.set("q", q);
  u.searchParams.set("limit", String(limit));
  if (wantRefinements) {
    u.searchParams.set("fieldgroups", "CONDITION_REFINEMENTS");
  }
  if (params.category_ids) {
    u.searchParams.set("category_ids", String(params.category_ids));
  }
  const filterPieces = [];
  if (params.filter) filterPieces.push(params.filter);
  if (params.buyingOptions) filterPieces.push(params.buyingOptions);
  const filter = filterPieces.filter(Boolean).join(",");
  if (filter) u.searchParams.set("filter", filter);

  const resp = await fetch(u.href, { headers: makeHeaders(token) });
  const status = resp.status;
  let json = null;
  try { json = await resp.json(); } catch { /* non-JSON */ }
  const items = json?.itemSummaries || [];
  return { url: u.href, status, json, items };
}

// Ladder: try progressively broader/smarter patterns
async function runFallbackLadder(token, rawQuery, limit, filterBase, debug) {
  const attempts = [];
  const pushAttempt = (obj) => { if (debug) attempts.push(obj); };

  // Variants of q and filters
  const queries = [
    rawQuery,
    `${rawQuery} putter`,
  ];
  const cats = [null, PUTTER_CAT];
  const wantOptions = [false, true];
  const refinements = [false, true]; // sometimes refinements breaks counts, try both

  for (const wantRef of refinements) {
    for (const q of queries) {
      // 1) Bare
      {
        const r = await browseSearch(token, { q, limit }, wantRef);
        pushAttempt({ url: r.url, ok: !!r.items.length, count: r.items.length, status: r.status, keys: Object.keys(r.json || {}) });
        if (r.items.length) return { result: r, attempts };
      }
      // 2) + filter
      if (filterBase) {
        const r = await browseSearch(token, { q, limit, filter: filterBase }, wantRef);
        pushAttempt({ url: r.url, ok: !!r.items.length, count: r.items.length, status: r.status, keys: Object.keys(r.json || {}) });
        if (r.items.length) return { result: r, attempts };
      }
      // 3) + category
      for (const cat of cats) {
        if (!cat) continue;
        const r = await browseSearch(token, { q, limit, category_ids: cat, filter: filterBase }, wantRef);
        pushAttempt({ url: r.url, ok: !!r.items.length, count: r.items.length, status: r.status, keys: Object.keys(r.json || {}) });
        if (r.items.length) return { result: r, attempts };

        // 4) + buyingOptions
        for (const wantAll of wantOptions) {
          const buy = buyingOptionsFilter(wantAll);
          const r2 = await browseSearch(token, { q, limit, category_ids: cat, filter: filterBase, buyingOptions: buy }, wantRef);
          pushAttempt({ url: r2.url, ok: !!r2.items.length, count: r2.items.length, status: r2.status, keys: Object.keys(r2.json || {}) });
          if (r2.items.length) return { result: r2, attempts };
        }
      }
    }
  }
  return { result: null, attempts };
}

async function insertSnapshots(sql, modelKeyCanonical, items = []) {
  let inserted = 0;
  let skipped = 0;
  let firstError = null;

  for (const it of items) {
    try {
      const title = it?.title || "";
      const model = normalizeModelKey(title) || modelKeyCanonical;
      const tags = detectVariantTags(title);
      const variant_key = buildVariantKey(model, tags);
      const conditionId = it?.conditionId || null;
      const condition_band = mapConditionIdToBand(conditionId || it?.condition);

      const price_cents = toCents(it?.price?.value);
      const ship_cents = toCents(it?.shippingOptions?.[0]?.shippingCost?.value);
      const total_cents = price_cents + ship_cents;

      const item_id = it?.itemId || it?.legacyItemId || it?.itemWebUrl || it?.itemHref;
      if (!item_id) { skipped++; continue; }

      const { snapshotTs, snapshotDay } = pickListingTimestamps(it);

      await sql`
        INSERT INTO listing_snapshots
          (item_id, model, variant_key,
           price_cents, shipping_cents, total_cents,
           condition_id, condition_band,
           snapshot_ts, snapshot_day)
        VALUES
          (${item_id}, ${model}, ${variant_key},
           ${price_cents}, ${ship_cents}, ${total_cents},
           ${conditionId}, ${condition_band},
           ${snapshotTs}, ${snapshotDay})
        ON CONFLICT (item_id, snapshot_day) DO NOTHING
      `;
      inserted++;
    } catch (e) {
      if (!firstError) firstError = String(e?.message || e);
      skipped++;
    }
  }
  return { inserted, skipped, firstError };
}

// -------------------------- handler --------------------------
async function handle(req) {
  // auth
  const adminHdr = req.headers.get("x-admin-key") || "";
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret") || "";
  if (ADMIN_KEY && adminHdr !== ADMIN_KEY && secret !== ADMIN_KEY) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const limit = toInt(url.searchParams.get("limit"), 50);
  const rawModel = url.searchParams.get("model") || url.searchParams.get("q") || "";
  const conditions = url.searchParams.get("conditions") || "";     // e.g. NEW or USED
  const conditionIds = url.searchParams.get("conditionIds") || ""; // e.g. 1000,3000
  const debug = parseBool(url.searchParams.get("debug"));

  if (!rawModel.trim()) {
    return NextResponse.json({ ok: false, error: "missing model" }, { status: 400 });
  }

  const token = await getAccessToken();
  const sql = getSql();

  const requestedModelKey = normalizeModelKey(rawModel);
  const filterBase = condFilterPieces({ conditions, conditionIds });

  // Run the ladder
  const { result, attempts } = await runFallbackLadder(token, rawModel, limit, filterBase, debug);

  if (!result) {
    return NextResponse.json({
      ok: true,
      model: requestedModelKey,
      saw: 0,
      inserted: 0,
      skipped: 0,
      firstError: null,
      histogram: [],
      usedUrl: "",
      ...(debug ? { attempts } : {}),
    });
  }

  // Insert snapshots
  const { items, json } = result;
  const write = await insertSnapshots(sql, requestedModelKey, items);

  // Build histogram and sample
  const histogram = summarizeHistogram(json);
  const sample = items[0] || null;

  return NextResponse.json({
    ok: true,
    model: requestedModelKey,
    saw: items.length,
    inserted: write.inserted,
    skipped: write.skipped,
    firstError: write.firstError,
    histogram,
    usedUrl: result.url,
    sample,
    ...(debug ? { attempts } : {}),
  });
}

export async function POST(req) {
  try { return await handle(req); }
  catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

// (Optional) allow GET for quick debugging
export async function GET(req) { return POST(req); }
