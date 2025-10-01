import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

/**
 * POST body:
 * {
 *   "models": ["scotty-cameron__phantom-x-5-5", "ping__anser", ...],
 *   "condition_band": "ANY",     // optional
 *   "variant_key": ""            // optional
 *   "window_days": 60            // optional (defaults to largest available)
 * }
 */
export async function POST(req) {
  try {
    const payload = await req.json();
    const models = Array.isArray(payload?.models) ? payload.models.slice(0, 200) : [];
    if (!models.length) {
      return NextResponse.json({ ok: false, error: "models required" }, { status: 400 });
    }
    const conditionBand = payload?.condition_band ?? "ANY";
    const variantKey = payload?.variant_key ?? "";
    const windowDays = payload?.window_days ?? null; // if null, we take the newest per model

    const sql = getSql();
    let rows;
    if (windowDays === null) {
      rows = await sql`
        SELECT DISTINCT ON (model)
          model, variant_key, condition_band, window_days,
          n, p10_cents, p50_cents, p90_cents, dispersion_ratio, updated_at
        FROM aggregated_stats_variant
        WHERE model = ANY(${models})
          AND variant_key = ${variantKey}
          AND condition_band = ${conditionBand}
        ORDER BY model, window_days DESC
      `;
    } else {
      rows = await sql`
        SELECT model, variant_key, condition_band, window_days,
               n, p10_cents, p50_cents, p90_cents, dispersion_ratio, updated_at
          FROM aggregated_stats_variant
         WHERE model = ANY(${models})
           AND variant_key = ${variantKey}
           AND condition_band = ${conditionBand}
           AND window_days = ${windowDays}
      `;
    }

    const map = {};
    for (const r of rows) {
      map[r.model] = {
        p10: r.p10_cents != null ? r.p10_cents / 100 : null,
        p50: r.p50_cents != null ? r.p50_cents / 100 : null,
        p90: r.p90_cents != null ? r.p90_cents / 100 : null,
        n: Number(r.n || 0),
        window_days: Number(r.window_days),
        updated_at: r.updated_at,
      };
    }

    return NextResponse.json({ ok: true, stats: map });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
