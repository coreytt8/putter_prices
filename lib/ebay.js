let _tok = { val: null, exp: 0 };

export async function getEbayToken() {
  const now = Date.now();
  if (_tok.val && now < _tok.exp - 60_000) return _tok.val;

  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) throw new Error('Missing EBAY_CLIENT_ID/EBAY_CLIENT_SECRET');

  const basic = Buffer.from(`${id}:${secret}`).toString('base64');
  const r = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'https://api.ebay.com/oauth/api_scope' }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || 'OAuth failed');
  _tok = { val: j.access_token, exp: Date.now() + (Number(j.expires_in || 7200) * 1000) };
  return _tok.val;
}

export async function browseSearch({ q, limit = 50, offset = 0, marketplace = 'EBAY_US' }) {
  const token = await getEbayToken();
  const url = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
  url.searchParams.set('q', q);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('fieldgroups', 'EXTENDED');

  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-EBAY-C-MARKETPLACE-ID': marketplace,
    },
  });

  if (r.status === 401) { // refresh once
    _tok = { val: null, exp: 0 };
    return browseSearch({ q, limit, offset, marketplace });
  }
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`${r.status} ${t}`);
  }
  return r.json();
}
