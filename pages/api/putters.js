/* eslint-disable no-console */

import { decorateEbayUrl } from "../../lib/affiliate.js";
import { detectDexterity, extractLengthInches } from "../../lib/specs-parse.js";
import { containsAccessoryToken, stripAccessoryTokens } from "../../lib/sanitizeModelKey.js";

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

const CATEGORY_GOLF_CLUBS = "115280";
const CATEGORY_PUTTER_HEADCOVERS = "36278";
const HEAD_COVER_TOKEN_VARIANTS = new Set(["headcover", "headcovers", "hc"]);
const HEAD_COVER_TEXT_RX = /\bhead(?:[\s/_-]*?)cover(s)?\b|headcover(s)?|\bhc\b/i;
const ACCESSORY_BLOCK_PATTERN = /\b(shafts?|grips?|weights?)\b/i;
const HEAD_COVER_SPEC_DROP_TOKENS = new Set([
  "lh",
  "rh",
  "left",
  "right",
  "lefty",
  "righty",
  "lefthand",
  "righthand",
  "lefthanded",
  "righthanded",
  "hand",
  "handed",
  "in",
  "inch",
  "inches",
]);

const HEAD_COVER_LENGTH_TOKEN_RX = /^3[3-6](?:\.\d+)?$/;
const HEAD_COVER_LENGTH_SUFFIX_RX = /^3[3-6](?:in|inch|inches|"|”|“)?$/;
const DEX_SUFFIX_RX = /(lh|rh)$/i;

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

function resetTokenCache() {
  _tok = { val: null, exp: 0 };
}

// -------------------- Helpers --------------------
const safeNum = (n) => {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
};

const offerCost = (offer) => {
  if (!offer || typeof offer !== "object") return null;
  const total = safeNum(offer?.total);
  if (total != null) return total;
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

  const letterDigitWithGap = /([a-z]+)(?:[\s/_-]+)([0-9]+)/g;
  while ((match = letterDigitWithGap.exec(normalized))) {
    tokenSet.add(`${match[1]}${match[2]}`);
  }

  const digitLetterWithGap = /([0-9]+)(?:[\s/_-]+)([a-z]+)/g;
  while ((match = digitLetterWithGap.exec(normalized))) {
    tokenSet.add(`${match[1]}${match[2]}`);
  }

  if (HEAD_COVER_TEXT_RX.test(normalized)) {
    for (const variant of HEAD_COVER_TOKEN_VARIANTS) {
      tokenSet.add(variant);
    }
  }

  return Array.from(tokenSet);
};

const normalizeHeadcoverToken = (token) => String(token || "").trim().toLowerCase();

function isDexterityTokenForHeadcover(token) {
  const normalized = normalizeHeadcoverToken(token);
  if (!normalized) return false;
  if (HEAD_COVER_TOKEN_VARIANTS.has(normalized)) return false;
  if (HEAD_COVER_SPEC_DROP_TOKENS.has(normalized)) return true;
  if (/^(?:lh|rh)[0-9]+$/.test(normalized)) return true;
  if (/^[0-9]+(?:lh|rh)$/.test(normalized)) return true;
  if (detectDexterity(normalized)) return true;
  if (detectDexterity(`${normalized} hand`)) return true;
  return false;
}

function isLengthTokenForHeadcover(token) {
  const normalized = normalizeHeadcoverToken(token).replace(/[“”]/g, '"');
  if (!normalized) return false;
  if (HEAD_COVER_TOKEN_VARIANTS.has(normalized)) return false;

  if (HEAD_COVER_LENGTH_TOKEN_RX.test(normalized)) {
    const numeric = Number(normalized);
    if (Number.isFinite(numeric) && numeric >= 30 && numeric <= 40) return true;
    if (/\d/.test(normalized)) return true;
  }

  if (HEAD_COVER_LENGTH_SUFFIX_RX.test(normalized)) {
    return true;
  }

  const normalizedForExtract = normalized.replace(/inches$/, "inch");
  const lengthVal = extractLengthInches(normalizedForExtract);
  return Number.isFinite(lengthVal);
}

function shouldDropHeadcoverSpecToken(token) {
  const normalized = normalizeHeadcoverToken(token);
  if (!normalized) return false;
  if (HEAD_COVER_TOKEN_VARIANTS.has(normalized)) return false;

  if (isDexterityTokenForHeadcover(normalized) || isLengthTokenForHeadcover(normalized)) {
    return true;
  }

  const suffixMatch = normalized.match(DEX_SUFFIX_RX);
  if (suffixMatch) {
    const base = normalized.slice(0, -suffixMatch[0].length);
    if (isLengthTokenForHeadcover(base) || isDexterityTokenForHeadcover(base)) {
      return true;
    }
  }

  const prefixMatch = normalized.match(/^(lh|rh)/);
  if (prefixMatch) {
    const base = normalized.slice(prefixMatch[0].length);
    if (isLengthTokenForHeadcover(base)) {
      return true;
    }
  }

  return false;
}

function stripHeadcoverSpecTokens(tokens = []) {
  if (!Array.isArray(tokens) || tokens.length === 0) return [];
  return tokens.filter((token) => !shouldDropHeadcoverSpecToken(token));
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

function normalizeBidCountValue(value, seen = new Set()) {
  if (value == null) return null;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : null;
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.length === 1) return normalizeBidCountValue(value[0], seen);
    for (const entry of value) {
      const normalized = normalizeBidCountValue(entry, seen);
      if (normalized != null) return normalized;
    }
    return null;
  }

  if (typeof value === "object") {
    if (seen.has(value)) return null;
    seen.add(value);

    if (Object.prototype.hasOwnProperty.call(value, "__value__")) {
      const normalized = normalizeBidCountValue(value.__value__, seen);
      if (normalized != null) return normalized;
    }

    if (Object.prototype.hasOwnProperty.call(value, "value")) {
      const normalized = normalizeBidCountValue(value.value, seen);
      if (normalized != null) return normalized;
    }

    for (const entry of Object.values(value)) {
      const normalized = normalizeBidCountValue(entry, seen);
      if (normalized != null) return normalized;
    }
  }

  return null;
}

