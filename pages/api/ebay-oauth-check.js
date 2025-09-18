export default async function handler(req, res) {
  try {
    const id = process.env.EBAY_CLIENT_ID;
    const secret = process.env.EBAY_CLIENT_SECRET;
    if (!id || !secret) {
      return res.status(500).json({ ok: false, msg: "Missing EBAY_CLIENT_ID/EBAY_CLIENT_SECRET" });
    }
    const basic = Buffer.from(`${id}:${secret}`).toString("base64");
    const oauthRes = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "https://api.ebay.com/oauth/api_scope",
      }),
    });
    const text = await oauthRes.text();
    return res.status(oauthRes.status).json({
      ok: oauthRes.ok,
      status: oauthRes.status,
      // show only safe metadata
      meta: {
        id_len: id.length,
        secret_len: secret.length,
        has_space_in_id: /\s/.test(id),
        has_space_in_secret: /\s/.test(secret),
      },
      body_preview: text.slice(0, 300),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
