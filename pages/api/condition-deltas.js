// pages/api/condition-deltas.js
export const runtime = 'nodejs';

import { getSql } from '../../lib/db';
import { normalizeModelKey, degradeKeyForKnownBugs } from '../../lib/normalize';

function centsToDollars(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return num / 100;
}
function isPositiveNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0;
}
function parseWindow(req) {
  const w = String(req.query.window || '').trim();
  if (!w) return null;
  const n = Number(w);
  return [60, 90, 180].includes(n) ? n : null;
}

// --- SQL helpers ---
async function selectBaselineAny(sql, modelKey, prefWindow = null) {
  if (prefWindow) {
    const rows = await sql`
      SELECT condition_band, window_days, p50_cents
      FROM aggregated_stats_variant
      WHERE model = ${modelKey}
        AND COALESCE(variant_key,'') = ''
        AND condition_band = 'ANY'
        AND window_days = ${prefWindow}
      LIMIT 1
    `;
    if (rows?.length) return rows[0];
  }
  const rows2 = await sql`
    SELECT condition_band, window_days, p50_cents
    FROM aggregated_stats_variant
    WHERE model = ${modelKey}
      AND COALESCE(variant_key,'') = ''
      AND condition_band = 'ANY'
    ORDER BY window_days DESC
    LIMIT 1
  `;
  return rows2?.[0] || null;
}

async function loadBandsForWindow(sql, modelKey, windowDays, baselineMedian) {
  const rows = await sql`
    SELECT condition_band, p50_cents, n
    FROM aggregated_stats_variant
    WHERE model = ${modelKey}
      AND COALESCE(variant_key,'') = ''
      AND condition_band <> 'ANY'
      AND window_days = ${windowDays}
  `;
  if (!rows?.length) return [];

  return rows
    .map((row) => {
      const median = centsToDollars(row.p50_cents);
      if (!isPositiveNumber(median)) return null;
      const premiumAbs = median - baselineMedian;
      const premiumPct = baselineMedian > 0 ? premiumAbs / baselineMedian : 0;
      return {
        condition: row.condition_band,
        median,
        premiumAbs,                         // $ over baseline
        premiumPct,                         // fraction (0.312 = +31.2%)
        pct_vs_any: (premiumPct * 100).toFixed(1), // legacy string
        sampleSize: Number(row.n || 0),
      };
    })
    .filter(Boolean);
}

async function suggestFamily(sql, baseKey, minLikeLen = 3, limit = 5) {
  if (!baseKey || baseKey.length < minLikeLen) return [];
  const like = `${baseKey}%`;
  const rows = await sql`
    SELECT model, SUM(n)::int AS total_n
    FROM aggregated_stats_variant
    WHERE COALESCE(variant_key,'') = ''
      AND model LIKE ${like}
    GROUP BY model
    ORDER BY total_n DESC NULLS LAST
    LIMIT ${limit}
  `;
  return rows || [];
}

export default async function handler(req, res) {
  try {
    const sql = getSql();
    const raw = String(req.query.model || '').trim();
    if (!raw) return res.status(400).json({ ok: false, error: 'Missing model' });

    const prefWindow = parseWindow(req); // 60|90|180|null
    const requestedKey = normalizeModelKey(raw);
    const degradedKey = degradeKeyForKnownBugs(requestedKey);
    const candidateKeys = [requestedKey];
    if (degradedKey && degradedKey !== requestedKey) candidateKeys.push(degradedKey);

    // 1) Try exact / degraded keys
    let selectedKey = requestedKey;
    let baselineRow = null;
    for (const candidate of candidateKeys) {
      const row = await selectBaselineAny(sql, candidate, prefWindow);
      if (row) { selectedKey = candidate; baselineRow = row; break; }
    }

    // 2) If no baseline for parent, auto-proxy to dominant child if possible
    if (!baselineRow) {
      const fam = await suggestFamily(sql, requestedKey);
      if (fam?.length) {
        const top = fam[0].model;
        const altBaseline = await selectBaselineAny(sql, top, prefWindow);
        if (altBaseline) {
          const altMedian = centsToDollars(altBaseline.p50_cents);
          const altWindow = Number(altBaseline.window_days ?? 0);
          if (isPositiveNumber(altMedian)) {
            const altBands = await loadBandsForWindow(sql, top, altWindow, altMedian);
            altBands.sort((a, b) => b.premiumPct - a.premiumPct);
            if (altBands.length >= 2) {
              return res.status(200).json({
                ok: true,
                requested: { modelKey: requestedKey, window: prefWindow },
                resolved: { modelKey: top, windowDays: altWindow, proxyFor: top },
                bandsCount: altBands.length,
                bands: altBands,
              });
            }
          }
        }
      }
      // Still thin → return did-you-mean list
      return res.status(200).json({
        ok: true,
        requested: { modelKey: requestedKey, window: prefWindow },
        resolved: null,
        bandsCount: 0,
        bands: [],
        didYouMean: (await suggestFamily(sql, requestedKey)).map(r => r.model),
      });
    }

    // 3) We have a baseline for selectedKey — load bands
    const baselineMedian = centsToDollars(baselineRow.p50_cents);
    const windowDays = Number(baselineRow.window_days ?? 0);
    if (!isPositiveNumber(baselineMedian)) {
      return res.status(200).json({
        ok: true,
        requested: { modelKey: requestedKey, window: prefWindow },
        resolved: { modelKey: selectedKey, windowDays },
        bandsCount: 0,
        bands: [],
      });
    }

    let bands = await loadBandsForWindow(sql, selectedKey, windowDays, baselineMedian);

    // 4) If exact model has <2 bands, try dominant child as proxy
    let proxyFor = null;
    if (bands.length < 2) {
      const fam = await suggestFamily(sql, selectedKey);
      if (fam?.length) {
        const top = fam.find(r => r.model !== selectedKey)?.model || fam[0].model;
        if (top) {
          const altBaseline = await selectBaselineAny(sql, top, prefWindow || windowDays);
          if (altBaseline) {
            const altMedian = centsToDollars(altBaseline.p50_cents);
            const altWindow = Number(altBaseline.window_days ?? windowDays);
            if (isPositiveNumber(altMedian)) {
              const altBands = await loadBandsForWindow(sql, top, altWindow, altMedian);
              if (altBands.length >= 2) {
                proxyFor = top;
                selectedKey = top;
                bands = altBands;
              }
            }
          }
        }
      }
    }

    // 5) Sort by descending % premium
    bands.sort((a, b) => b.premiumPct - a.premiumPct);

    return res.status(200).json({
      ok: true,
      requested: { modelKey: requestedKey, window: prefWindow },
      resolved: { modelKey: selectedKey, windowDays, proxyFor: proxyFor || null },
      bandsCount: bands.length,
      bands,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}
