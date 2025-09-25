// pages/api/sources/2ndswing.js

// Use CommonJS here for reliability in Next API routes
const { applySearchFilter } = require("../../../lib/searchfilter");
const cheerio = require("cheerio");

// ---- Tunables ----
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
const MAX_PAGES = 5;                // hard ceiling
const REQUEST_TIMEOUT_MS = 8000;    // per-request timeout

function parsePrice(text) {
  const m = String(text || "")
    .replace(/[, ]/g, "")
    .match(/\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/);
  return m ? Number(m[1]) : null;
}

// Normalize minimal item fields before filtering
function normalize(items) {
  return items
    .filter((x) => x && x.url)
    .map((x) => ({
      title: (x.title || "").replace(/\s+/g, " ").trim(),
      url: x.url,
      price: x.price,
      image: x.image || null,
    }));
}

// Scrape a single catalog search page into raw items
function parseSearchHTML(html) {
  const $ = cheerio.load(html);
  const out = [];

  // Product card selectors (Magento-like)
  $(".product-item, li.product-item, .products-grid .product-item").each((_, el) => {
    const $card = $(el);

    const a =
      $card.find("a.product-item-link").first()[0] ||
      $card.find("a.product.photo").first()[0] ||
      $card.find("a[href*='/golf-clubs/putters/']").first()[0];

    const url = a ? $(a).attr("href") : null;
    if (!url || !/\/golf-clubs\/putters\//i.test(url)) return;

    const title =
      ($(a).text() || $(a).attr("title") || $card.find(".product.name a").text() || "")
        .replace(/\s+/g, " ")
        .trim();

    const img =
      $card.find("img.product-image-photo[src]").attr("src") ||
      $card.find("img[src]").first().attr("src") ||
      null;

    // Price can be rendered various ways
    let price = null;
    const priceBox = $card.find(".price, .price-box [data-price-amount]").first();
    if (priceBox.attr("data-price-amount")) {
      price = parsePrice(priceBox.attr("data-price-amount"));
    } else {
      price = parsePrice(priceBox.text());
    }

    out.push({ title, url, image: img, price });
  });

  // Fallback: looser anchor scan if cards failed
  if (out.length === 0) {
    $("a.product-item-link, a.product.photo, a[href*='/golf-clubs/putters/']").each((_, a) => {
      const url = $(a).attr("href");
      if (!url || !/\/golf-clubs\/putters\//i.test(url)) return;
      const title = ($(a).text() || $(a).attr("title") || "").trim();
      const img =
        $(a).closest("li,div").find("img[src]").first().attr("src") ||
        $("img[src]").first().attr("src") ||
        null;
      const priceText =
        $(a).closest("li,div").find(".price, [data-price-amount]").first().text() ||
        $(a).closest("li,div").find("[data-price-amount]").attr("data-price-amount");
      const price = parsePrice(priceText);
      out.push({ title, url, image: img, price });
    });
  }

  return out;
}

// Some product pages are directly navigable; try to parse one SKU page
function parseProductHTML(html, url) {
  const $ = cheerio.load(html);
  const title =
    ($("h1.page-title .base").first().text() ||
      $("h1.page-title").first().text() ||
      $("h1").first().text() ||
      $("title").text() ||
      "").trim();

  const img =
    $("img.product-image-photo[src]").attr("src") ||
    $("img[src]").first().attr("src") ||
    null;

  let price = null;
  const priceNode = $(".price, .price-box [data-price-amount]").first();
  if (priceNode.attr("data-price-amount")) {
    price = parsePrice(priceNode.attr("data-price-amount"));
  } else {
    price = parsePrice(priceNode.text());
  }

  return [{ title, url, image: img, price }];
}

async function fetchWithTimeout(url, ms, headers = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, ...headers }, signal: ctrl.signal, cache: "no-store" });
    return r;
  } finally {
    clearTimeout(t);
  }
}

// === New: retry with backoff for 429/rate limiting ===
async function fetchHtmlWithRetry(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS, { "accept-language": "en-US,en;q=0.9" });
      // If rate-limited, back off and retry
      if (r && r.status === 429) {
        const wait = 800 * Math.pow(2, i) + Math.random() * 400;
        await new Promise((res) => setTimeout(res, wait));
        continue;
      }
      if (!r || !r.ok) throw new Error(`HTTP ${r ? r.status : 0}`);
      return await r.text();
    } catch (e) {
      lastErr = e;
      const wait = 400 * Math.pow(2, i) + Math.random() * 200;
      await new Promise((res) => setTimeout(res, wait));
    }
  }
  throw lastErr;
}

