import { getEbayToken } from '@/lib/ebayAuth';
import { makeAffiliateLink } from '@/lib/affiliateLink';

const CATEGORY_ID = 115280; // Golf
const COLLECTOR_KEYWORDS = ['tour', 'circle t', 'limited', 'rare', 'proto', 'gallery', 'vault', 'custom', 'issue', 'craft batch', 'ct', 'masterful', 'gss'];
const PUTTER_TERMS = ['putter', 'headcover'];

export default async function handler(req, res) {
  const rawQuery = (req.query.q || '').toLowerCase().trim();
  const page = parseInt(req.query.page || 1, 10);
  const limit = parseInt(req.query.limit || 10, 10);
  const offset = (page - 1) * limit;
  const sort = req.query.sort || 'recent';

  try {
    const token = await getEbayToken();

    // Dynamically build search query if short
    let searchQuery = rawQuery;
    if (rawQuery && rawQuery.split(' ').length < 4) {
      searchQuery = COLLECTOR_KEYWORDS.map(k => `${rawQuery} ${k}`).join(' OR ');
    }

    const ebayUrl = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(searchQuery)}&category_ids=${CATEGORY_ID}&limit=${limit}&offset=${offset}`;

    const ebayRes = await fetch(ebayUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    const ebayData = await ebayRes.json();
    const rawItems = ebayData.itemSummaries || [];

    const filtered = rawItems.filter(item => {
      const title = (item.title || '').toLowerCase();
      return PUTTER_TERMS.some(term => title.includes(term));
    }).map(item => ({
      title: item.title,
      image: item.image?.imageUrl || null,
      price: item.price?.value ? `$${item.price.value}` : 'N/A',
      priceValue: parseFloat(item.price?.value) || 0,
      brand: item.brand || '',
      model: item.model || '',
      url: makeAffiliateLink(item.itemWebUrl),
    }));

    // Sorting logic
    if (sort === 'lowToHigh') filtered.sort((a, b) => a.priceValue - b.priceValue);
    if (sort === 'highToLow') filtered.sort((a, b) => b.priceValue - a.priceValue);
    if (sort === 'alpha') filtered.sort((a, b) => a.title.localeCompare(b.title));

    res.status(200).json({
      listings: {
        items: filtered,
        page,
        limit,
        total: ebayData.total || filtered.length,
        timestamp: Date.now(),
      },
    });
  } catch (err) {
    console.error('❌ Collector API Error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
