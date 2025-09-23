// scripts/backfill-variant-key.js
// Backfills sold_transactions.variant_key using title/aspects and lib/variant-detect.js
// Usage:
//   DATABASE_URL="postgres://..." node scripts/backfill-variant-key.js [--dry]

import { Pool } from "pg";
import { detectVariantSignals, buildVariantKey } from "../lib/variant-detect.js";

const DRY_RUN = process.argv.includes("--dry");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    const rowsRes = await client.query(`
      SELECT id, model,
             title,
             CASE
               WHEN jsonb_typeof(item_specifics) IS NOT NULL THEN item_specifics
               ELSE aspects
             END AS aspects,
             COALESCE(variant_key, '') AS variant_key
      FROM sold_transactions
      WHERE COALESCE(variant_key, '') = ''
      ORDER BY id
      LIMIT 5000
    `);

    if (rowsRes.rowCount === 0) {
      console.log("No rows need backfilling (variant_key already set).");
      return;
    }

    let updated = 0;
    for (const row of rowsRes.rows) {
      const tags = detectVariantSignals({ title: row.title, aspects: row.aspects || {} });
      const vk = buildVariantKey(row.model, tags) || "";
      if (!vk) continue;

      if (DRY_RUN) {
        console.log(`[DRY] id=${row.id} model="${row.model}" tags=${tags.join(",")} -> variant_key="${vk}"`);
        updated++;
      } else {
        await client.query(
          `UPDATE sold_transactions SET variant_key = $1 WHERE id = $2`,
          [vk, row.id]
        );
        updated++;
      }
    }

    console.log(`${DRY_RUN ? "[DRY]" : ""} Updated ${updated} rows with non-empty variant_key.`);
  } finally {
    await client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
