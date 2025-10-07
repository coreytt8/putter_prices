// pages/api/top-deals.js
export const runtime = 'nodejs';

import { getSql } from '../../lib/db';
import { getEbayToken } from '../../lib/ebayAuth';
import { PUTTER_CATALOG } from '../../lib/data/putterCatalog';
import { normalizeModelKey } from '../../lib/normalize';
import {
  sanitizeModelKey,
  stripAccessoryTokens,
  HEAD_COVER_TOKEN_VARIANTS,
  HEAD_COVER_TEXT_RX,
} from '../../lib/sanitizeModelKey';
import { decorateEbayUrl } from '../../lib/affiliate';
import { gradeDeal } from '../../lib/deal-grade';

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

// ---------- Catalog label helper ----------
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

// ---------- likely putter title (so we don't require literal "putter") ----------
function isLikelyPutterTitle(title = '') {
  const t = String(title || '').toLowerCase();
  if (/\bputter\b/i.test(t)) return true;
  if (/\b(newport|phantom\s?x|anser|spider|odyssey|rossie|squareback|fastback|del\s*mar|studio|sigma|tomcat|monza|monte|er[ -]?\d)\b/i.test(t)) return true;
  if (/\b(32|33|34|35|36)\s?(in|inch|")\b/.test(t)) return true;
  if (/\b(blade|mallet|center\s?shaft(ed)?|face\s?balanced|milled)\b/i.test(t)) return true;
  return false;
}

// ---------- accessory dominated title filter (hardened but tolerant) ----------
function isAccessoryDominatedTitle(title = '') {
  if (!title) return false;
  const raw = String(title);

  // 1) If headcover tokens in free text → drop
  if (HEAD_COVER_TEXT_RX.test(raw)) return true;

  const tokens = raw.split(/\s+/).filter(Boolean);
  const ACCESSORY_TOKENS = new Set([
    'weight','weights','screw','screws','wrench','tool','tools','kit','adapter',
    'plate','plates','sole','soleplate','cap','plug','plugs','bumper',
    'shaft','shaft-only','shafonly','grip','grip-only','griponly','hosel','neck',
    'cover','headcover','head-cover','head','plate',
  ]);

  let accessoryCount = 0;
  let substantiveCount = 0;

  for (const token of tokens) {
    const norm = token.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (!norm) continue;

    if (HEAD_COVER_TOKEN_VARIANTS.has(norm)) { accessoryCount++; continue; }
    if (ACCESSORY_TOKENS.has(norm)) { accessoryCount++; continue; }

    if (
      /\b(32|33|34|35|36)\b/.test(norm) ||
      /newport|phantom|anser|spider|odyssey|rossie|er\d+/.test(norm) ||
      /blade|mallet|milled|center|face|balanced/.test(norm)
    ) {
      substantiveCount++;
    }
  }

  const likely = isLikelyPutterTitle(raw);
  if (likely && accessoryCount <= substantiveCount + 1) return false;
  if (!likely && accessoryCount >= 2) return true;
  return false;
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
      c.cond_band

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
  } = opts;

  const grouped = new Map();

  for (const row of rows) {
    if (!isLikelyPutterTitle(row?.title || '')) continue;
    if (isAccessoryDominatedTitle(row?.title || '')) continue;

    const modelKey = row.model_key || '';
    if (!modelKey) continue;

    const total = toNumber(row.total);
    const price = toNumber(row.price);
    const shipping = toNumber(row.shipping);

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

    if (Number.isFinite(varBandN) && varBandN >= (minSample ?? 0) && Number.isFinite(varBandMedian)) {
      median = varBandMedian; bandSample = varBandN; bandUsed = usedBand;
    } else if (Number.isFinite(modBandN) && modBandN >= (minSample ?? 0) && Number.isFinite(modBandMedian)) {
      median = modBandMedian; bandSample = modBandN; bandUsed = usedBand;
    } else if (Number.isFinite(varN) && varN >= (minSample ?? 0) && Number.isFinite(varMedian)) {
      median = varMedian;
    } else if (Number.isFinite(modN) && modN >= (minSample ?? 0) && Number.isFinite(modMedian)) {
      median = modMedian;
    } else {
      median = liveMedian;
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
        bandUsed, bandSample
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

  return ranked.map(({ row, total, price, shipping, median, savingsAmount, savingsPercent, bandUsed, bandSample }) => {
    const label = formatModelLabel(row.model_key, row.brand, row.title);
    const sanitized = sanitizeModelKey(row.model_key, { storedBrand: row.brand });
    const { query: canonicalQuery, queryVariants: canonicalVariants = {}, rawLabel: rawWithAccessories, cleanLabel: cleanWithoutAccessories } = sanitized;

    let cleanQuery = canonicalQuery || null;
    let accessoryQuery = canonicalVariants.accessory || null;
    let query = cleanQuery;

    const fallbackCandidates = [
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

    const stats = {
      p10: centsToNumber(row.p10_cents),
      p50: median,
      p90: centsToNumber(row.p90_cents),
      n: toNumber(row.n),
      dispersionRatio: toNumber(row.dispersion_ratio),
      source: statsSource,
      usedBand: bandUsed,                 // NEW: band used for median, e.g., 'USED', 'NEW', ...
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

    const grade = gradeDeal({
      total,
      p10: stats.p10,
      p50: stats.p50,
      p90: stats.p90,
      dispersionRatio: stats.dispersionRatio
    });

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

    const startTime = Date.now();
    const fast = String(req.query.fast || '') === '1';
    const windows = lookback ? [lookback] : (fast ? FAST_WINDOWS : DEFAULT_LOOKBACK_WINDOWS_HOURS);

    const freshnessHours = toNumber(req.query.freshnessHours);
    const minSample = toNumber(req.query.minSample);
    const maxDispersion = toNumber(req.query.maxDispersion);
    const minSavingsPct = toNumber(req.query.minSavingsPct);

    // Serve cached payload first (enabled by default)
    const useCache = String(req.query.cache || '1') === '1';
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
    const okAuth = (req.headers['x-cron-secret'] && process.env.CRON_SECRET && req.headers['x-cron-secret'] === process.env.CRON_SECRET);
    if (cacheWrite && okAuth) {
      try {
        await sql/* sql */`
          CREATE TABLE IF NOT EXISTS top_deals_cache (
            cache_key TEXT PRIMARY KEY,
            payload   JSONB NOT NULL,
            generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
          )
        `;
        await sql/* sql */`
          INSERT INTO top_deals_cache (cache_key, payload)
          VALUES ('default', ${{
            ok: true,
            generatedAt: new Date().toISOString(),
            deals,
            meta: {
              limit,
              modelCount: deals.length,
              lookbackWindowHours: windowHours,
              modelKey,
              filters: usedFilters,
              verified: verify,
              fallbackUsed,
            },
          }}::jsonb)
          ON CONFLICT (cache_key) DO UPDATE
          SET payload = EXCLUDED.payload, generated_at = now()
        `;
      } catch { /* ignore cache errors */ }
    }

    return res.status(200).json({
      ok: true,
      generatedAt: new Date().toISOString(),
      deals,
      meta: {
        limit,
        modelCount: deals.length,
        lookbackWindowHours: windowHours,
        modelKey,
        filters: usedFilters,
        verified: verify,
        fallbackUsed,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
