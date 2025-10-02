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

export default async function handler(req, res) {
  try {
    const sql = getSql();
    const raw = String(req.query.model || '').trim();
    if (!raw) {
      return res.status(400).json({ ok: false, error: 'Missing model' });
    }

    const modelKey = normalizeModelKey(raw);
    const degradedKey = degradeKeyForKnownBugs(modelKey);
    const candidateKeys = [modelKey];
    if (degradedKey && degradedKey !== modelKey) {
      candidateKeys.push(degradedKey);
    }

    let baselineRow = null;
    let selectedKey = modelKey;

    for (const candidate of candidateKeys) {
      const rows = await sql`
        SELECT condition_band, window_days, p50_cents
        FROM aggregated_stats_variant
        WHERE model = ${candidate}
          AND variant_key = ''
          AND condition_band = 'ANY'
        ORDER BY window_days DESC
        LIMIT 1
      `;
      if (rows && rows.length) {
        baselineRow = rows[0];
        selectedKey = candidate;
        break;
      }
    }

    if (!baselineRow) {
      return res.status(200).json({ ok: true, bandsCount: 0 });
    }

    const baselineMedian = centsToDollars(baselineRow.p50_cents);
    const windowDays = baselineRow.window_days !== null && baselineRow.window_days !== undefined
      ? Number(baselineRow.window_days)
      : null;

    if (!isPositiveNumber(baselineMedian)) {
      return res.status(200).json({ ok: true, bandsCount: 0 });
    }

    const conditionRows = await sql`
      SELECT condition_band, p50_cents, n
      FROM aggregated_stats_variant
      WHERE model = ${selectedKey}
        AND variant_key = ''
        AND condition_band <> 'ANY'
        AND window_days = ${baselineRow.window_days}
    `;

    if (!conditionRows || !conditionRows.length) {
      return res.status(200).json({
        ok: true,
        modelKey,
        windowDays,
        bandsCount: 0,
        bands: [],
      });
    }

    const bands = conditionRows
      .map((row) => {
        const median = centsToDollars(row.p50_cents);
        if (!isPositiveNumber(median)) return null;
        const premium = median - baselineMedian;
        return {
          condition: row.condition_band,
          median,
          premium,
          sampleSize: Number(row.n || 0),
        };
      })
      .filter(Boolean);

    if (!bands.length) {
      return res.status(200).json({ ok: true, bandsCount: 0 });
    }

    return res.status(200).json({
      ok: true,
      modelKey,
      windowDays,
      bandsCount: bands.length,
      bands,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}
