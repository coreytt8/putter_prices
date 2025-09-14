// lib/ebayAuth.js
let cached = { token: null, exp: 0 }; // epoch ms

async function fetchNewToken() {
  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Missing EBAY_CLIENT_ID/EBAY_CLIENT_SECRET");

  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
    cache: "no-store",
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`eBay OAuth ${res.status}: ${txt}`);
  }
  const json = await res.json();
  const now = Date.now();
  const ttl = (json.expires_in || 7200) * 1000; // seconds → ms
  // keep margin (10 min) so we refresh before it dies
  cached = { token: json.access_token, exp: now + ttl - 10 * 60 * 1000 };
  return cached.token;
}

export async function getEbayToken() {
  const now = Date.now();
  if (cached.token && now < cached.exp) return cached.token;
  return fetchNewToken();
}