function canonicalizeHeadcoverPhrases(text = "") {
  if (!text) return "";
  return String(text)
    .replace(/\bhead(?:[\s/_-]*?)cover(?:s)?\b/gi, "headcover")
    .replace(/\bhc\b/gi, "headcover");
}

/** Ensure every query is about putters (and improve recall) */
function normalizeSearchQ(q = "") {
  let s = String(q || "").trim();
  if (!s) return s;

  const headcoverIntent = queryMentionsHeadcover(s);

  // singularize "putters" → "putter"
  s = s.replace(/\bputters\b/gi, "putter");

  if (headcoverIntent) {
    s = canonicalizeHeadcoverPhrases(s);
    // strip any lingering putter tokens when intent is clearly headcovers
    s = s.replace(/\bputter\b/gi, " ");
    s = canonicalizeHeadcoverPhrases(s);
  } else {
    // guarantee exactly one "putter"
    if (!/\bputter\b/i.test(s)) s = `${s} putter`;
    s = s.replace(/\b(putter)(\s+\1)+\b/gi, "putter");
  }

  return s.replace(/\s+/g, " ").trim();
}

// Recognize putter items (title, aspects, or category path)
function isLikelyPutter(item) {
  const title = norm(item?.title);
  if (/\bputter\b/.test(title)) {
    const tokens = title.split(/\s+/).filter(Boolean);
    const hasHeadcoverSignal = HEAD_COVER_TEXT_RX.test(title);
    if (!hasHeadcoverSignal) {
      const accessoryTokens = tokens.filter((token) => {
        const normalized = token.replace(/[^a-z0-9]/g, "").toLowerCase();
        if (!normalized || normalized === "putter") return false;
        if (HEAD_COVER_TOKEN_VARIANTS.has(normalized)) return false;
        return containsAccessoryToken(token);
      });

      const substantiveTokens = tokens.filter((token) => {
        const normalized = token.replace(/[^a-z0-9]/g, "").toLowerCase();
        if (!normalized || normalized === "putter") return false;
        if (HEAD_COVER_TOKEN_VARIANTS.has(normalized)) return false;
        return !containsAccessoryToken(token);
      });

      if (accessoryTokens.length && accessoryTokens.length >= substantiveTokens.length) {
        return false;
      }
    }
    return true;
  }

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

const BUYING_OPTION_NORMALIZATION = {
  AUCTION_WITH_BIN: "AUCTION",
};

function normalizeBuyingOption(value) {
  if (!value) return null;
  const upper = String(value).toUpperCase();
  return BUYING_OPTION_NORMALIZATION[upper] || upper;
}

function normalizeBuyingOptions(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const normalized = [];
  for (const entry of list) {
    const normalizedEntry = normalizeBuyingOption(entry);
    if (normalizedEntry && !seen.has(normalizedEntry)) {
      seen.add(normalizedEntry);
      normalized.push(normalizedEntry);
    }
  }
  return normalized;
}

function mapEbayItemToOffer(item) {
  if (!item) return null;

  const image = item?.image?.imageUrl || item?.thumbnailImages?.[0]?.imageUrl || null;
  const shipping = pickCheapestShipping(item?.shippingOptions);

  const sellerPct = item?.seller?.feedbackPercentage ? Number(item.seller.feedbackPercentage) : null;
  const sellerScore = item?.seller?.feedbackScore ? Number(item.seller.feedbackScore) : null;
  const returnsAccepted = Boolean(item?.returnTerms?.returnsAccepted);
  const returnDays = item?.returnTerms?.returnPeriod?.value ? Number(item.returnTerms.returnPeriod.value) : null;

  const sellingStatus = item?.sellingStatus;
  const sellingBidCount = Array.isArray(sellingStatus)
    ? sellingStatus.map((status) => status?.bidCount)
    : sellingStatus?.bidCount;

  const buying = {
    types: normalizeBuyingOptions(Array.isArray(item?.buyingOptions) ? item.buyingOptions : []),
    bidCount: normalizeBidCountValue(item?.bidCount ?? sellingBidCount),
  };

  const specs = parseSpecsFromItem(item);
  const family = specs?.family || null;

  const directPrice = safeNum(item?.price?.value);
  const bidPrice = safeNum(item?.currentBidPrice?.value);
  const itemPrice = directPrice != null ? directPrice : bidPrice;
  const shippingValue = Number.isFinite(shipping?.cost) ? shipping.cost : null;
  const total = itemPrice != null ? itemPrice + (shippingValue ?? 0) : null;
  const currency = item?.price?.currency || item?.currentBidPrice?.currency || "USD";

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
    currency,
    condition: item?.condition || null,
    createdAt: item?.itemCreationDate || item?.itemEndDate || item?.estimatedAvailDate || null,
    image,
    shippingDetails: shipping
      ? {
          cost: shipping.cost,
          currency: shipping.currency || currency,
          free: Boolean(shipping.free),
          type: shipping.type || null,
        }
      : null,
    seller: { feedbackPct: sellerPct, feedbackScore: sellerScore, username: item?.seller?.username || null },
    location: { country: item?.itemLocation?.country || null, postalCode: item?.itemLocation?.postalCode || null },
    returns: { accepted: returnsAccepted, days: returnDays },
    buying,
    specs,
    __model: modelKey,
  };
}

