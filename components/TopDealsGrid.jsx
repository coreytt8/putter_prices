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

const bandPretty = (b) => {
    if (!b || typeof b !== "string") return null;
    const upper = b.toUpperCase();
    if (upper === "ANY") return null;
    return upper.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};

export default function TopDealsGrid({ items = [] }) {
    if (!Array.isArray(items) || items.length === 0) return null;

    return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {items.map((d) => {
                const id = d?.bestOffer?.id || d?.id || d?.url;
                const label = d?.label || d?.model || "Live Smart Price deal";
                const bestPrice = Number.isFinite(Number(d?.bestPrice))
                    ? Number(d.bestPrice)
                    : Number(d?.bestOffer?.total ?? d?.bestOffer?.price);
                const currency = d?.currency || d?.bestOffer?.currency || "USD";
                const bandLabel = bandPretty(d?.stats?.usedBand);
                const bandSampleRaw = Number(d?.statsMeta?.bandSampleSize);
                const bandSample = Number.isFinite(bandSampleRaw) && bandSampleRaw > 0 ? bandSampleRaw : null;

                return (
                    <article
                        key={id || label}
                        className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <h3 className="truncate text-base font-semibold text-slate-900">{label}</h3>
                                {d.modelKey ? (
                                    <p className="mt-1 truncate text-xs text-slate-500">{d.modelKey}</p>
                                ) : null}
                            </div>
                            <div className="flex flex-col items-end gap-2">
                                {d.grade ? <DealGradeBadge grade={d.grade} /> : null}
                                {bandLabel ? (
                                    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-700">
                                        {bandLabel}
                                        {bandSample ? <span className="ml-1 opacity-70">n={bandSample}</span> : null}
                                    </span>
                                ) : null}
                            </div>
                        </div>

                        <div className="flex items-end justify-between gap-3">
                            <div>
                                <p className="text-xs text-slate-500">Best live price</p>
                                <p className="text-xl font-semibold text-slate-900">
                                    {Number.isFinite(bestPrice) ? fmt(bestPrice, currency) : "—"}
                                </p>
                            </div>
                            {d.bestOffer?.url ? (
                                <a
                                    href={d.bestOffer.url}
                                    className="inline-flex items-center rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-emerald-200 hover:text-emerald-700"
                                >
                                    View listing
                                </a>
                            ) : (
                                <span className="text-sm text-slate-500">No live link</span>
                            )}
                        </div>

                        {d.modelKey ? (
                            <div className="text-right text-xs">
                                <Link
                                    href={`/putters?model=${encodeURIComponent(d.modelKey)}`}
                                    className="font-medium text-emerald-700 hover:underline"
                                >
                                    Explore this model →
                                </Link>
                            </div>
                        ) : null}
                    </article>
                );
            })}
        </div>
    );
}
