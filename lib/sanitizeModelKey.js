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

const ACCESSORY_EXACT_TOKENS = new Set(
  [
    "adapter",
    "adapters",
    "counterweight",
    "counterweights",
    "fit",
    "fits",
    "fitting",
    "fittings",
    "grip",
    "grips",
    "headcover",
    "headcovers",
    "insert",
    "inserts",
    "kit",
    "kits",
    "pack",
    "package",
    "set",
    "sleeve",
    "sleeves",
    "tool",
    "tools",
    "weight",
    "weights",
    "wrench",
    "wrenches",
  ].map((token) => token.toLowerCase())
);

const ACCESSORY_TOKEN_PATTERNS = [
  /^\d+(?:\/\d+)?(?:pc|pcs|pack|set)s?$/i,
  /^\d+(?:pcs?)$/i,
  /^\d+(?:g|gram|grams)$/i,
  /^\d+(?:mm|cm)$/i,
];

function isAccessoryToken(token = "") {
  if (!token) return false;
  const normalized = token.toLowerCase();
  if (ACCESSORY_EXACT_TOKENS.has(normalized)) return true;
  const stripped = normalized.replace(/[^a-z0-9]+/g, "");
  if (ACCESSORY_EXACT_TOKENS.has(stripped)) return true;
  return ACCESSORY_TOKEN_PATTERNS.some((pattern) => pattern.test(token));
}

function splitSegments(rawKey = "") {
  return String(rawKey)
    .split(/::|\|/g)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function detectBrandFromSegments(segments = []) {
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

  if (!brandMatches.size) {
    return null;
  }

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
  return winner ? winner.brand : null;
}

export function detectCanonicalBrand(rawKey = "") {
  const segments = Array.isArray(rawKey) ? rawKey : splitSegments(rawKey);
  let detected = detectBrandFromSegments(segments);
  if (!detected) {
    const fallbackText = Array.isArray(rawKey)
      ? rawKey.filter(Boolean).join(" ")
      : String(rawKey || "");
    if (fallbackText) {
      detected = detectBrandFromSegments([fallbackText]);
    }
  }
  return detected || null;
}

export function stripAccessoryTokens(text = "") {
  if (!text) return "";
  const tokens = String(text)
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !isAccessoryToken(token));
  return tokens.join(" ");
}

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
export function sanitizeModelKey(rawKey = "", options = {}) {
  const { storedBrand = null } = options || {};
  if (!rawKey) {
    return {
      label: "Model updating",
      query: "",
    };
  }

  const segments = splitSegments(rawKey);
  const working = segments.join(" ");
  const detectedBrand = detectBrandFromSegments(segments);

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
  const accessoryFreeLabel = stripAccessoryTokens(label).trim();
  const cleanedLabel = accessoryFreeLabel;
  const fallbackLabel = stripAccessoryTokens(fallbackText).trim() || fallbackText;
  const humanLabel = cleanedLabel || fallbackLabel;

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
          if (descriptorTokens.has(normalized)) return false;
          return !isAccessoryToken(token);
        })
    : [];
  const searchText = searchTokens.join(" ").trim();

  const brandForQuery =
    (typeof storedBrand === "string" && storedBrand.trim()) || detectedBrand || null;
  const queryAliasList = brandForQuery ? BRAND_ALIASES.get(brandForQuery) || [brandForQuery] : [];

  let query = "";
  if (searchText && brandForQuery) {
    const lowerSearch = searchText.toLowerCase();
    const searchStartsWithBrand = queryAliasList.some((alias) =>
      lowerSearch.startsWith(alias.toLowerCase())
    );
    query = searchStartsWithBrand ? searchText : `${brandForQuery} ${searchText}`.trim();
  } else if (searchText) {
    query = searchText;
  }

  if (!query) {
    const fallbackQuery = stripAccessoryTokens(fallbackText).trim();
    query = fallbackQuery || fallbackText;
  }

  return {
    label: humanLabel,
    query,
    brand: brandForQuery,
  };
}
