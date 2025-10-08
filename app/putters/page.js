"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import MarketSnapshot from "@/components/MarketSnapshot";
import HeroSection from "@/components/HeroSection";
import SectionWrapper from "@/components/SectionWrapper";
import HighlightCard from "@/components/HighlightCard";
import RarityBadge from "@/components/RarityBadge";
import { formatFullModelName } from "@/lib/format-model";
import CompareBar from "@/components/CompareBar";
import CompareTray from "@/components/CompareTray";
import { detectVariant } from "@/lib/variantMap";

// --- Inline condition pill (Corey’s mapping) ---
// --- Inline condition pill (Corey’s mapping) ---
function conditionToLabelAndClass(condRaw) {
  const c = String(condRaw || '').toUpperCase();
  const band =
    c.includes('1000') || (c.includes('NEW') && !c.includes('USED')) ? 'NEW' :
    c.includes('2750') || c.includes('3000') || c.includes('MINT') || c.includes('LIKE_NEW') ? 'MINT' :
    c.includes('4000') || c.includes('5000') || c.includes('VERY') ? 'VERY_GOOD' :
    c.includes('6000') || c.includes('7000') || c.includes('GOOD') ? 'GOOD' :
    'USED';
  switch (band) {
    case 'NEW':       return { label: 'New',        cls: 'bg-blue-600 text-white' };
    case 'MINT':      return { label: 'Mint',       cls: 'bg-cyan-600 text-white' };
    case 'VERY_GOOD': return { label: 'Very Good',  cls: 'bg-slate-500 text-white' };
    case 'GOOD':      return { label: 'Good',       cls: 'bg-slate-400 text-black' };
    default:          return { label: 'Used',       cls: 'bg-slate-300 text-black' };
  }
}

function ConditionPill({ condition }) {
  if (!condition) return null;
  const { label, cls } = conditionToLabelAndClass(condition);
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {label}
    </span>
  );
}

function arrayEquals(a = [], b = []) {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((val, idx) => val === right[idx]);
}

const bandPretty = (b) => {
  if (!b) return null;
  const str = String(b).toUpperCase();
  if (!str || str === "ANY") return null;
  return str.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};

