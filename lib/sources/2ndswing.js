import * as cheerio from "cheerio";
import { inferSpecsFromTitle, mapCondition, num } from "./normalize.js";

/**
 * Try to parse JSON-LD Product lists from the page (preferred).
 * Returns array of plain product-like objects with {name,url,image,price,priceCurrency,condition}
 */
function extractJsonLdProducts($) {
  const out = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    let txt = $(el).contents().text();
    if (!txt) return;
    try {
      const json = JSON.parse(txt);
      const pile = Array.isArray(json) ? json : [json];
      for (const node of pile) {
        if (!node) continue;

        // If it's an ItemList with itemListElement
        if (node["@type"] === "ItemList" && Array.isArray(node.itemListElement)) {
          for (const it of node.itemListElement) {
            const item = it?.item || it; // sometimes nested
            if (item && (item["@type"] === "Product" || item.name)) {
              const offer = item.offers && (Array.isArray(item.offers) ? item.offers[0] : item.offers);
              out.push({
                name: item.name,
                url: item.url || item["@id"],
                image: Array.isArray(item.image) ? item.image[0] : item.image,
                price: offer?.price,
                priceCurrency: offer?.priceCurrency,
                condition: item.itemCondition || offer?.itemCondition || "",
              });
            }
          }
        }

        // Or a direct Product array
        if (Array.isArray(node["@graph"])) {
          for (const g of node["@graph"]) {
            if (g && (g["@type"] === "Product" || g.name)) {
              const offer = g.offers && (Array.isArray(g.offers) ? g.offers[0] : g.offers);
              out.push({
                name: g.name,
                url: g.url || g["@id"],
                image: Array.isArray(g.image) ? g.image[0] : g.image,
                price: offer?.price,
                priceCurrency: offer?.priceCurrency,
                condition: g.itemCondition || offer?.itemCondition || "",
              });
            }
          }
        }
      }
    } catch { /* ignore one bad script */ }
  });
  return out;
}

/**
 * Fallback: parse product cards by CSS (best-effort, selectors are resilient-ish).
 */
function extractCards($) {
  const out = [];

  // Try common product-card containers
  const candidates = [
    ".product-list .product-tile",
    ".product-grid .product-tile",
    ".product-card",
    ".product-item",
    "[data-product-id]",
  ];

  const seen = new Set();
  for (const sel of candidates) {
    $(sel).each((_, el) => {
      const $el = $(el);
      const title = $el.find(".product-title, .title, a[title]").first().text().trim()
        || $el.find("a").first().attr("title") || "";
      let url = $el.find("a").first().attr("href") || "";
      if (url && url.startsWith("/")) url = `https://www.2ndswing.com${url}`;
      const img = $el.find("img").first().attr("src") || $el.find("img").first().attr("data-src") || "";
      const priceTxt = $el.find(".price, .product-price, [data-price]").first().text().trim()
        || $el.find("[data-price]").first().attr("data-price") || "";
      const price = num((priceTxt.match(/[\d,.]+/)||[])[0]?.replace(/,/g,""));

      if (!title || !url || price == null) return;
      const key = `${title}::${url}`;
      if (seen.has(key)) return;
      seen.add(key);

      out.push({
        name: title,
        url,
        image: img || undefined,
        price,
        priceCurrency: "USD",
        condition: "",
      });
    });
    if (out.length) break; // found a good selector set
  }
  return out;
}

/**
 * Search 2nd Swing (server-side).
 * We purposefully keep it conservative + fail-safe. If nothing parseable, returns [].
 */
async function searchSecondSwing(q) {
  // Try a couple of search endpoints; keep UA polite.
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

      return items
        .map((p) => {
          const title = (p.name || "").trim();
          const price = num(p.price);
          if (!title || price == null) return null;
          const specs = inferSpecsFromTitle(title);
          return {
            source: "2ndswing",
            retailer: "2nd Swing",
            url: String(p.url || ""),
            title,
            price,
            currency: (p.priceCurrency || "USD"),
            image: p.image || undefined,
            specs,
            condition: p.condition || "",
            conditionBand: mapCondition(p.condition || ""),
            brand: undefined,
            model: undefined,
            createdAt: new Date().toISOString(),
          };
        })
        .filter(Boolean);
    } catch {
      // try next URL
    }
  }
  return [];
}

export const secondSwingAdapter = {
  id: "2ndswing",
  async fetch(q, _opts = {}) {
    if (!q || !q.trim()) return [];
    return searchSecondSwing(q.trim());
  },
};
