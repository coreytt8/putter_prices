import fs from "node:fs/promises";
import path from "node:path";
import fetch from "node-fetch";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function usage() {
  console.log(`Usage:
  node scripts/seed-batch.mjs --base http://localhost:3000 --file data/seed-models.txt --limit 50 --pause 1200 --admin "12qwaszx!@QWASZX" [--debug]
`);
  process.exit(1);
}

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) {
      const k = cur.slice(2);
      const v = (arr[i+1] && !arr[i+1].startsWith("--")) ? arr[i+1] : true;
      acc.push([k, v]);
    }
    return acc;
  }, [])
);

const BASE  = args.base  || process.env.SEED_BASE;
const FILE  = args.file  || "data/seed-models.txt";
const LIMIT = Number(args.limit || 50);
const PAUSE = Number(args.pause || 1200); // ms between calls
const ADMIN = args.admin || process.env.ADMIN_KEY;
const DEBUG = !!args.debug;

if (!BASE || !ADMIN) usage();

async function* readLines(file) {
  const raw = await fs.readFile(path.resolve(file), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    yield trimmed;
  }
}

async function seedOne(model) {
  const url = new URL(`${BASE}/api/admin/fetch-browse`);
  url.searchParams.set("limit", String(LIMIT));
  url.searchParams.set("model", model);

  const resp = await fetch(url.toString(), {
    method: "POST",
    headers: { "X-ADMIN-KEY": ADMIN, "Content-Type": "application/json" },
    body: "" // POST required, body unused
  });

  const text = await resp.text();
  let json;
  try { json = JSON.parse(text); } catch {
    return { ok:false, model, status: resp.status, error: "non-JSON", body: text.slice(0,300) };
  }

  const { ok, saw, inserted, usedUrl, histogram, firstError } = json;
  if (!ok) return { ok:false, model, error: json.error || "unknown" };
  return { ok:true, model, saw, inserted, usedUrl, firstError, histogram };
}

(async () => {
  console.log(`Seeding from ${FILE} → ${BASE}`);
  for await (const model of readLines(FILE)) {
    process.stdout.write(`→ ${model} ... `);
    try {
      const res = await seedOne(model);
      if (!res.ok) {
        console.log(`ERR (${res.error || res.status})`);
        if (DEBUG && res.body) console.log(res.body);
      } else {
        console.log(`saw=${res.saw || 0} inserted=${res.inserted || 0}`);
        if (DEBUG && res.usedUrl) console.log("   used:", res.usedUrl);
      }
    } catch (e) {
      console.log(`ERR (${e.message})`);
    }
    await sleep(PAUSE);
  }
  console.log("Done.");
})();
