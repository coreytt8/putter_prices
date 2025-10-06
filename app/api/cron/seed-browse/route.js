// app/api/cron/seed-browse/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

/* ---------- auth & base helpers ---------- */
function authorized(req) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("secret");
  return !!process.env.CRON_SECRET && q === process.env.CRON_SECRET;
}

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

/* ---------- models source: file or default list ---------- */
async function readSeedFile() {
  const filePath = path.join(process.cwd(), "data", "seed-models.txt");
  const text = await fs.readFile(filePath, "utf8");
  return text
    .split(/\r?\n/g)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("#"));
}

const FALLBACK_MODELS = [
  "Scotty Cameron Newport 2",
  "Scotty Cameron Squareback 2",
  "Odyssey White Hot OG Rossie",
  "TaylorMade Spider Tour",
  "Ping Anser",
];

/* ---------- worker ---------- */
async function seedOne({ base, adminKey, model, limit, pages }) {
  const attempts = [];
  let last = null;

  // loop up to `pages` pages (your /api/admin/fetch-browse should honor &pages=…;
  // if it doesn’t, we just call once)
  const url = new URL(`${base}/api/admin/fetch-browse`);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("model", model);
  url.searchParams.set("pages", String(pages));

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "X-ADMIN-KEY": adminKey },
  });

  let json = {};
  try {
    json = await res.json();
  } catch {
    json = { ok: false, error: `non-JSON (${res.status})` };
  }

  last = {
    ok: !!json?.ok,
    model: json?.model ?? model,
    saw: json?.saw ?? 0,
    inserted: json?.inserted ?? 0,
    usedUrl: json?.usedUrl ?? "",
    error: json?.error || null,
  };
  attempts.push(last);

  // summarize
  const ok = attempts.every((a) => a.ok);
  const saw = attempts.reduce((n, a) => n + (a.saw || 0), 0);
  const inserted = attempts.reduce((n, a) => n + (a.inserted || 0), 0);
  const usedUrl = attempts.find((a) => a.usedUrl)?.usedUrl || "";

  return { model, ok, saw, inserted, usedUrl, attempts };
}

/* ---------- main handler with time budget & resume cursor ---------- */
async function run(req) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const base = normalizeBase(searchParams.get("base"), req.nextUrl.origin);

  // knobs (safe defaults; override via querystring)
  const useFile = searchParams.get("useFile") === "1";
  const offset = Math.max(0, Number(searchParams.get("offset") || "0"));
  const count = Math.max(1, Number(searchParams.get("count") || "8"));   // models per call
  const limit = Math.max(10, Number(searchParams.get("limit") || "40")); // items per page
  const pages = Math.max(1, Number(searchParams.get("pages") || "1"));   // pages per model
  const budgetMs = Math.max(5000, Number(searchParams.get("budgetMs") || "45000")); // bail before 60s

  // admin key header for /api/admin/fetch-browse
  const adminKey = process.env.ADMIN_KEY || process.env.CRON_SECRET;
  if (!adminKey) {
    return NextResponse.json({ ok: false, error: "missing ADMIN_KEY/CRON_SECRET" }, { status: 500 });
  }

  // load models
  let allModels = FALLBACK_MODELS;
  let fromFile = false;
  if (useFile) {
    try {
      allModels = await readSeedFile();
      fromFile = true;
    } catch (e) {
      return NextResponse.json({ ok: false, error: `seed-models.txt read failed: ${e.message}` }, { status: 500 });
    }
  }

  const total = allModels.length;
  const slice = allModels.slice(offset, offset + count);

  const t0 = Date.now();
  const deadline = t0 + budgetMs;

  const results = [];
  let processed = 0;
  let nextOffset = null;

  for (let i = 0; i < slice.length; i++) {
    const model = slice[i];
    try {
      const r = await seedOne({ base, adminKey, model, limit, pages });
      results.push(r);
      processed++;
    } catch (e) {
      results.push({ model, ok: false, error: e.message, saw: 0, inserted: 0, attempts: [] });
      processed++;
    }

    if (Date.now() > deadline) {
      nextOffset = offset + processed;
      break;
    }
  }

  // Build a convenience "resume" URL if we're not done yet
  let resume = null;
  if (nextOffset !== null && nextOffset < total) {
    const u = new URL(req.url);
    u.searchParams.set("offset", String(nextOffset));
    u.searchParams.set("count", String(count));
    u.searchParams.set("limit", String(limit));
    u.searchParams.set("pages", String(pages));
    u.searchParams.set("budgetMs", String(budgetMs));
    resume = u.toString();
  }

  return NextResponse.json({
    ok: true,
    base,
    usedFile: fromFile,
    totalModels: total,
    offset,
    requestedCount: count,
    processed,
    nextOffset,
    resume,
    limit,
    pages,
    budgetMs,
    results,
  });
}

export async function GET(req) { return run(req); }
export async function POST(req) { return run(req); }
