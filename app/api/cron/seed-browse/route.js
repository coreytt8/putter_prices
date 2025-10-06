// app/api/cron/seed-browse/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";

// Fallback seed set if you don't pass useFile=1 or models=
const DEFAULT_MODELS = [
  "Scotty Cameron Newport 2",
  "Scotty Cameron Squareback 2",
  "Odyssey White Hot OG Rossie",
  "TaylorMade Spider Tour",
  "Ping Anser",
];

/** Resolve a clean absolute origin from env/query/req without double protocols */
function normalizeBase(input, fallbackOrigin) {
  let raw =
    (input ??
      process.env.NEXT_PUBLIC_SITE_URL ??
      process.env.NEXT_PUBLIC_BASE_URL ??
      process.env.VERCEL_URL ??
      fallbackOrigin ??
      "http://localhost:3000") + "";

  raw = raw.trim();
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw);
    return `${u.protocol}//${u.host}`.replace(/\/+$/, "");
  } catch {
    return (fallbackOrigin || "http://localhost:3000").replace(/\/+$/, "");
  }
}

function authorized(req) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("secret");
  const secret = process.env.CRON_SECRET;
  return !!secret && q === secret;
}

function parseModelsParam(searchParams) {
  const raw = searchParams.get("models");
  if (!raw) return null;
  return raw
    .split(/[|,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function loadSeedFile() {
  // route.js lives at app/api/cron/seed-browse/route.js; data/ is at repo root
  const url = new URL("../../../../data/seed-models.txt", import.meta.url);
  const txt = await readFile(url, "utf8");
  const lines = txt
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  // de-dup while preserving order
  const seen = new Set();
  const out = [];
  for (const m of lines) {
    if (!seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
  }
  return out;
}

async function seedOne(base, adminKey, model, limit = 100, pages = 1) {
  const url =
    `${base}/api/admin/fetch-browse` +
    `?limit=${Number(limit) || 50}` +
    `&model=${encodeURIComponent(model)}` +
    (pages ? `&pages=${Number(pages) || 1}` : "");

  const res = await fetch(url, {
    method: "POST",
    headers: { "X-ADMIN-KEY": adminKey },
  });

  let json = {};
  try {
    json = await res.json();
  } catch {
    json = { ok: false, error: `non-JSON (${res.status})` };
  }

  return {
    model,
    ok: !!json?.ok,
    saw: json?.saw ?? 0,
    inserted: json?.inserted ?? 0,
    pages: json?.pages ?? (pages || 1),
    usedUrl: json?.usedUrl ?? "",
    error: json?.error || null,
  };
}

export async function GET(req) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const base = normalizeBase(searchParams.get("base"), req.nextUrl.origin);
  const limit = Number(searchParams.get("limit") || "50");
  const pages = Number(searchParams.get("pages") || "1");
  const adminKey = process.env.ADMIN_KEY || process.env.CRON_SECRET;

  // Which model list to use?
  let modelsSource = "default";
  let models = parseModelsParam(searchParams);

  if (!models) {
    const useFile = searchParams.get("useFile");
    if (useFile === "1" || useFile === "true") {
      try {
        models = await loadSeedFile();
        modelsSource = "file";
      } catch (e) {
        models = DEFAULT_MODELS;
        modelsSource = "default_fallback";
      }
    }
  }
  if (!models) {
    models = DEFAULT_MODELS;
    modelsSource = "default";
  }

  // Optional slicing to stay within 60s limits
  const offset = Math.max(0, Number(searchParams.get("offset") || 0));
  const count = Math.max(1, Number(searchParams.get("count") || models.length));
  const slice = models.slice(offset, offset + count);

  let totalSaw = 0;
  let totalInserted = 0;
  const results = [];

  for (const m of slice) {
    try {
      const r = await seedOne(base, adminKey, m, limit, pages);
      totalSaw += Number(r.saw || 0);
      totalInserted += Number(r.inserted || 0);
      results.push(r);
    } catch (e) {
      results.push({ model: m, ok: false, error: e?.message || String(e) });
    }
  }

  return NextResponse.json({
    ok: true,
    base,
    limit,
    pages,
    modelsSource,
    requested: { total: models.length, offset, count },
    processed: slice.length,
    totals: { saw: totalSaw, inserted: totalInserted },
    results,
  });
}

export async function POST(req) {
  return GET(req);
}
