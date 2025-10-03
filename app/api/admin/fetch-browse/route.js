// app/api/admin/fetch-browse/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { normalizeModelKey } from "@/lib/normalize";
import { mapConditionIdToBand } from "@/lib/condition-band";
// If your helper is named differently, change this import (e.g. getEbayToken as getAccessToken)
import { getEbayToken } from "@/lib/ebay";

const NAME_TO_IDS = {
  NEW: [1000],
  NEW_OTHER: [1500, 2750],
  NEW_WITH_DEFECTS: [1750],
  OPEN_BOX: [1500, 1750, 2750],
  MANUFACTURER_REFURBISHED: [2000, 2010, 2020, 2030, 2040, 2050, 2060, 2070],
  CERTIFIED_REFURBISHED: [2000, 2010, 2020, 2030, 2040, 2050, 2060, 2070],
  SELLER_REFURBISHED: [2500],
  REFURBISHED: [2000, 2010, 2020, 2030, 2040, 2050, 2060, 2070, 2500],
  USED: [3000, 4000, 5000, 6000],
  PREOWNED: [3000, 4000, 5000, 6000],
  PRE_OWNED: [3000, 4000, 5000, 6000],
  VERY_GOOD: [4000],
  GOOD: [5000],
  ACCEPTABLE: [6000],
  LIKE_NEW: [4000],
  FOR_PARTS: [7000],
  FOR_PARTS_OR_NOT_WORKING: [7000],
};

const VARIANT_EXPANSIONS = {
  "newport": [
    { key: "newport|circle_t", append: ["circle t"] },
    { key: "newport|tour_only", append: ["tour only"] },
    { key: "newport|gss", append: ["gss"] },
  ],
  "newport 2": [
    { key: "newport 2|circle_t", append: ["circle t"] },
    { key: "newport 2|tour_only", append: ["tour only"] },
    { key: "newport 2|gss", append: ["gss"] },
    { key: "newport 2|button_back", append: ["button back"] },
    { key: "newport 2|jet_set", append: ["jet set"] },
  ],
  "newport 2.5": [
    { key: "newport 2.5|circle_t", append: ["circle t"] },
    { key: "newport 2.5|tour_only", append: ["tour only"] },
  ],
  "newport 3": [
    { key: "newport 3|circle_t", append: ["circle t"] },
    { key: "newport 3|tour_only", append: ["tour only"] },
  ],
  "newport 1.5": [
    { key: "newport 1.5|circle_t", append: ["circle t"] },
    { key: "newport 1.5|tour_only", append: ["tour only"] },
  ],
  "phantom x": [
    { key: "phantom x|circle_t", append: ["circle t"] },
    { key: "phantom x|tour_only", append: ["tour only"] },
  ],
  "phantom 5": [
    { key: "phantom 5|circle_t", append: ["circle t"] },
    { key: "phantom 5|tour_only", append: ["tour only"] },
  ],
  "phantom 7": [
    { key: "phantom 7|circle_t", append: ["circle t"] },
    { key: "phantom 7|tour_only", append: ["tour only"] },
  ],
  "phantom 9": [
    { key: "phantom 9|circle_t", append: ["circle t"] },
    { key: "phantom 9|tour_only", append: ["tour only"] },
  ],
  "phantom 11": [
    { key: "phantom 11|circle_t", append: ["circle t"] },
    { key: "phantom 11|tour_only", append: ["tour only"] },
  ],
  "squareback": [
    { key: "squareback|circle_t", append: ["circle t"] },
    { key: "squareback|tour_only", append: ["tour only"] },
  ],
  "fastback": [
    { key: "fastback|circle_t", append: ["circle t"] },
    { key: "fastback|tour_only", append: ["tour only"] },
  ],
  "futura": [
    { key: "futura|circle_t", append: ["circle t"] },
    { key: "futura|tour_only", append: ["tour only"] },
  ],
  "button back": [
    { key: "button back|circle_t", append: ["circle t"] },
    { key: "button back|tour_only", append: ["tour only"] },
  ],
};

const BROWSE_BASE = "https://api.ebay.com/buy/browse/v1";
const CATEGORY_GOLF_CLUBS = "115280";
const ADMIN_KEY = process.env.ADMIN_KEY;

function parseBool(value) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseLimit(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(200, Math.floor(n)));
}

function parseConditions(raw) {
  if (!raw) return { names: [], useIds: false };
  const parts = String(raw)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/[^a-z0-9]+/gi, " ").trim())
    .map((part) => part.replace(/\s+/g, "_").toUpperCase());

  const names = Array.from(new Set(parts));
  const useIds =
    names.length > 0 && names.every((name) => Array.isArray(NAME_TO_IDS[name]) && NAME_TO_IDS[name].length > 0);
  return { names, useIds };
}

