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

import * as cheerio from "cheerio";

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

  // singularize "putters" → "putter"
  s = s.replace(/\\bputters\\b/gi, "putter");

  // guarantee exactly one "putter"
  if (!/\\bputter\\b/i.test(s)) s = `${s} putter`;
  s = s.replace(/\\b(putter)(\\s+\\1)+\\b/gi, "putter");

  return s.replace(/\\s+/g, " ").trim();
}

// Recognize putter items (title, aspects, or category path)
function isLikelyPutter(item) {
  const title = norm(item?.title);
  if (/\\bputter\\b/.test(title)) return true;

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
  if (/\\bl(h|eft)\\b|\\bleft[-\\s]?hand(ed)?\\b/.test(s)) return "LEFT";
  if (/\\br(h|ight)\\b|\\bright[-\\s]?hand(ed)?\\b/.test(s)) return "RIGHT";
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
const m1 = t.match(/(\d{2}(?:\.\d)?)\s*(?:"|in\b|inch(?:es)?\b)/i);
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
  const hasHeadcover = /head\\s*cover|\\bhc\\b|headcover/i.test(title);
  const shaftMatch = /slant|flow|plumber|single bend/i.exec(title);
  const shaft = shaftMatch ? shaftMatch[0] : null;

  // coarse family tagging (used for grouping key fallback)
  const FAMILIES = [
    "newport 2.5", "newport 2", "newport",
    "phantom 11.5", "phantom 11", "phantom 7.5", "phantom 7", "phantom 5.5", "phantom 5", "phantom x",
    "fastback", "squareback", "futura", "select", "special select",
    "studio select", "studio style", "studio design", "button back",
    "tei3", "tel3", "pro platinum", "oil can",
    "newport beach", "beach",
    "napa", "napa valley",
    "circle t", "tour rat", "009m", "009h", "009s", "009", "gss", "my girl",
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
    .replace(/scotty\\s*cameron|titleist|putter|golf|\\b(rh|lh)\\b|right\\s*hand(ed)?|left\\s*hand(ed)?/g, "")
    .replace(/\\s+/g, " ")
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
  "scotty cameron": [
    "circle t", "tour rat", "009", "009m", "009h", "009s", "gss",
    "my girl", "button back", "oil can", "pro platinum",
    "newport beach", "napa", "napa valley", "studio design", "tei3", "tel3"
  ],
  "bettinardi": [
    "hive", "tour stock", "dass", "bb0", "bb8", "bb8 flow", "bb8f",
    "tiki", "stinger", "damascus", "limited run", "tour dept"
  ],
  "taylormade": [
    "spider limited", "spider tour", "itsy bitsy", "tour issue", "tour only"
  ],
  "odyssey": [
    "tour issue", "tour only", "prototype", "japan limited", "ten limited", "eleven limited"
  ],
  "toulon": [
    "garage", "small batch", "tour issue", "tour only"
  ],
  "ping": [
    "pld limited", "pld milled limited", "scottsdale tr", "anser becu", "anser copper", "vault"
  ],
  "l.a.b.": ["limited", "tour issue", "tour only", "df3 limited", "mezz limited"],
  "lab golf": ["limited", "tour issue", "tour only", "df3 limited", "mezz limited"],
  "evnroll": ["tour proto", "tour preferred", "v-series tourspec", "limited"],
  "mizuno": ["m-craft limited", "m craft limited", "copper", "japan limited"],
  "wilson": ["8802 limited", "8802 copper", "tour issue"],
  "sik": ["tour issue", "limited", "prototype"],
};

function hasAnyToken(text, tokens) {
  const n = norm(text);
  return tokens.some(t => n.includes(norm(t)));
}

function detectBrandInText(text) {
  const n = norm(text);
  const brandAliases = Object.keys(BRAND_LIMITED_TOKENS).concat(["titleist"]);
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

  for (const [brand, tokens] of Object.entries(BRAND_LIMITED_TOKENS)) {
    const brandMentioned = brandInQ && norm(brandInQ) === norm(brand);
    const tokensPresent = hasAnyToken(n, tokens);
    if (brandMentioned || tokensPresent) {
      qset.add(normalizeSearchQ(`${brand} ${rawQ}`));
      if (!/\\bputter\\b/i.test(rawQ)) qset.add(normalizeSearchQ(`${brand} ${rawQ} putter`));
    }
  }

  if (!brandInQ && hasAnyToken(n, GLOBAL_LIMITED_TOKENS)) {
    ["scotty cameron", "bettinardi", "odyssey", "ping", "taylormade", "toulon", "evnroll", "lab golf"].forEach(b =>
      qset.add(normalizeSearchQ(`${b} ${rawQ}`))
    );
  }

  const impliesCameron = /\\b(newport|phantom|futura|squareback|fastback|napa|tei3|tel3|button back|pro platinum|circle t|tour rat|009|009m|009h|009s|my girl|beach)\\b/i.test(rawQ);
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

/* ============================
   2ND SWING ADAPTER (inline)
   ============================ */
function parsePriceLike(text) {
  if (!text) return null;
  const m = String(text).replace(/,/g, "").match(/\\$?\\s*([\\d.]+)/);
  return m ? Number(m[1]) : null;
}

function extractJsonLdProducts($) {
  const out = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const txt = $(el).contents().text();
    if (!txt) return;
    try {
      const json = JSON.parse(txt);
      const arr = Array.isArray(json) ? json : [json];
      for (const node of arr) {
        if (!node) continue;
        if (node["@type"] === "ItemList" && Array.isArray(node.itemListElement)) {
          for (const it of node.itemListElement) {
            const item = it?.item || it;
            if (!item) continue;
            const offer = item.offers && (Array.isArray(item.offers) ? item.offers[0] : item.offers);
            out.push({
              name: item.name,
              url: item.url || item["@id"],
              image: Array.isArray(item.image) ? item.image[0] : item.image,
              price: offer?.price,
              priceCurrency: offer?.priceCurrency || "USD",
              condition: item.itemCondition || offer?.itemCondition || "",
            });
          }
        }
        if (Array.isArray(node["@graph"])) {
          for (const g of node["@graph"]) {
            if (!g) continue;
            const offer = g.offers && (Array.isArray(g.offers) ? g.offers[0] : g.offers);
            if (g["@type"] === "Product" || g.name) {
              out.push({
                name: g.name,
                url: g.url || g["@id"],
                image: Array.isArray(g.image) ? g.image[0] : g.image,
                price: offer?.price,
                priceCurrency: offer?.priceCurrency || "USD",
                condition: g.itemCondition || offer?.itemCondition || "",
              });
            }
          }
        }
      }
    } catch {}
  });
  return out;
}

function extractCards($) {
  const out = [];
  const sels = [
    ".product-list .product-tile",
    ".product-grid .product-tile",
    ".product-card",
    ".product-item",
    "[data-product-id]",
  ];
  const seen = new Set();
  for (const sel of sels) {
    $(sel).each((_, el) => {
      const $el = $(el);
      const title = ($el.find(".product-title, .title, a[title]").first().text() || "").trim()
        || ($el.find("a").first().attr("title") || "");
      let url = $el.find("a").first().attr("href") || "";
      if (url && url.startsWith("/")) url = `https://www.2ndswing.com${url}`;
      const img = $el.find("img").first().attr("src") || $el.find("img").first().attr("data-src") || "";
      const priceTxt = $el.find(".price, .product-price, [data-price]").first().text().trim()
        || $el.find("[data-price]").first().attr("data-price") || "";
      const price = parsePriceLike(priceTxt);
      if (!title || !url || price == null) return;
      const key = `${title}::${url}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        name: title,
        url, image: img, price, priceCurrency: "USD", condition: "",
      });
    });
    if (out.length) break;
  }
  return out;
}

async function fetchSecondSwing(q) {
  const urls = [
    `https://www.2ndswing.com/search?query=${encodeURIComponent(q)}&category=golf-putters`,
    `https://www.2ndswing.com/golf-putters/?q=${encodeURIComponent(q)}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; PutterIQBot/1.0; +https://putteriq.com)",
          "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        cache: "no-store",
      });
      if (!res.ok) continue;
      const html = await res.text();
      const $ = cheerio.load(html);
      let items = extractJsonLdProducts($);
      if (!items.length) items = extractCards($);
      if (!items.length) continue;

      return items.map((p) => {
        const title = (p.name || "").trim();
        const price = safeNum(p.price ?? parsePriceLike(p.price));
        if (!title || price == null) return null;
        // reuse our title-based spec/model inference
        const specs = parseSpecsFromItem({ title });
        const modelKey = normalizeModelFromTitle(title, specs?.family || null);
        return {
          source: "2ndswing",
          retailer: "2nd Swing",
          productId: p.url || title,
          url: p.url || "",
          title,
          price,
          currency: p.priceCurrency || "USD",
          image: p.image || null,
          condition: p.condition || null,
          createdAt: new Date().toISOString(),
          specs,
          __model: modelKey,
        };
      }).filter(Boolean);
    } catch {
      // try next
    }
  }
  return [];
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
      const alt = normalizeSearchQ(rawQ.replace(/\\bputters\\b/gi, "").trim());
      if (alt && alt !== q) {
        const extra = await fetchEbayBrowse({ q: alt, limit, offset: 0, sort, forceCategory });
        const arr = Array.isArray(extra?.itemSummaries) ? extra.itemSummaries : [];
        items.push(...arr);
        totalFromEbay = Math.max(totalFromEbay, Number(extra?.total || 0));
      }
    }

    // Strict "putter only" filter
    items = items.filter(isLikelyPutter);

    const fetchedCountEbay = items.length;

    // Map → eBay offers
    let offers = items.map((item) => {
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
      const shipCost = shipping?.cost ?? 0;
      const totalPrice = itemPrice != null && shipCost != null ? itemPrice + shipCost : itemPrice ?? null;

      const rawUrl = item?.itemWebUrl || item?.itemHref;
      const url = decorateEbayUrl(rawUrl);

      const modelKey = normalizeModelFromTitle(item?.title || "", family);

      return {
        source: "ebay",
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

    // De-dupe obvious clones (same seller + same title + same price) for eBay
    const seenEbay = new Set();
    offers = offers.filter((o) => {
      const key = `${(o.seller?.username || "").toLowerCase()}|${(o.title || "").toLowerCase()}|${o.price ?? "?"}`;
      if (seenEbay.has(key)) return false;
      seenEbay.add(key);
      return true;
    });

    // ===== NEW: 2nd Swing fetch + normalize =====
    let extraOffers = [];
    try {
      extraOffers = await fetchSecondSwing(q);
    } catch {
      extraOffers = [];
    }

    const fetchedCountExtra = extraOffers.length;

    // Merge by (source|url) to avoid dupes across sources
    const byKey = new Map();
    for (const o of [...offers, ...extraOffers]) {
      const src = o.source || (o.retailer && o.retailer.toLowerCase().includes("ebay") ? "ebay" : "unknown");
      const key = `${src}|${o.url}`;
      if (!byKey.has(key)) byKey.set(key, o);
    }
    offers = Array.from(byKey.values());

    // Track drops for debugging (now across all sources)
    let droppedNoPrice = 0;
    let droppedNoImage = 0;

    // Apply the same filters to the merged set
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
    } else {
      // default: best price asc for flat; grouped later re-sorts by best price too
      offers.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    }

    const fetchedCount = fetchedCountEbay + fetchedCountExtra;
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

    if (!group) {
      const start = (page - 1) * perPage;
      const pageOffers = offers.slice(start, start + perPage);
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
          source: "multi",
          debug: { droppedNoPrice, droppedNoImage, totalFromEbay, fetchedCountEbay, fetchedCountExtra }
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
      g.retailers.add(o.retailer || (o.source === "ebay" ? "eBay" : o.source));
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
          ? Math.max(...b.offers.map((o) => (o.createdAt ? new Date(o.createdAt).getTime() : 0)))
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
        source: "multi",
        debug: { droppedNoPrice, droppedNoImage, totalFromEbay, fetchedCountEbay, fetchedCountExtra },
      },
      analytics,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
