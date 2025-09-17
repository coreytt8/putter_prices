/* eslint-disable no-console */

/**
 * Required ENV (Vercel + .env.local):
 * EBAY_CLIENT_ID
 * EBAY_CLIENT_SECRET
 * EBAY_SITE=EBAY_US
 *
 * Optional EPN affiliate params (campid is the important one):
 * EPN_CAMPID=YOUR_CAMPAIGN_ID
 * EPN_CUSTOMID=putteriq
 * EPN_TOOLID=10001
 * EPN_MKCID=1
 * EPN_MKRID=711-53200-19255-0
 * EPN_SITEID=0
 * EPN_MKEVT=1
 */

const EBAY_BROWSE_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const EBAY_SITE = process.env.EBAY_SITE || "EBAY_US";

/** ===== Accessory/parts keywords to EXCLUDE (title-only) ===== */
const ACCESSORY_NEGATIVE = [
  "headcover", "head cover", "cover only", "hc",
  "grip", "grip only", "superstroke", "super stroke",
  "shaft", "shaft only",
  "weight", "weights", "weight kit",
  "sole plate", "alignment aid", "hosel only", "adapter",
  "sight dot", "dot kit", "alignment line",
  "wrench", "tool", "tool kit",
  "stickers", "decal", "wrap", "tape",
  "practice aid", "training aid", "putting mirror", "putting mat"
];

/** ===== Non-putter club types to EXCLUDE (title & aspects) ===== */
const NON_PUTTER_NEGATIVE = [
  "driver", "drivers",
  "fairway", "3 wood", "5 wood", "7 wood", "wood", "woods",
  "hybrid", "rescue", "utility",
  "iron", "irons", "iron set", "combo set", "complete set", "full set", "set of",
  "wedge", "wedges", "sand wedge", "lob wedge", "gap wedge",
  "chipper", "chip putter" // “chip putter” is not a real putter
];

/** ===== Brand/model cues used to derive relevance tokens ===== */
const BRAND_KEYWORDS = [
  "scotty cameron", "cameron", "titleist",
  "taylormade", "tm", "spider", "truss",
  "ping", "anser", "tyne", "fetch", "tomcat", "zing",
  "odyssey", "two ball", "2-ball", "eleven", "seven", "#7", "#9", "versa", "white hot", "stroke lab", "jailbird",
  "bettinardi", "bb", "queen b", "studio stock", "inovai",
  "l.a.b.", "lab golf", "lab", "mezz", "df", "link",
  "evnroll", "evn", "eveneroll", "er1", "er2", "er5",
  "wilson", "mizuno", "cleveland", "srixon",
  "logan olson", "olson"
];

const MODEL_KEYWORDS = [
  "newport", "newport 2", "newport 2.5",
  "phantom", "fastback", "squareback", "futura", "tei3", "studio select", "special select",
  "anser", "tyne", "zing", "tomcat", "fetch",
  "spider", "spider x", "spider tour", "myspider",
  "two ball", "2-ball", "eleven", "seven", "#7", "#9", "versa", "jailbird", "white hot",
  "bb", "queen b", "studio stock", "inovai",
  "mezz", "df", "link",
  "evnroll", "er1", "er2", "er5"
];

// -------------------- EPN affiliate decorator --------------------
const EPN = {
  campid: process.env.EPN_CAMPID || "",
  customid: process.env.EPN_CUSTOMID || "",
  toolid: process.env.EPN_TOOLID || "10001",
  mkcid: process.env.EPN_MKCID || "1",
  mkrid: process.env.EPN_MKRID || "711-53200-19255-0",
  siteid: process.env.EPN_SITEID || "0",
  mkevt: process.env.EPN_MKEVT || "1",
};

function isEbayHost(hostname) {
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  if (h.includes("rover.ebay.")) return false;
  return h.includes(".ebay.");
}

function decorateEbayUrl(raw, overrides = {}) {
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    if (!isEbayHost(u.hostname)) return raw;

    const campid = overrides.campid ?? EPN.campid;
    if (!campid) return raw;

    const params = {
      mkcid: overrides.mkcid ?? EPN.mkcid,
      mkrid: overrides.mkrid ?? EPN.mkrid,
      siteid: overrides.siteid ?? EPN.siteid,
      campid,
      customid: overrides.customid ?? EPN.customid,
      toolid: overrides.toolid ?? EPN.toolid,
      mkevt: overrides.mkevt ?? EPN.mkevt,
    };
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && String(v).length) {
        u.searchParams.set(k, String(v));
      }
    }
    return u.toString();
  } catch {
    return raw;
  }
}

