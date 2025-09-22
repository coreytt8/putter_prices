// pages/api/cron/collect-prices.js
export const runtime = "nodejs";

import { getSql } from "../../../lib/db";
import { getEbayToken } from "../../../lib/ebayauth";

const MARKETPLACE = "EBAY_US";
const BROWSE_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";

const QUERIES = [
  "scotty cameron newport 2 putter",
  "scotty cameron newport putter",
  "scotty cameron phantom 5 putter",
  "scotty cameron phantom 7 putter",
  "scotty cameron phantom 9 putter",
  "scotty cameron phantom 11 putter",
  "scotty cameron squareback putter",
  "scotty cameron fastback putter",
  "scotty cameron futura putter",
  "scotty cameron button back putter",
  "scotty cameron tei3 putter",
  "scotty cameron studio select putter",
  "scotty cameron studio style putter",
  "scotty cameron special select putter",
  "scotty cameron champions choice putter",
  "scotty cameron jet set putter",
  "scotty cameron newport beach putter",
  "scotty cameron napa putter",
  "scotty cameron circle t putter",
  "odyssey two ball putter",
  "odyssey eleven putter",
  "odyssey seven putter",
  "odyssey ten putter",
  "odyssey versa putter",
  "odyssey jailbird putter",
  "odyssey white hot og putter",
  "toulon atlanta putter",
  "toulon memphis putter",
  "toulon san diego putter",
  "toulon las vegas putter",
  "toulon garage putter",
  "taylormade spider tour putter",
  "taylormade spider x putter",
  "taylormade spider gt putter",
  "taylormade spider gtx putter",
  "taylormade spider s putter",
  "taylormade spider tour z putter",
  "ping anser putter",
  "ping ds72 putter",
  "ping tyne putter"
];

function toModelKey(title = "") {
  return title
    .toLowerCase()
    .replace(/scotty\s*cameron|titleist|putter|golf|\b(rh|lh)\b|right\s*hand(ed)?|left\s*hand(ed)?/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPage(token, q, limit = 50, offset = 0) {
  const url = new URL(BROWSE_URL);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("filter", "buyingOptions:{FIXED_PRICE|BEST_OFFER|AUCTION}");

  const res = await fetch(url.toString(), {
    headers: {
      "Authorization": `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE,
      "Accept": "application/json"
    }
  });

  if (res.status === 401) {
    const text = await res.text().catch(() => "");
    const err = new Error(`eBay 401 Unauthorized: ${text}`);
    err._is401 = true;
    throw err;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`eBay ${res.status}: ${text}`);
  }
  return res.json();
}

export default async function handler(req, res) {
  try {
    // optional cron secret
    const needSecret = !!process.env.CRON_SECRET;
    if (needSecret) {
      const key = req.query.key || req.headers["x-cron-secret"];
      if (key !== process.env.CRON_SECRET) {
        return res.status(401).json({ ok: false, error: "Unauthorized" });
      }
    }

    const sql = getSql();
    const results = [];
    let calls = 0;

    for (const q of QUERIES) {
      let token = await getEbayToken();
      let j, triedRefresh = false;

      try {
        j = await fetchPage(token, q, 50, 0);
      } catch (e) {
        if (e._is401 && !triedRefresh) {
          // refresh & retry once
          token = await getEbayToken(); // our helper will refresh if needed
          triedRefresh = true;
          j = await fetchPage(token, q, 50, 0);
        } else {
          results.push({ q, found: 0, inserted: 0, error: e.message });
          continue;
        }
      }

      calls++;
      const items = Array.isArray(j.itemSummaries) ? j.itemSummaries : [];
      let inserted = 0;

      for (const it of items) {
        const itemId = it.itemId;
        const title = it.title || "";
        const modelKey = toModelKey(title);
        const price = Number(it?.price?.value);
        const ship = Number(it?.shippingOptions?.[0]?.shippingCost?.value ?? 0);
        const total = Number.isFinite(price) ? price + (Number.isFinite(ship) ? ship : 0) : null;

        // lightweight fields
        const currency = it?.price?.currency || "USD";
        const url = it?.itemWebUrl || null;
        const image = it?.image?.imageUrl || null;
        const condition = it?.condition || null;
        const location = it?.itemLocation?.country || null;

        const seller_user = it?.seller?.username || null;
        const seller_score = Number(it?.seller?.feedbackScore) || null;
        const seller_pct = Number(it?.seller?.feedbackPercentage) || null;

        // upsert into items
        await sql`
          INSERT INTO items (item_id, title, brand, model_key, currency, seller_user, seller_score, seller_pct, url, image_url)
          VALUES (${itemId}, ${title}, NULL, ${modelKey}, ${currency}, ${seller_user}, ${seller_score}, ${seller_pct}, ${url}, ${image})
          ON CONFLICT (item_id) DO UPDATE SET
            title = EXCLUDED.title,
            model_key = EXCLUDED.model_key,
            currency = EXCLUDED.currency,
            seller_user = EXCLUDED.seller_user,
            seller_score = EXCLUDED.seller_score,
            seller_pct = EXCLUDED.seller_pct,
            url = EXCLUDED.url,
            image_url = EXCLUDED.image_url
        `;

        // insert price snapshot
        await sql`
          INSERT INTO item_prices (item_id, price, shipping, total, condition, location_cc)
          VALUES (${itemId}, ${Number.isFinite(price) ? price : null}, ${Number.isFinite(ship) ? ship : null}, ${Number.isFinite(total) ? total : null}, ${condition}, ${location})
        `;

        inserted++;
      }

      results.push({ q, found: items.length, inserted, error: null });
    }

    return res.status(200).json({ ok: true, calls, manualQ: null, results });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
