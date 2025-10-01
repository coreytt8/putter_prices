// scripts/backfill-canonicalize-models.js
import { sql } from "@vercel/postgres"; // or use your neon client
import { normalizeModelKey } from "../lib/normalize.js";

async function main() {
  console.log("Fetching distinct models...");
  const { rows } = await sql`SELECT DISTINCT model FROM listing_snapshots`;
  let updates = 0;

  for (const { model } of rows) {
    const canon = normalizeModelKey(model || "");
    if (!canon || canon === model) continue;

    // Update both snapshots and lifecycle so future queries align
    console.log(`Updating '${model}' -> '${canon}'`);
    await sql`UPDATE listing_snapshots SET model = ${canon} WHERE model = ${model}`;
    await sql`UPDATE listing_lifecycle SET model = ${canon} WHERE model = ${model}`;
    updates++;
  }

  console.log(`Done. Updated ${updates} model groups.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
