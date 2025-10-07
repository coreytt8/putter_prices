"use client";

import clsx from "clsx";

const COLOR_VARIANTS = {
    emerald: "bg-emerald-600 text-white", // A+
    green: "bg-green-600 text-white",   // A
    amber500: "bg-amber-500 text-black",   // B
    amber300: "bg-amber-300 text-black",   // C
    red: "bg-red-600 text-white",     // D
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
