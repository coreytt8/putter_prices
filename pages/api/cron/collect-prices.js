// pages/api/cron/collect-prices.js
export const runtime = 'nodejs';

import { getSql } from '../../../lib/db';
import { normalizeModelKey } from '../../../lib/normalize';

// ----- Config / Secrets -----
const CRON_SECRET = process.env.CRON_SECRET || '';
const EBAY_SITE = process.env.EBAY_SITE || 'EBAY_US';
const EBAY_BROWSE_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search';

// Keep or expand this list as you like
const PRESET_QUERIES = [
  'scotty cameron newport 2 putter',
  'scotty cameron newport putter',
  'scotty cameron phantom 11 putter',
  'scotty cameron phantom 7 putter',
  'scotty cameron fastback putter',
  'scotty cameron squareback putter',
  'scotty cameron futura putter',
  'scotty cameron tei3 putter',
  'scotty cameron button back putter',
  'scotty cameron circle t putter',
  'scotty cameron newport beach putter',
  'scotty cameron napa putter',
  'taylormade spider tour putter',
  'taylormade spider x putter',
  'taylormade spider gt putter',
  'odyssey seven putter',
  'odyssey #7 putter',
  'odyssey two ball putter',
  'odyssey eleven putter',
  'odyssey jailbird putter',
  'toulon garage putter',
  'ping anser putter',
  'ping tyne putter',
  'ping fetch putter',
  'ping tomcat putter',
  'bettinardi queen b putter',
  'bettinardi studio stock putter',
  'bettinardi bb putter',
  'bettinardi inovai putter',
  'lab golf mezz putter',
  'lab golf df putter',
  'lab golf link putter',
  'evnroll er2 putter',
  'evnroll er5 putter',
  'mizuno m craft putter',
  'wilson 8802 putter',
  'sik putter',
];

// ----- Minimal eBay OAuth (client credentials) -----
let _tok = { val: null, exp: 0 };

async function getEbayToken() {
  const now = Date.now();
  if (_tok.val && now < _tok.exp) return _tok.val;

  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) throw new Error('Missing EBAY_CLIENT_ID/EBAY_CLIENT_SECRET');

  const basic = Buffer.from(`${id}:${secret}`).toString('base64');
  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope',
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`eBay OAuth ${res.status}: ${txt}`);
  }

  const json = await res.json();
  const ttl = (json.expires_in || 7200) * 1000;
  _tok = { val: json.access_token, exp: Date.now() + ttl - 10 * 60 * 1000 };
  return _tok.val;
}

// ----- Minimal helpers (align with your /api/putters mapping) -----
const safeNum = (n) => {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
};

function pickCheapestShipping(shippingOptions) {
  if (!Array.isArray(shippingOptions) || shippingOptions.length === 0) return null;
  const sorted = [...shippingOptions].sort((a, b) => {
    const av = safeNum(a?.shippingCost?.value);
    const bv = safeNum(b?.shippingCost?.value);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return av - bv;
  });
  const cheapest = sorted[0];
  return {
    cost: safeNum(cheapest?.shippingCost?.value),
    currency: cheapest?.shippingCost?.currency || 'USD',
    free: safeNum(cheapest?.shippingCost?.value) === 0,
    type: cheapest?.type || null,
  };
}

function norm(s) {
  return String(s || '').trim().toLowerCase();
}

