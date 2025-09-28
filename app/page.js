import Link from "next/link";
import { headers } from "next/headers";
import SmartPriceBadge from "@/components/SmartPriceBadge";
import MarketSnapshot from "@/components/MarketSnapshot";
import HeroSection from "@/components/HeroSection";
import SectionWrapper from "@/components/SectionWrapper";
import HighlightCard from "@/components/HighlightCard";

const DEFAULT_SNAPSHOT_QUERY = "golf putter";

const BRAND_PATTERNS = [
  { key: "Scotty Cameron", pattern: /scotty\s+cameron/i },
  { key: "TaylorMade", pattern: /taylormade|tm\b/i },
  { key: "Ping", pattern: /\bping\b/i },
  { key: "Odyssey", pattern: /odyssey/i },
  { key: "Bettinardi", pattern: /bettinardi/i },
  { key: "Callaway", pattern: /callaway/i },
  { key: "L.A.B. Golf", pattern: /\blab\b|lie\s*angle\s*balance/i },
  { key: "Evnroll", pattern: /evnroll/i },
  { key: "Mizuno", pattern: /mizuno/i },
  { key: "Cobra", pattern: /\bcobra\b/i },
  { key: "Wilson", pattern: /wilson/i },
];

const BRAND_SYNONYMS = {
  "Scotty Cameron": ["Titleist"],
  Odyssey: ["Callaway"],
};

const BRAND_ALIASES = new Map(
  BRAND_PATTERNS.map((brand) => {
    const aliases = [brand.key, ...(BRAND_SYNONYMS[brand.key] || [])];
    return [brand.key, aliases];
  })
);

