// pages/api/model-stats.js
export const runtime = 'nodejs';

import { getSql } from '../../lib/db';
import { normalizeModelKey } from '../../lib/normalize';
import { buildVariantKey } from '../../lib/variant-detect';

const CONDITION_ALIASES = new Map([
  ['ANY', 'ANY'],
  ['ALL', 'ANY'],
  ['NEW', 'NEW'],
  ['BRAND_NEW', 'NEW'],
  ['LIKE_NEW', 'LIKE_NEW'],
  ['LIKE-NEW', 'LIKE_NEW'],
  ['LIKE NEW', 'LIKE_NEW'],
  ['MINT', 'LIKE_NEW'],
  ['EXCELLENT', 'LIKE_NEW'],
  ['GOOD', 'GOOD'],
  ['VERY_GOOD', 'GOOD'],
  ['FAIR', 'FAIR'],
  ['USED', 'USED'],
]);

const VARIANT_TAGS = new Map([
  ['CIRCLE_T', ['circle_t', 'tour_only']],
  ['GSS', ['gss']],
  ['009', ['009']],
  ['BUTTON_BACK', ['button_back']],
  ['TEI3', ['tei3']],
  ['GARAGE', ['garage']],
  ['LIMITED', ['limited']],
  ['TOUR_ISSUE', ['tour_only']],
  ['PROTO', ['prototype']],
  ['SMALL_SLANT', ['small_slant']],
]);

function normalizeConditionBand(raw = '') {
  const str = String(raw || '').trim();
  if (!str) return '';
  const key = str.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  return CONDITION_ALIASES.get(key) || '';
}

function normalizeVariantKey(raw = '', modelKey = '') {
  const str = String(raw || '').trim();
  if (!str) return '';

  if (/^base$/i.test(str) || /^standard$/i.test(str)) return '';

  // Already a composite variant_key (model|tag|tag)
  if (str.includes('|')) {
    return str.toLowerCase();
  }

  const upper = str.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const tags = VARIANT_TAGS.get(upper) || [upper.toLowerCase()];
  const key = buildVariantKey(modelKey, tags);
  return key || '';
}

function centsToDollars(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return num / 100;
}

function hasAggregateStats(row = {}) {
  if (!row) return false;
  return [row.p10_cents, row.p50_cents, row.p90_cents].some((v) => v !== null && v !== undefined);
}

async function fetchAggregateStats(sql, modelKey, combos) {
  for (const combo of combos) {
    const { variantKey, conditionBand, reason } = combo;
    const rows = await sql`
      SELECT variant_key, condition_band, window_days, n, p10_cents, p50_cents, p90_cents, dispersion_ratio, updated_at
      FROM aggregated_stats_variant
      WHERE model = ${modelKey}
        AND variant_key = ${variantKey}
        AND condition_band = ${conditionBand}
      ORDER BY window_days DESC
      LIMIT 1
    `;
    if (!rows?.length) continue;
    const row = rows[0];
    if (!hasAggregateStats(row)) continue;
    const stats = {
      p10: centsToDollars(row.p10_cents),
      p50: centsToDollars(row.p50_cents),
      p90: centsToDollars(row.p90_cents),
      n: Number(row.n || 0),
      dispersionRatio: row.dispersion_ratio !== null && row.dispersion_ratio !== undefined
        ? Number(row.dispersion_ratio)
        : null,
    };
    const meta = {
      requested: combo.requested,
      actual: {
        source: 'aggregated',
        variantKey: row.variant_key,
        conditionBand: row.condition_band,
        windowDays: row.window_days !== undefined && row.window_days !== null ? Number(row.window_days) : null,
        sampleSize: Number(row.n || 0),
        dispersionRatio: stats.dispersionRatio,
        updatedAt: row.updated_at || null,
        fallback: reason,
      },
    };
    return { stats, meta };
  }
  return null;
}

export default async function handler(req, res) {
  try {
    const sql = getSql();
    const getFirst = (value) => (Array.isArray(value) ? value[0] : value);
    const modelParam = getFirst(req.query.model);
    const qParam = getFirst(req.query.q);
    const base = modelParam ?? qParam ?? '';
    const raw = String(base || '').trim();
    if (!raw) return res.status(400).json({ ok:false, error:'Missing model' });

    const modelKey = normalizeModelKey(raw);

    const conditionParam = getFirst(req.query.condition);
    const variantParam = getFirst(req.query.variant);
    const normalizedCondition = normalizeConditionBand(conditionParam);
    const normalizedVariant = normalizeVariantKey(variantParam, modelKey);
    const requestedCondition = normalizedCondition || 'ANY';
    const requestedVariant = normalizedVariant || '';

    const requestedSegment = {
      variantKey: requestedVariant,
      conditionBand: requestedCondition,
      rawVariant: variantParam ? String(variantParam) : '',
      rawCondition: conditionParam ? String(conditionParam) : '',
    };

    const combos = [];
    const seen = new Set();
    const addCombo = (variantKey, conditionBand, reason) => {
      const key = `${variantKey}::${conditionBand}`;
      if (seen.has(key)) return;
      seen.add(key);
      combos.push({ variantKey, conditionBand, reason, requested: requestedSegment });
    };

    const hadVariant = Boolean(normalizedVariant);
    const hadCondition = Boolean(normalizedCondition);

    addCombo(
      requestedVariant,
      requestedCondition,
      hadVariant || hadCondition ? 'targeted' : 'base_default'
    );
    if (hadVariant) addCombo('', requestedCondition, 'drop_variant');
    if (hadCondition && requestedCondition !== 'ANY') addCombo(requestedVariant, 'ANY', 'drop_condition');
    addCombo('', 'ANY', 'base_any');

    let aggregateResult = null;
    try {
      aggregateResult = await fetchAggregateStats(sql, modelKey, combos);
    } catch (err) {
      aggregateResult = null;
    }

    if (aggregateResult) {
      return res.status(200).json({ ok: true, modelKey, stats: aggregateResult.stats, segment: aggregateResult.meta });
    }

    const [row] = await sql`
      WITH w AS (
        SELECT COALESCE(p.total, p.price + COALESCE(p.shipping, 0)) AS total
        FROM item_prices p
        JOIN items i ON p.item_id = i.item_id
        WHERE i.model_key = ${modelKey}
          AND p.observed_at >= now() - interval '90 days'
          AND (p.total IS NOT NULL OR p.price IS NOT NULL)
      )
      SELECT
        percentile_cont(0.1) WITHIN GROUP (ORDER BY total) AS p10,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY total) AS p50,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY total) AS p90,
        COUNT(*) AS n
      FROM w
    `;

    const stats = row || {};
    const actual = {
      source: 'live_query',
      variantKey: '',
      conditionBand: 'ANY',
      fallback: 'raw_prices',
      sampleSize: stats.n !== undefined && stats.n !== null ? Number(stats.n) : null,
    };

    return res.status(200).json({ ok: true, modelKey, stats, segment: { requested: requestedSegment, actual } });
  } catch (e) {
    return res.status(500).json({ ok:false, error:e.message });
  }
}
