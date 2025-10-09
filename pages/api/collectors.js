const { COLLECTOR_SEARCH_TERMS } = require('@/lib/collectorSearchTerms');
const { getCached, setCached } = require('@/lib/cache');
const { getEbayToken } = require('@/lib/ebayAuth');

const EBAY_API_ENDPOINT = "https://api.ebay.com/buy/browse/v1/item_summary/search";

module.exports = async function handler(req, res) {
  const cacheKey = 'collectorListings';
  const cached = getCached(cacheKey);
  if (cached) return res.status(200).json({ listings: cached });

  try {
    const token = await getEbayToken();
    const allResults = [];

    for (const term of COLLECTOR_SEARCH_TERMS) {
      const url = `${EBAY_API_ENDPOINT}?q=${encodeURIComponent(term)}&limit=5&filter=price:[500..]`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
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
          url: `https://rover.ebay.com/rover/1/711-53200-19255-0/1?ff3=4&pub=5339121522&toolid=10001&campid=5339121522&customid=putteriq&mpre=${encodeURIComponent(item.itemWebUrl)}`,
          term,
        })));
      }
    }

    const timestamp = Date.now();
    const payload = { items: allResults, timestamp };
    setCached(cacheKey, payload);
    res.status(200).json({ listings: payload });

  } catch (err) {
    console.error('Collector fetch failed', err);
    res.status(500).json({ error: 'Failed to fetch collector items' });
  }
};
