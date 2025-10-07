// pages/api/top-deals.js
export const runtime = 'nodejs';

import { getSql } from '../../lib/db';
import { getEbayToken } from '../../lib/ebayAuth';
import { PUTTER_CATALOG } from '../../lib/data/putterCatalog';
import { normalizeModelKey } from '../../lib/normalize';
import {
  sanitizeModelKey,
  stripAccessoryTokens,
  containsAccessoryToken,
  HEAD_COVER_TOKEN_VARIANTS,
  HEAD_COVER_TEXT_RX,
} from '../../lib/sanitizeModelKey';
import { decorateEbayUrl } from '../../lib/affiliate';
import { gradeDeal } from '../../lib/deal-grade';

const DEFAULT_LOOKBACK_WINDOWS_HOURS = [24, 72, 168, 336, 720]; // broadened
const CONNECTOR_TOKENS = new Set(['for','with','and','the','a','to','of','by','from','in','on','at','&','+','plus','or']);
const NUMERIC_TOKEN_PATTERN = /^\d+(?:\.\d+)?$/;
const MEASUREMENT_TOKEN_PATTERN = /^\d+(?:\.\d+)?(?:in|cm|mm|g|gram|grams)$/;
const PACK_TOKEN_PATTERN = /^(?:\d+(?:\/\d+)?(?:pc|pcs|pack)s?|\d+(?:pcs?)|pcs?|pack)$/;
const ACCESSORY_COMBO_TOKENS = new Set(['weight','weights','counterweight','counterweights','fit','fits','fitting','compatible','compatibility','adapter','adapters','kit','kits','wrench','wrenches','tool','tools']);

// ---------- catalog lookup for pretty labels ----------
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

function formatModelLabel(modelKey = '', brand = '', title = '') {
  const normalized = String(modelKey || '').trim();
  if (normalized && CATALOG_LOOKUP.has(normalized)) {
    const [first] = CATALOG_LOOKUP.get(normalized);
    if (first) return `${first.brand} ${first.model}`;
  }
  const brandTitle = String(brand || '').trim();
  if (brandTitle) return brandTitle;
  if (title) return title;
  if (!normalized) return 'Live Smart Price deal';
  return normalized.split(' ')
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : ''))
    .join(' ');
}

function toNumber(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function centsToNumber(v) { const n = toNumber(v); return n == null ? null : n / 100; }

function ensurePutterQuery(text = '') {
  let s = String(text || '').trim();
  if (!s) return 'golf putter';
  s = s.replace(/\bputters\b/gi, 'putter');
  if (!/\bputter\b/i.test(s)) s = `${s} putter`;
  return s.replace(/\s+/g, ' ').trim();
}

// ---------- accessory dominated title filter (same logic you had) ----------
function isAccessoryDominatedTitle(title = '') {
  if (!title) return false;
  const raw = String(title);
  let hasHeadcoverSignal = HEAD_COVER_TEXT_RX.test(raw);
  const hasPutterToken = /\bputter\b/i.test(raw);
  const tokens = raw.split(/\s+/).filter(Boolean);

  let accessoryCount = 0;
  let substantiveCount = 0;
  const analysis = [];

  for (const token of tokens) {
    const norm = token.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (!norm) continue;
    if (HEAD_COVER_TOKEN_VARIANTS.has(norm)) {
      hasHeadcoverSignal = true;
      continue;
    }
    const isNumeric = NUMERIC_TOKEN_PATTERN.test(norm);
    const isMeasurement = MEASUREMENT_TOKEN_PATTERN.test(norm);
    const isConnector = CONNECTOR_TOKENS.has(norm);
    const isPutter = norm === 'putter';
    const isFiller = isPutter || isConnector || isNumeric || isMeasurement;
    const accessory = !isPutter && containsAccessoryToken(token);
    if (accessory) accessoryCount++; else if (!isFiller) substantiveCount++;
    analysis.push({ norm, accessory, filler: isFiller });
  }

  const strippedTokens = stripAccessoryTokens(raw)
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/gi, '').toLowerCase())
    .filter((t) => t && t !== 'putter' && !HEAD_COVER_TOKEN_VARIANTS.has(t) && !CONNECTOR_TOKENS.has(t) && !NUMERIC_TOKEN_PATTERN.test(t) && !MEASUREMENT_TOKEN_PATTERN.test(t));
  const remainingCount = strippedTokens.length;

  let leadingAccessory = 0;
  let seenSubstantive = false;
  for (const t of analysis) {
    if (t.filler) continue;
    if (t.accessory) {
      if (seenSubstantive) break;
      leadingAccessory++;
    } else {
      seenSubstantive = true;
    }
  }

  let hasFit = false, hasWeight = false, packCount = 0, cueCount = 0;
  for (const t of analysis) {
    const n = t.norm;
    if (!n) continue;
    if (!hasFit && (n === 'fit' || n === 'fits' || n === 'fitting' || n.startsWith('compat'))) hasFit = true;
    if (!hasWeight && /weight/.test(n)) hasWeight = true;
    const isPack = PACK_TOKEN_PATTERN.test(n);
    if (isPack) packCount++;
    if (ACCESSORY_COMBO_TOKENS.has(n) || isPack) cueCount++;
  }

  const strongCombo = accessoryCount >= 2 && (leadingAccessory >= 2 || (packCount > 0 && (hasWeight || hasFit)) || (hasWeight && hasFit) || cueCount >= 3);
  if (hasHeadcoverSignal) return true;
  if (strongCombo) return true;
  if (!remainingCount) return true;
  if (!hasPutterToken && accessoryCount) {
    if (accessoryCount >= remainingCount || accessoryCount >= 2) return true;
  }
  if (!accessoryCount) return false;
  if (substantiveCount && accessoryCount < substantiveCount) return false;
  return accessoryCount >= remainingCount;
}

