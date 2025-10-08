// pages/api/top-deals.js
export const runtime = 'nodejs';

import { getSql } from '../../lib/db';
import { getEbayToken } from '../../lib/ebayAuth';
import { sanitizeModelKey, stripAccessoryTokens } from '../../lib/sanitizeModelKey';
import { decorateEbayUrl } from '../../lib/affiliate';
import { gradeDeal } from '../../lib/deal-grade';
import { composeDealLabel, formatModelLabel } from '../../lib/deal-label';
import { normalizeModelKey } from '../../lib/normalize';
import { evaluateAccessoryGuard } from '../../lib/text-filters';

// ---------- Hobby-friendly performance knobs ----------
const TIME_BUDGET_MS = 7500;                  // well under Hobby cap (~10s)
const FAST_WINDOWS = [72, 168, 336, 720];               // fewer windows for ?fast=1

// Default windows (strict → broader)
const DEFAULT_LOOKBACK_WINDOWS_HOURS = [24, 72, 168, 336, 720];

// Auto-relax ladder so the endpoint rarely returns empty
const FALLBACK_TRIES = [
  { freshnessHours: 48,  minSample: 8, minSavingsPct: 0.20, maxDispersion: 5 },
  { freshnessHours: 48,  minSample: 6, minSavingsPct: 0.20, maxDispersion: 5 },
  { freshnessHours: 48,  minSample: 5, minSavingsPct: 0.15, maxDispersion: 5 },
  { lookbackWindowHours: 168, freshnessHours: 72, minSample: 5, minSavingsPct: 0.15, maxDispersion: 5 },
  { lookbackWindowHours: 336, freshnessHours: 72, minSample: 4, minSavingsPct: 0.12, maxDispersion: 5.5 },
  { lookbackWindowHours: 720, freshnessHours: 72, minSample: 3, minSavingsPct: 0.10, maxDispersion: 6 },
  { lookbackWindowHours: 720, freshnessHours: 96, minSample: 0,  minSavingsPct: 0.00, maxDispersion: 8 } // last resort so cache isn't empty
];

