"use client";

import clsx from "clsx";

const COLOR_VARIANTS = {
  green: "border-green-200/80 bg-green-100/80 text-green-900",
  emerald: "border-emerald-200/80 bg-emerald-100/80 text-emerald-900",
  slate: "border-slate-300/70 bg-slate-200/70 text-slate-900",
  red: "border-red-200/80 bg-red-100/80 text-red-900",
};

function formatPercent(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const percentage = Math.abs(value * 100);
  if (!Number.isFinite(percentage)) return null;
  if (percentage >= 10) return `${Math.round(percentage)}%`;
  if (percentage >= 1) return `${percentage.toFixed(1).replace(/\.0$/, "")}%`;
  return `${percentage.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

export default function DealGradeBadge({ grade, className = "" }) {
  if (!grade || typeof grade !== "object") return null;
  const letter = typeof grade.letter === "string" ? grade.letter.toUpperCase() : null;
  const label = typeof grade.label === "string" ? grade.label : null;
  const colorKey = typeof grade.color === "string" ? grade.color : null;
  const deltaPct = typeof grade.deltaPct === "number" && Number.isFinite(grade.deltaPct) ? grade.deltaPct : null;

  if (!letter) return null;

  const arrowThreshold = 0.005; // ±0.5%
  const arrow = deltaPct != null && Math.abs(deltaPct) >= arrowThreshold ? (deltaPct > 0 ? "↓" : "↑") : null;
  const percentLabel = arrow ? formatPercent(deltaPct) : null;
  const toneClass = colorKey && COLOR_VARIANTS[colorKey] ? COLOR_VARIANTS[colorKey] : COLOR_VARIANTS.slate;
  const titleParts = [];
  if (letter) titleParts.push(`Grade ${letter}`);
  if (label) titleParts.push(label);
  if (percentLabel) titleParts.push(`${arrow === "↓" ? "below" : "above"} median by ${percentLabel}`);

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
        toneClass,
        className
      )}
      title={titleParts.join(" · ") || undefined}
      aria-label={titleParts.join(" · ") || undefined}
    >
      <span className="flex items-center gap-1">
        <span className="font-semibold">{letter}</span>
        {label ? <span className="tracking-wide">{label}</span> : null}
      </span>
      {arrow && percentLabel ? (
        <span className="flex items-center gap-1 text-[11px] font-normal">
          <span aria-hidden>{arrow}</span>
          <span>{percentLabel}</span>
        </span>
      ) : null}
    </span>
  );
}
