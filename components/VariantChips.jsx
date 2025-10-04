// components/VariantChips.jsx
'use client';
import { useEffect, useMemo, useState } from 'react';

export default function VariantChips({ model }) {
  const [data, setData] = useState({ ok: true, variants: [], resolved: null });
  const [loading, setLoading] = useState(false);

  const modelKey = String(model || '').trim();
  const windowDays = data?.resolved?.windowDays || 180;
  const variants = Array.isArray(data?.variants) ? data.variants : [];

  useEffect(() => {
    let abort = false;
    async function go() {
      if (!modelKey) return;
      setLoading(true);
      try {
        const url = `/api/variant-premiums?model=${encodeURIComponent(modelKey)}`;
        const res = await fetch(url, { cache: 'no-store' });
        const j = await res.json();
        if (!abort) setData(j);
      } catch (e) {
        if (!abort) setData({ ok: false, variants: [] });
      } finally {
        if (!abort) setLoading(false);
      }
    }
    go();
    return () => { abort = true; };
  }, [modelKey]);

  const items = useMemo(() => {
    return variants.map(v => ({
      label: v.label,
      pct: Number(v.premiumPct || 0),
      pctText: (Number(v.premiumPct || 0) * 100).toFixed(1) + '%',
    }));
  }, [variants]);

  if (!modelKey) return null;
  if (!loading && items.length === 0) return null; // nothing to show

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <span className="rounded-md bg-gray-100 px-2 py-1 text-gray-600">
        Variants • Last {windowDays}d
      </span>

      {loading && <span className="text-gray-400">loading…</span>}

      {!loading && items.map((it, i) => {
        const pos = it.pct > 0.01;
        const neg = it.pct < -0.01;
        const chipClass = pos
          ? 'bg-green-100 text-green-800 ring-1 ring-green-300'
          : neg
          ? 'bg-red-100 text-red-800 ring-1 ring-red-300'
          : 'bg-gray-100 text-gray-700 ring-1 ring-gray-300';
        const signText = pos ? `+${(it.pct*100).toFixed(1)}%` : `${(it.pct*100).toFixed(1)}%`;

        return (
          <span key={i} className={`rounded-full px-2 py-1 ${chipClass}`}>
            {it.label} {signText}
          </span>
        );
      })}
    </div>
  );
}
