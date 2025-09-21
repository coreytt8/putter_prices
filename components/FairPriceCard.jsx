import React from 'react';
import { useModelStats } from '../lib/useModelStats';

function fmt(n) {
  if (n == null) return '—';
  const num = typeof n === 'string' ? Number(n) : n;
  return Number.isFinite(num) ? `$${num.toFixed(0)}` : '—';
}

export default function FairPriceCard({ model }) {
  const { data, loading, error } = useModelStats(model);
  const stats = data?.stats || {};
  const n = Number(stats?.n || 0);

  return (
    <div className="rounded-2xl border border-gray-200 p-4 shadow-sm">
      <div className="text-sm text-gray-500 mb-1">Fair Price (90d median)</div>
      {loading ? (
        <div className="animate-pulse h-6 w-24 bg-gray-200 rounded" />
      ) : error ? (
        <div className="text-red-600 text-sm">Error: {String(error)}</div>
      ) : (
        <>
          <div className="text-2xl font-semibold">{fmt(stats.p50)}</div>
          <div className="text-xs text-gray-500 mt-1">
            Range P10–P90: <span className="font-medium">{fmt(stats.p10)}</span> – <span className="font-medium">{fmt(stats.p90)}</span>
          </div>
          <div className="text-xs text-gray-400 mt-1">Sample size (90d): {n}</div>
        </>
      )}
    </div>
  );
}
