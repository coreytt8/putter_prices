// pages/api/models/search.js
export const runtime = 'nodejs';
import { getSql } from '../../../lib/db.js';
import { normalizeModelKey } from '../../../lib/normalize.js';

export async function searchModels(sql, q = '') {
  const normalized = normalizeModelKey(String(q || ''));
  const hasMeaningfulQuery = normalized.length > 0;
  const like = `%${normalized}%`;
  return sql`
    SELECT i.model_key, COUNT(*) AS cnt
    FROM items i
    JOIN item_prices ip ON ip.item_id = i.item_id
    WHERE i.model_key IS NOT NULL
      ${hasMeaningfulQuery ? sql`AND LOWER(i.model_key) LIKE ${like}` : sql``}
      AND ip.total IS NOT NULL
      AND ip.observed_at >= now() - interval '90 days'
    GROUP BY i.model_key
    ORDER BY cnt DESC
    LIMIT 25
  `;
}

export default async function handler(req, res) {
  try {
    const { q = '' } = req.query;
    const sql = req?.testSql || getSql();
    const rows = await searchModels(sql, q);
    res.status(200).json({ ok: true, q, models: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
