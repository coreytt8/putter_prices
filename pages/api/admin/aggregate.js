// pages/api/admin/aggregate.js
export const runtime = "nodejs";
import { getSql } from "../../lib/db";

const WINDOWS = [60, 90, 180];

function ok(res, body) {
  res.status(200).json(body);
}

function bad(res, msg) {
  res.status(401).json({ ok: false, error: msg });
}

export default async function handler(req, res) {
  try {
    const provided =
      String(req.query.secret || req.headers["x-admin-key"] || "").trim();
    const ADMIN = process.env.ADMIN_KEY || "";
    const CRON = process.env.CRON_SECRET || "";

    if (![ADMIN, CRON].includes(provided)) {
      return bad(res, "unauthorized");
    }

    const sql = getSql();
    const results = [];

    // Helper to run an UPSERT and return the number of affected rows
    async function runCount(q) {
      const rows = await sql`${q}`;
      // rows[0]?.count for SELECT COUNT(*) style, else 0
      if (rows?.[0]?.count !== undefined) return Number(rows[0].count || 0);
      return 0;
    }

    for (const w of WINDOWS) {
      // Recent slice by day (faster on our date column)
      const recentAny = sql`
        WITH recent AS (
          SELECT
            model,
            COALESCE(variant_key, '') AS variant_key,
            total_cents
          FROM listing_snapshots
          WHERE snapshot_day >= (CURRENT_DATE - INTERVAL '${w} days')
        ),
        upsert AS (
          INSERT INTO aggregated_stats_variant
            (model, variant_key, condition_band, window_days, n,
             p10_cents, p50_cents, p90_cents, dispersion_ratio, updated_at)
          SELECT
            model,
            variant_key,
            'ANY' AS condition_band,
            ${w}::int AS window_days,
            COUNT(*)::int AS n,
            PERCENTILE_DISC(0.10) WITHIN GROUP (ORDER BY total_cents) AS p10,
            PERCENTILE_DISC(0.50) WITHIN GROUP (ORDER BY total_cents) AS p50,
            PERCENTILE_DISC(0.90) WITHIN GROUP (ORDER BY total_cents) AS p90,
            CASE
              WHEN PERCENTILE_DISC(0.50) WITHIN GROUP (ORDER BY total_cents) > 0
              THEN (PERCENTILE_DISC(0.90) WITHIN GROUP (ORDER BY total_cents)::float
                    / NULLIF(PERCENTILE_DISC(0.50) WITHIN GROUP (ORDER BY total_cents), 0))
              ELSE NULL
            END AS dispersion_ratio,
            NOW() AS updated_at
          FROM recent
          GROUP BY model, variant_key
          HAVING COUNT(*) >= 1
          ON CONFLICT (model, variant_key, condition_band, window_days)
          DO UPDATE SET
            n = EXCLUDED.n,
            p10_cents = EXCLUDED.p10_cents,
            p50_cents = EXCLUDED.p50_cents,
            p90_cents = EXCLUDED.p90_cents,
            dispersion_ratio = EXCLUDED.dispersion_ratio,
            updated_at = EXCLUDED.updated_at
          RETURNING 1
        )
        SELECT COUNT(*)::int AS count FROM upsert;
      `;

      const recentBands = sql`
        WITH recent AS (
          SELECT
            model,
            COALESCE(variant_key, '') AS variant_key,
            condition_band,
            total_cents
          FROM listing_snapshots
          WHERE snapshot_day >= (CURRENT_DATE - INTERVAL '${w} days')
        ),
        upsert AS (
          INSERT INTO aggregated_stats_variant
            (model, variant_key, condition_band, window_days, n,
             p10_cents, p50_cents, p90_cents, dispersion_ratio, updated_at)
          SELECT
            model,
            variant_key,
            condition_band,
            ${w}::int AS window_days,
            COUNT(*)::int AS n,
            PERCENTILE_DISC(0.10) WITHIN GROUP (ORDER BY total_cents) AS p10,
            PERCENTILE_DISC(0.50) WITHIN GROUP (ORDER BY total_cents) AS p50,
            PERCENTILE_DISC(0.90) WITHIN GROUP (ORDER BY total_cents) AS p90,
            CASE
              WHEN PERCENTILE_DISC(0.50) WITHIN GROUP (ORDER BY total_cents) > 0
              THEN (PERCENTILE_DISC(0.90) WITHIN GROUP (ORDER BY total_cents)::float
                    / NULLIF(PERCENTILE_DISC(0.50) WITHIN GROUP (ORDER BY total_cents), 0))
              ELSE NULL
            END AS dispersion_ratio,
            NOW() AS updated_at
          FROM recent
          WHERE condition_band IS NOT NULL
          GROUP BY model, variant_key, condition_band
          HAVING COUNT(*) >= 1
          ON CONFLICT (model, variant_key, condition_band, window_days)
          DO UPDATE SET
            n = EXCLUDED.n,
            p10_cents = EXCLUDED.p10_cents,
            p50_cents = EXCLUDED.p50_cents,
            p90_cents = EXCLUDED.p90_cents,
            dispersion_ratio = EXCLUDED.dispersion_ratio,
            updated_at = EXCLUDED.updated_at
          RETURNING 1
        )
        SELECT COUNT(*)::int AS count FROM upsert;
      `;

      const updatedAny = await runCount(recentAny);
      const updatedBands = await runCount(recentBands);

      // Split counts to show how many were variant vs base (rough estimate)
      // We can derive it by re-reading what exists, but keep it simple here.
      results.push({
        windowDays: w,
        updatedAny,
        updatedBands,
      });
    }

    return ok(res, { ok: true, results });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
