// components/SmartPriceBadge.jsx
// Self-contained deal badge. Compatible with both:
//   - <SmartPriceBadge price={...} baseStats={...} />
//   - <SmartPriceBadge total={...} stats={...} cohort="standard|tour|limited|approx" />

function isFiniteNum(x) {
  return typeof x === "number" && Number.isFinite(x);
}

function computeBadgeScore({ value, stats }) {
  // Expect stats like { p10, p50, p90, n?, dispersionRatio? }
  if (!isFiniteNum(value) || !stats || !isFiniteNum(stats.p50) || stats.p50 <= 0) {
    return { label: "—", score: 0 };
  }
  const p50 = Number(stats.p50);
  const n = Number(stats.n ?? stats.sampleSize ?? stats.count ?? 0);

  // Use dispersionRatio if provided; otherwise rough IQR proxy
  const dispersion =
    isFiniteNum(stats.dispersionRatio)
      ? Number(stats.dispersionRatio)
      : (isFiniteNum(stats.p90) && isFiniteNum(stats.p10) && p50 > 0
          ? ((stats.p90 - stats.p10) / 2) / p50
          : 0.35);

  const denom = Math.max(0.10, dispersion) * p50;
  const z = (value - p50) / denom;

  if (z <= -1.1) return { label: "Great", score: 3 };
  if (z <= -0.45) return { label: "Good",  score: 2 };
  if (z <  0.75)  return { label: "Fair",  score: 1 };
  return { label: "High", score: 0 };
}

export default function SmartPriceBadge({
  price,         // legacy prop: item price
  total,         // new prop: total-to-door (price + ship)
  baseStats,     // legacy prop: stats object
  stats,         // new prop: stats/cohort stats object
  cohort = "standard",
  className = "",
}) {
  // Prefer total/stats if provided; fall back to price/baseStats
  const value = isFiniteNum(total) ? total : (isFiniteNum(price) ? price : null);
  const s = stats || baseStats || null;

  const badge = computeBadgeScore({ value, stats: s });

  // Colors
  const color =
    badge.label === "Great" ? "bg-green-100 text-green-800" :
    badge.label === "Good"  ? "bg-emerald-100 text-emerald-800" :
    badge.label === "Fair"  ? "bg-gray-100 text-gray-800" :
    badge.label === "High"  ? "bg-amber-100 text-amber-800" :
                              "bg-gray-100 text-gray-500";

  // Tooltip helps explain which cohort if you’re passing it
  const title = badge.label === "—"
    ? "No market stats available for this model."
    : (cohort === "approx"
        ? "Estimated vs standard-market cohort (limited sample)"
        : `Benchmarked vs ${cohort} cohort`);

  return (
    <span
      className={`ml-2 rounded-full px-2 py-[2px] text-[11px] font-medium ${color} ${className}`}
      title={title}
    >
      {badge.label}
    </span>
  );
}
