export default function ConditionChip({ band }) {
  if (!band) return null;

  const normalized = String(band || "")
    .trim()
    .toUpperCase();
  if (!normalized) return null;

  const labels = {
    NEW: "New",
    LIKE_NEW: "Like New",
    GOOD: "Good",
    USED: "Used",
    FAIR: "Fair",
    ANY: "Any Condition",
  };

  const label = labels[normalized];
  if (!label) return null;

  return (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-700">
      {label}
    </span>
  );
}
