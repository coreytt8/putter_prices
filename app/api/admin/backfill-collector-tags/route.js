// app/api/admin/backfill-collector-tags/route.js
export const runtime = 'nodejs';

import { tagAndFilter } from '../../../../lib/collector/tagAndFilter';
import { getSql } from '../../../../lib/db';

function isAuthorized(req) {
  const adminKey = req.headers.get('x-admin-key');
  const secret = process.env.CRON_SECRET || process.env.ADMIN_KEY;
  return secret && adminKey === secret;
}

export async function POST(req) {
  if (!isAuthorized(req)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(20000, Math.max(1, parseInt(searchParams.get('limit') ?? '10000', 10)));

  const sql = await getSql();

  await sql/* sql */`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='items' AND column_name='category')
        THEN ALTER TABLE items ADD COLUMN category TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='items' AND column_name='collector_flags')
        THEN ALTER TABLE items ADD COLUMN collector_flags JSONB;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='items' AND column_name='rarity_score')
        THEN ALTER TABLE items ADD COLUMN rarity_score NUMERIC;
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

  let updated = 0, rejected = 0;

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
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }

  return Response.json({ ok: true, scanned: rows.length, updated, rejected });
}
