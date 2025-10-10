import { getEbayToken } from '@/lib/ebayAuth';
import { makeAffiliateLink } from '@/lib/affiliateLink';
import { getCached, setCached } from '@/lib/cache';

const COLLECTOR_KEYWORDS = [
  'tour', 'circle t', 'limited', 'rare', 'vault', 'prototype', 'custom', 'craft', 'batch', 'masterful'
];
const PUTTER_TERMS = ['putter', 'headcover', 'head cover', 'cover'];

export default async function handler(req, res) {
  const { q = '', page = 1, limit = 10, sort = '' } = req.query;
  const searchTerm = q.trim().toLowerCase();

  // compute offset
  const limitNum = Number(limit);
  const offset = (Number(page) - 1) * limitNum;

  const cacheKey = `collector-${searchTerm}-${page}-${limit}-${sort}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return res.status(200).json({ listings: cached });
  }

  try {
    const token = await getEbayToken();
    const categoryId = '115280'; // adjust if you have more specific putters category

    // build sort param for eBay
    let sortParam = '';
    if (sort === 'lowToHigh') sortParam = '&sort=price';
    else if (sort === 'highToLow') sortParam = '&sort=price_desc';
    else if (sort === 'recent') sortParam = '&sort=newlyListed';
    // eBay also supports “distance” etc, but you may not need.

    const ebayUrl =
      `https://api.ebay.com/buy/browse/v1/item_summary/search` +
      `?q=${encodeURIComponent(searchTerm)}` +
      `&category_ids=${categoryId}` +
      `&limit=${limitNum}` +
      `&offset=${offset}` +
      `${sortParam}`;

    console.log('🔍 eBay request', ebayUrl);

    const ebayRes = await fetch(ebayUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await ebayRes.json();
    const raw = Array.isArray(data.itemSummaries) ? data.itemSummaries : [];

    console.log('📦 raw count', raw.length);

    // filter logic (loosened)
    const filtered = raw.filter(item => {
      const title = (item.title || '').toLowerCase();

      // require putter or cover
      if (!PUTTER_TERMS.some(pt => title.includes(pt))) return false;

      // if the title matches the search term directly, allow
      if (searchTerm && title.includes(searchTerm)) {
        return true;
      }

      // else require collector keyword
      if (!COLLECTOR_KEYWORDS.some(kw => title.includes(kw))) {
        return false;
      }

      return true;
    });

    console.log('✅ filtered count', filtered.length);

    const listings = filtered.map(item => ({
      title: item.title,
      image: item.image?.imageUrl || null,
      price: item.price?.value ? `$${item.price.value}` : 'N/A',
      priceValue: parseFloat(item.price?.value) || 0,
      url: makeAffiliateLink(item.itemWebUrl),
    }));

    const payload = {
      items: listings,
      total: filtered.length,
      timestamp: Date.now(),
      page: Number(page),
      limit: limitNum,
    };

    setCached(cacheKey, payload);

    return res.status(200).json({ listings: payload });
  } catch (err) {
    console.error('❌ error in api/collectors', err);
    return res.status(500).json({ error: 'Error fetching listings' });
  }
}