function parseConditionIds(raw) {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((num) => Number.isFinite(num));
}

function expandConditionNames(names = []) {
  const ids = new Set();
  for (const name of names) {
    const arr = NAME_TO_IDS[name];
    if (Array.isArray(arr)) {
      for (const id of arr) ids.add(Number(id));
    }
  }
  return Array.from(ids);
}

function ensurePutter(query) {
  const trimmed = String(query || "").trim();
  if (!trimmed) return "putter";
  return /\bputter\b/i.test(trimmed) ? trimmed : `${trimmed} putter`;
}

function applyVariantTokens(base, tokens = []) {
  const trimmed = String(base || "").trim();
  const lower = trimmed.toLowerCase();
  const extras = tokens
    .map((token) => String(token || "").trim())
    .filter(Boolean)
    .filter((token) => !lower.includes(token.toLowerCase()));
  if (!extras.length) return trimmed || tokens.join(" ");
  return `${trimmed} ${extras.join(" ")}`.trim();
}

async function followConditionHref(response, attempt, limit, attemptsLog) {
  const distributions = Array.isArray(response?.refinement?.conditionDistributions)
    ? response.refinement.conditionDistributions
    : [];
  for (const dist of distributions) {
    const href = dist?.refinementHref;
    if (!href) continue;
    const name = String(dist?.condition || "").trim().toUpperCase();
    if (name !== "NEW" && name !== "USED") continue;
    const { data, url } = await browseSearch({ refinementHref: href, limit });
    const items = Array.isArray(data?.itemSummaries) ? data.itemSummaries : [];
    attemptsLog.push({
      url,
      count: items.length,
      variantKey: attempt.variantKey || "",
      label: `${attempt.label}|refinement:${name}`,
    });
    if (items.length) {
      return { data, url, count: items.length };
    }
  }
  return null;
}

async function executeAttempt(attempt, limit, attemptsLog) {
  const { data, url } = await browseSearch({
    q: attempt.q,
    limit,
    categoryId: attempt.categoryId,
    addPutterWord: attempt.addPutterWord,
    conditions: attempt.conditions,
    conditionIds: attempt.conditionIds,
    allBuying: attempt.allBuying,
  });
  const items = Array.isArray(data?.itemSummaries) ? data.itemSummaries : [];
  attemptsLog.push({ url, count: items.length, variantKey: attempt.variantKey || "", label: attempt.label });
  if (items.length) {
    return { data, url, count: items.length };
  }
  const refinement = await followConditionHref(data, attempt, limit, attemptsLog);
  if (refinement) return refinement;
  return { data, url, count: 0 };
}

function buildAttemptConfigs({ rawQuery, conditions, conditionIds, allBuying, modelKey }) {
  const attempts = [];
  const baseConditions = Array.from(conditions?.names || []);
  const explicitConditionIds = Array.from(conditionIds || []);
  const derivedConditionIds = explicitConditionIds.length
    ? explicitConditionIds
    : conditions?.useIds
    ? expandConditionNames(baseConditions)
    : [];

  const baseAttempt = {
    label: "base",
    q: rawQuery,
    categoryId: null,
    addPutterWord: false,
    allBuying: Boolean(allBuying),
    conditions: baseConditions,
    conditionIds: [],
    variantKey: "",
  };
  attempts.push(baseAttempt);

  attempts.push({ ...baseAttempt, label: "category", categoryId: CATEGORY_GOLF_CLUBS });

  attempts.push({
    ...baseAttempt,
    label: "category+putter",
    categoryId: CATEGORY_GOLF_CLUBS,
    addPutterWord: true,
  });

  attempts.push({
    ...baseAttempt,
    label: "category+putter+auctions",
    categoryId: CATEGORY_GOLF_CLUBS,
    addPutterWord: true,
    allBuying: true,
  });

  if (derivedConditionIds.length) {
    attempts.push({
      ...baseAttempt,
      label: "category+putter+conditionIds",
      categoryId: CATEGORY_GOLF_CLUBS,
      addPutterWord: true,
      allBuying: true,
      conditions: [],
      conditionIds: derivedConditionIds,
    });
  }

  const stripped = normalizeModelKey(rawQuery);
  if (stripped && stripped !== rawQuery.toLowerCase()) {
    attempts.push({
      ...baseAttempt,
      label: "brandless",
      q: stripped,
      categoryId: CATEGORY_GOLF_CLUBS,
      addPutterWord: true,
      allBuying: true,
    });
  }

  const variantAttempts = [];
  const expansions = VARIANT_EXPANSIONS[modelKey] || [];
  for (const expansion of expansions) {
    const qVariant = applyVariantTokens(rawQuery, expansion.append || []);
    variantAttempts.push({
      ...baseAttempt,
      label: `variant:${expansion.key}`,
      q: qVariant,
      categoryId: CATEGORY_GOLF_CLUBS,
      addPutterWord: true,
      allBuying: true,
      variantKey: expansion.key,
    });
  }

  attempts.push(...variantAttempts);

  if (baseConditions.length || derivedConditionIds.length) {
    attempts.push({
      ...baseAttempt,
      label: "category+putter+no-conditions",
      categoryId: CATEGORY_GOLF_CLUBS,
      addPutterWord: true,
      allBuying: true,
      conditions: [],
      conditionIds: [],
    });
  }

  return attempts;
}

