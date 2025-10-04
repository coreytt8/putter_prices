// pages/api/admin/backfill-variants.js
export const runtime = "nodejs";

import { getSql } from "../../../lib/db";
import { normalizeModelKey } from "../../../lib/normalize";
import { detectVariantTags, buildVariantKey } from "../../../lib/variant-detect";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "method not allowed" });
    }

    const ADMIN = process.env.ADMIN_KEY || "12qwaszx!@QWASZX";
    const headerKey = String(req.headers["x-admin-key"] || "");
    if (headerKey !== ADMIN) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    // Inputs
    const onlyModelRaw = String(req.query.onlyModel || req.query.model || "").trim();
    const dryRun = /^(1|true|yes)$/i.test(String(req.query.dryRun || req.query.dryrun || ""));
    const limit = Math.min(Number(req.query.limit || 2000), 10000);
    const sinceDays = Math.min(Number(req.query.sinceDays || 3650), 3650);

    if (!onlyModelRaw) {
      // We no longer read any seed file; require the caller to pass onlyModel
      return res.status(400).json({ ok: false, error: "missing onlyModel" });
    }

    const baseKey = normalizeModelKey(onlyModelRaw); // e.g. "spider tour"
    const sql = getSql();

    // Time window
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

    // Title match pattern (against listing_snapshots.model which stores the raw-ish title text)
    const likePattern = `%${onlyModelRaw.replace(/\s+/g, "%")}%`;

    // Pull candidate rows with empty variant_key
    const rows = await sql`
      SELECT item_id, model, variant_key, snapshot_ts
      FROM listing_snapshots
      WHERE (variant_key IS NULL OR variant_key = '')
        AND model ILIKE ${likePattern}
        AND snapshot_ts >= ${since}
      ORDER BY snapshot_ts DESC
      LIMIT ${limit}
    `;

    let updated = 0;
    const attempts = [];

    for (const r of rows) {
      const tags = detectVariantTags(r.model || "");
      if (!tags || tags.length === 0) continue;

      const vkey = buildVariantKey(baseKey, tags);
      if (!vkey) continue;

      attempts.push({ item_id: r.item_id, tags, vkey });

      if (!dryRun) {
        await sql`
          UPDATE listing_snapshots
          SET variant_key = ${vkey}
          WHERE item_id = ${r.item_id}
            AND (variant_key IS NULL OR variant_key = '')
        `;
        updated++;
      }
    }

    return res.status(200).json({
      ok: true,
      onlyModel: onlyModelRaw,
      baseKey,
      scanned: rows.length,
      updated,
      dryRun,
      sample: attempts[0] || null,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}
