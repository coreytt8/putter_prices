/* eslint-disable no-console */
// pages/api/sources/2ndswing.js

function cleanTitle(s = "") {
  return String(s)
    .replace(/\s+/g, " ")
    .replace(/\s+Putter\s*$/i, " Putter") // keep one "Putter" if it belongs
    .trim();
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
  return {
    dexterity: dex,
    headType: head,
    length: len ? Number(len) : undefined
  };
}
function toModelKey(title = "") {
  return title
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/putter|golf/g, "")
    .trim()
    .slice(0, 60);
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json([]);
  const q = String(req.query.q || "").trim();
  if (!q) return res.status(200).json([]);

  try {
    const urls = [
      `https://www.2ndswing.com/search?query=${encodeURIComponent(q)}&category=golf-putters`,
      `https://www.2ndswing.com/golf-putters/?q=${encodeURIComponent(q)}`
    ];

    const all = [];
    for (const url of urls) {
      const html = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; PutterIQBot/1.0; +https://putteriq.com)",
          "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        cache: "no-store",
      }).then(r => r.ok ? r.text() : "").catch(() => "");

      if (!html) continue;

      const { load } = await import("cheerio");
      const $ = load(html);

      // ---- 1) JSON-LD first (ignore "Wish List" junk) ----
      const jsonLdItems = [];
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const txt = $(el).contents().text();
          if (!txt) return;
          const data = JSON.parse(txt);
          const pile = Array.isArray(data) ? data : [data];
          for (const node of pile) {
            if (!node) continue;

            const pushProduct = (p) => {
              if (!p) return;
              const name = cleanTitle(p.name || "");
              if (!name || /^wish\s*list$/i.test(name)) return;
              const offer = Array.isArray(p.offers) ? p.offers[0] : p.offers;
              jsonLdItems.push({
                title: name,
                url: p.url || p["@id"] || "",
                image: Array.isArray(p.image) ? p.image[0] : p.image,
                price: offer?.price ? Number(offer.price) : null,
                currency: offer?.priceCurrency || "USD",
              });
            };

            if (node["@type"] === "ItemList" && Array.isArray(node.itemListElement)) {
              for (const it of node.itemListElement) pushProduct(it?.item || it);
            }
            if (Array.isArray(node["@graph"])) {
              for (const g of node["@graph"]) {
                if (g?.["@type"] === "Product" || g?.name) pushProduct(g);
              }
            }
            if (node["@type"] === "Product" || node.name) pushProduct(node);
          }
        } catch {}
      });

      let items = jsonLdItems;

      // ---- 2) Fallback: robust card selectors (avoid “Wish List”) ----
      if (!items.length) {
        const seen = new Set();
        // Try several title selectors, skip elements that are clearly wishlist UI
        $(".product-grid .product-card, .product-item, .product-tile, [data-sku]").each((_, el) => {
          const $el = $(el);

          // Prefer explicit product title anchors/headers
          const title =
            cleanTitle(
              $el.find('.product-title, .product-title a, a.product-title, a[title][href*="/golf-clubs/putters/"]').first().text()
              || $el.find('a[href*="/golf-clubs/putters/"]').first().text()
              || $el.find('h3, h2').first().text()
            );

          if (!title || /^wish\s*list$/i.test(title)) return; // skip junk

          let href =
            $el.find('a[href*="/golf-clubs/putters/"]').first().attr("href")
            || $el.find("a").first().attr("href")
            || "";

          if (!href) return;
          if (href.startsWith("/")) href = `https://www.2ndswing.com${href}`;

          const img =
            $el.find("img").first().attr("src")
            || $el.find("img").first().attr("data-src")
            || "";

          const priceTxt =
            $el.find(".price, .product-price, [data-price]").first().text().trim()
            || $el.find("[data-price]").first().attr("data-price")
            || "";

          const price = parsePrice(priceTxt);
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
      }

      all.push(...items);
      if (all.length) break; // stop after first page that produced results
    }

    // Normalize + filter
    const out = (all || [])
      .map(p => {
        if (!p?.title || typeof p.price !== "number") return null;
        const title = cleanTitle(p.title);
        if (!title || /^wish\s*list$/i.test(title)) return null;
        return {
          source: "2ndswing",
          retailer: "2nd Swing",
          productId: p.url || title,
          url: p.url,
          title,
          image: p.image || null,
          price: p.price,
          currency: p.currency || "USD",
          condition: "USED", // generally pre-owned on 2nd Swing
          specs: inferSpecsFromTitle(title),
          createdAt: new Date().toISOString(),
          __model: toModelKey(title),
        };
      })
      .filter(Boolean);

    return res.status(200).json(out);
  } catch (e) {
    console.error("[2ndswing] error:", e?.message || e);
    return res.status(200).json([]); // never throw
  }
}
