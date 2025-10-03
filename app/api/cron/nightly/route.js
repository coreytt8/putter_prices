// app/api/cron/nightly/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";

// 🔑 Auth: pass ?secret=<CRON_SECRET> to this route (same secret used below)
function authorized(req) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("secret");
  return !!process.env.CRON_SECRET && q === process.env.CRON_SECRET;
}

// Figure out your own base URL (works on localhost & Vercel)
function siteBase(req) {
  const host =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.VERCEL_URL ||
    req.headers.get("host") ||
    "localhost:3000";
  const proto = host.includes("localhost") ? "http" : "https";
  return `${proto}://${host}`;
}

// Models to seed nightly (tune this anytime)
const MODELS = [
  "Scotty Cameron Newport 2",
  "Scotty Cameron Squareback 2",
  "Odyssey White Hot OG Rossie",
  "TaylorMade Spider Tour",
  "Ping Anser",
];

// Seed one model via your internal admin fetch-browse endpoint
async function seedOne(base, adminKey, model, limit = 120) {
  const url = `${base}/api/admin/fetch-browse?limit=${limit}&model=${encodeURIComponent(
    model
  )}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "X-ADMIN-KEY": adminKey },
  });

  let json = null;
  try {
    json = await res.json();
  } catch (_) {
    json = { ok: false, error: `non-JSON (${res.status})` };
  }

  if (!json?.ok) {
    return { model, ok: false, error: json?.error || `HTTP ${res.status}` };
  }
  return {
    model,
    ok: true,
    saw: json.saw ?? 0,
    inserted: json.inserted ?? 0,
    usedUrl: json.usedUrl || "",
  };
}

// Roll up 60/90/180 aggregates
async function runAggregate(base) {
  const url = `${base}/api/admin/aggregate?secret=${encodeURIComponent(
    process.env.CRON_SECRET
  )}`;
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  return json;
}

async function runNightly(req) {
  const base = siteBase(req);

  // Use ADMIN_KEY if set, otherwise fall back to CRON_SECRET
  const adminKey = process.env.ADMIN_KEY || process.env.CRON_SECRET || "";

  const seedResults = [];
  for (const m of MODELS) {
    try {
      const r = await seedOne(base, adminKey, m);
      seedResults.push(r);
    } catch (e) {
      seedResults.push({ model: m, ok: false, error: e.message });
    }
  }

  const aggregate = await runAggregate(base);
  return { ok: true, base, seedResults, aggregate };
}

export async function GET(req) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const out = await runNightly(req);
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req) {
  // Allow POST too
  return GET(req);
}