async function runSearchLadder({ rawQuery, limit, conditions, conditionIds, allBuying, modelKey }) {
  const attempts = buildAttemptConfigs({ rawQuery, conditions, conditionIds, allBuying, modelKey });
  const attemptsLog = [];
  let finalData = null;
  let finalUrl = "";
  let finalVariantKey = "";
  let lastData = null;

  for (const attempt of attempts) {
    const result = await executeAttempt(attempt, limit, attemptsLog);
    if (result.count > 0) {
      finalData = result.data;
      finalUrl = result.url;
      finalVariantKey = attempt.variantKey || "";
      break;
    }
    lastData = result.data || lastData;
  }

  if (!finalUrl && attemptsLog.length) {
    finalUrl = attemptsLog[attemptsLog.length - 1].url || "";
  }

  const data = finalData || lastData || { itemSummaries: [] };
  return { data, attempts: attemptsLog, usedUrl: finalUrl, variantKey: finalVariantKey, found: Boolean(finalData) };
}

async function browseSearch({
  q = "",
  limit = 50,
  offset = 0,
  categoryId = null,
  addPutterWord = false,
  conditions = [],
  conditionIds = [],
  allBuying = false,
  refinementHref = null,
} = {}) {
  const rawToken = await getEbayToken();
  const token =
    typeof rawToken === "string"
      ? rawToken
      : rawToken?.access_token || rawToken?.token || rawToken?.accessToken || "";

  if (!token) {
    throw new Error("Failed to retrieve eBay access token");
  }

  const url = refinementHref
    ? new URL(refinementHref)
    : new URL(`${BROWSE_BASE}/item_summary/search`);

  const normalizedLimit = Number.isFinite(Number(limit)) ? Number(limit) : 50;
  const normalizedOffset = Number.isFinite(Number(offset)) ? Number(offset) : 0;

  if (!refinementHref) {
    const query = addPutterWord ? ensurePutter(q) : String(q || "");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(normalizedLimit));
    url.searchParams.set("offset", String(normalizedOffset));
    url.searchParams.set("fieldgroups", "CONDITION_REFINEMENTS");

    if (categoryId) {
      url.searchParams.set("category_ids", String(categoryId));
    }

    const filterParts = [];
    const normalizedIds = Array.from(
      new Set(
        (Array.isArray(conditionIds) ? conditionIds : [])
          .map((id) => Number(id))
          .filter((num) => Number.isFinite(num))
      )
    );

    if (normalizedIds.length) {
      filterParts.push(`conditionIds:{${normalizedIds.join("|")}}`);
    } else {
      const normalizedConditions = Array.from(
        new Set(
          (Array.isArray(conditions) ? conditions : [])
            .map((name) => String(name || "").trim())
            .filter(Boolean)
        )
      );
      if (normalizedConditions.length) {
        filterParts.push(`conditions:{${normalizedConditions.join("|")}}`);
      }
    }

    const desiredBuying = allBuying
      ? ["FIXED_PRICE", "AUCTION", "AUCTION_WITH_BUY_IT_NOW"]
      : ["FIXED_PRICE"];
    const buyingFilters = Array.from(
      new Set(
        desiredBuying
          .map((opt) => String(opt || "").trim().toUpperCase())
          .filter(Boolean)
      )
    );
    if (buyingFilters.length) {
      filterParts.push(`buyingOptions:{${buyingFilters.join("|")}}`);
    }

    if (filterParts.length) {
      url.searchParams.set("filter", filterParts.join(","));
    } else {
      url.searchParams.delete("filter");
    }
  } else {
    if (limit !== undefined && limit !== null) {
      url.searchParams.set("limit", String(normalizedLimit));
    } else if (!url.searchParams.has("limit")) {
      url.searchParams.set("limit", String(normalizedLimit));
    }

    if (offset !== undefined && offset !== null) {
      url.searchParams.set("offset", String(normalizedOffset));
    } else if (!url.searchParams.has("offset")) {
      url.searchParams.set("offset", String(normalizedOffset));
    }

    url.searchParams.set("fieldgroups", "CONDITION_REFINEMENTS");
  }

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`eBay browse ${res.status}: ${txt.slice(0, 500)}`);
  }
  const data = await res.json();
  return { data, url: url.toString() };
}

