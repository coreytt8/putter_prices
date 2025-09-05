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
  { label: "Most Offers", value: "count_desc" },
  { label: "A → Z (Model)", value: "model_asc" },
];

// Retailer legend
const RETAILER_LEGEND = [
  { name: "eBay", logo: "https://upload.wikimedia.org/wikipedia/commons/1/1b/EBay_logo.svg", href: "https://www.ebay.com" },
];

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

  // data
  const [groups, setGroups] = useState([]);
  const [ts, setTs] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // Build API URL
  const apiUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (onlyComplete) params.set("onlyComplete", "true");
    if (minPrice) params.set("minPrice", String(minPrice));
    if (maxPrice) params.set("maxPrice", String(maxPrice));
    if (selectedConds.length) params.set("conditions", selectedConds.join(","));
    if (selectedBuying.length) params.set("buyingOptions", selectedBuying.join(","));
    return `/api/putters?${params.toString()}`;
  }, [q, onlyComplete, minPrice, maxPrice, selectedConds, selectedBuying]);

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
          setTs(data.ts || null);
        }
      } catch (e) {
        if (!ignore) setErr("Failed to load results. Please try again.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }, 300);
    return () => {
      ignore = true;
      clearTimeout(t);
    };
  }, [apiUrl]);

  // Sort models (groups)
  const sortedGroups = useMemo(() => {
    const arr = [...groups];
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

  // Offer ordering per card, synced to sort selection
  const orderOffers = (offers) => {
    const list = [...offers];
    if (sortBy === "best_price_desc") {
      list.sort((a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity));
    } else {
      // default and best_price_asc: cheapest first
      list.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    }
    return list.slice(0, 5);
  };

  const toggleCond = (val) =>
    setSelectedConds((prev) => (prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val]));
  const toggleBuying = (val) =>
    setSelectedBuying((prev) => (prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val]));
  const clearAll = () => {
    setQ("");
    setOnlyComplete(true);
    setMinPrice("");
    setMaxPrice("");
    setSelectedConds([]);
    setSelectedBuying([]);
    setSortBy("best_price_asc");
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-3xl font-semibold tracking-tight">Compare Putter Prices</h1>
      <p className="mt-1 text-sm text-gray-500">
        Accurate keyword search, grouped by model, with <span className="font-medium">Best Price</span> highlighted.
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

      {/* Retailer Legend */}
      <section className="mt-4 rounded-lg border border-gray-200 bg-white px-3 py-3">
        <div className="flex flex-wrap items-center gap-4 overflow-x-auto whitespace-nowrap">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Comparing:</span>
          {RETAILER_LEGEND.map((r) => (
            <a
              key={r.name}
              href={r.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-md border border-gray-100 px-2 py-1 hover:bg-gray-50"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.logo} alt={`${r.name} logo`} className="h-4 w-12 object-contain" />
              <span className="text-xs text-gray-700">{r.name}</span>
            </a>
          ))}
        </div>
      </section>

      {/* Search + Sort */}
      <section className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
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

      {/* Results */}
      {loading && (
        <div className="mt-6 rounded-md border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-600">Loading grouped prices…</p>
        </div>
      )}
      {err && (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{err}</p>
        </div>
      )}

      {!loading && !err && (
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

                {/* Offers: order aligns with sort selection */}
                <ul className="mt-4 space-y-2">
                  {orderOffers(g.offers).map((o) => (
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
                        <div>
                          <div className="truncate text-sm font-medium">{o.retailer}</div>
                          <div className="mt-0.5 truncate text-xs text-gray-500">
                            {o.condition ? o.condition.replace(/_/g, " ") : "—"}
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
                </ul>

                {g.bestOffer?.url && (
                  <a
                    href={g.bestOffer.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 inline-flex w-full items-center justify-center rounded-md border border-green-600 px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-50"
                  >
                    Go to Best Price
                  </a>
                )}

                {ts && <p className="mt-3 text-right text-xs text-gray-400">Updated {timeAgo(ts)}</p>}
              </div>
            </article>
          ))}
        </section>
      )}

      {!loading && !err && sortedGroups.length === 0 && (
        <div className="mt-10 text-center text-sm text-gray-500">
          No results. Try refining your keywords or widening filters.
        </div>
      )}
    </main>
  );
}
