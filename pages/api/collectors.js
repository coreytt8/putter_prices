// pages/api/collectors.js
import { getEbayToken } from '@/lib/ebayAuth';
import { makeAffiliateLink } from '@/lib/affiliateLink';
import { COLLECTOR_SEARCH_TERMS } from '@/lib/collectorSearchTerms';
import { getCached, setCached } from '@/lib/cache';

export default async function handler(req, res) {
  const { page = 1, limit = 10, q = '' } = req.query;
  const searchTerm = q.toLowerCase().trim();
  const cacheKey = `collectorListings-${searchTerm}`;

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

    const termsToSearch = searchTerm
      ? COLLECTOR_SEARCH_TERMS.map(t => `${t} ${searchTerm}`)
      : COLLECTOR_SEARCH_TERMS;

    for (const term of termsToSearch) {
      const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(term)}&limit=10`;
      const ebayRes = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await ebayRes.json();

      if (Array.isArray(data.itemSummaries)) {
        for (const item of data.itemSummaries) {
          allResults.push({
            title: item.title,
            image: item.image?.imageUrl || null,
            price: item.price?.value ? `$${item.price.value}` : 'N/A',
            priceValue: parseFloat(item.price?.value) || 0,
            term,
            brand: item.brand || '',
            model: item.model || '',
            url: makeAffiliateLink(item.itemWebUrl),
          });
        }
      }
    }

    const timestamp = Date.now();
    const payload = {
      items: allResults,
      timestamp,
      total: allResults.length,
    };

    setCached(cacheKey, payload);

    const start = (page - 1) * limit;
    const paginated = allResults.slice(start, start + Number(limit));

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