const __testables__ = {
  normalizeBuyingOptions,
  isLikelyPutter,
  queryMentionsHeadcover,
  normalizeSearchQ,
  buildLimitedRecallQueries,
  resetTokenCache,
};

export { tokenize, mapEbayItemToOffer, fetchEbayBrowse, __testables__ };

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
  const trivial = new Set(["putter", "putters", "golf", "club", "clubs", "signature"]);
  for (const alias of BRAND_ASSIST_ALIASES) {
    for (const token of tokenize(alias)) {
      if (token.length > 1) trivial.add(token);
    }
  }
  return trivial;
})();

const QUERY_TOKEN_SANITIZE_PATTERNS = [
  /\bcomes?\s+with\b/g,
  /\binclude[sd]?\b/g,
  /\bincluding\b/g,
  /\bwith\b/g,
  /\bsmall\s+batch\b/g,
];

function sanitizeQueryForTokens(raw = "") {
  const normalized = norm(raw);
  if (!normalized) return "";

  let sanitized = stripAccessoryTokens(normalized);
  for (const pattern of QUERY_TOKEN_SANITIZE_PATTERNS) {
    sanitized = sanitized.replace(pattern, " ");
  }

  return sanitized.replace(/\s+/g, " ").trim();
}

function queryMentionsHeadcover(raw = "") {
  if (!raw) return false;

  const normalized = norm(raw);
  if (!normalized) return false;
  if (HEAD_COVER_TEXT_RX.test(normalized)) return true;

  const rawTokens = tokenize(raw)
    .map((token) => norm(token))
    .filter(Boolean);
  if (rawTokens.some((token) => HEAD_COVER_TOKEN_VARIANTS.has(token))) {
    return true;
  }

  const sanitized = sanitizeQueryForTokens(raw);
  if (!sanitized) return false;

  const sanitizedNormalized = norm(sanitized);
  if (HEAD_COVER_TEXT_RX.test(sanitizedNormalized)) return true;

  const sanitizedTokens = tokenize(sanitized)
    .map((token) => norm(token))
    .filter(Boolean);
  return sanitizedTokens.some((token) => HEAD_COVER_TOKEN_VARIANTS.has(token));
}

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
  const headcoverIntent = queryMentionsHeadcover(rawQ);

  // Brand-specific assists
  for (const [brand, tokens] of Object.entries(BRAND_LIMITED_TOKENS)) {
    const brandMentioned = brandInQ && norm(brandInQ) === norm(brand);
    const tokensPresent = hasAnyToken(n, tokens);
    if (brandMentioned || tokensPresent) {
      qset.add(normalizeSearchQ(`${brand} ${rawQ}`));
      if (!headcoverIntent && !/\bputter\b/i.test(rawQ)) qset.add(normalizeSearchQ(`${brand} ${rawQ} putter`));
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
async function fetchEbayBrowse({
  q,
  limit = 50,
  offset = 0,
  sort,
  forceCategory,
  buyingOptions = [],
  hasBids = false,
}) {
  const token = await getEbayToken();

  const url = new URL(EBAY_BROWSE_URL);
  url.searchParams.set("q", q || "");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("fieldgroups", "EXTENDED");
  const normalizedSort = norm(sort);
  const sortMap = {
    newlylisted: "newlyListed",
    best_price_asc: "pricePlusShippingLowest",
    best_price_desc: "pricePlusShippingHighest",
  };
  const ebaySort = sortMap[normalizedSort];
  if (ebaySort) url.searchParams.set("sort", ebaySort);
  if (forceCategory) {
    const categoryIds = new Set([CATEGORY_GOLF_CLUBS]);
    if (queryMentionsHeadcover(q)) {
      categoryIds.add(CATEGORY_PUTTER_HEADCOVERS);
    }
    url.searchParams.set("category_ids", Array.from(categoryIds).join(","));
  }

  const filterParts = [];
  if (Array.isArray(buyingOptions) && buyingOptions.length) {
    const normalizedOptions = buyingOptions
      .map((opt) => normalizeBuyingOption(opt))
      .filter(Boolean);
    if (normalizedOptions.length) {
      filterParts.push(`buyingOptions:{${normalizedOptions.join("|")}}`);
    }
  }
  if (hasBids) {
    filterParts.push("bidCount:[1..]");
  }
  if (filterParts.length) {
    url.searchParams.set("filter", filterParts.join(","));
  }

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
  const normalizedBuyingOptionFilters = normalizeBuyingOptions(buyingOptions);
  const hasBids = (sp.hasBids || "").toString() === "true";
  const sort = (sp.sort || "").toString();
  const modelKeyParam = ((sp.modelKey ?? sp.model) || "").toString().trim();
  const normalizedModelParam = modelKeyParam ? norm(modelKeyParam) : "";

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
        calls.push(
          fetchEbayBrowse({
            q: qq,
            limit,
            offset: i * limit,
            sort,
            forceCategory,
            buyingOptions: normalizedBuyingOptionFilters,
            hasBids,
          })
        );
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
        const extra = await fetchEbayBrowse({
          q: alt,
          limit,
          offset: 0,
          sort,
          forceCategory,
          buyingOptions: normalizedBuyingOptionFilters,
          hasBids,
        });
        const arr = Array.isArray(extra?.itemSummaries) ? extra.itemSummaries : [];
        items.push(...arr);
        totalFromEbay = Math.max(totalFromEbay, Number(extra?.total || 0));
      }
    }

    const headcoverQuery = queryMentionsHeadcover(rawQ);

    // Strict "putter only" filter
    items = items.filter((item) => {
      if (isLikelyPutter(item)) return true;
      if (!headcoverQuery) return false;
      const title = norm(item?.title);
      return Boolean(title && HEAD_COVER_TEXT_RX.test(title));
    });

    if (headcoverQuery) {
      items = items.filter((item) => {
        const title = norm(item?.title);
        if (!title) return false;
        if (ACCESSORY_BLOCK_PATTERN.test(title)) return false;
        return true;
      });
    }

    const fetchedCount = items.length;

    // --- Map eBay → offers (UNCHANGED LOGIC) ---
    let ebayOffers = items.map((item) => mapEbayItemToOffer(item)).filter(Boolean);

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

    const sanitizedForTokens = sanitizeQueryForTokens(q);
    let baseTokenList = tokenize(sanitizedForTokens);
    const rawTokenList = tokenize(q);

    if (rawTokenList.some((token) => HEAD_COVER_TOKEN_VARIANTS.has(token))) {
      for (const variant of HEAD_COVER_TOKEN_VARIANTS) {
        baseTokenList.push(variant);
      }
    }

    const hasHeadcoverToken = baseTokenList.some((token) => HEAD_COVER_TOKEN_VARIANTS.has(token));

    if (hasHeadcoverToken) {
      baseTokenList = stripHeadcoverSpecTokens(baseTokenList);
    }

    const queryTokens = Array.from(
      new Set(
        baseTokenList
          .map((t) => t.trim())
          .filter((t) => {
            if (!t) return false;
            if (hasHeadcoverToken) {
              if (t === "head" || t === "cover" || t === "covers" || t === "headcovers") {
                return false;
              }
              if (t === "hc") {
                return false;
              }
              if (
                /^[0-9]+[hc]$/.test(t) ||
                /^[hc][0-9]+$/.test(t) ||
                /^[0-9]+(?:head|cover|covers)$/.test(t) ||
                /^(?:head|cover|covers)[0-9]+$/.test(t)
              ) {
                return false;
              }
            }
            return (t.length > 1 || /\d/.test(t)) && !TRIVIAL_QUERY_TOKENS.has(t);
          })
      )
    );

    if (queryTokens.length) {
      // Enforce normalized token matches before other filters so downstream logic sees focused offers.
      mergedOffers = mergedOffers.filter((o) => {
        const titleTokens = new Set(
          tokenize(o?.title)
            .map((t) => t.trim())
            .filter((t) => t.length > 1 || /\d/.test(t))
        );

        if (!normalizedModelParam) {
          return queryTokens.every((tok) => titleTokens.has(tok));
        }

        const offerModel = o?.__model ? norm(o.__model) : "";
        const matchesTargetModel = offerModel && offerModel === normalizedModelParam;
        if (!matchesTargetModel) {
          return queryTokens.every((tok) => titleTokens.has(tok));
        }

        const modelTokens = new Set(
          tokenize(o?.__model)
            .map((t) => t.trim())
            .filter((t) => t.length > 1 || /\d/.test(t))
        );

        return queryTokens.every((tok) => titleTokens.has(tok) || modelTokens.has(tok));
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

    if (normalizedBuyingOptionFilters.length) {
      const set = new Set(normalizedBuyingOptionFilters);
      mergedOffers = mergedOffers.filter((o) => {
        const types = normalizeBuyingOptions(o?.buying?.types);
        return types.some((t) => set.has(t));
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

    if (hasBids) {
      mergedOffers = mergedOffers.filter((o) => {
        const types = normalizeBuyingOptions(o?.buying?.types);
        const isAuction = types.includes("AUCTION");
        return isAuction && Number(o?.buying?.bidCount) > 0;
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
    const ac = offerCost(a);
    const bc = offerCost(b);
    return (bc ?? -Infinity) - (ac ?? -Infinity);
  });
} else if (sort === "best_price_asc") {
  mergedOffers.sort((a, b) => {
    const ac = offerCost(a);
    const bc = offerCost(b);
    return (ac ?? Infinity) - (bc ?? Infinity);
  });
} else if (sort === "model_asc") {
  // Use title as a proxy for model in flat view
  mergedOffers.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
} else if (sort === "count_desc") {
  // Not meaningful in flat view; keep as no-op
} else {
  // default = best_price_asc to match UI default
  mergedOffers.sort((a, b) => {
    const ac = offerCost(a);
    const bc = offerCost(b);
    return (ac ?? Infinity) - (bc ?? Infinity);
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
        groupsMap.set(key, {
          model: key,
          image: o.image || null,
          bestPrice: offerCost(o),
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
      const cost = offerCost(o);
      if (typeof cost === "number" && (g.bestPrice == null || cost < g.bestPrice)) {
        g.bestPrice = cost;
        g.bestCurrency = o.currency || g.bestCurrency || "USD";
        if (o.image) g.image = o.image;
      }
    }

    let groups = Array.from(groupsMap.values()).map((g) => ({
      ...g,
      retailers: Array.from(g.retailers),
      offers: g.offers.sort((a, b) => {
        const ac = offerCost(a);
        const bc = offerCost(b);
        return (ac ?? Infinity) - (bc ?? Infinity);
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
      groups.sort((a, b) => (b.bestPrice ?? -Infinity) - (a.bestPrice ?? -Infinity));
    } else if (sort === "best_price_asc") {
      groups.sort((a, b) => (a.bestPrice ?? Infinity) - (b.bestPrice ?? Infinity));
    } else if (sort === "model_asc") {
      groups.sort((a, b) => (a.model || "").localeCompare(b.model || ""));
    } else if (sort === "count_desc") {
      groups.sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
    } else {
      groups.sort((a, b) => (a.bestPrice ?? Infinity) - (b.bestPrice ?? Infinity));
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