export async function POST(req) {
  try {
    // simple admin guard
    if (!ADMIN_KEY || (req.headers.get("x-admin-key") || "") !== ADMIN_KEY) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const raw = (searchParams.get("model") || "").trim();
    const limit = parseLimit(searchParams.get("limit"));
    const debug = parseBool(searchParams.get("debug"));
    const allBuying = parseBool(searchParams.get("allBuying"));
    const conditions = parseConditions(searchParams.get("conditions"));
    const conditionIds = parseConditionIds(searchParams.get("conditionIds"));
    if (!raw) return NextResponse.json({ ok: false, error: "Missing model" }, { status: 400 });

    const modelKey = normalizeModelKey(raw);
    const { data, attempts, usedUrl, variantKey, found } = await runSearchLadder({
      rawQuery: raw,
      limit,
      conditions,
      conditionIds,
      allBuying,
      modelKey,
    });

    const summaries = Array.isArray(data?.itemSummaries) ? data.itemSummaries : [];
    const conditionHistogram = Array.isArray(data?.refinement?.conditionDistributions)
      ? data.refinement.conditionDistributions.map((c) => ({
          condition: c.condition,
          conditionId: c.conditionId,
          matchCount: Number(c.matchCount || 0),
        }))
      : [];

    // Normalize items (include auction currentBidPrice + optional shipping)
    const items = summaries.map((it) => {
      const priceVal = Number(it.price?.value ?? it.currentBidPrice?.value ?? 0);
      const shipVal = Number(it.shippingOptions?.[0]?.shippingCost?.value ?? 0);
      const total = priceVal + (Number.isFinite(shipVal) ? shipVal : 0);
      const condId = it.conditionId ? Number(it.conditionId) : null;

      return {
        item_id: it.itemId,
        title: it.title || "",
        item_web_url: it.itemWebUrl || null,
        model: modelKey,
        variant_key: variantKey || "",
        price_cents: Math.round(priceVal * 100),
        shipping_cents: Number.isFinite(shipVal) ? Math.round(shipVal * 100) : 0,
        total_cents: Math.round(total * 100),
        condition_id: condId,
        condition_band: mapConditionIdToBand(condId),
      };
    });

    const sql = getSql();
    let inserted = 0;
    let skipped = 0;
    let firstError = null;

    for (const r of items) {
      if (!r.item_id) {
        skipped++;
        continue;
      }
      try {
        // Requires unique index: CREATE UNIQUE INDEX IF NOT EXISTS ux_snapshots_item_day ON public.listing_snapshots (item_id, snapshot_day);
        const res = await sql`
          INSERT INTO listing_snapshots
            (item_id, model, variant_key, price_cents, shipping_cents, total_cents,
             condition_id, condition_band, snapshot_ts, snapshot_day)
          VALUES
            (${r.item_id}, ${r.model}, ${r.variant_key},
             ${r.total_cents - r.shipping_cents}, ${r.shipping_cents}, ${r.total_cents},
             ${r.condition_id}, ${r.condition_band},
             now(), (now() AT TIME ZONE 'UTC')::date)
          ON CONFLICT (item_id, snapshot_day) DO NOTHING
          RETURNING 1
        `;
        if (res.length) inserted++;
        else skipped++;
      } catch (e) {
        skipped++;
        if (!firstError) firstError = String(e);
      }
    }

    const out = {
      ok: true,
      model: modelKey,
      saw: summaries.length,
      inserted,
      skipped,
      firstError,
      histogram: conditionHistogram,
    };

    const sample = summaries.length
      ? {
          id: summaries[0].itemId,
          title: summaries[0].title,
          price: summaries[0].price,
          currentBidPrice: summaries[0].currentBidPrice,
          shipping: summaries[0].shippingOptions?.[0]?.shippingCost,
          condition: summaries[0].condition,
          conditionId: summaries[0].conditionId,
          variantKey: variantKey || "",
        }
      : null;

    if (debug || found) {
      out.debug = {
        attempts,
        usedUrl,
        sample,
        histogram: conditionHistogram,
      };
    }

    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
