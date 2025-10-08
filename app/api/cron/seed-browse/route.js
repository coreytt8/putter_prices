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

/* ---------- collector tokens (inline to keep JS-only) ---------- */
const GLOBAL_COLLECTOR_ALLOW = [
  "tour only","tour issue","tour use only","prototype","proto","one-off","1/1",
  "limited","ltd","handmade","hand-stamped","hand stamp","weld neck","welded",
  "certificate of authenticity","coa","gallery"
];

const BRAND_COLLECTOR_ALLOW = {
  "scotty cameron": ["circle t","ct","009","009m","gss","button back","jet set","masterful","timeless","tour rat","tourtype","xperimental","experimental"],
  "bettinardi": ["tour dept","tour department","hive","dass","ss303","fit face","proto","bbzero","jm"],
  "ping": ["pld limited","pld milled","wrx","anser tour","anser 2d","proto","tour issue"],
  "odyssey": ["toulon small batch","toulon garage","tour prototype","protype","odyssey works tour","tour issue"],
  "toulon": ["small batch","garage","tour issue","proto"],
  "taylormade": ["tour issue","mytp","my tp","spider limited","proto"],
  "callaway": ["tour issue","proto","limited"],
  "mizuno": ["milled tour","proto","limited"],
  "l.a.b.": ["tour issue","proto","limited","df3 limited","mez proto"],
  "evnroll": ["tour spec","proto","one-off","limited"],
  "pxg": ["prototype","tour issue","one-off","limited"],
  "sik": ["tour issue","proto","limited"],
  "swag": ["limited","proto","tour","one-off"],
  "logan olson": ["handmade","prototype","one-off","raw","black ox","tiffany"],
  "byron morgan": ["handmade","dass","ss303","proto","one-off"],
  "see more": ["proto","tour dept","tour issue","limited"],
};

function brandKeyFromSeed(s) {
  const t = (s || "").toLowerCase();
  return Object.keys(BRAND_COLLECTOR_ALLOW).find(b => t.includes(b)) || null;
}
function buildOrTermsForSeed(seedStr) {
  const brandKey = brandKeyFromSeed(seedStr);
  const brandTerms = brandKey ? BRAND_COLLECTOR_ALLOW[brandKey] : [];
  const orTerms = [...new Set([...GLOBAL_COLLECTOR_ALLOW, ...brandTerms])];
  return orTerms.map(t => `"${t}"`);
}

/* ---------- models source: file(s) or fallback ---------- */
async function readSeedFile(fileName = "seed-models.txt") {
  const filePath = path.join(process.cwd(), "data", fileName);
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
async function seedOne({ base, adminKey, model, limit, pages, collector }) {
  const attempts = [];
  let last = null;

  // When collector mode is on, append an OR-suffix of high-signal terms.
  const suffix = collector ? ` (${buildOrTermsForSeed(model).join(" OR ")})` : "";
  const modelWithSuffix = `${model}${suffix}`;

  const url = new URL(`${base}/api/admin/fetch-browse`);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("model", modelWithSuffix);
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
    model: json?.model ?? modelWithSuffix,
    saw: json?.saw ?? 0,
    inserted: json?.inserted ?? 0,
    usedUrl: json?.usedUrl ?? "",
    error: json?.error || null,
  };
  attempts.push(last);

  const ok = attempts.every((a) => a.ok);
  const saw = attempts.reduce((n, a) => n + (a.saw || 0), 0);
  const inserted = attempts.reduce((n, a) => n + (a.inserted || 0), 0);
  const usedUrl = attempts.find((a) => a.usedUrl)?.usedUrl || "";

  return { model: modelWithSuffix, ok, saw, inserted, usedUrl, attempts };
}

/* ---------- main handler with time budget & resume cursor ---------- */
async function run(req) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const base = normalizeBase(searchParams.get("base"), req.nextUrl.origin);

  const collector = searchParams.get("collector") === "1"; // NEW

  // knobs
  const useFile = searchParams.get("useFile") === "1";
  const offset = Math.max(0, Number(searchParams.get("offset") || "0"));
  const count = Math.max(1, Number(searchParams.get("count") || "8"));
  const limit = Math.max(10, Number(searchParams.get("limit") || "40"));
  const pages = Math.max(1, Number(searchParams.get("pages") || "1"));
  const budgetMs = Math.max(5000, Number(searchParams.get("budgetMs") || "45000"));

  // admin key header for /api/admin/fetch-browse
  const adminKey = process.env.ADMIN_KEY || process.env.CRON_SECRET;
  if (!adminKey) {
    return NextResponse.json({ ok: false, error: "missing ADMIN_KEY/CRON_SECRET" }, { status: 500 });
  }

  // load models (prefer collector seed file if present & collector=1)
  let allModels = FALLBACK_MODELS;
  let fromFile = false;
  try {
    if (collector) {
      // try seed-collector.txt; if missing, fall back to seed-models.txt; else fallback models
      try {
        allModels = await readSeedFile("seed-collector.txt");
        fromFile = true;
      } catch {
        allModels = useFile ? await readSeedFile("seed-models.txt") : FALLBACK_MODELS;
        fromFile = useFile;
      }
    } else if (useFile) {
      allModels = await readSeedFile("seed-models.txt");
      fromFile = true;
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: `seed file read failed: ${e.message}` }, { status: 500 });
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
      const r = await seedOne({ base, adminKey, model, limit, pages, collector });
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

  let resume = null;
  if (nextOffset !== null && nextOffset < total) {
    const u = new URL(req.url);
    u.searchParams.set("offset", String(nextOffset));
    u.searchParams.set("count", String(count));
    u.searchParams.set("limit", String(limit));
    u.searchParams.set("pages", String(pages));
    u.searchParams.set("budgetMs", String(budgetMs));
    if (collector) u.searchParams.set("collector", "1");
    resume = u.toString();
  }

  return NextResponse.json({
    ok: true,
    base,
    usedFile: fromFile,
    collector,
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
