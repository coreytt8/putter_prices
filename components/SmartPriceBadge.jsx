// components/SmartPriceBadge.jsx
// React-only (JS/JSX). No TS. No server code.
// Usage:
//   <SmartPriceBadge
//      price={Number(o.price)}
//      baseStats={statsByModel[g.model]}
//      variantStats={null}                 // pass real variant stats later
//      title={o.title}
//      specs={o.specs}
//      brand={g?.brand}
//   />

function formatMoney(value, currency = "USD") {
  if (typeof value !== "number" || !isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

// 1) Detect likely Tour/Limited from text/specs
function detectPremiumSignals({ title = "", aspects = {}, brand = "" } = {}) {
  const t = `${String(title)} ${JSON.stringify(aspects || {})} ${String(brand)}`.toLowerCase();

  const K = {
    tour: [
      /circle[\s-]*t\b/, /\bcircle-t\b/, /\bct\b(?!\w)/,
      /\btour\s*(only|issue|department)\b/,
      /\b009m?\b/, /\bgss\b/, /\bgerman stainless\b/,
      /\bcoa\b|\bcertificate\b/,
      /\btimeless\b/, /\bmasterful\b/, /\bsuper\s*rat\b/,
    ],
    limited: [
      /\blimited\b/, /\bsmall batch\b/, /\bpld\b/, /\bvault\b/,
      /\bjet set\b/, /\bbutton back\b/, /\btei3\b|\bteryllium\b/,
      /\bprototype\b|\bproto\b/, /\bwelded\b/,
    ],
  };
  const hit = (arr) => arr.some((re) => re.test(t));
  const isTour = hit(K.tour);
  const isLimited = hit(K.limited);

  // crude confidence (0–1)
  let score = 0;
  if (isTour) score += 0.6;
  if (isLimited) score += 0.4;
  if (/\bscotty\b|\bcameron\b|\bping\b|\bodyssey\b|\btaylormade\b/.test(t)) score += 0.1;

  // accessory guard
  if (/\b(headcover only|cover only|weight kit|weights only|grip only|shaft only|head only)\b/.test(t)) {
    score = 0;
  }

  return {
    isTour,
    isLimited,
    looksPremium: isTour || isLimited,
    confidence: Math.max(0, Math.min(1, score)),
  };
}

// 2) Tier logic with variant-aware anchor and a safe fallback
const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

function chooseBadge({ price, baseStats, variantStats, looksPremium }) {
  const pick = (variantStats && isFinite(variantStats?.p50)) ? variantStats : baseStats;
  if (!pick) return null;

  const p10 = Number(pick.p10);
  const p50 = Number(pick.p50);
  const p90 = Number(pick.p90);

  const haveAny =
    [p10, p50, p90].some((v) => Number.isFinite(v)) && Number.isFinite(price);
  if (!haveAny) return null;

  const usingBaseForPremium = looksPremium && pick === baseStats;

  if (usingBaseForPremium) {
    return {
      tier: "special",
      tone: "indigo",
      label: "Special variant",
      tooltip:
        "Tour/Limited signals detected but variant comps are thin. Comparing to base would be misleading.",
    };
  }

  if (Number.isFinite(p10) && price <= p10) {
    return {
      tier: "great",
      tone: "emerald",
      label: "Great deal",
      tooltip: `≤ p10 (${formatMoney(p10)})${Number.isFinite(p50) ? `, median ${formatMoney(p50)}` : ""}`,
    };
  }
  if (Number.isFinite(p50) && price <= p50) {
    return {
      tier: "good",
      tone: "green",
      label: "Good deal",
      tooltip: `≤ median ${formatMoney(p50)}`,
    };
  }
  if (Number.isFinite(p90) && price <= p90) {
    return {
      tier: "fair",
      tone: "slate",
      label: "Fair",
      tooltip: `≤ p90 ${formatMoney(p90)}`,
    };
  }
  if (Number.isFinite(p90) && price > p90) {
    return {
      tier: "high",
      tone: "orange",
      label: "Above market",
      tooltip: `> p90 ${formatMoney(p90)}`,
    };
  }
  return null;
}

export default function SmartPriceBadge({
  price,
  total,
  baseStats,
  variantStats,
  title,
  specs,
  brand,
  className = "",
  showHelper = false,
}) {
  const resolvedPrice = toNumber(total) ?? toNumber(price);
  const { looksPremium } = detectPremiumSignals({ title, aspects: specs, brand });
  const badge = chooseBadge({ price: resolvedPrice, baseStats, variantStats, looksPremium });
  if (!badge) return null;

  const toneClass =
    badge.tone === "emerald" ? "bg-emerald-600" :
    badge.tone === "green"   ? "bg-green-600"   :
    badge.tone === "orange"  ? "bg-orange-600"  :
    badge.tone === "indigo"  ? "bg-indigo-600"  :
                               "bg-slate-600";

  return (
    <div className={className}>
      <span
        className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium text-white ${toneClass}`}
        title={badge.tooltip || ""}
      >
        {badge.label}
      </span>
      {showHelper && badge.tier === "special" && (
        <div className="mt-1 text-[11px] text-indigo-700/80">
          Likely Tour/Limited. Verify stamps/COA—pricing can differ a lot from base models.
        </div>
      )}
    </div>
  );
}
