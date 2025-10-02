"use client";
import { useEffect, useState } from "react";

export default function ConditionDeltas({ model }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!model) return;
    setLoading(true);
    fetch(`/api/condition-deltas?model=${encodeURIComponent(model)}`)
      .then(r => r.json())
      .then(j => setData(j))
      .finally(() => setLoading(false));
  }, [model]);

  if (loading || !data?.ok) return null;

  const deltas = data.deltas || [];
  const nonZero = deltas.filter(d => Number(d.pct_vs_any) !== 0);
  // Require at least 2 bands OR at least one non-zero delta
  if ((data.bandsCount ?? deltas.length) < 2 && nonZero.length === 0) return null;

  const order = ["NEW","LIKE_NEW","GOOD","FAIR","USED"];
  const sorted = [...deltas].sort((a,b)=>order.indexOf(a.condition_band)-order.indexOf(b.condition_band));

  return (
    <div className="mt-2 flex items-center gap-3">
      {data.windowDays && data.windowDays !== 60 && (
        <span className="text-xs opacity-60">(based on {data.windowDays}d)</span>
      )}
      <div className="flex flex-wrap gap-2">
        {sorted.map(({ condition_band, pct_vs_any }) => (
          <span key={condition_band} className="rounded-full border px-2 py-1 text-xs">
            {condition_band.replace("_"," ")}{" "}
            {Number(pct_vs_any) >= 0 ? `+${pct_vs_any}%` : `${pct_vs_any}%`}
          </span>
        ))}
      </div>
    </div>
  );
}
