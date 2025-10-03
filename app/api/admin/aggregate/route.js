// app/api/admin/aggregate/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

// helper: dollars->cents guards
const nint = (x) => (x == null ? null : Math.round(Number(x)));

function ok(data) {
  return NextResponse.json({ ok: true, ...data }, { status: 200 });
}
function err(message, code = 400) {
  return NextResponse.json({ ok: false, error: message }, { status: code });
}

// Build the common SELECT for a window
function selectAgg(windowDays, withBand) {
  // withBand=true -> group by condition_band
  // withBand=false -> baseline "ANY" ignoring band
  const bandSelect = withBand ? "condition_band" : `'ANY' AS condition_band`;
  const bandGroupBy = withBand ? "condition_band" : null;

  return `
    SELECT
      model,
      COALESCE(variant_key,'') AS variant_key,
      ${bandSelect},
      ${windowDays}::int AS window_days,
      COUNT(*)::int AS n,
      CAST(percentile_cont(0.10) WITHIN GROUP (ORDER BY price_cents) AS INT) AS p10_cents,
      CAST(percentile_cont(0.50) WITHIN GROUP (ORDER BY price_cents) AS INT) AS p50_cents,
      CAST(percentile_cont(0.90) WITHIN GROUP (ORDER BY price_cents) AS INT) AS p90_cents,
      CASE
        WHEN percentile_cont(0.50) WITHIN GROUP (ORDER BY price_cents) = 0 THEN NULL
        ELSE (percentile_cont(0.90) WITHIN GROUP (ORDER BY price_cents)::numeric
             / NULLIF(percentile_cont(0.50) WITHIN GROUP (ORDER BY price_cents),0)::numeric)
      END AS dispersion_ratio,
      now() AS updated_at
    FROM listing_snapshots
    WHERE snapshot_ts >= now() - make_interval(days => ${windowDays})
    GROUP BY model, COALESCE(variant_key,'' )${bandGroupBy ? `, ${bandGroupBy}` : ""}
  `;
}

// One window upsert (ANY baseline + banded rows)
async function runWindow(sql, windowDays) {
  // 1) Baseline ANY
  const anyInsert = `
    INSERT INTO aggregated_stats_variant
      (model, variant_key, condition_band, window_days, n, p10_cents, p50_cents, p90_cents, dispersion_ratio, updated_at)
    ${selectAgg(windowDays, false)}
    ON CONFLICT (model, variant_key, condition_band, window_days)
    DO UPDATE SET
      n = EXCLUDED.n,
      p10_cents = EXCLUDED.p10_cents,
      p50_cents = EXCLUDED.p50_cents,
      p90_cents = EXCLUDED.p90_cents,
      dispersion_ratio = EXCLUDED.dispersion_ratio,
      updated_at = EXCLUDED.updated_at
    RETURNING 1
  `;

  // 2) Condition-banded
  const bandInsert = `
    INSERT INTO aggregated_stats_variant
      (model, variant_key, condition_band, window_days, n, p10_cents, p50_cents, p90_cents, dispersion_ratio, updated_at)
    ${selectAgg(windowDays, true)}
    ON CONFLICT (model, variant_key, condition_band, window_days)
    DO UPDATE SET
      n = EXCLUDED.n,
      p10_cents = EXCLUDED.p10_cents,
      p50_cents = EXCLUDED.p50_cents,
      p90_cents = EXCLUDED.p90_cents,
      dispersion_ratio = EXCLUDED.dispersion_ratio,
      updated_at = EXCLUDED.updated_at
    RETURNING 1
  `;

  const anyRows = await sql.unsafe(anyInsert);
  const bandRows = await sql.unsafe(bandInsert);

  return {
    windowDays,
    updatedAny: anyRows?.length || 0,
    updatedBands: bandRows?.length || 0,
  };
}

function authorize(req) {
  // allow either ?secret=... (cron) OR X-ADMIN-KEY header (manual)
  const { searchParams } = new URL(req.url);
  const qSecret = searchParams.get("secret");
  const headerKey = req.headers.get("x-admin-key");
  const envSecret = process.env.CRON_SECRET || process.env.ADMIN_KEY;

  if (!qSecret && !headerKey) return false;
  const token = qSecret || headerKey;
  return envSecret ? token === envSecret : true;
}

export async function GET(req) {
  if (!authorize(req)) return err("unauthorized", 401);
  try {
    const sql = getSql();
    const results = [];
    for (const w of [60, 90, 180]) {
      const r = await runWindow(sql, w);
      results.push(r);
    }
    return ok({ results });
  } catch (e) {
    return err(e.message, 500);
  }
}

export async function POST(req) {
  return GET(req);
}
