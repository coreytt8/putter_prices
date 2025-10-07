// Nightly runner (Pages Router) that:
// 1) Calls /api/cron/seed-browse in small chunks using data/seed-models.txt
// 2) Stays under Vercel’s 60s cap by using a time budget + resume cursor
// 3) Triggers /api/admin/aggregate at the end (using the same CRON secret)
// 4) Precomputes and caches Top Deals (fast=1) with friendly gates for instant homepage reads

export const config = {
  api: { bodyParser: false },
};

// ---- auth & base helpers ----------------------------------------------------

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

// ---- step callers -----------------------------------------------------------

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

async function callAggregates(base, cronSecret) {
  // IMPORTANT: use the SAME CRON secret as the nightly auth
  try {
    const aurl = new URL(`${base}/api/admin/aggregate`);
    aurl.searchParams.set("secret", cronSecret);
    const res = await fetch(aurl.toString(), { method: "GET" });
    const json = await res.json().catch(() => ({ ok: false, error: `non-JSON (${res.status})` }));
    return json;
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

// Precompute Top Deals and write cache (friendly defaults; override via query)
async function computeTopDealsCache(base, cronSecret, overrides = {}) {
  try {
    const {
      tdLookbackHours   = 720,   // 30 days
      tdFreshnessHours  = 72,
      tdMinSample       = 3,
      tdMinSavingsPct   = 0.10,
      tdMaxDispersion   = 6,
      tdFast            = 1,
      tdCache           = 0,
      tdCacheWrite      = 1,
    } = overrides;

    const url = new URL(`${base}/api/top-deals`);
    url.searchParams.set("fast", String(tdFast));
    url.searchParams.set("cache", String(tdCache));
    url.searchParams.set("cacheWrite", String(tdCacheWrite));
    url.searchParams.set("lookbackWindowHours", String(tdLookbackHours));
    url.searchParams.set("freshnessHours", String(tdFreshnessHours));
    url.searchParams.set("minSample", String(tdMinSample));
    url.searchParams.set("minSavingsPct", String(tdMinSavingsPct));
    url.searchParams.set("maxDispersion", String(tdMaxDispersion));

    const res = await fetch(url.toString(), { headers: { "x-cron-secret": cronSecret } });
    const json = await res.json().catch(() => ({ ok: false }));
    return json;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ---- handler ----------------------------------------------------------------

export default async function handler(req, res) {
  if (!okAuth(req)) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }

  const base = normalizeBase(req.query.base, req);
  const cronSecret = process.env.CRON_SECRET;   // single source of truth
  const adminKey   = process.env.ADMIN_KEY || "";

  // knobs (override via query if needed)
  const totalBudgetMs = Math.max(10_000, Number(req.query.budgetMs ?? 55_000));
  const perRunBudget  = Math.max(5_000,  Number(req.query.runBudgetMs ?? 35_000));
  const count         = Math.max(1,      Number(req.query.count ?? 8));
  const limit         = Math.max(10,     Number(req.query.limit ?? 40));
  const pages         = Math.max(1,      Number(req.query.pages ?? 1));
  let offset          = Math.max(0,      Number(req.query.offset ?? 0));

  // top-deals override knobs (optional)
  const tdOverrides = {
    tdLookbackHours:  req.query.tdLookbackHours   ? Number(req.query.tdLookbackHours)   : undefined,
    tdFreshnessHours: req.query.tdFreshnessHours  ? Number(req.query.tdFreshnessHours)  : undefined,
    tdMinSample:      req.query.tdMinSample       ? Number(req.query.tdMinSample)       : undefined,
    tdMinSavingsPct:  req.query.tdMinSavingsPct   ? Number(req.query.tdMinSavingsPct)   : undefined,
    tdMaxDispersion:  req.query.tdMaxDispersion   ? Number(req.query.tdMaxDispersion)   : undefined,
    tdFast:           req.query.tdFast            ? Number(req.query.tdFast)            : undefined,
    tdCache:          req.query.tdCache           ? Number(req.query.tdCache)           : undefined,
    tdCacheWrite:     req.query.tdCacheWrite      ? Number(req.query.tdCacheWrite)      : undefined,
  };

  const t0 = Date.now();
  const deadline = t0 + totalBudgetMs;

  const seedRuns = [];
  let processedTotal = 0;

  // SEED in small reschedulable chunks
  while (Date.now() + 3000 < deadline) {
    const runBudget = Math.min(perRunBudget, deadline - Date.now() - 1000);
    if (runBudget < 5000) break;

    const s = await callSeed({ base, secret: cronSecret, offset, count, limit, pages, budgetMs: runBudget });
    seedRuns.push(s);
    if (!s?.ok) break;

    processedTotal += s.processed ?? 0;

    if (!s.nextOffset || s.nextOffset >= (s.totalModels ?? offset + count)) break;
    offset = s.nextOffset;
  }

  // After seeding: refresh → backfill → aggregate → build cache
  const refresh         = await callRefresh(base, cronSecret);
  const backfill        = await callBackfill(base, adminKey);
  const aggregateResult = await callAggregates(base, cronSecret); // <-- fixed: use cronSecret
  const cacheUpdate     = await computeTopDealsCache(base, cronSecret, tdOverrides);

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
