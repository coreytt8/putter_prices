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

// --- Hobby plan performance knobs ---
const TIME_BUDGET_MS = 7500;             // stay under Hobby (~10s) cap
const FAST_WINDOWS = [72, 168];          // smaller ladder when fast=1

const DEFAULT_LOOKBACK_WINDOWS_HOURS = [24, 72, 168, 336, 720]; // broadened
const CONNECTOR_TOKENS = new Set(['for','with','and','the','a','to','of','by','from','in','on','at','&','+','plus','or']);
const NUMERIC_TOKEN_PATTERN = /^\d+(?:\.\d+)?$/;
const MEASUREMENT_TOKEN_PATTERN = /^\d+(?:\.\d+)?(?:in|cm|mm|g|gram|grams)$/;
const PACK_TOKEN_PATTERN = /^(?:\d+(?:\/\d+)?(?:pc|pcs|pack)s?|\d+(?:pcs?)|pcs?|pack)$/;
const ACCESSORY_COMBO_TOKENS = new Set(['weight','weights','counterweight','counterweights','fit','fits','fitting','compatible','compatibility','adapter','adapters','kit','kits','wrench','wrenches','tool','tools']);

// -----------------------------------------------------------------------------
// Auto-relax profiles (only used if strict settings return zero)
// -----------------------------------------------------------------------------
const FALLBACK_TRIES = [
  { freshnessHours: 48 },
  { freshnessHours: 48, minSample: 8 },
  { freshnessHours: 48, minSample: 5 },
  { freshnessHours: 48, minSample: 5, minSavingsPct: 0.20 },
  { freshnessHours: 48, minSample: 5, minSavingsPct: 0.15 },
  { freshnessHours: 48, minSample: 5, minSavingsPct: 0.15, maxDispersion: 4 },
  { freshnessHours: 48, minSample: 5, minSavingsPct: 0.15, maxDispersion: 5 },
  { lookbackWindowHours: 720, freshnessHours: 48, minSample: 5, minSavingsPct: 0.15, maxDispersion: 5 },
];

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

function formatModelLabel(modelKey = '', brand = '', title = '', sanitizedOverride = null) {
  const normalized = String(modelKey || '').trim();
  if (normalized && CATALOG_LOOKUP.has(normalized)) {
    const [first] = CATALOG_LOOKUP.get(normalized);
    if (first) return `${first.brand} ${first.model}`.trim();
  }

  const safeBrand = typeof brand === 'string' ? brand.trim() : '';
  const sanitized =
    sanitizedOverride && typeof sanitizedOverride === 'object'
      ? sanitizedOverride
      : sanitizeModelKey(modelKey, { storedBrand: brand });

  const brandForLabel =
    (typeof sanitized?.brand === 'string' && sanitized.brand.trim()) || safeBrand;

  const labelCandidates = [];
  const pushCandidate = (value) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed) return;
    if (!labelCandidates.includes(trimmed)) labelCandidates.push(trimmed);
  };

  pushCandidate(sanitized?.cleanLabel);
  pushCandidate(sanitized?.label);
  pushCandidate(sanitized?.rawLabel);

  for (const candidate of labelCandidates) {
    const lowerCandidate = candidate.toLowerCase();
    if (brandForLabel) {
      const lowerBrand = brandForLabel.toLowerCase();
      if (lowerCandidate.includes(lowerBrand)) {
        return candidate;
      }
      return `${brandForLabel} ${candidate}`.trim();
    }
    return candidate;
  }

  if (brandForLabel && normalized) {
    return `${brandForLabel} ${normalized}`.trim();
  }

  if (brandForLabel) return brandForLabel;
  if (title) return String(title).trim();
  if (!normalized) return 'Live Smart Price deal';
  return normalized
    .split(' ')
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

