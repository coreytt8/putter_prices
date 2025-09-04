"use client";

import { useEffect, useState } from "react";

const PRESETS = [
  "Scotty Cameron",
  "Odyssey White Hot",
  "Ping Anser",
  "TaylorMade Spider",
  "Bettinardi"
];

export default function PuttersPage() {
  const [q, setQ] = useState("");           // was "scotty cameron"
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({});     // holds flags from API (cached, stale, cooldown, error, message, ts)

  // If URL has ?q=, prefill on first load but don't auto-call eBay until user submits
  useEffect(() => {
    const url = new URL(window.location.href);
    const qs = url.searchParams.get("q") || "";
    if (qs) setQ(qs);
  }, []);

  async function runSearch(e) {
    e?.preventDefault?.();
    if (!q.trim()) return;

    // Keep URL in sync with the search
    const url = new URL(window.location.href);
    url.searchParams.set("q", q.trim());
    history.replaceState({}, "", url.toString());

    setLoading(true);
    setMeta({});
    try {
      const res = await fetch(`/api/putters?q=${encodeURIComponent(q.trim())}`, { cache: "no-store" });
      const data = await res.json();

      setItems(Array.isArray(data.results) ? data.results : []);
      // Keep any helpful flags from the API
      const { cached, stale, cooldown, error, message, status, code, ts } = data;
      setMeta({ cached, stale, cooldown, error, message, status, code, ts });
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

      <form onSubmit={runSearch} className="flex flex-wrap gap-3 mb-3">
        <input
          className="border rounded px-3 py-2 flex-1 min-w-[260px]"
          placeholder="Search (e.g., 'Scotty Cameron', 'Odyssey White Hot')"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="rounded px-4 py-2 bg-black text-white disabled:opacity-60" type="submit" disabled={loading || !q.trim()}>
          {loading ? "Searching..." : "Search"}
        </button>
      </form>

      {/* Quick preset chips */}
      <div className="flex flex-wrap gap-2 mb-6">
        {PRESETS.map((p) => (
          <button
            key={p}
            className="text-sm border rounded-full px-3 py-1 hover:bg-gray-50"
            onClick={() => { setQ(p); }}
            type="button"
          >
            {p}
          </button>
        ))}
      </div>

      {/* Status / helper banners */}
      {meta.error && (
        <div className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {meta.message || `Upstream error: ${meta.error}${meta.status ? ` (${meta.status})` : ""}${meta.code ? ` [${meta.code}]` : ""}`}
          {meta.cooldown ? " · Cooling down to respect API limits." : ""}
        </div>
      )}
      {!meta.error && (meta.cached || meta.stale || meta.cooldown) && (
        <div className="mb-4 rounded border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          {meta.cached && "Served from cache. "}
          {meta.stale && "Showing stale results due to upstream limits. "}
          {meta.cooldown && "Temporarily cooling down after rate limit. "}
        </div>
      )}

      {!loading && items.length === 0 && !meta.error && (
        <p className="text-gray-600">No results yet — enter a query and press Search.</p>
      )}

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
