export const runtime = "nodejs";

import { getSql } from "../../lib/db.js";
import { PUTTER_CATALOG } from "../../lib/data/putterCatalog.js";
import { normalizeModelKey } from "../../lib/normalize.js";
import {
  sanitizeModelKey,
  stripAccessoryTokens,
  containsAccessoryToken,
  HEAD_COVER_TOKEN_VARIANTS,
} from "../../lib/sanitizeModelKey.js";
import { decorateEbayUrl } from "../../lib/affiliate.js";

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

function ensurePutterQuery(text = "") {
  let s = String(text || "").trim();
  if (!s) return "golf putter";
  s = s.replace(/\bputters\b/gi, "putter");
  if (!/\bputter\b/i.test(s)) {
    s = `${s} putter`;
  }
  return s.replace(/\s+/g, " ").trim();
}

const DEFAULT_LOOKBACK_WINDOWS_HOURS = [24, 72, 168];

const HEAD_COVER_TEXT_RX = /\b(head\s*cover|headcover|with\s*cover|includes\s*cover|hc)\b/i;

function isAccessoryDominatedTitle(title = "") {
  if (!title) return false;

  const raw = String(title);
  let hasHeadcoverSignal = HEAD_COVER_TEXT_RX.test(raw);
  const hasPutterToken = /\bputter\b/i.test(raw);
  const tokens = raw.split(/\s+/).filter(Boolean);

  let accessoryCount = 0;
  let substantiveCount = 0;

  for (const token of tokens) {
    const normalizedToken = token.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (!normalizedToken || normalizedToken === "putter") continue;
    if (HEAD_COVER_TOKEN_VARIANTS.has(normalizedToken)) {
      hasHeadcoverSignal = true;
      continue;
    }
    if (containsAccessoryToken(token)) {
      accessoryCount++;
    } else {
      substantiveCount++;
    }
  }

  const strippedTokens = stripAccessoryTokens(raw)
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]/gi, "").toLowerCase())
    .filter(
      (token) =>
        token &&
        token !== "putter" &&
        !HEAD_COVER_TOKEN_VARIANTS.has(token)
    );
  const remainingCount = strippedTokens.length;

  if (hasHeadcoverSignal) {
    return false;
  }

  if (!remainingCount) {
    return true;
  }

  if (!hasPutterToken && accessoryCount) {
    if (accessoryCount >= remainingCount || accessoryCount >= 2) {
      return true;
    }
  }

  if (!accessoryCount) {
    return false;
  }

  if (substantiveCount && accessoryCount < substantiveCount) {
    return false;
  }

  return accessoryCount >= remainingCount;
}

async function queryTopDeals(sql, since) {
  return sql`
      WITH latest_prices AS (
        SELECT DISTINCT ON (p.item_id)
          p.item_id,
          p.observed_at,
          p.price,
          p.shipping,
          COALESCE(p.total, p.price + COALESCE(p.shipping, 0)) AS total,
          p.condition
        FROM item_prices p
        WHERE p.observed_at >= ${since}
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
          AND n >= 5
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
        COALESCE(stats.n, live_stats.live_n) AS n,
        stats.window_days,
        COALESCE(stats.p10_cents, live_stats.live_p10_cents) AS p10_cents,
        COALESCE(stats.p50_cents, live_stats.live_p50_cents) AS p50_cents,
        COALESCE(stats.p90_cents, live_stats.live_p90_cents) AS p90_cents,
        COALESCE(stats.dispersion_ratio, live_stats.live_dispersion_ratio) AS dispersion_ratio,
        COALESCE(stats.updated_at, live_stats.latest_observed_at) AS updated_at,
        mc.listing_count,
        CASE
          WHEN stats.p50_cents IS NOT NULL THEN 'aggregated'
          WHEN live_stats.live_p50_cents IS NOT NULL THEN 'live'
          ELSE NULL
        END AS stats_source,
        stats.n AS aggregated_n,
        stats.updated_at AS aggregated_updated_at,
        live_stats.live_n,
        live_stats.latest_observed_at AS live_updated_at
      FROM latest_prices lp
      JOIN items i ON i.item_id = lp.item_id
      LEFT JOIN base_stats stats ON stats.model = i.model_key
      LEFT JOIN LATERAL (
        SELECT
          live_totals.live_n,
          live_totals.live_p10_cents,
          live_totals.live_p50_cents,
          live_totals.live_p90_cents,
          CASE
            WHEN live_totals.live_p10_cents IS NOT NULL AND live_totals.live_p10_cents <> 0
              THEN live_totals.live_p90_cents / NULLIF(live_totals.live_p10_cents, 0)
            ELSE NULL
          END AS live_dispersion_ratio,
          live_totals.latest_observed_at
        FROM (
          SELECT
            COUNT(*) AS live_n,
            percentile_cont(0.1) WITHIN GROUP (ORDER BY lp2.total) * 100 AS live_p10_cents,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY lp2.total) * 100 AS live_p50_cents,
            percentile_cont(0.9) WITHIN GROUP (ORDER BY lp2.total) * 100 AS live_p90_cents,
            MAX(lp2.observed_at) AS latest_observed_at
          FROM latest_prices lp2
          JOIN items i2 ON i2.item_id = lp2.item_id
          WHERE i2.model_key = i.model_key
            AND lp2.total IS NOT NULL
            AND lp2.total > 0
        ) AS live_totals
      ) AS live_stats ON TRUE
      LEFT JOIN model_counts mc ON mc.model_key = i.model_key
      WHERE i.model_key IS NOT NULL
        AND i.model_key <> ''
        AND lp.total IS NOT NULL
        AND lp.total > 0
        AND (
          stats.p50_cents IS NOT NULL
          OR live_stats.live_p50_cents IS NOT NULL
        )
    `;
}

