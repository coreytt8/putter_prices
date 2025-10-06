// components/TopDealsGrid.jsx
import Link from "next/link";

const colorMap = {
  green: "bg-green-600 text-white",
  emerald: "bg-emerald-600 text-white",
  yellow: "bg-yellow-500 text-black",
  red: "bg-red-600 text-white",
};
function Badge({ grade }) {
  if (!grade) return null;
  const cls = colorMap[grade.color] || "bg-gray-700 text-white";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${cls}`}>
      {grade.letter || "?"} {grade.label ? `· ${grade.label}` : ""}
    </span>
  );
}

export default function TopDealsGrid({ deals = [] }) {
  if (!deals.length) return <p className="text-sm text-gray-500">No deals in the selected window.</p>;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {deals.map((d) => (
        <div key={d.bestOffer.itemId} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-base font-semibold leading-tight line-clamp-2">{d.label}</h3>
            <Badge grade={d.grade} />
          </div>
          {d.image ? (
            <img
              src={d.image}
              alt={d.label}
              className="mt-3 aspect-[4/3] w-full rounded-xl object-cover"
              loading="lazy"
            />
          ) : null}
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-gray-500">Best price</dt>
              <dd className="font-medium">
                {d.currency || "USD"} {d.bestPrice}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Median</dt>
              <dd className="font-medium">
                {d.currency || "USD"} {d.stats?.p50 ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Savings</dt>
              <dd className="font-medium">
                {d.currency || "USD"} {d.savings?.amount?.toFixed?.(2)}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Sample</dt>
              <dd className="font-medium">{d.stats?.n ?? "—"}</dd>
            </div>
          </dl>
          <div className="mt-4 flex items-center justify-between">
            <a
              href={d.bestOffer.url}
              className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
              target="_blank"
              rel="noopener noreferrer"
            >
              View on eBay
            </a>
            <span className="text-xs text-gray-500">
              window: {d.statsMeta?.lookbackHours ?? (d.statsMeta?.windowDays ? `${d.statsMeta.windowDays}d` : "—")}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
