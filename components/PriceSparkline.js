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
} from 'recharts';

// Accepts data in any of these shapes per point:
// { ts: number(ms)|string(ISO), total:number }  OR  { t: string|number, price:number }
export default function PriceSparkline({
  data,
  height = 64,
  showAverage = true,
  showMedian = true,
  className = '',
}) {
  const series = useMemo(() => {
    if (!Array.isArray(data)) return [];
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

    // 7-pt simple moving average (if enough points)
    const avg = [];
    const win = 7;
    for (let i = 0; i < norm.length; i++) {
      const s = Math.max(0, i - (win - 1) + 1);
      const start = Math.max(0, i - (win - 1));
      let sum = 0,
        n = 0;
      for (let j = start; j <= i; j++) {
        sum += norm[j].y;
        n++;
      }
      avg.push(n >= 3 ? sum / n : null); // don’t plot average for very short windows
    }

    // stats
    const ys = norm.map(p => p.y);
    const min = ys.length ? Math.min(...ys) : null;
    const max = ys.length ? Math.max(...ys) : null;
    const median =
      ys.length
        ? (() => {
            const a = [...ys].sort((x, y) => x - y);
            const mid = Math.floor(a.length / 2);
            return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
          })()
        : null;

    // pick first/last min/max positions for dots
    let minIdx = -1,
      maxIdx = -1;
    if (min != null) minIdx = norm.findIndex(p => p.y === min);
    if (max != null) maxIdx = norm.findIndex(p => p.y === max);

    // final recharts-friendly
    const out = norm.map((p, i) => ({
      x: p.x,
      y: p.y,
      avg: avg[i],
      isMin: i === minIdx,
      isMax: i === maxIdx,
    }));

    return {
      points: out,
      min,
      max,
      median,
    };
  }, [data]);

  if (!series.points?.length) return null;

  // pad Y domain slightly for breathing room
  const yPad = Math.max(2, Math.round((series.max - series.min) * 0.06) || 4);
  const yMin = Math.max(0, Math.floor(series.min - yPad));
  const yMax = Math.ceil(series.max + yPad);

  const dateFmt = (d) =>
    new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  const priceFmt = (n) =>
    Number.isFinite(n) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n) : '—';

  // custom minimal tooltip
  const CustomTooltip = ({ active, label, payload }) => {
    if (!active || !payload?.length) return null;
    const p = payload[0]?.payload;
    return (
      <div className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs shadow-md">
        <div className="font-medium">{dateFmt(p.x)}</div>
        <div className="text-gray-700">{priceFmt(p.y)}</div>
        {Number.isFinite(p.avg) && <div className="text-gray-400">avg {priceFmt(p.avg)}</div>}
      </div>
    );
  };

  return (
    <div className={`w-full ${className}`}>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart
          data={series.points}
          margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
        >
          {/* gradient fill */}
          <defs>
            <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          {/* area under price */}
          <Area
            type="monotone"
            dataKey="y"
            stroke="#3b82f6"
            fill="url(#sparkFill)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />

          {/* optional moving average line */}
          {showAverage && (
            <Line
              type="monotone"
              dataKey="avg"
              stroke="#64748b"
              strokeDasharray="4 3"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          )}

          {/* median band */}
          {showMedian && Number.isFinite(series.median) && (
            <ReferenceLine
              y={series.median}
              stroke="#10b981"
              strokeDasharray="3 3"
              strokeOpacity={0.8}
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
                fill={p.isMin ? '#10b981' : '#ef4444'}
                stroke="white"
                strokeWidth={1}
                isFront
              />
            ) : null
          )}

          {/* clean tooltip */}
          <Tooltip
            content={<CustomTooltip />}
            labelFormatter={() => ''}
            cursor={{ stroke: 'rgba(0,0,0,0.08)', strokeWidth: 1 }}
          />
          {/* hide axes entirely for a clean sparkline look */}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
