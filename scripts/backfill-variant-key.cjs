// scripts/backfill-variant-key-auto.cjs
// Auto-detects column names in sold_transactions and backfills variant_key
// Usage (PowerShell):
//   $env:DATABASE_URL="postgres://..." ; node scripts/backfill-variant-key-auto.cjs --dry
// Usage (Git Bash/macOS/Linux):
//   DATABASE_URL="postgres://..." node scripts/backfill-variant-key-auto.cjs --dry
//
// Remove --dry to write updates.

const { Pool } = require("pg");
const { detectVariantSignals, buildVariantKey } = require("../lib/variant-detect.cjs");

const DRY_RUN = process.argv.includes("--dry");
const TABLE = process.env.SOLD_TABLE || "sold_transactions";

// preferred candidates in priority order
const CANDIDATES = {
  id: ["id", "pk", "sold_id"],
  model: ["model", "model_normalized", "model_name"],
  title: ["title", "listing_title", "name", "raw_title", "headline"],
  aspects: ["item_specifics", "aspects", "item_specifics_json", "specifics_json"],
  variant_key: ["variant_key", "variant", "variantid", "variant_key_text"],
};

function pickColumn(available, names) {
  for (const n of names) if (available.has(n)) return n;
  return null;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Missing DATABASE_URL (your Neon connection string).");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    // 1) Discover columns
    const colsRes = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
      [TABLE]
    );
    const available = new Set(colsRes.rows.map(r => r.column_name));

    const col = {
      id: pickColumn(available, CANDIDATES.id),
      model: pickColumn(available, CANDIDATES.model),
      title: pickColumn(available, CANDIDATES.title),    // can be null
      aspects: pickColumn(available, CANDIDATES.aspects),// can be null
      variant_key: pickColumn(available, CANDIDATES.variant_key),
    };

    // Hard requirements
    if (!col.id || !col.model || !col.variant_key) {
      console.error("Required columns not found. Need at least: id, model, variant_key");
      console.error("Available columns:", Array.from(available).sort().join(", "));
      process.exit(1);
    }

    console.log("Using column mapping:", col);

    // 2) Build dynamic SELECT (only reference columns that exist!)
    const selectFields = [
      `"${col.id}" AS id`,
      `"${col.model}" AS model`,
      col.title ? `"${col.title}" AS title` : `'' AS title`,
      col.aspects ? `"${col.aspects}" AS aspects` : `'{}'::jsonb AS aspects`,
      `COALESCE("${col.variant_key}", '') AS variant_key`,
    ].join(", ");

    const sql = `
      SELECT ${selectFields}
      FROM ${TABLE}
      WHERE COALESCE("${col.variant_key}", '') = ''
      ORDER BY "${col.id}"
      LIMIT 5000
    `;

    const res = await client.query(sql);
    if (res.rowCount === 0) {
      console.log("No rows need backfilling (variant_key already set).");
      return;
    }

    // 3) Update each row
    let updated = 0;
    for (const row of res.rows) {
      const tags = detectVariantSignals({ title: row.title || "", aspects: row.aspects || {} });
      const vk = buildVariantKey(row.model, tags) || "";
      if (!vk) continue;

      if (DRY_RUN) {
        console.log(`[DRY] id=${row.id} model="${row.model}" tags=${tags.join(",")} -> variant_key="${vk}"`);
        updated++;
      } else {
        await client.query(
          `UPDATE ${TABLE} SET "${col.variant_key}" = $1 WHERE "${col.id}" = $2`,
          [vk, row.id]
        );
        updated++;
      }
    }

    console.log(`${DRY_RUN ? "[DRY]" : ""} Updated ${updated} rows with non-empty variant_key.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
