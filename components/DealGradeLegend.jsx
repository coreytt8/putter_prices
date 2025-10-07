// components/DealGradeLegend.jsx
export default function DealGradeLegend() {
  const rows = [
    ["A+", "≥ 40% below median"],
    ["A",  "25–40% below"],
    ["B",  "15–25% below"],
    ["C",  "5–15% below"],
  ];
  return (
    <div className="mt-2 text-xs text-slate-500">
      <div className="inline-flex flex-wrap gap-3 rounded-xl border border-slate-200 bg-white/70 px-3 py-2">
        {rows.map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className="font-semibold text-slate-700">{k}</span>
            <span className="text-slate-500">{v}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
