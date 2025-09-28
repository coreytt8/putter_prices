export const runtime = "nodejs";

import { getSql } from "../../lib/db";
import { PUTTER_CATALOG } from "../../lib/data/putterCatalog";
import { normalizeModelKey } from "../../lib/normalize";

const CATALOG_LOOKUP = (() => {
  const map = new Map();
  for (const entry of PUTTER_CATALOG) {
    const key = normalizeModelKey(`${entry.brand} ${entry.model}`);
    if (key) {
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key).push(entry);
    }
  }
  return map;
})();

function formatModelLabel(modelKey = "", brand = "", title = "") {
  const normalized = String(modelKey || "").trim();
  if (normalized && CATALOG_LOOKUP.has(normalized)) {
    const [first] = CATALOG_LOOKUP.get(normalized);
    if (first) return `${first.brand} ${first.model}`;
  }
  const brandTitle = String(brand || "").trim();
  if (brandTitle) {
    return brandTitle;
  }
  if (title) {
    return title;
  }
  if (!normalized) return "Live Smart Price deal";
  return normalized
    .split(" ")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ""))
    .join(" ");
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function centsToNumber(value) {
  const num = toNumber(value);
  if (num === null) return null;
  return num / 100;
}

export default async function handler(req, res) {
  try {
    const sql = getSql();
    const limitParam = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    const parsedLimit = toNumber(limitParam);
    const limit = Math.min(12, Math.max(3, parsedLimit ?? 6));

    const rows = await sql`
      WITH latest_prices AS (
        SELECT DISTINCT ON (p.item_id)
          p.item_id,
          p.observed_at,
          p.price,
          p.shipping,
          COALESCE(p.total, p.price + COALESCE(p.shipping, 0)) AS total,
          p.condition
        FROM item_prices p
        WHERE p.observed_at >= date_trunc('day', now())
        ORDER BY p.item_id, p.observed_at DESC
      ),
      base_stats AS (
        SELECT DISTINCT ON (model)
          model,
          window_days,
          n,
          p10_cents,
          p50_cents,
          p90_cents,
          dispersion_ratio,
          updated_at
        FROM aggregated_stats_variant
        WHERE variant_key = ''
          AND condition_band = 'ANY'
        ORDER BY model, window_days DESC, updated_at DESC
      ),
      model_counts AS (
        SELECT i.model_key, COUNT(*) AS listing_count
        FROM latest_prices lp
        JOIN items i ON i.item_id = lp.item_id
        WHERE i.model_key IS NOT NULL AND i.model_key <> ''
        GROUP BY i.model_key
      )
      SELECT
        i.model_key,
        i.brand,
        i.title,
        i.image_url,
        i.url,
        i.currency,
        i.head_type,
        i.dexterity,
        i.length_in,
        lp.item_id,
        lp.price,
        lp.shipping,
        lp.total,
        lp.observed_at,
        lp.condition,
        stats.n,
        stats.window_days,
        stats.p10_cents,
        stats.p50_cents,
        stats.p90_cents,
        stats.dispersion_ratio,
        stats.updated_at,
        mc.listing_count
      FROM latest_prices lp
      JOIN items i ON i.item_id = lp.item_id
      JOIN base_stats stats ON stats.model = i.model_key
      LEFT JOIN model_counts mc ON mc.model_key = i.model_key
      WHERE i.model_key IS NOT NULL
        AND i.model_key <> ''
        AND lp.total IS NOT NULL
        AND lp.total > 0
        AND stats.p50_cents IS NOT NULL
        AND stats.n IS NOT NULL
        AND stats.n >= 5
    `;

    const grouped = new Map();

    for (const row of rows) {
      const modelKey = row.model_key || "";
      if (!modelKey) continue;

      const total = toNumber(row.total);
      const price = toNumber(row.price);
      const shipping = toNumber(row.shipping);
      const median = centsToNumber(row.p50_cents);
      if (!Number.isFinite(total) || !Number.isFinite(median) || median <= 0) continue;

      const savingsAmount = median - total;
      const savingsPercent = median > 0 ? savingsAmount / median : null;
      if (!Number.isFinite(savingsPercent) || savingsPercent <= 0) continue;

      const current = grouped.get(modelKey);
      if (!current || savingsPercent > current.savingsPercent || (savingsPercent === current.savingsPercent && total < current.total)) {
        grouped.set(modelKey, {
          modelKey,
          row,
          total,
          price,
          shipping,
          median,
          savingsAmount,
          savingsPercent,
        });
      }
    }

    const ranked = Array.from(grouped.values())
      .sort((a, b) => {
        if (Number.isFinite(b.savingsPercent) && Number.isFinite(a.savingsPercent) && b.savingsPercent !== a.savingsPercent) {
          return b.savingsPercent - a.savingsPercent;
        }
        if (Number.isFinite(a.total) && Number.isFinite(b.total) && a.total !== b.total) {
          return a.total - b.total;
        }
        return 0;
      })
      .slice(0, limit);

    const deals = ranked.map((entry) => {
      const { row, total, price, shipping, median, savingsAmount, savingsPercent } = entry;
      const label = formatModelLabel(row.model_key, row.brand, row.title);
      const currency = row.currency || "USD";
      const stats = {
        p10: centsToNumber(row.p10_cents),
        p50: median,
        p90: centsToNumber(row.p90_cents),
        n: toNumber(row.n),
        dispersionRatio: toNumber(row.dispersion_ratio),
      };
      const statsMeta = {
        windowDays: toNumber(row.window_days),
        updatedAt: row.updated_at || null,
      };
      const bestOffer = {
        itemId: row.item_id,
        title: row.title,
        url: row.url,
        price,
        total,
        shipping,
        currency,
        image: row.image_url,
        observedAt: row.observed_at || null,
        condition: row.condition || null,
        retailer: "eBay",
        specs: {
          headType: row.head_type || null,
          dexterity: row.dexterity || null,
          length: toNumber(row.length_in),
        },
        brand: row.brand || null,
      };

      return {
        modelKey: row.model_key,
        label,
        query: `${label} putter`,
        image: row.image_url || null,
        currency,
        bestPrice: total,
        bestOffer,
        stats,
        statsMeta,
        totalListings: toNumber(row.listing_count),
        savings: {
          amount: Number.isFinite(savingsAmount) ? savingsAmount : null,
          percent: Number.isFinite(savingsPercent) ? savingsPercent : null,
        },
      };
    });

    return res.status(200).json({
      ok: true,
      generatedAt: new Date().toISOString(),
      deals,
      meta: {
        limit,
        modelCount: deals.length,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
