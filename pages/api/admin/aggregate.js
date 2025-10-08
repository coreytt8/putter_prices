// pages/api/admin/aggregate.js
export const runtime = 'nodejs';

import { getSql } from '../../../lib/db.js';
import { normalizeModelKey } from '../../../lib/normalize.js';

const WINDOWS = [60, 90, 180];
const ANY_VARIANT_KEY = '__ANY__';
const ANY_CONDITION_BAND = 'ANY';
const ANY_RARITY_TIER = 'ANY';

async function columnExists(sql, table, column) {
  const rows = await sql`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${table}
      AND column_name = ${column}
    LIMIT 1
  `;
  return rows?.length > 0;
}

async function pickTimeColumn(sql) {
  const prefs = ['observed_at', 'snapshot_ts', 'created_at', 'inserted_at'];
  for (const c of prefs) {
    // eslint-disable-next-line no-await-in-loop
    if (await columnExists(sql, 'listing_snapshots', c)) return c;
  }
  return null;
}

export default async function handler(req, res) {
  try {
    const { secret, onlyModel } = req.query;
    const ADMIN = process.env.ADMIN_SECRET || '12qwaszx!@QWASZX';
    if (!secret || secret !== ADMIN) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }

    const sql = getSql();
    const onlyKey = onlyModel ? normalizeModelKey(String(onlyModel)) : null;

    // Choose time column
    const timeCol = await pickTimeColumn(sql);
    if (!timeCol) {
      return res.status(500).json({ ok: false, error: 'listing_snapshots has no suitable time column (observed_at/snapshot_ts/created_at/inserted_at)' });
    }

    // Choose price column/expression
    const hasTotalCents = await columnExists(sql, 'listing_snapshots', 'total_cents');
    const hasTotal = await columnExists(sql, 'listing_snapshots', 'total');
    if (!hasTotalCents && !hasTotal) {
      return res.status(500).json({ ok: false, error: 'listing_snapshots has neither total_cents nor total' });
    }
    const centsExpr = hasTotalCents ? 'total_cents' : 'ROUND(total * 100)';

    // How to derive condition_band
    const hasBandCol = await columnExists(sql, 'listing_snapshots', 'condition_band');
    const hasCondText = await columnExists(sql, 'listing_snapshots', 'condition');
    const hasCondId = await columnExists(sql, 'listing_snapshots', 'condition_id');
    const hasCategory = await columnExists(sql, 'listing_snapshots', 'category');
    const hasRarity = await columnExists(sql, 'listing_snapshots', 'rarity_tier');

    // Prefer stored condition_band; else derive from text; else derive from id; else default USED
    let bandExpr = `"condition_band"`;
    if (!hasBandCol) {
      if (hasCondText) {
        bandExpr = `
          CASE
            WHEN LOWER(COALESCE(condition,'')) LIKE '%new%' AND LOWER(COALESCE(condition,'')) NOT LIKE '%like%' THEN 'NEW'
            WHEN LOWER(COALESCE(condition,'')) LIKE '%like%' OR LOWER(COALESCE(condition,'')) LIKE '%open%' THEN 'LIKE_NEW'
            ELSE 'USED'
          END
        `;
      } else if (hasCondId) {
        // crude but practical mapping; tune as needed
        bandExpr = `
          CASE
            WHEN condition_id IN (1000,1500) THEN 'NEW'              -- New / New other
            WHEN condition_id IN (2010,2020) THEN 'LIKE_NEW'         -- Open box / Seller refurb ≈ like new
            WHEN condition_id IN (3000,4000,5000,6000) THEN 'USED'   -- Used / Very good / Good / Acceptable
            ELSE 'USED'
          END
        `;
      } else {
        bandExpr = `'USED'`;
      }
    }

    const categoryExpr = hasCategory
      ? `COALESCE(NULLIF(category, ''), 'putter')`
      : `'putter'`;
    const rarityExpr = hasRarity
      ? `COALESCE(NULLIF(rarity_tier, ''), 'retail')`
      : `'retail'`;

    const aggHasCategory = await columnExists(sql, 'aggregated_stats_variant', 'category');
    if (!aggHasCategory) {
      await sql`ALTER TABLE aggregated_stats_variant ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'putter'`;
    }
    const aggHasRarity = await columnExists(sql, 'aggregated_stats_variant', 'rarity_tier');
    if (!aggHasRarity) {
      await sql`ALTER TABLE aggregated_stats_variant ADD COLUMN IF NOT EXISTS rarity_tier text NOT NULL DEFAULT 'retail'`;
    }

    await sql`ALTER TABLE aggregated_stats_variant ALTER COLUMN category DROP DEFAULT`;
    await sql`ALTER TABLE aggregated_stats_variant ALTER COLUMN rarity_tier DROP DEFAULT`;
    await sql`ALTER TABLE aggregated_stats_variant DROP CONSTRAINT IF EXISTS aggregated_stats_variant_pkey`;
    await sql`ALTER TABLE aggregated_stats_variant ADD CONSTRAINT aggregated_stats_variant_pkey PRIMARY KEY (model, variant_key, category, rarity_tier, condition_band, window_days)`;

    const results = [];

    for (const wd of WINDOWS) {
      const rows = await sql`
        WITH data AS (
          SELECT
            LOWER(model) AS model,
            COALESCE(variant_key, '') AS variant_key,
            ${sql.unsafe(categoryExpr)} AS category,
            ${sql.unsafe(rarityExpr)} AS rarity_tier,
            ${sql.unsafe(bandExpr)} AS condition_band,
            ${sql.unsafe(centsExpr)} AS cents
          FROM listing_snapshots
          WHERE ${sql.unsafe(`"${timeCol}"`)} >= NOW() - ${wd} * INTERVAL '1 day'
            AND ${sql.unsafe(centsExpr)} IS NOT NULL
            ${onlyKey ? sql`AND model = ${onlyKey}` : sql``}
        ),
        granular AS (
          SELECT
            model,
            variant_key,
            category,
            rarity_tier,
            condition_band,
            COUNT(*)::int AS n,
            (percentile_cont(0.1) WITHIN GROUP (ORDER BY cents))::numeric AS p10d,
            (percentile_cont(0.5) WITHIN GROUP (ORDER BY cents))::numeric AS p50d,
            (percentile_cont(0.9) WITHIN GROUP (ORDER BY cents))::numeric AS p90d
          FROM data
          GROUP BY 1, 2, 3, 4, 5
        ),
        model_variant AS (
          SELECT
            model,
            ${ANY_VARIANT_KEY}::text AS variant_key,
            category,
            rarity_tier,
            condition_band,
            COUNT(*)::int AS n,
            (percentile_cont(0.1) WITHIN GROUP (ORDER BY cents))::numeric AS p10d,
            (percentile_cont(0.5) WITHIN GROUP (ORDER BY cents))::numeric AS p50d,
            (percentile_cont(0.9) WITHIN GROUP (ORDER BY cents))::numeric AS p90d
          FROM data
          GROUP BY 1, 3, 4, 5
        ),
        model_condition AS (
          SELECT
            model,
            ${ANY_VARIANT_KEY}::text AS variant_key,
            category,
            rarity_tier,
            ${ANY_CONDITION_BAND}::text AS condition_band,
            COUNT(*)::int AS n,
            (percentile_cont(0.1) WITHIN GROUP (ORDER BY cents))::numeric AS p10d,
            (percentile_cont(0.5) WITHIN GROUP (ORDER BY cents))::numeric AS p50d,
            (percentile_cont(0.9) WITHIN GROUP (ORDER BY cents))::numeric AS p90d
          FROM data
          GROUP BY 1, 3, 4
        ),
        model_any AS (
          SELECT
            model,
            ${ANY_VARIANT_KEY}::text AS variant_key,
            category,
            ${ANY_RARITY_TIER}::text AS rarity_tier,
            ${ANY_CONDITION_BAND}::text AS condition_band,
            COUNT(*)::int AS n,
            (percentile_cont(0.1) WITHIN GROUP (ORDER BY cents))::numeric AS p10d,
            (percentile_cont(0.5) WITHIN GROUP (ORDER BY cents))::numeric AS p50d,
            (percentile_cont(0.9) WITHIN GROUP (ORDER BY cents))::numeric AS p90d
          FROM data
          GROUP BY 1, 3
        )
        INSERT INTO aggregated_stats_variant
          (model, variant_key, category, rarity_tier, condition_band, window_days,
           n, p10_cents, p50_cents, p90_cents, dispersion_ratio, updated_at)
        SELECT
          model,
          variant_key,
          category,
          rarity_tier,
          condition_band,
          ${wd},
          n,
          ROUND(p10d)::int,
          ROUND(p50d)::int,
          ROUND(p90d)::int,
          CASE WHEN ROUND(p10d)::int > 0
               THEN ROUND(p90d)::numeric / NULLIF(ROUND(p10d)::numeric, 0)
               ELSE NULL
          END,
          NOW()
        FROM granular
        UNION ALL
        SELECT
          model,
          variant_key,
          category,
          rarity_tier,
          condition_band,
          ${wd},
          n,
          ROUND(p10d)::int,
          ROUND(p50d)::int,
          ROUND(p90d)::int,
          CASE WHEN ROUND(p10d)::int > 0
               THEN ROUND(p90d)::numeric / NULLIF(ROUND(p10d)::numeric, 0)
               ELSE NULL
          END,
          NOW()
        FROM model_variant
        UNION ALL
        SELECT
          model,
          variant_key,
          category,
          rarity_tier,
          condition_band,
          ${wd},
          n,
          ROUND(p10d)::int,
          ROUND(p50d)::int,
          ROUND(p90d)::int,
          CASE WHEN ROUND(p10d)::int > 0
               THEN ROUND(p90d)::numeric / NULLIF(ROUND(p10d)::numeric, 0)
               ELSE NULL
          END,
          NOW()
        FROM model_condition
        UNION ALL
        SELECT
          model,
          variant_key,
          category,
          rarity_tier,
          condition_band,
          ${wd},
          n,
          ROUND(p10d)::int,
          ROUND(p50d)::int,
          ROUND(p90d)::int,
          CASE WHEN ROUND(p10d)::int > 0
               THEN ROUND(p90d)::numeric / NULLIF(ROUND(p10d)::numeric, 0)
               ELSE NULL
          END,
          NOW()
        FROM model_any
        ON CONFLICT (model, variant_key, category, rarity_tier, condition_band, window_days)
        DO UPDATE SET
          n = EXCLUDED.n,
          p10_cents = EXCLUDED.p10_cents,
          p50_cents = EXCLUDED.p50_cents,
          p90_cents = EXCLUDED.p90_cents,
          dispersion_ratio = EXCLUDED.dispersion_ratio,
          updated_at = EXCLUDED.updated_at
        RETURNING model, variant_key, category, rarity_tier, condition_band
      `;

      const counts = rows.reduce(
        (acc, row) => {
          if (row.variant_key === ANY_VARIANT_KEY) {
            if (row.condition_band === ANY_CONDITION_BAND && row.rarity_tier === ANY_RARITY_TIER) {
              acc.updatedModelAny += 1;
            } else if (row.condition_band === ANY_CONDITION_BAND) {
              acc.updatedModelCondition += 1;
            } else {
              acc.updatedModelVariant += 1;
            }
          } else {
            acc.updatedGranular += 1;
          }
          return acc;
        },
        { updatedGranular: 0, updatedModelVariant: 0, updatedModelCondition: 0, updatedModelAny: 0 }
      );

      results.push({
        windowDays: wd,
        ...counts,
      });
    }

    return res.status(200).json({ ok: true, onlyModel: onlyKey || null, timeColumn: timeCol, results });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
