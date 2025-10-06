export const runtime = "nodejs";

import { getSql } from "../../lib/db.js";
import { PUTTER_CATALOG } from "../../lib/data/putterCatalog.js";
import { normalizeModelKey } from "../../lib/normalize.js";
import {
  sanitizeModelKey,
  stripAccessoryTokens,
  containsAccessoryToken,
  HEAD_COVER_TOKEN_VARIANTS,
  HEAD_COVER_TEXT_RX,
} from "../../lib/sanitizeModelKey.js";
import { decorateEbayUrl } from "../../lib/affiliate.js";
import { gradeDeal } from "../../lib/deal-grade.js";

const CATALOG_LOOKUP = (() => {
  const map = new Map();
  for (const entry of PUTTER_CATALOG) {
    const key = normalizeModelKey(`${entry.brand} ${entry.model}`);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(entry);
  }
  return map;
})();

function formatModelLabel(modelKey = "", brand = "", title = "") {
  const normalized = String(modelKey || "").trim();
  if (normalized && CATALOG_LOOKUP.has(normalized)) {
    const [first] = CATALOG_LOOKUP.get(normalized);
    if (first) return `${first.brand} ${first.model}`;
  }
  if (brand) return brand;
  if (title) return title;
  if (!normalized) return "Live Smart Price deal";
  return normalized.split(" ").map(p => p ? p[0].toUpperCase() + p.slice(1) : "").join(" ");
}

const NUM = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const centsToNum = (v) => (NUM(v) == null ? null : NUM(v) / 100);

function ensurePutterQuery(text = "") {
  let s = String(text || "").trim();
  if (!s) return "golf putter";
  s = s.replace(/\bputters\b/gi, "putter");
  if (!/\bputter\b/i.test(s)) s = `${s} putter`;
  return s.replace(/\s+/g, " ").trim();
}

// --- accessory/title filter helpers (unchanged) ---
const CONNECTOR_TOKENS = new Set(["for","with","and","the","a","to","of","by","from","in","on","at","&","+","plus","or"]);
const NUMERIC_TOKEN_PATTERN = /^\d+(?:\.\d+)?$/;
const MEASUREMENT_TOKEN_PATTERN = /^\d+(?:\.\d+)?(?:in|cm|mm|g|gram|grams)$/;
const PACK_TOKEN_PATTERN = /^(?:\d+(?:\/\d+)?(?:pc|pcs|pack)s?|\d+(?:pcs?)|pcs?|pack)$/;
const ACCESSORY_COMBO_TOKENS = new Set(["weight","weights","counterweight","counterweights","fit","fits","fitting","compatible","compatibility","adapter","adapters","kit","kits","wrench","wrenches","tool","tools"]);

