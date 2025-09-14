/* eslint-disable no-console */
import { NextResponse } from "next/server";

/**
 * ENV
 * - EBAY_BROWSE_TOKEN : OAuth App token for eBay Browse API (production)
 * - EBAY_SITE         : optional, default "EBAY_US"
 *
 * If/when you adopt auto-refresh, replace the static token with getEbayAppToken() helper.
 */

const EBAY_BROWSE_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const EBAY_SITE = process.env.EBAY_SITE || "EBAY_US";
const EBAY_TOKEN = process.env.EBAY_BROWSE_TOKEN;

// ------------ utils ------------

function safeNum(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
}

function pickCheapestShipping(shippingOptions) {
  if (!Array.isArray(shippingOptions) || shippingOptions.length === 0) return null;
  const sorted = [...shippingOptions].sort((a, b) => {
    const av = safeNum(a?.shippingCost?.value);
    const bv = safeNum(b?.shippingCost?.value);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return av - bv;
  });
  const cheapest = sorted[0];
  return {
    cost: safeNum(cheapest?.shippingCost?.value),
    currency: cheapest?.shippingCost?.currency || "USD",
    free: safeNum(cheapest?.shippingCost?.value) === 0,
    type: cheapest?.type || null,
  };
}

/**
 * Parse specs from title:
 * - length (inches)
 * - family keyword
 * - headType: "BLADE" | "MALLET" (heuristic via family keywords)
 * - dexterity: "LEFT" | "RIGHT"
 * - hasHeadcover
 * - shaft: slant/flow/plumber/single bend (if mentioned)
 */