// -------------------- Token --------------------
let _tok = { val: null, exp: 0 };

async function getEbayToken() {
  const now = Date.now();
  if (_tok.val && now < _tok.exp) return _tok.val;

  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Missing EBAY_CLIENT_ID/EBAY_CLIENT_SECRET");

  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
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

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`eBay OAuth ${res.status}: ${txt}`);
  }

  const json = await res.json();
  const ttl = (json.expires_in || 7200) * 1000;
  _tok = { val: json.access_token, exp: Date.now() + ttl - 10 * 60 * 1000 };
  return _tok.val;
}

// -------------------- Helpers --------------------
const safeNum = (n) => {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
};

const norm = (s) => String(s || "").trim().toLowerCase();

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

/** Ensure every query is about putters (and improve recall) */
function normalizeSearchQ(q = "") {
  let s = String(q || "").trim();
  if (!s) return s;

  s = s.replace(/\bputters\b/gi, "putter");
  if (!/\bputter\b/i.test(s)) s = `${s} putter`;
  s = s.replace(/\b(putter)(\s+\1)+\b/gi, "putter");

  return s.replace(/\s+/g, " ").trim();
}

/** Recognize putter items and reject non-putter clubs/accessories */
function isLikelyPutter(item) {
  const title = norm(item?.title || "");

  // Reject accessories
  if (ACCESSORY_NEGATIVE.some(k => title.includes(k))) return false;

  // Reject non-putter club types by title
  if (NON_PUTTER_NEGATIVE.some(k => title.includes(k))) return false;

  // Positive title signal
  if (/\bputter\b/.test(title)) return true;

  // Aspects: reject non-putter club types and accept explicit putter signals
  const aspects = [
    ...(Array.isArray(item?.itemSpecifics) ? item.itemSpecifics : []),
    ...(Array.isArray(item?.localizedAspects) ? item.localizedAspects : []),
    ...(Array.isArray(item?.additionalProductIdentities) ? item.additionalProductIdentities : []),
  ];

  let aspectPositive = false;

  for (const ent of aspects) {
    const n = norm(ent?.name);
    const v = norm(ent?.value ?? (Array.isArray(ent?.values) ? ent.values[0] : ""));

    if (!n) continue;

    // Fast reject on non-putter club type
    if (n.includes("club type") && v) {
      if (/(driver|wood|hybrid|iron|wedge|chipper)/.test(v)) return false;
      if (/putter/.test(v)) aspectPositive = true;
    }

    // Other positive hints
    if (n.includes("putter")) aspectPositive = true;
    if ((n.includes("head type") || n.includes("putter head")) && v) aspectPositive = true;

    // Also reject accessories via aspects
    if (ACCESSORY_NEGATIVE.some(k => (v || "").includes(k))) return false;
  }

  if (aspectPositive) return true;

  // Category breadcrumb text (when present)
  const cat = item?.categoryPath || item?.categoryPathIds || item?.categories;
  const asString = JSON.stringify(cat || "").toLowerCase();
  if (asString.includes("putter")) return true;

  // Model cues that are overwhelmingly putter families
  const t = title;
  const putterModelCue = MODEL_KEYWORDS.some(k => t.includes(k));
  if (putterModelCue) return true;

  return false;
}

function pickAspect(item, names = []) {
  const lists = [item?.itemSpecifics, item?.localizedAspects, item?.additionalProductIdentities].filter(Boolean);
  for (const list of lists) {
    for (const ent of list) {
      const n = norm(ent?.name);
      if (!n) continue;
      if (names.some((k) => n === norm(k))) {
        const v = ent?.value ?? ent?.values?.[0];
        if (v) return String(v);
      }
    }
  }
  return null;
}

function coerceDex(val) {
  const s = norm(val);
  if (!s) return null;
  if (/\bl(h|eft)\b|\bleft[-\s]?hand(ed)?\b/.test(s)) return "LEFT";
  if (/\br(h|ight)\b|\bright[-\s]?hand(ed)?\b/.test(s)) return "RIGHT";
  if (/^l\/h$|^l-h$|^l\s*h$/.test(s)) return "LEFT";
  if (/^r\/h$|^r-h$|^r\s*h$/.test(s)) return "RIGHT";
  return null;
}

