// pages/api/cron/nightly.js
// Nightly runner (Pages Router) that:
// 1) Calls /api/cron/seed-browse in small chunks using data/seed-models.txt
// 2) Stays under Vercel’s 60s cap by using a time budget + resume cursor
// 3) Triggers /api/admin/aggregate at the end
// 4) Precomputes and caches Top Deals (fast=1) for instant homepage reads

export const config = {
  api: { bodyParser: false },
};

function okAuth(req) {
  const secret = req.query?.secret || req.headers["x-cron-secret"];
  return !!process.env.CRON_SECRET && secret === process.env.CRON_SECRET;
}

function normalizeBase(input, req) {
  const fallback =
    (req.headers["x-forwarded-proto"] || "https") +
    "://" +
    (req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000");

  let raw =
    (input ??
      process.env.NEXT_PUBLIC_SITE_URL ??
      process.env.NEXT_PUBLIC_BASE_URL ??
      process.env.VERCEL_URL ??
      fallback) + "";

  raw = raw.trim();
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw);
    return `${u.protocol}//${u.host}`.replace(/\/+$/, "");
  } catch {
    return fallback.replace(/\/+$/, "");
  }
}

async function callSeed({ base, secret, offset, count, limit, pages, budgetMs }) {
  const url = new URL(`${base}/api/cron/seed-browse`);
  url.searchParams.set("secret", secret);
  url.searchParams.set("useFile", "1");
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("count", String(count));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("pages", String(pages));
  url.searchParams.set("budgetMs", String(budgetMs));
  const res = await fetch(url.toString(), { method: "POST" });
  let json = {};
  try { json = await res.json(); } catch { json = { ok: false, error: `non-JSON (${res.status})` }; }
  return json;
}

async function callRefresh(base, secret) {
  try {
    const url = new URL(`${base}/api/cron/collect-prices`);
    url.searchParams.set("key", secret);
    url.searchParams.set("mode", "refresh");
    url.searchParams.set("limit", "400");
    const res = await fetch(url.toString());
    return await res.json().catch(() => ({ ok: false }));
  } catch (e) { return { ok: false, error: String(e) }; }
}

async function callBackfill(base, adminKey) {
  try {
    const url = new URL(`${base}/api/admin/backfill-variants`);
    url.searchParams.set("sinceDays", "365");
    url.searchParams.set("limit", "10000");
    const res = await fetch(url.toString(), { method: "POST", headers: { "x-admin-key": adminKey } });
    return await res.json().catch(() => ({ ok: false }));
  } catch (e) { return { ok: false, error: String(e) }; }
}

async function callAggregates(base, secret) {
  try {
    const aurl = new URL(`${base}/api/admin/aggregate`);
    aurl.searchParams.set("secret", secret);
    const res = await fetch(aurl.toString(), { method: "GET" });
    const json = await res.json().catch(() => ({ ok: false, error: `non-JSON (${res.status})` }));
    return json;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// NEW: precompute Top Deals and write cache
async function computeTopDealsCache(base, secret) {
  try {
    const url = new URL(`${base}/api/top-deals`);
    url.searchParams.set('fast', '1');        // fast path for Hobby
    url.searchParams.set('cache', '0');       // compute fresh
    url.searchParams.set('cacheWrite', '1');  // ask API to upsert cache
    const res = await fetch(url.toString(), { headers: { 'x-cron-secret': secret } });
    const json = await res.json().catch(() => ({ ok: false }));
    return json;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export default async function handler(req, res) {
  if (!okAuth(req)) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }

  const base = normalizeBase(req.query.base, req);
  const secret = process.env.CRON_SECRET;

  // knobs
  const totalBudgetMs = Math.max(10_000, Number(req.query.budgetMs ?? 55_000));
  const perRunBudget  = Math.max(5_000, Number(req.query.runBudgetMs ?? 35_000));
  const count         = Math.max(1, Number(req.query.count ?? 8));
  const limit         = Math.max(10, Number(req.query.limit ?? 40));
  const pages         = Math.max(1, Number(req.query.pages ?? 1));
  let offset          = Math.max(0, Number(req.query.offset ?? 0));

  const t0 = Date.now();
  const deadline = t0 + totalBudgetMs;

  const seedRuns = [];
  let processedTotal = 0;

  while (Date.now() + 3000 < deadline) {
    const runBudget = Math.min(perRunBudget, deadline - Date.now() - 1000);
    if (runBudget < 5000) break;

    const s = await callSeed({ base, secret, offset, count, limit, pages, budgetMs: runBudget });
    seedRuns.push(s);
    if (!s?.ok) break;

    processedTotal += s.processed ?? 0;

    if (!s.nextOffset || s.nextOffset >= (s.totalModels ?? offset + count)) break;
    offset = s.nextOffset;
  }

  // After seeding: refresh → backfill → aggregate → build cache
  const refresh        = await callRefresh(base, process.env.CRON_SECRET || "");
  const backfill       = await callBackfill(base, process.env.ADMIN_KEY || "");
  const aggregateResult= await callAggregates(base, process.env.ADMIN_SECRET || "");
  const cacheUpdate    = await computeTopDealsCache(base, secret);

  res.json({
    ok: true,
    base,
    totalBudgetMs,
    count,
    limit,
    pages,
    startOffset: Number(req.query.offset ?? 0),
    endOffset: offset,
    seedRuns,
    refresh,
    backfill,
    aggregate: aggregateResult,
    topDealsCache: cacheUpdate,
  });
}
