import { NextResponse } from "next/server";

export const dynamic = "force-dynamic"; // no caching

/* ---------------- Server-side affiliate tagging (no rover) ---------------- */
function tagAffiliate(url) {
  try {
    const u = new URL(url);
    const camp = process.env.EPN_CAMPAIGN_ID;
    if (!camp) return url;

    const tool = process.env.EPN_TOOL_ID || "10001";
    const custom = process.env.EPN_CUSTOM_ID || "";

    u.searchParams.set("mkcid", "1");
    u.searchParams.set("mkrid", "711-53200-19255-0");
    u.searchParams.set("siteid", "0");
    u.searchParams.set("campid", camp);
    u.searchParams.set("customid", custom);
    u.searchParams.set("toolid", tool);
    u.searchParams.set("mkevt", "1");

    return u.toString();
  } catch {
    return url;
  }
}

/* ---------------- Token cache for Browse API ---------------- */
let tokenCache = { token: null, expiresAt: 0 };

async function getAppToken() {
  const now = Date.now();
  if (tokenCache.token && now < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }

  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    const e = new Error("EBAY_CLIENT_ID/EBAY_CLIENT_SECRET missing");
    e.details = "Set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET in your environment.";
    throw e;
  }

  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  // minimal scope for Browse
  body.set("scope", "https://api.ebay.com/oauth/api_scope");

  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    const e = new Error(`oauth_error ${res.status}`);
    e.details = text;
    throw e;
  }

  const json = await res.json();
  tokenCache = {
    token: json.access_token,
    expiresAt: now + (json.expires_in || 7200) * 1000,
  };
  return tokenCache.token;
}

/* ---------------- Utilities (matching, grouping, etc.) ---------------- */
const BRAND_WORDS = [
  "scotty","cameron","taylormade","tm","ping","odyssey","lab","golf","putter","putters"
];

const SOFT_TOKENS = new Set([
  "mint","new","brand","brandnew","unused","never","neverused","like","likenew",
  "nib","nwt","open","box","openbox","excellent","great","condition","gc","ln","lnib"
]);

const SOFT_SYNONYMS = {
  mint: ["mint", "like new", "ln", "excellent condition", "near mint"],
  new: ["new", "brand new", "nib", "new in box", "nwt", "unused", "never used", "open box"],
  unused: ["unused", "never used"],
  like: ["like new", "ln"],
  ln: ["like new", "ln"],
  nib: ["nib", "new in box"],
};

function norm(s) { return (s || "").toLowerCase(); }
function tokenize(q) { return norm(q).split(/\s+/).filter(Boolean); }

function priceNumberFromAny(x) {
  if (x == null) return null;
  if (typeof x === "number") return isFinite(x) ? x : null;
  if (typeof x === "object") {
    const n = Number(x.value ?? x.amount ?? x.__value__);
    return isFinite(n) ? n : null;
  }
  const m = String(x).match(/[\d,.]+/);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ""));
  return isFinite(n) ? n : null;
}

