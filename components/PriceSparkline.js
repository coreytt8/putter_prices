'use client';

// data: [{ day: '2025-09-01T00:00:00.000Z', median: 299.0 }, ...]
export default function PriceSparkline({ data }) {
  if (!Array.isArray(data) || data.length < 2) return null;

  // Normalize points to [0..1] box then scale to SVG size
  const w = 240;   // px
  const h = 48;    // px
  const pad = 4;   // inner padding

  const xs = data.map((_, i) => i);
  const ys = data.map(d => Number(d.median)).filter(n => Number.isFinite(n));
  if (ys.length < 2) return null;

  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanY = maxY - minY || 1;
  const maxX = data.length - 1 || 1;

  const toX = (i) => pad + (i / maxX) * (w - pad * 2);
  const toY = (v) => pad + (1 - (v - minY) / spanY) * (h - pad * 2);

  const points = data.map((d, i) => [toX(i), toY(Number(d.median))]);
  const dAttr = points
    .map(([x, y], idx) => (idx === 0 ? `M ${x} ${y}` : `L ${x} ${y}`))
    .join(' ');

  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} aria-label="price trend">
      {/* baseline */}
      <line x1={pad} y1={toY(minY)} x2={w - pad} y2={toY(minY)} stroke="#e5e7eb" strokeWidth="1" />
      {/* sparkline */}
      <path d={dAttr} fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
