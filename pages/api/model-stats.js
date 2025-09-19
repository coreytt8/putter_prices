// pages/api/model-stats.js
export const runtime = 'nodejs';

import { getSql } from '../../lib/db';

// Keep key normalization aligned with your grouping
function normalizeModelKey(title = '') {
  return (title || '')
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

    // CONTAINS match: include any items whose model_key contains the phrase
    const likeContains = `%${modelKey}%`;

    const [row] = await sql`
      WITH w AS (
        SELECT ip.total
        FROM item_prices ip
        JOIN items i ON i.item_id = ip.item_id
        WHERE i.model_key ILIKE ${likeContains}
          AND ip.observed_at >= now() - interval '90 days'
          AND ip.total IS NOT NULL
      )
      SELECT
        percentile_cont(0.1) WITHIN GROUP (ORDER BY total) AS p10,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY total) AS p50,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY total) AS p90,
        COUNT(*) AS n
      FROM w
    `;

    return res.status(200).json({ ok: true, modelKey, stats: row });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
