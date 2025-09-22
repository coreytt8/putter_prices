'use client';
import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Line,
  ReferenceLine,
  ReferenceDot,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// Accepts per-point shapes like:
// { ts:number(ms)|string(ISO), total:number } OR { t:string|number, price:number }
// ...also supports { date, x } and { value, y }
export default function PriceSparkline({
  data,
  height = 64,
  showAverage = true,
  showMedian = true,
  className = '',
}) {
  const series = useMemo(() => {
    if (!Array.isArray(data)) return { points: [], min: null, max: null, median: null };

    // normalize -> [{x: Date, y: number}]
    const norm = data
      .map(d => {
        const xRaw = d.ts ?? d.t ?? d.date ?? d.x;
        const yRaw = d.total ?? d.price ?? d.y ?? d.value;
        const x =
          typeof xRaw === 'number'
            ? new Date(xRaw)
            : typeof xRaw === 'string'
              ? new Date(xRaw)
              : null;
        const y = Number(yRaw);
        if (!x || !Number.isFinite(y)) return null;
        return { x, y };
      })
      .filter(Boolean)
      .sort((a, b) => a.x - b.x);

    // simple moving average (window=7)
    const avg = [];
    const win = 7;
    for (let i = 0; i < norm.length; i++) {
      const start = Math.max(0, i - (win - 1));
      let sum = 0, n = 0;
      for (let j = start; j <= i; j++) { sum += norm[j].y; n++; }
      avg.push(n >= 3 ? sum / n : null);
    }

    const ys = norm.map(p => p.y);
    const min = ys.length ? Math.min(...ys) : null;
    const max = ys.length ? Math.max(...ys) : null;
    const median = ys.length
      ? (() => {
          const a = [...ys].sort((x, y) => x - y);
          const mid = Math.floor(a.length / 2);
          return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
        })()
      : null;

    let minIdx = -1, maxIdx = -1;
    if (min != null) minIdx = norm.findIndex(p => p.y === min);
    if (max != null) maxIdx = norm.findIndex(p => p.y === max);

    const out = norm.map((p, i) => ({
      x: p.x.getTime(), // Recharts prefers number for X when using numeric axis
      y: p.y,
      avg: avg[i],
      isMin: i === minIdx,
      isMax: i === maxIdx,
    }));

    return { points: out, min, max, median };
  }, [data]);

  if (!series.points.length) return null;

  // y-domain padding for breathing room
  const span = Math.max(1, (series.max ?? 0) - (series.min ?? 0));
  const yMin = Math.max(0, Math.floor((series.min ?? 0) - span * 0.08));
  const yMax = Math.ceil((series.max ?? 0) + span * 0.08);

  const dateFmt = (ts) =>
    new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  const priceFmt = (n) =>
    Number.isFinite(n)
      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
      : '—';

  // minimal tooltip
  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const p = payload[0]?.payload;
    return (
      <div className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] shadow-sm">
        <div className="font-medium">{priceFmt(p.y)}</div>
        <div className="text-gray-500">{dateFmt(p.x)}</div>
        {Number.isFinite(p.avg) && <div className="text-gray-400">avg {priceFmt(p.avg)}</div>}
      </div>
    );
  };

  // unique gradient id so multiple charts on page don't clash
  const gradId = useMemo(
    () => `sparkFill-${Math.random().toString(36).slice(2)}`,
    []
  );

  // Use currentColor for themeable stroke/fill; parent sets color.
  // Example parent wrappers: "text-sky-600" or "text-emerald-600"
  return (
    <div className={`w-full text-sky-600 ${className}`}>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart
          data={series.points}
          margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.18} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          {/* area under price (subtle, professional look) */}
          <Area
            type="monotone"
            dataKey="y"
            stroke="none"
            fill={`url(#${gradId})`}
            isAnimationActive={false}
            connectNulls
            yAxisId="y"
          />

          {/* crisp line */}
          <Line
            type="monotone"
            dataKey="y"
            stroke="currentColor"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3 }}
            isAnimationActive={false}
            connectNulls
            yAxisId="y"
          />

          {/* optional moving average */}
          {showAverage && (
            <Line
              type="monotone"
              dataKey="avg"
              stroke="currentColor"
              strokeOpacity={0.55}
              strokeDasharray="4 3"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              connectNulls
              yAxisId="y"
            />
          )}

          {/* median guide */}
          {showMedian && Number.isFinite(series.median) && (
            <ReferenceLine
              y={series.median}
              yAxisId="y"
              stroke="currentColor"
              strokeOpacity={0.6}
              strokeDasharray="3 3"
            />
          )}

          {/* min/max markers */}
          {series.points.map((p, i) =>
            p.isMin || p.isMax ? (
              <ReferenceDot
                key={i}
                x={p.x}
                y={p.y}
                r={3.5}
                fill="currentColor"
                fillOpacity={0.9}
                stroke="#fff"
                strokeWidth={1}
                isFront
                yAxisId="y"
              />
            ) : null
          )}

          <Tooltip
            content={<CustomTooltip />}
            labelFormatter={() => ''}
            wrapperStyle={{ outline: 'none' }}
            cursor={{ stroke: 'rgba(0,0,0,0.08)', strokeWidth: 1 }}
          />

          {/* hidden axes; YAxis enforces padded domain */}
          <YAxis yAxisId="y" domain={[yMin, yMax]} hide />
          <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} hide />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
