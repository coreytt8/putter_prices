import Link from "next/link";
import { headers } from "next/headers";
import SmartPriceBadge from "@/components/SmartPriceBadge";
import DealGradeBadge from "@/components/DealGradeBadge";
import MarketSnapshot from "@/components/MarketSnapshot";
import HeroSection from "@/components/HeroSection";
import SectionWrapper from "@/components/SectionWrapper";
import TopDealsGrid from "@/components/TopDealsGrid";
import PriceComparisonTable from "@/components/PriceComparisonTable";
import TrendingSparkline from "@/components/TrendingSparkline";
import { sanitizeModelKey } from "@/lib/sanitizeModelKey";
import { formatFullModelName } from "@/lib/format-model";
import { buildCanonicalQuery } from "@/lib/search-normalize";

const DEFAULT_SNAPSHOT_QUERY = "golf putter";

/**
 * Examples:
 * sanitizeModelKey("Titleist|Scotty Cameron|Super Select|Cameron");
 * // => { label: "Super Select", query: "Scotty Cameron Super Select" }
 *
 * sanitizeModelKey("Odyssey|White Hot OG|2-Ball|35");
 * // => { label: "White Hot OG 2-Ball 35", query: "Odyssey White Hot OG 2-Ball" }
 *
 * sanitizeModelKey("mint TaylorMade my spider tour x x3 34.5 putter");
 * // => { label: "mint TaylorMade my spider tour x x3 34.5 putter", query: "TaylorMade my spider tour x x3 putter" }
 */

