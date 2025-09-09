"use client";

import { useEffect, useMemo, useState } from "react";

// Brand quick filters
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
  { label: "Recently listed", value: "recent" },
  { label: "Most Offers", value: "count_desc" },
  { label: "A → Z (Model)", value: "model_asc" },
];

const PAGE_SIZES = [24, 48, 72, 100];

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

export default function PuttersPage() {
  // filters
  const [q, setQ] = useState("");
  const [onlyComplete, setOnlyComplete] = useState(true);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [selectedConds, setSelectedConds] = useState([]);
  const [selectedBuying, setSelectedBuying] = useState([]);
  const [sortBy, setSortBy] = useState("best_price_asc");
  const [groupMode, setGroupMode] = useState(true); // NEW: toggle

  // pagination
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(72);

  // data
  const [groups, setGroups] = useState([]);
  const [offers, setOffers] = useState([]); // NEW: flat list
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [hasNext, setHasNext] = useState(false);
  const [hasPrev, setHasPrev] = useState(false);
  const [fetchedCount, setFetchedCount] = useState(null);
  const [keptCount, setKeptCount] = useState(null);

  // Build API URL
  const apiUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (onlyComplete) params.set("onlyComplete", "true");
    if (minPrice) params.set("minPrice", String(minPrice));
    if (maxPrice) params.set("maxPrice", String(maxPrice));
    if (selectedConds.length) params.set("conditions", selectedConds.join(","));
    if (selectedBuying.length) params.set("buyingOptions", selectedBuying.join(","));
    if (sortBy === "recent") params.set("sort", "newlylisted");
    params.set("page", String(page));
    params.set("perPage", String(perPage));
    params.set("group", groupMode ? "true" : "false"); // NEW
    return `/api/putters?${params.toString()}`;
  }, [q, onlyComplete, minPrice, maxPrice, selectedConds, selectedBuying, sortBy, page, perPage, groupMode]);

  // Reset to page 1 on filter/sort/perPage/group change
  useEffect(() => {
    setPage(1);
  }, [q, onlyComplete, minPrice, maxPrice, selectedConds, selectedBuying, sortBy, perPage, groupMode]);

  // Fetch
  useEffect(() => {
    let ignore = false;
    const t = setTimeout(async () => {
      setLoading(true);
      setErr("");
      try {
        const res = await fetch(apiUrl, { cache: "no-store" });
        const data = await res.json();
        if (!ignore) {
          setGroups(Array.isArray(data.groups) ? data.groups : []);
          setOffers(Array.isArray(data.offers) ? data.offers : []);
          setHasNext(Boolean(data.hasNext));
          setHasPrev(Boolean(data.hasPrev));
          setFetchedCount(typeof data.fetchedCount === "number" ? data.fetchedCount : null);
          setKeptCount(typeof data.keptCount === "number" ? data.keptCount : null);
        }
      } catch (e) {
        if (!ignore) setErr("Failed to load results. Please try again.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }, 250);
    return () => {
      ignore = true;
      clearTimeout(t);
    };
  }, [apiUrl]);

  // Sort (grouped view only; flat view uses upstream order)
  const sortedGroups = useMemo(() => {
    const arr = [...groups];
    if (sortBy === "recent") return arr; // Browse already sorts
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

  // Offer ordering inside each group card
  const orderOffers = (offers) => {
    const list = [...offers];
    if (sortBy === "best_price_desc") list.sort((a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity));
    else list.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    return list.slice(0, 5);
    // (show top 5 offers per model card)
  };

  const clearAll = () => {
    setQ("");
    setOnlyComplete(true);
    setMinPrice("");
    setMaxPrice("");
    setSelectedConds([]);
    setSelectedBuying([]);
    setSortBy("best_price_asc");
    setPerPage(72);
    setGroupMode(true);
    setPage(1);
  };

  const canPrev = hasPrev && page > 1 && !loading;
  const canNext = hasNext && !loading;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-3xl font-semibold tracking-tight">Compare Putter Prices</h1>
      <p className="mt-1 text-sm text-gray-500">
        Toggle <span className="font-medium">Group similar listings</span> to switch between model cards and a flat list.
      </p>

      {/* Brand quick filters */}
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
      <section className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-5">
        <div className="sm:col-span-2">
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
          <label className="mb-1 block text-sm font-medium">
            {groupMode ? "Groups per page" : "Listings per page"}
          </label>
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

        <div className="flex items-end gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={groupMode}
              onChange={(e) => setGroupMode(e.target.checked)}
            />
            Group similar listings
          </label>
        </div>
      </section>

      {/* Filters */}
      <section className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-5">
        {/* Quality toggle */}
        <div className="rounded-lg border border-gray-200 p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-600">Quality</h3>
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
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-600">Price</h3>
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
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-600">Condition</h3>
          <div className="flex flex-col gap-2">
            {CONDITION_OPTIONS.map((c) => (
              <label key={c.value} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedConds.includes(c.value)}
                  onChange={() =>
                    setSelectedConds((prev) =>
                      prev.includes(c.value) ? prev.filter((v) => v !== c.value) : [...prev, c.value]
                    )
                  }
                />
                {c.label}
              </label>
            ))}
          </div>
        </div>

        {/* Buying Options */}
        <div className="rounded-lg border border-gray-200 p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-600">Buying Options</h3>
          <div className="flex flex-col gap-2">
            {BUYING_OPTIONS.map((b) => (
              <label key={b.value} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedBuying.includes(b.value)}
                  onChange={() =>
                    setSelectedBuying((prev) =>
                      prev.includes(b.value) ? prev.filter((v) => v !== b.value) : [...prev, b.value]
                    )
                  }
                />
                {b.label}
              </label>
            ))}
          </div>
        </div>

        {/* Reset */}
        <div className="flex items-end gap-2">
          <button
            onClick={clearAll}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-100"
          >
            Clear filters
          </button>
        </div>
      </section>

      {/* Counts summary */}
      {!loading && !err && (
        <div className="mt-2 text-sm text-gray-600">
          {typeof keptCount === "number" && typeof fetchedCount === "number" ? (
            <>
              Showing{" "}
              <span className="font-medium">
                {groupMode ? (groups?.length ?? 0) : (offers?.length ?? 0)}
              </span>{" "}
              {groupMode ? "model groups" : "listings"} from{" "}
              <span className="font-medium">{keptCount}</span> kept (fetched {fetchedCount}).
            </>
          ) : (
            <>
              Showing{" "}
              <span className="font-medium">
                {groupMode ? (groups?.length ?? 0) : (offers?.length ?? 0)}
              </span>{" "}
              {groupMode ? "model groups" : "listings"}.
            </>
          )}
        </div>
      )}

      {/* Loading / Error */}
      {loading && (
        <div className="mt-6 rounded-md border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-600">Loading results…</p>
        </div>
      )}
      {err && (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{err}</p>
        </div>
      )}

      {/* Grouped view */}
      {!loading && !err && groupMode && (
        <>
          <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-2">
            {sortedGroups.map((g) => (
              <article key={g.model} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                <div className="relative aspect-[4/3] w-full max-h-48 bg-gray-100">
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
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-lg font-semibold leading-tight">{g.model}</h3>
                    <div className="shrink-0 rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                      Best: {formatPrice(g.bestPrice, g.bestCurrency)}
                    </div>
                  </div>

                  <p className="mt-1 text-xs text-gray-500">
                    {g.count} offer{g.count === 1 ? "" : "s"} · {g.retailers.join(", ")}
                  </p>

                  <ul className="mt-4 space-y-2">
                    {([...g.offers]
                      .sort((a,b)=> (sortBy==="best_price_desc" ? (b.price ?? -Infinity)-(a.price ?? -Infinity) : (a.price ?? Infinity)-(b.price ?? Infinity)))
                      .slice(0,5)).map((o) => (
                      <li key={o.productId + o.url} className="flex items-center justify-between gap-3 rounded border border-gray-100 p-2">
                        <div className="flex min-w-0 items-center gap-2">
                          {retailerLogos[o.retailer] && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={retailerLogos[o.retailer]} alt={o.retailer} className="h-4 w-12 object-contain" />
                          )}
                          <div>
                            <div className="truncate text-sm font-medium">{o.retailer}</div>
                            <div className="mt-0.5 truncate text-xs text-gray-500">
                              {o.condition ? o.condition.replace(/_/g, " ") : "—"}
                              {o.createdAt && <> · listed {timeAgo(new Date(o.createdAt).getTime())}</>}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold">{formatPrice(o.price, o.currency)}</span>
                          <a href={o.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
                            View
                          </a>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            ))}
          </section>

          {/* Pagination */}
          <div className="mt-8 flex items-center justify-between">
            <button disabled={!canPrev} onClick={() => setPage((p) => Math.max(1, p - 1))} className={`rounded-md border px-3 py-2 text-sm ${canPrev ? "hover:bg-gray-100" : "opacity-50 cursor-not-allowed"}`}>
              ← Prev
            </button>
            <div className="text-sm text-gray-600">Page <span className="font-medium">{page}</span> · {perPage} per page</div>
            <button disabled={!canNext} onClick={() => setPage((p) => p + 1)} className={`rounded-md border px-3 py-2 text-sm ${canNext ? "hover:bg-gray-100" : "opacity-50 cursor-not-allowed"}`}>
              Next →
            </button>
          </div>
        </>
      )}

      {/* Flat list view */}
      {!loading && !err && !groupMode && (
        <>
          <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {offers.map((o) => (
              <article key={o.productId + o.url} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                <div className="relative aspect-[4/3] w-full bg-gray-100">
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
                    {o.createdAt && <> · listed {timeAgo(new Date(o.createdAt).getTime())}</>}
                  </p>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-base font-semibold">{formatPrice(o.price, o.currency)}</span>
                    <a href={o.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
                      View
                    </a>
                  </div>
                </div>
              </article>
            ))}
          </section>

          {/* Pagination */}
          <div className="mt-8 flex items-center justify-between">
            <button disabled={!canPrev} onClick={() => setPage((p) => Math.max(1, p - 1))} className={`rounded-md border px-3 py-2 text-sm ${canPrev ? "hover:bg-gray-100" : "opacity-50 cursor-not-allowed"}`}>
              ← Prev
            </button>
            <div className="text-sm text-gray-600">Page <span className="font-medium">{page}</span> · {perPage} per page</div>
            <button disabled={!canNext} onClick={() => setPage((p) => p + 1)} className={`rounded-md border px-3 py-2 text-sm ${canNext ? "hover:bg-gray-100" : "opacity-50 cursor-not-allowed"}`}>
              Next →
            </button>
          </div>
        </>
      )}

      {/* Empty state */}
      {!loading && !err && ((groupMode && (groups?.length ?? 0) === 0) || (!groupMode && (offers?.length ?? 0) === 0)) && (
        <div className="mt-10 text-center text-sm text-gray-500">No results. Try refining your keywords or widening filters.</div>
      )}
    </main>
  );
}
