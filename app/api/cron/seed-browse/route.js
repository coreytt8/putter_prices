// app/api/cron/seed-browse/route.js
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from "next/server";

const MODELS = [
  "Scotty Cameron Newport 2",
  "Scotty Cameron Squareback 2",
  "Odyssey White Hot OG Rossie",
  "TaylorMade Spider Tour",
  "Ping Anser",
];

function siteBase(req) {
  // prod vercel url or localhost
  const host = process.env.NEXT_PUBLIC_SITE_URL
    || process.env.VERCEL_URL
    || req.headers.get("host")
    || "localhost:3000";
  const proto = host.includes("localhost") ? "http" : "https";
  return `${proto}://${host}`;
}

function authorized(req) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("secret");
  return !!process.env.CRON_SECRET && q === process.env.CRON_SECRET;
}

async function seedOne(base, adminKey, model, limit = 100) {
  const url = `${base}/api/admin/fetch-browse?limit=${limit}&model=${encodeURIComponent(model)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "X-ADMIN-KEY": adminKey },
  });
  const json = await res.json().catch(() => ({}));
  return { model, ok: !!json?.ok, saw: json?.saw ?? 0, inserted: json?.inserted ?? 0, usedUrl: json?.usedUrl ?? "" };
}

export async function GET(req) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const base = siteBase(req);
  const adminKey = process.env.ADMIN_KEY || process.env.CRON_SECRET;

  const results = [];
  for (const m of MODELS) {
    try {
      const r = await seedOne(base, adminKey, m, 120);
      results.push(r);
    } catch (e) {
      results.push({ model: m, ok: false, error: e.message });
    }
  }
  return NextResponse.json({ ok: true, base, results });
}

// Allow POST too (Vercel cron sometimes uses GET; making both work is convenient)
export async function POST(req) {
  return GET(req);
}
