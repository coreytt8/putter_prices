// pages/api/models/search.js
export const runtime = 'nodejs';
import { getSql } from '../../lib/db';

export default async function handler(req, res) {
  try {
    const { q = '' } = req.query;
    const sql = getSql();
    const like = `%${q.toLowerCase()}%`;
    const rows = await sql`
      SELECT i.model_key, COUNT(*) AS cnt
      FROM items i
      JOIN item_prices ip ON ip.item_id = i.item_id
      WHERE i.model_key IS NOT NULL
        AND LOWER(i.model_key) LIKE ${like}
        AND ip.total IS NOT NULL
        AND ip.observed_at >= now() - interval '90 days'
      GROUP BY i.model_key
      ORDER BY cnt DESC
      LIMIT 25
    `;
    res.status(200).json({ ok: true, q, models: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
