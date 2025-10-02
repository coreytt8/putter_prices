// app/api/condition-deltas/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getSql } from "../../../lib/db";
import { normalizeModelKey, degradeKeyForKnownBugs } from "../../../lib/normalize";

const ALLOWED_WINDOWS = new Set([60, 90, 180]);

async function countNonAnyBands(sql, modelKey, windowDays) {
  const [row] = await sql`
    SELECT COUNT(*) AS bands
    FROM (
      SELECT DISTINCT condition_band
      FROM aggregated_stats_variant
      WHERE window_days = ${windowDays}
        AND COALESCE(variant_key,'') = ''
        AND model = ${modelKey}
        AND condition_band <> 'ANY'
    ) s
  `;
  return Number(row?.bands || 0);
}

async function queryDeltasWithWindow(sql, modelKey, windowDays) {
  const rows = await sql`
    WITH base_cte AS (
      SELECT model, condition_band, p50_cents
      FROM aggregated_stats_variant
      WHERE window_days = ${windowDays}
        AND COALESCE(variant_key,'') = ''
        AND model = ${modelKey}
    ),
    any_band_cte AS (
      SELECT model, p50_cents AS p50_any
      FROM base_cte
      WHERE condition_band = 'ANY'
    )
    SELECT
      b.condition_band,
      ROUND(((b.p50_cents - a.p50_any)::numeric / NULLIF(a.p50_any,0)) * 100, 1) AS pct_vs_any
    FROM base_cte b
    JOIN any_band_cte a USING (model)
    WHERE b.condition_band <> 'ANY'
    ORDER BY b.condition_band;
  `;
  return rows;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const rawInput = (searchParams.get("model") || "").trim();
    if (!rawInput) return NextResponse.json({ ok:false, error:'Missing "model"' }, { status: 400 });

    const forcedParam = Number(searchParams.get("window") || 0);
    const forcedWindow = ALLOWED_WINDOWS.has(forcedParam) ? forcedParam : null;

    const sql = getSql();

    // Prefer canonical key first, then degraded, then raw-lower
    const normalized = normalizeModelKey(rawInput);
    const degraded = typeof degradeKeyForKnownBugs === "function"
      ? degradeKeyForKnownBugs(normalized || rawInput.toLowerCase())
      : null;
    const rawLower = rawInput.toLowerCase();
    const candidates = Array.from(new Set([normalized, degraded, rawLower].filter(Boolean)));

    // If a window is forced, use it directly (no fallback)
    if (forcedWindow) {
      for (const key of candidates) {
        const deltas = await queryDeltasWithWindow(sql, key, forcedWindow);
        const bandsCount = await countNonAnyBands(sql, key, forcedWindow);
        if (deltas) {
          return NextResponse.json({
            ok: true,
            model: key,
            deltas,
            windowDays: forcedWindow,
            bandsCount,
            forced: true
          });
        }
      }
    }

    // No forced window: try 60 -> 90 -> 180 for first candidate that has >=2 bands
    for (const key of candidates) {
      for (const w of [60, 90, 180]) {
        const bandsCount = await countNonAnyBands(sql, key, w);
        if (bandsCount >= 2) {
          const deltas = await queryDeltasWithWindow(sql, key, w);
          return NextResponse.json({ ok:true, model:key, deltas, windowDays:w, bandsCount });
        }
      }
      // If none of the windows have >=2, still return 60d so UI can decide to hide
      const deltas60 = await queryDeltasWithWindow(sql, key, 60);
      const bands60 = await countNonAnyBands(sql, key, 60);
      if (deltas60) {
        return NextResponse.json({ ok:true, model:key, deltas:deltas60, windowDays:60, bandsCount:bands60 });
      }
    }

    // Fuzzy fallback: find a model that HAS >=2 bands in 60d
    const needle = normalized || rawLower;
    if (needle && needle.length >= 3) {
      const like = `%${needle}%`;
      const found = await sql`
        SELECT model,
               COUNT(*) FILTER (WHERE condition_band <> 'ANY') AS bands,
               MAX(n) AS max_n
        FROM aggregated_stats_variant
        WHERE COALESCE(variant_key,'') = '' AND model ILIKE ${like}
        GROUP BY model
        HAVING COUNT(*) FILTER (WHERE condition_band <> 'ANY') > 1
        ORDER BY bands DESC, max_n DESC
        LIMIT 1
      `;
      if (found?.length) {
        const matched = found[0].model;
        const deltas = await queryDeltasWithWindow(sql, matched, 60);
        const bandsCount = await countNonAnyBands(sql, matched, 60);
        return NextResponse.json({ ok:true, model:matched, deltas, windowDays:60, bandsCount, match:"fuzzy_contains" });
      }
    }

    return NextResponse.json({ ok:true, model:candidates[0] || rawLower, deltas:[], windowDays:60, bandsCount:0 });
  } catch (e) {
    return NextResponse.json({ ok:false, error:String(e), where:"condition-deltas" }, { status: 500 });
  }
}
