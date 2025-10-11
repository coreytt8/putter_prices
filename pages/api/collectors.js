import { getEbayToken } from '@/lib/ebayAuth';
import { makeAffiliateLink } from '@/lib/affiliateLink';

const CATEGORY_ID = 115280;
const PUTTER_TERMS = ['putter', 'headcover', 'head cover', 'cover'];
const VARIANT_KEYWORDS = [
  'tour', 'circle t', 'limited', 'rare', 'vault', 'prototype',
  'custom', 'issue', 'masterful', 'studio', 'craft', 'batch',
  'gtx', 'spider', 'truss', 'juno', 'knucklehead', 'reserve'
];

export default async function handler(req, res) {
  const rawQ = (req.query.q || '').trim().toLowerCase();
  const page = Number(req.query.page || 1);
  const limit = 10;
  const offset = (page - 1) * limit;
  const sort = req.query.sort || 'recent';

  try {
    const token = await getEbayToken();

    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search` +
      `?q=${encodeURIComponent(rawQ)}` +
      `&category_ids=${CATEGORY_ID}` +
      `&limit=${limit}` +
      `&offset=${offset}`;

    // Debugging log
    console.log('🔎 API search:', url);

    const ebayRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    const data = await ebayRes.json();

    const rawItems = data.itemSummaries || [];

    console.log('📦 Raw items count:', rawItems.length);
    console.log('🧾 Raw titles:', rawItems.map(i => i.title).slice(0, 10));

    // Filter & map
    const filtered = rawItems.filter(item => {
      const title = (item.title || '').toLowerCase();

      // Must include putter / headcover
      // allow either putter or headcover
const hasPutterTerm = PUTTER_TERMS.some(pt => title.includes(pt));
if (!hasPutterTerm) {
  return false;
}


      // If the user typed something, allow matching titles directly
      if (rawQ && title.includes(rawQ)) {
        return true;
      }

      // Otherwise require one variant keyword
      if (VARIANT_KEYWORDS.some(kw => title.includes(kw))) {
        return true;
      }

      return false;
    }).map(item => ({
      title: item.title,
      image: item.image?.imageUrl || null,
      price: item.price?.value ? `$${item.price.value}` : 'N/A',
      priceValue: parseFloat(item.price?.value) || 0,
      url: makeAffiliateLink(item.itemWebUrl),
    }));

    console.log('✅ Filtered count:', filtered.length);
    console.log('✅ Filtered titles:', filtered.map(i => i.title));

    // Sort
    if (sort === 'lowToHigh') filtered.sort((a, b) => a.priceValue - b.priceValue);
    else if (sort === 'highToLow') filtered.sort((a, b) => b.priceValue - a.priceValue);
    else if (sort === 'alpha') filtered.sort((a, b) => a.title.localeCompare(b.title));

    // Use eBay's total if present
    const total = typeof data.total === 'number' ? data.total : filtered.length;

    return res.status(200).json({
      listings: {
        items: filtered,
        total,
        page,
        limit,
        timestamp: Date.now()
      }
    });
  } catch (err) {
    console.error('Collector API error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
