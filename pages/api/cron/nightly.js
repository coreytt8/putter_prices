// pages/api/cron/nightly.js
export const runtime = 'nodejs';

import fs from 'node:fs/promises';

const DEFAULT_MODELS = [
  // Scotty Cameron
  'Scotty Cameron Newport 2',
  'Scotty Cameron Squareback 2',
  'Scotty Cameron Phantom X 5',
  'Scotty Cameron Phantom X 7',
  'Scotty Cameron Studio Stainless Newport 2',
  'Scotty Cameron Super Select Newport 2',
  'Scotty Cameron Special Select Newport 2',

  // TaylorMade
  'TaylorMade Spider Tour',
  'TaylorMade Spider Tour X',
  'TaylorMade Spider Tour V',
  'TaylorMade Spider Tour Z',
  'TaylorMade Spider GT',
  'TaylorMade Spider GTX',
  'TaylorMade Spider EX',

  // Ping
  'Ping Anser',
  'Ping Anser 2',
  'Ping PLD Anser 2',
  'Ping Kushin 4',
  'Ping Tyne 4',
  'Ping DS72',
  'Ping Fetch',
  'Ping Tomcat 14',

  // Odyssey / Toulon
  'Odyssey White Hot OG Rossie',
  'Odyssey White Hot OG #7',
  'Odyssey Eleven',
  'Odyssey Ten',
  'Odyssey Ai-One #1',
  'Odyssey Ai-One #7',
  'Odyssey Tri-Hot 5K Double Wide',
  'Toulon San Diego',

  // Bettinardi
  'Bettinardi Queen B 6',
  'Bettinardi Studio Stock 7',
  'Bettinardi Studio Stock 28',
  'Bettinardi Inovai 6.0',
  'Bettinardi Inovai 8.0',
  'Bettinardi BB1',

  // LAB, Evnroll, etc.
  'LAB Golf DF 2.1',
  'LAB Golf Mezz.1',
  'LAB Golf Mezz.1 Max',
  'LAB Golf Link.1',
  'Evnroll ER2',
  'Evnroll ER5',
  'Evnroll ER7',
  'Evnroll ER11vx',
  'Evnroll ZERO Z.1',

  // Cleveland, Cobra, SIK, SeeMore, PXG, Wilson
  'Cleveland HB Soft 2 #11',
  'Cleveland Frontline Elevado',
  'Cleveland Frontline Elite 1.0',
  'Cleveland Huntington Beach Soft 10.5',
  'Cobra King 3D Agera',
  'Cobra King 3D Grandsport-35',
  'Cobra King Vintage Nova',
  'SIK Pro C-Series',
  'SIK DW',
  'SIK Jo',
  'SeeMore FGP Black',
  'SeeMore Si3',
  'SeeMore Mini Giant Deep Flange',
  'PXG Battle Ready Blackjack',
  'PXG Battle Ready Bat Attack',
  'PXG Battle Ready Closer',
  'Wilson Staff Infinite Windy City',
  'Wilson Staff Model BL22',
];

function parseSeeds(text) {
  return String(text || '')
    .split(/\r?\n|,/)
    .map(s => s.trim())
    .filter(Boolean);
}

async function loadSeedModels() {
  // 1) Allow overriding via env
  if (process.env.SEED_MODELS && process.env.SEED_MODELS.trim()) {
    return parseSeeds(process.env.SEED_MODELS);
  }
  // 2) Try optional repo file (if bundled). If missing, we’ll fall back.
  try {
    // Path is relative to THIS file at build time; if not traced, ENOENT is normal.
    const p = new URL('../../../data/seed-models.txt', import.meta.url);
    const raw = await fs.readFile(p, 'utf8');
    const models = parseSeeds(raw);
    if (models.length) return models;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // Log unexpected fs error but don’t crash the job
      console.error('seed-models read error:', err);
    }
  }
  // 3) Built-in defaults
  return DEFAULT_MODELS;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export default async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const secret = url.searchParams.get('secret') || '';
  const CRON_SECRET = process.env.CRON_SECRET || '12qwaszx!@QWASZX';
  const ADMIN_KEY = process.env.ADMIN_KEY || '12qwaszx!@QWASZX';
  const LIMIT = Number(process.env.NIGHTLY_LIMIT || '50');
  const PAUSE_MS = Number(process.env.NIGHTLY_PAUSE_MS || '1200');

  if (secret !== CRON_SECRET) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  // Prefer explicit base, then env, then host
  const base =
    url.searchParams.get('base') ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    `https://${req.headers.host}`;

  try {
    const seeds = await loadSeedModels();

    const seedResults = [];
    for (const model of seeds) {
      const enc = encodeURIComponent(model);
      const target = `${base}/api/admin/fetch-browse?limit=${LIMIT}&model=${enc}`;
      let out = { model, ok: false };

      try {
        const resp = await fetch(target, {
          method: 'POST',
          headers: { 'X-ADMIN-KEY': ADMIN_KEY },
          body: '', // Node fetch needs a body for POST, even empty
        });

        let payload = null;
        try {
          payload = await resp.json();
        } catch {
          out.error = `non-JSON (${resp.status})`;
        }

        if (payload && payload.ok) {
          out = {
            model: payload.model || model,
            ok: true,
            saw: payload.saw ?? 0,
            inserted: payload.inserted ?? 0,
            usedUrl: payload.usedUrl || '',
          };
        } else if (payload && payload.error) {
          out.error = payload.error;
        } else if (!out.error) {
          out.error = `status ${resp.status}`;
        }
      } catch (e) {
        out.error = String(e.message || e);
      }

      seedResults.push(out);
      await sleep(PAUSE_MS);
    }

    // Aggregate after seeding
    const aggUrl = `${base}/api/admin/aggregate?secret=${encodeURIComponent(CRON_SECRET)}`;
    let aggregate = {};
    try {
      const aggResp = await fetch(aggUrl);
      try {
        aggregate = await aggResp.json();
      } catch {
        aggregate = { ok: false, error: `non-JSON (${aggResp.status})` };
      }
    } catch (e) {
      aggregate = { ok: false, error: String(e.message || e) };
    }

    return res.status(200).json({ ok: true, base, seedResults, aggregate });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}
