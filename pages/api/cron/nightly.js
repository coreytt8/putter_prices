// pages/api/cron/nightly.js
// Nightly: seed a small, capped batch of models (multi-page optional) then aggregate,
// staying within a time budget so Vercel doesn't kill the function.
//
// Query params (all optional):
//   ?secret=...                (must match ADMIN_KEY or CRON_SECRET)
//   &mode=seed|aggregate|both  (default: both)
//   &maxModels=12              (default: env NIGHTLY_MAX_MODELS or 10)
//   &pages=1                   (default: env NIGHTLY_PAGES or 1)
//   &limit=50                  (default: env NIGHTLY_LIMIT or 50)
//   &debug=1                   (pass through to fetch-browse)
//
// Env (configure in Vercel UI):
//   ADMIN_KEY or CRON_SECRET   (same value you use for admin endpoints)
//   NEXT_PUBLIC_BASE_URL       (e.g., https://www.putteriq.com)
//   CRON_MAX_MS                (e.g., 270000 for ~4.5 minutes)
//   NIGHTLY_MAX_MODELS         (e.g., 12)
//   NIGHTLY_PAGES              (e.g., 1)
//   NIGHTLY_LIMIT              (e.g., 50)
//   SEED_MODELS_FILE           (default: data/seed-models.txt)

import fs from "fs/promises";
import path from "path";

const DEFAULT_TIME_BUDGET_MS = Number(process.env.CRON_MAX_MS || 270000); // ~4.5m

const DEFAULT_MODELS = [
  // Fallback list if data/seed-models.txt can't be read.
  "Scotty Cameron Newport 2",
  "Scotty Cameron Squareback 2",
  "Scotty Cameron Phantom X 5",
  "TaylorMade Spider Tour",
  "TaylorMade Spider Tour X",
  "TaylorMade Spider Tour V",
  "Ping Anser",
  "Ping PLD Anser 2",
  "Odyssey White Hot OG Rossie",
  "Odyssey Eleven",
  "Bettinardi Queen B 6",
  "LAB Golf Mezz.1"
];

function toBool(v) {
  if (v === true) return true;
  const s = String(v || "").toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function encodeModel(m) {
  return encodeURIComponent(m);
}

function nowMs() {
  return Date.now();
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method not allowed" });
  }

  const started = nowMs();
  const timeBudget = DEFAULT_TIME_BUDGET_MS;
  const stillHaveTime = () => nowMs() - started < (timeBudget - 5000);

  // Auth
  const adminKey = process.env.ADMIN_KEY || process.env.CRON_SECRET || "";
  const provided = String(req.query.secret || req.headers["x-admin-key"] || "");
  if (!adminKey || provided !== adminKey) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  // Controls
  const mode = String(req.query.mode || "both").toLowerCase(); // seed|aggregate|both
  const maxModels = Math.max(
    1,
    Number(req.query.maxModels || process.env.NIGHTLY_MAX_MODELS || 10)
  );
  const pages = Math.max(
    1,
    Number(req.query.pages || process.env.NIGHTLY_PAGES || 1)
  );
  const limit = Math.max(
    1,
    Number(req.query.limit || process.env.NIGHTLY_LIMIT || 50)
  );
  const debug = toBool(req.query.debug);

  // Base URL for internal calls
  const inferredBase =
    (req.headers["x-forwarded-proto"] && req.headers.host)
      ? `${req.headers["x-forwarded-proto"]}://${req.headers.host}`
      : `http://${req.headers.host}`;
  const base =
    process.env.NIGHTLY_BASE ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    inferredBase;

  // Read seed list (fallback to DEFAULT_MODELS)
  const listFile = process.env.SEED_MODELS_FILE || "data/seed-models.txt";
  let allModels = DEFAULT_MODELS;
  try {
    const txt = await fs.readFile(path.resolve(process.cwd(), listFile), "utf8");
    allModels = txt
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    // noop: fallback stays
  }

  const picked = allModels.slice(0, maxModels);

  async function fetchJSON(url, opts = {}) {
    const r = await fetch(url, opts);
    const text = await r.text();
    try {
      return { ok: r.ok, status: r.status, json: JSON.parse(text) };
    } catch {
      return { ok: false, status: r.status, error: "non-JSON", text };
    }
  }

  // Seed a small batch
  const seedResults = [];
  if (mode === "seed" || mode === "both") {
    for (const model of picked) {
      if (!stillHaveTime()) break;
      const enc = encodeModel(model);
      const url =
        `${base}/api/admin/fetch-browse?model=${enc}` +
        `&limit=${limit}&pages=${pages}` +
        (debug ? `&debug=1` : ``);

      // POST with admin header; empty body is fine.
      const r = await fetchJSON(url, {
        method: "POST",
        headers: { "X-ADMIN-KEY": adminKey },
        body: ""
      });

      if (r.ok) {
        const j = r.json || {};
        seedResults.push({
          model,
          ok: true,
          saw: j.saw || 0,
          inserted: j.inserted || 0,
          usedUrl: j.usedUrl || j.used_url || "",
          pages: j.pages || undefined
        });
      } else {
        seedResults.push({
          model,
          ok: false,
          status: r.status,
          error: r.error || r.text || "seed failed"
        });
      }
    }
  }

  // Aggregate (only if time left)
  let aggregate = {};
  if (stillHaveTime() && (mode === "aggregate" || mode === "both")) {
    const aggUrl = `${base}/api/admin/aggregate?secret=${encodeURIComponent(
      adminKey
    )}`;
    const r = await fetchJSON(aggUrl, { method: "GET" });
    aggregate = r.ok ? r.json : { ok: false, status: r.status, error: r.error || r.text };
  }

  return res.status(200).json({
    ok: true,
    base,
    mode,
    params: { maxModels, pages, limit, debug },
    timeUsedMs: nowMs() - started,
    seedCount: seedResults.length,
    seedResults,
    aggregate
  });
}
