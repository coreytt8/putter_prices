// pages/api/cron/collect-prices.js
export const runtime = 'nodejs';

import { getSql } from '../../../lib/db';
import { normalizeModelKey } from '../../../lib/normalize';

const MAX_QUERIES_PER_RUN = Number(process.env.MAX_COLLECT_QUERIES || 40);
const SLEEP_MS_BETWEEN_QUERIES = Number(process.env.COLLECT_SLEEP_MS || 350);

// Expanded seeds across major brands
const PRESET_QUERIES = [
  // Scotty Cameron (Titleist)
  'scotty cameron newport 2 putter',
  'scotty cameron newport putter',
  'scotty cameron phantom 5 putter',
  'scotty cameron phantom 7 putter',
  'scotty cameron phantom 9 putter',
  'scotty cameron phantom 11 putter',
  'scotty cameron squareback putter',
  'scotty cameron fastback putter',
  'scotty cameron futura putter',
  'scotty cameron button back putter',
  'scotty cameron tei3 putter',
  'scotty cameron studio select putter',
  'scotty cameron studio style putter',
  'scotty cameron special select putter',
  'scotty cameron champions choice putter',
  'scotty cameron jet set putter',
  'scotty cameron newport beach putter',
  'scotty cameron napa putter',
  'scotty cameron circle t putter',

  // Odyssey / Toulon
  'odyssey two ball putter',
  'odyssey eleven putter',
  'odyssey seven putter',
  'odyssey ten putter',
  'odyssey versa putter',
  'odyssey jailbird putter',
  'odyssey white hot og putter',
  'toulon atlanta putter',
  'toulon memphis putter',
  'toulon san diego putter',
  'toulon las vegas putter',
  'toulon garage putter',

  // TaylorMade
  'taylormade spider tour putter',
  'taylormade spider x putter',
  'taylormade spider gt putter',
  'taylormade spider gtx putter',
  'taylormade spider s putter',
  'taylormade spider tour z putter',

  // Ping
  'ping anser putter',
  'ping ds72 putter',
  'ping tyne putter',
  'ping fetch putter',
  'ping tomcat putter',
  'ping pld putter',

  // Bettinardi
  'bettinardi queen b putter',
  'bettinardi studio stock putter',
  'bettinardi bb putter',
  'bettinardi inovai putter',
  'bettinardi hive putter',

  // LAB Golf
  'lab golf df putter',
  'lab golf df 3 putter',
  'lab golf mezz putter',
  'lab golf mezz max putter',
  'lab golf link putter',
  'lab golf link 1 putter',

  // Evnroll
  'evnroll er1.2 putter',
  'evnroll er2 putter',
  'evnroll er5 putter',
  'evnroll er7 putter',
  'evnroll v series putter',

  // Mizuno
  'mizuno m craft putter',
  'mizuno m craft i putter',
  'mizuno m craft ii putter',
  'mizuno m craft iii putter',
  'mizuno m craft iv putter',

  // Wilson / SIK / Cobra / PXG / Cleveland
  'wilson 8802 putter',
  'sik pro putter',
  'sik flo putter',
  'sik dw putter',
  'cobra 3d printed agera putter',
  'pxg blackjack putter',
  'pxg one and done putter',
  'cleveland frontline putter',
  'cleveland huntington beach putter',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchListingsForQuery(baseUrl, q) {
  const u = new URL('/api/putters', baseUrl);
  u.searchParams.set('q', q);
  u.searchParams.set('group', 'false');
  u.searchParams.set('onlyComplete', 'true');
  u.searchParams.set('perPage', '50');
  u.searchParams.set('page', '1');
  u.searchParams.set('samplePages', '1'); // gentle on rate limits
  u.searchParams.set('_ts', String(Date.now()));

  const res = await fetch(u.toString(), { headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`/api/putters ${res.status}: ${txt}`);
  }
  const j = await res.json();
  return Array.isArray(j?.offers) ? j.offers : [];
}

export default async function handler(req, res) {
  try {
    // auth: allow ?key= / header X-Cron-Secret / Bearer
    const provided =
      req.headers['x-cron-secret'] ||
      req.query.key ||
      req.headers['authorization']?.replace(/^Bearer\s+/i, '');
    if (!process.env.CRON_SECRET || provided !== process.env.CRON_SECRET) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const sql = getSql();

    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
    const baseUrl = `${proto}://${host}`;

    // Optional single-model run
    const manualQ = (req.query.model || req.query.q || '').toString().trim();
    const queries = manualQ
      ? [manualQ.toLowerCase().includes('putter') ? manualQ : `${manualQ} putter`]
      : PRESET_QUERIES;

    const limited = queries.slice(0, MAX_QUERIES_PER_RUN);

    const results = [];
    let calls = 0;

    for (const raw of limited) {
      calls++;
      const q = raw.trim();
      let offers = [];
      let found = 0;
      let inserted = 0;
      let errMsg = null;

      try {
        offers = await fetchListingsForQuery(baseUrl, q);
        found = offers.length;

        for (const o of offers) {
          const itemId = String(o.productId || o.url).slice(0, 255);
          const modelKey = normalizeModelKey(o.__model || o.title || '');

          // build listing-level spec bag from what you already parse
          const specJson = {
            hosel: o?.specs?.shaft || null,                 // "plumber", "single bend", "slant", "flow"
            headcover: Boolean(o?.specs?.hasHeadcover),     // true/false
            // add more later: toe_hang, loft_deg, lie_deg, headweight_g, grip, finish...
          };

          // items first (FK safe) – UPSERT and merge spec_json
          await sql`
            INSERT INTO items (
              item_id, title, brand, model_key, head_type, dexterity, length_in,
              currency, seller_user, seller_score, seller_pct, url, image_url,
              spec_json
            )
            VALUES (
              ${itemId},
              ${o.title || null},
              ${null},
              ${modelKey || null},
              ${o?.specs?.headType || null},
              ${o?.specs?.dexterity || null},
              ${Number.isFinite(Number(o?.specs?.length)) ? Number(o.specs.length) : null},
              ${o?.currency || 'USD'},
              ${o?.seller?.username || null},
              ${Number.isFinite(Number(o?.seller?.feedbackScore)) ? Number(o.seller.feedbackScore) : null},
              ${Number.isFinite(Number(o?.seller?.feedbackPct)) ? Number(o.seller.feedbackPct) : null},
              ${o?.url || null},
              ${o?.image || null},
              ${sql.json(specJson)}
            )
            ON CONFLICT (item_id) DO UPDATE
            SET
              title = EXCLUDED.title,
              model_key = EXCLUDED.model_key,
              head_type = EXCLUDED.head_type,
              dexterity = EXCLUDED.dexterity,
              length_in = EXCLUDED.length_in,
              currency = EXCLUDED.currency,
              seller_user = EXCLUDED.seller_user,
              seller_score = EXCLUDED.seller_score,
              seller_pct = EXCLUDED.seller_pct,
              url = EXCLUDED.url,
              image_url = EXCLUDED.image_url,
              spec_json = COALESCE(items.spec_json, '{}'::jsonb) || EXCLUDED.spec_json
          `;

          const price = Number.isFinite(Number(o?.price)) ? Number(o.price) : null;
          const shipping = Number.isFinite(Number(o?.shipping?.cost)) ? Number(o.shipping.cost) : 0;
          const total = price != null ? price + shipping : null;

          await sql`
            INSERT INTO item_prices (
              item_id, observed_at, price, shipping, total, condition, location_cc
            )
            VALUES (
              ${itemId},
              now(),
              ${price},
              ${shipping},
              ${total},
              ${o?.condition || null},
              ${o?.location?.country || null}
            )
          `;
          inserted++;
        }
      } catch (e) {
        errMsg = e.message || String(e);
      }

      results.push({ q, found, inserted, error: errMsg });
      await sleep(SLEEP_MS_BETWEEN_QUERIES);
    }

    return res.status(200).json({ ok: true, calls, manualQ: manualQ || null, results });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
