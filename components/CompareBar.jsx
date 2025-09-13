"use client";

function formatCurrency(n, currency = "USD") {
  if (typeof n !== "number") return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function computeStats(group) {
  const prices = (group?.offers || [])
    .map(o => (typeof o.price === "number" ? o.price : null))
    .filter(Boolean)
    .sort((a,b)=>a-b);
  const n = prices.length;
  const median = n ? (n % 2 ? prices[(n-1)/2] : (prices[n/2-1]+prices[n/2])/2) : null;
  const min = n ? prices[0] : null;
  const max = n ? prices[n-1] : null;
  return { min, median, max, count: n };
}

export default function CompareBar({ selectedGroups = [], onClear, onRemove }) {
  if (!selectedGroups.length) return null;

  return (
    <aside className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="mx-auto max-w-6xl px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-medium">
            Compare ({selectedGroups.length}) — side-by-side price stats
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
                <th className="whitespace-nowrap border-b p-2">Max</th>
                <th className="whitespace-nowrap border-b p-2">Offers</th>
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
                    <td className="border-b p-2">{formatCurrency(stats.max)}</td>
                    <td className="border-b p-2">{stats.count}</td>
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
          Tip: Pin 2–4 models to compare “Best vs Median” and spot deals quickly.
        </div>
      </div>
    </aside>
  );
}
