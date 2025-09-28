export const runtime = "nodejs";

import { getSql } from "../../lib/db.js";
import { TOUR_PUTTERS_2025 } from "../../lib/data/tourPutters2025.js";

const DEFAULT_WINDOW_DAYS = 45;

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function computeSnapshot(rows = [], { windowDays, label }) {
  const totals = [];
  const conditionCounts = new Map();
  const buyingCounts = new Map();
  let lastObserved = null;
  let currency = null;

  rows.forEach((row) => {
    const total =
      toNumber(row?.total_value) ??
      (row?.total !== undefined && row?.total !== null
        ? toNumber(row.total)
        : null);
    const fallbackPrice = toNumber(row?.price);
    const normalizedTotal = total ?? (fallbackPrice !== null ? fallbackPrice : null);
    if (normalizedTotal !== null) {
      totals.push(normalizedTotal);
    }

    const condition = String(row?.condition || "").trim();
    if (condition) {
      const key = condition.toUpperCase();
      conditionCounts.set(key, (conditionCounts.get(key) || 0) + 1);
    }

    const rawBuying = row?.buying_types || row?.buyingOptions || row?.buying_options;
    if (Array.isArray(rawBuying)) {
      rawBuying
        .map((entry) => String(entry || "").trim())
        .filter(Boolean)
        .forEach((entry) => {
          buyingCounts.set(entry, (buyingCounts.get(entry) || 0) + 1);
        });
    } else if (typeof rawBuying === "string" && rawBuying) {
      const parts = rawBuying
        .split(/[;,]/)
        .map((part) => part.trim())
        .filter(Boolean);
      parts.forEach((entry) => {
        buyingCounts.set(entry, (buyingCounts.get(entry) || 0) + 1);
      });
    }

    if (!currency && row?.currency) {
      currency = row.currency;
    }

    if (row?.observed_at) {
      const observed = new Date(row.observed_at);
      if (!Number.isNaN(observed.valueOf())) {
        if (!lastObserved || observed > lastObserved) {
          lastObserved = observed;
        }
      }
    }
  });

  const sampleSize = totals.length;
  if (!sampleSize) {
    return {
      snapshot: null,
      meta: {
        sampleSize: 0,
        windowDays,
        lastObservedAt: lastObserved ? lastObserved.toISOString() : null,
        currency: currency || "USD",
        label,
      },
    };
  }

  const min = Math.min(...totals);
  const max = Math.max(...totals);
  const avg = totals.reduce((acc, val) => acc + val, 0) / sampleSize;

  const bucketCount = Math.min(7, Math.max(4, Math.ceil(Math.sqrt(sampleSize))));
  const range = Math.max(max - min, 1);
  const bucketSize = range / bucketCount;
  const histogram = Array.from({ length: bucketCount }, () => 0);
  const buckets = [];

  for (let i = 0; i < bucketCount; i += 1) {
    buckets.push(Math.round(min + bucketSize * (i + 1)));
  }

  totals.forEach((value) => {
    const idx = Math.min(bucketCount - 1, Math.floor((value - min) / bucketSize));
    histogram[idx] += 1;
  });

  const conditions = Array.from(conditionCounts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => (b.count || 0) - (a.count || 0));

  const buyingOptions = Array.from(buyingCounts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => (b.count || 0) - (a.count || 0));

  return {
    snapshot: {
      price: {
        min,
        max,
        avg,
        histogram,
        buckets,
        sampleSize,
      },
      conditions,
      buyingOptions,
      brandsTop: [],
    },
    meta: {
      sampleSize,
      windowDays,
      lastObservedAt: lastObserved ? lastObserved.toISOString() : null,
      currency: currency || "USD",
      label,
    },
  };
}

function normalizeLineup() {
  return TOUR_PUTTERS_2025.map((entry) => {
    const modelKey = String(entry?.modelKey || "").trim();
    if (!modelKey) return null;
    return {
      modelKey,
      displayName: entry.displayName || modelKey,
      usageRank: entry.usageRank ?? null,
      playerCount: entry.playerCount ?? null,
      sourceUrl: entry.sourceUrl || null,
    };
  }).filter(Boolean);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const windowParam = Number(req.query?.windowDays);
    const windowDays = Number.isFinite(windowParam)
      ? Math.max(7, Math.min(120, Math.floor(windowParam)))
      : DEFAULT_WINDOW_DAYS;

    const lineup = normalizeLineup();
    if (lineup.length === 0) {
      return res.status(200).json({ ok: true, summary: { snapshot: null, meta: { sampleSize: 0, windowDays, label: "2025 tour lineup" } }, models: [] });
    }

    const sql = getSql();
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

    const summaryRows = [];
    const models = [];

    for (const entry of lineup) {
      const rows = await sql`
        WITH latest AS (
          SELECT DISTINCT ON (p.item_id)
            p.item_id,
            p.price,
            p.shipping,
            p.total,
            p.condition,
            p.observed_at
          FROM item_prices p
          JOIN items i ON i.item_id = p.item_id
          WHERE i.model_key = ${entry.modelKey}
            AND p.observed_at >= ${since}
          ORDER BY p.item_id, p.observed_at DESC
        )
        SELECT
          l.item_id,
          l.price,
          l.shipping,
          l.total,
          COALESCE(l.total, l.price + COALESCE(l.shipping, 0)) AS total_value,
          l.condition,
          l.observed_at,
          i.currency,
          i.title
        FROM latest l
        JOIN items i ON i.item_id = l.item_id
      `;

      const { snapshot, meta } = computeSnapshot(rows, {
        windowDays,
        label: entry.displayName,
      });

      if (rows?.length) {
        rows.forEach((row) => {
          summaryRows.push({
            ...row,
            model_key: entry.modelKey,
          });
        });
      }

      models.push({
        ...entry,
        snapshot,
        meta,
      });
    }

    const summary = computeSnapshot(summaryRows, {
      windowDays,
      label: "2025 tour lineup",
    });

    return res.status(200).json({
      ok: true,
      windowDays,
      summary,
      models,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
}
