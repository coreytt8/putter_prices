// scripts/backfill-variant-from-column.cjs
// Uses sold_transactions.(model, variant) to fill variant_key when empty.
// Usage (PowerShell):
//   $env:DATABASE_URL="postgres://..." ; node scripts/backfill-variant-from-column.cjs --dry
// Then remove --dry to write changes.

const { Pool } = require("pg");

const DRY_RUN = process.argv.includes("--dry");
const TABLE = "sold_transactions"; // your table

function normalizeVariantToTags(variantText = "") {
  const t = String(variantText || "").toLowerCase();

  // Split on commas / pipes / slashes / spaces; keep words that are meaningful.
  // You can adjust this mapping to your data.
  let raw = t
    .replace(/[^a-z0-9\s\-_/|,]+/g, " ")
    .split(/[,/|]+/g) // first split on separators
    .flatMap(s => s.trim().split(/\s+/g)) // then words
    .filter(Boolean);

  const tags = new Set();

  // Map keywords to stable tags
  const addIf = (cond, tag) => { if (cond) tags.add(tag); };

  const str = raw.join(" ");

  // brand-agnostic / premium
  addIf(/tour only|tour use only|tour issue/.test(str), "tour_only");
  addIf(/limited|small batch/.test(str), "limited");
  addIf(/prototype|proto/.test(str), "prototype");
  addIf(/welded/.test(str), "welded_neck");
  addIf(/\bgss\b|german stainless/.test(str), "gss");

  // Scotty Cameron
  addIf(/circle[\s-]*t|\bct\b|tour dot|circle-t/.test(str), "circle_t");
  addIf(/\b009\b|\b009m\b/.test(str), "009");
  addIf(/timeless/.test(str), "timeless");
  addIf(/masterful/.test(str), "masterful");
  addIf(/super rat/.test(str), "super_rat");
  addIf(/tei3|teryllium/.test(str), "tei3");
  addIf(/button back/.test(str), "button_back");
  addIf(/jet set/.test(str), "jet_set");
  addIf(/cherry bomb/.test(str), "tour_stamp");
  addIf(/\bcoa\b|certificate/.test(str), "coa");

  // Ping
  addIf(/anser proto/.test(str), "prototype");
  addIf(/\bpld\b|vault/.test(str), "limited");

  // Odyssey
  addIf(/tour department/.test(str), "tour_only");

  // Also keep the original tokens if you want a loose capture:
  // raw.forEach(w => { if (w.length >= 3) tags.add(w); });

  return Array.from(tags);
}

function buildVariantKey(model, tags = []) {
  if (!model) return "";
  if (!tags.length) return "";
  const sorted = [...new Set(tags)].sort();
  return `${String(model).toLowerCase()}|${sorted.join("|")}`;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Missing DATABASE_URL (your Neon connection string).");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    // Grab rows that need variant_key
    const res = await client.query(`
      SELECT id, model, variant, COALESCE(variant_key,'') AS variant_key
      FROM ${TABLE}
      WHERE COALESCE(variant_key,'') = ''
      ORDER BY id
      LIMIT 5000
    `);

    if (res.rowCount === 0) {
      console.log("No rows need backfilling (variant_key already set or no rows).");
      return;
    }

    let updated = 0;
    for (const row of res.rows) {
      const tags = normalizeVariantToTags(row.variant || "");
      const vk = buildVariantKey(row.model, tags) || "";
      if (!vk) continue;

      if (DRY_RUN) {
        console.log(`[DRY] id=${row.id} model="${row.model}" variant="${row.variant}" -> variant_key="${vk}"`);
        updated++;
      } else {
        await client.query(
          `UPDATE ${TABLE} SET variant_key = $1 WHERE id = $2`,
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
