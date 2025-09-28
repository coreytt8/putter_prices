import SmartPriceBadge from "@/components/SmartPriceBadge";

function formatCurrency(value, currency = "USD") {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

function formatPercent(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const pct = value * 100;
  const rounded = Math.abs(pct % 1) < 0.05 ? Math.round(pct) : Number(pct.toFixed(1));
  return `${rounded}%`;
}

function formatCount(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toLocaleString();
}

export default function PriceComparisonTable({ deals = [] }) {
  if (!Array.isArray(deals) || deals.length === 0) {
    return null;
  }

  const rankedDeals = deals
    .map((deal) => {
      const bestPrice = Number.isFinite(deal?.bestPrice) ? Number(deal.bestPrice) : null;
      const median = Number.isFinite(deal?.stats?.p50) ? Number(deal.stats.p50) : null;
      const fallbackSavingsAmount = Number.isFinite(deal?.savings?.amount)
        ? Number(deal.savings.amount)
        : null;
      const fallbackSavingsPercent = Number.isFinite(deal?.savings?.percent)
        ? Number(deal.savings.percent)
        : null;

      const computedSavingsAmount =
        Number.isFinite(median) && Number.isFinite(bestPrice) ? median - bestPrice : fallbackSavingsAmount;
      const computedSavingsPercent =
        Number.isFinite(median) && Number.isFinite(bestPrice) && median > 0
          ? (median - bestPrice) / median
          : fallbackSavingsPercent;

      const listingCount = Number.isFinite(deal?.totalListings)
        ? Number(deal.totalListings)
        : Number.isFinite(deal?.statsMeta?.listingCount)
          ? Number(deal.statsMeta.listingCount)
          : null;

      return {
        key: deal?.query || deal?.label || null,
        label: deal?.label || "Smart Price deal",
        currency: deal?.currency || "USD",
        bestPrice,
        median,
        savingsAmount: computedSavingsAmount,
        savingsPercent: computedSavingsPercent,
        listingCount,
        stats: deal?.stats || null,
        bestOffer: deal?.bestOffer || null,
      };
    })
    .sort((a, b) => {
      const pctA = Number.isFinite(a.savingsPercent) ? a.savingsPercent : -Infinity;
      const pctB = Number.isFinite(b.savingsPercent) ? b.savingsPercent : -Infinity;
      if (pctA !== pctB) return pctB - pctA;
      const amtA = Number.isFinite(a.savingsAmount) ? a.savingsAmount : -Infinity;
      const amtB = Number.isFinite(b.savingsAmount) ? b.savingsAmount : -Infinity;
      if (amtA !== amtB) return amtB - amtA;
      return (a.bestPrice || Infinity) - (b.bestPrice || Infinity);
    });

  return (
    <div className="mx-auto max-w-6xl px-6 pb-16 pt-4">
      <div className="overflow-hidden rounded-3xl border border-white/10 bg-slate-900/60 shadow-2xl shadow-emerald-500/10 backdrop-blur">
        <div className="border-b border-white/5 bg-white/5 px-6 py-5">
          <h2 className="text-xl font-semibold text-white sm:text-2xl">Smart Price comparison snapshot</h2>
          <p className="mt-1 text-sm text-slate-300">
            Ranked by verified savings so you can jump straight to the biggest market gaps right now.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-white/5 text-sm text-slate-200">
            <thead className="bg-white/5 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th scope="col" className="py-3 pl-6 pr-3 text-left font-medium text-slate-300">
                  Model
                </th>
                <th scope="col" className="px-3 py-3 text-left font-medium text-slate-300">
                  Smart Price ask
                </th>
                <th scope="col" className="px-3 py-3 text-left font-medium text-slate-300">
                  Median ask
                </th>
                <th scope="col" className="px-3 py-3 text-left font-medium text-slate-300">
                  Savings
                </th>
                <th scope="col" className="py-3 pl-3 pr-6 text-right font-medium text-slate-300">
                  Listings tracked
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rankedDeals.map((deal, index) => {
                const amountText = Number.isFinite(deal.savingsAmount)
                  ? formatCurrency(deal.savingsAmount, deal.currency)
                  : null;
                const percentText = Number.isFinite(deal.savingsPercent)
                  ? formatPercent(deal.savingsPercent)
                  : null;
                const savingsLabel = amountText && percentText
                  ? `${amountText} (${percentText})`
                  : amountText || percentText || "—";

                return (
                  <tr key={`${deal.key || "deal"}-${index}`} className="bg-slate-900/40 transition hover:bg-slate-900/70">
                    <th scope="row" className="whitespace-nowrap py-4 pl-6 pr-3 text-left">
                      <div className="flex items-start gap-3">
                        <span className="text-xs font-semibold text-emerald-300/80">#{index + 1}</span>
                        <div>
                          <p className="font-semibold text-white">{deal.label}</p>
                          <p className="mt-1 text-xs text-slate-400">
                            {Number.isFinite(deal.listingCount)
                              ? `${formatCount(deal.listingCount)} live listings tracked`
                              : "Live savings snapshot"}
                          </p>
                        </div>
                      </div>
                    </th>
                    <td className="px-3 py-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-base font-semibold text-emerald-300">
                          {formatCurrency(deal.bestPrice, deal.currency)}
                        </span>
                        <SmartPriceBadge
                          price={deal.bestPrice}
                          baseStats={deal.stats}
                          title={deal.bestOffer?.title}
                          specs={deal.bestOffer?.specs}
                          brand={deal.bestOffer?.brand}
                          className="shrink-0"
                        />
                      </div>
                    </td>
                    <td className="px-3 py-4 text-base font-medium text-slate-100">
                      {formatCurrency(deal.median, deal.currency)}
                    </td>
                    <td className="px-3 py-4 text-base font-medium text-emerald-200">
                      {savingsLabel}
                    </td>
                    <td className="py-4 pl-3 pr-6 text-right text-base font-medium text-slate-100">
                      {formatCount(deal.listingCount)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
