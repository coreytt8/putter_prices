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

  const { processedBands, bandsCount, lookback } = useMemo(() => {
    const data = state.data;
    const rawBands = Array.isArray(data?.bands) ? data.bands : [];

    const processed = rawBands
      .map((band) => {
        const medianRaw =
          typeof band.median === 'number'
            ? band.median
            : typeof band.median === 'string'
            ? Number.parseFloat(band.median)
            : Number.NaN;
        if (!Number.isFinite(medianRaw)) return null;
        const median = medianRaw;

        const premiumAbsRaw =
          typeof band.premiumAbs === 'number'
            ? band.premiumAbs
            : typeof band.premiumAbs === 'string'
            ? Number.parseFloat(band.premiumAbs)
            : typeof band.premium === 'number'
            ? band.premium
            : typeof band.premium === 'string'
            ? Number.parseFloat(band.premium)
            : null;
        const premiumAbs = Number.isFinite(premiumAbsRaw) ? premiumAbsRaw : null;

        const baselineRaw =
          typeof band.baseline === 'number'
            ? band.baseline
            : typeof band.baseline === 'string'
            ? Number.parseFloat(band.baseline)
            : premiumAbs != null
            ? median - premiumAbs
            : null;
        const baseline = Number.isFinite(baselineRaw) ? baselineRaw : null;

        let premiumPct =
          typeof band.premiumPct === 'number'
            ? band.premiumPct
            : typeof band.premiumPct === 'string'
            ? Number.parseFloat(band.premiumPct)
            : null;
        if (!Number.isFinite(premiumPct)) premiumPct = null;

        if (premiumPct == null && premiumAbs != null && baseline !== null && baseline !== 0) {
          premiumPct = premiumAbs / baseline;
        }

        if (premiumPct == null && typeof band.pct_vs_any === 'string') {
          const pct = Number.parseFloat(band.pct_vs_any);
          if (Number.isFinite(pct)) premiumPct = pct / 100;
        }

        if (premiumPct == null) return null;

        return {
          ...band,
          premiumAbs,
          premiumPct,
          baseline,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b.premiumPct ?? 0) - (a.premiumPct ?? 0));
    const lookbackValue = data?.resolved?.windowDays ?? data?.windowDays ?? null;
    const count = typeof data?.bandsCount === 'number' ? data.bandsCount : rawBands.length;

    return {
      processedBands: processed,
      bandsCount: count,
      lookback: lookbackValue,
    };
  }, [state.data]);

  if (!model) return null;
  if (state.loading) return null; // keep UI clean; you can show a skeleton if you want
  if (state.error) return null;

  if (!processedBands.length || processedBands.length < 2) return null;
  if (!bandsCount || bandsCount < 2) return null;

  const directionStyles = {
    positive: {
      chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-500/40',
      secondary: 'text-emerald-600/80',
    },
    negative: {
      chip: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-500/40',
      secondary: 'text-rose-600/80',
    },
    neutral: {
      chip: 'bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-500/30',
      secondary: 'text-slate-500',
    },
  };

  const formatCurrency = (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2,
      }).format(value);
    } catch (err) {
      const fixed = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2);
      return `${value < 0 ? '-' : ''}$${Math.abs(Number.parseFloat(fixed))}`;
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {processedBands.map(b => {
        const pctValue =
          typeof b.premiumPct === 'number'
            ? (b.premiumPct * 100).toFixed(1)
            : typeof b.pct_vs_any === 'string'
            ? b.pct_vs_any
            : '0.0';
        const signed = (pctValue.startsWith('-') ? '' : '+') + pctValue + '%';
        const direction =
          typeof b.premiumPct === 'number' && b.premiumPct !== 0
            ? b.premiumPct > 0
              ? 'positive'
              : 'negative'
            : 'neutral';
        const styles = directionStyles[direction] ?? directionStyles.neutral;
        const secondaryParts = [];
        if (typeof b.sampleSize === 'number' && Number.isFinite(b.sampleSize) && b.sampleSize > 0) {
          secondaryParts.push(`n=${b.sampleSize}`);
        }
        if (typeof b.premiumAbs === 'number' && Number.isFinite(b.premiumAbs) && b.premiumAbs !== 0) {
          const formatted = formatCurrency(b.premiumAbs);
          if (formatted) secondaryParts.push(`${b.premiumAbs > 0 ? '+' : ''}${formatted}`);
        }
        return (
          <span
            key={b.condition}
            className={`inline-flex min-w-0 items-start gap-2 rounded-full px-2 py-1 text-xs font-medium ${styles.chip}`}
            title={`Median ${b.median?.toFixed ? '$' + b.median.toFixed(2) : b.median} • n=${b.sampleSize ?? 0}`}
          >
            <span className="flex min-w-0 flex-col text-left leading-tight">
              <span className="truncate font-semibold">{b.condition.replace(/_/g, ' ')} {signed}</span>
              {secondaryParts.length ? (
                <span className={`text-[10px] font-normal ${styles.secondary}`}>
                  {secondaryParts.join(' • ')}
                </span>
              ) : null}
            </span>
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
