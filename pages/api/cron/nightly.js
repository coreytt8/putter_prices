// pages/api/cron/nightly.js
// Nightly runner (Pages Router) that:
// 1) Calls /api/cron/seed-browse in small chunks using data/seed-models.txt
// 2) Stays under Vercel’s 60s cap by using a time budget + resume cursor
// 3) Triggers /api/admin/aggregate at the end

export const config = {
  api: {
    bodyParser: false,
  },
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
  url.searchParams.set("useFile", "1");           // read data/seed-models.txt
  url.searchParams.set("offset", String(offset)); // which row to start at
  url.searchParams.set("count", String(count));   // how many models this call
  url.searchParams.set("limit", String(limit));   // items per model page
  url.searchParams.set("pages", String(pages));   // pages to walk per model
  url.searchParams.set("budgetMs", String(budgetMs));

  const res = await fetch(url.toString(), { method: "POST" });
  let json = {};
  try {
    json = await res.json();
  } catch {
    json = { ok: false, error: `non-JSON (${res.status})` };
  }
  return json;
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

export default async function handler(req, res) {
  if (!okAuth(req)) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }

  const base = normalizeBase(req.query.base, req);
  const secret = process.env.CRON_SECRET;

  // knobs (safe defaults; override via querystring)
  const totalBudgetMs = Math.max(10_000, Number(req.query.budgetMs ?? 55_000)); // total time for this invocation
  const perRunBudget = Math.max(5_000, Number(req.query.runBudgetMs ?? 35_000)); // time per seed call
  const count = Math.max(1, Number(req.query.count ?? 8));          // models per seed call
  const limit = Math.max(10, Number(req.query.limit ?? 40));        // items per page
  const pages = Math.max(1, Number(req.query.pages ?? 1));          // pages per model
  let offset = Math.max(0, Number(req.query.offset ?? 0));          // start row in seed-models.txt

  const t0 = Date.now();
  const deadline = t0 + totalBudgetMs;

  const seedRuns = [];
  let processedTotal = 0;

  // Loop chunked seeding until out of time or there’s nothing left to do
  // Each iteration calls /api/cron/seed-browse with its own smaller budget.
  while (Date.now() + 3000 < deadline) {
    const runBudget = Math.min(perRunBudget, deadline - Date.now() - 1000);
    if (runBudget < 5000) break;

    const s = await callSeed({
      base,
      secret,
      offset,
      count,
      limit,
      pages,
      budgetMs: runBudget,
    });

    seedRuns.push(s);

    if (!s?.ok) break;

    processedTotal += s.processed ?? 0;

    if (!s.nextOffset || s.nextOffset >= (s.totalModels ?? offset + count)) {
      // either we’re done with the file, or seed route didn’t provide a next offset
      break;
    }

    // resume from nextOffset
    offset = s.nextOffset;
  }

  // Kick aggregates after seeding
  const aggregate = await callAggregates(base, secret);

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
    aggregate,
  });
}