function parseSpecsFromTitle(title = "") {
  const t = String(title).toLowerCase();

  // Length like 33", 34", 35 in, 34-35, 34/35
  let length = null;
  const m1 = t.match(/(\d{2}(?:\.\d)?)\s*(?:\"|in\b|inch(?:es)?\b)/i);
  const m2 = t.match(/\b(32|33|34|35|36|37)\s*(?:\/|-)\s*(32|33|34|35|36|37)\b/); // 34/35 ranges
  if (m1) length = Number(m1[1]);
  else if (m2) length = Math.max(Number(m2[1]), Number(m2[2]));

  // Family keywords (expand as needed)
  const FAMILIES = [
    "newport 2.5", "newport 2", "newport",
    "phantom 11.5", "phantom 11", "phantom 5.5", "phantom 5",
    "fastback", "squareback", "futura", "tei3",
    "studio select", "special select",
    "anser", "blade", "mallet",
  ];
  let family = null;
  for (const k of FAMILIES) {
    if (t.includes(k)) { family = k; break; }
  }

  // Head type mapping by family keywords
  const MALLET_KEYS = ["phantom", "fastback", "squareback", "futura", "mallet"];
  const BLADE_KEYS  = ["newport", "anser", "tei3", "blade", "studio select", "special select"];
  let headType = null;
  if (MALLET_KEYS.some(k => t.includes(k))) headType = "MALLET";
  if (BLADE_KEYS.some(k => t.includes(k))) headType = headType || "BLADE";

  // Dexterity detection (RH/LH and words)
  let dexterity = null;
  if (/\bright[-\s]?hand(ed)?\b|\brh\b/.test(t)) dexterity = "RIGHT";
  if (/\bleft[-\s]?hand(ed)?\b|\blh\b/.test(t))  dexterity = "LEFT";

  const hasHeadcover = /head\s*cover|\bhc\b|headcover/.test(t);
  const shaftMatch = /slant|flow|plumber|single bend/.exec(t);
  const shaft = shaftMatch ? shaftMatch[0] : null;

  return { length, family, headType, dexterity, hasHeadcover, shaft };
}

function normalizeModelFromTitle(title = "") {
  const t = title.toLowerCase()
    .replace(/scotty\s*cameron|titleist|putter|golf|right\s*hand(ed)?|left\s*hand(ed)?/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const specs = parseSpecsFromTitle(title);
  if (specs.family) return specs.family;

  // fallback: pick first 2–4 meaningful tokens
  const tokens = t.split(" ").filter(Boolean).slice(0, 4);
  return tokens.length ? tokens.join(" ") : (title || "unknown").slice(0, 50);
}

function enrichOffer(raw) {
  const shipping = pickCheapestShipping(raw?.shippingOptions);
  const sellerPct = raw?.seller?.feedbackPercentage ? Number(raw.seller.feedbackPercentage) : null;
  const sellerScore = raw?.seller?.feedbackScore ? Number(raw.seller.feedbackScore) : null;
  const returnsAccepted = Boolean(raw?.returnTerms?.returnsAccepted);
  const returnDays = raw?.returnTerms?.returnPeriod?.value ? Number(raw.returnTerms.returnPeriod.value) : null;
  const buyingOptions = Array.isArray(raw?.buyingOptions) ? raw.buyingOptions : [];
  const bidCount = raw?.bidCount != null ? Number(raw.bidCount) : null;

  const specs = parseSpecsFromTitle(raw?.title);

  // total price (item + cheapest shipping if available)
  const itemPrice = safeNum(raw?.price?.value);
  const shipCost = shipping?.cost ?? 0;
  const totalPrice = (itemPrice != null && shipCost != null) ? itemPrice + shipCost : itemPrice ?? null;

  return {
    shipping: shipping ? {
      cost: shipping.cost,
      currency: shipping.currency || raw?.price?.currency || "USD",
      free: Boolean(shipping.free),
      type: shipping.type || null,
    } : null,
    totalPrice,
    seller: {
      feedbackPct: sellerPct,
      feedbackScore: sellerScore,
      username: raw?.seller?.username || null,
    },
    location: {
      country: raw?.itemLocation?.country || null,
      postalCode: raw?.itemLocation?.postalCode || null,
    },
    returns: {
      accepted: returnsAccepted,
      days: returnDays,
    },
    buying: {
      types: buyingOptions,         // e.g. ["FIXED_PRICE","BEST_OFFER"]
      bidCount: bidCount,           // for auctions (if available)
    },
    specs,                          // { length, family, headType, dexterity, hasHeadcover, shaft }
  };
}

// ------------ ebay fetch ------------

async function fetchEbayBrowse({ q, limit = 50, offset = 0, sort }) {
  if (!EBAY_TOKEN) {
    throw new Error("Missing EBAY_BROWSE_TOKEN");
  }

  const url = new URL(EBAY_BROWSE_URL);
  url.searchParams.set("q", q || "");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("fieldgroups", "EXTENDED"); // get shipping/seller/returns/etc
  url.searchParams.set("X-EBAY-C-ENDUSERCTX", `contextualLocation=${EBAY_SITE}`);

  // sort mapping: "newlylisted" -> "newlyListed"
  if (sort === "newlylisted") {
    url.searchParams.set("sort", "newlyListed");
  }

  const res = await fetch(url.toString(), {
    headers: {
      "Authorization": `Bearer ${EBAY_TOKEN}`,
      "Accept": "application/json",
      "Content-Type": "application/json",
      "X-EBAY-C-MARKETPLACE-ID": EBAY_SITE,
    },
    cache: "no-store",
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`eBay Browse error ${res.status}: ${text}`);
  }
  return res.json();
}

// ------------ core handler ------------

export async function GET(req) {
  const { searchParams } = new URL(req.url);

  const q = (searchParams.get("q") || "").trim();
  const group = (searchParams.get("group") || "true") === "true";
  const onlyComplete = searchParams.get("onlyComplete") === "true";
  const minPrice = safeNum(searchParams.get("minPrice"));
  const maxPrice = safeNum(searchParams.get("maxPrice"));
  const conds = (searchParams.get("conditions") || "").split(",").map(s => s.trim()).filter(Boolean); // NEW, USED, etc
  const buyingOptions = (searchParams.get("buyingOptions") || "").split(",").map(s => s.trim()).filter(Boolean);
  const sort = searchParams.get("sort") || ""; // "newlylisted"

  // NEW filters
  const dex = (searchParams.get("dex") || "").toUpperCase();   // "", "LEFT", "RIGHT"
  const head = (searchParams.get("head") || "").toUpperCase(); // "", "BLADE", "MALLET"
  const lengthsParam = (searchParams.get("lengths") || "").trim(); // e.g. "33,34"
  const lengthList = lengthsParam
    ? lengthsParam.split(",").map(s => Number(s)).filter(n => Number.isFinite(n))
    : [];

  const page = Math.max(1, Number(searchParams.get("page") || "1"));
  const perPage = Math.max(1, Math.min(50, Number(searchParams.get("perPage") || "10")));
  const broaden = searchParams.get("broaden") === "true";
  const samplePages = Math.max(1, Math.min(5, Number(searchParams.get("samplePages") || (broaden ? 3 : 1))));

  if (!q) {
    return NextResponse.json({
      ok: true,
      groups: [],
      offers: [],
      hasNext: false,
      hasPrev: false,
      fetchedCount: 0,
      keptCount: 0,
      meta: { total: 0, returned: 0, cards: 0, page, perPage, broaden, sort, source: "ebay-browse" },
      analytics: { snapshot: null },
    });
  }

  try {
    // Pull multiple Browse pages to improve recall
    const ebayLimit = 50;
    const fetches = [];
    for (let i = 0; i < samplePages; i++) {
      const offset = i * ebayLimit;
      fetches.push(fetchEbayBrowse({ q, limit: ebayLimit, offset, sort }));
    }

    const results = await Promise.allSettled(fetches);
    const items = [];
    let totalFromEbay = 0;

    for (const r of results) {
      if (r.status === "fulfilled") {
        const data = r.value || {};
        totalFromEbay = Math.max(totalFromEbay, Number(data?.total || 0));
        const arr = Array.isArray(data?.itemSummaries) ? data.itemSummaries : [];
        for (const it of arr) items.push(it);
      }
    }

    const fetchedCount = items.length;

    // Map to offers + enrichment
    let offers = items.map((item) => {
      const extra = enrichOffer(item);
      const image =
        item?.image?.imageUrl ||
        item?.thumbnailImages?.[0]?.imageUrl ||
        null;

      return {
        productId: item?.itemId || item?.legacyItemId || item?.itemHref || item?.title,
        url: item?.itemWebUrl || item?.itemHref,
        title: item?.title,
        retailer: "eBay",
        price: safeNum(item?.price?.value),
        currency: item?.price?.currency || "USD",
        condition: item?.condition || null,
        createdAt: item?.itemCreationDate || item?.itemEndDate || item?.estimatedAvailDate || null,
        image,

        // NEW fields:
        totalPrice: extra.totalPrice,
        shipping: extra.shipping,
        seller: extra.seller,
        location: extra.location,
        returns: extra.returns,
        buying: extra.buying,
        specs: extra.specs,  // { length, headType, dexterity, ... }

        // For grouping convenience:
        __model: normalizeModelFromTitle(item?.title || ""),
      };
    });

    // Quality filter: price & image presence
    if (onlyComplete) {
      offers = offers.filter(o => typeof o.price === "number" && o.image);
    }

    // Price range
    if (minPrice != null) offers = offers.filter(o => typeof o.price === "number" && o.price >= minPrice);
    if (maxPrice != null) offers = offers.filter(o => typeof o.price === "number" && o.price <= maxPrice);

    // Conditions
    if (conds.length) {
      const set = new Set(conds.map(s => s.toUpperCase()));
      offers = offers.filter(o => o?.condition && set.has(String(o.condition).toUpperCase()));
    }

    // Buying options
    if (buyingOptions.length) {
      const set = new Set(buyingOptions.map(s => s.toUpperCase()));
      offers = offers.filter(o => {
        const types = Array.isArray(o?.buying?.types) ? o.buying.types : [];
        return types.some(t => set.has(String(t).toUpperCase()));
      });
    }

    // NEW: Dexterity filter
    if (dex === "LEFT" || dex === "RIGHT") {
      offers = offers.filter(o => (o?.specs?.dexterity || "").toUpperCase() === dex);
    }

    // NEW: Head type filter
    if (head === "BLADE" || head === "MALLET") {
      offers = offers.filter(o => (o?.specs?.headType || "").toUpperCase() === head);
    }

    // NEW: Common Lengths filter (exact match within ±0.5")
    if (lengthList.length) {
      offers = offers.filter(o => {
        const L = Number(o?.specs?.length);
        if (!Number.isFinite(L)) return false;
        return lengthList.some(sel => Math.abs(L - sel) <= 0.5);
      });
    }

    // Sorting
    if (sort === "newlylisted") {
      offers.sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta; // newest first
      });
    }

    const keptCount = offers.length;

    // (Optional) simple analytics snapshot for your MarketSnapshot component
    const analytics = (() => {
      const byHead = { BLADE: 0, MALLET: 0 };
      const byDex = { LEFT: 0, RIGHT: 0 };
      const byLen = { 33: 0, 34: 0, 35: 0, 36: 0 };
      for (const o of offers) {
        const h = (o?.specs?.headType || "").toUpperCase();
        if (h === "BLADE" || h === "MALLET") byHead[h]++;

        const d = (o?.specs?.dexterity || "").toUpperCase();
        if (d === "LEFT" || d === "RIGHT") byDex[d]++;

        const L = Number(o?.specs?.length);
        if (L) {
          const nearest = [33,34,35,36].reduce((p,c) => Math.abs(c - L) < Math.abs(p - L) ? c : p, 34);
          if (Math.abs(nearest - L) <= 0.5) byLen[nearest]++;
        }
      }
      return { snapshot: { byHead, byDex, byLen } };
    })();

    // Pagination
    if (!group) {
      // Flat list
      const start = (page - 1) * perPage;
      const pageOffers = offers.slice(start, start + perPage);

      const hasPrev = page > 1;
      const hasNext = start + perPage < keptCount;

      return NextResponse.json({
        ok: true,
        offers: pageOffers,
        groups: [],
        hasNext,
        hasPrev,
        fetchedCount,
        keptCount,
        meta: {
          total: totalFromEbay || keptCount,
          returned: pageOffers.length,
          cards: pageOffers.length,
          page,
          perPage,
          broaden,
          sort: sort || "default",
          source: "ebay-browse",
        },
        analytics,
      });
    }

    // Grouped view
    const groupsMap = new Map();
    for (const o of offers) {
      const key = o.__model || "unknown";
      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          model: key,
          image: o.image || null,
          bestPrice: o.price ?? null,
          bestCurrency: o.currency || "USD",
          count: 0,
          retailers: new Set(),
          offers: [],
        });
      }
      const g = groupsMap.get(key);
      g.count += 1;
      g.retailers.add(o.retailer || "eBay");
      g.offers.push(o);
      if (typeof o.price === "number" && (g.bestPrice == null || o.price < g.bestPrice)) {
        g.bestPrice = o.price;
        g.bestCurrency = o.currency || g.bestCurrency || "USD";
        if (o.image) g.image = o.image;
      }
    }

    let groups = Array.from(groupsMap.values()).map((g) => ({
      ...g,
      retailers: Array.from(g.retailers),
      offers: g.offers.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity)),
    }));

    if (sort === "newlylisted") {
      groups.sort((a, b) => {
        const ta = a.offers.length ? Math.max(...a.offers.map(o => o.createdAt ? new Date(o.createdAt).getTime() : 0)) : 0;
        const tb = b.offers.length ? Math.max(...b.offers.map(o => o.createdAt ? new Date(o.createdAt).getTime() : 0)) : 0;
        return tb - ta;
      });
    } else {
      groups.sort((a, b) => (a.bestPrice ?? Infinity) - (b.bestPrice ?? Infinity));
    }

    // Group-level pagination
    const start = (page - 1) * perPage;
    const pageGroups = groups.slice(start, start + perPage);
    const hasPrev = page > 1;
    const hasNext = start + perPage < groups.length;

    return NextResponse.json({
      ok: true,
      groups: pageGroups,
      offers: [],
      hasNext,
      hasPrev,
      fetchedCount,
      keptCount,
      meta: {
        total: totalFromEbay || keptCount,
        returned: pageGroups.length,
        cards: pageGroups.length,
        page,
        perPage,
        broaden,
        sort: sort || "bestprice",
        source: "ebay-browse",
      },
      analytics,
    });

  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