function isAccessoryDominatedTitle(title = "") {
  if (!title) return false;
  const raw = String(title);
  let hasHeadcoverSignal = HEAD_COVER_TEXT_RX.test(raw);
  const hasPutterToken = /\bputter\b/i.test(raw);
  const tokens = raw.split(/\s+/).filter(Boolean);

  let accessoryCount = 0;
  let substantiveCount = 0;
  const analysis = [];

  for (const token of tokens) {
    const norm = token.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (!norm) continue;
    if (HEAD_COVER_TOKEN_VARIANTS.has(norm)) { hasHeadcoverSignal = true; continue; }
    const isNumeric = NUMERIC_TOKEN_PATTERN.test(norm);
    const isMeasurement = MEASUREMENT_TOKEN_PATTERN.test(norm);
    const isConnector = CONNECTOR_TOKENS.has(norm);
    const isPutter = norm === "putter";
    const isFiller = isPutter || isConnector || isNumeric || isMeasurement;
    const isAccessory = !isPutter && containsAccessoryToken(token);
    if (isAccessory) accessoryCount++; else if (!isFiller) substantiveCount++;
    analysis.push({ norm, isAccessory, isFiller });
  }

  const strippedTokens = stripAccessoryTokens(raw)
    .split(/\s+/)
    .map(t => t.replace(/[^a-z0-9]/gi, "").toLowerCase())
    .filter(t => t && t !== "putter" && !HEAD_COVER_TOKEN_VARIANTS.has(t) && !CONNECTOR_TOKENS.has(t)
      && !NUMERIC_TOKEN_PATTERN.test(t) && !MEASUREMENT_TOKEN_PATTERN.test(t));
  const remainingCount = strippedTokens.length;

  let leadingAccessoryCount = 0;
  let seenSubstantive = false;
  for (const tok of analysis) {
    if (tok.isFiller) continue;
    if (tok.isAccessory) {
      if (seenSubstantive) break;
      leadingAccessoryCount++;
    } else {
      seenSubstantive = true;
    }
  }

  let hasFitToken = false, hasWeightToken = false, packTokenCount = 0, accessoryCue = 0;
  for (const tok of analysis) {
    const n = tok.norm;
    if (!n) continue;
    if (!hasFitToken && (n === "fit" || n === "fits" || n === "fitting" || n.startsWith("compat"))) hasFitToken = true;
    if (!hasWeightToken && /weight/.test(n)) hasWeightToken = true;
    const isPack = PACK_TOKEN_PATTERN.test(n);
    if (isPack) packTokenCount++;
    if (ACCESSORY_COMBO_TOKENS.has(n) || isPack) accessoryCue++;
  }

  const strongAccessoryCombo =
    accessoryCount >= 2 &&
    (leadingAccessoryCount >= 2 ||
      (packTokenCount > 0 && (hasWeightToken || hasFitToken)) ||
      (hasWeightToken && hasFitToken) ||
      accessoryCue >= 3);

  if (hasHeadcoverSignal) return false;
  if (strongAccessoryCombo) return true;
  if (!remainingCount) return true;

  if (!hasPutterToken && accessoryCount) {
    if (accessoryCount >= remainingCount || accessoryCount >= 2) return true;
  }
  if (!accessoryCount) return false;
  if (substantiveCount && accessoryCount < substantiveCount) return false;
  return accessoryCount >= remainingCount;
}

// ---------------- SQL ----------------

/**
 * Prefer condition-specific stats if available, else ANY.
 * We can’t reliably map eBay condition strings to bands in SQL, so we use ANY in SQL
 * and optionally swap later if the row already contains a simple band name.
 */
async function queryTopDeals(sql, since) {
  return sql`
    WITH latest_prices AS (
      SELECT DISTINCT ON (p.item_id)
        p.item_id,
        p.observed_at,
        p.price,
        p.shipping,
        COALESCE(p.total, p.price + COALESCE(p.shipping, 0)) AS total,
        p.condition
      FROM item_prices p
      WHERE p.observed_at >= ${since}
      ORDER BY p.item_id, p.observed_at DESC
    ),
    base_stats_any AS (
      SELECT DISTINCT ON (model)
        model,
        window_days,
        n,
        p10_cents,
        p50_cents,
        p90_cents,
        dispersion_ratio,
        updated_at
      FROM aggregated_stats_variant
      WHERE variant_key = ''
        AND condition_band = 'ANY'
        AND n >= 5
      ORDER BY model, window_days DESC, updated_at DESC
    )
    SELECT
      i.model_key,
      i.brand,
      i.title,
      i.image_url,
      i.url,
      i.currency,
      i.head_type,
      i.dexterity,
      i.length_in,
      lp.item_id,
      lp.price,
      lp.shipping,
      lp.total,
      lp.observed_at,
      lp.condition,
      stats_any.n AS any_n,
      stats_any.window_days AS any_window_days,
      stats_any.p10_cents AS any_p10_cents,
      stats_any.p50_cents AS any_p50_cents,
      stats_any.p90_cents AS any_p90_cents,
      stats_any.dispersion_ratio AS any_dispersion_ratio,
      stats_any.updated_at AS any_updated_at
    FROM latest_prices lp
    JOIN items i ON i.item_id = lp.item_id
    LEFT JOIN base_stats_any stats_any ON stats_any.model = i.model_key
    WHERE i.model_key IS NOT NULL
      AND i.model_key <> ''
      AND lp.total IS NOT NULL
      AND lp.total > 0
      AND (
        stats_any.p50_cents IS NOT NULL
      )
  `;
}

