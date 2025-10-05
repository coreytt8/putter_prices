// pages/api/admin/aggregate.js
export const runtime = "nodejs";

import { getSql } from "../../../lib/db";
import { normalizeModelKey } from "../../../lib/normalize";

const WINDOWS = [60, 90, 180];
const FALLBACK_SECRET = "12qwaszx!@QWASZX";
const AUTH_SECRET =
  process.env.ADMIN_SECRET ||
  process.env.AGGREGATE_SECRET ||
  process.env.CRON_SECRET ||
  process.env.ADMIN_KEY ||
  FALLBACK_SECRET;

export default async function handler(req, res) {
  try {
    const { secret, onlyModel } = req.query || {};
    if (!secret || secret !== AUTH_SECRET) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const onlyKeyRaw = onlyModel ? String(Array.isArray(onlyModel) ? onlyModel[0] : onlyModel) : "";
    const normalizedOnly = onlyKeyRaw ? normalizeModelKey(onlyKeyRaw) : "";
    const onlyKey = normalizedOnly ? normalizedOnly : null;

    const sql = getSql();
    const results = [];

    for (const windowDays of WINDOWS) {
      let updatedAny = 0;
      let updatedBands = 0;
      let updatedVariants = 0;

      const anyRows = await sql`
        WITH base AS (
          SELECT
            model,
            COALESCE(variant_key, '') AS variant_key,
            COUNT(*)::int AS n,
            ROUND(percentile_cont(0.1) WITHIN GROUP (ORDER BY total) * 100)::int AS p10_cents,
            ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY total) * 100)::int AS p50_cents,
            ROUND(percentile_cont(0.9) WITHIN GROUP (ORDER BY total) * 100)::int AS p90_cents
          FROM listing_snapshots
          WHERE observed_at >= NOW() - ${windowDays} * INTERVAL '1 day'
            ${onlyKey ? sql`AND model = ${onlyKey}` : sql``}
            AND total IS NOT NULL
          GROUP BY 1, 2
        )
        INSERT INTO aggregated_stats_variant
          (model, variant_key, condition_band, window_days, n, p10_cents, p50_cents, p90_cents, dispersion_ratio, updated_at)
        SELECT
          model,
          variant_key,
          'ANY',
          ${windowDays},
          n,
          p10_cents,
          p50_cents,
          p90_cents,
          CASE WHEN p10_cents > 0 THEN (p90_cents - p10_cents)::numeric / p10_cents ELSE NULL END,
          NOW()
        FROM base
        ON CONFLICT (model, variant_key, condition_band, window_days) DO UPDATE
        SET
          n = EXCLUDED.n,
          p10_cents = EXCLUDED.p10_cents,
          p50_cents = EXCLUDED.p50_cents,
          p90_cents = EXCLUDED.p90_cents,
          dispersion_ratio = EXCLUDED.dispersion_ratio,
          updated_at = EXCLUDED.updated_at
        RETURNING model, variant_key
      `;
      updatedAny += anyRows?.length || 0;

      const bandRows = await sql`
        WITH base AS (
          SELECT
            model,
            COALESCE(variant_key, '') AS variant_key,
            CASE
              WHEN LOWER(COALESCE(condition, '')) LIKE '%new%' AND LOWER(COALESCE(condition, '')) NOT LIKE '%like%'
                THEN 'NEW'
              WHEN LOWER(COALESCE(condition, '')) LIKE '%like%'
                OR LOWER(COALESCE(condition, '')) LIKE '%open%'
                THEN 'LIKE_NEW'
              ELSE 'USED'
            END AS condition_band,
            COUNT(*)::int AS n,
            ROUND(percentile_cont(0.1) WITHIN GROUP (ORDER BY total) * 100)::int AS p10_cents,
            ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY total) * 100)::int AS p50_cents,
            ROUND(percentile_cont(0.9) WITHIN GROUP (ORDER BY total) * 100)::int AS p90_cents
          FROM listing_snapshots
          WHERE observed_at >= NOW() - ${windowDays} * INTERVAL '1 day'
            ${onlyKey ? sql`AND model = ${onlyKey}` : sql``}
            AND total IS NOT NULL
          GROUP BY 1, 2, 3
        )
        INSERT INTO aggregated_stats_variant
          (model, variant_key, condition_band, window_days, n, p10_cents, p50_cents, p90_cents, dispersion_ratio, updated_at)
        SELECT
          model,
          variant_key,
          condition_band,
          ${windowDays},
          n,
          p10_cents,
          p50_cents,
          p90_cents,
          CASE WHEN p10_cents > 0 THEN (p90_cents - p10_cents)::numeric / p10_cents ELSE NULL END,
          NOW()
        FROM base
        ON CONFLICT (model, variant_key, condition_band, window_days) DO UPDATE
        SET
          n = EXCLUDED.n,
          p10_cents = EXCLUDED.p10_cents,
          p50_cents = EXCLUDED.p50_cents,
          p90_cents = EXCLUDED.p90_cents,
          dispersion_ratio = EXCLUDED.dispersion_ratio,
          updated_at = EXCLUDED.updated_at
        RETURNING model, variant_key
      `;

      for (const row of bandRows || []) {
        if (row.variant_key) {
          updatedVariants += 1;
        } else {
          updatedBands += 1;
        }
      }

      results.push({ windowDays, updatedAny, updatedBands, updatedVariants });
    }

    return res.status(200).json({ ok: true, onlyModel: onlyKey || null, results });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || String(error) });
  }
}