export function buildDealsFromRows(rows, limit, lookbackHours = null) {
  const grouped = new Map();

  for (const row of rows) {
    const modelKey = row.model_key || "";
    if (!modelKey) continue;

    if (isAccessoryDominatedTitle(row?.title || "")) {
      continue;
    }

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

  return ranked.map((entry) => {
    const { row, total, price, shipping, median, savingsAmount, savingsPercent } = entry;
    const label = formatModelLabel(row.model_key, row.brand, row.title);
    const sanitized = sanitizeModelKey(row.model_key, {
      storedBrand: row.brand,
    });
    const {
      query: canonicalQuery,
      queryVariants: canonicalVariants = {},
      rawLabel: rawLabelWithAccessories,
      cleanLabel: cleanLabelWithoutAccessories,
    } = sanitized;
    let cleanQuery = canonicalQuery || null;
    let accessoryQuery = canonicalVariants.accessory || null;
    let query = cleanQuery;
    const fallbackCandidates = [
      formatModelLabel(row.model_key, row.brand, row.title),
      [row.brand, row.title].filter(Boolean).join(" ").trim(),
    ].filter(Boolean);
    if (!query && row.brand) {
      const brandBacked = sanitizeModelKey(`${row.brand} ${row.model_key}`, {
        storedBrand: row.brand,
      });
      if (brandBacked?.query) {
        query = brandBacked.query;
        cleanQuery = cleanQuery || brandBacked.query;
      }
      if (!accessoryQuery && brandBacked?.queryVariants?.accessory) {
        accessoryQuery = brandBacked.queryVariants.accessory;
      }
    }
    if (!query) {
      for (const candidate of fallbackCandidates) {
        const candidateSanitized = sanitizeModelKey(candidate, {
          storedBrand: row.brand,
        });
        if (candidateSanitized?.query) {
          query = candidateSanitized.query;
          cleanQuery = cleanQuery || candidateSanitized.query;
          if (!accessoryQuery && candidateSanitized?.queryVariants?.accessory) {
            accessoryQuery = candidateSanitized.queryVariants.accessory;
          }
          break;
        }
      }
    }
    if (!query) {
      const base = stripAccessoryTokens(`${row.brand || ""} ${label}`.trim());
      query = ensurePutterQuery(base || label || row.brand || "");
      if (!cleanQuery) {
        cleanQuery = query;
      }
      const accessoryBase = `${row.brand || ""} ${label}`.trim();
      if (!accessoryQuery && accessoryBase) {
        accessoryQuery = ensurePutterQuery(accessoryBase);
      }
    }

    const labelWasAccessoryOnly = Boolean(rawLabelWithAccessories) && !cleanLabelWithoutAccessories;
    const shouldPromoteAccessoryQuery =
      Boolean(accessoryQuery) && labelWasAccessoryOnly && !cleanQuery;
    if (shouldPromoteAccessoryQuery) {
      query = accessoryQuery;
    } else if (cleanQuery) {
      query = cleanQuery;
    }

    const currency = row.currency || "USD";
    const statsSource = row.stats_source || null;
    const stats = {
      p10: centsToNumber(row.p10_cents),
      p50: median,
      p90: centsToNumber(row.p90_cents),
      n: toNumber(row.n),
      dispersionRatio: toNumber(row.dispersion_ratio),
      source: statsSource,
    };
    const statsMeta = {
      source: statsSource,
      windowDays: statsSource === "aggregated" ? toNumber(row.window_days) : null,
      updatedAt:
        statsSource === "aggregated"
          ? row.aggregated_updated_at || row.updated_at || null
          : row.live_updated_at || row.updated_at || null,
      sampleSize:
        statsSource === "aggregated"
          ? toNumber(row.aggregated_n ?? row.n)
          : toNumber(row.live_n ?? row.n),
    };
    if (statsSource === "live" && lookbackHours != null) {
      statsMeta.lookbackHours = lookbackHours;
    }
    const bestOffer = {
      itemId: row.item_id,
      title: row.title,
      url: decorateEbayUrl(row.url),
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
      query,
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
      queryVariants: {
        clean: cleanQuery || null,
        accessory: accessoryQuery || null,
      },
    };
  });
}

export async function loadRankedDeals(sql, limit, lookbackWindows = DEFAULT_LOOKBACK_WINDOWS_HOURS) {
  const windows = Array.isArray(lookbackWindows) && lookbackWindows.length > 0 ? lookbackWindows : DEFAULT_LOOKBACK_WINDOWS_HOURS;

  let deals = [];
  let windowHours = windows[windows.length - 1] ?? null;

  for (const hours of windows) {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const rows = await queryTopDeals(sql, since);
    const computed = buildDealsFromRows(rows, limit, hours);
    deals = computed;
    windowHours = hours;
    if (computed.length > 0) {
      break;
    }
  }

  return { deals, windowHours };
}

export default async function handler(req, res) {
  try {
    const sql = getSql();
    const limitParam = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    const parsedLimit = toNumber(limitParam);
    const limit = Math.min(12, Math.max(3, parsedLimit ?? 6));
    const { deals, windowHours } = await loadRankedDeals(sql, limit);

    return res.status(200).json({
      ok: true,
      generatedAt: new Date().toISOString(),
      deals,
      meta: {
        limit,
        modelCount: deals.length,
        lookbackWindowHours: windowHours,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
