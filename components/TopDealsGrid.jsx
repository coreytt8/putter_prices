// components/TopDealsGrid.jsx
import Link from "next/link";
import DealGradeBadge from "@/components/DealGradeBadge";

function fmt(n, currency = "USD") {
    if (typeof n !== "number" || !Number.isFinite(n)) return "—";
    try {
        return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
    } catch {
        return `$${n.toFixed(2)}`;
    }
}

export default function TopDealsGrid({ items = [] }) {
    if (!Array.isArray(items) || items.length === 0) return null;

    return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {items.map((d) => {
                const id = d?.bestOffer?.id || d?.id || d?.url;
                const label = d?.label || d?.model || "Live Smart Price deal";
                const best = Number(d?.bestOffer?.price);
                const stats = d?.stats || {};
                const n = Number(stats?.n ?? 0);

                return (
                    <article
                        key={id}
                        className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                    >
                        {/* Header */}
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <h3 className="truncate text-base font-semibold text-slate-900">{label}</h3>
                                <p className="mt-1 text-xs text-slate-500">
                                    {n > 0 ? <>Median p50 tracked • n={n}</> : <>Building baseline…</>}
                                </p>
                            </div>
                            {/* Deal grade pill (reuses site-wide badge) */}
                            {d.grade ? <DealGradeBadge grade={d.grade} /> : null}
                        </div>

                        {/* Body */}
                        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                            <div>
                                <dt className="text-slate-500">Best live ask</dt>
                                <dd className="font-medium">
                                    {Number.isFinite(best) ? fmt(best, d.currency || "USD") : "—"}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-slate-500">Median (p50)</dt>
                                <dd className="font-medium">
                                    {Number.isFinite(stats?.p50) ? fmt(stats.p50, d.currency || "USD") : "—"}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-slate-500">Savings vs p50</dt>
                                <dd className="font-medium">
                                    {Number.isFinite(best) && Number.isFinite(stats?.p50) && stats.p50 > 0
                                        ? `${Math.round(((best - stats.p50) / stats.p50) * -100)}%`
                                        : "—"}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-slate-500">Sample size</dt>
                                <dd className="font-medium">{n || "—"}</dd>
                            </div>
                        </dl>

                        {/* CTA */}
                        <div className="mt-4 flex items-center justify-between">
                            {d.bestOffer?.url ? (
                                <a
                                    href={d.bestOffer.url}
                                    className="inline-flex items-center rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                                >
                                    View listing
                                </a>
                            ) : (
                                <span className="text-sm text-slate-500">No live link</span>
                            )}
                            {d.modelKey ? (
                                <Link
                                    href={`/putters?model=${encodeURIComponent(d.modelKey)}`}
                                    className="text-sm font-medium text-emerald-700 hover:underline"
                                >
                                    See model page →
                                </Link>
                            ) : null}
                        </div>
                    </article>
                );
            })}
        </div>
    );
}
