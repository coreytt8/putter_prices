// components/TopDealsGrid.jsx
import Link from "next/link";
import DealGradeBadge from "@/components/DealGradeBadge";
import RarityBadge from "@/components/RarityBadge";
import { formatFullModelName } from "@/lib/format-model";
import { buildCanonicalQuery } from "@/lib/search-normalize";

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

export default function TopDealsGrid({ items = [], deals = [] }) {
    const list = Array.isArray(items) && items.length ? items : deals;
    if (!Array.isArray(list) || list.length === 0) return null;

    return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {list.map((d) => {
                const id = d?.bestOffer?.id || d?.id || d?.url;
                const label = formatFullModelName({
                    brand: d?.brand || d?.bestOffer?.brand,
                    model: d?.model,
                    modelKey: d?.modelKey,
                    label: d?.label,
                    rawLabel: d?.rawLabel,
                    variantKey: d?.variantKey,
                    bestOfferTitle: d?.bestOffer?.title,
                    bestOffer: d?.bestOffer,
                });
                const bestPrice = Number.isFinite(Number(d?.bestPrice))
                    ? Number(d.bestPrice)
                    : Number(d?.bestOffer?.total ?? d?.bestOffer?.price);
                const currency = d?.currency || d?.bestOffer?.currency || "USD";
                const bandLabel = bandPretty(d?.stats?.usedBand || d?.conditionBand);
                const bandSampleRaw = Number(d?.statsMeta?.bandSampleSize);
                const bandSample = Number.isFinite(bandSampleRaw) && bandSampleRaw > 0 ? bandSampleRaw : null;
                const rarityTier = d?.rarityTier || d?.bestOffer?.rarityTier || null;
                const watchCountRaw = Number(d?.watchCount ?? d?.bestOffer?.watchCount);
                const watchCount = Number.isFinite(watchCountRaw) && watchCountRaw > 0 ? watchCountRaw : null;
                const premiumRaw = Number(d?.recentPremium ?? d?.premiumDelta ?? d?.savings?.percent ?? 0);
                const premiumPct = Number.isFinite(premiumRaw) ? premiumRaw : null;
                const canonicalQuery = buildCanonicalQuery({
                    brand: d?.brand || d?.bestOffer?.brand,
                    model: d?.model,
                    modelKey: d?.modelKey,
                    label: d?.rawLabel || d?.label,
                    rawLabel: d?.rawLabel,
                    variantKey: d?.variantKey,
                    rarityTier,
                    bestOfferTitle: d?.bestOffer?.title,
                    bestOffer: d?.bestOffer,
                });
                const latestHref = canonicalQuery
                    ? `/putters?q=${encodeURIComponent(canonicalQuery)}&view=flat`
                    : "/putters?view=flat";

                return (
                    <article
                        key={id || label}
                        className="flex h-full flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <h3
                                    className="text-base font-semibold leading-snug text-slate-900 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden"
                                >
                                    {label}
                                </h3>
                                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                    {d.grade ? <DealGradeBadge grade={d.grade} /> : null}
                                    <RarityBadge tier={rarityTier} />
                                    {bandLabel ? (
                                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-700">
                                            {bandLabel}
                                            {bandSample ? <span className="ml-1 opacity-70">n={bandSample}</span> : null}
                                        </span>
                                    ) : null}
                                </div>
                            </div>
                        </div>

                        <div>
                            <p className="text-xs text-slate-500">Best live price</p>
                            <p className="text-xl font-semibold text-slate-900">
                                {Number.isFinite(bestPrice) ? fmt(bestPrice, currency) : "—"}
                            </p>
                            <div className="mt-2 text-xs text-slate-500">
                                {watchCount ? <span>{watchCount.toLocaleString()} watchers</span> : null}
                                {watchCount && premiumPct ? <span className="mx-1">·</span> : null}
                                {premiumPct ? (
                                    <span>
                                        {premiumPct > 0
                                            ? `~${Math.round(premiumPct * 100)}% premium`
                                            : `~${Math.round(Math.abs(premiumPct * 100))}% savings`}
                                    </span>
                                ) : null}
                            </div>
                        </div>

                        <div className="mt-auto flex flex-wrap justify-end gap-2 text-xs">
                            {canonicalQuery ? (
                                <Link
                                    href={latestHref}
                                    className="inline-flex items-center justify-center rounded-full bg-slate-900 px-4 py-1.5 font-semibold text-white transition hover:bg-slate-700"
                                >
                                    See live listings
                                </Link>
                            ) : null}
                            {d.bestOffer?.url ? (
                                <a
                                    href={d.bestOffer.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center justify-center rounded-full border border-slate-300 px-4 py-1.5 font-semibold text-slate-700 transition hover:border-emerald-200 hover:text-emerald-700"
                                >
                                    View on eBay
                                </a>
                            ) : null}
                        </div>
                    </article>
                );
            })}
        </div>
    );
}
