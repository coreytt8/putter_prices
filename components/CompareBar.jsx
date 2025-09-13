"use client";

function formatCurrency(n, currency = "USD") {
  if (typeof n !== "number") return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function timeAgo(iso) {
  if (!iso) return "—";
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "—";
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1m ago";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs === 1) return "1h ago";
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? "1d ago" : `${days}d ago`;
}

function computeStats(group) {
  const offers = Array.isArray(group?.offers) ? group.offers : [];
  const prices = offers
    .map(o => (typeof o.price === "number" ? o.price : null))
    .filter(Boolean)
    .sort((a,b)=>a-b);
  const n = prices.length;
  const median = n ? (n % 2 ? prices[(n-1)/2] : (prices[n/2-1]+prices[n/2])/2) : null;
  const min = n ? prices[0] : null;
  const max = n ? prices[n-1] : null;

  const condCounts = { NEW: 0, USED: 0, OTHER: 0 };
  let newestIso = null;
  const retailers = new Set();

  for (const o of offers) {
    // condition
    const c = (o?.condition || "").toString().toUpperCase();
    if (c.includes("NEW")) condCounts.NEW += 1;
    else if (c.includes("USED")) condCounts.USED += 1;
    else condCounts.OTHER += 1;

    // newest (most recent createdAt)
    if (o?.createdAt) {
      if (!newestIso || new Date(o.createdAt) > new Date(newestIso)) newestIso = o.createdAt;
    }

    // retailers
    if (o?.retailer) retailers.add(o.retailer);
  }

  const total = offers.length || 1;
  const pctNew = Math.round((condCounts.NEW / total) * 100);
  const pctUsed = Math.round((condCounts.USED / total) * 100);

  return {
    min, median, max,
    count: offers.length,
    range: (typeof min === "number" && typeof max === "number") ? `${formatCurrency(min)}–${formatCurrency(max)}` : "—",
    pctNew, pctUsed,
    newestIso,
    retailersCount: retailers.size,
  };
}

export default function CompareBar({ selectedGroups = [], onClear, onRemove }) {
  if (!selectedGroups.length) return null;

  return (
    <aside className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="mx-auto max-w-6xl px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-medium">
            Compare ({selectedGroups.length}) — price & market signals
          </div>
          <button
            onClick={onClear}
            className="text-sm text-blue-600 hover:underline"
          >
            Clear all
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-gray-600">
                <th className="whitespace-nowrap border-b p-2">Model</th>
                <th className="whitespace-nowrap border-b p-2">Best</th>
                <th className="whitespace-nowrap border-b p-2">Median</th>
                <th className="whitespace-nowrap border-b p-2">Range</th>
                <th className="whitespace-nowrap border-b p-2">Offers</th>
                <th className="whitespace-nowrap border-b p-2">New%</th>
                <th className="whitespace-nowrap border-b p-2">Used%</th>
                <th className="whitespace-nowrap border-b p-2">Newest</th>
                <th className="whitespace-nowrap border-b p-2">Retailers</th>
                <th className="whitespace-nowrap border-b p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {selectedGroups.map((g) => {
                const stats = computeStats(g);
                const save = (typeof g.bestPrice === "number" && typeof stats.median === "number")
                  ? stats.median - g.bestPrice
                  : null;

                return (
                  <tr key={g.model} className="align-top">
                    <td className="border-b p-2">
                      <div className="font-medium">{g.model}</div>
                      <div className="mt-1 text-xs text-gray-500">
                        {g.retailers?.join(", ") || "—"}
                      </div>
                    </td>

                    <td className="border-b p-2">
                      <div className="font-semibold">{formatCurrency(g.bestPrice, g.bestCurrency)}</div>
                      {save && save > 0 ? (
                        <div className="mt-1 inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                          Save {formatCurrency(save)}
                        </div>
                      ) : null}
                    </td>

                    <td className="border-b p-2">{formatCurrency(stats.median)}</td>
                    <td className="border-b p-2">{stats.range}</td>
                    <td className="border-b p-2">{stats.count}</td>
                    <td className="border-b p-2">{Number.isFinite(stats.pctNew) ? `${stats.pctNew}%` : "—"}</td>
                    <td className="border-b p-2">{Number.isFinite(stats.pctUsed) ? `${stats.pctUsed}%` : "—"}</td>
                    <td className="border-b p-2">{timeAgo(stats.newestIso)}</td>
                    <td className="border-b p-2">{stats.retailersCount || "—"}</td>

                    <td className="border-b p-2">
                      <button
                        onClick={() => onRemove(g.model)}
                        className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-2 text-xs text-gray-500">
          Tip: Look for **Best ≪ Median**, **fresh listings**, and **higher New%** when hunting deals.
        </div>
      </div>
    </aside>
  );
}
