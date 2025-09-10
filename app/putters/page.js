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
  { label: "Recently listed", value: "recent" },
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
  if (n < 2) return null;
  const mid = Math.floor(n / 2);
  return n % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function bestDealDelta(bestPrice, median) {
  if (typeof bestPrice !== "number" || typeof median !== "number") return null;
  const diff = median - bestPrice;
  if (diff <= 0) return null;
  const pct = (diff / median) * 100;
  return { diff, pct };
}

/* ---------- Component ---------- */
export default function PuttersPage() {
  const [q, setQ] = useState("");
  const [onlyComplete, setOnlyComplete] = useState(true);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [conds, setConds] = useState([]);
  const [buying, setBuying] = useState([]);

  const [groupMode, setGroupMode] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [sortBy, setSortBy] = useState("best_price_asc");

  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(24);

  const [groups, setGroups] = useState([]);
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [hasNext, setHasNext] = useState(false);
  const [hasPrev, setHasPrev] = useState(false);
  const [fetchedCount, setFetchedCount] = useState(null);
  const [keptCount, setKeptCount] = useState(null);

  const [expanded, setExpanded] = useState({});

  /* ---------- Build API URL ---------- */
  const apiUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (onlyComplete) params.set("onlyComplete", "true");
    if (minPrice) params.set("minPrice", String(minPrice));
    if (maxPrice) params.set("maxPrice", String(maxPrice));
    if (conds.length) params.set("conditions", conds.join(","));
    if (buying.length) params.set("buyingOptions", buying.join(","));
    if (sortBy === "recent") params.set("sort", "newlylisted");
    params.set("page", String(page));
    params.set("perPage", String(perPage));
    params.set("group", groupMode ? "true" : "false");
    return `/api/putters?${params.toString()}`;
  }, [q, onlyComplete, minPrice, maxPrice, conds, buying, sortBy, page, perPage, groupMode]);

  // ... (unchanged code for fetching, sorting, rendering offers/groups) ...

  const canPrev = hasPrev && page > 1 && !loading;
  const canNext = hasNext && !loading;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      {/* ... header + filters ... */}

      {/* Pagination (Grouped view) */}
      <div className="mt-8 flex items-center justify-between">
        <button
          disabled={!canPrev}
          onClick={() => setPage(p => Math.max(1, p - 1))}
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
          onClick={() => setPage(p => p + 1)}
          className={`rounded-md border px-3 py-2 text-sm ${
            canNext ? "hover:bg-gray-100" : "cursor-not-allowed opacity-50"
          }`}
        >
          Next →
        </button>
      </div>

      {/* Pagination (Flat view, similar fix) */}
      <div className="mt-8 flex items-center justify-between">
        <button
          disabled={!canPrev}
          onClick={() => setPage(p => Math.max(1, p - 1))}
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
          onClick={() => setPage(p => p + 1)}
          className={`rounded-md border px-3 py-2 text-sm ${
            canNext ? "hover:bg-gray-100" : "cursor-not-allowed opacity-50"
          }`}
        >
          Next →
        </button>
      </div>
    </main>
  );
}