// ---------- DB query ----------
async function queryTopDeals(sql, since, modelKey = null) {
  // latest price per item_id since 'since'
  // attach aggregate stats or live stats; count listings per model
  const rows = await sql/* sql */`
    WITH latest_prices AS (
      SELECT DISTINCT ON (p.item_id)
        p.item_id, p.observed_at, p.price, p.shipping,
        COALESCE(p.total, p.price + COALESCE(p.shipping, 0)) AS total,
        p.condition
      FROM item_prices p
      WHERE p.observed_at >= ${since}
      ORDER BY p.item_id, p.observed_at DESC
    ),
    base_stats AS (
      SELECT DISTINCT ON (model)
        model, window_days, n, p10_cents, p50_cents, p90_cents,
        dispersion_ratio, updated_at
      FROM aggregated_stats_variant
      WHERE variant_key = '' AND condition_band = 'ANY' AND n >= 1
      ORDER BY model, window_days DESC, updated_at DESC
    ),
    model_counts AS (
      SELECT i.model_key, COUNT(*) AS listing_count,

      av.var_n, av.var_p50_cents, av.var_window,
      am.mod_n, am.mod_p50_cents, am.mod_window

FROM latest_prices lp
      JOIN items i ON i.item_id = lp.item_id
      WHERE i.model_key IS NOT NULL AND i.model_key <> ''
      GROUP BY i.model_key
    )
    SELECT
      i.model_key, i.brand, i.title, i.image_url, i.url,
      i.currency, i.head_type, i.dexterity, i.length_in,
      lp.item_id, lp.price, lp.shipping, lp.total, lp.observed_at, lp.condition,
      COALESCE(stats.n, live.live_n) AS n,
      stats.window_days,
      COALESCE(stats.p10_cents, live.live_p10_cents) AS p10_cents,
      COALESCE(stats.p50_cents, live.live_p50_cents) AS p50_cents,
      COALESCE(stats.p90_cents, live.live_p90_cents) AS p90_cents,
      COALESCE(stats.dispersion_ratio, live.live_dispersion_ratio) AS dispersion_ratio,
      COALESCE(stats.updated_at, live.latest_observed_at) AS updated_at,
      mc.listing_count,
      CASE WHEN stats.p50_cents IS NOT NULL THEN 'aggregated'
           WHEN live.live_p50_cents IS NOT NULL THEN 'live'
           ELSE NULL END AS stats_source,
      stats.n AS aggregated_n,
      stats.updated_at AS aggregated_updated_at,
      live.live_n,
      live.latest_observed_at AS live_updated_at
    FROM latest_prices lp
    JOIN items i ON i.item_id = lp.item_id
    LEFT JOIN base_stats stats ON stats.model = i.model_key
    LEFT JOIN LATERAL (
      SELECT n AS var_n, p50_cents AS var_p50_cents, window_days AS var_window
      FROM aggregated_stats_variant a
      WHERE a.model = i.model_key
        AND a.variant_key = COALESCE(i.variant_key, '')
        AND a.condition_band = 'ANY'
      ORDER BY a.window_days DESC
      LIMIT 1
    ) av ON TRUE
    LEFT JOIN LATERAL (
      SELECT n AS mod_n, p50_cents AS mod_p50_cents, window_days AS mod_window
      FROM aggregated_stats_variant a2
      WHERE a2.model = i.model_key
        AND a2.variant_key = ''
        AND a2.condition_band = 'ANY'
      ORDER BY a2.window_days DESC
      LIMIT 1
    ) am ON TRUE

    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) AS live_n,
        percentile_cont(0.1) WITHIN GROUP (ORDER BY lp2.total) * 100 AS live_p10_cents,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY lp2.total) * 100 AS live_p50_cents,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY lp2.total) * 100 AS live_p90_cents,
        MAX(lp2.observed_at) AS latest_observed_at,
        CASE
          WHEN percentile_cont(0.1) WITHIN GROUP (ORDER BY lp2.total) IS NOT NULL
            AND percentile_cont(0.1) WITHIN GROUP (ORDER BY lp2.total) <> 0
          THEN (percentile_cont(0.9) WITHIN GROUP (ORDER BY lp2.total) /
               NULLIF(percentile_cont(0.1) WITHIN GROUP (ORDER BY lp2.total), 0))
          ELSE NULL
        END AS live_dispersion_ratio
      FROM latest_prices lp2
      JOIN items i2 ON i2.item_id = lp2.item_id
      WHERE i2.model_key = i.model_key
        AND lp2.total IS NOT NULL AND lp2.total > 0
    ) AS live ON TRUE
    LEFT JOIN model_counts mc ON mc.model_key = i.model_key
    WHERE i.model_key IS NOT NULL AND i.model_key <> ''
      AND lp.total IS NOT NULL AND lp.total > 0
      ${modelKey ? sql`AND i.model_key = ${modelKey}` : sql``}
      AND (stats.p50_cents IS NOT NULL OR live.live_p50_cents IS NOT NULL)
  `;
  return rows;
}

