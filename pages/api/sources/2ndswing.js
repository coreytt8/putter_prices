/* eslint-disable no-console */
// pages/api/sources/2ndswing.js
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json([]);
  const q = String(req.query.q || "").trim();
  if (!q) return res.status(200).json([]);

  try {
    const urls = [
      `https://www.2ndswing.com/search?query=${encodeURIComponent(q)}&category=golf-putters`,
      `https://www.2ndswing.com/golf-putters/?q=${encodeURIComponent(q)}`
    ];

    let items = [];
    for (const url of urls) {
      const html = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; PutterIQBot/1.0; +https://putteriq.com)",
          "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        cache: "no-store",
      }).then(r => r.ok ? r.text() : "");

      if (!html) continue;

      const { load } = await import("cheerio");
      const $ = load(html);

      // 1) JSON-LD first
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const txt = $(el).contents().text();
          const data = JSON.parse(txt);
          const pile = Array.isArray(data) ? data : [data];
          for (const node of pile) {
            if (!node) continue;
            const graph = Array.isArray(node["@graph"]) ? node["@graph"] : [];
            const products = [];
            if (node["@type"] === "ItemList" && Array.isArray(node.itemListElement)) {
              for (const it of node.itemListElement) products.push(it?.item || it);
            }
            products.push(...graph.filter(g => g?.["@type"] === "Product" || g?.name));
            for (const p of products) {
              if (!p?.name) continue;
              const offer = Array.isArray(p.offers) ? p.offers[0] : p.offers;
              items.push({
                title: p.name,
                url: p.url || p["@id"] || "",
                image: Array.isArray(p.image) ? p.image[0] : p.image,
                price: offer?.price ? Number(offer.price) : null,
                currency: offer?.priceCurrency || "USD",
              });
            }
          }
        } catch {}
      });

      // 2) Fallback: cards
      if (!items.length) {
        const seen = new Set();
        $(".product-grid .product-card, .product-item, .product-tile, [data-sku]").each((_, el) => {
          const $el = $(el);
          const title = ($el.find(".product-title, .title, a[title]").first().text() || "").trim();
          let href = $el.find("a").first().attr("href") || "";
          if (href && href.startsWith("/")) href = `https://www.2ndswing.com${href}`;
          const img = $el.find("img").first().attr("src") || $el.find("img").first().attr("data-src") || "";
          const priceTxt = $el.find(".price, .product-price, [data-price]").first().text().trim()
            || $el.find("[data-price]").first().attr("data-price") || "";
          const m = priceTxt.replace(/,/g, "").match(/\$?\s*([\d.]+)/);
          const price = m ? Number(m[1]) : null;

          if (!title || !href || price == null) return;
          const key = `${title}::${href}`;
          if (seen.has(key)) return;
          seen.add(key);
          items.push({ title, url: href, image: img, price, currency: "USD" });
        });
      }

      if (items.length) break; // enough from first good page
    }

    const norm = (s) => String(s || "").trim().toLowerCase();
    const toSpecs = (title = "") => {
      const t = norm(title);
      const dex =
        /\bleft\b|\blh\b/.test(t) ? "LEFT" :
        /\bright\b|\brh\b/.test(t) ? "RIGHT" : undefined;
      const head =
        /\bmallet\b|phantom|spider|tyne|inovai/.test(t) ? "MALLET" :
        /\bblade\b|newport|anser|bb|queen b|link/.test(t) ? "BLADE" : undefined;
      const len = (t.match(/\b(33|34|35|36)\b/) || [])[1];
      return { dexterity: dex, headType: head, length: len ? Number(len) : undefined };
    };

    const out = (items || []).map(p => {
      if (!p?.title || typeof p.price !== "number") return null;
      return {
        source: "2ndswing",
        retailer: "2nd Swing",
        productId: p.url || p.title,
        url: p.url,
        title: p.title,
        image: p.image || null,
        price: p.price,
        currency: p.currency || "USD",
        condition: "USED",                 // most 2nd Swing putters are preowned
        specs: toSpecs(p.title),
        createdAt: new Date().toISOString(),
        __model: p.title.toLowerCase().replace(/\s+/g, " ").replace(/putter|golf/g, "").trim().slice(0, 60),
      };
    }).filter(Boolean);

    return res.status(200).json(out);
  } catch (e) {
    console.error("[2ndswing] error:", e?.message || e);
    return res.status(200).json([]); // never throw
  }
}
