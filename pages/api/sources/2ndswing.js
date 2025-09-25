
// pages/api/sources/2ndswing.js
import { applySearchFilter } from "@/lib/searchFilter";
import * as cheerio from "cheerio";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";

function parsePrice(text) {
  const m = String(text||"").replace(/[, ]/g,"").match(/\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/);
  return m ? Number(m[1]) : null;
}

function normalize(items) {
  return items
    .filter(x => x && x.url)
    .map(x => ({
      title: (x.title || "").replace(/\s+/g," ").trim(),
      url: x.url,
      price: x.price,
      image: x.image || null,
    }));
}

// Parse the catalog search results
function parseSearchHTML(html) {
  const $ = cheerio.load(html);
  const out = [];
  // 2ndSwing uses Magento-like grid/list; target anchors with product URLs
  $("a.product.photo, a.product-item-link, li.product-item a").each((_, a) => {
    const url = $(a).attr("href");
    if (!url || !/\/golf-clubs\/putters\//i.test(url)) return;
    // Title
    const title = $(a).text().trim() || $(a).attr("title") || "";
    // Image near this anchor
    const img = $(a).closest("li,div").find("img[src]").first().attr("src") || null;
    // Price near this anchor
    let price = null;
    const priceText =
      $(a).closest("li,div").find(".price, .price-box, [data-price-amount]").first().text() ||
      $(a).closest("li,div").find("[data-price-amount]").attr("data-price-amount");
    price = parsePrice(priceText);
    out.push({ title, url, image: img, price });
  });
  return out;
}

// Fallback to a single product page (sometimes listings are direct)
function parseProductHTML(html, url) {
  const $ = cheerio.load(html);
  const title = ($("h1.page-title, h1 .base, h1").first().text() || $("title").text() || "").trim();
  const img = $("img[src]").first().attr("src") || null;
  const priceText = $(".price, .price-box [data-price-amount]").first().text() || $("[data-price-amount]").attr("data-price-amount");
  const price = parsePrice(priceText);
  return [{ title, url, image: img, price }];
}

export default async function handler(req, res) {
  try {
    if (process.env.ENABLE_2NDSWING !== "true") {
      return res.status(200).json([]); // disabled by flag
    }

    const q = String(req.query.q || "").trim();
    const trace = req.query.trace === "1";
    const log = { steps: [], counts: {} };

    if (!q) return res.status(200).json([]);

    // Try catalog search first
    const searchUrl = `https://www.2ndswing.com/catalogsearch/result/?q=${encodeURIComponent(q)}`;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8000);

    let html = "";
    let items = [];
    try {
      const r = await fetch(searchUrl, { headers: { "user-agent": UA }, signal: ctrl.signal });
      if (r.ok) {
        html = await r.text();
        log.steps.push("fetch:catalog");
        const tiles = parseSearchHTML(html);
        log.counts.tiles = tiles.length;
        items = tiles;
      } else {
        log.steps.push(`fetch:catalog:${r.status}`);
      }
    } catch {
      log.steps.push("fetch:catalog:error");
    } finally {
      clearTimeout(to);
    }

    // If nothing from catalog, try treating q as a product slug (rare)
    if (!items.length) {
      const ctrl2 = new AbortController();
      const to2 = setTimeout(() => ctrl2.abort(), 8000);
      try {
        const guessUrl = `https://www.2ndswing.com/golf-clubs/putters/${encodeURIComponent(q.replace(/\s+/g, "-"))}`;
        const r2 = await fetch(guessUrl, { headers: { "user-agent": UA }, signal: ctrl2.signal });
        if (r2.ok) {
          const h2 = await r2.text();
          const prod = parseProductHTML(h2, guessUrl);
          items = prod;
          log.steps.push("fetch:product");
          log.counts.productTiles = prod.length;
        }
      } catch {
        log.steps.push("fetch:product:error");
      } finally {
        clearTimeout(to2);
      }
    }

    if (!items.length) {
      return trace ? res.status(200).json({ out: [], trace: log }) : res.status(200).json([]);
    }

    // Normalize → shared filter → map to Offer shape
    const filtered = applySearchFilter(q, normalize(items));
    log.counts.filtered = filtered.length;

    const out = filtered.map(p => ({
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
      __model: p.title.toLowerCase().replace(/\s+/g, " ").replace(/putter|golf/g,"").trim().slice(0,80),
    }));

    return trace ? res.status(200).json({ out, trace: log }) : res.status(200).json(out);
  } catch (e) {
    if (req.query.trace === "1") {
      return res.status(200).json({ out: [], trace: { error: String(e && e.message || e) } });
    }
    return res.status(200).json(results);
  }
}
