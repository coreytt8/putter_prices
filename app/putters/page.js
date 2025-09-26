"use client";

import { buildBaseStats } from "@/lib/baseModelStats";

// Local helper to mirror server/client normalization
const normalizeModel = (text) => String(text || "")
  .toLowerCase()
  .replace(/scotty|cameron|titleist|putter|golf/gi, "")
  .replace(/\s+/g, " ")
  .trim();

import { useEffect, useMemo, useState } from "react";
import MarketSnapshot from "@/components/MarketSnapshot";
import PriceSparkline from "@/components/PriceSparkline";
import SmartPriceBadge from "@/components/SmartPriceBadge";
import { detectVariant } from "@/lib/variantMap";


/* ============================
   PRICE HELPERS (Total-to-Door)
   ============================ */
function _safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function _shipCost(o) {
  if (!o) return 0;
  if (typeof o.shipping === "number") return _safeNum(o.shipping);
  if (o.shipping && typeof o.shipping.cost === "number") return _safeNum(o.shipping.cost);
  if (o.shippingCost != null) return _safeNum(o.shippingCost);
  if (o?.shippingOptions?.[0]?.shippingCost?.value != null)
    return _safeNum(o.shippingOptions[0].shippingCost.value);
  return 0;
}

function _totalOf(o) {
  return _safeNum(o?.price) + _shipCost(o);
}







/* ============================
   SMART FAIR-PRICE BADGE (inline, JS/JSX)
   ============================ */

// Confidence from sample size + dispersion (IQR/median or approx)
function getConfidence(sampleSize = 0, dispersionRatio = 0.35) {
  if (!Number.isFinite(sampleSize) || sampleSize < 8) return "insufficient";
  if (sampleSize >= 30 && dispersionRatio < 0.25) return "high";
  if (sampleSize >= 12 && dispersionRatio < 0.50) return "medium";
  return "low";
}
function getTier(deltaPct, confidence) {
  if (confidence === "insufficient") return "insufficient";
  if (deltaPct <= -0.20) return "great_deal";
  if (deltaPct <= -0.10) return "good_price";
  if (deltaPct < 0.10)   return "fair";
  if (deltaPct <= 0.25)  return "above_market";
  return "overpriced";
}
function dealScoreFrom(deltaPct, confidence) {
  const savings = Math.min(Math.max(-deltaPct, 0), 0.40); // 0..0.40
  let score = Math.round(savings * 100); // 0..40
  const confBonus =
    confidence === "high" ? 60 :
    confidence === "medium" ? 40 :
    confidence === "low" ? 20 : 0;
  score += confBonus;
  if (deltaPct > 0.10) score = Math.max(5, score - 20);
  return Math.max(0, Math.min(100, score));
}
// Build a badge from listingPrice + stats {p10,p50,p90,n?,dispersionRatio?}
function makeSmartBadge({ listingPrice, stats, windowDays = 60 }) {
  if (!stats || typeof listingPrice !== "number" || !isFinite(listingPrice)) {
    return { tier: "insufficient", label: "Not enough data" };
  }
  const p50 = Number(stats.p50);
  if (!isFinite(p50) || p50 <= 0) {
    return { tier: "insufficient", label: "Not enough data" };
  }
  const expected = p50;
  const deltaPct = (listingPrice - expected) / expected;

  const n = Number(stats.n ?? stats.sampleSize ?? stats.count ?? 0);
  const dispersionRatio = Number.isFinite(stats.dispersionRatio)
    ? Number(stats.dispersionRatio)
    : (isFinite(stats.p90) && isFinite(stats.p10) && p50 > 0 ? ((stats.p90 - stats.p10) / 2) / p50 : 0.35);

  const confidence = getConfidence(n, dispersionRatio);
  const tier = getTier(deltaPct, confidence);
  const score = tier === "insufficient" ? 0 : dealScoreFrom(deltaPct, confidence);

  const LABELS = {
    great_deal: "Great Deal",
    good_price: "Good Price",
    fair: "Fair",
    above_market: "Above Market",
    overpriced: "Overpriced",
    insufficient: "Not enough data",
  };
  const COLORS = {
    great_deal: "bg-green-100 text-green-800 ring-green-200",
    good_price: "bg-emerald-100 text-emerald-800 ring-emerald-200",
    fair: "bg-slate-100 text-slate-800 ring-slate-200",
    above_market: "bg-amber-100 text-amber-900 ring-amber-200",
    overpriced: "bg-red-100 text-red-800 ring-red-200",
    insufficient: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  };
  const ICONS = {
    great_deal: "âœ…",
    good_price: "ðŸ‘",
    fair: "âš–ï¸",
    above_market: "â¬†ï¸",
    overpriced: "âš ï¸",
    insufficient: "ï¼Ÿ",
  };

  const pctAbs = Math.abs(deltaPct * 100);
  const vsText = deltaPct < 0 ? `~${pctAbs.toFixed(0)}% below`
               : deltaPct > 0 ? `~${pctAbs.toFixed(0)}% above`
               : "near";
  const nText = n ? `${n}` : "â€”";
  const condLabel = stats?.condition ? ` (${String(stats.condition).replace(/_/g," ").toLowerCase()})` : "";
  const tooltip = tier === "insufficient"
    ? "Not enough comparable sales to estimate a fair market price confidently."
    : `Based on ${nText} comparable sales${condLabel} in ~${windowDays} days. This listing is ${vsText} expected (median). Confidence: ${confidence}.`;

  return {
    tier,
    label: LABELS[tier],
    color: COLORS[tier],
    icon: ICONS[tier],
    deltaPct,
    pctAbs,
    score,
    confidence,
    tooltip,
  };
}

/* ============================
   ORIGINAL HELPERS
   ============================ */
function formatPrice(value, currency = "USD") {
  if (typeof value !== "number" || !isFinite(value)) return "â€”";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}