async function fetchSearchPage(q, page) {
  const url = `https://www.2ndswing.com/catalogsearch/result/?q=${encodeURIComponent(q)}&p=${page}`;
  try {
    const html = await fetchHtmlWithRetry(url, 3);
    const items = parseSearchHTML(html);
    return { items, status: 200 };
  } catch (e) {
    // if we got here, we exhausted retries
    return { items: [], status: 0 };
  }
}

module.exports = async function handler(req, res) {
  try {
    if (process.env.ENABLE_2NDSWING !== "true") {
      return res.status(200).json([]); // disabled by env flag
    }

    const q = String(req.query.q || "").trim();
    const trace = req.query.trace === "1";
    const log = { steps: [], counts: {}, pages: [] };

    if (!q) return res.status(200).json([]);

    // How many catalog pages to crawl (default 1; soft-cap 3; hard-cap MAX_PAGES)
    const pagesParam = Math.max(1, Math.min(3, Number(req.query.pages || 1)));
    const pagesToFetch = Math.min(pagesParam, MAX_PAGES);

    // ---- 1) Crawl multiple catalog pages (serial, retrying) ----
    let raw = [];
    for (let p = 1; p <= pagesToFetch; p++) {
      const { items, status } = await fetchSearchPage(q, p);
      log.pages.push({ page: p, count: items.length, status });
      if (items.length === 0) {
        // Stop if this page returned nothing (end of results or blocked)
        break;
      }
      raw = raw.concat(items);
      // Safety: stop early if we already have a lot
      if (raw.length >= 200) break;
    }
    log.counts.raw = raw.length;
    if (raw.length > 0) log.steps.push("search:catalog:multi");

    // ---- 2) Fallback: try guessing a direct product page if catalog was empty ----
    if (raw.length === 0) {
      const guessUrl = `https://www.2ndswing.com/golf-clubs/putters/${encodeURIComponent(
        q.replace(/\s+/g, "-")
      )}`;
      try {
        const r2 = await fetchWithTimeout(guessUrl, REQUEST_TIMEOUT_MS);
        if (r2 && r2.ok) {
          const h2 = await r2.text();
          raw = parseProductHTML(h2, guessUrl);
          log.steps.push("search:product");
        }
      } catch {
        log.steps.push("search:product:error");
      }
    }

    if (raw.length === 0) {
      return trace ? res.status(200).json({ out: [], trace: log }) : res.status(200).json([]);
    }

    // ---- 3) Normalize & filter ----
    const normd = normalize(raw);
    let filtered = applySearchFilter(q, normd);
    log.counts.filtered_primary = filtered.length;

    // Optional: loose fallback if strict filter was too tight
    if (filtered.length < 6) {
      const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
      const seen = new Set(filtered.map((x) => (x.url || "").toLowerCase()));
      const loose = normd.filter((it) => {
        const T = (it.title || "").toLowerCase();
        const U = (it.url || "").toLowerCase();
        return toks.some((t) => T.includes(t) || U.includes(t));
      });
      for (const it of loose) {
        const u = (it.url || "").toLowerCase();
        if (!seen.has(u)) {
          filtered.push(it);
          seen.add(u);
        }
      }
      log.counts.filtered_loose_added = filtered.length;
    }

    // ---- 4) Quality gate + de-dupe ----
    filtered = filtered.filter((it) => Number.isFinite(it.price) && !!it.image);
    const dedup = [];
    const seenUrl = new Set();
    for (const it of filtered) {
      const u = (it.url || "").toLowerCase();
      if (!u || seenUrl.has(u)) continue;
      seenUrl.add(u);
      dedup.push(it);
    }
    log.counts.final = dedup.length;

    // ---- 5) Map to Offer shape ----
    const out = dedup.map((p) => ({
      source: "2ndswing",
      retailer: "2nd Swing",
      productId: p.url,
      url: p.url,
      title: p.title,
      image: p.image,
      price: p.price,
      currency: "USD",
      condition: "USED",
      specs: {},
      createdAt: new Date().toISOString(),
      __model: p.title
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/putter|golf/g, "")
        .trim()
        .slice(0, 80),
    }));

    return trace ? res.status(200).json({ out, trace: log }) : res.status(200).json(out);
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (req.query.trace === "1") {
      return res.status(200).json({ out: [], trace: { error: msg } });
    }
    // Fail soft
    return res.status(200).json([]);
  }
};
