"use client";

import { useState } from "react";

export default function PuttersPage() {
  const [q, setQ] = useState("scotty cameron");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [errMsg, setErrMsg] = useState("");

  async function runSearch(e) {
    e.preventDefault();
    setErrMsg("");
    setLoading(true);
    try {
      const res = await fetch(`/api/putters?q=${encodeURIComponent(q)}`, {
        cache: "no-store",
      });
      const data = await res.json();

      // API returns { results: [...] } and may also include { error: "...", ... }
      if (Array.isArray(data.results)) {
        setItems(data.results);
      } else {
        setItems([]);
      }

      if (data.error) {
        // surface a friendly message but do NOT crash the UI
        setErrMsg(
          data.message ||
            data.details ||
            `Upstream error: ${data.error}${data.status ? ` (${data.status})` : ""}`
        );
      }
    } catch (err) {
      setErrMsg(String(err));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Putter Price Search</h1>

      <form onSubmit={runSearch} className="flex flex-wrap gap-3 mb-6">
        <input
          className="border rounded px-3 py-2 flex-1 min-w-[260px]"
          placeholder="Search (e.g., Scotty Cameron, Odyssey White Hot)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          className="rounded px-4 py-2 bg-black text-white"
          type="submit"
          disabled={loading}
        >
          {loading ? "Searching..." : "Search"}
        </button>
      </form>

      {errMsg && (
        <div className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errMsg}
        </div>
      )}

      {!loading && items.length === 0 && !errMsg && (
        <p className="text-gray-600">No results yet — try a search.</p>
      )}

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => {
          const priceNum =
            typeof it.price === "number" && Number.isFinite(it.price)
              ? it.price
              : null;
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
              <h3 className="font-medium line-clamp-2">
                {it.title || "Untitled listing"}
              </h3>
              <div className="mt-1 text-sm text-gray-600">
                {(it.condition || "Condition: —") +
                  " · " +
                  (it.location || "Location: —")}
              </div>
              <div className="mt-2 font-semibold">
                {priceNum !== null ? `${it.currency || "USD"} $${priceNum.toFixed(2)}` : "Price: —"}
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
