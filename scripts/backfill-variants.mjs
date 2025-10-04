#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { getSql } from "../lib/db.js";
import { normalizeModelKey } from "../lib/normalize.js";
import { detectVariantTags, buildVariantKey } from "../lib/variant-detect.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    file: "data/seed-models.txt", // list of tracked models (one per line)
    sinceDays: 3650, // lookback window (default ~all time)
    limitPerModel: 2000, // safety cap per model to update
    onlyModel: null, // restrict to one model label (optional)
    dryRun: false, // if true, no DB updates
    verbose: true,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--file") opts.file = args[++i];
    else if (a === "--sinceDays") opts.sinceDays = Number(args[++i]);
    else if (a === "--limit") opts.limitPerModel = Number(args[++i]);
    else if (a === "--onlyModel") opts.onlyModel = args[++i];
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--quiet") opts.verbose = false;
  }
  return opts;
}

// Collapse child lines to their parent "base" model (helps cluster variants)
const FAMILY_CANON = new Map([
  ["spider tour x", "spider tour"],
  ["spider tour v", "spider tour"],
  ["spider tour z", "spider tour"],
  // Add more child→parent collapses here if desired
]);

function collapseToParent(modelKey) {
  return FAMILY_CANON.get(modelKey) || modelKey;
}

async function readSeed(file) {
  const raw = await fs.readFile(path.resolve(__dirname, "..", file), "utf8");
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("#"));
}

function wildcardFromSeed(label) {
  // Very loose: require at least two tokens to reduce scan size
  const tokens = label.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    return `%${tokens[0]}%${tokens[1]}%`;
  }
  return `%${tokens[0]}%`;
}

async function main() {
  const opts = parseArgs();
  const sql = getSql();

  const seedLabels = await readSeed(opts.file);
  const targets = opts.onlyModel
    ? seedLabels.filter((s) => s.toLowerCase() === opts.onlyModel.toLowerCase())
    : seedLabels;

  const sinceDate = new Date(Date.now() - opts.sinceDays * 24 * 3600 * 1000);

  let totalUpd = 0;
  for (const label of targets) {
    // Canonical base key (what we want to store in snapshot.model)
    const requestedKey = normalizeModelKey(label);
    const baseKey = collapseToParent(requestedKey);

    // Rough DB filter to avoid scanning the world; final check is JS normalize
    const like = wildcardFromSeed(label);

    if (opts.verbose) {
      console.log(`→ Backfilling variants for "${label}" (base="${baseKey}")`);
    }

    // Candidates: empty variant_key and recent enough and roughly match label
    const rows = await sql`
      SELECT item_id, snapshot_day, model
      FROM listing_snapshots
      WHERE COALESCE(variant_key,'') = ''
        AND snapshot_day >= ${sinceDate}
        AND lower(model) LIKE ${like}
      LIMIT ${opts.limitPerModel}
    `;

    if (!rows.length) {
      if (opts.verbose) console.log("   no candidates");
      continue;
    }

    // Compute updates
    const updates = [];
    for (const r of rows) {
      const rawModel = String(r.model || "");
      const norm = normalizeModelKey(rawModel);
      const collapsed = collapseToParent(norm);

      if (collapsed !== baseKey) continue; // ensure we only touch this family

      const tags = detectVariantTags(rawModel);
      if (!tags || tags.length === 0) continue;

      const vk = buildVariantKey(baseKey, tags);
      if (!vk) continue;

      updates.push({
        item_id: r.item_id,
        snapshot_day: r.snapshot_day,
        new_model: baseKey,
        variant_key: vk,
      });
    }

    if (!updates.length) {
      if (opts.verbose) console.log("   nothing to tag");
      continue;
    }

    if (opts.dryRun) {
      console.log(`   would update ${updates.length} snapshots`);
    } else {
      // Batch UPDATEs
      let applied = 0;
      for (const u of updates) {
        const res = await sql`
          UPDATE listing_snapshots
          SET model = ${u.new_model}, variant_key = ${u.variant_key}
          WHERE item_id = ${u.item_id}
            AND snapshot_day = ${u.snapshot_day}
            AND COALESCE(variant_key,'') = ''
        `;
        applied += res.count || 0;
      }
      totalUpd += applied;
      if (opts.verbose) console.log(`   updated ${applied} snapshots`);

      // Recompute 60/90/180 aggregates for this base
      await sql`
        WITH windows AS (SELECT unnest(ARRAY[60,90,180])::int AS w),
        base AS (
          SELECT s.model,
                 COALESCE(s.variant_key,'') AS variant_key,
                 s.condition_band,
                 w.w AS window_days,
                 COUNT(*)::int AS n,
                 PERCENTILE_CONT(0.10) WITHIN GROUP (ORDER BY s.total_cents) AS p10,
                 PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY s.total_cents) AS p50,
                 PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY s.total_cents) AS p90
          FROM listing_snapshots s
          JOIN windows w ON s.snapshot_day >= (CURRENT_DATE - (w.w || ' days')::interval)
          WHERE s.model = ${baseKey}
          GROUP BY s.model, COALESCE(s.variant_key,''), s.condition_band, w.w
        )
        INSERT INTO aggregated_stats_variant
          (model, variant_key, condition_band, window_days, n, p10_cents, p50_cents, p90_cents, dispersion_ratio, updated_at)
        SELECT
          b.model, b.variant_key, b.condition_band, b.window_days, b.n,
          ROUND(b.p10)::int, ROUND(b.p50)::int, ROUND(b.p90)::int,
          CASE WHEN b.p50 > 0 THEN LEAST(5.0, GREATEST(0.1, (b.p90 - b.p10) / NULLIF(b.p50,0))) END,
          NOW()
        FROM base b
        ON CONFLICT (model, variant_key, condition_band, window_days)
        DO UPDATE
          SET n = EXCLUDED.n,
              p10_cents = EXCLUDED.p10_cents,
              p50_cents = EXCLUDED.p50_cents,
              p90_cents = EXCLUDED.p90_cents,
              dispersion_ratio = EXCLUDED.dispersion_ratio,
              updated_at = EXCLUDED.updated_at
      `;
      if (opts.verbose) console.log("   aggregates refreshed (60/90/180)");
    }
  }

  if (opts.verbose) console.log(`Done. Total snapshots updated: ${totalUpd}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
