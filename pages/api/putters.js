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
  if (h.includes("rover.ebay.")) return false; // let your direct ebay links remain direct
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

const offerTotalValue = (offer) => {
  const total = safeNum(offer?.total);
  if (total !== null) return total;
  return safeNum(offer?.price);
};

const norm = (s) => String(s || "").trim().toLowerCase();

const tokenize = (s) => {
  if (!s) return [];

  const normalized = norm(s);
  const tokenSet = new Set();

  const spaced = normalized
    .replace(/([a-z])([0-9])/gi, "$1 $2")
    .replace(/([0-9])([a-z])/gi, "$1 $2");

  spaced
    .replace(/[^a-z0-9]+/gi, " ")
    .split(" ")
    .map((t) => t.trim())
    .filter(Boolean)
    .forEach((t) => tokenSet.add(t));

  const alphaNumPattern = /[a-z]+[0-9]+|[0-9]+[a-z]+/g;
  let match;
  while ((match = alphaNumPattern.exec(normalized))) {
    tokenSet.add(match[0]);
  }

  const letterDigitWithGap = /([a-z])\s+([0-9]+)/g;
  while ((match = letterDigitWithGap.exec(normalized))) {
    tokenSet.add(`${match[1]}${match[2]}`);
  }

  const digitLetterWithGap = /([0-9]+)\s+([a-z])/g;
  while ((match = digitLetterWithGap.exec(normalized))) {
    tokenSet.add(`${match[1]}${match[2]}`);
  }

  return Array.from(tokenSet);
};

export { tokenize };

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

  // singularize "putters" → "putter"
  s = s.replace(/\bputters\b/gi, "putter");

  // guarantee exactly one "putter"
  if (!/\bputter\b/i.test(s)) s = `${s} putter`;
  s = s.replace(/\b(putter)(\s+\1)+\b/gi, "putter");

  return s.replace(/\s+/g, " ").trim();
}

