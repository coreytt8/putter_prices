"use client";

import ModelHistoryChart from "./ModelHistoryChart";

function pickString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function extractModelKey(snapshot, meta) {
  return pickString(
    meta?.modelKey,
    meta?.model?.key,
    meta?.model?.modelKey,
    meta?.requested?.modelKey,
    meta?.requested?.model?.key,
    meta?.resolved?.modelKey,
    meta?.resolved?.model?.key,
    meta?.segment?.modelKey,
    meta?.segment?.requested?.modelKey,
    meta?.segment?.resolved?.modelKey,
    meta?.segment?.actual?.modelKey,
    meta?.segment?.resolved?.model?.key,
    snapshot?.context?.modelKey,
    snapshot?.context?.model?.key,
    snapshot?.modelKey,
    snapshot?.model?.key
  );
}

function formatCurrency(n, currency = "USD") {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export default function MarketSnapshot({ snapshot, meta, query }) {
  if (!snapshot || !snapshot.price) return null;

  const { price, conditions = [], buyingOptions = [], brandsTop = [] } = snapshot;
  const hasHistogram = Array.isArray(price.histogram) && price.histogram.length > 0;
  const sampleSize = hasHistogram ? price.histogram.reduce((a, b) => a + (b || 0), 0) : null;
  const modelKey = extractModelKey(snapshot, meta);

  const bucketLabels = (() => {
    if (!hasHistogram) return [];
    const buckets = price.buckets || [];
    const labels = [];
    for (let i = 0; i < price.histogram.length; i++) {
      const lo = i === 0 ? 0 : (buckets[i - 1] ?? 0) + 1;
      const hi = buckets[i] ?? `${buckets.at(-1)}+`;
      labels.push(`$${lo}–$${hi}`);
    }
    return labels;
  })();

  const maxBar = hasHistogram ? Math.max(...price.histogram) || 1 : 1;

  const topConditions = [...conditions]
    .sort((a, b) => (b.count || 0) - (a.count || 0))
    .slice(0, 6);

  return (
    <section className="mt-8">
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        {/* Header */}
        <div className="flex flex-col gap-1 border-b border-gray-100 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              Live market coverage {query ? <span className="text-gray-600">for “{query}”</span> : null}
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              Aggregating live listings across our tracked marketplaces to map today’s pricing landscape.
            </p>
          </div>
          <div className="mt-2 sm:mt-0">
            <span className="inline-flex items-center rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-600">
              {sampleSize ? `Analyzed ${sampleSize} listings` : "Live sample from current results"}
            </span>
          </div>
        </div>

        {/* Stat tiles */}
        <div className="grid gap-4 p-5 sm:grid-cols-3">
          <StatTile label="Min price" value={formatCurrency(price.min)} />
          <StatTile label="Average price" value={formatCurrency(price.avg)} highlight />
          <StatTile label="Max price" value={formatCurrency(price.max)} />
        </div>

        {/* Body */}
        <div className="grid gap-6 border-t border-gray-100 p-5 lg:grid-cols-2">
          {/* Price distribution */}
          <div>
            <h3 className="mb-2 text-sm font-medium text-gray-700">Price distribution</h3>

            {!hasHistogram ? (
              <div className="rounded-lg border border-dashed border-gray-200 p-4 text-sm text-gray-500">
                Not enough data to build a distribution yet.
              </div>
            ) : (
              <ul className="space-y-2">
                {price.histogram.map((count, idx) => (
                  <li key={idx} className="grid grid-cols-12 items-center gap-3">
                    <div className="col-span-4 truncate text-xs text-gray-600">
                      {bucketLabels[idx]}
                    </div>
                    <div className="col-span-7">
                      <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-3 rounded-full bg-gray-300"
                          style={{ width: `${(100 * (count || 0)) / maxBar}%` }}
                          aria-hidden
                        />
                      </div>
                    </div>
                    <div className="col-span-1 text-right text-xs tabular-nums text-gray-700">
                      {count || 0}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Conditions + Optional sections */}
          <div className="flex flex-col gap-6">
            <div>
              <h3 className="mb-2 text-sm font-medium text-gray-700">Condition mix</h3>
              {topConditions.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-200 p-4 text-sm text-gray-500">
                  No condition info available.
                </div>
              ) : (
                <ul className="space-y-2">
                  {topConditions.map((c) => {
                    const pct = sampleSize ? Math.round(((c.count || 0) / sampleSize) * 100) : null;
                    return (
                      <li key={c.key}>
                        <div className="flex items-baseline justify-between text-xs">
                          <span className="font-medium text-gray-700">
                            {c.key.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase())}
                          </span>
                          <span className="text-gray-600">
                            {c.count ?? 0}{pct !== null ? <span className="ml-1 text-gray-400">({pct}%)</span> : null}
                          </span>
                        </div>
                        <div className="mt-1 h-2 w-full overflow-hidden rounded bg-gray-100">
                          <div
                            className="h-2 rounded bg-gray-300"
                            style={{ width: `${pct ?? 0}%` }}
                            aria-hidden
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {modelKey ? (
              <div>
                <h3 className="mb-2 text-sm font-medium text-gray-700">Price history</h3>
                <ModelHistoryChart model={modelKey} />
              </div>
            ) : null}

            {!!buyingOptions.length && (
              <div>
                <h3 className="mb-2 text-sm font-medium text-gray-700">Buying options</h3>
                <div className="flex flex-wrap gap-2">
                  {buyingOptions.map((o) => (
                    <span
                      key={o.key}
                      className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-700"
                      title={`${o.key}: ${o.count}`}
                    >
                      {o.key} · {o.count}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {!!brandsTop.length && (
              <div>
                <h3 className="mb-2 text-sm font-medium text-gray-700">Top brands</h3>
                <div className="flex flex-wrap gap-2">
                  {brandsTop.map((b) => (
                    <span
                      key={b.key}
                      className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-700"
                      title={`${b.key}: ${b.count}`}
                    >
                      {b.key} · {b.count}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-b-2xl border-t border-gray-100 bg-gray-50 px-5 py-3 text-xs text-gray-500">
          Snapshot reflects the current page’s fetched data. Adjust filters or broaden search to see more.
        </div>
      </div>
    </section>
  );
}

function StatTile({ label, value, highlight = false }) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        highlight ? "border-blue-200 bg-blue-50" : "border-gray-200 bg-white"
      }`}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${highlight ? "text-blue-800" : "text-gray-900"}`}>
        {value}
      </div>
    </div>
  );
}