function tokenMatchesTitle(token, title) {
  const t = norm(token);
  const ttl = norm(title);

  if (ttl.includes(t)) return true;

  // inches: "35", 35", 35in, 35 in
  const inch = t.match(/^(\d{2})(?:"|in| in)?$/);
  if (inch) {
    const n = inch[1];
    if (ttl.includes(`${n}"`) || ttl.includes(`${n}in`) || ttl.includes(`${n} in`) || ttl.includes(` ${n} `)) {
      return true;
    }
  }

  if (SOFT_TOKENS.has(t)) {
    const syns = SOFT_SYNONYMS[t] || [t];
    return syns.some((phrase) => ttl.includes(norm(phrase)));
  }

  return false;
}

/** Require all core tokens; soft tokens optional; ≥70% of all tokens must match. */
function titleMatchesQuery(title, tokens) {
  if (!tokens.length) return true;
  const core = tokens.filter((w) => !SOFT_TOKENS.has(norm(w)));
  const coreOk = core.every((w) => tokenMatchesTitle(w, title));
  if (!coreOk) return false;
  const hits = tokens.filter((w) => tokenMatchesTitle(w, title)).length;
  return hits / tokens.length >= 0.7;
}

function modelKey(title) {
  const toks = norm(title)
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !BRAND_WORDS.includes(t));
  return toks.slice(0, 4).join(" ");
}

/* ---------------- Browse API search ---------------- */
async function browseSearch({ q, limit = 100, offset = 0, sort = "", filters = "" }) {
  const token = await getAppToken();
  const MARKET = process.env.EBAY_MARKETPLACE || "EBAY_US";

  const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  if (sort === "newlylisted") {
    // Browse uses "newlyListed" (camelCase)
    url.searchParams.set("sort", "newlyListed");
  }
  if (filters) {
    url.searchParams.set("filter", filters);
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": MARKET,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    const e = new Error(`browse_api_error ${res.status}`);
    e.details = text;
    throw e;
  }

  const data = await res.json();
  const items = Array.isArray(data?.itemSummaries) ? data.itemSummaries : [];

  return items.map((it) => {
    const price = it.price;
    const buyingOptions = Array.isArray(it.buyingOptions) ? it.buyingOptions.join(",") : (it.buyingOptions || "");
    return {
      itemId: it.itemId || it.itemHref || it.itemWebUrl,
      title: it.title || "",
      price: priceNumberFromAny(price),
      currency: price?.currency || "USD",
      condition: it.condition || null,
      image: it.image?.imageUrl || null,
      url: it.itemWebUrl || "",
      retailer: "eBay",
      createdAt: it.itemCreationDate || null, // may be null in summaries; sort param handles recency upstream
      buyingOption: String(buyingOptions || "").toUpperCase(),
    };
  });
}

/* Build Browse filter string from query params */
function buildBrowseFilters({ onlyComplete, minPrice, maxPrice, conditions, buyingOptions }) {
  const parts = [];

  // price:[min..max]
  if (minPrice || maxPrice) {
    const min = minPrice ? Number(minPrice) : "";
    const max = maxPrice ? Number(maxPrice) : "";
    if (min !== "" || max !== "") {
      parts.push(`price:[${min === "" ? "" : min}..${max === "" ? "" : max}]`);
    }
  }

  // conditions:{NEW|USED|...}
  if (conditions?.length) {
    const vals = conditions.join("|");
    parts.push(`conditions:{${vals}}`);
  }

  // buyingOptions:{FIXED_PRICE|AUCTION|BEST_OFFER}
  if (buyingOptions?.length) {
    const vals = buyingOptions.join("|");
    parts.push(`buyingOptions:{${vals}}`);
  }

  // Note: onlyComplete we still enforce after fetch (image+price),
  // since Browse can sometimes miss an image in summaries.
  return parts.join(",");
}

/* ---------------- Route handler ---------------- */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    const group = searchParams.get("group") !== "false"; // default grouped
    const onlyComplete = searchParams.get("onlyComplete") === "true";
    const minPrice = searchParams.get("minPrice") || "";
    const maxPrice = searchParams.get("maxPrice") || "";
    const sort = searchParams.get("sort") || ""; // "newlylisted" or ""
    const broaden = searchParams.get("broaden") === "true";

    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const perPage = Math.max(1, parseInt(searchParams.get("perPage") || "10", 10));

    const conditions = (searchParams.get("conditions") || "")
      .split(",").map((s) => s.trim()).filter(Boolean).map((s) => s.toUpperCase());

    const buyingOptions = (searchParams.get("buyingOptions") || "")
      .split(",").map((s) => s.trim()).filter(Boolean).map((s) => s.toUpperCase());

    if (!q) {
      return NextResponse.json({
        groups: [], offers: [],
        hasNext: false, hasPrev: false,
        fetchedCount: 0, keptCount: 0,
      });
    }

    // --- Build filters for Browse
    const filterStr = buildBrowseFilters({ onlyComplete, minPrice, maxPrice, conditions, buyingOptions });

    // --- Fetch items (one or a couple of pages upstream), then filter locally with soft tokens
    const LIMIT = 100;
    const PAGES = broaden ? 3 : 1;

    let raw = [];
    for (let i = 0; i < PAGES; i++) {
      const offset = i * LIMIT;
      const batch = await browseSearch({
        q,
        limit: LIMIT,
        offset,
        sort,       // "newlylisted" → handled inside as "newlyListed"
        filters: filterStr,
      });
      raw = raw.concat(batch);
    }

    // de-dupe
    const seen = new Set();
    raw = raw.filter((x) => {
      const k = x.itemId || x.url;
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // improved title matching
    const tokens = tokenize(q);
    let items = raw.filter((item) => titleMatchesQuery(item.title || "", tokens));

    // enforce onlyComplete AFTER matching (price+image)
    if (onlyComplete) {
      items = items.filter((x) => !!x.image);
      items = items.filter((x) => x.price != null);
    }

    // server-side EPN tagging
    items = items.map((x) => ({ ...x, url: tagAffiliate(x.url || "") }));

    const fetchedCount = raw.length;
    const keptCount = items.length;

    if (!group) {
      // If "recent", upstream already applied recency; otherwise default to price asc
      if (sort === "newlylisted") {
        // keep order; optional nudge by createdAt when present
        items.sort((a, b) => (new Date(b.createdAt) - new Date(a.createdAt)));
      } else {
        items.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
      }

      const start = (page - 1) * perPage;
      const pageItems = items.slice(start, start + perPage);
      return NextResponse.json({
        groups: [],
        offers: pageItems,
        hasNext: start + perPage < items.length,
        hasPrev: page > 1,
        fetchedCount, keptCount,
      });
    }

    // Group similar
    const buckets = new Map();
    for (const it of items) {
      const key = modelKey(it.title || "") || norm(it.title || "");
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(it);
    }

    let groups = [...buckets.entries()].map(([key, arr]) => {
      const priced = arr.filter((a) => a.price != null);
      const best = priced.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))[0] || arr[0];
      return {
        model: key || (arr[0]?.title ?? "Unknown model"),
        image: best?.image || arr[0]?.image || null,
        bestPrice: best?.price ?? null,
        bestCurrency: best?.currency || "USD",
        count: arr.length,
        retailers: [...new Set(arr.map((x) => x.retailer || "eBay"))].slice(0, 4),
        offers: arr.map((x) => ({
          productId: x.itemId || x.url,
          url: x.url,
          title: x.title,
          retailer: x.retailer || "eBay",
          price: x.price ?? null,
          currency: x.currency || "USD",
          condition: x.condition || null,
          createdAt: x.createdAt || null,
          image: x.image || null,
        })),
      };
    });

    if (sort === "newlylisted") {
      groups.sort((a, b) => {
        const aMax = Math.max(...a.offers.map((o) => new Date(o.createdAt || 0).getTime() || 0));
        const bMax = Math.max(...b.offers.map((o) => new Date(o.createdAt || 0).getTime() || 0));
        return bMax - aMax;
      });
    }

    const start = (page - 1) * perPage;
    const pageGroups = groups.slice(start, start + perPage);

    return NextResponse.json({
      groups: pageGroups,
      offers: [],
      hasNext: start + perPage < groups.length,
      hasPrev: page > 1,
      fetchedCount, keptCount,
    });
  } catch (err) {
    console.error("api/putters error:", err?.message, err?.details || "");
    return NextResponse.json(
      { error: "http_error", status: 500, details: err?.details || err?.message || "Unknown error", results: [] },
      { status: 500 }
    );
  }
}
