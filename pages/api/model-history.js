// pages/api/model-history.js
export const runtime = 'nodejs';

import { getSql } from '../../lib/db';
import { normalizeModelKey, degradeKeyForKnownBugs } from '../../lib/normalize';

function dollars(cents) {
  if (cents == null) return null;
  const n = Number(cents);
  return Number.isFinite(n) ? n / 100 : null;
}

function parseWindow(req) {
  const w = Number(String(req.query.window || '').trim() || '180');
  return [30, 60, 90, 180, 365].includes(w) ? w : 180;
}

// Aggregate daily p50 per band (and ANY) for a model key
async function loadDaily(sql, modelKey, days) {
  // We compute ANY from the same rows so it’s consistent with bands
  const rows = await sql`
    WITH base AS (
      SELECT
        snapshot_day,
        COALESCE(NULLIF(condition_band, ''), 'ANY') AS band,
        price_cents
      FROM listing_snapshots
      WHERE model = ${modelKey}
        AND snapshot_day >= (now() AT TIME ZONE 'UTC')::date - ${days}::int
        AND price_cents IS NOT NULL
    ),
    bands AS (
      SELECT
        snapshot_day,
        band AS condition_band,
        CAST(percentile_cont(0.50) WITHIN GROUP (ORDER BY price_cents) AS INT) AS p50_cents,
        COUNT(*)::int AS n
      FROM base
      GROUP BY snapshot_day, band
    ),
    any_band AS (
      SELECT
        snapshot_day,
        'ANY' AS condition_band,
        CAST(percentile_cont(0.50) WITHIN GROUP (ORDER BY price_cents) AS INT) AS p50_cents,
        COUNT(*)::int AS n
      FROM base
      GROUP BY snapshot_day
    )
    SELECT snapshot_day, condition_band, p50_cents, n
    FROM (
      SELECT * FROM bands
      UNION ALL
      SELECT * FROM any_band
    ) u
    ORDER BY snapshot_day ASC, condition_band ASC
  `;
  return rows || [];
}

export default async function handler(req, res) {
  try {
    const sql = getSql();
    const raw = String(req.query.model || req.query.q || '').trim();
    if (!raw) return res.status(400).json({ ok: false, error: 'Missing model' });

    const windowDays = parseWindow(req);
    const requested = normalizeModelKey(raw);
    const degraded = degradeKeyForKnownBugs(requested);
    const candidates = Array.from(new Set([requested, degraded].filter(Boolean)));

    let picked = null;
    let data = null;
    for (const key of candidates) {
      const rows = await loadDaily(sql, key, windowDays);
      if (rows.length) {
        picked = key;
        data = rows;
        break;
      }
    }

    if (!picked) {
      // Try loose family suggestion as a friendly hint
      const like = requested.slice(0, Math.max(3, Math.min(12, requested.length)));
      const fam = await sql`
        SELECT model, SUM(n)::int AS total_n
        FROM aggregated_stats_variant
        WHERE COALESCE(variant_key,'') = ''
          AND model LIKE ${like + '%'}
        GROUP BY model
        ORDER BY total_n DESC NULLS LAST
        LIMIT 5
      `;
      return res.status(200).json({
        ok: true,
        requested: { modelKey: requested, windowDays },
        resolved: null,
        points: [],
        didYouMean: (fam || []).map(r => r.model),
      });
    }

    // Shape into series: {date, ANY, NEW, LIKE_NEW, USED, ...}
    const map = new Map();
    for (const r of data) {
      const d = r.snapshot_day.toISOString().slice(0, 10);
      const row = map.get(d) || { date: d };
      row[r.condition_band] = dollars(r.p50_cents);
      row[`n_${r.condition_band}`] = r.n;
      map.set(d, row);
    }

    const points = Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));

    return res.status(200).json({
      ok: true,
      requested: { modelKey: requested, windowDays },
      resolved: { modelKey: picked, windowDays },
      series: {
        points,
        bands: Array.from(
          new Set(
            data.map(r => r.condition_band)
          )
        ).sort(),
      },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
