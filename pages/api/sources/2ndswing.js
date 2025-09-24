/* eslint-disable no-console */
// pages/api/sources/2ndswing.js
// Robust: catalogsearch grid/list -> fallback: follow matching product links -> parse product pages.

function cleanTitle(s = "") { return String(s).replace(/\s+/g, " ").trim(); }
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

/** Query relevance helpers */
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

/** Parse a single product page (JSON-LD first, then DOM) */
async function parseProductPage(html, url) {
  const { load } = await import("cheerio");
  const $ = load(html);

  // JSON-LD Product
  let title = "";
  let price = null;
  let image = "";

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const txt = $(el).contents().text();
      if (!txt) return;
      const data = JSON.parse(txt);
      const arr = Array.isArray(data) ? data : [data];
      for (const node of arr) {
        if (!node) continue;
        const push = (n) => {
          if (!n) return;
          if (!title && n.name) title = cleanTitle(n.name);
          if (!image && n.image) image = Array.isArray(n.image) ? n.image[0] : n.image;
          const offer = Array.isArray(n.offers) ? n.offers[0] : n.offers;
          if (offer?.price && price == null) price = Number(offer.price);
        };
        if (node["@type"] === "Product" || node.name) push(node);
        if (Array.isArray(node["@graph"])) node["@graph"].forEach(push);
      }
    } catch {}
  });

  // Fallback DOM selectors
  if (!title) {
    title =
      cleanTitle($('.product-info-main .page-title span, .product-info-main .page-title, h1.page-title span, h1.page-title').first().text()) ||
      cleanTitle($('.product-name').first().text());
  }
  if (price == null) {
    const pAttr = $('.price-wrapper[data-price-amount]').first().attr('data-price-amount');
    if (pAttr) price = Number(pAttr);
    if (price == null) {
      const priceText = $('.price-final_price .price, .price-wrapper .price, .price').first().text().trim();
      price = parsePrice(priceText);
    }
  }
  if (!image) {
    image =
      $('img.fotorama__img, .gallery-placeholder img, .product.media img').first().attr('src') ||
      $('img').first().attr('src') ||
      "";
  }

  if (!title || price == null) return null;

  return {
    source: "2ndswing",
    retailer: "2nd Swing",
    productId: url || title,
    url,
    title,
    image: image || null,
    price,
    currency: "USD",
    condition: "USED",
    specs: inferSpecsFromTitle(title),
    createdAt: new Date().toISOString(),
    __model: toModelKey(title),
  };
}

