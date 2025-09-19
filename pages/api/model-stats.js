// pages/api/model-stats.js
export const runtime = 'nodejs'; // fine to keep

import { getSql } from '../../lib/db'; // <-- fix: import getSql

// Keep key normalization aligned with your grouping
function normalizeModelKey(title = '') {
  return title
    .toLowerCase()
    .replace(/scotty\s*cameron|titleist|putter|golf|\b(rh|lh)\b|right\s*hand(ed)?|left\s*hand(ed)?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export default async function handler(req, res) {
  try {
    const sql = getSql();

    const { model = '' } = req.query;
    const modelKey = normalizeModelKey(model);
    if (!modelKey) return res.status(400).json({ ok: false, error: 'Missing model' });

    // Example: 90d median/percentiles for the model
    const [row] = await sql`
      WITH w AS (
        SELECT total
        FROM item_prices
        WHERE model_key = ${modelKey}
          AND observed_at >= now() - interval '90 days'
          AND total IS NOT NULL
      )
      SELECT
        percentile_cont(0.1)  WITHIN GROUP (ORDER BY total) AS p10,
        percentile_cont(0.5)  WITHIN GROUP (ORDER BY total) AS p50,
        percentile_cont(0.9)  WITHIN GROUP (ORDER BY total) AS p90,
        COUNT(*) AS n
      FROM w
    `;

    return res.status(200).json({ ok: true, modelKey, stats: row });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
