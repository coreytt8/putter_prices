// pages/api/admin/aggregate.js
export const runtime = 'nodejs';

import { getSql } from '../../../lib/db.js';
import { normalizeModelKey } from '../../../lib/normalize.js';

const WINDOWS = [60, 90, 180];

// Map raw condition -> band
function bandFromCondition(c) {
  const s = String(c || '').toLowerCase();
  if (s.includes('new') && !s.includes('like')) return 'NEW';
  if (s.includes('like') || s.includes('open')) return 'LIKE_NEW';
  return 'USED';
}

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

export default async function handler(req, res) {
  try {
    const { secret, onlyModel } = req.query;
    const ADMIN = process.env.ADMIN_SECRET || '12qwaszx!@QWASZX';
    if (!secret || secret !== ADMIN) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }

    const sql = getSql();
    const onlyKey = onlyModel ? normalizeModelKey(String(onlyModel)) : null;

    // Choose price column (supports schemas with either total_cents or total)
    const hasTotalCents = await columnExists(sql, 'listing_snapshots', 'total_cents');
    const hasTotal = await columnExists(sql, 'listing_snapshots', 'total');

    if (!hasTotalCents && !hasTotal) {
      return res.status(500).json({
        ok: false,
        error: 'listing_snapshots has neither total_cents nor total'
      });
    }

    // Switch expression used in queries
    const centsExpr = hasTotalCents ? 'total_cents' : 'ROUND(total * 100)';

    const results = [];

    for (const wd of WINDOWS) {
      let updatedAny = 0;
      let updatedBandsParent = 0;
      let updatedBandsVariants = 0;

      // ---------- ANY band for parent + variants
      const anyRows = await sql`
        WITH data AS (
          SELECT
            LOWER(model) AS model,
            COALESCE(variant_key, '') AS variant_key,
            ${sql.unsafe(centsExpr)} AS cents
          FROM listing_snapshots
          WHERE observed_at >= NOW() - ${wd} * INTERVAL '1 day'
          ${onlyKey ? sql`AND model = ${onlyKey}` : sql``}
        ),
        agg AS (
          SELECT
            model,
            variant_key,
            COUNT(*)::int AS n,
            (percentile_cont(0.1) WITHIN GROUP (ORDER BY cents))::numeric AS p10d,
            (percentile_cont(0.5) WITHIN GROUP (ORDER BY cents))::numeric AS p50d,
            (percentile_cont(0.9) WITHIN GROUP (ORDER BY cents))::numeric AS p90d
          FROM data
          GROUP BY 1, 2
        )
        INSERT INTO aggregated_stats_variant
          (model, variant_key, condition_band, window_days,
           n, p10_cents, p50_cents, p90_cents, dispersion_ratio, updated_at)
        SELECT
          model,
          variant_key,
          'ANY',
          ${wd},
          n,
          ROUND(p10d)::int,
          ROUND(p50d)::int,
          ROUND(p90d)::int,
          CASE WHEN ROUND(p10d)::int > 0
               THEN (ROUND(p90d)::int - ROUND(p10d)::int)::numeric / ROUND(p10d)::int
               ELSE NULL
          END,
          NOW()
        FROM agg
        ON CONFLICT (model, variant_key, condition_band, window_days)
        DO UPDATE SET
          n = EXCLUDED.n,
          p10_cents = EXCLUDED.p10_cents,
          p50_cents = EXCLUDED.p50_cents,
          p90_cents = EXCLUDED.p90_cents,
          dispersion_ratio = EXCLUDED.dispersion_ratio,
          updated_at = EXCLUDED.updated_at
        RETURNING model, variant_key
      `;
      updatedAny += anyRows.length;

      // ---------- Condition bands for parent + variants
      const bandRows = await sql`
        WITH data AS (
          SELECT
            LOWER(model) AS model,
            COALESCE(variant_key, '') AS variant_key,
            LOWER(COALESCE(condition, '')) AS cond,
            ${sql.unsafe(centsExpr)} AS cents
          FROM listing_snapshots
          WHERE observed_at >= NOW() - ${wd} * INTERVAL '1 day'
          ${onlyKey ? sql`AND model = ${onlyKey}` : sql``}
        ),
        labeled AS (
          SELECT
            model,
            variant_key,
            CASE
              WHEN cond LIKE '%new%' AND cond NOT LIKE '%like%' THEN 'NEW'
              WHEN cond LIKE '%like%' OR cond LIKE '%open%' THEN 'LIKE_NEW'
              ELSE 'USED'
            END AS condition_band,
            cents
          FROM data
        ),
        agg AS (
          SELECT
            model,
            variant_key,
            condition_band,
            COUNT(*)::int AS n,
            (percentile_cont(0.1) WITHIN GROUP (ORDER BY cents))::numeric AS p10d,
            (percentile_cont(0.5) WITHIN GROUP (ORDER BY cents))::numeric AS p50d,
            (percentile_cont(0.9) WITHIN GROUP (ORDER BY cents))::numeric AS p90d
          FROM labeled
          GROUP BY 1, 2, 3
        )
        INSERT INTO aggregated_stats_variant
          (model, variant_key, condition_band, window_days,
           n, p10_cents, p50_cents, p90_cents, dispersion_ratio, updated_at)
        SELECT
          model,
          variant_key,
          condition_band,
          ${wd},
          n,
          ROUND(p10d)::int,
          ROUND(p50d)::int,
          ROUND(p90d)::int,
          CASE WHEN ROUND(p10d)::int > 0
               THEN (ROUND(p90d)::int - ROUND(p10d)::int)::numeric / ROUND(p10d)::int
               ELSE NULL
          END,
          NOW()
        FROM agg
        ON CONFLICT (model, variant_key, condition_band, window_days)
        DO UPDATE SET
          n = EXCLUDED.n,
          p10_cents = EXCLUDED.p10_cents,
          p50_cents = EXCLUDED.p50_cents,
          p90_cents = EXCLUDED.p90_cents,
          dispersion_ratio = EXCLUDED.dispersion_ratio,
          updated_at = EXCLUDED.updated_at
        RETURNING model, variant_key
      `;

      for (const r of bandRows) {
        if (r.variant_key) updatedBandsVariants++;
        else updatedBandsParent++;
      }

      results.push({
        windowDays: wd,
        updatedAny,
        updatedBands: updatedBandsParent,
        updatedVariants: updatedBandsVariants,
      });
    }

    return res.status(200).json({ ok: true, onlyModel: onlyKey || null, results });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
