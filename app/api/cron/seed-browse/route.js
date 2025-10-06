// app/api/cron/seed-browse/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";

/** Default seed set (used if ?models= isn’t provided) */
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
    // last resort
    return (fallbackOrigin || "http://localhost:3000").replace(/\/+$/, "");
  }
}

function authorized(req) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("secret");
  const secret = process.env.CRON_SECRET;
  return !!secret && q === secret;
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

  // If the admin endpoint returns HTML (e.g. 401 page), avoid throwing on JSON parse
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

function parseModelsParam(searchParams) {
  const raw = searchParams.get("models");
  if (!raw) return null;
  // Allow comma-separated or pipe separated lists
  return raw
    .split(/[|,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function GET(req) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const base = normalizeBase(searchParams.get("base"), req.nextUrl.origin);

  // Controls
  const limit = Number(searchParams.get("limit") || "50");
  const pages = Number(searchParams.get("pages") || "1");
  const adminKey = process.env.ADMIN_KEY || process.env.CRON_SECRET;

  // Allow overriding which models to seed via ?models=...
  const models = parseModelsParam(searchParams) || DEFAULT_MODELS;

  let totalSaw = 0;
  let totalInserted = 0;
  const results = [];

  for (const m of models) {
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
    count: results.length,
    totals: { saw: totalSaw, inserted: totalInserted },
    results,
  });
}

// Allow POST too (Vercel cron sometimes uses GET; making both work is convenient)
export async function POST(req) {
  return GET(req);
}
