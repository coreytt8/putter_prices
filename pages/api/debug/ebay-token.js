// pages/api/debug/ebay-token.js
export const runtime = "nodejs";
import { getEbayToken, getCachedEbayTokenMeta } from "../../lib/ebayauth";

export default async function handler(req, res) {
  try {
    const token = await getEbayToken();
    const meta = getCachedEbayTokenMeta();
    // Don't return the full token, just a prefix
    return res.status(200).json({
      ok: true,
      prefix: token?.slice(0, 12) || null,
      meta
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
