// /components/SmartPriceBadge.jsx
import { dealBadge } from "@/lib/stats";

export default function SmartPriceBadge({ total, stats, cohort = "standard", className = "" }) {
  const badge = stats ? dealBadge(total, stats) : { label: "—", score: 0 };
  const color =
    badge.label === "Great" ? "bg-green-100 text-green-800" :
    badge.label === "Good"  ? "bg-emerald-100 text-emerald-800" :
    badge.label === "Fair"  ? "bg-gray-100 text-gray-800" :
                              "bg-amber-100 text-amber-800";

  const title = cohort === "approx"
    ? "Estimated vs standard-market cohort (limited sample)"
    : `Benchmarked vs ${cohort} cohort`;

  return (
    <span className={`ml-2 rounded-full px-2 py-[2px] text-[11px] font-medium ${color} ${className}`} title={title}>
      {badge.label}
    </span>
  );
}
