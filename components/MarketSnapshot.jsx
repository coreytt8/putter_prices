// components/MarketSnapshot.jsx
"use client";

export default function MarketSnapshot({ snapshot, meta, query }) {
  if (!snapshot) return null;
  const snap = snapshot;

  return (
    <section className="mt-6 space-y-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">
          Market snapshot {query ? <>for “{query}”</> : null}
        </h2>
        <div className="text-sm text-gray-500">
          Min ${snap.price.min ?? "—"} · Avg ${snap.price.avg ?? "—"} · Max ${snap.price.max ?? "—"}
          {meta?.perPage && meta?.samplePages ? (
            <span className="ml-3">
              (sampled {Number(meta.perPage) * Number(meta.samplePages)} active listings)
            </span>
          ) : null}
        </div>
      </div>

      {!!snap.brandsTop?.length && (
        <div>
          <div className="mb-2 text-sm text-gray-600">Top brands</div>
          <div className="flex flex-wrap gap-2">
            {snap.brandsTop.map(b => (
              <span key={b.key} className="rounded-full bg-gray-100 px-3 py-1 text-sm">
                {b.key} · {b.count}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <div className="mb-2 text-sm text-gray-600">Conditions</div>
          <ul className="space-y-1 text-sm">
            {snap.conditions?.map(c => <li key={c.key}>{c.key}: {c.count}</li>)}
          </ul>
        </div>
        <div>
          <div className="mb-2 text-sm text-gray-600">Buying options</div>
          <ul className="space-y-1 text-sm">
            {snap.buyingOptions?.map(o => <li key={o.key}>{o.key}: {o.count}</li>)}
          </ul>
        </div>
      </div>

      <div>
        <div className="mb-2 text-sm text-gray-600">Price distribution</div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
          {snap.price?.histogram?.map((count, idx) => {
            const lo = idx === 0 ? 0 : snap.price.buckets[idx - 1] + 1;
            const hi = snap.price.buckets[idx] ?? `${snap.price.buckets.at(-1)}+`;
            return (
              <div key={idx} className="rounded border p-2">
                <div className="text-xs text-gray-600">${lo}–${hi}</div>
                <div className="text-base font-medium">{count}</div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
