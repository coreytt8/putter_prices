// pages/api/top-deals.js
export const runtime = 'nodejs';

import { getSql } from '../../lib/db';
import { decorateEbayUrl } from '../../lib/affiliate';
import { gradeDeal } from '../../lib/deal-grade';
import { normalizeModelKey } from '../../lib/normalize';
import { evaluateAccessoryGuard } from '../../lib/text-filters';
import {
  getAllowedCacheSecrets,
  getTopDealsCacheKey,
  isCollectorModeEnabled,
} from '../../lib/config/collectorFlags';

const AVAILABLE_WINDOWS = [60, 90, 180];
const DEFAULT_LIMIT = 12;
const DEFAULT_LOOKBACK_HOURS = 168; // 7 days
const DEFAULT_FRESHNESS_HOURS = 48;
const DEFAULT_MIN_SAMPLE = 6;
const DEFAULT_MIN_SAVINGS = 0.2;
const DEFAULT_MAX_DISPERSION = 5;
const DEFAULT_CATEGORIES = ['putter', 'headcover'];

const ANY_VARIANT_KEY = '__ANY__';
const ANY_CONDITION_BAND = 'ANY';
const ANY_RARITY_TIER = 'ANY';
const DEFAULT_RARITY = 'retail';
const DEFAULT_CATEGORY = 'putter';

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function centsToDollars(value) {
  const num = toFiniteNumber(value);
  return num == null ? null : num / 100;
}

function parseCategoryList(param) {
  if (!param) return [...DEFAULT_CATEGORIES];
  const parts = String(param)
    .split(',')
    .map(v => v.trim().toLowerCase())
    .filter(Boolean)
    .filter(v => v !== 'accessory');
  const unique = Array.from(new Set(parts));
  return unique.length ? unique : [...DEFAULT_CATEGORIES];
}

function normalizeCategory(value) {
  const v = (value || '').toLowerCase();
  return v || DEFAULT_CATEGORY;
}

function normalizeRarity(value) {
  if (!value) return DEFAULT_RARITY;
  if (value === ANY_RARITY_TIER) return ANY_RARITY_TIER;
  const v = String(value).toLowerCase();
  if (v === 'any') return ANY_RARITY_TIER;
  return v || DEFAULT_RARITY;
}

function normalizeCondition(value) {
  const v = (value || '').toUpperCase();
  return v || ANY_CONDITION_BAND;
}

function normalizeVariant(value) {
  return typeof value === 'string' ? value : '';
}

function normalizeModel(value) {
  return (value || '').toLowerCase();
}

function pickWindowDays(hours) {
  const targetHours = toFiniteNumber(hours);
  const targetDays = Number.isFinite(targetHours)
    ? Math.max(1, targetHours / 24)
    : DEFAULT_LOOKBACK_HOURS / 24;
  let best = AVAILABLE_WINDOWS[0];
  let bestDiff = Math.abs(best - targetDays);
  for (let i = 1; i < AVAILABLE_WINDOWS.length; i += 1) {
    const w = AVAILABLE_WINDOWS[i];
    const diff = Math.abs(w - targetDays);
    if (diff < bestDiff) {
      best = w;
      bestDiff = diff;
    }
  }
  return best;
}

function aggregateKey(model, variantKey, category, rarityTier, conditionBand) {
  return [model, variantKey, category, rarityTier, conditionBand].join('||');
}