// Build + filter using thresholds
export function buildDealsFromRows(rows, {
  limit = 6,
  lookbackHoursForMeta = null,
  minSavingsPct = 0.25,   // 25% cheaper than median
  minSample = 20,         // median must be based on >= N listings
  maxDispersion = 3.0,    // drop super-spread models (optional)
  freshnessHours = 12     // listing must be observed within X hours
} = {}) {
  const grouped = new Map();
  const now = Date.now();
  const freshCutoff = freshnessHours ? now - freshnessHours * 3600 * 1000 : null;

  for (const row of rows) {
    const modelKey = row.model_key || "";
    if (!modelKey) continue;

    // title guard
    if (isAccessoryDominatedTitle(row?.title || "")) continue;

    // freshness guard
    const observedAt = row.observed_at ? new Date(row.observed_at).getTime() : 0;
    if (freshCutoff && (!observedAt || observedAt < freshCutoff)) continue;

    const total = NUM(row.total);
    const price = NUM(row.price);
    const shipping = NUM(row.shipping);
    const medianAny = centsToNum(row.any_p50_cents);
    const nAny = NUM(row.any_n);
    const dispersionAny = NUM(row.any_dispersion_ratio);

    if (!Number.isFinite(total) || !Number.isFinite(medianAny) || medianAny <= 0) continue;

    // confidence guards
    if (!Number.isFinite(nAny) || nAny < minSample) continue;
    if (Number.isFinite(dispersionAny) && dispersionAny > maxDispersion) continue;

    const savingsAmount = medianAny - total;
    const savingsPercent = medianAny > 0 ? (savingsAmount / medianAny) : null;
    if (!Number.isFinite(savingsPercent) || savingsPercent < minSavingsPct) continue;

    const current = grouped.get(modelKey);
    if (!current || savingsPercent > current.savingsPercent || (savingsPercent === current.savingsPercent && total < current.total)) {
      grouped.set(modelKey, {
        modelKey,
        row,
        total,
        price,
        shipping,
        median: medianAny,
        n: nAny,
        dispersion: dispersionAny,
        savingsAmount,
        savingsPercent,
      });
    }
  }

  const ranked = Array.from(grouped.values())
    .sort((a, b) => {
      if (b.savingsPercent !== a.savingsPercent) return b.savingsPercent - a.savingsPercent;
      if (a.total !== b.total) return a.total - b.total;
      return 0;
    })
    .slice(0, limit);

  return ranked.map((entry) => {
    const { row, total, price, shipping, median, n, dispersion, savingsAmount, savingsPercent } = entry;
    const label = formatModelLabel(row.model_key, row.brand, row.title);

    const sanitized = sanitizeModelKey(row.model_key, { storedBrand: row.brand });
    const { query: canonicalQuery, queryVariants = {}, rawLabel: rawLabelWithAccessories, cleanLabel: cleanLabelWithoutAccessories } = sanitized;

    let cleanQuery = canonicalQuery || null;
    let accessoryQuery = queryVariants.accessory || null;
    let query = cleanQuery;

    const fallbackCandidates = [
      formatModelLabel(row.model_key, row.brand, row.title),
      [row.brand, row.title].filter(Boolean).join(" ").trim(),
    ].filter(Boolean);

    if (!query && row.brand) {
      const brandBacked = sanitizeModelKey(`${row.brand} ${row.model_key}`, { storedBrand: row.brand });
      if (brandBacked?.query) { query = brandBacked.query; cleanQuery = cleanQuery || brandBacked.query; }
      if (!accessoryQuery && brandBacked?.queryVariants?.accessory) accessoryQuery = brandBacked.queryVariants.accessory;
    }
    if (!query) {
      for (const candidate of fallbackCandidates) {
        const sn = sanitizeModelKey(candidate, { storedBrand: row.brand });
        if (sn?.query) {
          query = sn.query;
          cleanQuery = cleanQuery || sn.query;
          if (!accessoryQuery && sn?.queryVariants?.accessory) accessoryQuery = sn.queryVariants.accessory;
          break;
        }
      }
    }
    if (!query) {
      const base = stripAccessoryTokens(`${row.brand || ""} ${label}`.trim());
      query = ensurePutterQuery(base || label || row.brand || "");
      if (!cleanQuery) cleanQuery = query;
      const accessoryBase = `${row.brand || ""} ${label}`.trim();
      if (!accessoryQuery && accessoryBase) accessoryQuery = ensurePutterQuery(accessoryBase);
    }

    const labelWasAccessoryOnly = Boolean(rawLabelWithAccessories) && !cleanLabelWithoutAccessories;
    const shouldPromoteAccessoryQuery = Boolean(accessoryQuery) && labelWasAccessoryOnly && !cleanQuery;
    if (shouldPromoteAccessoryQuery) query = accessoryQuery; else if (cleanQuery) query = cleanQuery;

    const currency = row.currency || "USD";
    const grade = gradeDeal({ total, p10: centsToNum(row.any_p10_cents), p50: median, p90: centsToNum(row.any_p90_cents), dispersionRatio: dispersion });

    return {
      modelKey: row.model_key,
      label,
      query,
      image: row.image_url || null,
      currency,
      bestPrice: total,
      bestOffer: {
        itemId: row.item_id,
        title: row.title,
        url: decorateEbayUrl(row.url),
        price,
        total,
        shipping,
        currency,
        image: row.image_url,
        observedAt: row.observed_at || null,
        condition: row.condition || null,
        retailer: "eBay",
        specs: {
          headType: row.head_type || null,
          dexterity: row.dexterity || null,
          length: NUM(row.length_in),
        },
        brand: row.brand || null,
      },
      stats: {
        p10: centsToNum(row.any_p10_cents),
        p50: median,
        p90: centsToNum(row.any_p90_cents),
        n,
        dispersionRatio: dispersion,
        source: "aggregated",
      },
      statsMeta: {
        source: "aggregated",
        windowDays: NUM(row.any_window_days),
        updatedAt: row.any_updated_at || null,
        sampleSize: n,
        ...(lookbackHoursForMeta != null ? { lookbackHours: lookbackHoursForMeta } : {}),
      },
      totalListings: null, // optional; can be added with a model_counts join later
      grade: {
        letter: typeof grade.letter === "string" ? grade.letter : null,
        label: typeof grade.label === "string" ? grade.label : null,
        color: typeof grade.color === "string" ? grade.color : null,
        deltaPct: Number.isFinite(grade.deltaPct) ? grade.deltaPct : null,
      },
      savings: {
        amount: Number.isFinite(savingsAmount) ? savingsAmount : null,
        percent: Number.isFinite(savingsPercent) ? savingsPercent : null,
      },
      queryVariants: { clean: cleanQuery || null, accessory: accessoryQuery || null },
      meta: {
        filters: { minSavingsPct, minSample, maxDispersion, freshnessHours },
      },
    };
  });
}

