const { COLLECTOR_SEARCH_TERMS } = require('@/lib/collectorSearchTerms');
const { getCached, setCached } = require('@/lib/cache');
const { getEbayToken } = require('@/lib/ebayAuth'); // ✅ auto-refreshing token function

const EBAY_API_ENDPOINT = "https://api.ebay.com/buy/browse/v1/item_summary/search";

module.exports = async function handler(req, res) {
  const cacheKey = 'collectorListings';
  const cached = getCached(cacheKey);
  if (cached) return res.status(200).json({ listings: cached });

  try {
    const token = await getEbayToken(); // ✅ get fresh eBay token
    const allResults = [];

    for (const term of COLLECTOR_SEARCH_TERMS) {
      const url = `${EBAY_API_ENDPOINT}?q=${encodeURIComponent(term)}&limit=5&filter=price:[500..]`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        console.error(`eBay error for term "${term}"`, await response.text());
        continue;
      }

      const data = await response.json();
      if (data.itemSummaries) {
        allResults.push(...data.itemSummaries.map(item => ({
          id: item.itemId,
          title: item.title,
          price: item.price.value + ' ' + item.price.currency,
          image: item.image?.imageUrl || null,
          url: item.itemWebUrl,
          term,
        })));
      }
    }

    setCached(cacheKey, allResults);
    res.status(200).json({ listings: allResults });
  } catch (err) {
    console.error('Collector fetch failed', err);
    res.status(500).json({ error: 'Failed to fetch collector items' });
  }
};
