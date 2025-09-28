"use client";

import { useEffect, useMemo, useState } from "react";
import MarketSnapshot from "@/components/MarketSnapshot";
import PriceSparkline from "@/components/PriceSparkline";
import SmartPriceBadge from "@/components/SmartPriceBadge";
import { detectVariant } from "@/lib/variantMap";

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
  if (typeof value !== "number" || !isFinite(value)) return "—";
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
  }, []);

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
    params.set("page", String(page));
    params.set("group", groupMode ? "true" : "false");

    const qs = params.toString();
    const url = qs ? `/putters?${qs}` : "/putters";
    window.history.replaceState({}, "", url);
  }, [q, onlyComplete, minPrice, maxPrice, conds, buying, hasBids, sortBy, page, groupMode, broaden, dex, head, lengths, includeProShops]);

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
    params.set("page", String(page));
    params.set("perPage", String(FIXED_PER_PAGE));
    params.set("group", groupMode ? "true" : "false");
    params.set("samplePages", "3");
    params.set("_ts", String(Date.now()));
    return `/api/putters?${params.toString()}`;
  }, [q, onlyComplete, minPrice, maxPrice, conds, buying, hasBids, sortBy, page, groupMode, broaden, dex, head, lengths, includeProShops]);

  // Reset to page 1 when inputs change
  useEffect(() => {
    setPage(1);
  }, [q, onlyComplete, minPrice, maxPrice, conds, buying, hasBids, sortBy, groupMode, broaden, dex, head, lengths, includeProShops]);

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

    const numberFormatter = useMemo(() => new Intl.NumberFormat("en-US"), []);
  const trimmedQuery = q.trim();
  const visibleCount = trimmedQuery ? (groupMode ? sortedGroups.length : offers.length) : 0;
  const visibleLabel = groupMode ? "model groups" : "listings";
  const formattedFetchedCount =
    typeof fetchedCount === "number" ? numberFormatter.format(fetchedCount) : null;
  const formattedKeptCount =
    typeof keptCount === "number" ? numberFormatter.format(keptCount) : null;
  const heroTitle = trimmedQuery
    ? `Live market pulse for “${trimmedQuery}” putters.`
    : "Compare putter prices in real time.";
  const heroSubline = trimmedQuery
    ? `Our bots are tracking ${formattedFetchedCount ? `${formattedFetchedCount} live` : "live"} listings${
        formattedKeptCount ? ` and ranking ${formattedKeptCount} matches` : ""
      } for “${trimmedQuery}” right now.`
    : "Track eBay’s putter market with Smart Price intelligence tuned for golfers.";
  const heroSupport = trimmedQuery
    ? loading
      ? "Refreshing the latest offers and recalculating Smart Price badges…"
      : err
      ? "We couldn’t refresh that feed just now — adjust filters or try again."
      : `You’re viewing ${numberFormatter.format(visibleCount)} ${visibleLabel} with Smart Price badges updating on every refresh.`
    : "Type a model or jump into a brand shortcut to watch deals surface in real time.";
  const showResultsSummary = Boolean(trimmedQuery && !loading && !err);
  const snapshotData = apiData?.analytics?.snapshot ?? null;
  const hasSnapshot = Boolean(snapshotData?.price);

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="relative isolate overflow-hidden px-6 py-20 sm:py-24">
        <div className="mx-auto max-w-5xl text-center">
          <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-4 py-1 text-sm font-semibold text-emerald-200 ring-1 ring-inset ring-emerald-400/30">
            Live eBay market intelligence
          </span>
          <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl">{heroTitle}</h1>
          <p className="mt-6 text-lg leading-8 text-slate-200">{heroSubline}</p>
          <p className="mt-3 text-sm text-emerald-200">{heroSupport}</p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href="#search-controls"
              className="inline-flex items-center justify-center rounded-full bg-emerald-500 px-6 py-3 text-base font-semibold text-slate-950 shadow-lg shadow-emerald-500/40 transition hover:bg-emerald-400"
            >
              Refine this search
            </a>
            <a
              href={trimmedQuery ? "#results" : "#brand-shortcuts"}
              className="inline-flex items-center justify-center rounded-full bg-white/10 px-6 py-3 text-base font-semibold text-white ring-1 ring-inset ring-white/20 transition hover:bg-white/20"
            >
              {trimmedQuery ? "Jump to live results" : "Browse brand shortcuts"}
            </a>
          </div>
          <p className="mt-3 text-xs uppercase tracking-wide text-slate-300/80">
            Smart Price badges update with every refresh — tap a card to inspect live offers.
          </p>
        </div>
      </section>

      <section id="search-controls" className="bg-white px-6 py-16 text-slate-900 sm:py-20">
        <div className="mx-auto max-w-6xl space-y-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-3xl">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
                Dial in your live putter feed
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                Badges are benchmarked against recent comps.&nbsp;
                <a className="font-semibold text-emerald-600 hover:text-emerald-500" href="/methodology">
                  See methodology
                </a>
                .
              </p>
            </div>
            {trimmedQuery && (
              <div className="text-sm text-slate-500">
                {groupMode ? "Grouped by model" : "Flat list"} · Page{" "}
                <span className="font-semibold text-slate-900">{page}</span> ·{" "}
                <span className="font-semibold text-slate-900">{FIXED_PER_PAGE}</span> {groupMode ? "groups" : "listings"}
              </div>
            )}
          </div>

          {recent.length > 0 && (
            <section className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3">
              <span className="text-xs uppercase tracking-wide text-slate-500">Recently viewed:</span>
              {recent.map((m) => (
                <button
                  key={m}
                  onClick={() => setQ(m)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-medium text-slate-900 transition hover:bg-slate-100"
                  title={`Search ${m}`}
                >
                  {m}
                </button>
              ))}
              <button
                onClick={clearRecent}
                className="ml-2 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100"
              >
                clear
              </button>
            </section>
          )}

          <section id="brand-shortcuts" className="flex flex-wrap gap-2">
            {BRANDS.map((b) => (
              <button
                key={b.label}
                onClick={() => setQ(b.q)}
                className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-sm font-medium text-slate-900 transition hover:bg-slate-100"
                title={`Search ${b.label}`}
              >
                {b.label}
              </button>
            ))}
          </section>

          <section className="grid grid-cols-1 gap-4 md:grid-cols-6">
            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-semibold text-slate-700">Search</label>
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="e.g. scotty cameron newport"
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-base text-slate-900 outline-none transition focus:ring-2 focus:ring-emerald-400"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Sort</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 transition focus:ring-2 focus:ring-emerald-400"
              >
                {SORT_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <label className="flex items-start gap-2 text-sm font-medium text-slate-700">
                <input type="checkbox" checked={broaden} onChange={(e) => setBroaden(e.target.checked)} />
                <span>
                  Broaden search (include common variants)
                  <span className="mt-1 block text-xs font-normal text-slate-500">
                    Pulls more pages from eBay before filtering. Helpful for niche models/years.
                  </span>
                </span>
              </label>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <label className="flex items-start gap-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={includeProShops}
                  onChange={(e) => setIncludeProShops(e.target.checked)}
                />
                <span>
                  Include pro-shop sites (2nd Swing – beta)
                  <span className="mt-1 block text-xs font-normal text-slate-500">
                    Adds 2nd Swing listings when enabled.
                  </span>
                </span>
              </label>
            </div>

            <div className="flex items-end">
              <button
                onClick={clearAll}
                className="w-full rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
              >
                Clear
              </button>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Quality</h3>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={onlyComplete}
                  onChange={(e) => setOnlyComplete(e.target.checked)}
                />
                Only show listings with price &amp; image
              </label>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Price</h3>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  placeholder="Min"
                  value={minPrice}
                  onChange={(e) => setMinPrice(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:ring-2 focus:ring-emerald-400"
                />
                <span className="text-slate-400">—</span>
                <input
                  type="number"
                  min="0"
                  placeholder="Max"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:ring-2 focus:ring-emerald-400"
                />
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
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
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Dexterity</h3>
              <div className="flex flex-col gap-2 text-sm text-slate-700">
                <label className="flex items-center gap-2">
                  <input type="radio" name="dex" checked={dex === ""} onChange={() => setDex("")} />
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

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Head Type</h3>
              <div className="flex flex-col gap-2 text-sm text-slate-700">
                <label className="flex items-center gap-2">
                  <input type="radio" name="head" checked={head === ""} onChange={() => setHead("")} />
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

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:col-span-2">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Length (common)
              </h3>
              <div className="flex flex-wrap gap-3 text-sm text-slate-700">
                {[33, 34, 35, 36].map((L) => (
                  <label key={L} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={lengths.includes(L)}
                      onChange={() => {
                        setLengths((prev) => (prev.includes(L) ? prev.filter((x) => x !== L) : [...prev, L]));
                      }}
                    />
                    {L}&quot;
                  </label>
                ))}
                <div className="basis-full text-xs text-slate-500">
                  We match titles within ±0.5&quot; of the selected length(s).
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:col-span-3">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Buying Options</h3>
              <div className="flex flex-wrap gap-3 text-sm text-slate-700">
                {BUYING_OPTIONS.map((b) => (
                  <label key={b.value} className="flex items-center gap-2">
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
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={hasBids} onChange={(e) => setHasBids(e.target.checked)} />
                  Has bids
                </label>
              </div>

              <div className="mt-4 space-y-3 text-sm text-slate-700">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={showAdvanced}
                    onChange={(e) => setShowAdvanced(e.target.checked)}
                  />
                  Show advanced options
                </label>

                {showAdvanced && (
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={groupMode}
                      onChange={(e) => setGroupMode(e.target.checked)}
                    />
                    Group similar listings (model cards)
                  </label>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="results" className="bg-slate-100 px-6 py-16 text-slate-900 sm:py-20">
        <div className="mx-auto max-w-6xl">
          {!trimmedQuery && (
            <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
              Start by typing a putter model or choose a brand above to see grouped price comparisons.
            </div>
          )}

          {showResultsSummary && (
            <div className="text-sm text-slate-600">
              Showing <span className="font-semibold text-slate-900">{numberFormatter.format(visibleCount)}</span>{" "}
              {visibleLabel}
              {typeof keptCount === "number" && typeof fetchedCount === "number" ? (
                <>
                  {" "}from <span className="font-semibold text-slate-900">{numberFormatter.format(keptCount)}</span> kept (fetched {numberFormatter.format(fetchedCount)}).
                </>
              ) : null}
            </div>
          )}

          {hasSnapshot && (
            <div className="mt-10 rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-sm backdrop-blur">
              <MarketSnapshot snapshot={snapshotData} meta={apiData?.meta} query={q} />
            </div>
          )}

          {trimmedQuery && loading && (
            <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-2">
              {Array.from({ length: Math.min(FIXED_PER_PAGE, 6) }).map((_, i) => (
                <div
                  key={i}
                  className="animate-pulse overflow-hidden rounded-3xl border border-slate-200 bg-white"
                >
                  <div className="h-40 bg-slate-100" />
                  <div className="space-y-3 p-5">
                    <div className="h-4 w-1/2 rounded bg-slate-200" />
                    <div className="h-3 w-1/3 rounded bg-slate-200" />
                    <div className="h-8 w-full rounded bg-slate-100" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {err && (
            <div className="mt-10 rounded-3xl border border-red-200 bg-red-50/80 p-6 text-sm text-red-700">
              {err}
            </div>
          )}

          {trimmedQuery && !loading && !err && groupMode && (
            <>
              <section className="mt-10 space-y-6">
                {sortedGroups.map((g) => {
                  const isOpen = !!expanded[g.model];
                  const ordered =
                    sortBy === "best_price_desc"
                      ? [...(g.offers || [])].sort((a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity))
                      : [...(g.offers || [])].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
                  const nums = ordered
                    .map((o) => o?.price)
                    .filter((x) => typeof x === "number")
                    .sort((a, b) => a - b);
                  const nNums = nums.length;
                  const med =
                    nNums < 2
                      ? null
                      : nNums % 2
                      ? nums[Math.floor(nNums / 2)]
                      : (nums[nNums / 2 - 1] + nums[nNums / 2]) / 2;
                  const bestDelta =
                    typeof g.bestPrice === "number" && typeof med === "number" && med - g.bestPrice > 0
                      ? { diff: med - g.bestPrice, pct: ((med - g.bestPrice) / med) * 100, med }
                      : null;
                  const { domDex, domHead, domLen } = summarizeDexHead(g);
                  const showAll = !!showAllOffersByModel[g.model];
                  const list = isOpen ? (showAll ? ordered : ordered.slice(0, 10)) : [];
                  const lows = lowsByModel[g.model];
                  const series = seriesByModel[g.model] || [];
                  const groupCond = selectedConditionBand(conds) || inferConditionBandFromOffers(g?.offers || []) || "";
                  const statsKey = getStatsKey(g.model, groupCond);
                  const stats = statsByModel[statsKey] || null;
                  const firstOffer = ordered[0];
                  const bestUrl = firstOffer?.url ?? null;
                  const helperModelKey = firstOffer ? getModelKey(firstOffer) : g.model;
                  const helperVariant = firstOffer ? detectVariant(firstOffer?.title) : null;
                  const helperVariantKey = getStatsKey3(helperModelKey, helperVariant, groupCond);
                  const helperBaseKey = getStatsKey(helperModelKey, groupCond);
                  const helperVariantStats = statsByModel[helperVariantKey] ?? null;
                  const helperBaseStats = statsByModel[helperBaseKey] ?? stats;
                  const fair = fairPriceBadge(g.bestPrice, stats);

                  return (
                    <article
                      key={g.model}
                      className="overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
                    >
                      <div className="relative aspect-[4/3] w-full max-h-48 overflow-hidden rounded-2xl bg-slate-100">
                        {g.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={g.image} alt={g.model} className="h-full w-full object-contain" loading="lazy" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">
                            Live data populates images as we refresh listings.
                          </div>
                        )}
                      </div>

                      <div className="mt-6 flex flex-col gap-4">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 flex-1">
                            <h3 className="text-xl font-semibold text-slate-900">{g.model}</h3>
                            <p className="mt-1 text-xs text-slate-500">
                              {g.count} offer{g.count === 1 ? "" : "s"} · {g.retailers.join(", ")}
                            </p>

                            <div className="mt-3 flex flex-wrap items-center gap-2">
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

                              <SmartPriceBadge
                                price={Number(g.bestPrice)}
                                baseStats={helperBaseStats}
                                variantStats={helperVariantStats}
                                className="ml-1"
                              />

                              {fair && (
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium text-white ${
                                    fair.tone === "emerald" ? "bg-emerald-600" : "bg-green-600"
                                  }`}
                                >
                                  {fair.label}
                                </span>
                              )}
                            </div>

                            <div className="mt-3">
                              <SmartPriceBadge
                                price={Number(g.bestPrice)}
                                baseStats={helperBaseStats}
                                variantStats={helperVariantStats}
                                title={firstOffer?.title || g.model}
                                specs={firstOffer?.specs}
                                brand={g?.brand}
                                showHelper
                              />
                            </div>

                            {isOpen && (
                              <div className="mt-3 text-xs text-slate-600">
                                <span className="mr-2">Lows:</span>
                                <span className="mr-3">1d {formatPrice(Number(lows?.low1d))}</span>
                                <span className="mr-3">7d {formatPrice(Number(lows?.low7d))}</span>
                                <span>30d {formatPrice(Number(lows?.low30d))}</span>
                              </div>
                            )}
                          </div>

                          <div className="flex shrink-0 flex-col items-end gap-2">
                            <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                              Best: {formatPrice(g.bestPrice, g.bestCurrency)}
                            </div>
                            {bestDelta && (
                              <div
                                className="rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-medium text-emerald-700"
                                title={`Median ${formatPrice(bestDelta.med)} · Save ~${formatPrice(bestDelta.diff)} (~${bestDelta.pct.toFixed(0)}%)`}
                              >
                                Save {formatPrice(bestDelta.diff)} (~{bestDelta.pct.toFixed(0)}%)
                              </div>
                            )}

                            <button
                              disabled={!bestUrl}
                              onClick={async () => {
                                if (!bestUrl) return;
                                await copyToClipboard(bestUrl);
                                setCopiedFor(g.model);
                                setTimeout(() => setCopiedFor((c) => (c === g.model ? "" : c)), 1500);
                              }}
                              className={`mt-1 rounded-full border border-slate-200 px-3 py-1 text-[11px] font-medium text-slate-700 transition ${
                                bestUrl ? "hover:bg-slate-100" : "cursor-not-allowed opacity-50"
                              }`}
                              title="Copy best listing link"
                            >
                              {copiedFor === g.model ? "Copied!" : "Copy best"}
                            </button>
                          </div>
                        </div>

                        {isOpen && Array.isArray(series) && series.length > 1 && (
                          <div className="rounded-2xl bg-slate-50/80 p-4">
                            <PriceSparkline data={series} height={70} showAverage showMedian className="h-[70px]" />
                          </div>
                        )}

                        <div className="flex flex-wrap gap-3">
                          <button
                            onClick={() => toggleExpand(g.model)}
                            className="inline-flex flex-1 items-center justify-center rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-sm transition hover:bg-emerald-400"
                          >
                            {isOpen ? "Hide offers" : `View offers (${g.count})`}
                          </button>
                          {isOpen && g.count > 10 && (
                            <button
                              onClick={() => toggleShowAllOffers(g.model)}
                              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                            >
                              {showAll ? "Show top 10" : "Show all"}
                            </button>
                          )}
                        </div>

                        {isOpen && (
                          <ul className="mt-4 space-y-2">
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

                              return (
                                <li
                                  key={o.productId + o.url}
                                  className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-3"
                                >
                                  <div className="flex min-w-0 items-center gap-3">
                                    {retailerLogos[o.retailer] && (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        src={retailerLogos[o.retailer]}
                                        alt={o.retailer}
                                        className="h-4 w-12 object-contain"
                                      />
                                    )}

                                    <div className="min-w-0">
                                      <div className="truncate text-sm font-semibold text-slate-900">
                                        {o.retailer}
                                        {o?.seller?.username && (
                                          <span className="ml-2 text-xs font-normal text-slate-500">@{o.seller.username}</span>
                                        )}
                                        {typeof o?.seller?.feedbackPct === "number" && (
                                          <span className="ml-2 rounded-full bg-slate-100 px-2 py-[2px] text-[11px] font-medium text-slate-700">
                                            {o.seller.feedbackPct.toFixed(1)}%
                                          </span>
                                        )}
                                        {Number(o?.buying?.bidCount) > 0 && (
                                          <span className="ml-2 text-xs font-medium text-amber-600">· {o.buying.bidCount} bids</span>
                                        )}
                                      </div>

                                      <div className="mt-1 truncate text-xs text-slate-500">
                                        {(o.specs?.dexterity || "").toUpperCase() === "LEFT"
                                          ? "LH"
                                          : (o.specs?.dexterity || "").toUpperCase() === "RIGHT"
                                          ? "RH"
                                          : "—"}
                                        {" · "}
                                        {(o.specs?.headType || "").toUpperCase() || "—"}
                                        {" · "}
                                        {Number.isFinite(Number(o?.specs?.length)) ? `${o.specs.length}"` : "—"}
                                        {o?.specs?.shaft && <> · {String(o.specs.shaft).toLowerCase()}</>}
                                        {o?.specs?.hosel && <> · {o.specs.hosel}</>}
                                        {o?.specs?.face && <> · {o.specs.face}</>}
                                        {o?.specs?.grip && <> · {o.specs.grip}</>}
                                        {o?.specs?.hasHeadcover && <> · HC</>}
                                        {o?.specs?.toeHang && <> · {o.specs.toeHang} toe</>}
                                        {Number.isFinite(Number(o?.specs?.loft)) && <> · {o.specs.loft}° loft</>}
                                        {Number.isFinite(Number(o?.specs?.lie)) && <> · {o.specs.lie}° lie</>}
                                        {o.createdAt && <> · listed {timeAgo(new Date(o.createdAt).getTime())}</>}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex flex-wrap items-center justify-end gap-3">
                                    <SmartPriceBadge
                                      price={Number(o.price)}
                                      baseStats={baseStats}
                                      variantStats={variantStats}
                                      title={o.title}
                                      specs={o.specs}
                                      brand={g?.brand}
                                    />
                                    <span className="text-sm font-semibold text-slate-900">
                                      {typeof o.price === "number" ? formatPrice(o.price, o.currency) : "—"}
                                    </span>
                                    <a
                                      href={o.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 shadow-sm transition hover:bg-emerald-400"
                                    >
                                      View
                                    </a>
                                  </div>
                                </li>
                              );
                            })}

                            {!showAll && g.count > 10 && (
                              <li className="px-3 pt-1 text-xs text-slate-500">Showing top 10 offers.</li>
                            )}
                          </ul>
                        )}
                      </div>
                    </article>
                  );
                })}
              </section>

              <div className="mt-10 flex items-center justify-between gap-4">
                <button
                  disabled={!canPrev}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className={`rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold transition ${
                    canPrev ? "bg-white text-slate-700 hover:bg-slate-100" : "cursor-not-allowed bg-white/60 text-slate-400"
                  }`}
                >
                  ← Prev
                </button>
                <div className="text-sm text-slate-600">
                  Page <span className="font-semibold text-slate-900">{page}</span> · {FIXED_PER_PAGE} groups per page
                </div>
                <button
                  disabled={!canNext}
                  onClick={() => setPage((p) => p + 1)}
                  className={`rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold transition ${
                    canNext ? "bg-white text-slate-700 hover:bg-slate-100" : "cursor-not-allowed bg-white/60 text-slate-400"
                  }`}
                >
                  Next →
                </button>
              </div>
            </>
          )}

          {trimmedQuery && !loading && !err && !groupMode && showAdvanced && (
            <>
              <section className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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

                  return (
                    <article
                      key={o.productId + o.url}
                      className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
                    >
                      <div className="relative aspect-[4/3] w-full bg-slate-100">
                        {o.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={o.image} alt={o.title} className="h-full w-full object-contain" loading="lazy" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">No image</div>
                        )}
                      </div>
                      <div className="flex flex-col gap-4 p-5">
                        <div>
                          <h3 className="line-clamp-2 text-sm font-semibold text-slate-900">{o.title}</h3>
                          <p className="mt-2 text-xs text-slate-500">
                            {o?.seller?.username && <>@{o.seller.username} · </>}
                            {typeof o?.seller?.feedbackPct === "number" && <>{o.seller.feedbackPct.toFixed(1)}% · </>}
                            {Number(o?.buying?.bidCount) > 0 && <>{o.buying.bidCount} bids · </>}
                            {(o.specs?.dexterity || "").toUpperCase() || "—"} · {(o.specs?.headType || "").toUpperCase() || "—"} ·
                            {Number.isFinite(Number(o?.specs?.length)) ? `${o.specs.length}"` : "—"}
                            {o?.specs?.shaft && <> · {String(o.specs.shaft).toLowerCase()}</>}
                            {o?.specs?.hosel && <> · {o.specs.hosel}</>}
                            {o?.specs?.face && <> · {o.specs.face}</>}
                            {o?.specs?.grip && <> · {o.specs.grip}</>}
                            {o?.specs?.hasHeadcover && <> · HC</>}
                            {o?.specs?.toeHang && <> · {o.specs.toeHang} toe</>}
                            {Number.isFinite(Number(o?.specs?.loft)) && <> · {o.specs.loft}° loft</>}
                            {Number.isFinite(Number(o?.specs?.lie)) && <> · {o.specs.lie}° lie</>}
                            {o.createdAt && <> · listed {timeAgo(new Date(o.createdAt).getTime())}</>}
                          </p>
                        </div>

                        <div className="flex items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <SmartPriceBadge
                              price={Number(o.price)}
                              baseStats={baseStats}
                              variantStats={variantStats}
                              title={o.title}
                              specs={o.specs}
                              brand={o.brand || ""}
                              className="mr-2"
                            />

                            <span className="text-base font-semibold text-slate-900">
                              {formatPrice(o.price, o.currency)}
                            </span>

                            {(() => {
                              const p50 = stats?.p50;
                              if (Number.isFinite(Number(p50)) && typeof o.price === "number" && o.price < Number(p50)) {
                                const save = Number(p50) - o.price;
                                const pct = Math.round((save / Number(p50)) * 100);
                                return (
                                  <span
                                    className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700"
                                    title={`Median ${formatPrice(Number(p50))} · Save ~${formatPrice(save)} (~${pct}%)`}
                                  >
                                    Save {formatPrice(save)}
                                  </span>
                                );
                              }
                              return null;
                            })()}
                          </div>

                          <a
                            href={o.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center rounded-full bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-slate-950 shadow-sm transition hover:bg-emerald-400"
                          >
                            View
                          </a>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </section>

              <div className="mt-10 flex items-center justify-between gap-4">
                <button
                  disabled={!canPrev}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className={`rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold transition ${
                    canPrev ? "bg-white text-slate-700 hover:bg-slate-100" : "cursor-not-allowed bg-white/60 text-slate-400"
                  }`}
                >
                  ← Prev
                </button>
                <div className="text-sm text-slate-600">
                  Page <span className="font-semibold text-slate-900">{page}</span> · {FIXED_PER_PAGE} listings per page
                </div>
                <button
                  disabled={!canNext}
                  onClick={() => setPage((p) => p + 1)}
                  className={`rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold transition ${
                    canNext ? "bg-white text-slate-700 hover:bg-slate-100" : "cursor-not-allowed bg-white/60 text-slate-400"
                  }`}
                >
                  Next →
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
