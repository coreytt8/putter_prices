// pages/api/collectors.js
import { getEbayToken } from '@/lib/ebayAuth';
import { makeAffiliateLink } from '@/lib/affiliateLink';
import { getCached, setCached } from '@/lib/cache';

// keywords we care about
const COLLECTOR_KEYWORDS = [
  'tour', 'circle t', 'limited', 'rare', 'proto',
  'prototype', 'custom', 'vault', 'craft', 'batch', 'gallery'
];

const PUTTER_TERMS = ['putter', 'headcover', 'head cover', 'cover'];

export default async function handler(req, res) {
  const { q = '', page = 1, limit = 10 } = req.query;
  const searchTerm = q.trim().toLowerCase();
  const cacheKey = `collectorListings-${searchTerm}`;

  if (!searchTerm) {
    return res.status(200).json({ listings: { items: [], total: 0, page, limit } });
  }

  // Try cache first
  const cached = getCached(cacheKey);
  if (cached) {
    console.log('💾 Returning cached results for', searchTerm);
    return res.status(200).json({ listings: cached });
  }

  try {
    const token = await getEbayToken();

    // eBay Browse API call — limit to Golf category if possible
    const categoryId = '115280'; // Golf Clubs & Equipment → Putters
    const ebayUrl = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(
      searchTerm
    )}&category_ids=${categoryId}&limit=50`;

    console.log('🌐 Fetching from eBay:', ebayUrl);

    const ebayRes = await fetch(ebayUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await ebayRes.json();
    const rawItems = Array.isArray(data.itemSummaries) ? data.itemSummaries : [];

    console.log(`📦 Raw eBay items for "${searchTerm}":`, rawItems.length);

    // filtering logic
    const filtered = rawItems.filter((item) => {
      const title = (item.title || '').toLowerCase();

      // must include "putter" or "headcover"
      const hasPutterWord = PUTTER_TERMS.some((word) => title.includes(word));
      if (!hasPutterWord) return false;

      // allow if matches search term directly (like "spider")
      if (searchTerm && title.includes(searchTerm)) return true;

      // otherwise must include collector keyword
      const hasCollectorKeyword = COLLECTOR_KEYWORDS.some((kw) =>
        title.includes(kw)
      );
      return hasCollectorKeyword;
    });

    console.log(`✅ Filtered results: ${filtered.length}`);

    // Map items
    const listings = filtered.map((item) => ({
      title: item.title,
      image: item.image?.imageUrl || null,
      price: item.price?.value ? `$${item.price.value}` : 'N/A',
      priceValue: parseFloat(item.price?.value) || 0,
      url: makeAffiliateLink(item.itemWebUrl),
    }));

    const payload = {
      items: listings,
      total: listings.length,
      timestamp: Date.now(),
      page: Number(page),
      limit: Number(limit),
    };

    setCached(cacheKey, payload);
    return res.status(200).json({ listings: payload });
  } catch (err) {
    console.error('❌ Collector fetch failed:', err);
    return res.status(500).json({ error: 'Failed to fetch collector listings.' });
  }
}