async function loadRankedDeals(sql, {
  limit = 6,
  windows = [24, 72, 168],
  minSavingsPct = 0.25,
  minSample = 20,
  maxDispersion = 3.0,
  freshnessHours = 12,
}) {
  let deals = [];
  let windowHours = windows[windows.length - 1] ?? null;

  for (const hours of windows) {
    const since = new Date(Date.now() - hours * 3600 * 1000);
    const rows = await queryTopDeals(sql, since);
    const computed = buildDealsFromRows(rows, {
      limit,
      lookbackHoursForMeta: hours,
      minSavingsPct,
      minSample,
      maxDispersion,
      freshnessHours,
    });
    deals = computed;
    windowHours = hours;
    if (computed.length > 0) break;
  }
  return { deals, windowHours };
}

export default async function handler(req, res) {
  try {
    const sql = getSql();
    const q = req.query || {};
    const limit = Math.min(12, Math.max(3, NUM(q.limit) ?? 6));

    const windows = Array.isArray(q.windows)
      ? q.windows.map(Number).filter(Number.isFinite)
      : (q.lookbackWindowHours ? [Number(q.lookbackWindowHours)] : null);
    const effectiveWindows = windows && windows.length ? windows : [24, 72, 168];

    const minSavingsPct = Number(q.minSavingsPct ?? 0.25);
    const minSample = Math.max(1, Number(q.minSample ?? 20));
    const maxDispersion = Number(q.maxDispersion ?? 3.0);
    const freshnessHours = Number(q.freshnessHours ?? 12);

    const { deals, windowHours } = await loadRankedDeals(sql, {
      limit,
      windows: effectiveWindows,
      minSavingsPct,
      minSample,
      maxDispersion,
      freshnessHours,
    });

    return res.status(200).json({
      ok: true,
      generatedAt: new Date().toISOString(),
      deals,
      meta: {
        limit,
        modelCount: deals.length,
        lookbackWindowHours: windowHours,
        filters: { minSavingsPct, minSample, maxDispersion, freshnessHours },
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
