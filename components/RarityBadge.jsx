import clsx from "clsx";

const RARITY_CONFIG = {
  tour: {
    emoji: "🟣",
    label: "Tour",
    className: "bg-purple-100 text-purple-800 ring-purple-200",
  },
  limited: {
    emoji: "🟡",
    label: "Limited",
    className: "bg-amber-100 text-amber-800 ring-amber-200",
  },
  retail: {
    emoji: "🔵",
    label: "Retail",
    className: "bg-blue-100 text-blue-800 ring-blue-200",
  },
};

function normalizeTier(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "tour-only" || normalized === "touronly") return "tour";
  if (normalized === "limited-run" || normalized === "limitedrun") return "limited";
  if (normalized === "retail-line" || normalized === "retailline") return "retail";
  if (normalized in RARITY_CONFIG) return normalized;
  if (normalized.includes("tour")) return "tour";
  if (normalized.includes("limit")) return "limited";
  if (normalized.includes("retail")) return "retail";
  return null;
}

export default function RarityBadge({ tier, className }) {
  const normalized = normalizeTier(tier);
  if (!normalized) return null;
  const cfg = RARITY_CONFIG[normalized];
  if (!cfg) return null;

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        cfg.className,
        className
      )}
    >
      <span aria-hidden="true">{cfg.emoji}</span>
      <span>{cfg.label}</span>
    </span>
  );
}
