import { NextResponse } from "next/server";

export const dynamic = "force-dynamic"; // no caching

/* ---------------- Server-side affiliate tagging (no rover) ---------------- */
function tagAffiliate(url) {
  try {
    const u = new URL(url);
    // Do NOT destroy existing params; just set/overwrite EPN params:
    const camp = process.env.EPN_CAMPAIGN_ID;
    if (!camp) return url; // if missing, return raw url

    const tool = process.env.EPN_TOOL_ID || "10001";
    const custom = process.env.EPN_CUSTOM_ID || ""; // optional

    // canonical EPN params for ebay.com
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

/* ---------------- Utilities ---------------- */
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

function tokenize(q) {
  return norm(q).split(/\s+/).filter(Boolean);
}

function priceNumberFromAny(x) {
  if (x == null) return null;
  if (typeof x === "number") return isFinite(x) ? x : null;
  if (typeof x === "object") {
    const n = Number(x.value ?? x.__value__ ?? x.amount);
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

  // 34/35 inches normalization: "35", 35", 35in, 35 in
  const inch = t.match(/^(\d{2})(?:"|in| in)?$/);
  if (inch) {
    const n = inch[1];
    if (ttl.includes(`${n}"`) || ttl.includes(`${n}in`) || ttl.includes(`${n} in`) || ttl.includes(` ${n} `)) {
      return true;
    }
  }

  // soft tokens are optional but may match via synonyms
  if (SOFT_TOKENS.has(t)) {
    const syns = SOFT_SYNONYMS[t] || [t];
    return syns.some((phrase) => ttl.includes(norm(phrase)));
  }

  return false;
}

/** Require all "core" tokens; allow soft tokens to be optional; also ≥70% of all tokens must hit. */
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

/* ---------------- eBay Finding API (no OAuth) ---------------- */
async function findingSearch({ q, pageNumber = 1, entriesPerPage = 100, sort = "" }) {
  const appId = process.env.EBAY_APP_ID;
  if (!appId) {
    const e = new Error("EBAY_APP_ID is missing.");
    e.details = "Set EBAY_APP_ID in your env (Vercel → Settings → Environment Variables).";
    throw e;
  }

  const u = new URL("https://svcs.ebay.com/services/search/FindingService/v1");
  u.searchParams.set("OPERATION-NAME", "findItemsByKeywords");
  u.searchParams.set("SERVICE-VERSION", "1.13.0");
  u.searchParams.set("SECURITY-APPNAME", appId);
  u.searchParams.set("RESPONSE-DATA-FORMAT", "JSON");
  u.searchParams.set("REST-PAYLOAD", "true");
  u.searchParams.set("keywords", q);
  u.searchParams.set("paginationInput.entriesPerPage", String(entriesPerPage));
  u.searchParams.set("paginationInput.pageNumber", String(pageNumber));

  if (sort === "newlylisted") {
    u.searchParams.set("sortOrder", "StartTimeNewest");
  }

  const res = await fetch(u.toString(), { next: { revalidate: 0 } });
  if (!res.ok) {
    const text = await res.text();
    const e = new Error(`finding_api_error ${res.status}`);
    e.details = text;
    throw e;
  }

  const data = await res.json();
  const root = data?.findItemsByKeywordsResponse?.[0];
  const ack = root?.ack?.[0];
  if (ack !== "Success") {
    const e = new Error("finding_api_not_success");
    e.details = JSON.stringify(root?.errorMessage ?? root);
    throw e;
  }
  const items = root?.searchResult?.[0]?.item ?? [];

  return items.map((it) => {
    const title = it.title?.[0] ?? "";
    const price = it.sellingStatus?.[0]?.currentPrice?.[0];
    const img =
      it.galleryPlusPictureURL?.[0] ||
      it.galleryURL?.[0] ||
      null;
    const url = it.viewItemURL?.[0] || "";
    const condition =
      it.condition?.[0]?.conditionDisplayName?.[0] ||
      it.condition?.[0]?.conditionId?.[0] ||
      null;
    const buyingOptions = it.listingInfo?.[0]?.listingType?.[0] || "";
    const created = it.listingInfo?.[0]?.startTime?.[0] || null;

    return {
      itemId: it.itemId?.[0] || url,
      title,
      price: priceNumberFromAny(price),
      currency: (price && (price.currencyId || price["@currencyId"])) || "USD",
      condition,
      image: img,
      url,
      retailer: "eBay",
      createdAt: created,
      buyingOption: String(buyingOptions).toUpperCase(),
    };
  });
}

/* ---------------- Route handler ---------------- */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    const group = searchParams.get("group") !== "false"; // default: grouped
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

    // --- Fetch upstream pages
    const ENTRIES = 100;
    const MAX_PAGES = broaden ? 3 : 1;
    let raw = [];
    for (let p = 1; p <= MAX_PAGES; p++) {
      const batch = await findingSearch({ q, pageNumber: p, entriesPerPage: ENTRIES, sort });
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

    // --- Improved matching (core tokens required, soft optional, ≥70% total hits)
    const tokens = tokenize(q);
    let items = raw.filter((item) => titleMatchesQuery(item.title || "", tokens));

    // --- Post filters
    if (onlyComplete) {
      items = items.filter((x) => !!x.image);
      items = items.filter((x) => x.price != null);
    }
    if (minPrice || maxPrice) {
      const min = minPrice ? Number(minPrice) : -Infinity;
      const max = maxPrice ? Number(maxPrice) : Infinity;
      items = items.filter((x) => x.price != null && x.price >= min && x.price <= max);
    }
    if (conditions.length) {
      const cset = new Set(conditions);
      items = items.filter((x) => cset.has(String(x.condition || "").toUpperCase()));
    }
    if (buyingOptions.length) {
      const bset = new Set(buyingOptions);
      items = items.filter((x) => {
        const bo = String(x.buyingOption || "").toUpperCase();
        return [...bset].some((opt) => bo.includes(opt));
      });
    }

    // --- EPN server-side tagging
    items = items.map((x) => ({ ...x, url: tagAffiliate(x.url || "") }));

    const fetchedCount = raw.length;
    const keptCount = items.length;

    if (!group) {
      // Recently listed: trust upstream order (StartTimeNewest); otherwise sort by price asc
      if (sort === "newlylisted") {
        items.sort((a, b) => (new Date(b.createdAt) - new Date(a.createdAt)));
      } else {
        items.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
      }

      const start = (page - 1) * perPage;
      const pageItems = items.slice(start, start + perPage);
      return NextResponse.json({
        groups: [], offers: pageItems,
        hasNext: start + perPage < items.length,
        hasPrev: page > 1,
        fetchedCount, keptCount,
      });
    }

    // Grouping
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
