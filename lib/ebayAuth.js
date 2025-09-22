// lib/ebayauth.js
let cached = globalThis.__ebayTokenCache;

async function fetchAppToken() {
  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Missing EBAY_CLIENT_ID/EBAY_CLIENT_SECRET");

  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  // PROD auth URL for client_credentials
  const url = "https://api.ebay.com/identity/v1/oauth2/token";
  const scope = "https://api.ebay.com/oauth/api_scope";

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope
    }).toString()
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`eBay token fetch failed ${res.status}: ${text}`);
  }
  const j = await res.json();

  const now = Math.floor(Date.now() / 1000);
  const exp = now + Math.max(60, Number(j.expires_in || 0)); // pad min 60s
  return {
    access_token: j.access_token,
    token_type: j.token_type,
    scope: j.scope,
    expires_at: exp
  };
}

export async function getEbayToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.access_token && cached.expires_at && cached.expires_at - now > 90) {
    return cached.access_token;
  }
  const fresh = await fetchAppToken();
  cached = globalThis.__ebayTokenCache = fresh;
  return fresh.access_token;
}

// Optional: quick introspection (for debug endpoint)
export function getCachedEbayTokenMeta() {
  if (!cached) return null;
  const now = Math.floor(Date.now() / 1000);
  return {
    hasToken: !!cached.access_token,
    expiresAt: cached.expires_at,
    secondsLeft: cached.expires_at ? cached.expires_at - now : null,
    scope: cached.scope,
    tokenType: cached.token_type
  };
}
