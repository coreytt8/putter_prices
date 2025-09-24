/* eslint-disable no-console */
// pages/api/sources/2ndswing.js
// Uses 2nd Swing's catalogsearch (more relevant): /catalogsearch/result/?q=...

function cleanTitle(s = "") {
  return String(s).replace(/\s+/g, " ").trim();
}
function parsePrice(text) {
  if (!text) return null;
  const m = String(text).replace(/,/g, "").match(/\$?\s*([\d.]+)/);
  return m ? Number(m[1]) : null;
}
function norm(s) { return String(s || "").trim().toLowerCase(); }
function inferSpecsFromTitle(title = "") {
  const t = norm(title);
  const dex =
    /\bleft\b|\blh\b/.test(t) ? "LEFT" :
    /\bright\b|\brh\b/.test(t) ? "RIGHT" : undefined;
  const head =
    /\bmallet\b|phantom|spider|tyne|inovai/.test(t) ? "MALLET" :
    /\bblade\b|newport|anser|bb|queen b|link/.test(t) ? "BLADE" : undefined;
  const len = (t.match(/\b(33|34|35|36|37)\b/) || [])[1];
  return { dexterity: dex, headType: head, length: len ? Number(len) : undefined };
}
function toModelKey(title = "") {
  return title.toLowerCase().replace(/\s+/g, " ").replace(/putter|golf/g, "").trim().slice(0, 60);
}

/** ------- Query relevance helpers (brand/model aware) ------- */
const STOP = new Set([
  "putter","putters","golf","club","clubs","left","right","lh","rh",
  "hand","handed","mens","women","ladies","adult","junior","kids","in","inch","inches"
]);
const ALIASES = {
  scotty: ["scotty","cameron","titleist"],
  cameron: ["scotty","cameron","titleist"],
  titleist: ["titleist","scotty","cameron"],
  taylormade: ["taylormade","taylor","made","tm","spider"],
  odyssey: ["odyssey","jailbird","tri-hot","white hot","versa","ai-one"],
  ping: ["ping","anser","pld","vault"],
  bettinardi: ["bettinardi","bb","studio stock","queen b"],
  lab: ["lab","l.a.b.","df","mezz","mez"],
  newport: ["newport","newport2","newport 2","np2","np"],
  phantom: ["phantom","phantom x","x"],
  spider: ["spider","tour","5k"],
  anser: ["anser"],
  napa: ["napa"]
};
function tokensFromQuery(q) {
  const t = norm(q).replace(/[#/\\\-_.]/g, " ");
  const raw = t.split(/\s+/).filter(Boolean);
  const kept = [];
  for (const tok of raw) {
    if (STOP.has(tok)) continue;
    if (tok.length >= 2 || /^\d+(\.\d+)?$/.test(tok)) kept.push(tok);
  }
  return kept;
}
function expandTokens(tokens) {
  const out = new Set();
  for (const t of tokens) {
    out.add(t);
    (ALIASES[t] || []).forEach(a => out.add(a.toLowerCase()));
  }
  return Array.from(out);
}
function hitsIn(text, toks) {
  const s = ` ${norm(text)} `;
  let n = 0;
  for (const tok of toks) {
    const tokEsc = tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[^a-z0-9])${tokEsc}([^a-z0-9]|$)`, "i");
    if (re.test(s)) n++;
  }
  return n;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json([]);
  const q = String(req.query.q || "").trim();
  if (!q) return res.status(200).json([]);

  try {
    const searchUrl = `https://www.2ndswing.com/catalogsearch/result/?q=${encodeURIComponent(q)}`;

    const html = await fetch(searchUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; PutterIQBot/1.0; +https://putteriq.com)",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      cache: "no-store",
    }).then(r => r.ok ? r.text() : "").catch(() => "");

    if (!html) return res.status(200).json([]);

    const { load } = await import("cheerio");
    const $ = load(html);

    // Product tiles on catalogsearch page (Magento-style markup)
    const items = [];
    const seen = new Set();

    // Common selectors:
    // - .products-grid .product-item
    // - .product-item-info / .product-item-link
    // - .price, .price-final_price .price, .price-wrapper[data-price-amount]
    $(".products-grid .product-item, .product-item").each((_, el) => {
      const $el = $(el);

      const title =
        cleanTitle(
          $el.find(".product-item-name a, .product-item-link").first().text() ||
          $el.find("a[title]").first().attr("title") ||
          $el.find(".product-item-name").first().text()
        );

      let href =
        $el.find(".product-item-name a, .product-item-link").first().attr("href") ||
        $el.find("a[title]").first().attr("href") ||
        "";

      if (!title || !href) return;

      if (href.startsWith("/")) href = `https://www.2ndswing.com${href}`;

      const img =
        $el.find("img").first().attr("src") ||
        $el.find("img").first().attr("data-src") ||
        "";

      // Price: try data attributes first, then text
      const priceAttr = $el.find(".price-wrapper[data-price-amount]").first().attr("data-price-amount");
      const priceText =
        $el.find(".price-final_price .price, .price").first().text().trim() ||
        $el.find("[data-price-type='finalPrice']").first().text().trim() ||
        "";
      const price = priceAttr ? Number(priceAttr) : parsePrice(priceText);

      if (price == null) return;

      const key = `${title}::${href}`;
      if (seen.has(key)) return;
      seen.add(key);

      items.push({
        title,
        url: href,
        image: img,
        price,
        currency: "USD",
      });
    });

    if (!items.length) return res.status(200).json([]);

    // Normalize
    let out = items.map(p => ({
      source: "2ndswing",
      retailer: "2nd Swing",
      productId: p.url || p.title,
      url: p.url,
      title: cleanTitle(p.title),
      image: p.image || null,
      price: p.price,
      currency: p.currency || "USD",
      condition: "USED", // generally preowned (OK as default)
      specs: inferSpecsFromTitle(p.title),
      createdAt: new Date().toISOString(),
      __model: toModelKey(p.title),
    }));

    // Query-aware filter: should already be relevant, but enforce tokens
    const RAW = tokensFromQuery(q);
    const TOKENS = expandTokens(RAW);
    if (TOKENS.length) {
      const minScoreParam = Number.isFinite(Number(req.query.minScore))
        ? Number(req.query.minScore)
        : null;
      const MIN = minScoreParam ?? (RAW.length >= 2 ? 2 : 1);

      out = out
        .map(x => ({ x, score: Math.max(hitsIn(x.title, TOKENS), hitsIn(x.url, TOKENS)) }))
        .filter(r => r.score >= MIN)
        .sort((a, b) => (b.score - a.score) || ((a.x.price ?? Infinity) - (b.x.price ?? Infinity)))
        .map(r => r.x);
    }

    return res.status(200).json(out);
  } catch (e) {
    console.error("[2ndswing] error:", e?.message || e);
    return res.status(200).json([]); // never throw
  }
}