function formatCurrency(value, currency = "USD") {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

function safeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

async function resolveBaseUrl() {
  const hdrs = await headers();
  const forwardedHost = hdrs.get("x-forwarded-host");
  const host = forwardedHost || hdrs.get("host");
  if (host) {
    const protoHeader = hdrs.get("x-forwarded-proto");
    const protocol = protoHeader || (host.includes("localhost") ? "http" : "https");
    return `${protocol}://${host}`;
  }
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

async function fetchJson(url, init) {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function Home() {
  const baseUrl = await resolveBaseUrl();

  const topDealsPromise = fetchJson(`${baseUrl}/api/top-deals?cache=1&fast=1`, {
    next: { revalidate: 60 },
  });

  const trendingPromise = fetchJson(`${baseUrl}/api/models/search?q=putter`, {
    next: { revalidate: 300 },
  });

  const snapshotPromise = fetchJson(
    `${baseUrl}/api/putters?q=${encodeURIComponent(DEFAULT_SNAPSHOT_QUERY)}`,
    {
      next: { revalidate: 300 },
    }
  );

  const collectorModeEnabled = process.env.COLLECTOR_MODE === "1";

  const [topDealsRes, trendingRes, snapshotResponse] = await Promise.all([
    topDealsPromise,
    trendingPromise,
    snapshotPromise,
  ]);

  const dealsRaw = Array.isArray(topDealsRes?.deals) ? topDealsRes.deals : [];

  const deals = dealsRaw.map((item) => {
    const rawLabel = typeof item?.label === "string" ? item.label : "";
    const displayLabel = formatFullModelName({
      brand: item?.brand || item?.bestOffer?.brand,
      model: item?.model,
      modelKey: item?.modelKey,
      label: rawLabel,
      rawLabel,
      variantKey: item?.variantKey,
      bestOfferTitle: item?.bestOffer?.title,
      bestOffer: item?.bestOffer,
    });
    const bestPrice = safeNumber(item?.bestPrice ?? item?.bestOffer?.total ?? item?.bestOffer?.price);
    const currency = item?.currency || item?.bestOffer?.currency || "USD";
    const savingsAmount = safeNumber(item?.savings?.amount);
    const savingsPercent = safeNumber(item?.savings?.percent);
    const hasGrade = item && typeof item === "object" && item.grade && typeof item.grade === "object";
    const gradeLetter = hasGrade && typeof item.grade.letter === "string" ? item.grade.letter : null;
    const gradeLabel = hasGrade && typeof item.grade.label === "string" ? item.grade.label : null;
    const gradeColor = hasGrade && typeof item.grade.color === "string" ? item.grade.color : null;
    const gradeDeltaPct = safeNumber(item?.grade?.deltaPct);
    const roundedPct = Number.isFinite(savingsPercent) ? Math.round(savingsPercent * 100) : null;
    const blurb =
      item?.blurb ||
      (Number.isFinite(roundedPct)
        ? `Smart Price spotted about ${roundedPct}% below the typical ask on this model today.`
        : "Smart Price benchmarks every live listing against fresh percentile baselines to surface real savings.");

    return {
      label: displayLabel,
      displayLabel,
      rawLabel,
      query: item?.query || item?.modelKey || DEFAULT_SNAPSHOT_QUERY,
      blurb,
      group: item?.group || null,
      bestOffer: item?.bestOffer || null,
      stats: item?.stats || null,
      statsMeta: item?.statsMeta || null,
      modelKey: item?.modelKey || null,
      model: item?.model || null,
      brand: item?.brand || item?.bestOffer?.brand || null,
      variantKey: item?.variantKey || null,
      category: typeof item?.category === "string" ? item.category : null,
      rarityTier: typeof item?.rarityTier === "string" ? item.rarityTier : null,
      conditionBand: typeof item?.conditionBand === "string" ? item.conditionBand : null,
      bestPrice: Number.isFinite(bestPrice) ? bestPrice : null,
      currency,
      image: item?.image || item?.bestOffer?.image || null,
      totalListings: safeNumber(item?.totalListings),
      grade: hasGrade
        ? {
            letter: gradeLetter,
            label: gradeLabel,
            color: gradeColor,
            deltaPct: Number.isFinite(gradeDeltaPct) ? gradeDeltaPct : null,
          }
        : null,
      savings: {
        amount: Number.isFinite(savingsAmount) ? savingsAmount : null,
        percent: Number.isFinite(savingsPercent) ? savingsPercent : null,
      },
      watchCount: safeNumber(item?.watchCount ?? item?.bestOffer?.watchCount),
      premiumDelta: safeNumber(item?.recentPremium ?? item?.premiumDelta ?? item?.savings?.percent),
    };
  });

  const rarityRank = (tier) => {
    const normalized = typeof tier === "string" ? tier.toLowerCase() : "";
    if (normalized.includes("tour")) return 0;
    if (normalized.includes("limit")) return 1;
    if (normalized.includes("retail")) return 2;
    return 3;
  };

  const sortedCollectorPutters = collectorModeEnabled
    ? deals
        .filter((deal) => (deal?.category || "").toLowerCase() === "putter")
        .slice()
        .sort((a, b) => {
          const rankDiff = rarityRank(a?.rarityTier) - rarityRank(b?.rarityTier);
          if (rankDiff !== 0) return rankDiff;
          const savingsA = Number.isFinite(a?.savings?.percent) ? a.savings.percent : 0;
          const savingsB = Number.isFinite(b?.savings?.percent) ? b.savings.percent : 0;
          return savingsB - savingsA;
        })
        .slice(0, 6)
    : [];

  const sortedHeadcovers = collectorModeEnabled
    ? deals
        .filter((deal) => (deal?.category || "").toLowerCase() === "headcover")
        .slice()
        .sort((a, b) => {
          const watchA = Number.isFinite(a?.watchCount) ? a.watchCount : 0;
          const watchB = Number.isFinite(b?.watchCount) ? b.watchCount : 0;
          if (watchA !== watchB) return watchB - watchA;
          const premiumA = Number.isFinite(a?.premiumDelta) ? a.premiumDelta : 0;
          const premiumB = Number.isFinite(b?.premiumDelta) ? b.premiumDelta : 0;
          return premiumB - premiumA;
        })
        .slice(0, 6)
    : [];

  const prioritizedDeals = collectorModeEnabled ? deals.slice(0, 12) : deals;

  const trending = Array.isArray(trendingRes?.models)
    ? trendingRes.models.slice(0, 6).map((m) => {
        const modelKey = m?.model_key || "";
        const { label, query } = sanitizeModelKey(modelKey);
        return {
          modelKey,
          label,
          query,
          count: Number(m?.cnt || m?.count || 0) || 0,
        };
      })
    : [];

  const heroSnapshot = snapshotResponse?.analytics?.snapshot || null;
  const snapshotMeta = snapshotResponse?.meta || null;
  const snapshotSampleSize =
    Number(snapshotMeta?.sampleSize) ||
    (Array.isArray(heroSnapshot?.price?.histogram)
      ? heroSnapshot.price.histogram.reduce((total, bucket) => total + (bucket || 0), 0)
      : 0);

  const snapshotQuery =
    deals.find((deal) => deal?.query)?.query ||
    trending.find((item) => item?.query)?.query ||
    DEFAULT_SNAPSHOT_QUERY;

  const smartExample =
    deals.find(
      (deal) =>
        deal &&
        Number.isFinite(deal.bestPrice) &&
        Number.isFinite(deal?.stats?.p50) &&
        deal.bestOffer
    ) ||
    deals.find((deal) => deal && Number.isFinite(deal.bestPrice) && deal.bestOffer) ||
    null;

  const exampleMedian = Number.isFinite(smartExample?.stats?.p50)
    ? Number(smartExample?.stats?.p50)
    : null;
  const exampleGap =
    Number.isFinite(exampleMedian) && Number.isFinite(smartExample?.bestPrice)
      ? exampleMedian - smartExample.bestPrice
      : null;
  const exampleSavings =
    Number.isFinite(exampleMedian) && Number.isFinite(smartExample?.bestPrice) && exampleMedian !== 0
      ? ((exampleMedian - smartExample.bestPrice) / exampleMedian) * 100
      : null;

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <HeroSection>
        <div className="text-center">
          <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-4 py-1 text-sm font-semibold text-emerald-200 ring-1 ring-inset ring-emerald-400/30">
            Live eBay market intelligence
          </span>
          <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl">
            Spot verified putter deals before they disappear.
          </h1>
          <p className="mt-6 text-lg leading-8 text-slate-200">
            {smartExample && exampleMedian && Number.isFinite(exampleGap) && exampleGap > 0 ? (
              <>
                Smart Price watches every live putter listing and compares it to recent live listing percentiles. Right now it has {smartExample.label}
                {" "}
                sitting at {formatCurrency(smartExample.bestPrice, smartExample.currency)}, about
                {" "}
                {formatCurrency(exampleGap, smartExample.currency)} below the typical {formatCurrency(exampleMedian, smartExample.currency)} ask
                {exampleSavings !== null
                  ? `—roughly ${Math.round(exampleSavings)}% in savings`
                  : ""}
                , confirmed by the Smart Price badge.
              </>
            ) : (
              <>Smart Price watches every live putter listing and compares it to recent live listing percentiles so verified savings surface automatically.</>
            )}
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/putters"
              className="inline-flex items-center justify-center rounded-full bg-emerald-500 px-6 py-3 text-base font-semibold text-slate-950 shadow-lg shadow-emerald-500/40 transition hover:bg-emerald-400"
            >
              Browse live deals
            </Link>
            {snapshotQuery && (
              <Link
                href={`/putters?q=${encodeURIComponent(snapshotQuery)}`}
                className="inline-flex items-center justify-center rounded-full bg-white/10 px-6 py-3 text-base font-semibold text-white ring-1 ring-inset ring-white/20 transition hover:bg-white/20"
              >
                View the market snapshot
              </Link>
            )}
          </div>
          <p className="mt-3 text-sm text-emerald-200">
            We send you to the best eBay listing with verified savings.
          </p>

          {smartExample ? (
            <div className="mx-auto mt-8 max-w-3xl rounded-2xl border border-white/10 bg-white/5 p-6 text-left backdrop-blur">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm uppercase tracking-wide text-emerald-200/80">How Smart Price works</p>
                  <h2 className="mt-2 text-xl font-semibold text-white">
                    {smartExample.label}: {formatCurrency(smartExample.bestPrice, smartExample.currency)} vs median {formatCurrency(exampleMedian, smartExample.currency)}
                  </h2>
                  <p className="mt-2 text-sm text-slate-200">
                    {exampleSavings !== null
                      ? `We compare every listing against recent live listing percentiles. This one sits about ${Math.round(exampleSavings)}% below the typical asking price, so Smart Price flags it automatically.`
                      : "We compare every listing against recent live listing percentiles. Smart Price highlights the standouts as soon as fresh baseline data confirms the savings."}
                  </p>
                </div>
                <div className="flex flex-col items-start gap-2">
                  <SmartPriceBadge
                    price={smartExample.bestPrice}
                    baseStats={smartExample.stats}
                    title={smartExample.bestOffer?.title}
                    specs={smartExample.bestOffer?.specs}
                    brand={smartExample.bestOffer?.brand}
                  />
                  {smartExample.grade ? <DealGradeBadge grade={smartExample.grade} /> : null}
                </div>
              </div>
            </div>
          ) : (
            <div className="mx-auto mt-8 max-w-3xl rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-sm text-slate-200 backdrop-blur">
              Smart Price is crunching today&apos;s listings. Fresh deal examples appear here as soon as we validate the savings against updated live listing percentiles.
            </div>
          )}
        </div>


        {heroSnapshot && (
          <div className="mt-16">
            <MarketSnapshot
              snapshot={heroSnapshot}
              meta={snapshotMeta}
              query={snapshotQuery || DEFAULT_SNAPSHOT_QUERY}
            />
          </div>
        )}
      </HeroSection>

      <PriceComparisonTable deals={deals} />

      <SectionWrapper variant="light">
        <div className="space-y-16">
          {collectorModeEnabled && sortedCollectorPutters.length > 0 ? (
            <div>
              <div className="max-w-3xl">
                <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Top Collector Putters</h2>
                <p className="mt-4 text-base text-slate-600">
                  Smart Price surfaces the most desirable tour and limited runs with verified below-median asks pulled from the live feed.
                </p>
              </div>
              <div className="mt-8">
                <TopDealsGrid items={sortedCollectorPutters} />
              </div>
            </div>
          ) : null}

          {collectorModeEnabled && sortedHeadcovers.length > 0 ? (
            <div>
              <div className="max-w-3xl">
                <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Most Watched Headcovers</h2>
                <p className="mt-4 text-base text-slate-600">
                  High-attention headcovers ranked by live watcher counts and recent premiums so you can jump on the hottest drops first.
                </p>
              </div>
              <div className="mt-8">
                <TopDealsGrid items={sortedHeadcovers} />
              </div>
            </div>
          ) : null}

          <div>
            <div className="max-w-3xl">
              <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                {collectorModeEnabled
                  ? "Undervalued Collector Finds"
                  : "Today&apos;s best deals pulled straight from live listings"}
              </h2>
              <p className="mt-4 text-base text-slate-600">
                {collectorModeEnabled
                  ? `Daily shortlist of Smart Price-verified collector listings sitting below live medians across the marketplace.`
                  : `These models currently have ${deals.filter((d) => Number.isFinite(d.bestPrice)).length} Smart Price-verified listings with market-leading asks. Click through for filtered searches that stay synced with the live feed.`}
              </p>
            </div>
            <div className="mt-8">
              {prioritizedDeals.length === 0 ? (
                <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-slate-600">
                  Smart Price is refreshing today&apos;s leaderboard—check back soon for verified deals.
                </div>
              ) : (
                <TopDealsGrid items={prioritizedDeals} />
              )}
            </div>
          </div>
        </div>
      </SectionWrapper>

      <SectionWrapper variant="muted">
          <div className="max-w-3xl">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Trending models on eBay</h2>
            <p className="mt-4 text-base text-slate-600">
              Our database looks across the last 90 days of live listing history to highlight where buyer attention is spiking. Jump straight into a focused search for each hot model.
            </p>
          </div>
          <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {trending.map((item) => {
              const params = new URLSearchParams();
              if (item.query) params.set("q", item.query);
              if (item.modelKey) params.set("modelKey", item.modelKey);
              const qs = params.toString();
              const href = qs ? `/putters?${qs}` : "/putters";

              return (
                <div key={item.modelKey} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p className="text-sm uppercase tracking-wide text-slate-500">Trending search</p>
                  <h3 className="mt-2 text-xl font-semibold text-slate-900">{item.label || "Model updating"}</h3>
                  <p className="mt-2 text-sm text-slate-600">
                    {item.count > 0
                      ? `${item.count.toLocaleString()} recent listings tracked`
                      : "Pulling market counts…"}
                  </p>
                  <TrendingSparkline modelKey={item.modelKey} />
                  <div className="mt-6">
                    <Link
                      href={href}
                      className="inline-flex items-center rounded-full bg-emerald-500 px-5 py-2 text-sm font-semibold text-slate-950 shadow-sm transition hover:bg-emerald-400"
                    >
                      Explore this model
                    </Link>
                    <p className="mt-2 text-xs text-emerald-600">
                      We send you to the best eBay listing with verified savings.
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
      </SectionWrapper>

      <SectionWrapper variant="light" containerClassName="max-w-5xl">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Why PutterIQ is different</h2>
          <div className="mt-8 grid gap-8 md:grid-cols-2">
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
              <h3 className="text-xl font-semibold text-slate-900">Deal intelligence built-in</h3>
              <p className="mt-3 text-sm text-slate-600">
                Smart Price badges benchmark every listing against live percentile data. For example, the {smartExample?.label || "featured"} search we just ran surfaced a {smartExample ? formatCurrency(smartExample.bestPrice, smartExample.currency) : "live"} listing versus a typical median of {exampleMedian ? formatCurrency(exampleMedian, smartExample?.currency) : "—"}, flagging the savings automatically.
              </p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
              <h3 className="text-xl font-semibold text-slate-900">Real-market baselines</h3>
              <p className="mt-3 text-sm text-slate-600">
                Market Snapshot tiles use the same raw listings you&apos;ll browse—
                {snapshotSampleSize ? `${snapshotSampleSize.toLocaleString()} pulled moments ago` : "live samples updating"}
                —to show price distributions, condition mixes, and buying options without guessing.
              </p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
              <h3 className="text-xl font-semibold text-slate-900">One-click affiliate routing</h3>
              <p className="mt-3 text-sm text-slate-600">
                Every CTA jumps straight into a pre-filtered /putters search. When you click through, we route you to the best eBay listing with EPN affiliate tracking so you get the savings and we keep the lights on.
              </p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
              <h3 className="text-xl font-semibold text-slate-900">Trusted seller signals</h3>
              <p className="mt-3 text-sm text-slate-600">
                Listings include seller feedback, shipping costs, and return windows pulled directly from eBay. Combine that with Smart Price and you can focus on specs that matter—length, head shape, and premium variants.
              </p>
            </div>
          </div>
          <div className="mt-12 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/putters"
              className="inline-flex items-center justify-center rounded-full bg-slate-900 px-6 py-3 text-base font-semibold text-white shadow-lg transition hover:bg-slate-700"
            >
              Start browsing putters
            </Link>
            <p className="text-sm text-emerald-600">
              We send you to the best eBay listing with verified savings.
            </p>
          </div>
      </SectionWrapper>
    </main>
  );
}