function coerceDex(val) {
  const s = norm(val);
  if (!s) return null;
  if (/\bl(h|eft)\b|\bleft[-\s]?hand(ed)?\b/.test(s)) return 'LEFT';
  if (/\br(h|ight)\b|\bright[-\s]?hand(ed)?\b/.test(s)) return 'RIGHT';
  if (/^l\/h$|^l-h$|^l\s*h$/.test(s)) return 'LEFT';
  if (/^r\/h$|^r-h$|^r\s*h$/.test(s)) return 'RIGHT';
  return null;
}
function dexFromTitle(title = '') {
  const t = ` ${norm(title)} `;
  if (/(^|\W)l\/h(\W|$)|(^|\W)l-h(\W|$)|(^|\W)l\s*h(\W|$)|(^|\W)lh(\W|$)|\bleft[-\s]?hand(?:ed)?\b/.test(t)) return 'LEFT';
  if (/(^|\W)r\/h(\W|$)|(^|\W)r-h(\W|$)|(^|\W)r\s*h(\W|$)|(^|\W)rh(\W|$)|\bright[-\s]?hand(?:ed)?\b/.test(t)) return 'RIGHT';
  return null;
}
function headTypeFromTitle(title = '') {
  const t = norm(title);
  const MALLET_KEYS = ['phantom', 'fastback', 'squareback', 'futura', 'mallet', 'spider', 'tyne', 'inovai'];
  const BLADE_KEYS = ['newport', 'anser', 'tei3', 'blade', 'studio select', 'special select', 'bb', 'queen b', 'link'];
  if (MALLET_KEYS.some((k) => t.includes(k))) return 'MALLET';
  if (BLADE_KEYS.some((k) => t.includes(k))) return 'BLADE';
  return null;
}
function parseLengthFromTitle(title = '') {
  const t = norm(title);
  let length = null;
  const m1 = t.match(/(\d{2}(?:\.\d)?)\s*(?:\"|in\b|inch(?:es)?\b)/i);
  const m2 = t.match(/\b(32|33|34|35|36|37)\s*(?:\/|-)\s*(32|33|34|35|36|37)\b/);
  if (m1) length = Number(m1[1]);
  else if (m2) length = Math.max(Number(m2[1]), Number(m2[2]));
  return length;
}
function parseSpecsFromItem(item) {
  const title = item?.title || '';
  const dex = dexFromTitle(title);
  const headType = headTypeFromTitle(title);
  const length = parseLengthFromTitle(title);
  return { length, headType, dexterity: dex };
}

// ----- eBay Browse (direct) -----
async function fetchEbayBrowse({ q, limit = 50, offset = 0, sort }) {
  const token = await getEbayToken();
  const url = new URL(EBAY_BROWSE_URL);
  url.searchParams.set('q', q || '');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('fieldgroups', 'EXTENDED');
  if (sort === 'newlylisted') url.searchParams.set('sort', 'newlyListed');

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-EBAY-C-MARKETPLACE-ID': EBAY_SITE,
      'X-EBAY-C-ENDUSERCTX': `contextualLocation=${EBAY_SITE}`,
    },
  });

  if (res.status === 401 || res.status === 403) {
    // retry once with fresh token
    _tok = { val: null, exp: 0 };
    const fresh = await getEbayToken();
    const res2 = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${fresh}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': EBAY_SITE,
        'X-EBAY-C-ENDUSERCTX': `contextualLocation=${EBAY_SITE}`,
      },
    });
    if (!res2.ok) {
      const t = await res2.text().catch(() => '');
      throw new Error(`eBay Browse ${res2.status}: ${t}`);
    }
    return res2.json();
  }

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`eBay Browse ${res.status}: ${t}`);
  }
  return res.json();
}

// ----- API handler -----
export default async function handler(req, res) {
  try {
    // Auth gate
    const key = (req.query.key || '').trim();
    if (!CRON_SECRET || key !== CRON_SECRET) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const sql = getSql();

    // Optional single-model backfill: ?model=newport%202
    const manualModel = (req.query.model || '').trim();
    const manualQ = manualModel ? `scotty cameron ${manualModel} putter` : null;

    const queries = manualQ ? [manualQ] : PRESET_QUERIES;
    const results = [];
    let calls = 0;

    for (const q of queries) {
      calls++;

      // Pull 50 summaries (you can page more if you want)
      const data = await fetchEbayBrowse({ q, limit: 50, offset: 0, sort: '' });
      const items = Array.isArray(data?.itemSummaries) ? data.itemSummaries : [];

      let inserted = 0;
      for (const item of items) {
        const image = item?.image?.imageUrl || item?.thumbnailImages?.[0]?.imageUrl || null;
        const shipping = pickCheapestShipping(item?.shippingOptions);
        const specs = parseSpecsFromItem(item);
        const itemPrice = safeNum(item?.price?.value);
        const shipCost = shipping?.cost ?? 0;
        const totalPrice = itemPrice != null && shipCost != null ? itemPrice + shipCost : itemPrice ?? null;

        const title = item?.title || '';
        const model_key = normalizeModelKey(title);
        const item_id = String(item?.itemId || item?.legacyItemId || item?.itemHref || title);

        // Upsert item (FK-safe)
        await sql`
          INSERT INTO items (item_id, title, brand, model_key, head_type, dexterity, length_in, currency,
                             seller_user, seller_score, seller_pct, url, image_url)
          VALUES (
            ${item_id},
            ${title},
            ${null},
            ${model_key},
            ${specs.headType || null},
            ${specs.dexterity || null},
            ${Number.isFinite(Number(specs.length)) ? Number(specs.length) : null},
            ${(item?.price?.currency || 'USD')},
            ${(item?.seller?.username || null)},
            ${item?.seller?.feedbackScore ? Number(item.seller.feedbackScore) : null},
            ${item?.seller?.feedbackPercentage ? Number(item.seller.feedbackPercentage) : null},
            ${(item?.itemWebUrl || item?.itemHref || null)},
            ${image}
          )
          ON CONFLICT (item_id) DO UPDATE
          SET title = EXCLUDED.title,
              model_key = EXCLUDED.model_key,
              image_url = COALESCE(EXCLUDED.image_url, items.image_url)
        `;

        // Insert price snapshot
        await sql`
          INSERT INTO item_prices (item_id, price, shipping, total, condition, location_cc)
          VALUES (
            ${item_id},
            ${itemPrice != null ? itemPrice : null},
            ${shipCost != null ? shipCost : null},
            ${totalPrice != null ? totalPrice : null},
            ${(item?.condition || null)},
            ${(item?.itemLocation?.country || null)}
          )
        `;
        inserted++;
      }

      results.push({ q, found: items.length, inserted });
    }

    return res.status(200).json({ ok: true, calls, manualQ: manualQ || null, results });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