// ---------- deal building + filters ----------
// keep this in pages/api/top-deals.js

export function buildDealsFromRows(rows, limit, arg3) {
  // Back-compat: if arg3 is a number, treat it as lookbackHours (old signature).
  const opts = (typeof arg3 === 'number' || arg3 == null)
    ? { lookbackHours: (typeof arg3 === 'number' ? arg3 : null) }
    : (arg3 || {});

  const {
    now = new Date(),
    freshnessHours = null,
    minSample = null,
    maxDispersion = null,
    minSavingsPct = 0,
    lookbackHours = null,
  } = opts;

  const grouped = new Map();

  for (const row of rows) {
    // Require 'putter' token to reduce accessory noise
    if (!/\bputter\b/i.test(row?.title || '')) continue;

    const modelKey = row.model_key || '';
    if (!modelKey) continue;

    if (isAccessoryDominatedTitle(row?.title || '')) continue;

    const total = toNumber(row.total);
    const price = toNumber(row.price);
    const shipping = toNumber(row.shipping);
    const varMedian = centsToNumber(row.var_p50_cents);
    const varN = toNumber(row.var_n);
    const modMedian = centsToNumber(row.mod_p50_cents);
    const modN = toNumber(row.mod_n);
    const liveMedian = centsToNumber(row.p50_cents);
    let median = null;
    if (Number.isFinite(varN) && varN >= (minSample ?? 0) && Number.isFinite(varMedian)) {
      median = varMedian;
    } else if (Number.isFinite(modN) && modN >= (minSample ?? 0) && Number.isFinite(modMedian)) {
      median = modMedian;
    } else {
      median = liveMedian;
    }
    
    if (!Number.isFinite(total) || !Number.isFinite(median) || median <= 0) continue;

    // Stats gates
    const sampleSize = toNumber(row.n);
    const dispersion = toNumber(row.dispersion_ratio);
    if (minSample != null && sampleSize != null && sampleSize < minSample) continue;
    if (maxDispersion != null && dispersion != null && dispersion > maxDispersion) continue;

    // Freshness gate (observed_at of THIS listing)
    if (freshnessHours != null && row.observed_at) {
      const obs = new Date(row.observed_at);
      if (now - obs > freshnessHours * 3600 * 1000) continue;
    }

    const savingsAmount = median - total;
    const savingsPercent = median > 0 ? savingsAmount / median : null;
    if (!Number.isFinite(savingsPercent) || savingsPercent <= (minSavingsPct ?? 0)) continue;

    const current = grouped.get(modelKey);
    if (!current || savingsPercent > current.savingsPercent || (savingsPercent === current.savingsPercent && total < current.total)) {
      grouped.set(modelKey, { row, total, price, shipping, median, savingsAmount, savingsPercent });
    }
  }

  const ranked = Array.from(grouped.values())
    .sort((a, b) => {
      if (Number.isFinite(b.savingsPercent) && Number.isFinite(a.savingsPercent) && b.savingsPercent !== a.savingsPercent) {
        return b.savingsPercent - a.savingsPercent;
      }
      if (Number.isFinite(a.total) && Number.isFinite(b.total) && a.total !== b.total) {
        return a.total - b.total;
      }
      return 0;
    })
    .slice(0, limit);

  return ranked.map(({ row, total, price, shipping, median, savingsAmount, savingsPercent }) => {
    const label = formatModelLabel(row.model_key, row.brand, row.title);
    const sanitized = sanitizeModelKey(row.model_key, { storedBrand: row.brand });
    const {
      query: canonicalQuery,
      queryVariants: canonicalVariants = {},
      rawLabel: rawWithAccessories,
      cleanLabel: cleanWithoutAccessories,
    } = sanitized;

    let cleanQuery = canonicalQuery || null;
    let accessoryQuery = canonicalVariants.accessory || null;
    let query = cleanQuery;

    const fallbackCandidates = [
      formatModelLabel(row.model_key, row.brand, row.title),
      [row.brand, row.title].filter(Boolean).join(' ').trim(),
    ].filter(Boolean);

    if (!query && row.brand) {
      const brandBacked = sanitizeModelKey(`${row.brand} ${row.model_key}`, { storedBrand: row.brand });
      if (brandBacked?.query) {
        query = brandBacked.query;
        cleanQuery = cleanQuery || brandBacked.query;
      }
      if (!accessoryQuery && brandBacked?.queryVariants?.accessory) {
        accessoryQuery = brandBacked.queryVariants.accessory;
      }
    }
    if (!query) {
      for (const candidate of fallbackCandidates) {
        const s = sanitizeModelKey(candidate, { storedBrand: row.brand });
        if (s?.query) {
          query = s.query;
          cleanQuery = cleanQuery || s.query;
          if (!accessoryQuery && s?.queryVariants?.accessory) accessoryQuery = s.queryVariants.accessory;
          break;
        }
      }
    }
    if (!query) {
      const base = stripAccessoryTokens(`${row.brand || ''} ${label}`.trim());
      query = ensurePutterQuery(base || label || row.brand || '');
      if (!cleanQuery) cleanQuery = query;
      const accessoryBase = `${row.brand || ''} ${label}`.trim();
      if (!accessoryQuery && accessoryBase) accessoryQuery = ensurePutterQuery(accessoryBase);
    }

    const labelWasAccessoryOnly = Boolean(rawWithAccessories) && !cleanWithoutAccessories;
    const shouldPromoteAccessoryQuery = Boolean(accessoryQuery) && labelWasAccessoryOnly && !cleanQuery;
    if (shouldPromoteAccessoryQuery) query = accessoryQuery; else if (cleanQuery) query = cleanQuery;

    const currency = row.currency || 'USD';
    const statsSource = row.stats_source || null;

    const stats = {
      p10: centsToNumber(row.p10_cents),
      p50: median,
      p90: centsToNumber(row.p90_cents),
      n: toNumber(row.n),
      dispersionRatio: toNumber(row.dispersion_ratio),
      source: statsSource,
    };
    const statsMeta = {
      source: statsSource,
      windowDays: statsSource === 'aggregated' ? toNumber(row.window_days) : null,
      updatedAt: statsSource === 'aggregated' ? (row.aggregated_updated_at || row.updated_at || null) : (row.live_updated_at || row.updated_at || null),
      sampleSize: statsSource === 'aggregated' ? toNumber(row.aggregated_n ?? row.n) : toNumber(row.live_n ?? row.n),
    };
    if (statsSource === 'live' && lookbackHours != null) statsMeta.lookbackHours = lookbackHours;

    const bestOffer = {
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
      retailer: 'eBay',
      specs: { headType: row.head_type || null, dexterity: row.dexterity || null, length: toNumber(row.length_in) },
      brand: row.brand || null,
    };

    const grade = gradeDeal({ total, p10: stats.p10, p50: stats.p50, p90: stats.p90, dispersionRatio: stats.dispersionRatio });

    return {
      modelKey: row.model_key,
      label,
      query,
      image: row.image_url || null,
      currency,
      bestPrice: total,
      bestOffer,
      stats,
      statsMeta,
      totalListings: toNumber(row.listing_count),
      grade: {
        letter: typeof grade.letter === 'string' ? grade.letter : null,
        label: typeof grade.label === 'string' ? grade.label : null,
        color: typeof grade.color === 'string' ? grade.color : null,
        deltaPct: Number.isFinite(grade.deltaPct) ? grade.deltaPct : null,
      },
      savings: {
        amount: Number.isFinite(savingsAmount) ? savingsAmount : null,
        percent: Number.isFinite(savingsPercent) ? savingsPercent : null,
      },
      queryVariants: { clean: cleanQuery || null, accessory: accessoryQuery || null },
    };
  });
er ${token}`,
          'Content-Type': 'application/json',
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        },
      });
      if (r.status === 404) continue; // ended or not found
      if (!r.ok) continue; // be conservative
      out.push(d);
    } catch {
      // network hiccup — keep it (fail-open) so page doesn’t go blank
      out.push(d);
    }
  }
  return out;
}

// ---------- main loader ----------
async function loadRankedDeals(sql, limit, windows, filters, modelKey = null) {
  const windowsToTry = Array.isArray(windows) && windows.length ? windows : DEFAULT_LOOKBACK_WINDOWS_HOURS;
  let deals = [];
  let usedWindow = windowsToTry[windowsToTry.length - 1] ?? null;

  for (const hours of windowsToTry) {
    const since = new Date(Date.now() - hours * 3600 * 1000);
    const rows = await queryTopDeals(sql, since, modelKey);
    const computed = buildDealsFromRows(rows, limit, { ...filters, lookbackHours: hours });
    deals = computed;
    usedWindow = hours;
    if (computed.length > 0) break;
  }

  return { deals, windowHours: usedWindow };
}
export { loadRankedDeals };


// ---------- handler ----------
export default async function handler(req, res) {
  try {
    const sql = getSql();

    // parse query params
    const limit = Math.min(12, Math.max(3, toNumber(req.query.limit) ?? 12));
    const lookback = toNumber(req.query.lookbackWindowHours) || null;
    const windows = lookback ? [lookback] : DEFAULT_LOOKBACK_WINDOWS_HOURS;

    const freshnessHours = toNumber(req.query.freshnessHours);
    const minSample = toNumber(req.query.minSample);
    const maxDispersion = toNumber(req.query.maxDispersion);
    const minSavingsPct = toNumber(req.query.minSavingsPct);
    const verify = String(req.query.verify || '') === '1';
    const modelParam = (req.query.model || '').trim();
    const modelKey = modelParam ? normalizeModelKey(modelParam) : null;

    const filters = {
      freshnessHours: Number.isFinite(freshnessHours) ? freshnessHours : 24,
      minSample: Number.isFinite(minSample) ? minSample : 10,
      maxDispersion: Number.isFinite(maxDispersion) ? maxDispersion : 3,
      minSavingsPct: Number.isFinite(minSavingsPct) ? minSavingsPct : 0.25,
    };

    const { deals: baseDeals, windowHours } = await loadRankedDeals(sql, limit, windows, filters, modelKey);
    const deals = verify ? await verifyDealsActive(baseDeals) : baseDeals;

    return res.status(200).json({
      ok: true,
      generatedAt: new Date().toISOString(),
      deals,
      meta: {
        limit,
        modelCount: deals.length,
        lookbackWindowHours: windowHours,
        modelKey,
        filters,
        verified: verify,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
