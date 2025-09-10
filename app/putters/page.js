"use client";

import { useEffect, useMemo, useState } from "react";

/* ---------- Quick brand shortcuts ---------- */
const BRANDS = [
  { label: "Scotty Cameron", q: "scotty cameron putter" },
  { label: "TaylorMade", q: "taylormade putter" },
  { label: "Ping", q: "ping putter" },
  { label: "Odyssey", q: "odyssey putter" },
  { label: "L.A.B.", q: "lab golf putter" },
];

/* ---------- Filters / sort options ---------- */
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
  { label: "Recently listed", value: "recent" }, // server asks eBay for newly listed
  { label: "Most Offers", value: "count_desc" },
  { label: "A → Z (Model)", value: "model_asc" },
];

const PAGE_SIZES = [12, 24, 48, 72, 100];

const retailerLogos = {
  eBay: "https://upload.wikimedia.org/wikipedia/commons/1/1b/EBay_logo.svg",
};

/* ---------- Helpers ---------- */
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

function medianPrice(offers = []) {
  const nums = offers.map(o => o?.price).filter(x => typeof x === "number").sort((a,b)=>a-b);
  const n = nums.length;
  if (n < 2) return null; // don’t show delta when only one priced offer
  const mid = Math.floor(n / 2);
  return n % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function bestDealDelta(bestPrice, median) {
  if (typeof bestPrice !== "number" || typeof median !== "number") return null;
  const diff = median - bestPrice; // savings vs median
  if (diff <= 0) return null;
  const pct = (diff / median) * 100;
  return { diff, pct };
}

/* ---------- Component ---------- */
export default function PuttersPage() {
  // Core filters
  const [q, setQ] = useState("");             // no default -> no prefilled results
  const [onlyComplete, setOnlyComplete] = useState(true);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [conds, setConds] = useState([]);
  const [buying, setBuying] = useState([]);

  // Presentation
  const [groupMode, setGroupMode] = useState(true); // default: GROUPED
  const [showAdvanced, setShowAdvanced] = useState(false); // hide flat toggle behind this
  const [sortBy, setSortBy] = useState("best_price_asc");

  // Pagination
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(24); // “Groups per page” by default

  // Data
  const [groups, setGroups] = useState([]);
  const [offers, setOffers] = useState([]); // used when groupMode = false (Advanced)
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [hasNext, setHasNext] = useState(false);
  const [hasPrev, setHasPrev] = useState(false);
  const [fetchedCount, setFetchedCount] = useState(null);
  const [keptCount, setKeptCount] = useState(null);

  // Collapsed/expanded state for group cards
  const [expanded, setExpanded] = useState({}); // { [model]: boolean }

  /* ---------- Build API URL ---------- */
  const apiUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (onlyComplete) params.set("onlyComplete", "true");
    if (minPrice) params.set("minPrice", String(minPrice));
    if (maxPrice) params.set("maxPrice", String(maxPrice));
    if (conds.length) params.set("conditions", conds.join(","));
    if (buying.length) params.set("buyingOptions", buying.join(","));
    if (sortBy === "recent") params.set("sort", "newlylisted"); // upstream sort
    params.set("page", String(page));
    params.set("perPage", String(perPage));
    params.set("group", groupMode ? "true" : "false");
    return `/api/putters?${params.toString()}`;
  }, [q, onlyComplete, minPrice, maxPrice, conds, buying, sortBy, page, perPage, groupMode]);

  // Reset paging when major inputs change
  useEffect(() => {
    setPage(1);
  }, [q, onlyComplete, minPrice, maxPrice, conds, buying, sortBy, perPage, groupMode]);

  // Fetch (only when there’s a query)
  useEffect(() => {
    if (!q.trim()) {
      setGroups([]);
      setOffers([]);
      setHasNext(false);
      setHasPrev(false);
      setFetchedCount(null);
      setKeptCount(null);
      setErr("");
      return;
    }

    let ignore = false;
    const t = setTimeout(async () => {
      setLoading(true);
      setErr("");
      try {
        const res = await fetch(apiUrl, { cache: "no-store" });
        const data = await res.json();
        if (!ignore) {
          setGroups(Array.isArray(data.groups) ? data.groups : []);
          let pageOffers = Array.isArray(data.offers) ? data.offers : [];
          // Flat mode gets client-side price sort for consistency
          if (!groupMode && pageOffers.length) {
            if (sortBy === "best_price_asc") {
              pageOffers = [...pageOffers].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
            } else if (sortBy === "best_price_desc") {
              pageOffers = [...pageOffers].sort((a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity));
            }
          }
          setOffers(pageOffers);

          setHasNext(Boolean(data.hasNext));
          setHasPrev(Boolean(data.hasPrev));
          setFetchedCount(typeof data.fetchedCount === "number" ? data.fetchedCount : null);
          setKeptCount(typeof data.keptCount === "number" ? data.keptCount : null);
        }
      } catch {
        if (!ignore) setErr("Failed to load results. Please try again.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }, 200);

    return () => {
      ignore = true;
      clearTimeout(t);
    };
  }, [apiUrl, groupMode, sortBy, q]);

  // Sort groups in-memory (best price / A→Z / most offers)
  const sortedGroups = useMemo(() => {
    const arr = [...groups];
    if (sortBy === "recent") return arr; // server already requested newly listed
    if (sortBy === "best_price_asc") {
      arr.sort((a, b) => (a.bestPrice ?? Infinity) - (b.bestPrice ?? Infinity));
    } else if (sortBy === "best_price_desc") {
      arr.sort((a, b) => (b.bestPrice ?? -Infinity) - (a.bestPrice ?? -Infinity));
    } else if (sortBy === "count_desc") {
      arr.sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
    } else if (sortBy === "model_asc") {
      arr.sort((a, b) => (a.model || "").localeCompare(b.model || ""));
    }
    return arr;
  }, [groups, sortBy]);

  // Reset expansions on new results
  useEffect(() => {
    const next = {};
    sortedGroups.forEach((g) => {
      next[g.model] = false;
    });
    setExpanded(next);
  }, [sortedGroups.map((g) => g.model).join("|")]); // re-run if model list changes

  const toggleExpand = (model) => {
    setExpanded((prev) => ({ ...prev, [model]: !prev[model] }));
  };

  const clearAll = () => {
    setQ("");
    setOnlyComplete(true);
    setMinPrice("");
    setMaxPrice("");
    setConds([]);
    setBuying([]);
    setSortBy("best_price_asc");
    setPerPage(24);
    setGroupMode(true);
    setPage(1);
  };

  const canPrev = hasPrev && page > 1 && !loading;
  const canNext = hasNext && !loading;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      {/* Header */}
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
            <span className="font-medium">{perPage}</span>{" "}
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

      {/* Controls row */}
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

        <div>
          <label className="mb-1 block text-sm font-medium">Groups per page</label>
          <select
            value={perPage}
            onChange={(e) => setPerPage(parseInt(e.target.value, 10))}
            className="w-full rounded-md border border-gray-300 px-3 py-2"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
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
                      prev.includes(c.value) ? prev.filter((v) => v !== c.value) : [...prev, c.value]
                    )
                  }
                />
                {c.label}
              </label>
            ))}
          </div>
        </div>

        {/* Buying options */}
        <div className="rounded-lg border border-gray-200 p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-600">Buying Options</h3>
          <div className="flex flex-col gap-2">
            {BUYING_OPTIONS.map((b) => (
              <label key={b.value} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={buying.includes(b.value)}
                  onChange={() =>
                    setBuying((prev) =>
                      prev.includes(b.value) ? prev.filter((v) => v !== b.value) : [...prev, b.value]
                    )
                  }
                />
                {b.label}
              </label>
            ))}
          </div>
        </div>

        {/* Advanced (flat list toggle tucked away) */}
        <div className="rounded-lg border border-gray-200 p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-600">Advanced</h3>
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

      {/* Empty state */}
      {!q.trim() && (
        <div className="mt-8 rounded-md border border-gray-200 bg-white p-6 text-center text-sm text-gray-600">
          Start by typing a putter model or choose a brand above to see grouped price comparisons.
        </div>
      )}

      {/* Summary */}
      {q.trim() && !loading && !err && (
        <div className="mt-2 text-sm text-gray-600">
          Showing <span className="font-medium">{groupMode ? (groups?.length ?? 0) : (offers?.length ?? 0)}</span>{" "}
          {groupMode ? "model groups" : "listings"}
          {typeof keptCount === "number" && typeof fetchedCount === "number" ? (
            <> from <span className="font-medium">{keptCount}</span> kept (fetched {fetchedCount}).</>
          ) : null}
        </div>
      )}

      {/* Loading / Error */}
      {q.trim() && loading && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-2">
          {Array.from({ length: Math.min(perPage, 6) }).map((_, i) => (
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

      {/* GROUPED VIEW (primary) */}
      {q.trim() && !loading && !err && groupMode && (
        <>
          <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-2">
            {sortedGroups.map((g) => {
              const isOpen = !!expanded[g.model];
              // Order the offers shown in the expandable list to match sort
              const ordered =
                sortBy === "best_price_desc"
                  ? [...g.offers].sort((a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity))
                  : [...g.offers].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));

              // Best deal delta vs group median
              const med = medianPrice(ordered);
              const bestDelta = bestDealDelta(g.bestPrice, med);

              return (
                <article
                  key={g.model}
                  className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
                >
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
                        {bestDelta && (
                          <div
                            className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-medium text-emerald-700"
                            title={`Median ${formatPrice(med)} · You save ~${formatPrice(bestDelta.diff)} (~${bestDelta.pct.toFixed(0)}%) vs median`}
                          >
                            Save {formatPrice(bestDelta.diff)} (~{bestDelta.pct.toFixed(0)}% vs median)
                          </div>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => toggleExpand(g.model)}
                      className="mt-4 w-full rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
                    >
                      {isOpen ? "Hide offers" : `View offers (${g.count})`}
                    </button>

                    {isOpen && (
                      <ul className="mt-3 space-y-2">
                        {ordered.slice(0, 10).map((o) => (
                          <li
                            key={o.productId + o.url}
                            className="flex items-center justify-between gap-3 rounded border border-gray-100 p-2"
                          >
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
                                <div className="truncate text-sm font-medium">{o.retailer}</div>
                                <div className="mt-0.5 truncate text-xs text-gray-500">
                                  {o.condition ? o.condition.replace(/_/g, " ") : "—"}
                                  {o.createdAt && (
                                    <> · listed {timeAgo(new Date(o.createdAt).getTime())}</>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-semibold">
                                {formatPrice(o.price, o.currency)}
                              </span>
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

          {/* Pagination */}
          <div className="mt-8 flex items-center justify-between">
            <button
              disabled={!canPrev}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className={`rounded-md border px-3 py-2 text-sm ${
                canPrev ? "hover:bg-gray-100" : "cursor-not-allowed opacity-50"
              }`}
            >
              ← Prev
            </button>
            <div className="text-sm text-gray-600">
              Page <span className="font-medium">{page}</span> · {perPage} groups per page
            </div>
            <button
              disabled={!canNext}
              onClick={() => setPage((p) => p + 1))}
              className={`rounded-md border px-3 py-2 text-sm ${
                canNext ? "hover:bg-gray-100" : "cursor-not-allowed opacity-50"
              }`}
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
              <article
                key={o.productId + o.url}
                className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
              >
                <div className="relative aspect-[4/3] w-full bg-gray-50">
                  {o.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={o.image} alt={o.title} className="h-full w-full object-contain" loading="lazy" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-gray-400">
                      No image
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <h3 className="line-clamp-2 text-sm font-semibold">{o.title}</h3>
                  <p className="mt-1 text-xs text-gray-500">
                    {o.condition ? o.condition.replace(/_/g, " ") : "—"}
                    {o.createdAt && <> · listed {timeAgo(new Date(o.createdAt).getTime())}</>}
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

          {/* Pagination */}
          <div className="mt-8 flex items-center justify-between">
            <button
              disabled={!canPrev}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className={`rounded-md border px-3 py-2 text-sm ${
                canPrev ? "hover:bg-gray-100" : "cursor-not-allowed opacity-50"
              }`}
            >
              ← Prev
            </button>
            <div className="text-sm text-gray-600">
              Page <span className="font-medium">{page}</span> · {perPage} listings per page
            </div>
            <button
              disabled={!canNext}
              onClick={() => setPage((p) => p + 1))}
              className={`rounded-md border px-3 py-2 text-sm ${
                canNext ? "hover:bg-gray-100" : "cursor-not-allowed opacity-50"
              }`}
            >
              Next →
            </button>
          </div>
        </>
      )}
    </main>
  );
}
