// pages/api/cron/collect-prices.js
export const runtime = 'nodejs';

import { getSql } from '../../../lib/db';
import { getEbayToken } from '../../../lib/ebayauth';
import { normalizeModelKey } from '../../../lib/normalize';
import { parseSpecs } from '../../../lib/specs';

const DEFAULT_QUERIES = [
  // Scotty Cameron
  'scotty cameron newport 2 putter',
  'scotty cameron newport putter',
  'scotty cameron phantom 5 putter',
  'scotty cameron phantom 7 putter',
  'scotty cameron phantom 9 putter',
  'scotty cameron phantom 11 putter',
  'scotty cameron fastback putter',
  'scotty cameron squareback putter',
  'scotty cameron futura putter',
  'scotty cameron studio select putter',
  'scotty cameron studio style putter',
  'scotty cameron special select putter',
  'scotty cameron champions choice putter',
  'scotty cameron jet set putter',
  // Odyssey
  'odyssey two ball putter',
  'odyssey eleven putter',
  'odyssey seven putter',
  'odyssey ten putter',
  'odyssey versa putter',
  'odyssey jailbird putter',
  'odyssey white hot og putter',
  // Toulon
  'toulon atlanta putter',
  'toulon memphis putter',
  'toulon san diego putter',
  'toulon las vegas putter',
  'toulon garage putter',
  // TaylorMade Spider
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
];

const EBAY_ENDPOINT = 'https://api.ebay.com/buy/browse/v1/item_summary/search';

// Optional: throttle between eBay calls to play nice
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req, res) {
  try {
    // Protected cron (optional): allow manual test via ?key=... or header
    const needAuth = process.env.CRON_SECRET;
    const provided =
      req.headers['x-cron-secret'] ||
      req.query.key ||
      req.cookies?.cron_secret;

    if (needAuth && String(provided) !== String(process.env.CRON_SECRET)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const sql = getSql();
    const token = await getEbayToken(); // from lib/ebayauth.js (client credentials)
    if (!token) {
      return res.status(500).json({ ok: false, error: 'Could not obtain eBay token' });
    }

    const queries = DEFAULT_QUERIES;
    const results = [];
    let calls = 0;

    for (const q of queries) {
      try {
        const url = new URL(EBAY_ENDPOINT);
        url.searchParams.set('q', q);
        url.searchParams.set('limit', '50');
        url.searchParams.set('fieldgroups', 'ASPECTS'); // try to get item specifics when available
        // prefer BIN + auctions; you can add filters here if desired

        const r = await fetch(url.toString(), {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
          },
        });
        calls++;

        if (!r.ok) {
          const msg = `${r.status} ${r.statusText}`;
          results.push({ q, found: 0, inserted: 0, error: `eBay ${msg}` });
          // modest pause if 429/5xx
          if (r.status >= 429) await sleep(800);
          continue;
        }

        const j = await r.json();
        const items = Array.isArray(j.itemSummaries) ? j.itemSummaries : [];

        let inserted = 0;

        for (const it of items) {
          const item_id = it?.itemId || it?.itemWebUrl || it?.title;
          if (!item_id) continue;

          const title = it?.title || '';
          const price = Number(it?.price?.value);
          const currency = it?.price?.currency || 'USD';
          const image_url = it?.image?.imageUrl || null;
          const url = it?.itemWebUrl || null;
          const seller_user = it?.seller?.username || null;
          const seller_score = Number(it?.seller?.feedbackScore) || null;
          const seller_pct = Number(it?.seller?.feedbackPercentage) || null;

          // try to extract aspects map
          const aspects = {};
          if (Array.isArray(it?.localizedAspects)) {
            for (const a of it.localizedAspects) {
              aspects[a?.name] = a?.value;
            }
          }

          // specs enrichment
          const specs = parseSpecs({ title, specifics: aspects });
          const { dexterity, head_type, length_in, has_headcover, shaft } = specs;

          // normalize -> model_key
          const model_key = normalizeModelKey(title);

          // prices (shipping not provided in Browse summaries; keep null if unknown)
          const shipping = null;
          const total = Number.isFinite(price) ? price : null;

          // UPSERT items
          await sql`
            INSERT INTO items (
              item_id, title, brand, model_key, head_type, dexterity, length_in,
              currency, seller_user, seller_score, seller_pct, url, image_url
            )
            VALUES (
              ${item_id}, ${title}, ${null}, ${model_key}, ${head_type}, ${dexterity}, ${length_in},
              ${currency}, ${seller_user}, ${seller_score}, ${seller_pct}, ${url}, ${image_url}
            )
            ON CONFLICT (item_id) DO UPDATE SET
              title = EXCLUDED.title,
              model_key = EXCLUDED.model_key,
              head_type = COALESCE(EXCLUDED.head_type, items.head_type),
              dexterity = COALESCE(EXCLUDED.dexterity, items.dexterity),
              length_in = COALESCE(EXCLUDED.length_in, items.length_in),
              currency = EXCLUDED.currency,
              seller_user = EXCLUDED.seller_user,
              seller_score = EXCLUDED.seller_score,
              seller_pct = EXCLUDED.seller_pct,
              url = EXCLUDED.url,
              image_url = COALESCE(EXCLUDED.image_url, items.image_url)
          `;

          // SNAPSHOT price
          if (total != null) {
            await sql`
              INSERT INTO item_prices (
                item_id, price, shipping, total, condition, location_cc
              )
              VALUES (
                ${item_id}, ${price}, ${shipping}, ${total}, ${it?.condition || null}, ${it?.itemLocation?.country || null}
              )
            `;
          }

          inserted++;
        }

        results.push({ q, found: items.length, inserted, error: null });

        // friendly pacing
        await sleep(250);
      } catch (e) {
        results.push({ q, found: 0, inserted: 0, error: e.message });
        await sleep(400);
      }
    }

    return res.status(200).json({ ok: true, calls, manualQ: null, results });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
