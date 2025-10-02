// lib/ebayBrowse.js
import { getAccessToken } from "@/lib/ebayauth"; // you already have this
import { mapConditionIdToBand } from "@/lib/condition-band";

const BROWSE_BASE = "https://api.ebay.com/buy/browse/v1";

/** Search live listings + condition histogram (free) */
export async function searchBrowse({ q, limit = 50, offset = 0, fieldgroups = "CONDITION_REFINEMENTS" }) {
  const token = await getAccessToken();
  const url = new URL(`${BROWSE_BASE}/item_summary/search`);
  if (q) url.searchParams.set("q", q);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  if (fieldgroups) url.searchParams.set("fieldgroups", fieldgroups);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-EBAY-MARKETPLACE-ID": "EBAY_US",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`eBay browse error ${res.status}`);

  const data = await res.json();

  // Normalize items you’ll snapshot into DB
  const items = (data.itemSummaries || []).map((it) => {
    const price = Number(it.price?.value || 0);
    const ship = Number(it.shippingOptions?.[0]?.shippingCost?.value || 0);
    const total = price + (Number.isFinite(ship) ? ship : 0);
    return {
      itemId: it.itemId,
      title: it.title || "",
      itemWebUrl: it.itemWebUrl, // keep this pristine for affiliate redirector
      price_cents: Math.round(price * 100),
      shipping_cents: Number.isFinite(ship) ? Math.round(ship * 100) : 0,
      total_cents: Math.round(total * 100),
      condition_id: it.conditionId,
      condition_band: mapConditionIdToBand(it.conditionId),
    };
  });

  const conditionHistogram = (data.refinement?.conditionDistributions || []).map((c) => ({
    conditionId: c.conditionId,
    condition: c.condition,
    matchCount: Number(c.matchCount || 0),
  }));

  return { items, conditionHistogram, raw: data };
}
