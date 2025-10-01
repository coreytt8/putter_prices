export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { normalizeModelKey } from "../../../../lib/normalize";
import { getSql } from "../../../../lib/db";
const ADMIN_KEY = process.env.ADMIN_KEY || "";

export async function POST(req) {
  if (ADMIN_KEY) {
    const key = req.headers.get("x-admin-key") || "";
    if (key !== ADMIN_KEY) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const sql = getSql();
  const WINDOW_DAYS = 60;

  await sql`DELETE FROM aggregated_stats_variant WHERE window_days = ${WINDOW_DAYS}`;
  await sql`
    INSERT INTO aggregated_stats_variant
      (model, variant_key, condition_band, window_days, n, p10_cents, p50_cents, p90_cents, dispersion_ratio, updated_at)
    SELECT
      model, variant_key, condition_band, ${WINDOW_DAYS},
      COUNT(*),
      CAST(percentile_cont(0.10) WITHIN GROUP (ORDER BY price_cents) AS INT),
      CAST(percentile_cont(0.50) WITHIN GROUP (ORDER BY price_cents) AS INT),
      CAST(percentile_cont(0.90) WITHIN GROUP (ORDER BY price_cents) AS INT),
      CASE WHEN percentile_cont(0.50) WITHIN GROUP (ORDER BY price_cents) = 0 THEN NULL
           ELSE (percentile_cont(0.90) WITHIN GROUP (ORDER BY price_cents)::numeric
                / NULLIF(percentile_cont(0.50) WITHIN GROUP (ORDER BY price_cents),0)::numeric)
      END,
      now()
    FROM listing_snapshots
    WHERE snapshot_ts >= now() - make_interval(days => ${WINDOW_DAYS})
    GROUP BY model, variant_key, condition_band
  `;

  const { rows } = await sql`SELECT COUNT(*)::int AS count FROM aggregated_stats_variant WHERE window_days = ${WINDOW_DAYS}`;
  return NextResponse.json({ ok: true, windowDays: WINDOW_DAYS, rows: rows?.[0]?.count ?? 0 });
}
