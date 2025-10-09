export function makeAffiliateLink(originalUrl) {
  const campaignId = process.env.EPN_CAMPID;
  if (!campaignId || !originalUrl) return originalUrl;

  const url = new URL(originalUrl);
  url.searchParams.set('campid', campaignId);
  url.searchParams.set('customid', 'putteriq');

  return url.toString();
}
