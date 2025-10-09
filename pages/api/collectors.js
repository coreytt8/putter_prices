import { getEbayToken } from '@/lib/ebayAuth';
import { makeAffiliateLink } from '@/lib/affiliateLink';
import { COLLECTOR_SEARCH_TERMS } from '@/lib/collectorSearchTerms';
import { getCached, setCached } from '@/lib/cache';

function parseBrandModel(title) {
  const t = title.toLowerCase();
  let brand = '';
  let model = '';

  if (t.includes('scotty cameron')) brand = 'Scotty Cameron';
  else if (t.includes('taylormade')) brand = 'TaylorMade';
  else if (t.includes('ping')) brand = 'Ping';
  else if (t.includes('odyssey')) brand = 'Odyssey';
  else if (t.includes('seemore')) brand = 'SeeMore';
  else if (t.includes('bettinardi')) brand = 'Bettinardi';
  else if (t.includes('tp mills')) brand = 'TP Mills';
  else if (t.includes('titleist')) brand = 'Titleist';

  const models = ['spider', 'anser', 'bullseye', 'white hot', 'tourtype', 'timeless', 'newport', 'vault', 't22'];
  const matchedModel = models.find(m => t.includes(m));
  if (matchedModel) model = matchedModel;

  return { brand, model };
}

export default async function handler(req, res) {
  const cacheKey = 'collectorListings';
  const { page = 1, limit = 10 } = req.query;

  const cached = getCached(cacheKey);
  if (cached && cached.items) {
    const start = (page - 1) * limit;
    const paginated = cached.items.slice(start, start + Number(limit));

    return res.status(200).json({
      listings: {
        ...cached,
        items: paginated,
        page: Number(page),
        limit: Number(limit),
      },
    });
  }

  try {
    const token = await getEbayToken();
    const allResults = [];

    for (const term of COLLECTOR_SEARCH_TERMS) {
      const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(term)}&limit=10`;
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await res.json();

      if (Array.isArray(data.itemSummaries)) {
        for (const item of data.itemSummaries) {
          const rawUrl = item.itemWebUrl;
          const { brand, model } = parseBrandModel(item.title);

          allResults.push({
            title: item.title,
            image: item.image?.imageUrl || null,
            price: item.price?.value ? `$${item.price.value}` : 'N/A',
            priceValue: parseFloat(item.price?.value) || 0,
            term,
            brand,
            model,
            itemWebUrl: rawUrl,
            url: makeAffiliateLink(rawUrl),
          });
        }
      }
    }

    const timestamp = Date.now();
    const start = (page - 1) * limit;
    const paginated = allResults.slice(start, start + Number(limit));

    const payload = {
      items: allResults,
      timestamp,
      total: allResults.length,
    };

    setCached(cacheKey, payload);

    return res.status(200).json({
      listings: {
        ...payload,
        items: paginated,
        page: Number(page),
        limit: Number(limit),
      },
    });

  } catch (err) {
    console.error('Collector fetch failed', err);
    return res.status(500).json({ error: 'Failed to fetch collector listings.' });
  }
}

