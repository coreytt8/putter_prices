// pages/api/admin/aggregate.js
export const runtime = 'nodejs';

import { getSql } from '../../../lib/db.js';
import { normalizeModelKey } from '../../../lib/normalize.js';

const WINDOWS = [60, 90, 180];

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

    const results = [];

    for (const wd of WINDOWS) {
      let updatedAny = 0;
      let updatedBandsParent = 0;
      let updatedBandsVariants = 0;

      // ---------- ANY: parent + variants
      const anyRows = await sql`
        WITH data AS (
          SELECT
            LOWER(model) AS model,
            COALESCE(variant_key, '') AS variant_key,
            ${sql.unsafe(centsExpr)} AS cents
          FROM listing_snapshots
          WHERE ${sql.unsafe(`"${timeCol}"`)} >= NOW() - ${wd} * INTERVAL '1 day'
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

      // ---------- Bands: parent + variants
      const bandRows = await sql`
        WITH data AS (
          SELECT
            LOWER(model) AS model,
            COALESCE(variant_key, '') AS variant_key,
            ${sql.unsafe(bandExpr)} AS condition_band,
            ${sql.unsafe(centsExpr)} AS cents
          FROM listing_snapshots
          WHERE ${sql.unsafe(`"${timeCol}"`)} >= NOW() - ${wd} * INTERVAL '1 day'
          ${onlyKey ? sql`AND model = ${onlyKey}` : sql``}
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
          FROM data
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

    return res.status(200).json({ ok: true, onlyModel: onlyKey || null, timeColumn: timeCol, results });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