function dexFromTitle(title = "") {
  const t = ` ${norm(title)} `;
  if (/(^|\W)l\/h(\W|$)|(^|\W)l-h(\W|$)|(^|\W)l\s*h(\W|$)|(^|\W)lh(\W|$)|\bleft[-\s]?hand(?:ed)?\b/.test(t)) return "LEFT";
  if (/(^|\W)r\/h(\W|$)|(^|\W)r-h(\W|$)|(^|\W)r\s*h(\W|$)|(^|\W)rh(\W|$)|\bright[-\s]?hand(?:ed)?\b/.test(t)) return "RIGHT";
  return null;
}

function headTypeFromTitle(title = "") {
  const t = norm(title);
  const MALLET_KEYS = ["phantom", "fastback", "squareback", "futura", "mallet", "spider", "inovai", "tyne"];
  const BLADE_KEYS  = ["newport", "anser", "tei3", "blade", "studio select", "special select", "bb", "queen b", "link"];
  if (MALLET_KEYS.some((k) => t.includes(k))) return "MALLET";
  if (BLADE_KEYS.some((k) => t.includes(k))) return "BLADE";
  return null;
}

function parseLengthFromTitle(title = "") {
  const t = norm(title);
  let length = null;
  const m1 = t.match(/(\d{2}(?:\.\d)?)\s*(?:\"|in\b|inch(?:es)?\b)/i);
  const m2 = t.match(/\b(32|33|34|35|36|37)\s*(?:\/|-)\s*(32|33|34|35|36|37)\b/);
  if (m1) length = Number(m1[1]);
  else if (m2) length = Math.max(Number(m2[1]), Number(m2[2]));
  return length;
}

function parseSpecsFromItem(item) {
  const title = item?.title || "";
  const dex = coerceDex(pickAspect(item, ["Dexterity", "Golf Club Dexterity", "Hand", "Handedness"])) || dexFromTitle(title);

  const aHead = pickAspect(item, ["Putter Head Type", "Head Type"]);
  let headType = null;
  if (aHead) {
    const s = norm(aHead);
    if (/mallet/.test(s)) headType = "MALLET";
    else if (/blade|newport|anser|tei3|bb|queen b|link|spider|tyne|inovai/.test(s)) headType = "BLADE";
  }
  headType = headType || headTypeFromTitle(title);

  const length = parseLengthFromTitle(title);
  const hasHeadcover = /head\s*cover|\bhc\b|headcover/i.test(title);
  const shaftMatch = /slant|flow|plumber|single bend/i.exec(title);
  const shaft = shaftMatch ? shaftMatch[0] : null;

  const FAMILIES = [
    "newport 2.5", "newport 2", "newport",
    "phantom 11.5", "phantom 11", "phantom 5.5", "phantom 5",
    "fastback", "squareback", "futura", "tei3",
    "studio select", "special select", "anser", "spider", "tyne", "inovai", "bb", "queen b", "link"
  ];
  let family = null;
  const tl = norm(title);
  for (const k of FAMILIES) { if (tl.includes(k)) { family = k; break; } }

  return { length, family, headType, dexterity: dex, hasHeadcover, shaft };
}

function normalizeModelFromTitle(title = "", fallbackFamily = null) {
  if (fallbackFamily) return fallbackFamily;
  const t = title
    .toLowerCase()
    .replace(/scotty\s*cameron|titleist|putter|golf|\b(rh|lh)\b|right\s*hand(ed)?|left\s*hand(ed)?/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = t.split(" ").filter(Boolean).slice(0, 4);
  return tokens.length ? tokens.join(" ") : (title || "unknown").slice(0, 50);
}

/** Build recall queries — broad variants only if broaden=true */
function buildRecallQueries(rawQ, broaden) {
  const n = norm(rawQ || "");
  const variants = new Set();

  const normalized = normalizeSearchQ(rawQ || "");
  if (normalized) variants.add(normalized);
  if (rawQ && rawQ.trim()) variants.add(rawQ.trim());

  const hintedBrands = BRAND_KEYWORDS.filter(k => n.includes(k));
  const hintedModels = MODEL_KEYWORDS.filter(k => n.includes(k));
  const baseTokens = [...new Set([...hintedBrands, ...hintedModels])];
  baseTokens.forEach(t => {
    variants.add(t);
    variants.add(`${t} putter`);
  });

  if (broaden) {
    variants.add("putter");
    variants.add("golf putter");
  }

  if (/\bputters\b/i.test(rawQ || "")) {
    const alt = normalizeSearchQ(String(rawQ || "").replace(/\bputters\b/gi, "").trim());
    if (alt) variants.add(alt);
  }

  return Array.from(variants).slice(0, 12);
}

// -------------------- eBay fetch --------------------
async function fetchEbayBrowse({ q, limit = 50, offset = 0, sort, forceCategory }) {
  const token = await getEbayToken();

  const url = new URL(EBAY_BROWSE_URL);
  url.searchParams.set("q", q || "");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("fieldgroups", "EXTENDED");
  if (sort === "newlylisted") url.searchParams.set("sort", "newlyListed");
  if (forceCategory) url.searchParams.set("category_ids", "115280"); // Golf Clubs umbrella

  async function call(bearer) {
    return fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${bearer}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-EBAY-C-MARKETPLACE-ID": EBAY_SITE,
        "X-EBAY-C-ENDUSERCTX": `contextualLocation=${EBAY_SITE}`,
      },
    });
  }

  let res = await call(token);
  if (res.status === 401 || res.status === 403) {
    _tok = { val: null, exp: 0 };
    const fresh = await getEbayToken();
    res = await call(fresh);
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`eBay Browse error ${res.status}: ${txt}`);
  }
  return res.json();
}