// ---------- small utils ----------
function toNumber(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function centsToNumber(v) { const n = toNumber(v); return n == null ? null : n / 100; }
function ensurePutterQuery(text = '') {
  let s = String(text || '').trim();
  if (!s) return 'golf putter';
  s = s.replace(/\bputters\b/gi, 'putter');
  if (!/\bputter\b/i.test(s)) s = `${s} putter`;
  return s.replace(/\s+/g, ' ').trim();
}

// ---------- fast=1 helper: if aggregates exist, ignore live_* fields afterwards ----------
function fastRows(rows) {
  return rows.map(r =>
    r.stats_source === 'aggregated'
      ? { ...r, live_n: null, live_p10_cents: null, live_p50_cents: null, live_p90_cents: null, live_dispersion_ratio: null }
      : r
  );
}

// ---------- Main SQL ----------
async function queryTopDeals(sql, since, modelKey = null) {
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
      SELECT i.model_key, COUNT(*) AS listing_count
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
      live.latest_observed_at AS live_updated_at,

      -- ANY medians (variant/model)
      av.var_n, av.var_p50_cents, av.var_window,
      am.mod_n, am.mod_p50_cents, am.mod_window,

      -- BAND medians (variant/model)
      avb.var_band_n, avb.var_band_p50_cents, avb.var_band_window,
      amb.mod_band_n, amb.mod_band_p50_cents, amb.mod_band_window,

      -- Which band this listing is in
      c.cond_band,

      COALESCE(v.variant_key, '') AS variant_key

    FROM latest_prices lp
    JOIN items i ON i.item_id = lp.item_id
    LEFT JOIN base_stats stats ON stats.model = i.model_key

    -- latest variant_key for this item
    LEFT JOIN LATERAL (
      SELECT ls.variant_key
      FROM listing_snapshots ls
      WHERE ls.item_id = lp.item_id
        AND ls.variant_key IS NOT NULL
        AND ls.variant_key <> ''
      ORDER BY ls.snapshot_ts DESC
      LIMIT 1
    ) v ON TRUE

    -- Map eBay conditionId -> band for this row
   -- Map eBay conditionId → condition_band (robust for text/int)
LEFT JOIN LATERAL (
  SELECT CASE
    WHEN lp.condition::text IN ('1000') THEN 'NEW'
    WHEN lp.condition::text IN ('1500','2000','2500','2750') THEN 'MINT'
    WHEN lp.condition::text IN ('3000') THEN 'USED'
    WHEN lp.condition::text IN ('4000') THEN 'VERY_GOOD'
    WHEN lp.condition::text IN ('5000') THEN 'GOOD'
    WHEN lp.condition::text IN ('6000') THEN 'ACCEPTABLE'
    ELSE 'ANY'
  END AS cond_band
) c ON TRUE


    -- Variant + ANY
    LEFT JOIN LATERAL (
      SELECT n AS var_n, p50_cents AS var_p50_cents, window_days AS var_window
      FROM aggregated_stats_variant a
      WHERE a.model = i.model_key
        AND a.variant_key = COALESCE(v.variant_key, '')
        AND a.condition_band = 'ANY'
      ORDER BY a.window_days DESC
      LIMIT 1
    ) av ON TRUE

    -- Variant + BAND (preferred)
    LEFT JOIN LATERAL (
      SELECT n AS var_band_n, p50_cents AS var_band_p50_cents, window_days AS var_band_window
      FROM aggregated_stats_variant a
      WHERE a.model = i.model_key
        AND a.variant_key = COALESCE(v.variant_key, '')
        AND a.condition_band = c.cond_band
      ORDER BY a.window_days DESC
      LIMIT 1
    ) avb ON TRUE

    -- Model + ANY
    LEFT JOIN LATERAL (
      SELECT n AS mod_n, p50_cents AS mod_p50_cents, window_days AS mod_window
      FROM aggregated_stats_variant a2
      WHERE a2.model = i.model_key
        AND a2.variant_key = ''
        AND a2.condition_band = 'ANY'
      ORDER BY a2.window_days DESC
      LIMIT 1
    ) am ON TRUE

    -- Model + BAND
    LEFT JOIN LATERAL (
      SELECT n AS mod_band_n, p50_cents AS mod_band_p50_cents, window_days AS mod_band_window
      FROM aggregated_stats_variant a2
      WHERE a2.model = i.model_key
        AND a2.variant_key = ''
        AND a2.condition_band = c.cond_band
      ORDER BY a2.window_days DESC
      LIMIT 1
    ) amb ON TRUE

    -- Live percentiles ONLY when aggregates missing (cheap gate)
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
        AND (stats.p50_cents IS NULL) -- do not compute live if aggregated exists
    ) AS live ON TRUE

    LEFT JOIN model_counts mc ON mc.model_key = i.model_key
    WHERE i.model_key IS NOT NULL AND i.model_key <> ''
      AND lp.total IS NOT NULL AND lp.total > 0
      ${modelKey ? sql`AND i.model_key = ${modelKey}` : sql``}
      AND (stats.p50_cents IS NOT NULL OR live.live_p50_cents IS NOT NULL)
  `;
  return rows;
}

// ---------- Deal computation ----------
export function buildDealsFromRows(rows, limit, arg3) {
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
    debugAccessoryList = null,
    captureAccessoryDrops = false,
  } = opts;

  const grouped = new Map();

  const debugSink = Array.isArray(debugAccessoryList) ? debugAccessoryList : null;

  for (const row of rows) {
    const title = row?.title || '';
    const modelKey = row.model_key || '';

    const recordDrop = (reason, extra = {}) => {
      if (!captureAccessoryDrops || !debugSink) return;
      const payload = {
        title,
        reason,
        ...(extra && typeof extra === 'object' ? extra : {}),
      };
      if (row?.item_id) payload.itemId = row.item_id;
      if (row?.model_key) payload.modelKey = row.model_key;
      debugSink.push(payload);
    };

    const guard = evaluateAccessoryGuard(title);

    if (guard.isAccessory) {
      recordDrop(guard.reason || 'accessory_filtered', {
        dropTokens: guard.dropTokens,
        hasCoreToken: guard.hasCoreToken,
      });
      continue;
    }

    if (!modelKey) {
      recordDrop('missing_model_key', {
        hasCoreToken: guard.hasCoreToken,
      });
      continue;
    }

    const total = toNumber(row.total);
    const price = toNumber(row.price);
    const shipping = toNumber(row.shipping);
    const variantKey = typeof row.variant_key === 'string' ? row.variant_key : '';

    // ANY-band medians
    const varMedian = centsToNumber(row.var_p50_cents);
    const varN = toNumber(row.var_n);
    const modMedian = centsToNumber(row.mod_p50_cents);
    const modN = toNumber(row.mod_n);

    // BAND-specific medians
    const varBandMedian = centsToNumber(row.var_band_p50_cents);
    const varBandN = toNumber(row.var_band_n);
    const modBandMedian = centsToNumber(row.mod_band_p50_cents);
    const modBandN = toNumber(row.mod_band_n);
    const usedBand = row.cond_band || null;

    const liveMedian = centsToNumber(row.p50_cents);

    // Choose median by fallback: variant+band → model+band → variant+ANY → model+ANY → live
    let median = null;
    let bandSample = null;
    let bandUsed = null;
    let medianSource = null;
    let medianSample = null;


    if (Number.isFinite(varBandN) && varBandN >= (minSample ?? 0) && Number.isFinite(varBandMedian)) {
      median = varBandMedian;
      bandSample = varBandN;
      bandUsed = usedBand;
      medianSource = 'variant_band';
      medianSample = varBandN;
    } else if (Number.isFinite(modBandN) && modBandN >= (minSample ?? 0) && Number.isFinite(modBandMedian)) {
      median = modBandMedian;
      bandSample = modBandN;
      bandUsed = usedBand;
      medianSource = 'model_band';
      medianSample = modBandN;
    } else if (Number.isFinite(varN) && varN >= (minSample ?? 0) && Number.isFinite(varMedian)) {
      median = varMedian;
      medianSource = 'variant_any';
      medianSample = varN;
    } else if (Number.isFinite(modN) && modN >= (minSample ?? 0) && Number.isFinite(modMedian)) {
      median = modMedian;
      medianSource = 'model_any';
      medianSample = modN;
    } else {
      median = liveMedian;
      medianSource = 'live';
      medianSample = toNumber(row.n);
    }

    if (!Number.isFinite(total) || !Number.isFinite(median) || median <= 0) continue;

    // Global sample/dispersion gates (from aggregate/live row)
    const sampleSize = toNumber(row.n);
    const dispersion = toNumber(row.dispersion_ratio);
    if (minSample != null && sampleSize != null && sampleSize < minSample) continue;
    if (maxDispersion != null && dispersion != null && dispersion > maxDispersion) continue;

    // Freshness gate on THIS listing
    if (freshnessHours != null && row.observed_at) {
      const obs = new Date(row.observed_at);
      if (now - obs > freshnessHours * 3600 * 1000) continue;
    }

    const savingsAmount = median - total;
    const savingsPercent = median > 0 ? savingsAmount / median : null;
    if (!Number.isFinite(savingsPercent) || savingsPercent <= (minSavingsPct ?? 0)) continue;

    const current = grouped.get(modelKey);
    if (!current || savingsPercent > current.savingsPercent || (savingsPercent === current.savingsPercent && total < current.total)) {
      grouped.set(modelKey, {
        row, total, price, shipping, median, savingsAmount, savingsPercent,
        bandUsed, bandSample, medianSource, medianSample
      });
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

  return ranked.map(({ row, total, price, shipping, median, savingsAmount, savingsPercent, bandUsed, bandSample, medianSource, medianSample }) => {
    const sanitized = sanitizeModelKey(row.model_key, { storedBrand: row.brand });
    const { label, brand: displayBrand } = composeDealLabel(row, sanitized);
    const variantKey = typeof row.variant_key === 'string' ? row.variant_key : '';
    const { query: canonicalQuery, queryVariants: canonicalVariants = {}, rawLabel: rawWithAccessories, cleanLabel: cleanWithoutAccessories } = sanitized;

    let cleanQuery = canonicalQuery || null;
    let accessoryQuery = canonicalVariants.accessory || null;
    let query = cleanQuery;

    const fallbackCandidates = [
      label,
      formatModelLabel(row.model_key, row.brand, row.title),
      [row.brand, row.title].filter(Boolean).join(' ').trim(),
    ].filter(Boolean);

    if (!query && row.brand) {
      const brandBacked = sanitizeModelKey(`${row.brand} ${row.model_key}`, { storedBrand: row.brand });
      if (brandBacked?.query) { query = brandBacked.query; cleanQuery = cleanQuery || brandBacked.query; }
      if (!accessoryQuery && brandBacked?.queryVariants?.accessory) accessoryQuery = brandBacked.queryVariants.accessory;
    }
    if (!query) {
      for (const candidate of fallbackCandidates) {
        const s = sanitizeModelKey(candidate, { storedBrand: row.brand });
        if (s?.query) { query = s.query; cleanQuery = cleanQuery || s.query; if (!accessoryQuery && s?.queryVariants?.accessory) accessoryQuery = s.queryVariants.accessory; break; }
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

    const resolvedCondition = bandUsed || (row.cond_band || null);
    const stats = {
      p10: centsToNumber(row.p10_cents),
      p50: median,
      p90: centsToNumber(row.p90_cents),
      n: toNumber(row.n),
      dispersionRatio: toNumber(row.dispersion_ratio),
      source: statsSource,
      usedBand: resolvedCondition,
      conditionBand: resolvedCondition,
      variantKey: variantKey || null,
      medianSource,
    };
    const statsMeta = {
      source: statsSource,
      windowDays: statsSource === 'aggregated' ? toNumber(row.window_days) : null,
      updatedAt: statsSource === 'aggregated'
        ? (row.aggregated_updated_at || row.updated_at || null)
        : (row.live_updated_at || row.updated_at || null),
      sampleSize: statsSource === 'aggregated'
        ? toNumber(row.aggregated_n ?? row.n)
        : toNumber(row.live_n ?? row.n),
      bandSampleSize: bandSample,         // NEW: n used for the banded p50
      medianSource,
      conditionBand: resolvedCondition,
      variantKey: variantKey || null,
      medianSampleSize: Number.isFinite(medianSample) ? medianSample : null,
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
      conditionBand: resolvedCondition,
      retailer: 'eBay',
      specs: { headType: row.head_type || null, dexterity: row.dexterity || null, length: toNumber(row.length_in) },
      brand: displayBrand || row.brand || null,
    };

    const grade = gradeDeal({
      savingsPct: Number.isFinite(savingsPercent) ? savingsPercent : null,
    });

    const conditionBand = resolvedCondition;
    const sampleLabel = Number.isFinite(medianSample) && medianSample > 0 ? ` (n=${medianSample})` : '';
    let gradeReason = null;
    switch (medianSource) {
      case 'variant_band':
        gradeReason = `variant ${conditionBand || 'ANY'} median${sampleLabel}`;
        break;
      case 'model_band':
        gradeReason = `model ${conditionBand || 'ANY'} median${sampleLabel}`;
        break;
      case 'variant_any':
        gradeReason = `fallback: variant p50${sampleLabel}`;
        break;
      case 'model_any':
        gradeReason = `fallback: model p50${sampleLabel}`;
        break;
      default:
        gradeReason = `fallback: live p50${sampleLabel}`;
        break;
    }

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
      brand: row.brand || null,
      model: row.model_key || null,
      conditionBand,
      variantKey: variantKey || null,
      dealGrade: typeof grade.letter === 'string' ? grade.letter : null,
      gradeReason,
      savingsPct: Number.isFinite(savingsPercent) ? savingsPercent : null,
      medianPrice: Number.isFinite(median) ? median : null,
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
}

// ---------- Optional 404 verification against eBay (fail-open) ----------
async function verifyDealsActive(deals = []) {
  try {
    const token = await getEbayToken();
    const out = [];
    for (const d of deals) {
      try {
        const id = d?.bestOffer?.itemId || d?.itemId || d?.id;
        if (!id) { out.push(d); continue; }
        const r = await fetch(`https://api.ebay.com/buy/browse/v1/item/${id}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
          },
        });
        if (r.status === 404) continue;
        if (!r.ok) continue;
        out.push(d);
      } catch {
        out.push(d);
      }
    }
    return out;
  } catch {
    return deals;
  }
}

