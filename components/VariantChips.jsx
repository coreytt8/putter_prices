// components/VariantChips.jsx
'use client';

import { useEffect, useMemo, useState } from 'react';

export default function VariantChips({ model, limit = 4, minN = 3 }) {
  // Unconditional hooks (avoid React hook order errors)
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let abort = false;
    async function go() {
      if (!model) return;
      setLoading(true);
      setErr(null);
      try {
        const url = `/api/variant-premiums?model=${encodeURIComponent(model)}`;
        const res = await fetch(url, { cache: 'no-store' });
        const json = await res.json();
        if (!abort) setData(json);
      } catch (e) {
        if (!abort) setErr(e);
      } finally {
        if (!abort) setLoading(false);
      }
    }
    go();
    return () => { abort = true; };
  }, [model]);

  const { windowDays, variants } = useMemo(() => {
    const rd = data?.resolved || {};
    const variantsRaw = Array.isArray(data?.variants) ? data.variants : [];
    // prefer decent samples; still show low-n with a badge
    const sorted = variantsRaw.slice().sort((a, b) => b.premiumPct - a.premiumPct);
    return {
      windowDays: rd.windowDays ?? null,
      variants: sorted.slice(0, limit),
    };
  }, [data, limit]);

  if (!model) return null;
  if (loading) return null; // keep UI calm; your card already has other loaders
  if (err) return null;
  if (!variants?.length) return null;

  const pillBase =
    'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium border';
  const pos = 'border-green-200 bg-green-50 text-green-800';
  const neg = 'border-red-200 bg-red-50 text-red-800';
  const flat = 'border-gray-200 bg-gray-50 text-gray-800';

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {variants.map((v, i) => {
        const pct = (v.premiumPct ?? 0);
        const pctLabel = `${pct >= 0 ? '+' : ''}${(pct * 100).toFixed(1)}%`;
        const tone = pct > 0.01 ? pos : pct < -0.01 ? neg : flat;
        const lowN = v.lowSample ? (
          <span
            title="Small sample"
            className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-500"
          />
        ) : null;

        return (
          <span key={`${v.variantKey}-${i}`} className={`${pillBase} ${tone}`}>
            <span className="truncate max-w-[14ch]">{v.label || 'Variant'}</span>
            <span className="opacity-70">·</span>
            <span className="tabular-nums">{pctLabel}</span>
            {lowN}
          </span>
        );
      })}

      {windowDays ? (
        <span className="ml-1 text-[10px] text-gray-500">Last {windowDays}d</span>
      ) : null}
    </div>
  );
}
