export default function RarityBadge({ tier }) {
  if (!tier) return null;
  const map = { tour: "Tour", limited: "Limited", retail: "Retail" };
  const label = map[(tier || "").toLowerCase()];
  if (!label) return null;
  return (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-700">
      {label}
    </span>
  );
}