async function fetchLiveItems(sql, { freshnessHours, categories, modelKey }) {
  const hours = Math.max(1, Math.floor(freshnessHours || DEFAULT_FRESHNESS_HOURS));
  const categoryList = categories.length ? categories : [...DEFAULT_CATEGORIES];
  const rows = await sql/* sql */`
    WITH latest_prices AS (
      SELECT DISTINCT ON (ip.item_id)
        ip.item_id,
        ip.price,
        ip.shipping,
        COALESCE(ip.total, ip.price + COALESCE(ip.shipping, 0)) AS total,
        ip.observed_at
      FROM item_prices ip
      WHERE ip.observed_at >= NOW() - ${hours} * INTERVAL '1 hour'
      ORDER BY ip.item_id, ip.observed_at DESC
    ),
    latest_snapshot AS (
      SELECT DISTINCT ON (ls.item_id)
        ls.item_id,
        COALESCE(NULLIF(ls.variant_key, ''), '') AS variant_key,
        COALESCE(NULLIF(ls.category, ''), NULL) AS category,
        COALESCE(NULLIF(ls.rarity_tier, ''), NULL) AS rarity_tier,
        COALESCE(NULLIF(ls.condition_band, ''), NULL) AS condition_band
      FROM listing_snapshots ls
      ORDER BY ls.item_id, ls.snapshot_ts DESC NULLS LAST
    )
    SELECT
      i.item_id,
      i.title,
      i.url,
      i.brand,
      i.model_key,
      COALESCE(NULLIF(ls.category, ''), i.category) AS category,
      COALESCE(NULLIF(ls.rarity_tier, ''), i.rarity_tier) AS rarity_tier,
      COALESCE(NULLIF(ls.condition_band, ''), i.condition_band) AS condition_band,
      COALESCE(ls.variant_key, '') AS variant_key,
      i.currency,
      lp.price,
      lp.shipping,
      lp.total,
      lp.observed_at
    FROM latest_prices lp
    JOIN items i ON i.item_id = lp.item_id
    LEFT JOIN latest_snapshot ls ON ls.item_id = lp.item_id
    WHERE i.model_key IS NOT NULL AND i.model_key <> ''
      AND lp.total IS NOT NULL AND lp.total > 0
      ${modelKey ? sql`AND i.model_key = ${modelKey}` : sql``}
      AND COALESCE(NULLIF(ls.category, ''), i.category, ${DEFAULT_CATEGORY}) = ANY(${sql.array(categoryList, 'text')})
      AND COALESCE(NULLIF(ls.category, ''), i.category, ${DEFAULT_CATEGORY}) <> 'accessory'
  `;

  const items = [];
  for (const row of rows) {
    const guard = evaluateAccessoryGuard(row?.title || '');
    if (guard.isAccessory) continue;

    const modelKeyNorm = normalizeModel(row.model_key);
    const category = normalizeCategory(row.category);
    const rarityTier = normalizeRarity(row.rarity_tier);
    const conditionBand = normalizeCondition(row.condition_band);
    const variantKey = normalizeVariant(row.variant_key);
    const price = toFiniteNumber(row.price);
    const shipping = toFiniteNumber(row.shipping);
    const total = toFiniteNumber(row.total);
    if (!Number.isFinite(total) || total <= 0) continue;

    items.push({
      itemId: row.item_id,
      title: row.title || '',
      url: row.url || '',
      brand: row.brand || null,
      modelKey: modelKeyNorm,
      originalModelKey: row.model_key || null,
      category,
      rarityTier,
      conditionBand,
      variantKey,
      currency: row.currency || 'USD',
      price,
      shipping,
      total,
      observedAt: row.observed_at || null,
    });
  }
  return items;
}

async function fetchAggregates(sql, models, categories, windowDays) {
  if (!models.size) return new Map();
  const modelList = Array.from(models);
  const categoryList = categories.length ? categories : [...DEFAULT_CATEGORIES];
  const rows = await sql/* sql */`
    SELECT
      model,
      COALESCE(variant_key, '') AS variant_key,
      category,
      rarity_tier,
      condition_band,
      window_days,
      n,
      p10_cents,
      p50_cents,
      p90_cents,
      dispersion_ratio,
      updated_at
    FROM aggregated_stats_variant
    WHERE model = ANY(${sql.array(modelList, 'text')})
      AND window_days = ${windowDays}
      AND category = ANY(${sql.array(categoryList, 'text')})
  `;

  const map = new Map();
  for (const row of rows) {
    const model = normalizeModel(row.model);
    const variantKey = normalizeVariant(row.variant_key);
    const category = normalizeCategory(row.category);
    const rarityRaw = row.rarity_tier || DEFAULT_RARITY;
    const rarityTier = rarityRaw === ANY_RARITY_TIER ? ANY_RARITY_TIER : normalizeRarity(rarityRaw);
    const conditionBand = row.condition_band === ANY_CONDITION_BAND
      ? ANY_CONDITION_BAND
      : normalizeCondition(row.condition_band);

    const key = aggregateKey(model, variantKey, category, rarityTier, conditionBand);
    const current = map.get(key);
    const next = {
      model,
      variant_key: variantKey,
      category,
      rarity_tier: rarityTier,
      condition_band: conditionBand,
      window_days: Number(row.window_days),
      n: row.n == null ? null : Number(row.n),
      p10_cents: row.p10_cents == null ? null : Number(row.p10_cents),
      p50_cents: row.p50_cents == null ? null : Number(row.p50_cents),
      p90_cents: row.p90_cents == null ? null : Number(row.p90_cents),
      dispersion_ratio: row.dispersion_ratio == null ? null : Number(row.dispersion_ratio),
      updated_at: row.updated_at,
    };
    if (!current) {
      map.set(key, next);
      continue;
    }
    const currentTs = current.updated_at ? new Date(current.updated_at).getTime() : 0;
    const nextTs = next.updated_at ? new Date(next.updated_at).getTime() : 0;
    if (nextTs >= currentTs) {
      map.set(key, next);
    }
  }
  return map;
}

