import { getEbayToken } from '@/lib/ebayAuth';
import { makeAffiliateLink } from '@/lib/affiliateLink';
import { getCached, setCached } from '@/lib/cache';

const CATEGORY_ID = 115280; // Golf
const PUTTER_TERMS = ['putter', 'putters', 'headcover', 'headcovers'];
const COLLECTOR_KEYWORDS = ['tour', 'circle t', 'limited', 'rare', 'proto', 'gallery', 'vault', 'custom', 'issue', 'craft batch', 'ct'];

export default async function handler(req, res) {
  const searchTerm = (req.query.q || '').toLowerCase().trim();
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 10);
  const offset = (page - 1) * limit;
  const sort = req.query.sort || 'recent';

  try {
    const token = await getEbayToken();
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(searchTerm || 'putter')}&category_ids=${CATEGORY_ID}&limit=50&offset=${offset}`;
    const ebayRes = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    const data = await ebayRes.json();
    const raw = data.itemSummaries || [];

    console.log('🔍 Raw titles:', raw.map(i => i.title));

    const filtered = raw.filter(item => {
      const title = (item.title || '').toLowerCase();

      const hasCollectorKeyword = COLLECTOR_KEYWORDS.some(k => title.includes(k));
      const hasPutterWord = PUTTER_TERMS.some(w => title.includes(w));
      const matchesSearch = searchTerm ? title.includes(searchTerm) : true;

      return hasPutterWord && hasCollectorKeyword && matchesSearch;
    }).map(item => ({
      title: item.title,
      image: item.image?.imageUrl || null,
      price: item.price?.value ? `$${item.price.value}` : 'N/A',
      priceValue: parseFloat(item.price?.value) || 0,
      term: searchTerm,
      brand: item.brand || '',
      model: item.model || '',
      url: makeAffiliateLink(item.itemWebUrl),
    }));

    console.log('✅ Filtered titles:', filtered.map(i => i.title));

    // Sort logic
    if (sort === 'lowToHigh') filtered.sort((a, b) => a.priceValue - b.priceValue);
    if (sort === 'highToLow') filtered.sort((a, b) => b.priceValue - a.priceValue);
    if (sort === 'alpha') filtered.sort((a, b) => a.title.localeCompare(b.title));

    const timestamp = Date.now();
    const paginated = filtered.slice(0, limit);

    return res.status(200).json({
      listings: {
        items: paginated,
        total: filtered.length,
        page,
        limit,
        timestamp
      }
    });

  } catch (err) {
    console.error('❌ API error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