const BRAND_ALIAS_LOOKUP = new Map();
Object.entries(BRAND_SYNONYMS).forEach(([brand, aliases]) => {
  aliases.forEach((alias) => {
    BRAND_ALIAS_LOOKUP.set(alias.toLowerCase(), brand);
  });
});

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
function sanitizeModelKey(rawKey = "") {
  if (!rawKey) {
    return {
      label: "Model updating",
      query: "",
    };
  }

  const segments = String(rawKey)
    .split(/::|\|/g)
    .map((segment) => segment.trim())
    .filter(Boolean);

  const working = segments.join(" ");
  const brandMatches = new Map();
  const recordMatch = (brand, index, source) => {
    if (!brand) return;
    const normalizedBrand = brand.toLowerCase();
    const synonyms = BRAND_SYNONYMS[brand] || [];
    const basePriority = source === "pattern" ? 2 : 1;
    const priority = basePriority + (synonyms.length ? 1 : 0);
    const existing = brandMatches.get(normalizedBrand);
    if (
      !existing ||
      priority > existing.priority ||
      (priority === existing.priority && brand.length > existing.brand.length)
    ) {
      brandMatches.set(normalizedBrand, { brand, index, priority });
    }
  };

  segments.forEach((segment, index) => {
    const normalizedSegment = segment.toLowerCase();
    BRAND_PATTERNS.forEach((brand) => {
      if (!brand?.pattern) return;
      if (brand.pattern.test(segment) || normalizedSegment === brand.key.toLowerCase()) {
        recordMatch(brand.key, index, "pattern");
      }
    });
    const aliasBrand = BRAND_ALIAS_LOOKUP.get(normalizedSegment);
    if (aliasBrand) {
      recordMatch(aliasBrand, index, "alias");
    }
  });

  let detectedBrand = null;
  if (brandMatches.size) {
    let candidates = Array.from(brandMatches.values());
    const normalizedCandidates = new Set(candidates.map((c) => c.brand.toLowerCase()));
    const filtered = candidates.filter((candidate) => {
      const canonicalBrand = BRAND_ALIAS_LOOKUP.get(candidate.brand.toLowerCase());
      if (!canonicalBrand) return true;
      return !normalizedCandidates.has(canonicalBrand.toLowerCase());
    });
    if (filtered.length) {
      candidates = filtered;
    }
    const winner = candidates.reduce((best, candidate) => {
      if (!best) return candidate;
      if (candidate.priority !== best.priority) {
        return candidate.priority > best.priority ? candidate : best;
      }
      if (candidate.brand.length !== best.brand.length) {
        return candidate.brand.length > best.brand.length ? candidate : best;
      }
      return candidate.index < best.index ? candidate : best;
    }, null);
    detectedBrand = winner ? winner.brand : null;
  }

  const aliasList = detectedBrand ? BRAND_ALIASES.get(detectedBrand) || [detectedBrand] : [];
  const aliasSet = new Set(aliasList.map((alias) => alias.toLowerCase()));
  const filteredSegments = detectedBrand
    ? segments.filter((segment) => !aliasSet.has(segment.toLowerCase()))
    : segments;

  let label = filteredSegments.join(" ").trim();

  if (detectedBrand && label) {
    const aliasTokens = new Set();
    aliasList.forEach((alias) => {
      alias
        .split(/\s+/)
        .filter(Boolean)
        .forEach((token) => aliasTokens.add(token.toLowerCase()));
    });
    const words = label.split(/\s+/);
    while (words.length && aliasTokens.has(words[0].toLowerCase())) {
      words.shift();
    }
    while (words.length && aliasTokens.has(words[words.length - 1].toLowerCase())) {
      words.pop();
    }
    label = words.join(" ");
  }

  const fallbackText = working || String(rawKey).trim();
  const cleanedLabel = label.trim();
  const humanLabel = cleanedLabel || fallbackText;

  const lengthTokenPattern = /^\d+(?:\.\d+)?(?:(?:in)|["”])?$/i;
  const descriptorTokens = new Set([
    "mint",
    "brand",
    "brand-new",
    "brandnew",
    "new",
    "like-new",
    "likenew",
    "used",
    "excellent",
    "good",
    "great",
    "condition",
    "nr",
    "nib",
  ]);
  const searchTokens = cleanedLabel
    ? cleanedLabel
        .split(/\s+/)
        .filter((token) => {
          if (!token || lengthTokenPattern.test(token)) return false;
          const normalized = token.toLowerCase();
          return !descriptorTokens.has(normalized);
        })
    : [];
  const searchText = searchTokens.join(" ").trim();

  let query = "";
  if (searchText && detectedBrand) {
    const lowerSearch = searchText.toLowerCase();
    const searchStartsWithBrand = aliasList.some((alias) =>
      lowerSearch.startsWith(alias.toLowerCase())
    );
    query = searchStartsWithBrand ? searchText : `${detectedBrand} ${searchText}`.trim();
  } else if (searchText) {
    query = searchText;
  }

  if (!query) {
    query = fallbackText;
  }

  return {
    label: humanLabel,
    query,
  };
}

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

function detectBrandFromTitle(title = "") {
  for (const entry of BRAND_PATTERNS) {
    if (entry.pattern.test(title)) return entry.key;
  }
  return null;
}

function buildSnapshotFromOffers(offers = []) {
  const priceValues = offers
    .map((o) => {
      const total = Number(o?.total);
      const price = Number(o?.price);
      if (Number.isFinite(total)) return total;
      if (Number.isFinite(price)) return price;
      return null;
    })
    .filter((v) => Number.isFinite(v));

  if (!priceValues.length) return null;

  const min = Math.min(...priceValues);
  const max = Math.max(...priceValues);
  const avg = priceValues.reduce((acc, val) => acc + val, 0) / priceValues.length;

  const bucketCount = Math.min(7, Math.max(4, Math.ceil(Math.sqrt(priceValues.length))));
  const range = Math.max(max - min, 1);
  const bucketSize = range / bucketCount;
  const histogram = Array.from({ length: bucketCount }, () => 0);
  const buckets = [];

  for (let i = 0; i < bucketCount; i++) {
    buckets.push(Math.round(min + bucketSize * (i + 1)));
  }

  for (const value of priceValues) {
    const idx = Math.min(bucketCount - 1, Math.floor((value - min) / bucketSize));
    histogram[idx] += 1;
  }

  const conditionCounts = new Map();
  const buyingCounts = new Map();
  const brandCounts = new Map();

  offers.forEach((offer) => {
    const condition = String(offer?.condition || "").trim();
    if (condition) {
      const key = condition.toUpperCase();
      conditionCounts.set(key, (conditionCounts.get(key) || 0) + 1);
    }

    const buyingTypes = Array.isArray(offer?.buying?.types) ? offer.buying.types : [];
    buyingTypes.forEach((type) => {
      const key = String(type || "").trim();
      if (!key) return;
      buyingCounts.set(key, (buyingCounts.get(key) || 0) + 1);
    });

    const brand = detectBrandFromTitle(String(offer?.title || ""));
    if (brand) {
      brandCounts.set(brand, (brandCounts.get(brand) || 0) + 1);
    }
  });

  const conditions = Array.from(conditionCounts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => (b.count || 0) - (a.count || 0));

  const buyingOptions = Array.from(buyingCounts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => (b.count || 0) - (a.count || 0));

  const brandsTop = Array.from(brandCounts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => (b.count || 0) - (a.count || 0))
    .slice(0, 6);

  return {
    price: {
      min,
      max,
      avg,
      histogram,
      buckets,
    },
    conditions,
    buyingOptions,
    brandsTop,
  };
}

export default async function Home() {
  const baseUrl = await resolveBaseUrl();

  const topDealsRes = await fetchJson(`${baseUrl}/api/top-deals`, {
    next: { revalidate: 300 },
  });

  const dealsRaw = Array.isArray(topDealsRes?.deals) ? topDealsRes.deals : [];

  const deals = dealsRaw.map((item) => {
    const bestPrice = safeNumber(item?.bestPrice ?? item?.bestOffer?.total ?? item?.bestOffer?.price);
    const currency = item?.currency || item?.bestOffer?.currency || "USD";
    const savingsAmount = safeNumber(item?.savings?.amount);
    const savingsPercent = safeNumber(item?.savings?.percent);
    const roundedPct = Number.isFinite(savingsPercent) ? Math.round(savingsPercent * 100) : null;
    const blurb =
      item?.blurb ||
      (Number.isFinite(roundedPct)
        ? `Smart Price spotted about ${roundedPct}% below the typical ask on this model today.`
        : "Smart Price benchmarks live listings against historical comps to surface real savings.");

    return {
      label: item?.label || item?.modelKey || "Live Smart Price deal",
      query: item?.query || item?.modelKey || DEFAULT_SNAPSHOT_QUERY,
      blurb,
      group: item?.group || null,
      bestOffer: item?.bestOffer || null,
      stats: item?.stats || null,
      statsMeta: item?.statsMeta || null,
      bestPrice: Number.isFinite(bestPrice) ? bestPrice : null,
      currency,
      image: item?.image || item?.bestOffer?.image || null,
      totalListings: safeNumber(item?.totalListings),
      savings: {
        amount: Number.isFinite(savingsAmount) ? savingsAmount : null,
        percent: Number.isFinite(savingsPercent) ? savingsPercent : null,
      },
    };
  });

  const trendingRes = await fetchJson(`${baseUrl}/api/models/search?q=putter`, {
    next: { revalidate: 3600 },
  });

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

  const snapshotQuery =
    deals.find((deal) => deal?.query)?.query ||
    trending.find((item) => item?.query)?.query ||
    DEFAULT_SNAPSHOT_QUERY;
  const snapshotParams = new URLSearchParams({
    q: snapshotQuery,
    group: "false",
    page: "1",
    perPage: "24",
    samplePages: "2",
    sort: "best_price_asc",
  });

  const snapshotResponse = await fetchJson(`${baseUrl}/api/putters?${snapshotParams.toString()}`, {
    next: { revalidate: 300 },
  });

  const snapshotOffers = Array.isArray(snapshotResponse?.offers) ? snapshotResponse.offers : [];
  const heroSnapshot = buildSnapshotFromOffers(snapshotOffers);

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
  const exampleSavings =
    Number.isFinite(exampleMedian) && Number.isFinite(smartExample?.bestPrice)
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
            {heroSnapshot ? (
              <>
                We just scanned {snapshotOffers.length} live listings for "{snapshotQuery}" and found prices as low as {formatCurrency(heroSnapshot.price.min)} with a typical range topping out near {formatCurrency(heroSnapshot.price.max)}.
              </>
            ) : (
              <>We monitor real-time listings from eBay and partner shops, then benchmark every asking price against historical comps.</>
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
                    {exampleSavings
                      ? `We compare every listing against recent sale percentiles. This one sits about ${Math.round(exampleSavings)}% below the typical asking price, so Smart Price flags it automatically.`
                      : "We compare every listing against recent sale percentiles. Smart Price highlights the standouts as soon as fresh comps confirm the savings."}
                  </p>
                </div>
                <SmartPriceBadge
                  price={smartExample.bestPrice}
                  baseStats={smartExample.stats}
                  title={smartExample.bestOffer?.title}
                  specs={smartExample.bestOffer?.specs}
                  brand={smartExample.bestOffer?.brand}
                />
              </div>
            </div>
          ) : (
            <div className="mx-auto mt-8 max-w-3xl rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-sm text-slate-200 backdrop-blur">
              Smart Price is crunching today&apos;s listings. Fresh deal examples appear here as soon as we validate the savings against recent comps.
            </div>
          )}
        </div>

        {heroSnapshot && (
          <div className="mt-16">
            <MarketSnapshot snapshot={heroSnapshot} meta={snapshotResponse?.meta} query={snapshotQuery} />
          </div>
        )}
      </HeroSection>

      <SectionWrapper variant="light">
          <div className="max-w-3xl">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Today&apos;s best deals pulled straight from live listings
            </h2>
            <p className="mt-4 text-base text-slate-600">
              These models currently have {deals.filter((d) => Number.isFinite(d.bestPrice)).length} Smart Price-verified listings with market-leading asks. Click through for filtered searches that stay synced with the live feed.
            </p>
          </div>
          <div className="mt-12 grid gap-8 md:grid-cols-2 xl:grid-cols-3">
            {deals.length === 0 ? (
              <div className="col-span-full rounded-3xl border border-slate-200 bg-white p-8 text-center text-slate-600">
                Smart Price is refreshing today&apos;s leaderboard—check back soon for verified deals.
              </div>
            ) : (
              deals.map((deal) => {
                const median = Number.isFinite(deal?.stats?.p50) ? Number(deal.stats.p50) : null;
                const diff =
                  Number.isFinite(median) && Number.isFinite(deal.bestPrice)
                    ? median - deal.bestPrice
                    : null;
                const diffPct =
                  Number.isFinite(median) && Number.isFinite(deal.bestPrice) && median > 0
                    ? Math.round(((median - deal.bestPrice) / median) * 100)
                    : null;
                return (
                  <HighlightCard key={deal.query}>
                  <div className="aspect-[3/2] w-full bg-slate-100">
                    {deal.image ? (
                      <img src={deal.image} alt={deal.label} className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-slate-500">
                        Live data populates images as we refresh listings.
                      </div>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-4 p-6">
                    <div>
                      <h3 className="text-xl font-semibold text-slate-900">{deal.label}</h3>
                      <p className="mt-2 text-sm text-slate-600">{deal.blurb}</p>
                    </div>
                    <div className="flex flex-col gap-3 rounded-2xl bg-slate-50 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-wide text-slate-500">Best live ask</p>
                          <p className="text-2xl font-semibold text-slate-900">
                            {Number.isFinite(deal.bestPrice)
                              ? formatCurrency(deal.bestPrice, deal.currency)
                              : "Price updating"}
                          </p>
                        </div>
                        {Number.isFinite(deal.bestPrice) && (
                          <SmartPriceBadge
                            price={deal.bestPrice}
                            baseStats={deal.stats}
                            title={deal.bestOffer?.title}
                            specs={deal.bestOffer?.specs}
                            brand={deal.bestOffer?.brand}
                          />
                        )}
                      </div>
                      {Number.isFinite(median) && (
                        <p className="text-xs text-slate-600">
                          Median over recent comps: {formatCurrency(median, deal.currency)}
                          {Number.isFinite(diff) && diff > 0 ? (
                            <>
                              {" "}· Save about {formatCurrency(diff, deal.currency)}
                              {diffPct ? ` (${diffPct}% below)` : ""}
                            </>
                          ) : null}
                        </p>
                      )}
                      {Number.isFinite(deal.totalListings) && deal.totalListings > 0 && (
                        <p className="text-xs text-slate-500">
                          Tracking {deal.totalListings} live listings in this search right now.
                        </p>
                      )}
                    </div>
                    <div className="mt-auto">
                      <Link
                        href={`/putters?q=${encodeURIComponent(deal.query)}`}
                        className="inline-flex items-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700"
                      >
                        See the latest listings
                      </Link>
                      <p className="mt-2 text-xs text-emerald-600">
                        We send you to the best eBay listing with verified savings.
                      </p>
                    </div>
                  </div>
                </HighlightCard>
                );
              })
            )}
          </div>
      </SectionWrapper>

      <SectionWrapper variant="muted">
          <div className="max-w-3xl">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Trending models on eBay</h2>
            <p className="mt-4 text-base text-slate-600">
              Our database looks across the last 90 days of completed listings to highlight where buyer attention is spiking. Jump straight into a focused search for each hot model.
            </p>
          </div>
          <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {trending.map((item) => (
              <div key={item.modelKey} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <p className="text-sm uppercase tracking-wide text-slate-500">Trending search</p>
                <h3 className="mt-2 text-xl font-semibold text-slate-900">{item.label || "Model updating"}</h3>
                <p className="mt-2 text-sm text-slate-600">
                  {item.count > 0
                    ? `${item.count.toLocaleString()} recent listings tracked`
                    : "Pulling market counts…"}
                </p>
                <div className="mt-6">
                  <Link
                    href={`/putters?q=${encodeURIComponent(item.query)}`}
                    className="inline-flex items-center rounded-full bg-emerald-500 px-5 py-2 text-sm font-semibold text-slate-950 shadow-sm transition hover:bg-emerald-400"
                  >
                    Explore this model
                  </Link>
                  <p className="mt-2 text-xs text-emerald-600">
                    We send you to the best eBay listing with verified savings.
                  </p>
                </div>
              </div>
            ))}
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
                Market Snapshot tiles use the same raw listings you&apos;ll browse—{snapshotOffers.length} pulled moments ago—to show price distributions, condition mixes, and buying options without guessing.
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
