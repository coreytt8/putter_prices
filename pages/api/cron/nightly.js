// pages/api/cron/nightly.js
export const config = { api: { bodyParser: false } };

import fs from "node:fs";
import path from "node:path";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function resolveBaseUrl(req) {
  // Prefer explicit base, then Vercel URL, then request host, then fallback
  const envBase =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.SITE_BASE_URL ||
    process.env.VERCEL_URL;
  if (envBase) {
    return envBase.startsWith("http") ? envBase : `https://${envBase}`;
  }
  const host = req?.headers?.host;
  return host ? `http://${host}` : "http://localhost:3000";
}

function loadSeedModels() {
  // Try repo path (works on Vercel + local)
  const p = path.join(process.cwd(), "data", "seed-models.txt");
  if (fs.existsSync(p)) {
    const raw = fs.readFileSync(p, "utf8");
    return raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  // Fallback small set so the function still runs
  return [
    "Scotty Cameron Newport 2",
    "TaylorMade Spider Tour",
    "Ping Anser",
    "Odyssey White Hot OG Rossie",
  ];
}

export default async function handler(req, res) {
  try {
    // Simple auth
    const secret = String(req.query.secret || "");
    if (!secret || secret !== process.env.CRON_SECRET) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const base = resolveBaseUrl(req);
    const adminKey = process.env.ADMIN_KEY || process.env.ADMIN_SECRET;
    if (!adminKey) {
      return res
        .status(500)
        .json({ ok: false, error: "missing ADMIN_KEY/ADMIN_SECRET env" });
    }

    // Tunables via query (optional)
    const pages = Math.max(1, Number(req.query.pages || 2));
    const limit = Math.max(10, Number(req.query.limit || 50));
    const pause = Math.max(200, Number(req.query.pause || 1200));
    const debug = String(req.query.debug || "") === "1";

    const models = loadSeedModels();
    const results = [];

    // Seed loop — fetch multiple pages per model
    for (const model of models) {
      const perModel = { model, pagesTried: 0, saw: 0, inserted: 0, attempts: [] };

      for (let p = 0; p < pages; p++) {
        perModel.pagesTried++;
        const url = `${base}/api/admin/fetch-browse?limit=${limit}&model=${encodeURIComponent(
          model
        )}&page=${p + 1}`;
        const r = await fetch(url, {
          method: "POST",
          headers: { "X-ADMIN-KEY": adminKey },
          body: "", // POST body not used; just to avoid 405 on some configs
        });

        const text = await r.text();
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          if (debug) perModel.attempts.push({ url, status: r.status, badJson: text?.slice(0, 200) });
          continue;
        }

        if (debug) perModel.attempts.push({ url, status: r.status, usedUrl: json.usedUrl || "" });
        if (json?.ok) {
          perModel.saw += Number(json.saw || 0);
          perModel.inserted += Number(json.inserted || 0);
        }

        // Gentle pause to avoid hammering the origin
        await sleep(pause);
      }

      results.push(perModel);
    }

    // Aggregate after seeding
    const aggUrl = `${base}/api/admin/aggregate?secret=${encodeURIComponent(secret)}`;
    const aggRes = await fetch(aggUrl);
    let aggregates = {};
    try {
      aggregates = await aggRes.json();
    } catch {
      aggregates = { ok: false, error: "aggregate returned non-JSON" };
    }

    return res.status(200).json({
      ok: true,
      base,
      pages,
      limit,
      pause,
      seeded: results,
      aggregates,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
