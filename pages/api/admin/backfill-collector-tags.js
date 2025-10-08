// pages/api/admin/backfill-collector-tags.js
import { tagAndFilter } from "@/lib/collector/tagAndFilter.js";
import { sql, updateItemCollectorFields } from "@/lib/db.js"; // adapt to your db layer

export default async function handler(req, res) {
  try {
    const { limit = "10000" } = req.query;
    // TODO: protect with admin key header

    const rows = await sql/* sql */`
      SELECT id, title
      FROM items
      WHERE (category IS NULL OR collector_flags IS NULL)
      ORDER BY id DESC
      LIMIT ${Number(limit)}
    `;

    let updated = 0, rejected = 0;
    for (const r of rows) {
      const [maybe] = tagAndFilter([r]);
      if (!maybe) { rejected++; continue; }
      await updateItemCollectorFields({
        id: r.id,
        category: maybe.category,
        collector_flags: JSON.stringify(maybe.collector_flags),
        rarity_score: maybe.rarity_score
      });
      updated++;
    }

    res.status(200).json({ ok: true, scanned: rows.length, updated, rejected });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e?.message || "backfill failed" });
  }
}
