// /lib/normalize.js
import { classifyEdition } from "./variants";

function number(v, fallback = 0) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

export function estimateTax(subtotal, rate = 0) {
  return subtotal * rate;
}

export function extractEbayShipping(listing) {
  const opt = listing?.shippingOptions?.[0]?.shippingCost?.value;
  return number(opt, 0);
}

export function totalToDoor({ price, shipping = 0, tax = 0 }) {
  return number(price) + number(shipping) + number(tax);
}

export function modelKeyFromTitle(title = "", brand = "") {
  const t = (title || "").toLowerCase().replace(/\s+/g, " ");
  const b = (brand || "").toLowerCase().trim();
  const canonical = t
    .replace(/\b(32|33|34|35|36|37|38)\s*(?:in|inch|")\b/g, "")
    .replace(/\b(right|left|rh|lh)\b/g, "")
    .replace(/\b(grip|headcover|hc|cover)\b/g, "")
    .replace(/[^\w\s:.-]/g, "")
    .trim();
  return `${b}::${canonical}`.slice(0, 140);
}

export function variantKeyFrom(title = "", brand = "") {
  const { edition } = classifyEdition(brand, title);
  return `${modelKeyFromTitle(title, brand)}::${edition}`;
}

function cryptoRandomId() {
  return "l_" + Math.random().toString(36).slice(2, 10);
}

export function normalizeListing(raw, { defaultTaxRate = 0 } = {}) {
  const merchant = raw.merchant || raw.source || "eBay";
  const price = number(raw.price || raw?.price?.value);
  const shipping = raw.shipping != null ? number(raw.shipping) :
                   merchant === "eBay" ? extractEbayShipping(raw) : 0;
  const tax = raw.tax != null ? number(raw.tax) : 0;

  const { edition, variantTags } = classifyEdition(raw.brand || "", raw.title || "");

  return {
    id: raw.id || raw.itemId || raw.listingId || cryptoRandomId(),
    merchant,
    title: raw.title || "",
    url: raw.url || raw.itemWebUrl || raw.itemHref,
    images: raw.images || raw.image || raw?.image?.imageUrl ? [raw?.image?.imageUrl] : raw?.imageUrls || [],
    price,
    shipping,
    tax,
    total: totalToDoor({ price, shipping, tax }),
    brand: raw.brand || "",
    modelKey: modelKeyFromTitle(raw.title, raw.brand),
    variantKey: variantKeyFrom(raw.title, raw.brand),
    edition,
    variantTags,
    conditionRaw: raw.condition || raw.itemCondition || "",
    seller: {
      name: raw?.seller?.username || raw?.seller?.name || "",
      feedbackPct: typeof raw?.seller?.feedbackPercentage === "number"
        ? raw.seller.feedbackPercentage
        : raw?.seller?.feedbackPercentage
          ? parseFloat(String(raw.seller.feedbackPercentage).replace('%',''))
          : null,
      feedbackCount: number(raw?.seller?.feedbackScore || raw?.seller?.feedbackCount),
      returns: !!raw?.returnPolicy || !!raw?.returnsAccepted,
      handlingTimeDays: number(raw?.handlingTimeDays),
    },
  };
}
