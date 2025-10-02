// app/api/variants/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getSql } from "../../../lib/db";
import { normalizeModelKey, degradeKeyForKnownBugs } from "../../../lib/normalize";

const ALLOWED_WINDOWS = new Set([60, 90, 180]);

async function queryVariants(sql, modelKey, windowDays, minN) {
  // base ANY p50 (no variant)
  const baseRows = await sql`
    SELECT p50_cents AS base_p50
    FROM aggregated_stats_variant
    WHERE window_days = ${windowDays}
      AND condition_band = 'ANY'
      AND COALESCE(variant_key,'') = ''
      AND model = ${modelKey}
    LIMIT 1
  `;
  const base_p50 = baseRows?.[0]?.base_p50 ?? null;
  if (!base_p50) return { variants: [], base_p50: null };

  const rows = await sql`
    SELECT variant_key, n, p50_cents
    FROM aggregated_stats_variant
    WHERE window_days = ${windowDays}
      AND condition_band = 'ANY'
      AND COALESCE(variant_key,'') <> ''
      AND model = ${modelKey}
      AND n >= ${minN}
    ORDER BY n DESC, p50_cents DESC
  `;
  const variants = rows.map(r => ({
    variant_key: r.variant_key,
    n: Number(r.n || 0),
    premium_pct: Number((((r.p50_cents - base_p50) / (base_p50 || 1)) * 100).toFixed(1)),
    variant_p50: Number(r.p50_cents || 0),
    base_p50: Number(base_p50 || 0),
  }));
  return { variants, base_p50: Number(base_p50 || 0) };
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const raw = (searchParams.get("model") || "").trim();
    if (!raw) return NextResponse.json({ ok:false, error:'Missing "model"' }, { status: 400 });

    const forcedParam = Number(searchParams.get("window") || 0);
    const forcedWindow = ALLOWED_WINDOWS.has(forcedParam) ? forcedParam : null;
    const minN = Math.max(1, Number(searchParams.get("minN") || 2));

    const sql = getSql();

    // Prefer canonical key first
    const normalized = normalizeModelKey(raw);
    const degraded = typeof degradeKeyForKnownBugs === "function"
      ? degradeKeyForKnownBugs(normalized || raw.toLowerCase())
      : null;
    const rawLower = raw.toLowerCase();
    const candidates = Array.from(new Set([normalized, degraded, rawLower].filter(Boolean)));

    // Forced window path
    if (forcedWindow) {
      for (const key of candidates) {
        const { variants, base_p50 } = await queryVariants(sql, key, forcedWindow, minN);
        if (variants) {
          return NextResponse.json({
            ok: true, model: key, windowDays: forcedWindow, forced: true,
            base_p50, variants
          });
        }
      }
    }

    // Fallback: 60 -> 90 -> 180; return first window with at least one variant row
    for (const key of candidates) {
      for (const w of [60, 90, 180]) {
        const { variants, base_p50 } = await queryVariants(sql, key, w, minN);
        if (variants?.length) {
          return NextResponse.json({ ok:true, model:key, windowDays:w, base_p50, variants });
        }
      }
    }

    // Fuzzy fallback: find a model that HAS variant rows in 60d
    const needle = normalized || rawLower;
    if (needle && needle.length >= 3) {
      const like = `%${needle}%`;
      const found = await sql`
        SELECT model, SUM(n) AS total_n
        FROM aggregated_stats_variant
        WHERE window_days = 60
          AND condition_band = 'ANY'
          AND COALESCE(variant_key,'') <> ''
          AND model ILIKE ${like}
        GROUP BY model
        ORDER BY total_n DESC
        LIMIT 1
      `;
      if (found?.length) {
        const matched = found[0].model;
        const { variants, base_p50 } = await queryVariants(sql, matched, 60, minN);
        return NextResponse.json({
          ok: true, model: matched, windowDays: 60, base_p50, variants, match: "fuzzy_contains"
        });
      }
    }

    return NextResponse.json({ ok:true, model: candidates[0] || rawLower, windowDays: 60, base_p50: null, variants: [] });
  } catch (e) {
    return NextResponse.json({ ok:false, error:String(e), where:"variants" }, { status: 500 });
  }
}
