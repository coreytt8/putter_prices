// app/api/cron/nightly/route.js
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

function getBase(req) {
  // Prefer explicit envs, else derive from the incoming request
  const envBase =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    '';
  if (envBase.startsWith('http')) return envBase.replace(/\/+$/, '');

  // Derive from request URL (has protocol + host in Next route handlers)
  const origin = req.nextUrl?.origin || '';
  return origin.replace(/\/+$/, '');
}

function adminKey() {
  return process.env.ADMIN_KEY || process.env.CRON_SECRET || '';
}

async function postJson(url, headers = {}) {
  const res = await fetch(url, { method: 'POST', headers, body: '' });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json, text };
}

export async function GET(req) {
  const url = new URL(req.url);
  const secret = url.searchParams.get('secret') || '';
  const allowed = [process.env.CRON_SECRET, process.env.ADMIN_KEY].filter(Boolean);
  if (!allowed.includes(secret)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const base = getBase(req);
  const key = adminKey();
  const hdrs = { 'X-ADMIN-KEY': key };

  const models = [
    'Scotty Cameron Newport 2',
    'Scotty Cameron Squareback 2',
    'Odyssey White Hot OG Rossie',
    'TaylorMade Spider Tour',
    'Ping Anser',
  ];

  const seedResults = [];
  for (const m of models) {
    const u = `${base}/api/admin/fetch-browse?limit=50&model=${encodeURIComponent(m)}`;
    try {
      const r = await postJson(u, hdrs);
      if (r.json?.ok) {
        seedResults.push({ model: m, ok: true, saw: r.json.saw, inserted: r.json.inserted, usedUrl: r.json.usedUrl || '' });
      } else {
        seedResults.push({
          model: m,
          ok: false,
          status: r.status,
          error: r.json?.error || `non-JSON (${r.status})`,
          sample: r.json?.sample ? true : false,
        });
      }
    } catch (e) {
      seedResults.push({ model: m, ok: false, error: String(e) });
    }
  }

  // Kick aggregates (60/90/180) if you have /api/admin/aggregate
  let aggregate = {};
  try {
    const a = await postJson(`${base}/api/admin/aggregate?secret=${encodeURIComponent(key)}`);
    aggregate = a.json || { status: a.status, body: a.text?.slice(0, 200) };
  } catch (e) {
    aggregate = { error: String(e) };
  }

  return NextResponse.json({ ok: true, base, seedResults, aggregate });
}
