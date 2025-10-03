export const runtime = 'nodejs';

import { getSql } from '@/lib/db';

// Accept either ?secret=... (for Vercel Cron) or X-CRON-SECRET header (for curl)
function isAuthorized(req) {
  const url = new URL(req.url);
  const qs = url.searchParams.get('secret');
  const hdr = req.headers.get('x-cron-secret') || req.headers.get('x-admin-key');
  const secret = process.env.CRON_SECRET;
  return !!secret && (qs === secret || hdr === secret);
}

// Upsert helper for one window (days = 60 | 90 | 180)
async function rebuildWindow(sql, days) {
  // We compute on total_cents. If you ever store only price+shipping, switch to COALESCE(total_cents, price_cents + shipping_cents)
  // Transaction keeps the window consistent
  return sql.begin(async (tx) => {
    // Clear this window so inserts are idempotent
    await tx`DELETE FROM aggregated_stats_variant WHERE window_days = ${days}`;

    // 1) Per-condition bands (NEW/USED/etc.)
    await tx`
      INSERT INTO aggregated_stats_variant
        (model, variant_key, condition_band, window_days, n,
         p10_cents, p50_cents, p90_cents, dispersion_ratio, updated_at)
      SELECT
        s.model,
        COALESCE(s.variant_key, '') AS variant_key,
        COALESCE(s.condition_band, 'ANY') AS condition_band,
        ${days} AS window_days,
        COUNT(*) AS n,
        CAST(percentile_cont(0.10) WITHIN GROUP (ORDER BY s.total_cents) AS INT) AS p10_cents,
        CAST(percentile_cont(0.50) WITHIN GROUP (ORDER BY s.total_cents) AS INT) AS p50_cents,
        CAST(percentile_cont(0.90) WITHIN GROUP (ORDER BY s.total_cents) AS INT) AS p90_cents,
        CASE
          WHEN percentile_cont(0.50) WITHIN GROUP (ORDER BY s.total_cents) = 0 THEN NULL
          ELSE (percentile_cont(0.90) WITHIN GROUP (ORDER BY s.total_cents)::numeric
               / NULLIF(percentile_cont(0.50) WITHIN GROUP (ORDER BY s.total_cents), 0)::numeric)
        END AS dispersion_ratio,
        NOW() AS updated_at
      FROM listing_snapshots s
      WHERE s.snapshot_ts >= NOW() - (INTERVAL '1 day' * ${days})
        AND s.total_cents IS NOT NULL
      GROUP BY s.model, COALESCE(s.variant_key, ''), COALESCE(s.condition_band, 'ANY')
    `;

    // 2) ANY rollup (ignore condition band)
    await tx`
      INSERT INTO aggregated_stats_variant
        (model, variant_key, condition_band, window_days, n,
         p10_cents, p50_cents, p90_cents, dispersion_ratio, updated_at)
      SELECT
        s.model,
        COALESCE(s.variant_key, '') AS variant_key,
        'ANY' AS condition_band,
        ${days} AS window_days,
        COUNT(*) AS n,
        CAST(percentile_cont(0.10) WITHIN GROUP (ORDER BY s.total_cents) AS INT) AS p10_cents,
        CAST(percentile_cont(0.50) WITHIN GROUP (ORDER BY s.total_cents) AS INT) AS p50_cents,
        CAST(percentile_cont(0.90) WITHIN GROUP (ORDER BY s.total_cents) AS INT) AS p90_cents,
        CASE
          WHEN percentile_cont(0.50) WITHIN GROUP (ORDER BY s.total_cents) = 0 THEN NULL
          ELSE (percentile_cont(0.90) WITHIN GROUP (ORDER BY s.total_cents)::numeric
               / NULLIF(percentile_cont(0.50) WITHIN GROUP (ORDER BY s.total_cents), 0)::numeric)
        END AS dispersion_ratio,
        NOW() AS updated_at
      FROM listing_snapshots s
      WHERE s.snapshot_ts >= NOW() - (INTERVAL '1 day' * ${days})
        AND s.total_cents IS NOT NULL
      GROUP BY s.model, COALESCE(s.variant_key, '')
      ON CONFLICT (model, variant_key, condition_band, window_days)
      DO UPDATE SET
        n = EXCLUDED.n,
        p10_cents = EXCLUDED.p10_cents,
        p50_cents = EXCLUDED.p50_cents,
        p90_cents = EXCLUDED.p90_cents,
        dispersion_ratio = EXCLUDED.dispersion_ratio,
        updated_at = EXCLUDED.updated_at
    `;

    const [{ count }] = await tx`
      SELECT COUNT(*)::int AS count
      FROM aggregated_stats_variant
      WHERE window_days = ${days}
    `;
    return { windowDays: days, rows: count };
  });
}

export async function GET(req) {
  try {
    if (!isAuthorized(req)) {
      return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401 });
    }
    const sql = getSql();
    const results = [];
    for (const d of [60, 90, 180]) {
      results.push(await rebuildWindow(sql, d));
    }
    return Response.json({ ok: true, results });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500 });
  }
}

export async function POST(req) {
  // same as GET, handy for curl -X POST
  return GET(req);
}
