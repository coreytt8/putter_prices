"use client";

import { useEffect, useState } from "react";

// Preset chips you requested
const PRESETS = ["Scotty Cameron", "Odyssey", "Ping", "TaylorMade", "Bettinardi", "L.A.B."];

// Optional keyword-based helpers (expand query for shape/hand)
const SHAPES = ["Mallet", "Blade"];
const HANDS = ["Right Hand", "Left Hand"];

// Normalize user text -> broader query (ensures "putter", handles simple shorthands)
function normalizeQuery(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  // Lowercase, strip most punctuation, collapse spaces
  let q = s.toLowerCase().replace(/[^a-z0-9\s.]/g, " ").replace(/\s+/g, " ").trim();

  // Simple shorthands
  const synonyms = {
    "lab": "lab",
    "l a b": "lab",
    "l.a.b.": "lab",
    "l.a.b": "lab",
    "tm": "taylormade",
    "scotty": "scotty cameron",
  };
  if (synonyms[q]) q = synonyms[q];

  // Always ensure "putter" is present to broaden
  if (!q.includes("putter")) q = `${q} putter`;

  return q;
}

export default function PuttersPage() {
  // Search + results
  const [q, setQ] = useState("");            // starts empty
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({});      // { cached, stale, cooldown, error, message, status, code, details, ts }

  // Filters
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [condNew, setCondNew] = useState(true);
  const [condUsed, setCondUsed] = useState(true);
  const [optFixed, setOptFixed] = useState(true);
  const [optAuction, setOptAuction] = useState(false);
  const [shape, setShape] = useState("");    // "Mallet" | "Blade" | ""
  const [hand, setHand] = useState("");      // "Right Hand" | "Left Hand" | ""

  // Prefill q from ?q= if present (no auto-fetch)
  useEffect(() => {
    const url = new URL(window.location.href);
    const qs = url.searchParams.get("q") || "";
    if (qs) setQ(qs);
  }, []);

  // Build querystring for the API
  function buildParams() {
    const params = new URLSearchParams();

    // Keyword — expand with optional shape/hand
    let norm = normalizeQuery(q);
    if (shape) norm = `${norm} ${shape.toLowerCase()} putter`;
    if (hand) norm = `${norm} ${hand.toLowerCase()}`;
    params.set("q", norm);

    // Price
    if (minPrice) params.set("minPrice", String(parseFloat(minPrice)));
    if (maxPrice) params.set("maxPrice", String(parseFloat(maxPrice)));

    // Conditions
    const conds = [];
    if (condNew) conds.push("NEW");
    if (condUsed) conds.push("USED");
    if (conds.length) params.set("conditions", conds.join(","));

    // Buying options
    const buys = [];
    if (optFixed) buys.push("FIXED_PRICE");
    if (optAuction) buys.push("AUCTION");
    if (buys.length) params.set("buyingOptions", buys.join(","));

    // (Optional) lock to Golf Putters category
    // params.set("categoryIds", "115280");

    return params;
  }

  async function runSearch(e) {
    e?.preventDefault?.();
    if (!q.trim()) return;

    const params = buildParams();

    // Keep URL in sync (shareable)
    const url = new URL(window.location.href);
    url.searchParams.set("q", params.get("q") || "");
    history.replaceState({}, "", url.toString());

    setLoading(true);
    setMeta({});
    try {
      const res = await fetch(`/api/putters?${params.toString()}`, { cache: "no-store" });
      const data = await res.json();
      setItems(Array.isArray(data.results) ? data.results : []);
      const { cached, stale, cooldown, error, message, status, code, ts, details } = data;
      setMeta({ cached, stale, cooldown, error, message, status, code, ts, details });
    } catch (err) {
      setItems([]);
      setMeta({ error: "client_exception", message: String(err) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Putter Price Search</h1>

      {/* Search + submit */}
      <form onSubmit={runSearch} className="flex flex-wrap gap-3 mb-3">
        <input
          className="border rounded px-3 py-2 flex-1 min-w-[260px]"
          placeholder="Search (e.g., 'Scotty Cameron', 'Odyssey', 'Ping', 'LAB')"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          className="rounded px-4 py-2 bg-black text-white disabled:opacity-60"
          type="submit"
          disabled={loading || !q.trim()}
        >
          {loading ? "Searching..." : "Search"}
        </button>
      </form>

      {/* Preset brand chips */}
      <div className="flex flex-wrap gap-2 mb-4">
        {PRESETS.map((p) => (
          <button
            key={p}
            className="text-sm border rounded-full px-3 py-1 hover:bg-gray-50"
            type="button"
            onClick={() => { setQ(p); setTimeout(() => runSearch(), 0); }}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Filters */}
      <section className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* Price */}
        <div className="border rounded p-3">
          <div className="font-medium mb-2">Price</div>
          <div className="flex gap-2">
            <input
              className="border rounded px-2 py-1 w-24"
              type="number"
              min="0"
              placeholder="Min"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
            />
            <input
              className="border rounded px-2 py-1 w-24"
              type="number"
              min="0"
              placeholder="Max"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
            />
          </div>
        </div>

        {/* Condition */}
        <div className="border rounded p-3">
          <div className="font-medium mb-2">Condition</div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={condNew} onChange={(e) => setCondNew(e.target.checked)} />
            New
          </label>
          <label className="flex items-center gap-2 mt-1">
            <input type="checkbox" checked={condUsed} onChange={(e) => setCondUsed(e.target.checked)} />
            Used
          </label>
        </div>

        {/* Buying Options */}
        <div className="border rounded p-3">
          <div className="font-medium mb-2">Buying Options</div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={optFixed} onChange={(e) => setOptFixed(e.target.checked)} />
            Buy It Now (Fixed Price)
          </label>
          <label className="flex items-center gap-2 mt-1">
            <input type="checkbox" checked={optAuction} onChange={(e) => setOptAuction(e.target.checked)} />
            Auction
          </label>
        </div>

        {/* Head Shape (keyword-based) */}
        <div className="border rounded p-3">
          <div className="font-medium mb-2">Head Shape</div>
          <div className="flex gap-2 flex-wrap">
            {SHAPES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setShape((prev) => (prev === s ? "" : s))}
                className={`text-sm border rounded-full px-3 py-1 ${shape === s ? "bg-gray-900 text-white" : "hover:bg-gray-50"}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Handedness (keyword-based) */}
        <div className="border rounded p-3">
          <div className="font-medium mb-2">Handedness</div>
          <div className="flex gap-2 flex-wrap">
            {HANDS.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHand((prev) => (prev === h ? "" : h))}
                className={`text-sm border rounded-full px-3 py-1 ${hand === h ? "bg-gray-900 text-white" : "hover:bg-gray-50"}`}
              >
                {h}
              </button>
            ))}
          </div>
        </div>

        {/* Apply */}
        <div className="border rounded p-3 flex items-end">
          <button
            onClick={() => runSearch()}
            type="button"
            className="rounded px-4 py-2 bg-blue-600 text-white hover:bg-blue-700"
            disabled={loading || !q.trim()}
          >
            Apply Filters
          </button>
        </div>
      </section>

      {/* Status banners */}
      {meta.error && (
        <div className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {meta.message || `Upstream error: ${meta.error}${meta.status ? ` (${meta.status})` : ""}`}
          {meta.code ? ` [${meta.code}]` : ""}
          {meta.details ? ` · ${String(meta.details).slice(0, 160)}…` : ""}
          {meta.cooldown ? " · Cooling down to respect API limits." : ""}
        </div>
      )}
      {!meta.error && (meta.cached || meta.stale || meta.cooldown) && (
        <div className="mb-3 rounded border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          {meta.cached && "Served from cache. "}
          {meta.stale && "Showing stale results due to upstream limits. "}
          {meta.cooldown && "Temporarily cooling down after rate limit. "}
          {meta.ts ? `· ${new Date(meta.ts).toLocaleTimeString()}` : ""}
        </div>
      )}

      {!loading && items.length === 0 && !meta.error && (
        <p className="text-gray-600">No results yet — enter a keyword and press Search.</p>
      )}

      {/* Results */}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => {
          const priceOk = typeof it.price === "number" && Number.isFinite(it.price);
          return (
            <li key={it.id || `${it.title}-${Math.random()}`} className="border rounded-lg p-3 flex flex-col">
              {it.image && (
                <img
                  src={it.image}
                  alt={it.title || "Putter"}
                  className="w-full h-40 object-contain mb-2"
                  loading="lazy"
                />
              )}
              <h3 className="font-medium line-clamp-2">{it.title || "Untitled listing"}</h3>
              <div className="mt-1 text-sm text-gray-600">
                {(it.condition || "Condition: —") + " · " + (it.location || "Location: —")}
              </div>
              <div className="mt-2 font-semibold">
                {priceOk ? `${it.currency || "USD"} $${it.price.toFixed(2)}` : "Price: —"}
              </div>
              {it.url && (
                <a
                  className="mt-3 inline-flex items-center justify-center rounded bg-blue-600 text-white px-3 py-2 hover:bg-blue-700"
                  href={it.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View on eBay
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