function BandChip({ band, sample }) {
  const pretty = bandPretty(band);
  if (!pretty) return null;
  const count = Number(sample);
  const showCount = Number.isFinite(count) && count > 0;
  return (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-700">
      {pretty}
      {showCount ? <span className="ml-1 opacity-70">n={count}</span> : null}
    </span>
  );
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
    great_deal: "✅",
    good_price: "👍",
    fair: "⚖️",
    above_market: "⬆️",
    overpriced: "⚠️",
    insufficient: "？",
  };

  const pctAbs = Math.abs(deltaPct * 100);
  const vsText = deltaPct < 0 ? `~${pctAbs.toFixed(0)}% below`
               : deltaPct > 0 ? `~${pctAbs.toFixed(0)}% above`
               : "near";
  const nText = n ? `${n}` : "—";
  const condLabel = stats?.condition ? ` (${String(stats.condition).replace(/_/g," ").toLowerCase()})` : "";
  const tooltip = tier === "insufficient"
    ? "Not enough live listing history to estimate a fair market baseline confidently."
    : `Based on ${nText} live listings${condLabel} observed in ~${windowDays} days. This listing is ${vsText} the live median. Confidence: ${confidence}.`;

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
  if (typeof value !== "number" || !isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

function offerCost(offer) {
  if (!offer || typeof offer !== "object") return null;
  const total = Number(offer.total);
  if (Number.isFinite(total)) return total;
  const price = Number(offer.price);
  return Number.isFinite(price) ? price : null;
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
function getOfferId(offer) {
  if (!offer) return null;
  if (offer.productId != null) return String(offer.productId);
  if (offer.url) return String(offer.url);
  return null;
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
  { label: "Best Price: Low → High", value: "best_price_asc" },
  { label: "Best Price: High → Low", value: "best_price_desc" },
  { label: "Recently listed", value: "recent" },
  { label: "Most Offers", value: "count_desc" },
  { label: "A → Z (Model)", value: "model_asc" },
];

const sortParam = {
  best_price_asc: "best_price_asc",
  best_price_desc: "best_price_desc",
  recent: "newlylisted",
  model_asc: "model_asc",
  count_desc: "count_desc",
};

const CATEGORY_TABS = [
  { key: "all", label: "All", categoryIn: [], rarityIn: [] },
  { key: "putters", label: "Putters", categoryIn: ["putter"], rarityIn: [] },
  { key: "headcovers", label: "Headcovers", categoryIn: ["headcover"], rarityIn: [] },
  { key: "tour", label: "Tour-Only", categoryIn: [], rarityIn: ["tour"] },
  { key: "limited", label: "Limited", categoryIn: [], rarityIn: ["limited"] },
  { key: "retail", label: "Retail", categoryIn: [], rarityIn: ["retail"] },
];

const FIXED_PER_PAGE = 10;

const retailerLogos = {
  eBay: "https://upload.wikimedia.org/wikipedia/commons/1/1b/EBay_logo.svg",
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
  const [hasBids, setHasBids] = useState(false);
  const [dex, setDex] = useState("");            // "", "LEFT", "RIGHT"
  const [head, setHead] = useState("");          // "", "BLADE", "MALLET"
  const [lengths, setLengths] = useState([]);    // [] or [33,34,35,36]
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [groupMode, setGroupMode] = useState(true);
  const [sortBy, setSortBy] = useState("best_price_asc");
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [modelKeyParam, setModelKeyParam] = useState("");
  const [broaden, setBroaden] = useState(false);
  const [includeProShops, setIncludeProShops] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState([]);
  const [rarityFilter, setRarityFilter] = useState([]);



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
  const [copiedFor, setCopiedFor] = useState("");
  const [compareItems, setCompareItems] = useState([]);
  const [isCompareOpen, setIsCompareOpen] = useState(false);

  const compareIds = useMemo(() => new Set(compareItems.map((item) => item._cid)), [compareItems]);

  const activeTab = useMemo(() => {
    for (const tab of CATEGORY_TABS) {
      if (arrayEquals(categoryFilter, tab.categoryIn) && arrayEquals(rarityFilter, tab.rarityIn)) {
        return tab.key;
      }
    }
    return "all";
  }, [categoryFilter, rarityFilter]);


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
    if (sp.has("hasBids")) setHasBids(sp.get("hasBids") === "true");
    if (sp.has("dex")) setDex(sp.get("dex") || "");
    if (sp.has("head")) setHead(sp.get("head") || "");
    if (sp.has("lengths")) setLengths(gNumList("lengths"));
    if (sp.has("sort")) {
      const fromUrl = sp.get("sort");
      const matched = Object.entries(sortParam).find(([, value]) => value === fromUrl);
      if (matched) setSortBy(matched[0]);
    }
    if (sp.has("group")) setGroupMode(sp.get("group") === "true");
    if (sp.has("broaden")) setBroaden(sp.get("broaden") === "true");
    if (sp.has("pro")) setIncludeProShops(sp.get("pro") === "true");
    if (sp.has("page")) setPage(Math.max(1, Number(sp.get("page") || "1")));
    if (sp.has("modelKey")) {
      const fromUrlModel = (sp.get("modelKey") || "").trim();
      setModelKeyParam(fromUrlModel);
    } else if (sp.has("model")) {
      const fromUrlModel = (sp.get("model") || "").trim();
      setModelKeyParam(fromUrlModel);
    }
    if (sp.has("categoryIn")) setCategoryFilter(gList("categoryIn"));
    if (sp.has("rarityIn")) setRarityFilter(gList("rarityIn"));
  }, []);

  useEffect(() => {
    setCompareItems([]);
    setIsCompareOpen(false);
  }, [q]);

  // reflect state → URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (onlyComplete) params.set("onlyComplete", "true");
    if (minPrice) params.set("minPrice", String(minPrice));
    if (maxPrice) params.set("maxPrice", String(maxPrice));
    if (conds.length) params.set("conditions", conds.join(","));
    if (buying.length) params.set("buyingOptions", buying.join(","));
    if (hasBids) params.set("hasBids", "true");
    if (sortParam[sortBy]) params.set("sort", sortParam[sortBy]);
    if (broaden) params.set("broaden", "true");
    if (dex) params.set("dex", dex);
    if (head) params.set("head", head);
    if (lengths.length) params.set("lengths", lengths.join(","));
    if (includeProShops) params.set("pro","true");
    if (modelKeyParam.trim()) params.set("modelKey", modelKeyParam.trim());
    if (categoryFilter.length) params.set("categoryIn", categoryFilter.join(","));
    if (rarityFilter.length) params.set("rarityIn", rarityFilter.join(","));
    params.set("page", String(page));
    params.set("group", groupMode ? "true" : "false");

    const qs = params.toString();
    const url = qs ? `/putters?${qs}` : "/putters";
    window.history.replaceState({}, "", url);
  }, [q, onlyComplete, minPrice, maxPrice, conds, buying, hasBids, sortBy, page, groupMode, broaden, dex, head, lengths, includeProShops, modelKeyParam, categoryFilter, rarityFilter]);

  useEffect(() => {
    if (!q.trim() || !modelKeyParam) return;
    setModelKeyParam("");
  }, [q, modelKeyParam]);

  // API URL
  const apiUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (onlyComplete) params.set("onlyComplete", "true");
    if (minPrice) params.set("minPrice", String(minPrice));
    if (maxPrice) params.set("maxPrice", String(maxPrice));
    if (conds.length) params.set("conditions", conds.join(","));
    if (buying.length) params.set("buyingOptions", buying.join(","));
    if (hasBids) params.set("hasBids", "true");
    if (sortParam[sortBy]) params.set("sort", sortParam[sortBy]);
    if (broaden) params.set("broaden", "true");
    if (dex) params.set("dex", dex);
    if (includeProShops) params.set("pro","true");
    if (head) params.set("head", head);
    if (lengths.length) params.set("lengths", lengths.join(","));
    if (modelKeyParam.trim()) params.set("modelKey", modelKeyParam.trim());
    if (categoryFilter.length) params.set("categoryIn", categoryFilter.join(","));
    if (rarityFilter.length) params.set("rarityIn", rarityFilter.join(","));
    params.set("page", String(page));
    params.set("perPage", String(FIXED_PER_PAGE));
    params.set("group", groupMode ? "true" : "false");
    params.set("samplePages", "3");
    params.set("_ts", String(Date.now()));
    return `/api/putters?${params.toString()}`;
  }, [q, onlyComplete, minPrice, maxPrice, conds, buying, hasBids, sortBy, page, groupMode, broaden, dex, head, lengths, includeProShops, modelKeyParam, categoryFilter, rarityFilter]);

  // Reset to page 1 when inputs change
  useEffect(() => {
    setPage(1);
  }, [q, onlyComplete, minPrice, maxPrice, conds, buying, hasBids, sortBy, groupMode, broaden, dex, head, lengths, includeProShops, modelKeyParam, categoryFilter, rarityFilter]);

  // Fetch results
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

    const t = setTimeout(async () => {
      setLoading(true); setErr("");
      try {
        const res = await fetch(apiUrl, {
          cache: "no-store",
          signal: ctrl.signal,
          headers: { pragma: "no-cache", "cache-control": "no-cache" },
        });
        const data = await res.json();
        if (ignore) return;

        const nextGroups = Array.isArray(data.groups) ? data.groups : [];
        let pageOffers = Array.isArray(data.offers) ? data.offers : [];

        if (categoryFilter.length) {
          const categorySet = new Set(categoryFilter.map((c) => c.toLowerCase()));
          pageOffers = pageOffers.filter((offer) => {
            const raw = typeof offer?.category === "string" ? offer.category.toLowerCase() : "";
            return categorySet.size === 0 || categorySet.has(raw);
          });
        }

        if (rarityFilter.length) {
          const raritySet = new Set(rarityFilter.map((r) => r.toLowerCase()));
          pageOffers = pageOffers.filter((offer) => {
            const raw =
              typeof offer?.rarityTier === "string"
                ? offer.rarityTier.toLowerCase()
                : typeof offer?.release?.rarityTier === "string"
                ? offer.release.rarityTier.toLowerCase()
                : "";
            return raritySet.size === 0 || raritySet.has(raw);
          });
        }

        if (!groupMode && pageOffers.length) {
          if (sortBy === "best_price_asc") {
            pageOffers = [...pageOffers].sort((a,b) => (a.price ?? Infinity) - (b.price ?? Infinity));
          } else if (sortBy === "best_price_desc") {
            pageOffers = [...pageOffers].sort((a,b) => (b.price ?? -Infinity) - (a.price ?? -Infinity));
          } else if (sortBy === "model_asc") {
            pageOffers = [...pageOffers].sort((a,b) => (a.title || "").localeCompare(b.title || ""));
          }
        }

        setGroups(nextGroups);
        setOffers(pageOffers);
        setHasNext(Boolean(data.hasNext));
        setHasPrev(Boolean(data.hasPrev));
        setFetchedCount(typeof data.fetchedCount === "number" ? data.fetchedCount : null);
        setKeptCount(typeof data.keptCount === "number" ? data.keptCount : null);
        setApiData(data);

        // reset per-model show-all + lows/series cache for fresh groups
        const nextShowAll = {};
        const resetNulls = {};
        nextGroups.forEach(g => { nextShowAll[g.model] = false; resetNulls[g.model] = null; });
        setShowAllOffersByModel(nextShowAll);
        setLowsByModel((prev) => ({ ...resetNulls }));
        setSeriesByModel((prev) => ({ ...resetNulls }));
        // DO NOT reset statsByModel here; we keep cache (condition-aware)
      } catch (e) {
        if (!ignore && e.name !== "AbortError") setErr("Failed to load results. Please try again.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }, 150);

    return () => { ignore = true; clearTimeout(t); ctrl.abort(); };
  }, [apiUrl, groupMode, sortBy, q]);

  useEffect(() => {
    const latest = new Map();
    if (Array.isArray(offers)) {
      offers.forEach((offer) => {
        const id = getOfferId(offer);
        if (id && !latest.has(id)) {
          latest.set(id, offer);
        }
      });
    }
    if (Array.isArray(groups)) {
      groups.forEach((group) => {
        (group?.offers || []).forEach((offer) => {
          const id = getOfferId(offer);
          if (id && !latest.has(id)) {
            latest.set(id, offer);
          }
        });
      });
    }

    setCompareItems((prev) => {
      if (!prev.length) return prev;
      const next = [];
      let changed = false;

      for (const item of prev) {
        const match = latest.get(item._cid);
        if (match) {
          const nextItem = { ...match, _cid: item._cid };
          next.push(nextItem);
          if (!changed) {
            const nextKeys = Object.keys(nextItem);
            const prevKeys = Object.keys(item);
            if (nextKeys.length !== prevKeys.length) {
              changed = true;
            } else if (nextKeys.some((key) => nextItem[key] !== item[key])) {
              changed = true;
            }
          }
        } else {
          changed = true;
        }
      }

      if (!changed) return prev;
      if (next.length === 0) {
        setIsCompareOpen(false);
      }
      return next;
    });
  }, [groups, offers]);

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
        const statsKey = getStatsKey(model, condParam);
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

  const clearAll = () => {
    setQ(""); setOnlyComplete(true);
    setMinPrice(""); setMaxPrice("");
    setConds([]); setBuying([]); setHasBids(false);
    setDex(""); setHead(""); setLengths([]);
    setSortBy("best_price_asc");
    setPage(1); setGroupMode(true); setBroaden(false);
    setIncludeProShops(false);
    setModelKeyParam("");
    setCategoryFilter([]);
    setRarityFilter([]);
  };

  const handleSelectTab = useCallback((tabKey) => {
    const tab = CATEGORY_TABS.find((entry) => entry.key === tabKey);
    if (!tab) return;
    setCategoryFilter(Array.from(tab.categoryIn));
    setRarityFilter(Array.from(tab.rarityIn));
    setPage(1);
  }, []);

  const handleToggleCompare = useCallback((offer) => {
    const id = getOfferId(offer);
    if (!id) return;

    setCompareItems((prev) => {
      const exists = prev.some((item) => item._cid === id);
      if (exists) {
        const next = prev.filter((item) => item._cid !== id);
        if (next.length === 0) {
          setIsCompareOpen(false);
        }
        return next;
      }
      return [...prev, { ...offer, _cid: id }];
    });
  }, []);

  const handleRemoveCompare = useCallback((id) => {
    setCompareItems((prev) => {
      const next = prev.filter((item) => item._cid !== id);
      if (next.length === 0) {
        setIsCompareOpen(false);
      }
      return next;
    });
  }, []);

  const handleClearCompare = useCallback(() => {
    setCompareItems([]);
    setIsCompareOpen(false);
  }, []);

  const handleOpenCompare = useCallback(() => {
    if (compareItems.length > 0) {
      setIsCompareOpen(true);
    }
  }, [compareItems]);

  const handleCloseCompare = useCallback(() => {
    setIsCompareOpen(false);
  }, []);

  /* ============================
     FLAT VIEW: prefetch stats for visible items (variant + base)
     ============================ */
  useEffect(() => {
    // Only run in flat/advanced mode when we have offers
    if (!q.trim() || loading || err || groupMode || !showAdvanced) return;
    if (!Array.isArray(offers) || offers.length === 0) return;

    let abort = false;
    const selCond = selectedConditionBand(conds) || "";
    const seen = new Set();
    const jobs = [];

    for (const o of offers) {
      const modelKey = getModelKey(o);
      const condParam =
        (o?.conditionBand || o?.condition || "").toUpperCase() ||
        selCond ||
        "";
      const variant = detectVariant(o?.title);

      // 1) Variant key first
      if (variant) {
        const vKey = getStatsKey3(modelKey, variant, condParam);
        if (vKey && !statsByModel[vKey]) {
          const vUrl =
            `/api/model-stats?model=${encodeURIComponent(modelKey)}` +
            `${condParam ? `&condition=${encodeURIComponent(condParam)}` : ""}` +
            `&variant=${encodeURIComponent(variant)}`;

          if (!seen.has(vUrl)) {
            seen.add(vUrl);
            jobs.push(
              fetch(vUrl)
                .then((r) => (r.ok ? r.json() : null))
                .then((json) => {
                  if (abort || !json) return;
                  const stats = json?.stats ?? json;
                  if (stats && Object.keys(stats).length) {
                    setStatsByModel((prev) => ({ ...prev, [vKey]: stats }));
                  }
                })
                .catch(() => {})
            );
          }
        }
      }

      // 2) Base key fallback
      const baseKey = getStatsKey(modelKey, condParam);
      if (baseKey && !statsByModel[baseKey]) {
        const baseUrl =
          `/api/model-stats?model=${encodeURIComponent(modelKey)}` +
          `${condParam ? `&condition=${encodeURIComponent(condParam)}` : ""}`;

        if (!seen.has(baseUrl)) {
          seen.add(baseUrl);
          jobs.push(
            fetch(baseUrl)
              .then((r) => (r.ok ? r.json() : null))
              .then((json) => {
                if (abort || !json) return;
                const stats = json?.stats ?? json;
                if (stats && Object.keys(stats).length) {
                  setStatsByModel((prev) => ({ ...prev, [baseKey]: stats }));
                }
              })
              .catch(() => {})
          );
        }
      }
    }

    if (jobs.length) {
      Promise.all(jobs).catch(() => {});
    }

    return () => { abort = true; };
  }, [q, loading, err, groupMode, showAdvanced, offers, JSON.stringify(conds)]);

  return (
    <>
      <main className="min-h-screen bg-slate-950 text-white">
      <HeroSection containerClassName="max-w-6xl">
        <div className="space-y-6 text-left">
          <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-4 py-1 text-sm font-semibold text-emerald-200 ring-1 ring-inset ring-emerald-400/30">
            Live eBay market explorer
          </span>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Compare Putter Prices</h1>
          <p className="text-lg text-slate-200">
            Type a model (e.g., <em>“scotty cameron newport”</em>) or pick a brand to benchmark pricing in real-time.
          </p>
          <p className="text-sm text-slate-300">
            Badges based on live listing percentiles.{" "}
            <a className="font-semibold text-emerald-300 underline hover:text-emerald-200" href="/methodology">
              See methodology
            </a>
            .
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            {CATEGORY_TABS.map((tab) => {
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => handleSelectTab(tab.key)}
                  className={`inline-flex items-center rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                    isActive
                      ? "bg-white text-slate-900 shadow"
                      : "border border-white/10 bg-white/10 text-white/80 hover:bg-white/20"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </HeroSection>

      <SectionWrapper variant="light">
        <div className="space-y-8">
          <HighlightCard className="gap-6 p-6">
            <div className="flex flex-col gap-6">
              {recent.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recently viewed:</span>
                  {recent.map((m) => (
                    <button
                      key={m}
                      onClick={() => setQ(m)}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-medium text-slate-700 transition hover:border-emerald-200 hover:text-emerald-700 hover:shadow-sm"
                      title={`Search ${m}`}
                    >
                      {m}
                    </button>
                  ))}
                  <button
                    onClick={clearRecent}
                    className="ml-2 rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-500 transition hover:border-emerald-200 hover:text-emerald-700"
                  >
                    Clear
                  </button>
                </div>
              )}

              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Brand shortcuts</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {BRANDS.map((b) => (
                    <button
                      key={b.label}
                      onClick={() => setQ(b.q)}
                      className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
                      title={`Search ${b.label}`}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-5">
                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-semibold text-slate-700">Search</label>
                  <input
                    type="text"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="e.g. scotty cameron newport"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/40"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700">Sort</label>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/40"
                  >
                    {SORT_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <label className="flex items-start gap-3 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={broaden}
                      onChange={(e) => setBroaden(e.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-500 focus:ring-emerald-400"
                    />
                    <span>
                      Broaden search (include common variants)
                      <span className="mt-1 block text-xs text-slate-500">
                        Pulls more pages from eBay before filtering. Helpful for niche models/years.
                      </span>
                    </span>
                  </label>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <label className="flex items-start gap-3 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={includeProShops}
                      onChange={(e) => setIncludeProShops(e.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-500 focus:ring-emerald-400"
                    />
                    <span>
                      Include pro-shop sites (2nd Swing – beta)
                      <span className="mt-1 block text-xs text-slate-500">Adds 2nd Swing listings when enabled.</span>
                    </span>
                  </label>
                </div>

                <div className="flex items-end">
                  <button
                    onClick={clearAll}
                    className="w-full rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700"
                  >
                    Clear filters
                  </button>
                </div>
              </div>

              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Filters</h2>
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-5">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Quality</h3>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={onlyComplete}
                        onChange={(e) => setOnlyComplete(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-emerald-500 focus:ring-emerald-400"
                      />
                      Only show listings with price & image
                    </label>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Price</h3>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        placeholder="Min"
                        value={minPrice}
                        onChange={(e) => setMinPrice(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-slate-900 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400/40"
                      />
                      <span className="text-slate-400">—</span>
                      <input
                        type="number"
                        min="0"
                        placeholder="Max"
                        value={maxPrice}
                        onChange={(e) => setMaxPrice(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-slate-900 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400/40"
                      />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Condition</h3>
                    <div className="flex flex-col gap-2">
                      {CONDITION_OPTIONS.map((c) => (
                        <label key={c.value} className="flex items-center gap-2 text-sm text-slate-700">
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
                            className="h-4 w-4 rounded border-slate-300 text-emerald-500 focus:ring-emerald-400"
                          />
                          {c.label}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Dexterity</h3>
                    <div className="flex flex-col gap-2 text-sm text-slate-700">
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="dex"
                          checked={dex === ""}
                          onChange={() => setDex("")}
                          className="h-4 w-4 border-slate-300 text-emerald-500 focus:ring-emerald-400"
                        />
                        Any
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="dex"
                          checked={dex === "RIGHT"}
                          onChange={() => setDex("RIGHT")}
                          className="h-4 w-4 border-slate-300 text-emerald-500 focus:ring-emerald-400"
                        />
                        Right-handed
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="dex"
                          checked={dex === "LEFT"}
                          onChange={() => setDex("LEFT")}
                          className="h-4 w-4 border-slate-300 text-emerald-500 focus:ring-emerald-400"
                        />
                        Left-handed
                      </label>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Head Type</h3>
                    <div className="flex flex-col gap-2 text-sm text-slate-700">
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="head"
                          checked={head === ""}
                          onChange={() => setHead("")}
                          className="h-4 w-4 border-slate-300 text-emerald-500 focus:ring-emerald-400"
                        />
                        Any
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="head"
                          checked={head === "BLADE"}
                          onChange={() => setHead("BLADE")}
                          className="h-4 w-4 border-slate-300 text-emerald-500 focus:ring-emerald-400"
                        />
                        Blade
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="head"
                          checked={head === "MALLET"}
                          onChange={() => setHead("MALLET")}
                          className="h-4 w-4 border-slate-300 text-emerald-500 focus:ring-emerald-400"
                        />
                        Mallet
                      </label>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2">
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Length (common)</h3>
                    <div className="flex flex-wrap gap-3 text-sm text-slate-700">
                      {[33, 34, 35, 36].map((L) => (
                        <label key={L} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={lengths.includes(L)}
                            onChange={() => {
                              setLengths((prev) => (prev.includes(L) ? prev.filter((x) => x !== L) : [...prev, L]));
                            }}
                            className="h-4 w-4 rounded border-slate-300 text-emerald-500 focus:ring-emerald-400"
                          />
                          {L}&quot;
                        </label>
                      ))}
                      <div className="basis-full text-xs text-slate-500">
                        We match titles within ±0.5&quot; of the selected length(s).
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-3">
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Buying Options</h3>
                    <div className="flex flex-wrap gap-3 text-sm text-slate-700">
                      {BUYING_OPTIONS.map((b) => (
                        <label key={b.value} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={buying.includes(b.value)}
                            onChange={() =>
                              setBuying((prev) =>
                                prev.includes(b.value) ? prev.filter((v) => v !== b.value) : [...prev, b.value]
                              )
                            }
                            className="h-4 w-4 rounded border-slate-300 text-emerald-500 focus:ring-emerald-400"
                          />
                          {b.label}
                        </label>
                      ))}
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={hasBids}
                          onChange={(e) => setHasBids(e.target.checked)}
                          className="h-4 w-4 rounded border-slate-300 text-emerald-500 focus:ring-emerald-400"
                        />
                        Has bids
                      </label>
                    </div>

                    <div className="mt-4 space-y-2 text-sm text-slate-700">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={showAdvanced}
                          onChange={(e) => setShowAdvanced(e.target.checked)}
                          className="h-4 w-4 rounded border-slate-300 text-emerald-500 focus:ring-emerald-400"
                        />
                        Show advanced options
                      </label>

                      {showAdvanced && (
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={groupMode}
                            onChange={(e) => setGroupMode(e.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 text-emerald-500 focus:ring-emerald-400"
                          />
                          Group similar listings (model cards)
                        </label>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </HighlightCard>

          <HighlightCard className="p-6">
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-2xl font-semibold text-slate-900">Live results</h2>
                  <p className="text-sm text-slate-600">
                    Results refresh automatically as you adjust filters. Group view bundles listings by model.
                  </p>
                </div>
                {q.trim() && (
                  <div className="text-sm text-slate-600">
                    {groupMode ? "Grouped by model" : "Flat list"} · Page{" "}
                    <span className="font-semibold text-slate-900">{page}</span> ·{" "}
                    <span className="font-semibold text-slate-900">{FIXED_PER_PAGE}</span>{" "}
                    {groupMode ? "groups" : "listings"}
                  </div>
                )}
              </div>

              {!q.trim() && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-600">
                  Start by typing a putter model or choose a brand above to see grouped price comparisons.
                </div>
              )}

              {q.trim() && !loading && !err && (
                <div className="text-sm text-slate-600">
                  Showing{" "}
                  <span className="font-semibold text-slate-900">{groupMode ? groups?.length ?? 0 : offers?.length ?? 0}</span>{" "}
                  {groupMode ? "model groups" : "listings"}
                  {typeof keptCount === "number" && typeof fetchedCount === "number" ? (
                    <> from <span className="font-semibold text-slate-900">{keptCount}</span> kept (fetched {fetchedCount}).</>
                  ) : null}
                </div>
              )}

              <MarketSnapshot snapshot={apiData?.analytics?.snapshot} meta={apiData?.meta} query={q} />

              {q.trim() && loading && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-2">
                  {Array.from({ length: Math.min(FIXED_PER_PAGE, 6) }).map((_, i) => (
                    <div
                      key={i}
                      className="animate-pulse overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                    >
                      <div className="h-40 bg-slate-100" />
                      <div className="space-y-3 p-4">
                        <div className="h-4 w-1/2 rounded bg-slate-200" />
                        <div className="h-3 w-1/3 rounded bg-slate-200" />
                        <div className="h-8 w-full rounded bg-slate-100" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {q.trim() && err && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
                  <p className="text-sm text-red-700">{err}</p>
                </div>
              )}

              {q.trim() && !loading && !err && groupMode && (
                <>
                  <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-2">
                    {sortedGroups.map((g) => {
                      const isOpen = !!expanded[g.model];
                      const ordered =
                        sortBy === "best_price_desc"
                          ? [...g.offers].sort((a, b) => {
                              const ac = offerCost(a);
                              const bc = offerCost(b);
                              return (bc ?? -Infinity) - (ac ?? -Infinity);
                            })
                          : [...g.offers].sort((a, b) => {
                              const ac = offerCost(a);
                              const bc = offerCost(b);
                              return (ac ?? Infinity) - (bc ?? Infinity);
                            });

                      const { domDex, domHead, domLen } = summarizeDexHead(g);

                      const showAll = !!showAllOffersByModel[g.model];
                      const list = isOpen ? (showAll ? ordered : ordered.slice(0, 10)) : [];

                      const groupCond =
                        selectedConditionBand(conds) || inferConditionBandFromOffers(g?.offers || []) || "";
                      const statsKey = getStatsKey(g.model, groupCond);
                      const stats = statsByModel[statsKey] || null;

                      const firstOffer = ordered[0];
                      const bestUrl = firstOffer?.url ?? null;
                      const bestPriceValue = Number.isFinite(Number(g.bestPrice))
                        ? Number(g.bestPrice)
                        : offerCost(firstOffer);
                      const bestCurrency = g.bestCurrency || firstOffer?.currency || "USD";

                      const bandValue = stats?.usedBand || g?.stats?.usedBand || null;
                      const bandSampleRaw =
                        stats?.bandSampleSize ?? stats?.n ?? stats?.sampleSize ?? g?.statsMeta?.bandSampleSize ?? null;
                      const bandSample =
                        Number.isFinite(Number(bandSampleRaw)) && Number(bandSampleRaw) > 0
                          ? Number(bandSampleRaw)
                          : null;

                      const conditionValue =
                        firstOffer?.conditionBand || firstOffer?.conditionId || firstOffer?.condition || null;
                      const displayLabel = g.label || g.model;
                      const imageUrl = g.image || firstOffer?.image || null;
                      const retailerCount = Array.isArray(g.retailers) ? g.retailers.length : 0;

                      return (
                        <article
                          key={g.model}
                          className="rounded-3xl border border-slate-200 bg-white/95 shadow-sm transition hover:shadow-xl"
                        >
                          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                            <div className="flex h-28 w-full items-center justify-center overflow-hidden rounded-2xl bg-slate-100 sm:h-32 sm:w-40">
                              {imageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={imageUrl} alt={displayLabel} className="h-full w-full object-contain" loading="lazy" />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">
                                  Image updating…
                                </div>
                              )}
                            </div>

                            <div className="flex flex-1 flex-col gap-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 space-y-1">
                                  <h3 className="truncate text-base font-semibold text-slate-900 sm:text-lg">{displayLabel}</h3>
                                  <p className="text-xs text-slate-500">
                                    {g.count} listing{g.count === 1 ? "" : "s"}
                                    {retailerCount ? <> · {retailerCount} seller{retailerCount === 1 ? "" : "s"}</> : null}
                                  </p>
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                                <ConditionPill condition={conditionValue} />
                                <BandChip band={bandValue} sample={bandSample} />
                                {domDex && (
                                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                                    {domDex === "LEFT" ? "Left-hand" : "Right-hand"}
                                  </span>
                                )}
                                {domHead && (
                                  <span className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                                    {domHead === "MALLET" ? "Mallet" : "Blade"}
                                  </span>
                                )}
                                {Number.isFinite(domLen) && (
                                  <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                                    ~{domLen}"</span>
                                )}
                              </div>

                              <div className="flex items-end justify-between gap-3 pt-1">
                                <div>
                                  <p className="text-xs text-slate-500">Best live price</p>
                                  <p className="text-lg font-semibold text-slate-900">
                                    {Number.isFinite(bestPriceValue) ? formatPrice(bestPriceValue, bestCurrency) : "—"}
                                  </p>
                                </div>
                                {bestUrl ? (
                                  <a
                                    href={bestUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400"
                                  >
                                    View listing
                                  </a>
                                ) : null}
                              </div>

                              <div className="flex flex-wrap items-center gap-2 pt-2">
                                <button
                                  onClick={() => toggleExpand(g.model)}
                                  className="inline-flex items-center rounded-full bg-slate-900 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-slate-700"
                                >
                                  {isOpen ? "Hide offers" : `View offers (${g.count})`}
                                </button>
                                {isOpen && g.count > 10 ? (
                                  <button
                                    onClick={() => toggleShowAllOffers(g.model)}
                                    className="inline-flex items-center rounded-full border border-slate-200 px-4 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-emerald-200 hover:text-emerald-700"
                                  >
                                    {showAll ? "Show top 10" : "Show all"}
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          </div>

                          {isOpen && list.length ? (
                            <ul className="space-y-3 border-t border-slate-100 px-5 pb-5 pt-4">
                              {list.map((o) => {
                                const condParam =
                                  (o?.conditionBand || o?.condition || "").toUpperCase() ||
                                  selectedConditionBand(conds) ||
                                  "";

                                const modelKey = getModelKey(o);
                                const variant = detectVariant(o?.title);
                                const variantKey = getStatsKey3(modelKey, variant, condParam);
                                const baseKey = getStatsKey(modelKey, condParam);
                                const variantStats = statsByModel[variantKey] ?? null;
                                const baseStats = statsByModel[baseKey] ?? stats;
                                const bandForOffer = variantStats?.usedBand ?? baseStats?.usedBand ?? bandValue;
                                const bandSampleOffer =
                                  variantStats?.bandSampleSize ?? baseStats?.bandSampleSize ?? baseStats?.n ?? null;
                                const offerId = getOfferId(o);
                                const offerCompared = offerId ? compareIds.has(offerId) : false;
                                const priceValue = Number(o.price);
                                const dex = (o?.specs?.dexterity || "").toUpperCase();
                                const head = (o?.specs?.headType || "").toUpperCase();
                                const lengthValue = Number(o?.specs?.length);

                                return (
                                  <li
                                    key={o.productId + o.url}
                                    className="rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm transition hover:border-emerald-200"
                                  >
                                    <div className="flex flex-col gap-3 sm:flex-row">
                                      <div className="flex h-24 w-full items-center justify-center overflow-hidden rounded-xl bg-slate-100 sm:h-24 sm:w-24">
                                        {o.image ? (
                                          // eslint-disable-next-line @next/next/no-img-element
                                          <img src={o.image} alt={o.title} className="h-full w-full object-contain" loading="lazy" />
                                        ) : (
                                          <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">
                                            Image updating…
                                          </div>
                                        )}
                                      </div>
                                      <div className="flex flex-1 flex-col gap-3">
                                        <div className="flex items-start justify-between gap-3">
                                          <div className="min-w-0">
                                            <h4 className="line-clamp-3 text-sm font-semibold text-slate-900">{o.title}</h4>
                                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                                              <ConditionPill condition={o.conditionBand || o.conditionId || o.condition} />
                                              <BandChip band={bandForOffer} sample={bandSampleOffer} />
                                              {dex === "LEFT" || dex === "RIGHT" ? (
                                                <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700">
                                                  {dex === "LEFT" ? "Left-hand" : "Right-hand"}
                                                </span>
                                              ) : null}
                                              {head === "MALLET" || head === "BLADE" ? (
                                                <span className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
                                                  {head === "MALLET" ? "Mallet" : "Blade"}
                                                </span>
                                              ) : null}
                                              {Number.isFinite(lengthValue) ? (
                                                <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                                                  {`${lengthValue}"`}
                                                </span>
                                              ) : null}
                                            </div>
                                          </div>
                                          <div className="text-right">
                                            <p className="text-xs text-slate-500">Price</p>
                                            <p className="text-base font-semibold text-slate-900">
                                              {Number.isFinite(priceValue) ? formatPrice(priceValue, o.currency) : "—"}
                                            </p>
                                          </div>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                          {offerId ? (
                                            <button
                                              type="button"
                                              disabled={!offerId}
                                              onClick={() => handleToggleCompare(o)}
                                              aria-pressed={offerCompared}
                                              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold transition ${
                                                offerCompared
                                                  ? "border border-blue-600 bg-blue-600 text-white hover:border-blue-700 hover:bg-blue-700"
                                                  : "border border-slate-200 text-slate-700 hover:border-blue-300 hover:text-blue-700"
                                              } disabled:cursor-not-allowed disabled:opacity-60`}
                                            >
                                              {offerCompared ? "Remove" : "Compare"}
                                            </button>
                                          ) : null}
                                          {o.url ? (
                                            <a
                                              href={o.url}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="inline-flex items-center rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400"
                                            >
                                              View listing
                                            </a>
                                          ) : null}
                                        </div>
                                      </div>
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                          ) : null}
                        </article>
                      );
                    })}
                  </section>

                  <div className="flex items-center justify-between">
                    <button
                      disabled={!canPrev}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className={`rounded-full px-4 py-2 text-sm font-semibold transition ${canPrev ? "border border-slate-200 text-slate-700 hover:border-emerald-200 hover:text-emerald-700" : "cursor-not-allowed border border-slate-100 text-slate-300"}`}
                    >
                      ← Prev
                    </button>
                    <div className="text-sm text-slate-600">
                      Page <span className="font-semibold text-slate-900">{page}</span> · {FIXED_PER_PAGE} groups per page
                    </div>
                    <button
                      disabled={!canNext}
                      onClick={() => setPage((p) => p + 1)}
                      className={`rounded-full px-4 py-2 text-sm font-semibold transition ${canNext ? "border border-slate-200 text-slate-700 hover:border-emerald-200 hover:text-emerald-700" : "cursor-not-allowed border border-slate-100 text-slate-300"}`}
                    >
                      Next →
                    </button>
                  </div>
                </>
              )}

              {q.trim() && !loading && !err && !groupMode && showAdvanced && (
                <>
                  <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                    {offers.map((o) => {
                      const modelKey = getModelKey(o);
                      const condParam =
                        (o?.conditionBand || o?.condition || "").toUpperCase() ||
                        selectedConditionBand(conds) ||
                        "";
                      const variant = detectVariant(o?.title);
                      const variantKey = getStatsKey3(modelKey, variant, condParam);
                      const baseKey = getStatsKey(modelKey, condParam);
                      const variantStats = statsByModel[variantKey] ?? null;
                      const baseStats = statsByModel[baseKey] ?? null;
                      const stats = variantStats ?? baseStats;
                      const offerId = getOfferId(o);
                      const offerCompared = offerId ? compareIds.has(offerId) : false;
                      const priceValue = Number(o.price);
                      const dex = (o?.specs?.dexterity || "").toUpperCase();
                      const head = (o?.specs?.headType || "").toUpperCase();
                      const lengthValue = Number(o?.specs?.length);
                      const bandValue = stats?.usedBand || null;
                      const bandSample = stats?.bandSampleSize ?? stats?.n ?? null;
                      const rarityTier = o?.rarityTier || o?.release?.rarityTier || o?.tags?.rarityTier || null;
                      const displayTitle = formatFullModelName({
                        brand: o?.brand || o?.specs?.brand,
                        model: o?.model || modelKey,
                        label: o?.modelLabel,
                        rawLabel: o?.title,
                        variantKey: variant,
                      });
                      const badge = Number.isFinite(priceValue)
                        ? makeSmartBadge({ listingPrice: priceValue, stats })
                        : null;
                      const showBadge = badge && badge.tier !== "insufficient";
                      const medianValue = Number.isFinite(stats?.p50) ? Number(stats.p50) : null;
                      const diffValue =
                        Number.isFinite(medianValue) && Number.isFinite(priceValue)
                          ? priceValue - medianValue
                          : null;
                      const diffAbs = Number.isFinite(diffValue) ? Math.abs(diffValue) : null;
                      const diffPct =
                        Number.isFinite(diffValue) && Number.isFinite(medianValue) && medianValue > 0
                          ? Math.round(Math.abs((diffValue / medianValue) * 100))
                          : null;

                      return (
                        <article
                          key={o.productId + o.url}
                          className="flex h-full flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
                        >
                          <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
                            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-slate-100 md:h-36 md:w-48 md:flex-shrink-0">
                              {o.image ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={o.image}
                                  alt={o.title}
                                  className="absolute inset-0 h-full w-full object-contain p-3"
                                  loading="lazy"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center p-3 text-xs text-slate-500">
                                  Image updating…
                                </div>
                              )}
                            </div>

                            <div className="flex flex-1 flex-col gap-4">
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0">
                                  <h3 className="text-lg font-semibold leading-6 text-slate-900 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
                                    {displayTitle || o.title}
                                  </h3>
                                  <p className="mt-1 text-sm text-slate-600 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">{o.title}</p>
                                </div>
                                <div className="flex flex-col items-end gap-2">
                                  {showBadge ? (
                                    <span
                                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${badge.color}`}
                                    >
                                      <span aria-hidden="true">{badge.icon}</span>
                                      <span>{badge.label}</span>
                                    </span>
                                  ) : null}
                                  <RarityBadge tier={rarityTier} />
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                                <ConditionPill condition={o.conditionBand || o.conditionId || o.condition} />
                                <BandChip band={bandValue} sample={bandSample} />
                                {dex === "LEFT" || dex === "RIGHT" ? (
                                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700">
                                    {dex === "LEFT" ? "Left-hand" : "Right-hand"}
                                  </span>
                                ) : null}
                                {head === "MALLET" || head === "BLADE" ? (
                                  <span className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
                                    {head === "MALLET" ? "Mallet" : "Blade"}
                                  </span>
                                ) : null}
                                {Number.isFinite(lengthValue) ? (
                                  <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                                    {`${lengthValue}"`}
                                  </span>
                                ) : null}
                              </div>

                              <div className="mt-auto flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                                <div>
                                  <p className="text-xs uppercase tracking-wide text-slate-500">Price</p>
                                  <p className="text-xl font-semibold text-slate-900">
                                    {Number.isFinite(priceValue) ? formatPrice(priceValue, o.currency) : "—"}
                                  </p>
                                  {Number.isFinite(medianValue) ? (
                                    <p className="mt-1 text-xs text-slate-600">
                                      Median: {formatPrice(medianValue, o.currency)}
                                      {Number.isFinite(diffValue) && diffAbs ? (
                                        <>
                                          {" "}· ≈{formatPrice(diffAbs, o.currency)} {diffValue < 0 ? "below" : "above"}
                                          {diffPct ? ` (${diffPct}% ${diffValue < 0 ? "below" : "above"})` : ""}
                                        </>
                                      ) : null}
                                    </p>
                                  ) : null}
                                </div>
                                <div className="flex flex-wrap items-center justify-end gap-2">
                                  {offerId ? (
                                    <button
                                      type="button"
                                      disabled={!offerId}
                                      onClick={() => handleToggleCompare(o)}
                                      aria-pressed={offerCompared}
                                      className={`inline-flex items-center gap-1 rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                                        offerCompared
                                          ? "border border-blue-600 bg-blue-600 text-white hover:border-blue-700 hover:bg-blue-700"
                                          : "border border-slate-200 text-slate-700 hover:border-blue-300 hover:text-blue-700"
                                      } disabled:cursor-not-allowed disabled:opacity-60`}
                                    >
                                      {offerCompared ? "Remove" : "Compare"}
                                    </button>
                                  ) : null}
                                  {o.url ? (
                                    <a
                                      href={o.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center rounded-full bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
                                    >
                                      View listing
                                    </a>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </section>

                  <div className="flex items-center justify-between">
                    <button
                      disabled={!hasPrev || page <= 1 || loading}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className={`rounded-full px-4 py-2 text-sm font-semibold transition ${hasPrev && page > 1 && !loading ? "border border-slate-200 text-slate-700 hover:border-emerald-200 hover:text-emerald-700" : "cursor-not-allowed border border-slate-100 text-slate-300"}`}
                    >
                      ← Prev
                    </button>
                    <div className="text-sm text-slate-600">
                      Page <span className="font-semibold text-slate-900">{page}</span> · {FIXED_PER_PAGE} listings per page
                    </div>
                    <button
                      disabled={!hasNext || loading}
                      onClick={() => setPage((p) => p + 1)}
                      className={`rounded-full px-4 py-2 text-sm font-semibold transition ${hasNext && !loading ? "border border-slate-200 text-slate-700 hover:border-emerald-200 hover:text-emerald-700" : "cursor-not-allowed border border-slate-100 text-slate-300"}`}
                    >
                      Next →
                    </button>
                  </div>
                </>
              )}
            </div>
          </HighlightCard>
        </div>
      </SectionWrapper>
    </main>
      <CompareTray
        open={isCompareOpen}
        items={compareItems}
        onClose={handleCloseCompare}
        onRemove={handleRemoveCompare}
        onClear={handleClearCompare}
      />
      <CompareBar
        items={compareItems}
        onRemove={handleRemoveCompare}
        onClear={handleClearCompare}
        onOpen={handleOpenCompare}
      />
    </>
  );
}