/** Parse a search (grid/list) page */
async function parseSearchPage(html, base = "https://www.2ndswing.com") {
  const { load } = await import("cheerio");
  const $ = load(html);
  const items = [];
  const seen = new Set();

  // Grid-style (Magento)
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
      $el.find("a[title]").first().attr("href") || "";
    if (!title || !href) return;
    if (href.startsWith("/")) href = `${base}${href}`;

    const img =
      $el.find("img").first().attr("src") ||
      $el.find("img").first().attr("data-src") || "";

    const priceAttr = $el.find(".price-wrapper[data-price-amount]").first().attr("data-price-amount");
    const priceText =
      $el.find(".price-final_price .price, .price").first().text().trim() ||
      $el.find("[data-price-type='finalPrice']").first().text().trim() || "";
    const price = priceAttr ? Number(priceAttr) : parsePrice(priceText);
    if (price == null) return;

    const key = `${title}::${href}`;
    if (seen.has(key)) return;
    seen.add(key);

    items.push({ title, url: href, image: img, price, currency: "USD" });
  });

  // List-style fallback
  if (!items.length) {
    $(".products.list .product-item, .search.results .product-item").each((_, el) => {
      const $el = $(el);
      const title =
        cleanTitle(
          $el.find(".product-item-name a, .product-item-link").first().text() ||
          $el.find("a[title]").first().attr("title") ||
          $el.find(".product-item-name").first().text()
        );
      let href =
        $el.find(".product-item-name a, .product-item-link").first().attr("href") ||
        $el.find("a[title]").first().attr("href") || "";
      if (!title || !href) return;
      if (href.startsWith("/")) href = `${base}${href}`;

      const img =
        $el.find("img").first().attr("src") ||
        $el.find("img").first().attr("data-src") || "";

      const priceAttr = $el.find(".price-wrapper[data-price-amount]").first().attr("data-price-amount");
      const priceText =
        $el.find(".price-final_price .price, .price").first().text().trim() ||
        $el.find("[data-price-type='finalPrice']").first().text().trim() || "";
      const price = priceAttr ? Number(priceAttr) : parsePrice(priceText);
      if (price == null) return;

      const key = `${title}::${href}`;
      if (seen.has(key)) return;
      seen.add(key);

      items.push({ title, url: href, image: img, price, currency: "USD" });
    });
  }

  return items;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json([]);
  const q = String(req.query.q || "").trim();
  if (!q) return res.status(200).json([]);

  const trace = String(req.query.trace || "") === "1";
  const log = { steps: [], counts: {} };

  try {
    const RAW = tokensFromQuery(q);
    const TOKENS = expandTokens(RAW);
    const base = "https://www.2ndswing.com";
    const searchUrl = `${base}/catalogsearch/result/?q=${encodeURIComponent(q)}`;

    // fetch search page
    const html = await fetch(searchUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      cache: "no-store",
      redirect: "follow",
    }).then(r => r.ok ? r.text() : "").catch(() => "");

    if (!html) {
      if (trace) return res.status(200).json({ out: [], trace: { ...log, note: "empty html" } });
      return res.status(200).json([]);
    }

    // single product heuristic
    const looksLikeSingle =
      /"@type"\s*:\s*"Product"/i.test(html) &&
      /"offers"\s*:\s*{[^}]*"price"\s*:\s*"?\d/i.test(html) &&
      !/ItemList/i.test(html);
    if (looksLikeSingle || /"og:type"\s*content="product"/i.test(html)) {
      log.steps.push("single:jsonld");
      const one = await parseProductPage(html, searchUrl);
      if (trace) return res.status(200).json({ out: one ? [one] : [], trace: log });
      return res.status(200).json(one ? [one] : []);
    }

    // parse search tiles
    let items = await parseSearchPage(html, base);
    log.steps.push("search:tiles");
    log.counts.tiles = items.length;

    // ---- FALLBACK: follow product links if tiles are empty (or filtering wipes them) ----
    // Extract candidate product links from the page and follow the first few that match tokens.
    if (!items.length) {
      log.steps.push("fallback:follow-links");
      const { load } = await import("cheerio");
      const $ = load(html);
      const hrefs = new Set();
      $('a[href*="/golf-clubs/putters/"]').each((_, el) => {
        const href = String($(el).attr("href") || "").trim();
        if (!href) return;
        const abs = href.startsWith("/") ? `${base}${href}` : href;
        // keep links that mention at least one token in URL or text
        const txt = cleanTitle($(el).text() || "");
        const hit = TOKENS.length ? (hitsIn(abs, TOKENS) > 0 || hitsIn(txt, TOKENS) > 0) : true;
        if (hit) hrefs.add(abs);
      });

      const candidates = Array.from(hrefs).slice(0, 4); // follow at most 4
      const pages = await Promise.all(
        candidates.map(u =>
          fetch(u, {
            headers: {
              "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
            cache: "no-store",
            redirect: "follow",
          })
          .then(r => r.ok ? r.text() : "")
          .then(ht => ht ? parseProductPage(ht, u) : null)
          .catch(() => null)
        )
      );
      items = pages.filter(Boolean).map(p => ({
        title: p.title, url: p.url, image: p.image, price: p.price, currency: p.currency
      }));
      log.counts.followed = items.length;
    }

    if (!items || !items.length) {
      if (trace) return res.status(200).json({ out: [], trace: log });
      return res.status(200).json([]);
    }

    // normalize
    let out = items.map(p => ({
      source: "2ndswing",
      retailer: "2nd Swing",
      productId: p.url || p.title,
      url: p.url,
      title: cleanTitle(p.title),
      image: p.image || null,
      price: p.price,
      currency: p.currency || "USD",
      condition: "USED",
      specs: inferSpecsFromTitle(p.title),
      createdAt: new Date().toISOString(),
      __model: toModelKey(p.title),
    }));

    // token-aware filter (lenient for model-led terms like “napa”)
    const RARE_MODELS = new Set([
      "napa","tei3","circa","bb","np","np2","x5","x7","x5.5","x7.5","bee","timeless","golo",
      "futura","fastback","squareback","fb","sb"
    ]);
    const hasRareModel = RAW.some(t => RARE_MODELS.has(t));
    const minScoreParam = Number.isFinite(Number(req.query.minScore))
      ? Number(req.query.minScore) : null;
    const defaultMin = RAW.length >= 2 ? 2 : 1;
    const MIN = minScoreParam ?? (hasRareModel ? 1 : defaultMin);

    if (TOKENS.length) {
      const scored = out
        .map(x => ({ x, score: Math.max(hitsIn(x.title, TOKENS), hitsIn(x.url, TOKENS)) }));
      log.counts.scored = scored.length;

      out = scored
        .filter(r => r.score >= MIN)
        .sort((a, b) => (b.score - a.score) || ((a.x.price ?? Infinity) - (b.x.price ?? Infinity)))
        .map(r => r.x);
      log.counts.afterFilter = out.length;
    }

    if (trace) return res.status(200).json({ out, trace: log });
    return res.status(200).json(out);
  } catch (e) {
    console.error("[2ndswing] error:", e?.message || e);
    if (trace) return res.status(200).json({ out: [], trace: { error: e?.message || String(e) } });
    return res.status(200).json([]);
  }
}
