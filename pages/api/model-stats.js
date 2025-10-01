// pages/api/model-stats.js
export const runtime = 'nodejs';

import { getSql } from '../../lib/db';
import { normalizeModelKey } from '../../lib/normalize';
import { buildVariantKey } from '../../lib/variant-detect';

// ----------------- helpers & constants -----------------

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
  if (str.includes('|')) return str.toLowerCase(); // already composite
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
  return [row.p10_cents, row.p50_cents, row.p90_cents].some(
    (v) => v !== null && v !== undefined
  );
}

// ----------------- aggregate lookup -----------------

async function fetchAggregateStats(sql, modelKey, combos) {
  // Direct ANY hit (best UX path): empty variant + ANY condition
  const req = combos?.[0]?.requested;
  if (req && req.conditionBand === 'ANY' && !req.variantKey) {
    const directAny = await sql`
      SELECT variant_key, condition_band, window_days, n,
             p10_cents, p50_cents, p90_cents, dispersion_ratio, updated_at
      FROM aggregated_stats_variant
      WHERE model = ${modelKey}
        AND COALESCE(variant_key, '') = ''
        AND condition_band = 'ANY'
      ORDER BY window_days DESC
      LIMIT 1
    `;
    if (directAny?.length && hasAggregateStats(directAny[0])) {
      const row = directAny[0];
      const stats = {
        p10: centsToDollars(row.p10_cents),
        p50: centsToDollars(row.p50_cents),
        p90: centsToDollars(row.p90_cents),
        n: Number(row.n || 0),
        dispersionRatio: row.dispersion_ratio != null ? Number(row.dispersion_ratio) : null,
      };
      return {
        stats,
        meta: {
          requested: req,
          actual: {
            source: 'aggregated',
            variantKey: row.variant_key || '',
            conditionBand: row.condition_band || 'ANY',
            windowDays: row.window_days != null ? Number(row.window_days) : null,
            sampleSize: Number(row.n || 0),
            dispersionRatio: stats.dispersionRatio,
            updatedAt: row.updated_at || null,
            fallback: 'base_default',
          },
        },
      };
    }
  }

  // Pass 1: try each requested combo exactly (null-safe on variant via COALESCE)
  for (const combo of combos) {
    const { variantKey, conditionBand, reason } = combo;

    const rows = await sql`
      SELECT variant_key, condition_band, window_days, n,
             p10_cents, p50_cents, p90_cents, dispersion_ratio, updated_at
      FROM aggregated_stats_variant
      WHERE model = ${modelKey}
        AND COALESCE(variant_key, '') = ${variantKey || ''}
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
      dispersionRatio: row.dispersion_ratio != null ? Number(row.dispersion_ratio) : null,
    };
    return {
      stats,
      meta: {
        requested: combo.requested,
        actual: {
          source: 'aggregated',
          variantKey: row.variant_key || '',
          conditionBand: row.condition_band || 'ANY',
          windowDays: row.window_days != null ? Number(row.window_days) : null,
          sampleSize: Number(row.n || 0),
          dispersionRatio: stats.dispersionRatio,
          updatedAt: row.updated_at || null,
          fallback: reason,
        },
      },
    };
  }

  // Pass 2: last resort — pick the biggest-n row for this model
  const rowsAnyCond = await sql`
    SELECT variant_key, condition_band, window_days, n,
           p10_cents, p50_cents, p90_cents, dispersion_ratio, updated_at
    FROM aggregated_stats_variant
    WHERE model = ${modelKey}
    ORDER BY n DESC, window_days DESC
    LIMIT 1
  `;
  if (rowsAnyCond?.length && hasAggregateStats(rowsAnyCond[0])) {
    const row = rowsAnyCond[0];
    const stats = {
      p10: centsToDollars(row.p10_cents),
      p50: centsToDollars(row.p50_cents),
      p90: centsToDollars(row.p90_cents),
      n: Number(row.n || 0),
      dispersionRatio: row.dispersion_ratio != null ? Number(row.dispersion_ratio) : null,
    };
    return {
      stats,
      meta: {
        requested: combos?.[0]?.requested ?? { variantKey: '', conditionBand: 'ANY' },
        actual: {
          source: 'aggregated',
          variantKey: row.variant_key || '',
          conditionBand: row.condition_band || 'ANY',
          windowDays: row.window_days != null ? Number(row.window_days) : null,
          sampleSize: Number(row.n || 0),
          dispersionRatio: stats.dispersionRatio,
          updatedAt: row.updated_at || null,
          fallback: 'loosen_condition_variant',
        },
      },
    };
  }

  // Nothing found
  return null;
}

// ----------------- API handler -----------------

export default async function handler(req, res) {
  try {
    const sql = getSql();

    // Support GET (?model=...) and POST (JSON)
    const getFirst = (v) => (Array.isArray(v) ? v[0] : v);
    const q = req.query || {};
    let body = {};
    if (req?.body) {
      body = typeof req.body === 'string' ? (JSON.parse(req.body || '{}') || {}) : req.body;
      if (!body || typeof body !== 'object') body = {};
    }

    const modelParam = getFirst(q.model) ?? getFirst(q.q) ?? body.model ?? body.q ?? '';
    const raw = String(modelParam || '').trim();
    if (!raw) {
      return res.status(400).json({
        ok: false,
        error: 'Missing "model". Use GET ?model=... or POST {"model":"..."}',
      });
    }

    const modelKeyRaw = raw;
    const modelKeyNorm = normalizeModelKey(raw);
    const modelKeyCandidates = Array.from(new Set([modelKeyRaw, modelKeyNorm].filter(Boolean)));

    const conditionParam = getFirst(q.condition) ?? body.condition ?? '';
    const variantParam = getFirst(q.variant) ?? body.variant ?? '';

    const normalizedCondition = normalizeConditionBand(conditionParam);
    const baseModelForVariant = modelKeyNorm || modelKeyRaw;
    const normalizedVariant = normalizeVariantKey(variantParam, baseModelForVariant);

    const requestedCondition = normalizedCondition || 'ANY';
    const requestedVariant = normalizedVariant || '';

    const requestedSegment = {
      variantKey: requestedVariant,
      conditionBand: requestedCondition,
      rawVariant: variantParam ? String(variantParam) : '',
      rawCondition: conditionParam ? String(conditionParam) : '',
    };

    // Build combo list in preference order
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

    addCombo(requestedVariant, requestedCondition, hadVariant || hadCondition ? 'targeted' : 'base_default');
    if (hadVariant) addCombo('', requestedCondition, 'drop_variant');
    if (hadCondition && requestedCondition !== 'ANY') addCombo(requestedVariant, 'ANY', 'drop_condition');
    addCombo('', 'ANY', 'base_any');

    // Try aggregates for raw key, then normalized key
    let aggregateResult = null;
    let chosenModelKey = modelKeyCandidates[0] || modelKeyNorm || modelKeyRaw || '';

    for (const key of modelKeyCandidates) {
      try {
        const found = await fetchAggregateStats(sql, key, combos);
        if (found) { aggregateResult = found; chosenModelKey = key; break; }
      } catch {
        // ignore and try next key
      }
    }

    if (aggregateResult) {
      return res
        .status(200)
        .json({ ok: true, modelKey: chosenModelKey, stats: aggregateResult.stats, segment: aggregateResult.meta });
    }

    // Live fallback: query recent raw prices for the (chosen or normalized) key
    const liveKey = chosenModelKey || modelKeyNorm || modelKeyRaw;

    const [row] = await sql`
      WITH w AS (
        SELECT COALESCE(p.total, p.price + COALESCE(p.shipping, 0)) AS total
        FROM item_prices p
        JOIN items i ON p.item_id = i.item_id
        WHERE i.model_key = ${liveKey}
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

    return res
      .status(200)
      .json({ ok: true, modelKey: liveKey, stats, segment: { requested: requestedSegment, actual } });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