// ---------- helper: is this title likely a real putter? ----------
function isLikelyPutterTitle(title = '') {
  const t = String(title || '').toLowerCase();
  if (/\bputter\b/i.test(t)) return true;
  const modelHintRx =
    /\b(newport|phantom\s?x|anser|spider|odyssey|rossie|squareback|fastback|del\s*mar|studio|sigma|tomcat|monza|monte|er[ -]?\d)\b/i;
  if (modelHintRx.test(t)) return true;
  if (/\b(32|33|34|35|36)\s?(in|inch|")\b/.test(t)) return true;
  if (/\b(blade|mallet|center\s?shaft(ed)?|face\s?balanced|milled)\b/i.test(t)) return true;
  return false;
}

// ---------- accessory dominated title filter (refined) ----------
function isAccessoryDominatedTitle(title = '') {
  if (!title) return false;
  const raw = String(title);

  // 1) Hard-block headcovers by text signal
  let hasHeadcoverSignal = HEAD_COVER_TEXT_RX.test(raw);
  if (hasHeadcoverSignal) return true;

  // 2) Tokenize once
  const tokens = raw.split(/\s+/).filter(Boolean);

  // 3) Accessory vocabulary (beyond headcovers)
  const ACCESSORY_TOKENS = new Set([
    'weight','weights','screw','screws','wrench','tool','tools','kit','adapter',
    'plate','plates','sole','soleplate','cap','plug','plugs','bumper',
    'shaft','shaft-only','shafonly','grip','grip-only','griponly','hosel','neck',
    'cover','headcover','head-cover','head','plate',
  ]);

  // 4) Counters
  let accessoryCount = 0;
  let substantiveCount = 0;

  for (const token of tokens) {
    const norm = token.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (!norm) continue;

    if (HEAD_COVER_TOKEN_VARIANTS.has(norm)) {
      hasHeadcoverSignal = true;
      accessoryCount++;
      continue;
    }

    if (ACCESSORY_TOKENS.has(norm)) {
      accessoryCount++;
      continue;
    }

    if (
      /\b(32|33|34|35|36)\b/.test(norm) ||
      /newport|phantom|anser|spider|odyssey|rossie|er\d+/.test(norm) ||
      /blade|mallet|milled|center|face|balanced/.test(norm)
    ) {
      substantiveCount++;
      continue;
    }
  }

  if (hasHeadcoverSignal) return true;

  const likelyPutter = isLikelyPutterTitle(raw);
  if (likelyPutter && accessoryCount <= substantiveCount + 1) return false;
  if (accessoryCount >= 2 && !likelyPutter) return true;

  return false;
}

// ---------- helper for fast=1 ----------
function fastRows(rows) {
  return rows.map(r =>
    r.stats_source === 'aggregated'
      ? { ...r, live_n: null, live_p10_cents: null, live_p50_cents: null, live_p90_cents: null, live_dispersion_ratio: null }
      : r
  );
}

// ---------- DB query ----------
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
      av.var_n, av.var_p50_cents, av.var_window,
      am.mod_n, am.mod_p50_cents, am.mod_window
    FROM latest_prices lp
    JOIN items i ON i.item_id = lp.item_id
    LEFT JOIN base_stats stats ON stats.model = i.model_key

    LEFT JOIN LATERAL (
      SELECT ls.variant_key
      FROM listing_snapshots ls
      WHERE ls.item_id = lp.item_id
        AND ls.variant_key IS NOT NULL
        AND ls.variant_key <> ''
      ORDER BY ls.snapshot_ts DESC
      LIMIT 1
    ) v ON TRUE

    LEFT JOIN LATERAL (
      SELECT n AS var_n, p50_cents AS var_p50_cents, window_days AS var_window
      FROM aggregated_stats_variant a
      WHERE a.model = i.model_key
        AND a.variant_key = COALESCE(v.variant_key, '')
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
        AND (stats.p50_cents IS NULL) -- only compute live stats when aggregates are missing
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

    const sampleSize = toNumber(row.n);
    const dispersion = toNumber(row.dispersion_ratio);
    if (minSample != null && sampleSize != null && sampleSize < minSample) continue;
    if (maxDispersion != null && dispersion != null && dispersion > maxDispersion) continue;

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
    const sanitized = sanitizeModelKey(row.model_key, { storedBrand: row.brand });
    const label = formatModelLabel(row.model_key, row.brand, row.title, sanitized);
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
      label,
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
}


// ---------- optional 404 verification against eBay (fail-open) ----------
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

// ---------- main loader ----------
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


// ---------- handler ----------
export default async function handler(req, res) {
  try {
    const sql = getSql();

    // parse query params
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

    // Serve cached payload first (Hobby-friendly): enabled by default
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
      } catch (e) {
        // fall through
      }
    }

    // strict defaults (good UX), but we will auto-relax if empty
    const filters = {
      freshnessHours: Number.isFinite(freshnessHours) ? freshnessHours : 24,
      minSample: Number.isFinite(minSample) ? minSample : 10,
      maxDispersion: Number.isFinite(maxDispersion) ? maxDispersion : 4.5,
      minSavingsPct: Number.isFinite(minSavingsPct) ? minSavingsPct : 0.25,
    };

    // 1) Try with strict filters
    let { deals: baseDeals, windowHours } = await loadRankedDeals(sql, limit, windows, filters, modelKey, fast, startTime);
    let deals = verify ? await verifyDealsActive(baseDeals) : baseDeals;

    // 2) Auto-relax progressively if empty
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
      } catch {}
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