function timeAgo(ts) {
  if (!ts) return "";
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 minute ago";
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs === 1) return "1 hour ago";
  if (hrs < 24) return `${hrs} hours ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch {}
    document.body.removeChild(ta);
    return true;
  }
}

/* ============================
   CONSTANTS
   ============================ */
const BRANDS = [
  { label: "Scotty Cameron", q: "scotty cameron putter" },
  { label: "TaylorMade", q: "taylormade putter" },
  { label: "Ping", q: "ping putter" },
  { label: "Odyssey", q: "odyssey putter" },
  { label: "L.A.B.", q: "lab golf putter" },
];

const CONDITION_OPTIONS = [
  { label: "New", value: "NEW" },
  { label: "Like-New", value: "LIKE_NEW" },
  { label: "Good", value: "GOOD" },
  { label: "Fair", value: "FAIR" },
  // Keep your original values too if you rely on eBay condition codes:
  { label: "Used", value: "USED" },
  { label: "Certified Refurbished", value: "CERTIFIED_REFURBISHED" },
  { label: "Seller Refurbished", value: "SELLER_REFURBISHED" },
];

const BUYING_OPTIONS = [
  { label: "Buy It Now", value: "FIXED_PRICE" },
  { label: "Auction", value: "AUCTION" },
  { label: "Best Offer", value: "BEST_OFFER" },
];

const SORT_OPTIONS = [
  { label: "Best Price: Low â†’ High", value: "best_price_asc" },
  { label: "Best Price: High â†’ Low", value: "best_price_desc" },
  { label: "Recently listed", value: "recent" },
  { label: "Most Offers", value: "count_desc" },
  { label: "A â†’ Z (Model)", value: "model_asc" },
];

const FIXED_PER_PAGE = 10;

const retailerLogos = {
  eBay: "https://upload.wikimedia.org/wikipedia/commons/1/1b/EBay_logo.svg",
  "2nd Swing": "https://images.ctfassets.net/3ub10f3qbq43/6W8a2KQ6rZp3bRbxVb6s0T/9f5a9f1c3f7a1e4f3f3b9f2e0d9d2a51/2ndswing-logo.svg", // fallback public SVG; replace if you have a local asset
};

/* ============================
   RECENT MODELS
   ============================ */
const RECENT_KEY = "putteriq_recent_models";
function useRecentModels() {
  const [recent, setRecent] = useState([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      if (raw) setRecent(JSON.parse(raw));
    } catch {}
  }, []);
  const push = (model) => {
    if (!model) return;
    setRecent((prev) => {
      const next = [model, ...prev.filter((m) => m !== model)].slice(0, 8);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const clear = () => {
    try { localStorage.removeItem(RECENT_KEY); } catch {}
    setRecent([]);
  };
  return { recent, push, clear };
}

/* ============================
   EXTRA HELPERS
   ============================ */
function getModelKey(o) {
  if (typeof o?.model === "string" && o.model.trim()) return o.model.trim();
  if (typeof o?.groupModel === "string" && o.groupModel.trim()) return o.groupModel.trim();
  if (typeof o?.title === "string" && o.title.trim()) {
    const t = o.title.replace(/\s+/g, " ").trim();
    const first = t.split(" - ")[0] || t;
    return first.slice(0, 120);
  }
  return "";
}
function selectedConditionBand(conds) {
  return Array.isArray(conds) && conds.length === 1 ? conds[0] : "";
}
function inferConditionBandFromOffers(offers = []) {
  const counts = new Map();
  for (const o of offers) {
    const c = (o?.conditionBand || o?.condition || "").toUpperCase();
    if (!c) continue;
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  let best = ""; let max = 0;
  for (const [k,v] of counts.entries()) { if (v > max) { max = v; best = k; } }
  return best;
}
function getStatsKey(model, cond) {
  return `${model}::${cond || "ANY"}`;
}
function getStatsKey3(model, variant, cond) {
  return `${model}::${variant || "BASE"}::${cond || "ANY"}`;
}

/* ============================
   PAGE
   ============================ */
export default function PuttersPage() {
  // filters/state
  const [onlyComplete, setOnlyComplete] = useState(true);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [conds, setConds] = useState([]);
  const [buying, setBuying] = useState([]);
  const [dex, setDex] = useState("");            // "", "LEFT", "RIGHT"
  const [head, setHead] = useState("");          // "", "BLADE", "MALLET"
  const [lengths, setLengths] = useState([]);    // [] or [33,34,35,36]
  const [groupMode, setGroupMode] = useState(true);
  const [sortBy, setSortBy] = useState("best_price_asc");
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [broaden, setBroaden] = useState(false); 
  const [includeProShops, setIncludeProShops] = useState(false);

  // data
  const [groups, setGroups] = useState([]);
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [hasNext, setHasNext] = useState(false);
  const [hasPrev, setHasPrev] = useState(false);
  const [fetchedCount, setFetchedCount] = useState(null);
  const [keptCount, setKeptCount] = useState(null);
  const [apiData, setApiData] = useState(null);

  // UI state
  const [expanded, setExpanded] = useState({});
  const [showAllOffersByModel, setShowAllOffersByModel] = useState({});
  const [copiedFor, setCopiedFor] = useState("")

  // Per-model caches
  const [lowsByModel, setLowsByModel] = useState({});   // model -> lows
  const [seriesByModel, setSeriesByModel] = useState({}); // model -> series
  const [statsByModel, setStatsByModel] = useState({});   // `${model}::${cond}` or `${model}::${variant}::${cond}`

  // recent models
  const { recent, push: pushRecent, clear: clearRecent } = useRecentModels();

  // --- read URL params on first load ---
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const gList = (name) => (sp.get(name)?.split(",").filter(Boolean)) || [];
    const gNumList = (name) => gList(name).map((x) => Number(x)).filter(Number.isFinite);

    if (sp.has("q")) setQ(sp.get("q") || "");
    if (sp.has("onlyComplete")) setOnlyComplete(sp.get("onlyComplete") === "true");
    if (sp.has("minPrice")) setMinPrice(sp.get("minPrice") || "");
    if (sp.has("maxPrice")) setMaxPrice(sp.get("maxPrice") || "");
    if (sp.has("conditions")) setConds(gList("conditions"));
    if (sp.has("buyingOptions")) setBuying(gList("buyingOptions"));
    if (sp.has("dex")) setDex(sp.get("dex") || "");
    if (sp.has("head")) setHead(sp.get("head") || "");
    if (sp.has("lengths")) setLengths(gNumList("lengths"));
    if (sp.has("sort")) setSortBy(sp.get("sort") === "newlylisted" ? "recent" : "best_price_asc");
    if (sp.has("group")) setGroupMode(sp.get("group") === "true");
    if (sp.has("broaden")) setBroaden(sp.get("broaden") === "true");
    if (sp.has("pro")) setIncludeProShops(sp.get("pro") === "true");
    if (sp.has("page")) setPage(Math.max(1, Number(sp.get("page") || "1")));
  }, []);

  // reflect state â†’ URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (onlyComplete) params.set("onlyComplete", "true");
    if (minPrice) params.set("minPrice", String(minPrice));
    if (maxPrice) params.set("maxPrice", String(maxPrice));
    if (conds.length) params.set("conditions", conds.join(","));
    if (buying.length) params.set("buyingOptions", buying.join(","));
    if (sortBy === "recent") params.set("sort", "newlylisted");
    if (broaden) params.set("broaden", "true");
    if (dex) params.set("dex", dex);
    if (head) params.set("head", head);
    if (lengths.length) params.set("lengths", lengths.join(","));
    if (includeProShops) params.set("pro","true");
    params.set("page", String(page));
    params.set("group", groupMode ? "true" : "false");

    const qs = params.toString();
    const url = qs ? `/putters?${qs}` : "/putters";
    window.history.replaceState({}, "", url);
  }, [q, onlyComplete, minPrice, maxPrice, conds, buying, sortBy, page, groupMode, broaden, dex, head, lengths]);

  // API URL
  const apiUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (onlyComplete) params.set("onlyComplete", "true");
    if (minPrice) params.set("minPrice", String(minPrice));
    if (maxPrice) params.set("maxPrice", String(maxPrice));
    if (conds.length) params.set("conditions", conds.join(","));
    if (buying.length) params.set("buyingOptions", buying.join(","));
    if (sortBy === "recent") params.set("sort", "newlylisted");
    if (broaden) params.set("broaden", "true");
    if (dex) params.set("dex", dex);
    if (includeProShops) params.set("pro","true");
    if (head) params.set("head", head);
    if (lengths.length) params.set("lengths", lengths.join(","));
    params.set("page", String(page));
    params.set("perPage", String(FIXED_PER_PAGE));
    params.set("group", groupMode ? "true" : "false");
    params.set("samplePages", "3");
    params.set("_ts", String(Date.now()));
    return `/api/putters?${params.toString()}`;
  }, [q, onlyComplete, minPrice, maxPrice, conds, buying, sortBy, page, groupMode, broaden, dex, head, lengths]);

  // Reset to page 1 when inputs change
  useEffect(() => {
    setPage(1);
  }, [q, onlyComplete, minPrice, maxPrice, conds, buying, sortBy, groupMode, broaden, dex, head, lengths]);

// Fetch results (grouped vs flat) â€” clean & balanced
useEffect(() => {
  if (!q.trim()) {
    setGroups([]); setOffers([]);
    setHasNext(false); setHasPrev(false);
    setFetchedCount(null); setKeptCount(null);
    setApiData(null);
    setErr("");
    return;
  }

  const ctrl = new AbortController();
  let ignore = false;

  async function run() {
    setLoading(true);
    setErr("");

    try {
      // 1) Fetch current page from the API
      const res = await fetch(apiUrl, {
        cache: "no-store",
        signal: ctrl.signal,
        headers: { pragma: "no-cache", "cache-control": "no-cache" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (ignore) return;

      // Normalize data
      const nextGroups = Array.isArray(data.groups) ? data.groups : [];
      let pageOffers = Array.isArray(data.offers) ? data.offers : [];

      // 2) If FLAT + price sort, aggregate & globally sort by Total-to-Door
      const wantGlobalPriceSort =
        !groupMode && (sortBy === "best_price_asc" || sortBy === "best_price_desc");

      if (wantGlobalPriceSort) {
        const params = new URL(apiUrl, window.location.origin);
        const base = new URLSearchParams(params.search);
        base.set("perPage", "50");
        base.set("page", "1");

        const mkUrl = (p) => {
          const s = new URLSearchParams(base);
          s.set("page", String(p));
          return `${params.pathname}?${s.toString()}`;
        };

        const MAX_FLAT_AGG_PAGES = 6;
        let all = [...pageOffers];
        let p = 2;
        let hasNext = Boolean(data.hasNext);

        while (!ignore && hasNext && p <= MAX_FLAT_AGG_PAGES) {
          const url = mkUrl(p);
          const r = await fetch(url, {
            cache: "no-store",
            signal: ctrl.signal,
            headers: { pragma: "no-cache", "cache-control": "no-cache" },
          }).catch(() => null);
          if (!r || !r.ok) break;
          const j = await r.json().catch(() => ({}));
          const arr = Array.isArray(j.offers) ? j.offers : [];
          all = all.concat(arr);
          hasNext = Boolean(j.hasNext);
          p += 1;
        }

        // GLOBAL sort by Total-to-Door
        if (sortBy === "best_price_desc") {
          all.sort(
            (a, b) => (_safeNum(b?.price) + _shipCost(b)) - (_safeNum(a?.price) + _shipCost(a))
          );
        } else {
          all.sort(
            (a, b) => (_safeNum(a?.price) + _shipCost(a)) - (_safeNum(b?.price) + _shipCost(b))
          );
        }

        // Client-side pagination after global sort
        const start = (page - 1) * FIXED_PER_PAGE;
        const end = start + FIXED_PER_PAGE;
        const pageSlice = all.slice(start, end);

        setGroups([]);               // flat view
        setOffers(pageSlice);
        setHasPrev(page > 1);
        setHasNext(end < all.length);
        setFetchedCount(typeof data.fetchedCount === "number" ? data.fetchedCount : null);
        setKeptCount(all.length);
        setApiData(data);

      } else {
        // GROUPED or non-price sort in FLAT
        if (!groupMode && pageOffers.length) {
          if (sortBy === "best_price_asc") {
            pageOffers = [...pageOffers].sort(
              (a, b) => (_safeNum(a?.price) + _shipCost(a)) - (_safeNum(b?.price) + _shipCost(b))
            );
          } else if (sortBy === "best_price_desc") {
            pageOffers = [...pageOffers].sort(
              (a, b) => (_safeNum(b?.price) + _shipCost(b)) - (_safeNum(a?.price) + _shipCost(a))
            );
          }
        }

        setGroups(nextGroups);
        setOffers(pageOffers);
        setHasNext(Boolean(data.hasNext));
        setHasPrev(Boolean(data.hasPrev) && page > 1);
        setFetchedCount(typeof data.fetchedCount === "number" ? data.fetchedCount : null);
        setKeptCount(typeof data.keptCount === "number" ? data.keptCount : null);
        setApiData(data);
      }

      // Reset per-model caches for fresh groups
      const nextShowAll = {};
      const resetNulls = {};
      nextGroups.forEach(g => { nextShowAll[g.model] = false; resetNulls[g.model] = null; });
      setShowAllOffersByModel(nextShowAll);
      setLowsByModel(() => ({ ...resetNulls }));
      setSeriesByModel(() => ({ ...resetNulls }));
      // keep statsByModel cache

    } catch (e) {
      if (!ignore && e.name !== "AbortError") {
        setErr("Failed to load results. Please try again.");
      }
    } finally {
      if (!ignore) setLoading(false);
    }
  } // end run()

  useEffect(() => {
  let ignore = false;
  const ctrl = new AbortController();

  const run = async () => {
    // ... your fetch logic ...
  };

  const t = setTimeout(run, 150);

  // âŒ REMOVE these from inside the effect:
  // const baseStatsByModel = useMemo(() => { ... }, [groupMode, groups, offers]);

  return () => { 
    ignore = true; 
    clearTimeout(t); 
    ctrl.abort(); 
  };
}, [apiUrl, groupMode, sortBy, q, page]); // <-- END of Fetch results effect

// Safely derive the listings used for stats (no early returns needed)
const listingsForStats = useMemo(() => {
  const safeGroups = Array.isArray(groups) ? groups : [];
  const safeOffers = Array.isArray(offers) ? offers : [];
  return groupMode ? safeGroups.flatMap(g => g.offers || []) : safeOffers;
}, [groupMode, groups, offers]);

// Base-model market stats (excludes variants like Circle T, limited, tour)
const baseStatsByModel = useMemo(() => {
  return buildBaseStats(listingsForStats);
}, [listingsForStats]);



/* ============================
   GROUPED VIEW: prefetch stats per model
   ============================ */
useEffect(() => {
  if (!Array.isArray(groups) || groups.length === 0) return;

  // collect unique modelKeys that we don't already have in cache
  const need = [];
  const seen = new Set();
  for (const g of groups) {
    const mk = g.model || null;
    if (!mk || seen.has(mk)) continue;
    seen.add(mk);
    if (!statsByModel[mk]) need.push(mk);
  }
  if (need.length === 0) return;

  const ctrl = new AbortController();
  const qs = need.map(m => `model=${encodeURIComponent(m)}`).join("&"); // <-- matches /api/model-stats

  fetch(`/api/model-stats?${qs}`, { signal: ctrl.signal, cache: "no-store" })
    .then(r => (r.ok ? r.json() : Promise.reject()))
    .then(d => {
      if (!d || typeof d !== "object") return;
      setStatsByModel(prev => ({ ...prev, ...d }));
    })
    .catch(() => { /* ignore; badge will show "â€”" if missing */ });

  return () => ctrl.abort();
}, [groups]); // <-- END of Grouped stats effect





   const sortedGroups = useMemo(() => {
    const arr = [...groups];
    if (sortBy === "best_price_asc") {
      arr.sort((a,b) => (a.bestPrice ?? Infinity) - (b.bestPrice ?? Infinity));
    } else if (sortBy === "best_price_desc") {
      arr.sort((a,b) => (b.bestPrice ?? -Infinity) - (a.bestPrice ?? -Infinity));
    } else if (sortBy === "count_desc") {
      arr.sort((a,b) => (b.count ?? 0) - (a.count ?? 0));
    } else if (sortBy === "model_asc") {
      arr.sort((a,b) => (a.model || "").localeCompare(b.model || ""));
    }
    return arr;
  }, [groups, sortBy]);

  useEffect(() => {
    const next = {};
    sortedGroups.forEach((g) => { next[g.model] = false; });
    setExpanded(next);
  }, [sortedGroups.map((g) => g.model).join("|")]);

  const toggleExpand = async (model) => {
    setExpanded((prev) => ({ ...prev, [model]: !prev[model] }));
    // When opening, load per-model analytics and stats if missing
    const willOpen = !expanded[model];
    if (willOpen) {
      // mark as recently viewed when opening
      pushRecent(model);

      // lazily load lows/series/stats for this group
      if (!lowsByModel[model]) {
        try {
          const r = await fetch(`/api/analytics/lows?model=${encodeURIComponent(model)}`, { cache: "no-store" });
          const j = await r.json();
          setLowsByModel((prev) => ({ ...prev, [model]: j?.lows || null }));
        } catch {
          setLowsByModel((prev) => ({ ...prev, [model]: { low1d: null, low7d: null, low30d: null } }));
        }
      }
      if (!seriesByModel[model]) {
        try {
          const r = await fetch(`/api/analytics/series?model=${encodeURIComponent(model)}`, { cache: "no-store" });
          const j = await r.json();
          setSeriesByModel((prev) => ({ ...prev, [model]: j?.series || [] }));
        } catch {
          setSeriesByModel((prev) => ({ ...prev, [model]: [] }));
        }
      }
      // Stats (condition-aware)
      try {
        const groupObj = groups.find((x) => x.model === model) || null;
        const condParam = selectedConditionBand(conds) || inferConditionBandFromOffers(groupObj?.offers || []) || "";
        const url = `/api/model-stats?model=${encodeURIComponent(model)}${condParam ? `&condition=${encodeURIComponent(condParam)}` : ""}`;
        const statsKey = getStatsKey(model, condParam); // keep cache key
// Ensure API call uses raw model string, not statsKey
        if (statsByModel[statsKey] === undefined) {
          const r = await fetch(url, { cache: "no-store" });
          const j = await r.json();
          setStatsByModel((prev) => ({ ...prev, [statsKey]: j?.stats || null }));
        }
      } catch {
        // ignore
      }
    }
  };

  const toggleShowAllOffers = (model) => setShowAllOffersByModel(prev => ({ ...prev, [model]: !prev[model] }));
  const canPrev = hasPrev && page > 1 && !loading;
  const canNext = hasNext && !loading;

  function summarizeDexHead(g) {
    const dexCounts = { LEFT: 0, RIGHT: 0 };
    const headCounts = { BLADE: 0, MALLET: 0 };
    const lenCounts = { 33: 0, 34: 0, 35: 0, 36: 0 };
    for (const o of g.offers || []) {
      const d = (o?.specs?.dexterity || "").toUpperCase();
      const h = (o?.specs?.headType || "").toUpperCase();
      if (d === "LEFT" || d === "RIGHT") dexCounts[d] += 1;
      if (h === "BLADE" || h === "MALLET") headCounts[h] += 1;
      const L = Number(o?.specs?.length);
      if (Number.isFinite(L)) {
        const nearest = [33,34,35,36].reduce((p,c) => Math.abs(c - L) < Math.abs(p - L) ? c : p, 34);
        if (Math.abs(nearest - L) <= 0.5) lenCounts[nearest]++;
      }
    }
    const domDex = dexCounts.LEFT === 0 && dexCounts.RIGHT === 0 ? null : (dexCounts.LEFT >= dexCounts.RIGHT ? "LEFT" : "RIGHT");
    const domHead = headCounts.BLADE === 0 && headCounts.MALLET === 0 ? null : (headCounts.BLADE >= headCounts.MALLET ? "BLADE" : "MALLET");
    const domLen = Object.entries(lenCounts).sort((a,b)=>b[1]-a[1])[0];
    const domLenVal = domLen && domLen[1] > 0 ? Number(domLen[0]) : null;
    return { domDex, domHead, domLen: domLenVal };
  }

  // quick â€œGreat deal/Good dealâ€ chip (kept for the summary row)
  function fairPriceBadge(best, stats) {
    if (!best || !stats) return null;
    const p10 = Number(stats.p10), p50 = Number(stats.p50);
    if (!isFinite(p10) && !isFinite(p50)) return null;
    if (isFinite(p10) && best <= p10) return { label: "Great deal", tone: "emerald" };
    if (isFinite(p50) && best <= p50) return { label: "Good deal", tone: "green" };
    return null;
  }

  const clearAll = () => {
    setQ(""); setOnlyComplete(true);
    setMinPrice(""); setMaxPrice("");
    setConds([]); setBuying([]);
    setDex(""); setHead(""); setLengths([]);
    setSortBy("best_price_asc");
    setPage(1); setGroupMode(true); setBroaden(false);
  };

/* ============================
   FLAT VIEW: prefetch stats for visible items
   ============================ */
useEffect(() => {
  if (groupMode) return;
  if (!Array.isArray(offers) || offers.length === 0) return;
  if (loading || err) return;

  const need = [];
  const seen = new Set();
  for (const o of offers) {
    const mk = o.model || null;
    if (!mk || seen.has(mk)) continue;
    seen.add(mk);
    if (!statsByModel[mk]) need.push(mk);
  }
  if (need.length === 0) return;

  const ctrl = new AbortController();
  const qs = need.map(m => `model=${encodeURIComponent(m)}`).join("&");  // âœ… define qs

  fetch(`/api/model-stats?${qs}`, { signal: ctrl.signal, cache: "no-store" })
    .then(r => (r.ok ? r.json() : Promise.reject()))
    .then(d => {
      if (d && typeof d === "object") {
        setStatsByModel(prev => ({ ...prev, ...d }));
      }
    })
    .catch(() => {});
  return () => ctrl.abort();
}, [groupMode, offers, loading, err]);



  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Compare Putter Prices</h1>
          <p className="mt-1 text-sm text-gray-500">
            Type a model (e.g., <em>â€œscotty cameron newportâ€</em>) or pick a brand.
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Badges based on recent comps. <a className="text-blue-600 underline" href="/methodology">See methodology</a>.
          </p>
        </div>
        {q.trim() && (
          <div className="text-sm text-gray-500">
            {groupMode ? "Grouped by model" : "Flat list"} Â· Page{" "}
            <span className="font-medium">{page}</span> Â·{" "}
            <span className="font-medium">{FIXED_PER_PAGE}</span>{" "}
            {groupMode ? "groups" : "listings"}
          </div>
        )}
      </header>

      {/* Recently viewed */}
      {recent.length > 0 && (
        <section className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-gray-500">Recently viewed:</span>
          {recent.map((m) => (
            <button
              key={m}
              onClick={() => setQ(m)}
              className="rounded-full border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100"
              title={`Search ${m}`}
            >
              {m}
            </button>
          ))}
          <button
            onClick={clearRecent}
            className="ml-2 rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-50"
          >
            clear
          </button>
        </section>
      )}

      {/* Brand shortcuts */}
      <section className="mt-6 flex flex-wrap gap-2">
        {BRANDS.map((b) => (
          <button
            key={b.label}
            onClick={() => setQ(b.q)}
            className="rounded-full border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100"
            title={`Search ${b.label}`}
          >
            {b.label}
          </button>
        ))}
      </section>

      {/* Top controls (added View toggle; kept colors) */}
      <section className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-6">
        <div className="md:col-span-2">
          <label className="mb-1 block text-sm font-medium">Search</label>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. scotty cameron newport"
            className="w-full rounded-md border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Sort</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2"
          >
            {SORT_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        {/* New: View toggle (Grouped / Flat) */}
        <div>
          <label className="mb-1 block text-sm font-medium">View</label>
          <div className="inline-flex w-full overflow-hidden rounded-md border border-gray-300">
            <button
              onClick={() => setGroupMode(true)}
              className={`flex-1 px-3 py-2 text-sm ${groupMode ? "bg-gray-100 font-semibold" : "hover:bg-gray-50"}`}
              aria-pressed={groupMode}
            >
              Grouped
            </button>
            <button
              onClick={() => { setGroupMode(false); }}
              className={`flex-1 px-3 py-2 text-sm ${!groupMode ? "bg-gray-100 font-semibold" : "hover:bg-gray-50"}`}
              aria-pressed={!groupMode}
            >
              Flat
            </button>
          </div>
        </div>

        <div className="rounded-md border border-gray-200 p-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={broaden} onChange={(e) => setBroaden(e.target.checked)} />
            Broaden search (include common variants)
          </label>
          <p className="mt-1 text-xs text-gray-500">
            Pulls more pages before filtering. Helpful for niche models/years.
          </p>
        </div>

        <div className="rounded-md border border-gray-200 p-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeProShops}
              onChange={(e) => setIncludeProShops(e.target.checked)}
            />
            Include pro-shop sites (2nd Swing â€“ beta)
          </label>
          <p className="mt-1 text-xs text-gray-500">
            Adds 2nd Swing listings when enabled.
          </p>
        </div>

        <div className="flex items-end justify-between gap-3 md:col-span-6">
          <button onClick={clearAll} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-100">
            Clear
          </button>
        </div>
      </section>

      {/* Filters */}
      <section className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-5">
        {/* Quality */}
        <div className="rounded-lg border border-gray-200 p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-600">Quality</h3>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={onlyComplete}
              onChange={(e) => setOnlyComplete(e.target.checked)}
            />
            Only show listings with price & image
          </label>
        </div>

        {/* Price */}
        <div className="rounded-lg border border-gray-200 p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-600">Price</h3>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              placeholder="Min"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2 py-1"
            />
            <span className="text-gray-400">â€”</span>
            <input
              type="number"
              min="0"
              placeholder="Max"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2 py-1"
            />
          </div>
        </div>

        {/* Condition */}
        <div className="rounded-lg border border-gray-200 p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-600">Condition</h3>
          <div className="flex flex-col gap-2">
            {CONDITION_OPTIONS.map((c) => (
              <label key={c.value} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={conds.includes(c.value)}
                  onChange={() =>
                    setConds((prev) =>
                      prev.includes(c.value)
                        ? prev.filter((v) => v !== c.value)
                        : [...prev, c.value]
                    )
                  }
                />
                {c.label}
              </label>
            ))}
          </div>
        </div>

        {/* Dexterity */}
        <div className="rounded-lg border border-gray-200 p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-600">Dexterity</h3>
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="dex"
                checked={dex === ""}
                onChange={() => setDex("")}
              />
              Any
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="dex"
                checked={dex === "RIGHT"}
                onChange={() => setDex("RIGHT")}
              />
              Right-handed
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="dex"
                checked={dex === "LEFT"}
                onChange={() => setDex("LEFT")}
              />
              Left-handed
            </label>
          </div>
        </div>

        {/* Head Type */}
        <div className="rounded-lg border border-gray-200 p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-600">Head Type</h3>
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="head"
                checked={head === ""}
                onChange={() => setHead("")}
              />
              Any
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="head"
                checked={head === "BLADE"}
                onChange={() => setHead("BLADE")}
              />
              Blade
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="head"
                checked={head === "MALLET"}
                onChange={() => setHead("MALLET")}
              />
              Mallet
            </label>
          </div>
        </div>

        {/* Length (common) */}
        <div className="rounded-lg border border-gray-200 p-4 md:col-span-2">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-600">Length (common)</h3>
          <div className="flex flex-wrap gap-3 text-sm">
            {[33,34,35,36].map(L => (
              <label key={L} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={lengths.includes(L)}
                  onChange={() => {
                    setLengths(prev => prev.includes(L) ? prev.filter(x => x !== L) : [...prev, L]);
                  }}
                />
                {L}&quot;
              </label>
            ))}
            <div className="text-xs text-gray-500 basis-full">
              We match titles within Â±0.5&quot; of the selected length(s).
            </div>
          </div>
        </div>

        {/* Buying Options + Advanced */}
        <div className="rounded-lg border border-gray-200 p-4 md:col-span-3">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-600">Buying Options</h3>
          <div className="flex flex-wrap gap-3">
            {BUYING_OPTIONS.map((b) => (
              <label key={b.value} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={buying.includes(b.value)}
                  onChange={() =>
                    setBuying((prev) =>
                      prev.includes(b.value)
                        ? prev.filter((v) => v !== b.value)
                        : [...prev, b.value]
                    )
                  }
                />
                {b.label}
              </label>
            ))}
          </div>

         
        </div>
      </section>

      {!q.trim() && (
        <div className="mt-8 rounded-md border border-gray-200 bg-white p-6 text-center text-sm text-gray-600">
          Start by typing a putter model or choose a brand above to see grouped price comparisons.
        </div>
      )}

      {q.trim() && !loading && !err && (
        <div className="mt-2 text-sm text-gray-600">
          Showing{" "}
          <span className="font-medium">{groupMode ? groups?.length ?? 0 : offers?.length ?? 0}</span>{" "}
          {groupMode ? "model groups" : "listings"}
          {typeof keptCount === "number" && typeof fetchedCount === "number" ? (
            <> from <span className="font-medium">{keptCount}</span> kept (fetched {fetchedCount}).</>
          ) : null}
        </div>
      )}

      {/* LIVE analytics snapshot */}
      <MarketSnapshot snapshot={apiData?.analytics?.snapshot} meta={apiData?.meta} query={q} />

      {/* Loading & error UI */}
      {q.trim() && loading && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-2">
          {Array.from({ length: Math.min(FIXED_PER_PAGE, 6) }).map((_, i) => (
            <div key={i} className="animate-pulse overflow-hidden rounded-xl border border-gray-200 bg-white">
              <div className="h-40 bg-gray-100" />
              <div className="space-y-3 p-4">
                <div className="h-4 w-1/2 rounded bg-gray-200" />
                <div className="h-3 w-1/3 rounded bg-gray-200" />
                <div className="h-8 w-full rounded bg-gray-100" />
              </div>
            </div>
          ))}
        </div>
      )}
      {q.trim() && err && (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{err}</p>
        </div>
      )}

      {/* GROUPED VIEW */}
      {q.trim() && !loading && !err && groupMode && (
        <>
          <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-2">
            {sortedGroups.map((g) => {
              const isOpen = !!expanded[g.model];

              const ordered =
                sortBy === "best_price_desc"
                  ? [...g.offers].sort((a,b) => (b.price ?? -Infinity) - (a.price ?? -Infinity))
                  : [...g.offers].sort((a,b) => (a.price ?? Infinity) - (b.price ?? Infinity));

              const nums = ordered.map(o => o?.price).filter(x => typeof x === "number").sort((a,b)=>a-b);
              const nNums = nums.length;
              const med = nNums < 2 ? null : (nNums % 2 ? nums[Math.floor(nNums/2)] : (nums[nNums/2-1]+nums[nNums/2])/2);
              const bestDelta = (typeof g.bestPrice === "number" && typeof med === "number" && med - g.bestPrice > 0)
                ? { diff: med - g.bestPrice, pct: ((med - g.bestPrice)/med)*100 }
                : null;

              const { domDex, domHead, domLen } = summarizeDexHead(g);

              const showAll = !!showAllOffersByModel[g.model];
              const list = isOpen ? (showAll ? ordered : ordered.slice(0, 10)) : [];

              const lows = lowsByModel[g.model];
              const series = seriesByModel[g.model] || [];
              const groupCond = selectedConditionBand(conds) || inferConditionBandFromOffers(g?.offers || []) || "";
              const statsKey = getStatsKey(g.model, groupCond);
              const stats = statsByModel[statsKey] || null;

              const bestUrl = ordered.length ? ordered[0]?.url : null;

              const fair = fairPriceBadge(g.bestPrice, stats);

              return (
                <article key={g.model} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow">
                  <div className="relative aspect-[4/3] w-full max-h-48 bg-gray-50">
                    {g.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={g.image} alt={g.model} className="h-full w-full object-contain" loading="lazy" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-gray-400">
                        No image
                      </div>
                    )}
                  </div>

                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-lg font-semibold leading-tight">{g.model}</h3>
                        <p className="mt-1 text-xs text-gray-500">
                          {g.count} offer{g.count === 1 ? "" : "s"} Â· {g.retailers.join(", ")}
                        </p>

                        {/* Dominant chips + BADGES */}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {domDex && (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                              {domDex === "LEFT" ? "Left-hand" : "Right-hand"}
                            </span>
                          )}
                          {domHead && (
                            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                              {domHead === "MALLET" ? "Mallet" : "Blade"}
                            </span>
                          )}
                          {Number.isFinite(domLen) && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                              ~{domLen}&quot;
                            </span>
                          )}

                        {/* Group header price badge (use model stats) */}
<SmartPriceBadge
  // If you track shipping at the group level, include it:
  total={_safeNum(g.bestPrice) + _shipCost(g)}
  // Or fall back to price-only if you prefer:
  // price={Number(g.bestPrice)}

  stats={statsByModel[g.modelKey || g.model]}  // <-- stats from the effect above
  className="ml-1"
 baseStats={baseStatsByModel[normalizeModel((o?.model || o?.groupModel || o?.title))]} />



                          {/* Optional quick chip */}
                          {fair && (
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium text-white ${fair.tone === "emerald" ? "bg-emerald-600" : "bg-green-600"}`}>
                              {fair.label}
                            </span>
                          )}
                        </div>

                        {/* Helper badge (variant-aware from first listing) */}
                        <div className="mt-2">
                          {(() => {
                            const first = ordered?.[0];
                            const condParam = selectedConditionBand(conds) || inferConditionBandFromOffers(g?.offers || []) || "";
                            const modelKey = first ? getModelKey(first) : g.model;
                            const variant  = first ? detectVariant(first?.title) : null;

                            const variantKey = getStatsKey3(modelKey, variant, condParam);
                            const baseKey    = getStatsKey(modelKey, condParam);
                            const firstStats = statsByModel[variantKey] ?? statsByModel[baseKey] ?? stats;

                            return (
                              <SmartPriceBadge
                                price={Number(g.bestPrice)}
                                baseStats={firstStats}
                                variantStats={null}
                                title={first?.title || g.model}
                                specs={first?.specs}
                                brand={g?.brand}
                                showHelper
                              />
                            );
                          })()}
                        </div>

                        {/* Lows row (on expand) */}
                        {isOpen && (
                          <div className="mt-2 text-xs text-gray-600">
                            <span className="mr-2">Lows:</span>
                            <span className="mr-3">1d {formatPrice(Number(lows?.low1d))}</span>
                            <span className="mr-3">7d {formatPrice(Number(lows?.low7d))}</span>
                            <span>30d {formatPrice(Number(lows?.low30d))}</span>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col items-end gap-1">
                        <div className="shrink-0 rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                          Best: {formatPrice(g.bestPrice, g.bestCurrency)}
                        </div>
                        {bestDelta && (
                          <div
                            className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-medium text-emerald-700"
                            title={`Median ${formatPrice(med)} Â· Save ~${formatPrice(bestDelta.diff)} (~${bestDelta.pct.toFixed(0)}%)`}
                          >
                            Save {formatPrice(bestDelta.diff)} (~{bestDelta.pct.toFixed(0)}%)
                          </div>
                        )}

                        {/* Copy best link */}
                        <button
                          disabled={!bestUrl}
                          onClick={async () => {
                            if (!bestUrl) return;
                            await copyToClipboard(bestUrl);
                            setCopiedFor(g.model);
                            setTimeout(() => setCopiedFor((c) => (c === g.model ? "" : c)), 1500);
                          }}
                          className={`mt-1 rounded-md border px-2 py-1 text-[11px] ${bestUrl ? "hover:bg-gray-50" : "opacity-50 cursor-not-allowed"}`}
                          title="Copy best listing link"
                        >
                          {copiedFor === g.model ? "Copied!" : "Copy best"}
                        </button>
                      </div>
                    </div>

                    {/* Sparkline */}
                    {isOpen && Array.isArray(series) && series.length > 1 && (
                      <div className="mt-3">
                        <PriceSparkline data={series} height={70} showAverage showMedian className="h-[70px]" />
                      </div>
                    )}

                    <div className="mt-4 flex gap-2">
                      <button
                        onClick={() => toggleExpand(g.model)}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
                      >
                        {isOpen ? "Hide offers" : `View offers (${g.count})`}
                      </button>
                      {isOpen && g.count > 10 && (
                        <button
                          onClick={() => toggleShowAllOffers(g.model)}
                          className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
                        >
                          {showAll ? "Show top 10" : "Show all"}
                        </button>
                      )}
                    </div>

                    {/* Expanded listings */}
                    {isOpen && (
                      <ul className="mt-3 space-y-2">
                        {list.map((o) => {
                          const condParam =
                            (o?.conditionBand || o?.condition || "").toUpperCase() ||
                            selectedConditionBand(conds) ||
                            "";

                          // Variant-aware stats lookup
                          const modelKey   = getModelKey(o);
                          const variant    = detectVariant(o?.title);
                          const variantKey = getStatsKey3(modelKey, variant, condParam);
                          const baseKey    = getStatsKey(modelKey, condParam);
                          const perOfferStats = statsByModel[variantKey] ?? statsByModel[baseKey] ?? stats;

                          return (
                            <li
                              key={o.productId + o.url}
                              className="flex items-center justify-between gap-3 rounded border border-gray-100 p-2"
                            >
                              {/* LEFT: logo + retailer/seller */}
                              <div className="flex min-w-0 items-center gap-2">
                                {retailerLogos[o.retailer] && (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={retailerLogos[o.retailer]}
                                    alt={o.retailer}
                                    className="h-4 w-12 object-contain"
                                  />
                                )}

                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium">
                                    {o.retailer}
                                    {o?.seller?.username && (
                                      <span className="ml-2 text-xs text-gray-500">@{o.seller.username}</span>
                                    )}
                                    {typeof o?.seller?.feedbackPct === "number" && (
                                      <span className="ml-2 rounded-full bg-gray-100 px-2 py-[2px] text-[11px] font-medium text-gray-700">
                                        {o.seller.feedbackPct.toFixed(1)}%
                                      </span>
                                    )}
                                  </div>

                                  {/* Enhanced spec line */}
                                  <div className="mt-0.5 truncate text-xs text-gray-500">
                                    {(o.specs?.dexterity || "").toUpperCase() === "LEFT" ? "LH" :
                                     (o.specs?.dexterity || "").toUpperCase() === "RIGHT" ? "RH" : "â€”"}
                                    {" Â· "}
                                    {(o.specs?.headType || "").toUpperCase() || "â€”"}
                                    {" Â· "}
                                    {Number.isFinite(Number(o?.specs?.length)) ? `${o.specs.length}"` : "â€”"}
                                    {o?.specs?.shaft && <> Â· {String(o.specs.shaft).toLowerCase()}</>}
                                    {o?.specs?.hosel && <> Â· {o.specs.hosel}</>}
                                    {o?.specs?.face && <> Â· {o.specs.face}</>}
                                    {o?.specs?.grip && <> Â· {o.specs.grip}</>}
                                    {o?.specs?.hasHeadcover && <> Â· HC</>}
                                    {o?.specs?.toeHang && <> Â· {o.specs.toeHang} toe</>}
                                    {Number.isFinite(Number(o?.specs?.loft)) && <> Â· {o.specs.loft}Â° loft</>}
                                    {Number.isFinite(Number(o?.specs?.lie)) && <> Â· {o.specs.lie}Â° lie</>}
                                    {o.createdAt && (<> Â· listed {timeAgo(new Date(o.createdAt).getTime())}</>)}
                                  </div>
                                </div>
                              </div>

                              {/* RIGHT: badge + price + view */}
                              <div className="flex items-center gap-3">
                                <SmartPriceBadge
                                  price={Number(o.price)}
                                  baseStats={perOfferStats}
                                  variantStats={null}
                                  title={o.title}
                                  specs={o.specs}
                                  brand={g?.brand}
                                />
                                <span className="text-sm font-semibold">
                                  {typeof o.price === "number" ? formatPrice(o.price, o.currency) : "â€”"}
                                </span>
                                <a
                                  href={o.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="rounded-md border px-2 py-1 text-xs hover:bg-gray-50"
                                >
                                  View
                                </a>
                              </div>
                            </li>
                          );
                        })}

                        {!showAll && g.count > 10 && (
                          <li className="px-2 pt-1 text-xs text-gray-500">Showing top 10 offers.</li>
                        )}
                      </ul>
                    )}
                  </div>
                </article>
              );
            })}
          </section>

          {/* Pagination (grouped) */}
          <div className="mt-8 flex items-center justify-between">
            <button
              disabled={!canPrev}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className={`rounded-md border px-3 py-2 text-sm ${canPrev ? "hover:bg-gray-100" : "cursor-not-allowed opacity-50"}`}
            >
              â† Prev
            </button>
            <div className="text-sm text-gray-600">
              Page <span className="font-medium">{page}</span> Â· {FIXED_PER_PAGE} groups per page
            </div>
            <button
              disabled={!canNext}
              onClick={() => setPage((p) => p + 1)}
              className={`rounded-md border px-3 py-2 text-sm ${canNext ? "hover:bg-gray-100" : "cursor-not-allowed opacity-50"}`}
            >
              Next â†’
            </button>
          </div>
        </>
      )}

      {/* FLAT VIEW (now independent of "advanced") */}
      {q.trim() && !loading && !err && !groupMode && (
        <>
          <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {offers.map((o) => {
              const modelKey = getModelKey(o);
              const condParam =
                (o?.conditionBand || o?.condition || "").toUpperCase() ||
                selected{groups.map((g) => (ConditionBand(conds) ||
                "";
              const variant    = detectVariant(o?.title);
              const variantKey = getStatsKey3(modelKey, variant, condParam);
              const baseKey    = getStatsKey(modelKey, condParam);
              const stats      = statsByModel[variantKey] ?? statsByModel[baseKey] ?? null;

              return (
                <article key={o.productId + o.url} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow">
                  <div className="relative aspect-[4/3] w-full bg-gray-50">
                    {o.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={o.image} alt={o.title} className="h-full w-full object-contain" loading="lazy" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-gray-400">No image</div>
                    )}
                  </div>
                  <div className="p-4">
                    <h3 className="line-clamp-2 text-sm font-semibold">{o.title}</h3>
                    <p className="mt-1 text-xs text-gray-500">
                      {o?.seller?.username && <>@{o.seller.username} Â· </>}
                      {typeof o?.seller?.feedbackPct === "number" && <>{o.seller.feedbackPct.toFixed(1)}% Â· </>}
                      {(o.specs?.dexterity || "").toUpperCase() || "â€”"} Â· {(o.specs?.headType || "").toUpperCase() || "â€”"} Â·
                      {Number.isFinite(Number(o?.specs?.length)) ? `${o.specs.length}"` : "â€”"}
                      {o?.specs?.shaft && <> Â· {String(o.specs.shaft).toLowerCase()}</>}
                      {o?.specs?.hosel && <> Â· {o.specs.hosel}</>}
                      {o?.specs?.face && <> Â· {o.specs.face}</>}
                      {o?.specs?.grip && <> Â· {o.specs.grip}</>}
                      {o?.specs?.hasHeadcover && <> Â· HC</>}
                      {o?.specs?.toeHang && <> Â· {o.specs.toeHang} toe</>}
                      {Number.isFinite(Number(o?.specs?.loft)) && <> Â· {o.specs.loft}Â° loft</>}
                      {Number.isFinite(Number(o?.specs?.lie)) && <> Â· {o.specs.lie}Â° lie</>}
                      {o.createdAt && (<> Â· listed {timeAgo(new Date(o.createdAt).getTime())}</>)}
                    </p>

                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <SmartPriceBadge
                          price={Number(o.price)}
                          baseStats={stats}
                          variantStats={null}
                          title={o.title}
                          specs={o.specs}
                          brand={o.brand || ""}
                          className="mr-2"
                        />

                        <span className="text-base font-semibold">{formatPrice(_totalOf(o), o.currency)}</span>
<span className="ml-2 text-[11px] text-gray-500">
  ({formatPrice(o.price, o.currency)} + {formatPrice(_shipCost(o), o.currency)} ship)
</span>


                        {/* Optional Save $ chip if below median */}
                        {(() => {
                          const p50 = stats?.p50;
                          if (Number.isFinite(Number(p50)) && typeof o.price === "number" && o.price < Number(p50)) {
                            const save = Number(p50) - o.price;
                            const pct = Math.round((save / Number(p50)) * 100);
                            return (
                              <span
                                className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700"
                                title={`Median ${formatPrice(Number(p50))} Â· Save ~${formatPrice(save)} (~${pct}%)`}
                              >
                                Save {formatPrice(save)}
                              </span>
                            );
                          }
                          return null;
                        })()}
                      </div>

                      {/* Affiliate/outbound link UNCHANGED */}
                      <a
                        href={o.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50"
                      >
                        View
                      </a>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>

          {/* Pagination (flat) */}
          <div className="mt-8 flex items-center justify-between">
            <button
              disabled={!hasPrev || page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className={`rounded-md border px-3 py-2 text-sm ${hasPrev && page > 1 && !loading ? "hover:bg-gray-100" : "cursor-not-allowed opacity-50"}`}
            >
              â† Prev
            </button>
            <div className="text-sm text-gray-600">
              Page <span className="font-medium">{page}</span> Â· {FIXED_PER_PAGE} listings per page
            </div>
            <button
              disabled={!hasNext || loading}
              onClick={() => setPage((p) => p + 1)}
              className={`rounded-md border px-3 py-2 text-sm ${hasNext && !loading ? "hover:bg-gray-100" : "cursor-not-allowed opacity-50"}`}
            >
              Next â†’
            </button>
          </div>
        </>
      )}
    </main>
  );
}