// -------------------- API Route --------------------
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method Not Allowed" });

  const sp = req.query;

  const rawQ = (sp.q || "").toString().trim();
  if (!rawQ) {
    return res.status(200).json({
      ok: true,
      groups: [],
      offers: [],
      hasNext: false,
      hasPrev: false,
      fetchedCount: 0,
      keptCount: 0,
      meta: { total: 0, returned: 0, cards: 0, page: 1, perPage: 10, sort: "default", source: "ebay-browse" },
      analytics: { snapshot: null },
    });
  }

  const group = (sp.group || "true") === "true";
  const onlyComplete = sp.onlyComplete === "true";
  const minPrice = safeNum(sp.minPrice);
  const maxPrice = safeNum(sp.maxPrice);
  const conds = (sp.conditions || "").toString().split(",").map((s) => s.trim()).filter(Boolean);
  const buyingOptions = (sp.buyingOptions || "").toString().split(",").map((s) => s.trim()).filter(Boolean);
  const sort = (sp.sort || "").toString();

  const dex = (sp.dex || "").toString().toUpperCase();
  const head = (sp.head || "").toString().toUpperCase();
  const lengthsParam = (sp.lengths || "").toString().trim();
  const lengthList = lengthsParam ? lengthsParam.split(",").map(Number).filter(Number.isFinite) : [];

  const page = Math.max(1, Number(sp.page || "1"));
  const perPage = Math.max(1, Math.min(50, Number(sp.perPage || "10")));

  const forceCategory = (sp.forceCategory || "true") !== "false";
  const samplePages = Math.max(1, Math.min(5, Number(sp.samplePages || 4)));
  const broaden = (sp.broaden || "").toString() === "true";

  try {
    const limit = 50;

    // Build recall strategies (broad ones only if broaden=true)
    const queries = buildRecallQueries(rawQ, broaden);
    const pagesToTry = broaden ? Math.min(5, samplePages + 1) : samplePages;

    // Fan out across queries & pages
    const calls = [];
    for (const q of queries) {
      for (let i = 0; i < pagesToTry; i++) {
        calls.push(fetchEbayBrowse({ q, limit, offset: i * limit, sort, forceCategory }));
      }
    }

    const results = await Promise.allSettled(calls);

    // Collect unique items
    const rawSeen = new Set();
    let items = [];
    let totalFromEbay = 0;

    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      const data = r.value || {};
      totalFromEbay = Math.max(totalFromEbay, Number(data?.total || 0));
      const arr = Array.isArray(data?.itemSummaries) ? data.itemSummaries : [];
      for (const it of arr) {
        const key =
          (it?.itemId || it?.legacyItemId || "") +
          "|" + (it?.itemHref || "") +
          "|" + (it?.title || "");
        if (rawSeen.has(key)) continue;
        rawSeen.add(key);
        items.push(it);
      }
    }

    // Quick title-level exclusions
    items = items.filter((it) => {
      const t = norm(it?.title || "");
      if (ACCESSORY_NEGATIVE.some(k => t.includes(k))) return false;
      if (NON_PUTTER_NEGATIVE.some(k => t.includes(k))) return false;
      return true;
    });

    // Strict “putter-only” acceptance via heuristic (NO umbrella category pass)
    items = items.filter(isLikelyPutter);

    /** Brand/Model relevance guard (same as before) */
    const n = norm(rawQ);
    const hintedBrands = BRAND_KEYWORDS.filter(k => n.includes(k));
    const hintedModels = MODEL_KEYWORDS.filter(k => n.includes(k));
    const relevanceTokens = [...new Set([...hintedBrands, ...hintedModels])];

    if (relevanceTokens.length && !broaden) {
      const tokens = relevanceTokens.map(t => norm(t));
      items = items.filter((it) => {
        const title = norm(it?.title || "");
        if (tokens.some(tok => title.includes(tok))) return true;

        const lists = [it?.itemSpecifics, it?.localizedAspects, it?.additionalProductIdentities].filter(Boolean);
        for (const list of lists) {
          for (const ent of list) {
            const v = norm(ent?.value ?? (Array.isArray(ent?.values) ? ent.values[0] : ""));
            if (tokens.some(tok => v.includes(tok))) return true;
          }
        }
        return false;
      });
    }

    const fetchedCount = items.length;

    // Map → offers
    let offers = items.map((item) => {
      const image = item?.image?.imageUrl || item?.thumbnailImages?.[0]?.imageUrl || null;

      const shipping = pickCheapestShipping(item?.shippingOptions);
      const sellerPct = item?.seller?.feedbackPercentage ? Number(item.seller.feedbackPercentage) : null;
      const sellerScore = item?.seller?.feedbackScore ? Number(item.seller?.feedbackScore) : null;
      const returnsAccepted = Boolean(item?.returnTerms?.returnsAccepted);
      const returnDays = item?.returnTerms?.returnPeriod?.value ? Number(item.returnTerms.returnPeriod.value) : null;
      const buying = {
        types: Array.isArray(item?.buyingOptions) ? item.buyingOptions : [],
        bidCount: item?.bidCount != null ? Number(item.bidCount) : null,
      };

      const specs = parseSpecsFromItem(item);
      const family = specs?.family || null;

      const itemPrice = safeNum(item?.price?.value);
      const shipCost = shipping?.cost ?? 0;
      const totalPrice = itemPrice != null && shipCost != null ? itemPrice + shipCost : itemPrice ?? null;

      const rawUrl = item?.itemWebUrl || item?.itemHref;
      const url = decorateEbayUrl(rawUrl);

      const modelKey = normalizeModelFromTitle(item?.title || "", family);

      return {
        productId: item?.itemId || item?.legacyItemId || item?.itemHref || item?.title,
        url,
        title: item?.title,
        retailer: "eBay",
        price: itemPrice,
        currency: item?.price?.currency || "USD",
        condition: item?.condition || null,
        createdAt: item?.itemCreationDate || item?.itemEndDate || item?.estimatedAvailDate || null,
        image,

        totalPrice,
        shipping: shipping
          ? {
              cost: shipping.cost,
              currency: shipping.currency || item?.price?.currency || "USD",
              free: Boolean(shipping.free),
              type: shipping.type || null,
            }
          : null,
        seller: { feedbackPct: sellerPct, feedbackScore: sellerScore, username: item?.seller?.username || null },
        location: { country: item?.itemLocation?.country || null, postalCode: item?.itemLocation?.postalCode || null },
        returns: { accepted: returnsAccepted, days: returnDays },
        buying,
        specs, // { length, family, headType, dexterity, hasHeadcover, shaft }
        __model: modelKey,
      };
    });

    // De-dupe obvious clones (same seller + same title + same price)
    const seen = new Set();
    offers = offers.filter((o) => {
      const key = `${(o.seller?.username || "").toLowerCase()}|${(o.title || "").toLowerCase()}|${o.price ?? "?"}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    let droppedNoPrice = 0;
    let droppedNoImage = 0;

    if (onlyComplete) {
      offers = offers.filter((o) => {
        const ok = typeof o.price === "number" && o.image;
        if (!ok) {
          if (typeof o.price !== "number") droppedNoPrice++;
          if (!o.image) droppedNoImage++;
        }
        return ok;
      });
    }

    if (minPrice != null) offers = offers.filter((o) => typeof o.price === "number" && o.price >= minPrice);
    if (maxPrice != null) offers = offers.filter((o) => typeof o.price === "number" && o.price <= maxPrice);

    if (conds.length) {
      const set = new Set(conds.map((s) => s.toUpperCase()));
      offers = offers.filter((o) => o?.condition && set.has(String(o.condition).toUpperCase()));
    }

    if (buyingOptions.length) {
      const set = new Set(buyingOptions.map((s) => s.toUpperCase()));
      offers = offers.filter((o) => {
        const types = Array.isArray(o?.buying?.types) ? o.buying.types : [];
        return types.some((t) => set.has(String(t).toUpperCase()));
      });
    }

    if (dex === "LEFT" || dex === "RIGHT") {
      offers = offers.filter((o) => (o?.specs?.dexterity || "").toUpperCase() === dex);
    }
    if (head === "BLADE" || head === "MALLET") {
      offers = offers.filter((o) => (o?.specs?.headType || "").toUpperCase() === head);
    }
    if (lengthList.length) {
      offers = offers.filter((o) => {
        const L = Number(o?.specs?.length);
        if (!Number.isFinite(L)) return false;
        return lengthList.some((sel) => Math.abs(L - sel) <= 0.5);
      });
    }

    if (sort === "newlylisted") {
      offers.sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      });
    }

    const keptCount = offers.length;

    // lightweight analytics for the snapshot
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
        if (Number.isFinite(L)) {
          const nearest = [33, 34, 35, 36].reduce((p, c) => (Math.abs(c - L) < Math.abs(p - L) ? c : p), 34);
          if (Math.abs(nearest - L) <= 0.5) byLen[nearest]++;
        }
      }
      return { snapshot: { byHead, byDex, byLen } };
    })();

    const hasNext = (arrLen, p, pp) => p * pp < arrLen;

    if (!group) {
      const start = (page - 1) * perPage;
      const pageOffers = offers.slice(start, start + perPage);
      return res.status(200).json({
        ok: true,
        offers: pageOffers,
        groups: [],
        hasNext: hasNext(offers.length, page, perPage),
        hasPrev: page > 1,
        fetchedCount,
        keptCount,
        meta: {
          total: keptCount,
          returned: pageOffers.length,
          cards: pageOffers.length,
          page,
          perPage,
          sort: sort || "default",
          source: "ebay-browse",
          debug: {
            droppedNoPrice, droppedNoImage, totalFromEbay,
            recallQueries: queries,
            samplePages: pagesToTry,
            forceCategory,
            broaden,
            fetchedCount
          },
        },
        analytics,
      });
    }

    // Grouped
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
        const ta = a.offers.length
          ? Math.max(...a.offers.map((o) => (o.createdAt ? new Date(o.createdAt).getTime() : 0)))
          : 0;
        const tb = b.offers.length
          ? Math.max(...b.offers.map((o) => (o.createdAt ? new Date(b.createdAt).getTime() : 0)))
          : 0;
        return tb - ta;
      });
    } else {
      groups.sort((a, b) => (a.bestPrice ?? Infinity) - (b.bestPrice ?? Infinity));
    }

    const start = (page - 1) * perPage;
    const pageGroups = groups.slice(start, start + perPage);

    return res.status(200).json({
      ok: true,
      groups: pageGroups,
      offers: [],
      hasNext: hasNext(groups.length, page, perPage),
      hasPrev: page > 1,
      fetchedCount,
      keptCount,
      meta: {
        total: groups.length,
        returned: pageGroups.length,
        cards: pageGroups.length,
        page,
        perPage,
        sort: sort || "bestprice",
        source: "ebay-browse",
        debug: {
          droppedNoPrice, droppedNoImage, totalFromEbay,
          recallQueries: queries,
          samplePages: pagesToTry,
          forceCategory,
          broaden,
          fetchedCount
        },
      },
      analytics,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