function chooseAggregate(map, { modelKey, variantKey, category, rarityTier, conditionBand, minSample }) {
  const fallbackPaths = [
    { variant: variantKey, condition: conditionBand, rarity: rarityTier },
    { variant: ANY_VARIANT_KEY, condition: conditionBand, rarity: rarityTier },
    { variant: ANY_VARIANT_KEY, condition: ANY_CONDITION_BAND, rarity: rarityTier },
    { variant: ANY_VARIANT_KEY, condition: ANY_CONDITION_BAND, rarity: DEFAULT_RARITY },
    { variant: ANY_VARIANT_KEY, condition: ANY_CONDITION_BAND, rarity: ANY_RARITY_TIER },
  ];

  for (let idx = 0; idx < fallbackPaths.length; idx += 1) {
    const path = fallbackPaths[idx];
    const key = aggregateKey(modelKey, path.variant, category, path.rarity, path.condition);
    const row = map.get(key);
    if (!row) continue;
    if (Number.isFinite(minSample) && minSample > 0) {
      const n = toFiniteNumber(row.n);
      if (!Number.isFinite(n) || n < minSample) continue;
    }
    return { aggregate: row, fallbackLevel: idx };
  }
  return null;
}

function buildDeal(item, aggregate, fallbackLevel, { minSavingsPct, maxDispersion }) {
  const p50 = centsToDollars(aggregate.p50_cents);
  if (!Number.isFinite(p50) || p50 <= 0) return null;
  const total = toFiniteNumber(item.total);
  if (!Number.isFinite(total) || total <= 0) return null;

  const savingsPct = 1 - total / p50;
  if (Number.isFinite(minSavingsPct) && savingsPct < minSavingsPct) return null;

  const dispersion = toFiniteNumber(aggregate.dispersion_ratio);
  if (Number.isFinite(maxDispersion) && Number.isFinite(dispersion) && dispersion > maxDispersion) {
    return null;
  }

  const p10 = centsToDollars(aggregate.p10_cents);
  const p90 = centsToDollars(aggregate.p90_cents);
  const savingsAmount = Number.isFinite(p50) && Number.isFinite(total) ? p50 - total : null;

  const grade = gradeDeal({ savingsPct });

  const bestOffer = {
    price: item.price,
    total,
    shipping: item.shipping,
    currency: item.currency,
    url: decorateEbayUrl(item.url),
    title: item.title,
  };

  return {
    brand: item.brand,
    model: item.originalModelKey,
    modelKey: item.modelKey,
    variantKey: item.variantKey || null,
    category: item.category,
    rarityTier: item.rarityTier,
    conditionBand: item.conditionBand,
    bestOffer,
    savingsPct,
    savings: {
      amount: savingsAmount,
      percent: savingsPct,
    },
    grade: grade.letter,
    gradeMeta: grade,
    fallbackLevel,
    usedFallback: fallbackLevel > 0,
    stats: {
      p10,
      p50,
      p90,
      n: aggregate.n,
    },
    statsMeta: {
      windowDays: aggregate.window_days,
      bandSampleSize: aggregate.n,
      dispersionRatio: dispersion,
      updatedAt: aggregate.updated_at || null,
      fallbackLevel,
      sourceVariant: aggregate.variant_key,
    },
  };
}

async function loadDeals(sql, {
  limit,
  freshnessHours,
  categories,
  modelKey,
  windowDays,
  minSample,
  minSavingsPct,
  maxDispersion,
}) {
  const items = await fetchLiveItems(sql, { freshnessHours, categories, modelKey });
  if (!items.length) {
    return { deals: [], fallbackUsed: false };
  }

  const models = new Set(items.map(item => item.modelKey).filter(Boolean));
  const aggregateMap = await fetchAggregates(sql, models, categories, windowDays);

  const deals = [];
  let fallbackUsed = false;

  for (const item of items) {
    const choice = chooseAggregate(aggregateMap, {
      modelKey: item.modelKey,
      variantKey: item.variantKey,
      category: item.category,
      rarityTier: item.rarityTier,
      conditionBand: item.conditionBand,
      minSample,
    });
    if (!choice) continue;

    const deal = buildDeal(item, choice.aggregate, choice.fallbackLevel, {
      minSavingsPct,
      maxDispersion,
    });
    if (!deal) continue;

    fallbackUsed = fallbackUsed || choice.fallbackLevel > 0;
    deals.push(deal);
  }

  deals.sort((a, b) => (b.savingsPct ?? 0) - (a.savingsPct ?? 0));
  const limited = deals.slice(0, limit);
  return { deals: limited, fallbackUsed };
}

