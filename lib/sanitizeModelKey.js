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
export function sanitizeModelKey(rawKey = "") {
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
