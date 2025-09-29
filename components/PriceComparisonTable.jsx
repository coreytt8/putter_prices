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
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return `${Math.round(value)}%`;
}

export default function PriceComparisonTable({ deals = [] }) {
  const rows = Array.isArray(deals)
    ? deals.map((deal, index) => {
        const bestPrice = Number.isFinite(deal?.bestPrice) ? Number(deal.bestPrice) : null;
        const currency = deal?.currency || deal?.bestOffer?.currency || "USD";
        const median = Number.isFinite(deal?.stats?.p50) ? Number(deal.stats.p50) : null;
        const totalListings = Number.isFinite(deal?.totalListings) ? Number(deal.totalListings) : null;

        const rawSavings =
          Number.isFinite(median) && Number.isFinite(bestPrice) ? median - bestPrice : null;
        const hasPositiveSavings = Number.isFinite(rawSavings) && rawSavings > 0;

        const percentSavings =
          hasPositiveSavings && Number.isFinite(median) && median !== 0
            ? (rawSavings / median) * 100
            : null;

        return {
          key: deal?.query || (deal?.label ? `${deal.label}-${index}` : `deal-${index}`),
          deal,
          label: deal?.label || "Model updating",
          bestPrice,
          median,
          totalListings,
          currency,
          rawSavings,
          hasPositiveSavings,
          percentSavings,
        };
      })
    : [];

  if (!rows.length) {
    return null;
  }

  return (
    <section className="bg-slate-100 px-6 py-16 text-slate-900">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Smart Price leaderboard</h2>
          <p className="mt-3 text-base text-slate-600">
            Compare today&apos;s top ranked putter deals at a glance. Smart Price monitors every live listing and
            highlights the models with verified savings confirmed by live percentile baselines.
          </p>
        </div>

        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="hidden overflow-x-auto md:block">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Model
                  </th>
                  <th scope="col" className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Best live ask
                  </th>
                  <th scope="col" className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Median live ask
                  </th>
                  <th scope="col" className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Savings
                  </th>
                  <th scope="col" className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Listings
                  </th>
                  <th scope="col" className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Tier
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {rows.map((row) => {
                  const { deal, label, bestPrice, median, rawSavings, hasPositiveSavings, percentSavings, totalListings } = row;
                  const savingsLabel = hasPositiveSavings
                    ? `${formatCurrency(rawSavings, row.currency)}${
                        percentSavings ? ` (${formatPercent(percentSavings)})` : ""
                      }`
                    : "—";

                  return (
                    <tr key={row.key} className="align-top">
                      <td className="px-6 py-4 text-sm font-semibold text-slate-900">
                        <div>{label}</div>
                        {Number.isFinite(totalListings) && totalListings > 0 && (
                          <div className="mt-1 text-xs text-slate-500">Tracking {totalListings} live listings</div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm font-medium text-slate-900">
                        {Number.isFinite(bestPrice) ? formatCurrency(bestPrice, row.currency) : "—"}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-700">
                        {Number.isFinite(median) ? formatCurrency(median, row.currency) : "—"}
                      </td>
                      <td className="px-6 py-4 text-sm text-emerald-600">{savingsLabel}</td>
                      <td className="px-6 py-4 text-sm text-slate-700">
                        {Number.isFinite(totalListings) ? totalListings : "—"}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        {Number.isFinite(bestPrice) ? (
                          <SmartPriceBadge
                            price={bestPrice}
                            baseStats={deal?.stats}
                            title={deal?.bestOffer?.title}
                            specs={deal?.bestOffer?.specs}
                            brand={deal?.bestOffer?.brand}
                          />
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="space-y-4 p-4 md:hidden">
            {rows.map((row) => {
              const { deal, label, bestPrice, median, rawSavings, hasPositiveSavings, percentSavings, totalListings } = row;
              const savingsLabel = hasPositiveSavings
                ? `${formatCurrency(rawSavings, row.currency)}${
                    percentSavings ? ` (${formatPercent(percentSavings)})` : ""
                  }`
                : "—";

              return (
                <div key={`${row.key}-mobile`} className="rounded-2xl border border-slate-200 bg-white/60 p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-semibold text-slate-900">{label}</p>
                      {Number.isFinite(totalListings) && totalListings > 0 && (
                        <p className="mt-1 text-xs text-slate-500">Tracking {totalListings} live listings</p>
                      )}
                    </div>
                    {Number.isFinite(bestPrice) ? (
                      <SmartPriceBadge
                        price={bestPrice}
                        baseStats={deal?.stats}
                        title={deal?.bestOffer?.title}
                        specs={deal?.bestOffer?.specs}
                        brand={deal?.bestOffer?.brand}
                      />
                    ) : null}
                  </div>
                  <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Best live ask</dt>
                      <dd className="mt-1 text-slate-900">
                        {Number.isFinite(bestPrice) ? formatCurrency(bestPrice, row.currency) : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Median live ask</dt>
                      <dd className="mt-1 text-slate-700">
                        {Number.isFinite(median) ? formatCurrency(median, row.currency) : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Savings</dt>
                      <dd className="mt-1 text-emerald-600">{savingsLabel}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Listings</dt>
                      <dd className="mt-1 text-slate-700">
                        {Number.isFinite(totalListings) ? totalListings : "—"}
                      </dd>
                    </div>
                  </dl>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