export default async function handler(req, res) {
  try {
    const sql = getSql();

    const limitParam = toFiniteNumber(req.query.limit);
    const limit = Number.isFinite(limitParam)
      ? Math.max(1, Math.min(24, Math.floor(limitParam)))
      : DEFAULT_LIMIT;

    const lookbackParam = toFiniteNumber(req.query.lookbackWindowHours);
    const windowDays = pickWindowDays(lookbackParam ?? DEFAULT_LOOKBACK_HOURS);
    const lookbackWindowHours = windowDays * 24;

    const freshnessParam = toFiniteNumber(req.query.freshnessHours);
    const freshnessHours = Number.isFinite(freshnessParam)
      ? Math.max(1, freshnessParam)
      : DEFAULT_FRESHNESS_HOURS;

    const minSampleParam = toFiniteNumber(req.query.minSample);
    const minSample = Number.isFinite(minSampleParam)
      ? Math.max(0, Math.floor(minSampleParam))
      : DEFAULT_MIN_SAMPLE;

    const minSavingsParam = toFiniteNumber(req.query.minSavingsPct);
    const minSavingsPct = Number.isFinite(minSavingsParam)
      ? minSavingsParam
      : DEFAULT_MIN_SAVINGS;

    const maxDispersionParam = toFiniteNumber(req.query.maxDispersion);
    const maxDispersion = Number.isFinite(maxDispersionParam)
      ? maxDispersionParam
      : DEFAULT_MAX_DISPERSION;

    const categories = parseCategoryList(req.query.categoryIn);

    const rawModel = String(req.query.model || '').trim();
    const normalizedModelKey = rawModel ? normalizeModelKey(rawModel) : null;
    const modelKey = normalizedModelKey ? normalizeModel(normalizedModelKey) : null;

    const cacheWrite = String(req.query.cacheWrite || '') === '1';
    const useCache = String(req.query.cache || '1') === '1';

    const collectorMode = isCollectorModeEnabled();
    const cacheKey = collectorMode ? getTopDealsCacheKey() : 'default';

    if (useCache && !modelKey) {
      try {
        const [cached] = await sql/* sql */`
          SELECT cache_key, payload, generated_at
          FROM top_deals_cache
          WHERE cache_key = ${cacheKey}
        `;
        if (cached?.payload) {
          const payload = { ...cached.payload };
          const meta = payload.meta && typeof payload.meta === 'object'
            ? { ...payload.meta }
            : {};
          meta.cache = {
            key: cached.cache_key || cacheKey,
            generatedAt: cached.generated_at,
          };
          payload.meta = meta;
          return res.status(200).json(payload);
        }
      } catch (err) {
        console.error('top-deals cache read failed', err);
      }
    }

    const { deals, fallbackUsed } = await loadDeals(sql, {
      limit,
      freshnessHours,
      categories,
      modelKey,
      windowDays,
      minSample,
      minSavingsPct,
      maxDispersion,
    });

    const generatedAt = new Date().toISOString();
    const verified = false;

    const payload = {
      ok: true,
      generatedAt,
      deals,
      meta: {
        limit,
        modelCount: deals.length,
        lookbackWindowHours,
        modelKey: normalizedModelKey || null,
        filters: {
          freshnessHours,
          minSample,
          maxDispersion,
          minSavingsPct,
        },
        verified,
        fallbackUsed,
        cache: cacheWrite ? { key: cacheKey, generatedAt } : null,
      },
    };

    if (collectorMode) {
      payload.meta.collectorMode = true;
    }

    const cacheSecrets = getAllowedCacheSecrets();
    const incomingSecret = String(req.headers['x-cron-secret'] || '');
    const canWriteCache = cacheWrite && cacheSecrets.includes(incomingSecret) && deals.length > 0;

    if (canWriteCache) {
      try {
        await sql/* sql */`
          INSERT INTO top_deals_cache (cache_key, payload)
          VALUES (${cacheKey}, ${JSON.stringify(payload)}::jsonb)
          ON CONFLICT (cache_key) DO UPDATE
          SET payload = EXCLUDED.payload,
              generated_at = NOW()
        `;
      } catch (err) {
        console.error('top-deals cache write failed', err);
      }
    }

    return res.status(200).json(payload);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
