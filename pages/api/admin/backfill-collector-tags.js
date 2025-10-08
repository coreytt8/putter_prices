// pages/api/admin/backfill-collector-tags.js
export const runtime = 'nodejs';

import { tagAndFilter } from '../../../lib/collector/tagAndFilter.js';
import { getSql } from '../../../lib/db.js';

function isAuthorized(req) {
  const adminKey = req.headers['x-admin-key'] || req.headers['x-admin-key'.toLowerCase()];
  const secret = process.env.CRON_SECRET || process.env.ADMIN_KEY;
  return secret && adminKey === secret;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }
    if (!isAuthorized(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const limit = Math.min(20000, Math.max(1, parseInt(req.query?.limit ?? '10000', 10) || 10000));

    const sql = await getSql();

    // Ensure columns exist (no-op if already present)
    await sql/* sql */`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_name='items' AND column_name='category'
        ) THEN
          ALTER TABLE items ADD COLUMN category TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_name='items' AND column_name='collector_flags'
        ) THEN
          ALTER TABLE items ADD COLUMN collector_flags JSONB;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_name='items' AND column_name='rarity_score'
        ) THEN
          ALTER TABLE items ADD COLUMN rarity_score NUMERIC;
        END IF;
      END$$;
    `;

    const rows = await sql/* sql */`
      SELECT id, title
        FROM items
       WHERE (category IS NULL OR collector_flags IS NULL)
       ORDER BY id DESC
       LIMIT ${limit}
    `;

    if (!rows.length) {
      return res.status(200).json({ ok: true, scanned: 0, updated: 0, rejected: 0, note: 'Nothing to backfill.' });
    }

    let updated = 0;
    let rejected = 0;

    await sql`BEGIN`;
    try {
      for (const r of rows) {
        const [maybe] = tagAndFilter([{ title: r.title }]);
        if (!maybe) { rejected++; continue; }
        await sql/* sql */`
          UPDATE items
             SET category = ${maybe.category},
                 collector_flags = ${JSON.stringify(maybe.collector_flags)},
                 rarity_score = ${maybe.rarity_score},
                 updated_at = NOW()
           WHERE id = ${r.id}
        `;
        updated++;
      }
      await sql`COMMIT`;
    } catch (e) {
      await sql`ROLLBACK`;
      throw e;
    }

    return res.status(200).json({ ok: true, scanned: rows.length, updated, rejected });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'backfill failed' });
  }
}