// ---------- Loader that tries windows with time budget ----------
async function loadRankedDeals(sql, limit, windows, filters, modelKey = null, fast = false, startTime = Date.now()) {
  const windowsToTry = Array.isArray(windows) && windows.length ? windows : DEFAULT_LOOKBACK_WINDOWS_HOURS;
  let deals = [];
  let usedWindow = windowsToTry[windowsToTry.length - 1] ?? null;

  for (const hours of windowsToTry) {
    const since = new Date(Date.now() - hours * 3600 * 1000);
    if (Date.now() - startTime > TIME_BUDGET_MS) break;
    const rows = await queryTopDeals(sql, since, modelKey);
    const usedRows = fast ? fastRows(rows) : rows;
    const computed = buildDealsFromRows(usedRows, limit, { ...filters, lookbackHours: hours });
    deals = computed;
    usedWindow = hours;
    if (computed.length > 0) break;
  }

  return { deals, windowHours: usedWindow };
}
export { loadRankedDeals };

// ---------- API handler ----------
export default async function handler(req, res) {
  try {
    const sql = getSql();

    // Parse query
    const limit = Math.min(12, Math.max(3, toNumber(req.query.limit) ?? 12));
    const lookback = toNumber(req.query.lookbackWindowHours) || null;
    const verify = String(req.query.verify || '') === '1';
    const modelParam = (req.query.model || '').trim();
    const modelKey = modelParam ? normalizeModelKey(modelParam) : null;
    const debugAccessories = String(req.query.debugAccessories || '') === '1';
    const accessoryDebug = [];

    const startTime = Date.now();
    const fast = String(req.query.fast || '') === '1';
    const windows = lookback ? [lookback] : (fast ? FAST_WINDOWS : DEFAULT_LOOKBACK_WINDOWS_HOURS);

    const freshnessHours = toNumber(req.query.freshnessHours);
    const minSample = toNumber(req.query.minSample);
    const maxDispersion = toNumber(req.query.maxDispersion);
    const minSavingsPct = toNumber(req.query.minSavingsPct);

    // Serve cached payload first (enabled by default)
    const useCache = String(req.query.cache || '1') === '1' && !debugAccessories;
    if (useCache && !modelKey && !verify) {
      try {
        const [cached] = await sql/* sql */`
          SELECT payload, generated_at FROM top_deals_cache WHERE cache_key = 'default'
        `;
        if (cached?.payload) {
          return res.status(200).json({
            ...cached.payload,
            meta: { ...(cached.payload.meta || {}), cache: { key: 'default', generatedAt: cached.generated_at } }
          });
        }
      } catch { /* fall through */ }
    }

    // Friendlier defaults while aggregates deepen (keeps homepage populated)
    const filters = {
      freshnessHours: Number.isFinite(freshnessHours) ? freshnessHours : 48,
      minSample:     Number.isFinite(minSample) ? minSample : 6,
      maxDispersion: Number.isFinite(maxDispersion) ? maxDispersion : 5,
      minSavingsPct: Number.isFinite(minSavingsPct) ? minSavingsPct : 0.20,
      captureAccessoryDrops: debugAccessories,
      debugAccessoryList: accessoryDebug,
    };

    // Try strict-ish first
    let { deals: baseDeals, windowHours } = await loadRankedDeals(sql, limit, windows, filters, modelKey, fast, startTime);
    let deals = verify ? await verifyDealsActive(baseDeals) : baseDeals;

    // Auto-relax progressively if empty
    let usedFilters = { ...filters };
    let fallbackUsed = false;

    if (deals.length === 0) {
      for (const bump of FALLBACK_TRIES) {
        if (Date.now() - startTime > TIME_BUDGET_MS) break;
        const mergedFilters = {
          ...usedFilters,
          freshnessHours: bump.freshnessHours ?? usedFilters.freshnessHours,
          minSample: bump.minSample ?? usedFilters.minSample,
          maxDispersion: bump.maxDispersion ?? usedFilters.maxDispersion,
          minSavingsPct: bump.minSavingsPct ?? usedFilters.minSavingsPct,
        };
        const windows2 = bump.lookbackWindowHours ? [bump.lookbackWindowHours] : windows;
        const res2 = await loadRankedDeals(sql, limit, windows2, mergedFilters, modelKey, fast, startTime);
        const d2 = verify ? await verifyDealsActive(res2.deals) : res2.deals;
        if (d2.length > 0) {
          deals = d2;
          windowHours = res2.windowHours;
          usedFilters = mergedFilters;
          fallbackUsed = true;
          break;
        }
      }
    }

    // Optional: write computed payload into cache (for nightly cron)
    const cacheWrite = String(req.query.cacheWrite || '') === '1';
   // after you compute `deals` and `payload`
  // --- CONDITIONAL CACHE WRITE (skip empty) -----------------------
  const okAuth = req.headers['x-cron-secret'] === process.env.CRON_SECRET;
  const modelCount = Array.isArray(deals) ? deals.length : 0;
  const lookbackWindowHours = windowHours ?? null;

  const baseMeta = {
    limit,
    modelCount,
    lookbackWindowHours,
    modelKey: modelKey || null,
    filters: {
      freshnessHours,
      minSample,
      maxDispersion,
      minSavingsPct,
    },
    verified: !!verified,
    fallbackUsed: !!fallbackUsed,
  };

  const shouldWrite =
    cacheWrite &&
    okAuth &&
    Array.isArray(deals) &&
    deals.length > 0;

  if (shouldWrite) {
    const payload = {
      ok: true,
      generatedAt: new Date().toISOString(),
      deals,
      meta: baseMeta,
    };

    // NOTE: make sure every template/backtick closes properly:
    await sql/* sql */`
      INSERT INTO top_deals_cache (cache_key, payload)
      VALUES ('default', ${JSON.stringify(payload)}::jsonb)
      ON CONFLICT (cache_key) DO UPDATE
      SET payload = EXCLUDED.payload,
          generated_at = now()
    `;
  }

  // --- RESPONSE ---------------------------------------------------
  const meta = { ...baseMeta };

  const payload = {
    ok: true,
    generatedAt: new Date().toISOString(),
    deals,
    meta,
  };

  if (debugAccessories) {
    payload.filteredOut = accessoryDebug;
    payload.meta.debug = {
      accessoryDrops: accessoryDebug,
    };
  }

  return res.status(200).json(payload);
} catch (err) {
  console.error(err);
  return res
    .status(500)
    .json({ ok: false, error: err?.message || String(err) });
 }

}

