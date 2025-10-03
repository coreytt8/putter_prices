// components/ConditionChips.jsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export default function ConditionChips({ model }) {
  const [state, setState] = useState({ loading: false, error: null, data: null });
  const mounted = useRef(true);

  const url = useMemo(() => {
    const m = String(model || '').trim();
    if (!m) return null;
    return `/api/condition-deltas?model=${encodeURIComponent(m)}`;
  }, [model]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!url) return;
    setState({ loading: true, error: null, data: null });
    fetch(url, { cache: 'no-store' })
      .then(r => r.json())
      .then(json => { if (mounted.current) setState({ loading: false, error: null, data: json }); })
      .catch(err => { if (mounted.current) setState({ loading: false, error: err.message, data: null }); });
  }, [url]);

  if (!model) return null;
  if (state.loading) return null; // keep UI clean; you can show a skeleton if you want
  if (state.error) return null;
  if (!state.data) return null;

  const { bandsCount, bands, resolved } = state.data;
  if (!bandsCount || bandsCount < 2 || !Array.isArray(bands) || bands.length < 2) return null;

  // Sort by biggest % premium first
  const sorted = [...bands].sort((a,b) => (b.premiumPct ?? 0) - (a.premiumPct ?? 0));
  const lookback = resolved?.windowDays ?? state.data.windowDays ?? null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {sorted.map(b => {
        const pct = (typeof b.pct_vs_any === 'string') ? b.pct_vs_any
          : (typeof b.premiumPct === 'number' ? (b.premiumPct * 100).toFixed(1) : '0.0');
        const signed = (pct.startsWith('-') ? '' : '+') + pct + '%';
        return (
          <span
            key={b.condition}
            className="inline-flex items-center rounded-full border border-gray-300 px-2 py-0.5 text-xs text-gray-700"
            title={`Median ${b.median?.toFixed ? '$' + b.median.toFixed(2) : b.median} • n=${b.sampleSize ?? 0}`}
          >
            {b.condition.replace(/_/g, ' ')} {signed}
          </span>
        );
      })}
      {lookback ? (
        <span className="ml-1 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-600">
          Last {lookback}d
        </span>
      ) : null}
    </div>
  );
}