// Recognize putter items (title, aspects, or category path)
function isLikelyPutter(item) {
  const title = norm(item?.title);
  if (/\bputter\b/.test(title)) return true;

  const aspects = [
    ...(Array.isArray(item?.itemSpecifics) ? item.itemSpecifics : []),
    ...(Array.isArray(item?.localizedAspects) ? item.localizedAspects : []),
    ...(Array.isArray(item?.additionalProductIdentities) ? item.additionalProductIdentities : []),
  ];
  for (const ent of aspects) {
    const n = norm(ent?.name);
    const v = norm(ent?.value ?? (Array.isArray(ent?.values) ? ent.values[0] : ""));
    if (!n) continue;
    if ((n.includes("putter") || n.includes("head type")) && (v || n.includes("putter"))) {
      return true;
    }
  }

  // Some responses include a category path list of strings or nodes—check loosely
  const cat = item?.categoryPath || item?.categoryPathIds || item?.categories;
  const asString = JSON.stringify(cat || "").toLowerCase();
  if (asString.includes("putter")) return true;

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
  const MALLET_KEYS = ["phantom", "fastback", "squareback", "futura", "mallet", "spider", "tyne", "inovai"];
  const BLADE_KEYS = ["newport", "anser", "tei3", "blade", "studio select", "special select", "bb", "queen b", "link"];
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
    else if (/blade|newport|anser|tei3|bb|queen b|link|inovai|spider|tyne/.test(s)) headType = "BLADE";
  }
  headType = headType || headTypeFromTitle(title);

  const length = parseLengthFromTitle(title);
  const hasHeadcover = /head\s*cover|\bhc\b|headcover/i.test(title);
  const shaftMatch = /slant|flow|plumber|single bend/i.exec(title);
  const shaft = shaftMatch ? shaftMatch[0] : null;

  // coarse family tagging (used for grouping key fallback)
  const FAMILIES = [
    // Cameron core & collectible
    "newport 2.5", "newport 2", "newport",
    "phantom 11.5", "phantom 11", "phantom 7.5", "phantom 7", "phantom 5.5", "phantom 5", "phantom x",
    "fastback", "squareback", "futura", "select", "special select",
    "studio select", "studio style", "studio design", "button back",
    "tei3", "tel3", "pro platinum", "oil can",
    "newport beach", "beach",
    "napa", "napa valley",
    "circle t", "tour rat", "009m", "009h", "009s", "009", "gss", "my girl",

    // TaylorMade / Odyssey / Ping / Bettinardi / LAB / Evnroll
    "anser", "tyne", "zing", "tomcat", "fetch",
    "spider", "spider x", "spider tour", "myspider",
    "two ball", "2-ball", "eleven", "seven", "#7", "#9", "versa", "jailbird",
    "bb", "queen b", "studio stock", "inovai",
    "mezz", "df", "link",
    "evnroll", "er1", "er2", "er5"
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

// -------------------- Limited / Collectible recall helpers --------------------
const GLOBAL_LIMITED_TOKENS = [
  "limited", "limited run", "limited edition", "le",
  "prototype", "proto", "tour issue", "tour only", "tour use", "tour dept",
  "japan only", "japan limited", "garage", "custom shop", "player issue",
  "beryllium", "becu", "copper", "dass", "damascus", "tiffany", "snow"
];

const BRAND_LIMITED_TOKENS = {
  // Scotty Cameron
  "scotty cameron": [
    "circle t", "tour rat", "009", "009m", "009h", "009s", "gss",
    "my girl", "button back", "oil can", "pro platinum",
    "newport beach", "napa", "napa valley", "studio design", "tei3", "tel3"
  ],
  // Bettinardi
  "bettinardi": [
    "hive", "tour stock", "dass", "bb0", "bb8", "bb8 flow", "bb8f",
    "tiki", "stinger", "damascus", "limited run", "tour dept"
  ],
  // TaylorMade
  "taylormade": [
    "spider limited", "spider tour", "itsy bitsy", "tour issue", "tour only"
  ],
  // Odyssey / Toulon
  "odyssey": [
    "tour issue", "tour only", "prototype", "japan limited", "ten limited", "eleven limited"
  ],
  "toulon": [
    "garage", "small batch", "tour issue", "tour only"
  ],
  // PING
  "ping": [
    "pld limited", "pld milled limited", "scottsdale tr", "anser becu", "anser copper", "vault"
  ],
  // L.A.B. Golf
  "l.a.b.": ["limited", "tour issue", "tour only", "df3 limited", "mezz limited"],
  "lab golf": ["limited", "tour issue", "tour only", "df3 limited", "mezz limited"],
  // Evnroll
  "evnroll": ["tour proto", "tour preferred", "v-series tourspec", "limited"],
  // Mizuno
  "mizuno": ["m-craft limited", "m craft limited", "copper", "japan limited"],
  // Wilson
  "wilson": ["8802 limited", "8802 copper", "tour issue"],
  // SIK / others
  "sik": ["tour issue", "limited", "prototype"],
};

const BRAND_ASSIST_ALIASES = [
  ...Object.keys(BRAND_LIMITED_TOKENS),
  "titleist",
  "scotty cameron",
  "bettinardi",
  "odyssey",
  "ping",
  "taylormade",
  "toulon",
  "evnroll",
  "lab golf",
];

const TRIVIAL_QUERY_TOKENS = (() => {
  const trivial = new Set(["putter", "putters", "golf", "club", "clubs"]);
  for (const alias of BRAND_ASSIST_ALIASES) {
    for (const token of tokenize(alias)) {
      if (token.length > 1) trivial.add(token);
    }
  }
  return trivial;
})();

function hasAnyToken(text, tokens) {
  const n = norm(text);
  return tokens.some(t => n.includes(norm(t)));
}

function detectBrandInText(text) {
  const n = norm(text);
  const brandAliases = Object.keys(BRAND_LIMITED_TOKENS).concat(["titleist"]); // titleist ~ cameron
  for (const b of brandAliases) {
    if (n.includes(norm(b))) return b;
  }
  return null;
}

function buildLimitedRecallQueries(rawQ, normalizedQ) {
  const qset = new Set();
  if (normalizedQ) qset.add(normalizedQ);

  const brandInQ = detectBrandInText(rawQ);
  const n = norm(rawQ);

  // Brand-specific assists
  for (const [brand, tokens] of Object.entries(BRAND_LIMITED_TOKENS)) {
    const brandMentioned = brandInQ && norm(brandInQ) === norm(brand);
    const tokensPresent = hasAnyToken(n, tokens);
    if (brandMentioned || tokensPresent) {
      qset.add(normalizeSearchQ(`${brand} ${rawQ}`));
      if (!/\bputter\b/i.test(rawQ)) qset.add(normalizeSearchQ(`${brand} ${rawQ} putter`));
    }
  }

  // Global limited words without a brand → add popular brand assists
  if (!brandInQ && hasAnyToken(n, GLOBAL_LIMITED_TOKENS)) {
    ["scotty cameron", "bettinardi", "odyssey", "ping", "taylormade", "toulon", "evnroll", "lab golf"].forEach(b =>
      qset.add(normalizeSearchQ(`${b} ${rawQ}`))
    );
  }

  // Cameron implied brand (user forgot “Scotty Cameron”)
  const impliesCameron = /\b(newport|phantom|futura|squareback|fastback|napa|tei3|tel3|button back|pro platinum|circle t|tour rat|009|009m|009h|009s|my girl|beach)\b/i.test(rawQ);
  if (!brandInQ && impliesCameron) {
    qset.add(normalizeSearchQ(`scotty cameron ${rawQ}`));
  }

  return Array.from(qset);
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
  if (forceCategory) url.searchParams.set("category_ids", "115280"); // Golf Clubs (covers putters)

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

  // Normalize + enforce "putters-only" semantics
  const rawQ = (sp.q || "").toString().trim();
  const q = normalizeSearchQ(rawQ);

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

  // Default: lock to Golf Clubs category (you can pass ?forceCategory=false to compare)
  const forceCategory = (sp.forceCategory || "true") !== "false";

  // Wider default sampling for better recall (override with ?samplePages=N up to 5)
  const samplePages = Math.max(1, Math.min(5, Number(sp.samplePages || 4)));

  if (!q) {
    return res.status(200).json({
      ok: true,
      groups: [],
      offers: [],
      hasNext: false,
      hasPrev: false,
      fetchedCount: 0,
      keptCount: 0,
      meta: { total: 0, returned: 0, cards: 0, page, perPage, sort, source: "ebay-browse" },
      analytics: { snapshot: null },
    });
  }

  try {
    const limit = 50;

    // Primary + limited/collectible recall variants
    const calls = [];
    const recallQs = buildLimitedRecallQueries(rawQ, q);
    for (const qq of recallQs) {
      for (let i = 0; i < samplePages; i++) {
        calls.push(fetchEbayBrowse({ q: qq, limit, offset: i * limit, sort, forceCategory }));
      }
    }

    let responses = await Promise.allSettled(calls);

    let items = [];
    let totalFromEbay = 0;
    for (const r of responses) {
      if (r.status === "fulfilled") {
        const data = r.value || {};
        totalFromEbay = Math.max(totalFromEbay, Number(data?.total || 0));
        const arr = Array.isArray(data?.itemSummaries) ? data.itemSummaries : [];
        items.push(...arr);
      }
    }

    // If recall is still low, try an alternate variant (remove plural entirely, keep "putter" once)
    if (items.length < 20) {
      const alt = normalizeSearchQ(rawQ.replace(/\bputters\b/gi, "").trim());
      if (alt && alt !== q) {
        const extra = await fetchEbayBrowse({ q: alt, limit, offset: 0, sort, forceCategory });
        const arr = Array.isArray(extra?.itemSummaries) ? extra.itemSummaries : [];
        items.push(...arr);
        totalFromEbay = Math.max(totalFromEbay, Number(extra?.total || 0));
      }
    }

    // Strict "putter only" filter
    items = items.filter(isLikelyPutter);

    const fetchedCount = items.length;

    // --- Map eBay → offers (UNCHANGED LOGIC) ---
    let ebayOffers = items.map((item) => {
      const image = item?.image?.imageUrl || item?.thumbnailImages?.[0]?.imageUrl || null;

      const shipping = pickCheapestShipping(item?.shippingOptions);
      const sellerPct = item?.seller?.feedbackPercentage ? Number(item.seller.feedbackPercentage) : null;
      const sellerScore = item?.seller?.feedbackScore ? Number(item.seller.feedbackScore) : null;
      const returnsAccepted = Boolean(item?.returnTerms?.returnsAccepted);
      const returnDays = item?.returnTerms?.returnPeriod?.value ? Number(item.returnTerms.returnPeriod.value) : null;
      const buying = {
        types: Array.isArray(item?.buyingOptions) ? item.buyingOptions : [],
        bidCount: item?.bidCount != null ? Number(item.bidCount) : null,
      };

      const specs = parseSpecsFromItem(item);
      const family = specs?.family || null;

      const itemPrice = safeNum(item?.price?.value);
      const shippingValue = Number.isFinite(shipping?.cost) ? shipping.cost : null;
      const total = itemPrice != null ? itemPrice + (shippingValue ?? 0) : itemPrice ?? null;

      const rawUrl = item?.itemWebUrl || item?.itemHref;
      const url = decorateEbayUrl(rawUrl);

      const modelKey = normalizeModelFromTitle(item?.title || "", family);

      return {
        productId: item?.itemId || item?.legacyItemId || item?.itemHref || item?.title,
        url,
        title: item?.title,
        retailer: "eBay",
        price: itemPrice,
        shipping: shippingValue,
        total,
        currency: item?.price?.currency || "USD",
        condition: item?.condition || null,
        createdAt: item?.itemCreationDate || item?.itemEndDate || item?.estimatedAvailDate || null,
        image,
        shippingDetails: shipping
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

    // ===== Append pro-shop sources (guarded) → mergedOffers =====
    let mergedOffers = Array.isArray(ebayOffers) ? ebayOffers.slice() : [];

    const includePro =
      sp.pro === "true" || sp.includePro === "true" || process.env.FORCE_INCLUDE_PRO === "true";

    if (includePro && process.env.ENABLE_2NDSWING === "true") {
      try {
        const origin =
          (req.headers["x-forwarded-proto"] ? `${req.headers["x-forwarded-proto"]}://` : "https://") +
          req.headers.host;

        const url2s = `${origin}/api/sources/2ndswing?q=${encodeURIComponent(q)}&limit=48`;
        const r2 = await fetch(url2s, {
          headers: { "user-agent": req.headers["user-agent"] || "Mozilla/5.0", "cache-control": "no-cache" },
          cache: "no-store",
        });

        if (r2.ok) {
          let proOffers = await r2.json();
          if (!Array.isArray(proOffers)) proOffers = [];

          // Merge then de-dupe by URL (case-insensitive)
          mergedOffers = mergedOffers.concat(proOffers);
          const seenUrl = new Set();
          mergedOffers = mergedOffers.filter((o) => {
            const u = (o?.url || "").toLowerCase();
            if (!u || seenUrl.has(u)) return false;
            seenUrl.add(u);
            return true;
          });
        }
      } catch {
        // Never let a flaky source break eBay results
      }
    }
    // ===== end pro-shop append =====

    // De-dupe obvious clones (same seller + same title + same price)
    const seen = new Set();
    mergedOffers = mergedOffers.filter((o) => {
      const key = `${(o.seller?.username || "").toLowerCase()}|${(o.title || "").toLowerCase()}|${o.price ?? "?"}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const queryTokens = Array.from(
      new Set(
        tokenize(rawQ)
          .map((t) => t.trim())
          .filter((t) => (t.length > 1 || /\d/.test(t)) && !TRIVIAL_QUERY_TOKENS.has(t))
      )
    );

    if (queryTokens.length) {
      // Enforce normalized title-token matches before other filters so downstream logic sees focused offers.
      mergedOffers = mergedOffers.filter((o) => {
        const titleTokens = new Set(
          tokenize(o?.title)
            .map((t) => t.trim())
            .filter((t) => t.length > 1 || /\d/.test(t))
        );
        return queryTokens.every((tok) => titleTokens.has(tok));
      });
    }

    // Track drops for debugging
    let droppedNoPrice = 0;
    let droppedNoImage = 0;

    if (onlyComplete) {
      mergedOffers = mergedOffers.filter((o) => {
        const ok = typeof o.price === "number" && o.image;
        if (!ok) {
          if (typeof o.price !== "number") droppedNoPrice++;
          if (!o.image) droppedNoImage++;
        }
        return ok;
      });
    }

    if (minPrice != null) mergedOffers = mergedOffers.filter((o) => typeof o.price === "number" && o.price >= minPrice);
    if (maxPrice != null) mergedOffers = mergedOffers.filter((o) => typeof o.price === "number" && o.price <= maxPrice);

    if (conds.length) {
      const set = new Set(conds.map((s) => s.toUpperCase()));
      mergedOffers = mergedOffers.filter((o) => o?.condition && set.has(String(o.condition).toUpperCase()));
    }

    if (buyingOptions.length) {
      const set = new Set(buyingOptions.map((s) => s.toUpperCase()));
      mergedOffers = mergedOffers.filter((o) => {
        const types = Array.isArray(o?.buying?.types) ? o.buying.types : [];
        return types.some((t) => set.has(String(t).toUpperCase()));
      });
    }

    if (dex === "LEFT" || dex === "RIGHT") {
      mergedOffers = mergedOffers.filter((o) => (o?.specs?.dexterity || "").toUpperCase() === dex);
    }
    if (head === "BLADE" || head === "MALLET") {
      mergedOffers = mergedOffers.filter((o) => (o?.specs?.headType || "").toUpperCase() === head);
    }
    if (lengthList.length) {
      mergedOffers = mergedOffers.filter((o) => {
        const L = Number(o?.specs?.length);
        if (!Number.isFinite(L)) return false;
        return lengthList.some((sel) => Math.abs(L - sel) <= 0.5);
      });
    }

    // ----- server-side sort BEFORE slicing so other sources can appear on page 1 -----
    if (sort === "newlylisted") {
      mergedOffers.sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      });
    } else if (sort === "best_price_desc") {
      mergedOffers.sort((a, b) => {
        const av = offerTotalValue(a);
        const bv = offerTotalValue(b);
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return bv - av;
      });
    } else if (sort === "model_asc") {
      // Use title as a proxy for model in flat view
      mergedOffers.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    } else if (sort === "count_desc") {
      // Not meaningful in flat view; keep as no-op
    } else {
      // default = best_price_asc to match UI default
      mergedOffers.sort((a, b) => {
        const av = offerTotalValue(a);
        const bv = offerTotalValue(b);
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return av - bv;
      });
    }


    const keptCount = mergedOffers.length;

    // lightweight analytics for the snapshot
    const analytics = (() => {
      const byHead = { BLADE: 0, MALLET: 0 };
      const byDex = { LEFT: 0, RIGHT: 0 };
      const byLen = { 33: 0, 34: 0, 35: 0, 36: 0 };
      for (const o of mergedOffers) {
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

    // ===== FLAT MODE =====
    if (!group) {
      const start = (page - 1) * perPage;
      const pageOffers = mergedOffers.slice(start, start + perPage);
      return res.status(200).json({
        ok: true,
        offers: pageOffers,
        groups: [],
        hasNext: start + perPage < keptCount,
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
          source: "merged",
          sources: Array.from(new Set(mergedOffers.map(o => o.retailer))).sort(),
          debug: { droppedNoPrice, droppedNoImage, totalFromEbay }
        },
        analytics,
      });
    }

    // ===== GROUPED MODE =====
    const groupsMap = new Map();
    for (const o of mergedOffers) {
      const key = o.__model || "unknown";
      if (!groupsMap.has(key)) {
        const initialPrice = safeNum(o?.price);
        const initialTotal = offerTotalValue(o);
        groupsMap.set(key, {
          model: key,
          image: o.image || null,
          bestPrice: initialPrice,
          bestTotal: initialTotal,
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

      const priceVal = safeNum(o?.price);
      if (priceVal !== null && (g.bestPrice == null || priceVal < g.bestPrice)) {
        g.bestPrice = priceVal;
      }

      const totalVal = offerTotalValue(o);
      if (totalVal !== null && (g.bestTotal == null || totalVal < g.bestTotal)) {
        g.bestTotal = totalVal;
        g.bestCurrency = o.currency || g.bestCurrency || "USD";
        if (o.image) g.image = o.image;
      }
    }

    let groups = Array.from(groupsMap.values()).map((g) => ({
      ...g,
      retailers: Array.from(g.retailers),
      offers: g.offers.sort((a, b) => {
        const av = offerTotalValue(a);
        const bv = offerTotalValue(b);
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return av - bv;
      }),
    }));

    if (sort === "newlylisted") {
      groups.sort((a, b) => {
        const ta = a.offers.length
          ? Math.max(...a.offers.map((o) => (o.createdAt ? new Date(o.createdAt).getTime() : 0)))
          : 0;
        const tb = b.offers.length
          ? Math.max(...b.offers.map((o) => (o.createdAt ? new Date(o.createdAt).getTime() : 0)))
          : 0;
        return tb - ta; // newest groups first
      });
    } else if (sort === "best_price_desc") {
      groups.sort((a, b) => {
        const av = safeNum(a?.bestTotal);
        const bv = safeNum(b?.bestTotal);
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return bv - av;
      });
    } else if (sort === "model_asc") {
      groups.sort((a, b) => (a.model || "").localeCompare(b.model || ""));
    } else if (sort === "count_desc") {
      groups.sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
    } else {
      groups.sort((a, b) => {
        const av = safeNum(a?.bestTotal);
        const bv = safeNum(b?.bestTotal);
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return av - bv;
      });
    }

    const start = (page - 1) * perPage;
    const pageGroups = groups.slice(start, start + perPage);

    return res.status(200).json({
      ok: true,
      groups: pageGroups,
      offers: [],
      hasNext: start + perPage < groups.length,
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
        source: "merged",
        sources: Array.from(new Set(mergedOffers.map(o => o.retailer))).sort(),
        debug: { droppedNoPrice, droppedNoImage, totalFromEbay },
      },
      analytics,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
