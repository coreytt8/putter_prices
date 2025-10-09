// lib/affiliateLink.js

export function makeAffiliateLink(originalUrl) {
  const campaignId = process.env.EPN_CAMPAIGN_ID;
  if (!campaignId || !originalUrl) return originalUrl;

  const mpre = encodeURIComponent(originalUrl);
  return `https://rover.ebay.com/rover/1/711-53200-19255-0/1?campid=${campaignId}&customid=putteriq&toolid=10001&mpre=${mpre}`;
}
