"use client";

import { useEffect, useMemo, useState } from "react";
import MarketSnapshot from "@/components/MarketSnapshot";
import CompareBar from "@/components/CompareBar";

const BRANDS = [
  { label: "Scotty Cameron", q: "scotty cameron putter" },
  { label: "TaylorMade", q: "taylormade putter" },
  { label: "Ping", q: "ping putter" },
  { label: "Odyssey", q: "odyssey putter" },
  { label: "L.A.B.", q: "lab golf putter" },
];

const CONDITION_OPTIONS = [
  { label: "New", value: "NEW" },
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
  { label: "Recently listed", value: "recent" }, // maps to sort=newlylisted
  { label: "Most Offers", value: "count_desc" },
  { label: "A → Z (Model)", value: "model_asc" },
];

const FIXED_PER_PAGE = 10;

const retailerLogos = {
  eBay: "https://upload.wikimedia.org/wikipedia/commons/1/1b/EBay_logo.svg",
};

function formatPrice(value, currency = "USD") {
  if (typeof value !== "number") return "—";
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

/** Build a lightweight client-side analytics snapshot from groups[].offers[] */
function buildSnapshotFromGroups(groups) {
  const offers = [];
  for (const g of groups || []) {
    if (Array.isArray(g.offers)) {
      for (let i = 0; i < g.offers.length && i < 20; i++) {
        offers.push(g.offers[i]);
      }
    }
  }
  const prices = offers
    .map(o => (typeof o?.price === "number" ? o.price : null))
    .filter((n) => typeof n === "number");

  const condCounts = {};
  for (const o of offers) {
    const key = (o?.condition || "UNKNOWN").toString().trim().toUpperCase().replace(/\s+/g, "_");
    condCounts[key] = (condCounts[key] || 0) + 1;
  }
  const conditions = Object.entries(condCounts)
    .sort((a,b) => b[1]-a[1])
    .map(([key, count]) => ({ key, count }));

  let min = null, max = null, avg = null;
  if (prices.length) {
    min = Math.min(...prices);
    max = Math.max(...prices);
    avg = Math.round((prices.reduce((a,b)=>a+b,0) / prices.length) * 100) / 100;
  }

  let histogram = [], buckets = [];
  if (prices.length >= 2 && min !== null && max !== null && max > min) {
    const BIN_COUNT = 8;
    const step = (max - min) / BIN_COUNT;
    buckets = Array.from({ length: BIN_COUNT }, (_, i) => Math.floor(min + step * (i + 1)));
    histogram = Array(BIN_COUNT).fill(0);
    for (const p of prices) {
      let idx = Math.floor((p - min) / step);
      if (idx >= BIN_COUNT) idx = BIN_COUNT - 1;
      if (idx < 0) idx = 0;
      histogram[idx] += 1;
    }
  }

  return {
    price: { min, max, avg, histogram, buckets },
    conditions,
    buyingOptions: [],
    brandsTop: [],
  };
}

export default function PuttersPage() {
  const [q, setQ] = useState("");
  const [onlyComplete, setOnlyComplete] = useState(true);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [conds, setConds] = useState([]);
  const [buying, setBuying] = useState([]);
  const [broaden, setBroaden] = useState(false);

  const [groupMode, setGroupMode] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [sortBy, setSortBy] = useState("best_price_asc");

  const [page, setPage] = useState(1);

  const [groups, setGroups] = useState([]);
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [hasNext, setHasNext] = useState(false);
  const [hasPrev, setHasPrev] = useState(false);
  const [fetchedCount, setFetchedCount] = useState(null);
  const [keptCount, setKeptCount] = useState(null);

  const [expanded, setExpanded] = useState({});
  const [apiData, setApiData] = useState(null);

  // NEW: compare selection (up to 4)
  const [selected, setSelected] = useState([]);
  const toggleSelect = (group) =>
    setSelected((prev) => {
      const exists = prev.find((g) => g.model === group.model);
      if (exists) return prev.filter((g) => g.model !== group.model);
      const next = [...prev, group];
      return next.slice(-4);
    });

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
    params.set("page", String(page));
    params.set("perPage", String(FIXED_PER_PAGE));
    params.set("group", groupMode ? "true" : "false");
    params.set("samplePages", "3"); // hint for newer backend
    return `/api/putters?${params.toString()}`;
  }, [q, onlyComplete, minPrice, maxPrice, conds, buying, sortBy, page, groupMode, broaden]);

  useEffect(() => {
    setPage(1);
  }, [q, onlyComplete, minPrice, maxPrice, conds, buying, sortBy, groupMode, broaden]);

  useEffect(() => {
    if (!q.trim()) {
      setGroups([]); setOffers([]);
      setHasNext(false); setHasPrev(false);
      setFetchedCount(null); setKeptCount(null);
      setApiData(null);
      setErr(""); return;
    }
    let ignore = false;
    const t = setTimeout(async () => {
      setLoading(true); setErr("");
      try {
        const res = await fetch(apiUrl, { cache: "no-store" });
        const data = await res.json();
        if (!ignore) {
          setGroups(Array.isArray(data.groups) ? data.groups : []);
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
          setOffers(pageOffers);
          setHasNext(Boolean(data.hasNext));
          setHasPrev(Boolean(data.hasPrev));
          setFetchedCount(typeof data.fetchedCount === "number" ? data.fetchedCount : null);
          setKeptCount(typeof data.keptCount === "number" ? data.keptCount : null);
          setApiData(data);
        }
      } catch {
        if (!ignore) setErr("Failed to load results. Please try again.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }, 200);
    return () => { ignore = true; clearTimeout(t); };
  }, [apiUrl, groupMode, sortBy, q]);

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

  const clearAll = () => {
    setQ(""); setOnlyComplete(true);
    setMinPrice(""); setMaxPrice("");
    setConds([]); setBuying([]);
    setSortBy("best_price_asc");
    setPage(1); setGroupMode(true); setBroaden(false);
    setSelected([]);
  };

  const canPrev = hasPrev && page > 1 && !loading;
  const canNext = hasNext && !loading;

  const fallbackSnapshot = useMemo(() => buildSnapshotFromGroups(groups), [groups]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Compare Putter Prices</h1>
          <p className="mt-1 text-sm text-gray-500">
            Type a model (e.g., <em>“scotty cameron newport”</em>) or pick a brand.
          </p>
        </div>
        {q.trim() && (
          <div className="text-sm text-gray-500">
            {groupMode ? "Grouped by model" : "Flat list"} · Page{" "}
            <span className="font-medium">{page}</span> ·{" "}
            <span className="font-medium">{FIXED_PER_PAGE}</span>{" "}
            {groupMode ? "groups" : "listings"}
          </div>
        )}
      </header>

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

      {/* Controls */}
      <section className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-5">
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
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-md border border-gray-200 p-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={broaden}
              onChange={(e) => setBroaden(e.target.checked)}
            />
            Broaden search (include common variants)
          </label>
          <p className="mt-1 text-xs text-gray-500">
            Pulls more pages from eBay before filtering. Helpful for niche models/years.
          </p>
        </div>

        <div className="flex items-end justify-between gap-3">
          <button
            onClick={clearAll}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-100"
          >
            Clear
          </button>
        </div>
      </section>

      {/* Filters */}
      <section className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-5">
        <div className="rounded-lg border border-gray-200 p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-600">
            Quality
          </h3>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={onlyComplete}
              onChange={(e) => setOnlyComplete(e.target.checked)}
            />
            Only show listings with price & image
          </label>
        </div>

        <div className="rounded-lg border border-gray-200 p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-600">
            Price
          </h3>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              placeholder="Min"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2 py-1"
            />
            <span className="text-gray-400">—</span>
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

        <div className="rounded-lg border border-gray-200 p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-600">
            Condition
          </h3>
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

        <div className="rounded-lg border border-gray-200 p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-600">
            Buying Options
          </h3>
          <div className="flex flex-col gap-2">
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

        <div className="rounded-lg border border-gray-200 p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-600">
            Advanced
          </h3>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showAdvanced}
              onChange={(e) => setShowAdvanced(e.target.checked)}
            />
            Show advanced options
          </label>

          {showAdvanced && (
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={groupMode}
                onChange={(e) => setGroupMode(e.target.checked)}
              />
              Group similar listings (model cards)
            </label>
          )}
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
          <span className="font-medium">
            {groupMode ? groups?.length ?? 0 : offers?.length ?? 0}
          </span>{" "}
          {groupMode ? "model groups" : "listings"}
          {typeof keptCount === "number" && typeof fetchedCount === "number" ? (
            <> from <span className="font-medium">{keptCount}</span> kept (fetched {fetchedCount}).</>
          ) : null}
        </div>
      )}

      {/* Analytics snapshot (server-provided or client fallback) */}
      <MarketSnapshot
        snapshot={apiData?.analytics?.snapshot || fallbackSnapshot}
        meta={apiData?.meta}
        query={q}
      />

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
              const n = nums.length;
              const med = n < 2 ? null : (n % 2 ? nums[Math.floor(n/2)] : (nums[n/2-1]+nums[n/2])/2);
              const bestDelta = (typeof g.bestPrice === "number" && typeof med === "number" && med - g.bestPrice > 0)
                ? { diff: med - g.bestPrice, pct: ((med - g.bestPrice)/med)*100 }
                : null;

              // Retailer range chip
              const spread = n ? `${formatPrice(nums[0])}–${formatPrice(nums[n-1])}` : "—";
              const isSelected = selected.find((x) => x.model === g.model);

              return (
                <article key={g.model} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
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
                      <div>
                        <h3 className="text-lg font-semibold leading-tight">{g.model}</h3>
                        <p className="mt-1 text-xs text-gray-500">
                          {g.count} offer{g.count === 1 ? "" : "s"} · {g.retailers.join(", ")}
                        </p>
                      </div>

                      <div className="flex flex-col items-end gap-1">
                        <div className="shrink-0 rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                          Best: {formatPrice(g.bestPrice, g.bestCurrency)}
                        </div>
                        <div className="rounded-full bg-gray-100 px-3 py-1 text-[11px] text-gray-700">
                          Range: {spread}
                        </div>
                        {bestDelta && (
                          <div
                            className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-medium text-emerald-700"
                            title={`Median ${formatPrice(med)} · Save ~${formatPrice(bestDelta.diff)} (~${bestDelta.pct.toFixed(0)}%)`}
                          >
                            Save {formatPrice(bestDelta.diff)} (~{bestDelta.pct.toFixed(0)}%)
                          </div>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => setExpanded((prev) => ({ ...prev, [g.model]: !prev[g.model] }))}
                      className="mt-4 w-full rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
                    >
                      {isOpen ? "Hide offers" : `View offers (${g.count})`}
                    </button>

                    {/* Add to Compare */}
                    <button
                      onClick={() => toggleSelect(g)}
                      className={`mt-2 w-full rounded-md border px-3 py-2 text-sm ${
                        isSelected ? "border-blue-300 bg-blue-50" : "hover:bg-gray-50"
                      }`}
                    >
                      {isSelected ? "Selected for Compare ✓" : "Add to Compare"}
                    </button>

                    {isOpen && (
                      <ul className="mt-3 space-y-2">
                        {ordered.slice(0, 10).map((o) => (
                          <li key={o.productId + o.url} className="flex items-center justify-between gap-3 rounded border border-gray-100 p-2">
                            <div className="flex min-w-0 items-center gap-2">
                              {retailerLogos[o.retailer] && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={retailerLogos[o.retailer]} alt={o.retailer} className="h-4 w-12 object-contain" />
                              )}
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium">{o.retailer}</div>
                                <div className="mt-0.5 truncate text-xs text-gray-500">
                                  {o.condition ? o.condition.replace(/_/g, " ") : "—"}
                                  {o.createdAt && (<> · listed {timeAgo(new Date(o.createdAt).getTime())}</>)}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-semibold">{formatPrice(o.price, o.currency)}</span>
                              <a
                                href={o.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                              >
                                View
                              </a>
                            </div>
                          </li>
                        ))}
                        {g.count > 10 && (
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
              ← Prev
            </button>
            <div className="text-sm text-gray-600">
              Page <span className="font-medium">{page}</span> · {FIXED_PER_PAGE} groups per page
            </div>
            <button
              disabled={!canNext}
              onClick={() => setPage((p) => p + 1)}
              className={`rounded-md border px-3 py-2 text-sm ${canNext ? "hover:bg-gray-100" : "cursor-not-allowed opacity-50"}`}
            >
              Next →
            </button>
          </div>
        </>
      )}

      {/* FLAT VIEW (advanced) */}
      {q.trim() && !loading && !err && !groupMode && showAdvanced && (
        <>
          <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {offers.map((o) => (
              <article key={o.productId + o.url} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
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
                    {o.condition ? o.condition.replace(/_/g, " ") : "—"}
                    {o.createdAt && (<> · listed {timeAgo(new Date(o.createdAt).getTime())}</>)}
                  </p>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-base font-semibold">{formatPrice(o.price, o.currency)}</span>
                    <a
                      href={o.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                    >
                      View
                    </a>
                  </div>
                </div>
              </article>
            ))}
          </section>

          {/* Pagination (flat) */}
          <div className="mt-8 flex items-center justify-between">
            <button
              disabled={!canPrev}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className={`rounded-md border px-3 py-2 text-sm ${canPrev ? "hover:bg-gray-100" : "cursor-not-allowed opacity-50"}`}
            >
              ← Prev
            </button>
            <div className="text-sm text-gray-600">
              Page <span className="font-medium">{page}</span> · {FIXED_PER_PAGE} listings per page
            </div>
            <button
              disabled={!canNext}
              onClick={() => setPage((p) => p + 1)}
              className={`rounded-md border px-3 py-2 text-sm ${canNext ? "hover:bg-gray-100" : "cursor-not-allowed opacity-50"}`}
            >
              Next →
            </button>
          </div>
        </>
      )}

      {/* Compare bar (pinned models) */}
      <CompareBar
        selectedGroups={selected}
        onClear={() => setSelected([])}
        onRemove={(model) => setSelected((prev) => prev.filter((g) => g.model !== model))}
      />
    </main>
  );
}
