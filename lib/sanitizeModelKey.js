import { detectDexterity, extractLengthInches } from "./specs-parse.js";

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

export const HEAD_COVER_TOKEN_VARIANTS = new Set([
  "headcover",
  "headcovers",
  "hc",
]);

export const HEAD_COVER_TEXT_RX =
  /\bhead(?:[\s/_-]*?)cover(s)?\b|\bheadcover(s)?\b|\bhc\b/i;

export const HEAD_COVER_SPEC_DROP_TOKENS = new Set([
  "lh",
  "rh",
  "left",
  "right",
  "lefty",
  "righty",
  "lefthand",
  "righthand",
  "lefthanded",
  "righthanded",
  "hand",
  "handed",
  "in",
  "inch",
  "inches",
]);

export const HEAD_COVER_LENGTH_TOKEN_RX = /^3[3-6](?:\.\d+)?$/;
export const HEAD_COVER_LENGTH_SUFFIX_RX = /^3[3-6](?:in|inch|inches|"|”|“)?$/;
const DEX_SUFFIX_RX = /(lh|rh)$/i;

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
    ...HEAD_COVER_TOKEN_VARIANTS,
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

const LENGTH_TOKEN_PATTERN = /^\d+(?:\.\d+)?(?:(?:in)|["”])?$/i;

const PROTECTED_ACCESSORY_PHRASES = [
  ["jet", "set"],
];

function normalizeAccessoryFilterToken(token = "") {
  return String(token || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function getProtectedAccessoryTokenIndices(tokens = []) {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return new Set();
  }

  const normalizedTokens = tokens.map((token) => normalizeAccessoryFilterToken(token));
  const protectedIndices = new Set();

  PROTECTED_ACCESSORY_PHRASES.forEach((phrase) => {
    const normalizedPhrase = phrase.map((part) => normalizeAccessoryFilterToken(part));
    if (!normalizedPhrase.length || normalizedPhrase.some((part) => !part)) {
      return;
    }
    for (let index = 0; index <= normalizedTokens.length - normalizedPhrase.length; index += 1) {
      let matches = true;
      for (let offset = 0; offset < normalizedPhrase.length; offset += 1) {
        if (normalizedTokens[index + offset] !== normalizedPhrase[offset]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        for (let offset = 0; offset < normalizedPhrase.length; offset += 1) {
          protectedIndices.add(index + offset);
        }
      }
    }
  });

  return protectedIndices;
}

const DESCRIPTOR_TOKENS = new Set([
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

export function containsAccessoryToken(text = "") {
  if (!text) return false;
  return String(text)
    .split(/\s+/)
    .filter(Boolean)
    .some((token) => isAccessoryToken(token));
}

function containsHeadCoverToken(text = "") {
  if (!text) return false;
  const normalizedText = String(text);
  if (HEAD_COVER_TEXT_RX.test(normalizedText)) {
    return true;
  }
  return normalizedText
    .split(/\s+/)
    .filter(Boolean)
    .some((token) => HEAD_COVER_TOKEN_VARIANTS.has(token.toLowerCase()));
}

export function normalizeHeadcoverToken(token = "") {
  return String(token || "").trim().toLowerCase();
}

function isDexterityTokenForHeadcover(token = "") {
  const normalized = normalizeHeadcoverToken(token);
  if (!normalized) return false;
  if (HEAD_COVER_TOKEN_VARIANTS.has(normalized)) return false;
  if (HEAD_COVER_SPEC_DROP_TOKENS.has(normalized)) return true;
  if (/^(?:lh|rh)[0-9]+$/.test(normalized)) return true;
  if (/^[0-9]+(?:lh|rh)$/.test(normalized)) return true;
  if (detectDexterity(normalized)) return true;
  if (detectDexterity(`${normalized} hand`)) return true;
  return false;
}

function isLengthTokenForHeadcover(token = "") {
  const normalized = normalizeHeadcoverToken(token).replace(/[“”]/g, '"');
  if (!normalized) return false;
  if (HEAD_COVER_TOKEN_VARIANTS.has(normalized)) return false;

  if (HEAD_COVER_LENGTH_TOKEN_RX.test(normalized)) {
    const numeric = Number(normalized);
    if (Number.isFinite(numeric) && numeric >= 30 && numeric <= 40) return true;
    if (/\d/.test(normalized)) return true;
  }

  if (HEAD_COVER_LENGTH_SUFFIX_RX.test(normalized)) {
    return true;
  }

  const normalizedForExtract = normalized.replace(/inches$/, "inch");
  const lengthVal = extractLengthInches(normalizedForExtract);
  return Number.isFinite(lengthVal);
}

export function shouldDropHeadcoverSpecToken(token = "") {
  const normalized = normalizeHeadcoverToken(token);
  if (!normalized) return false;
  if (HEAD_COVER_TOKEN_VARIANTS.has(normalized)) return false;

  if (isDexterityTokenForHeadcover(normalized) || isLengthTokenForHeadcover(normalized)) {
    return true;
  }

  const suffixMatch = normalized.match(DEX_SUFFIX_RX);
  if (suffixMatch) {
    const base = normalized.slice(0, -suffixMatch[0].length);
    if (isLengthTokenForHeadcover(base) || isDexterityTokenForHeadcover(base)) {
      return true;
    }
  }

  const prefixMatch = normalized.match(/^(lh|rh)/);
  if (prefixMatch) {
    const base = normalized.slice(prefixMatch[0].length);
    if (isLengthTokenForHeadcover(base)) {
      return true;
    }
  }

  return false;
}

export function stripHeadcoverSpecTokens(tokens = []) {
  if (!Array.isArray(tokens) || tokens.length === 0) return [];
  return tokens.filter((token) => !shouldDropHeadcoverSpecToken(token));
}

function stripHeadcoverSpecTokensFromString(text = "") {
  if (!text) return "";
  const tokens = String(text)
    .split(/\s+/)
    .filter(Boolean);
  const filtered = stripHeadcoverSpecTokens(tokens);
  return filtered.join(" ");
}

function buildQueryVariant({
  labelForTokens = "",
  fallbackText = "",
  fallbackStripped = "",
  brandForQuery = null,
  aliasList = [],
  allowAccessoryTokens = false,
}) {
  const rawTokens = labelForTokens
    ? labelForTokens
        .split(/\s+/)
        .filter(Boolean)
    : [];

  const protectedIndices = getProtectedAccessoryTokenIndices(rawTokens);

  const tokens = rawTokens.filter((token, index) => {
    if (!token || LENGTH_TOKEN_PATTERN.test(token)) return false;
    const normalized = token.toLowerCase();
    if (DESCRIPTOR_TOKENS.has(normalized)) return false;
    if (!allowAccessoryTokens && !protectedIndices.has(index) && isAccessoryToken(token)) {
      return false;
    }
    return true;
  });

  const searchText = tokens.join(" ").trim();

  let query = "";
  if (searchText && brandForQuery) {
    const lowerSearch = searchText.toLowerCase();
    const searchStartsWithBrand = aliasList.some((alias) =>
      lowerSearch.startsWith(String(alias || "").toLowerCase())
    );
    query = searchStartsWithBrand ? searchText : `${brandForQuery} ${searchText}`.trim();
  } else if (searchText) {
    query = searchText;
  }

  if (!query) {
    const fallbackBase = allowAccessoryTokens
      ? String(fallbackText || "").trim()
      : String(fallbackStripped || "").trim();
    query = fallbackBase || String(fallbackText || "").trim();
  }

  return query.trim();
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

export function stripAccessoryTokens(text = "", options = {}) {
  const { preserveHeadCover = false } = options || {};
  if (!text) return "";
  const tokens = String(text)
    .split(/\s+/)
    .filter(Boolean);

  const protectedIndices = getProtectedAccessoryTokenIndices(tokens);

  const filtered = tokens.filter((token, index) => {
    if (preserveHeadCover && HEAD_COVER_TOKEN_VARIANTS.has(token.toLowerCase())) {
      return true;
    }
    if (protectedIndices.has(index)) {
      return true;
    }
    return !isAccessoryToken(token);
  });
  return filtered.join(" ");
}

const DECIMAL_MARK_PLACEHOLDER = "DECIMALMARK";

function removeEmojiAndPunctuation(text = "") {
  if (!text) return "";
  return String(text)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/(?<=\d)[.,](?=\d)/g, DECIMAL_MARK_PLACEHOLDER)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(new RegExp(DECIMAL_MARK_PLACEHOLDER, "g"), ".")
    .replace(/\s+/g, " ")
    .trim();
}

function collapseShortTokens(text = "") {
  if (!text) return "";
  const tokens = text
    .split(/\s+/)
    .filter((token) => {
      if (!token) return false;
      if (/\d/.test(token)) return true;
      return token.length > 1;
    });
  return tokens.join(" ");
}

function sanitizeCandidate(raw = "") {
  let cleaned = removeEmojiAndPunctuation(raw);
  const preserveHeadCover = containsHeadCoverToken(cleaned);
  cleaned = stripAccessoryTokens(cleaned, { preserveHeadCover });
  if (preserveHeadCover) {
    cleaned = stripHeadcoverSpecTokensFromString(cleaned);
  }
  cleaned = collapseShortTokens(cleaned);
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (!/\bputter\b/i.test(cleaned)) {
    cleaned = `${cleaned} putter`;
  }
  return cleaned.replace(/\s+/g, " ").trim();
}

function sanitizeForTokens(raw = "", options = {}) {
  let cleaned = removeEmojiAndPunctuation(raw);
  cleaned = stripAccessoryTokens(cleaned, options);
  if (options?.preserveHeadCover) {
    cleaned = stripHeadcoverSpecTokensFromString(cleaned);
  }
  cleaned = collapseShortTokens(cleaned);
  return cleaned.replace(/\s+/g, " ").trim();
}

function extractTokens(text = "") {
  return String(text)
    .split(/\s+/)
    .map((token) => token.toLowerCase())
    .filter((token) => token && token !== "putter");
}

function buildReferenceTokens(deal = {}) {
  const tokenSources = [
    deal?.label,
    deal?.bestOffer?.title,
    deal?.modelKey,
    deal?.queryVariants?.clean,
    deal?.queryVariants?.accessory,
    deal?.query,
  ];
  const tokens = new Set();
  tokenSources.forEach((source) => {
    if (typeof source !== "string") return;
    const cleaned = sanitizeForTokens(source, { preserveHeadCover: true });
    if (!cleaned) return;
    extractTokens(cleaned).forEach((token) => tokens.add(token));
  });
  return tokens;
}

export function deriveDealSearchPhrase(deal = {}, fallback = "golf putter") {
  const rawCandidates = [];
  const pushCandidate = (value) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!trimmed) return;
    rawCandidates.push(trimmed);
  };

  pushCandidate(deal?.queryVariants?.clean);
  pushCandidate(deal?.query);
  pushCandidate(deal?.queryVariants?.accessory);
  pushCandidate(deal?.bestOffer?.title);
  pushCandidate(deal?.label);

  const seenRaw = new Set();
  const sanitizedCandidates = [];
  const seenClean = new Set();

  for (const raw of rawCandidates) {
    if (seenRaw.has(raw)) continue;
    seenRaw.add(raw);
    const cleaned = sanitizeCandidate(raw);
    if (!cleaned || seenClean.has(cleaned)) continue;
    seenClean.add(cleaned);
    sanitizedCandidates.push(cleaned);
  }

  if (sanitizedCandidates.length) {
    const referenceTokens = buildReferenceTokens(deal);
    if (referenceTokens.size) {
      let best = null;
      sanitizedCandidates.forEach((cleaned, index) => {
        const candidateTokens = new Set(extractTokens(cleaned));
        let score = 0;
        referenceTokens.forEach((token) => {
          if (candidateTokens.has(token)) {
            score += 1;
          }
        });
        if (score > 0) {
          if (
            !best ||
            score > best.score ||
            (score === best.score && index < best.index)
          ) {
            best = { cleaned, score, index };
          }
        }
      });
      if (best) {
        return best.cleaned;
      }
    }
    return sanitizedCandidates[0];
  }

  if (fallback) {
    return deriveDealSearchPhrase({ query: fallback }, "");
  }

  return "";
}

export function buildDealCtaHref(deal = {}, fallback = "golf putter") {
  let query = deriveDealSearchPhrase(deal, fallback);

  if (query) {
    const sourceTexts = [
      deal?.label,
      deal?.query,
      deal?.modelKey,
      deal?.bestOffer?.title,
      deal?.queryVariants?.clean,
      deal?.queryVariants?.accessory,
    ];
    const hasPutterSource = sourceTexts.some(
      (text) => typeof text === "string" && /\bputter\b/i.test(text)
    );
    const modelKeyFlagsHeadcover = containsHeadCoverToken(deal?.modelKey);
    const accessoryVariantSignalsHeadcover = containsHeadCoverToken(
      deal?.queryVariants?.accessory
    );
    const shouldStripSyntheticPutter =
      !hasPutterSource &&
      containsHeadCoverToken(query) &&
      (modelKeyFlagsHeadcover || accessoryVariantSignalsHeadcover);

    if (shouldStripSyntheticPutter) {
      const strippedQuery = query
        .replace(/(?:\s*\bputter\b)+$/gi, "")
        .replace(/\s+/g, " ")
        .trim();
      if (strippedQuery) {
        query = strippedQuery;
      }
    }
  }

  const params = new URLSearchParams();
  const modelKey = typeof deal?.modelKey === "string" ? deal.modelKey.trim() : "";
  if (query) params.set("q", query);
  if (modelKey) params.set("modelKey", modelKey);
  const qs = params.toString();
  return {
    query,
    modelKey,
    href: qs ? `/putters?${qs}` : "/putters",
  };
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
 * // => {
 * //   label: "mint TaylorMade my spider tour x x3 34.5 putter",
 * //   query: "TaylorMade my spider tour x x3 putter",
 * //   queryVariants: { clean: "TaylorMade my spider tour x x3 putter", accessory: "mint TaylorMade my spider tour x x3 34.5 putter" }
 * // }
 *
 * sanitizeModelKey("TaylorMade|Spider|Weight Kit", { preserveAccessories: true });
 * // => { ... query: "TaylorMade Spider Weight Kit", queryVariants: { clean: "TaylorMade Spider", accessory: "TaylorMade Spider Weight Kit" } }
 */
export function sanitizeModelKey(rawKey = "", options = {}) {
  const { storedBrand = null, preserveAccessories = false } = options || {};
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
  const normalizedFallback = String(fallbackText || "").trim();
  const accessoryFreeFallback = stripAccessoryTokens(normalizedFallback).trim();
  const accessoryRichLabel = label.trim();
  const accessoryFreeLabel = stripAccessoryTokens(accessoryRichLabel).trim();
  const cleanedLabel = accessoryFreeLabel;
  const fallbackLabel = accessoryFreeFallback || normalizedFallback;
  const humanLabel = cleanedLabel || fallbackLabel;

  const brandForQuery =
    (typeof storedBrand === "string" && storedBrand.trim()) || detectedBrand || null;
  const queryAliasList = brandForQuery ? BRAND_ALIASES.get(brandForQuery) || [brandForQuery] : [];

  const cleanQuery = buildQueryVariant({
    labelForTokens: cleanedLabel,
    fallbackText: normalizedFallback,
    fallbackStripped: accessoryFreeFallback,
    brandForQuery,
    aliasList: queryAliasList,
    allowAccessoryTokens: false,
  });

  const accessoryQuery = buildQueryVariant({
    labelForTokens: accessoryRichLabel,
    fallbackText: normalizedFallback,
    fallbackStripped: accessoryFreeFallback,
    brandForQuery,
    aliasList: queryAliasList,
    allowAccessoryTokens: true,
  });

  const queryVariants = {
    clean: cleanQuery || null,
    accessory: accessoryQuery || null,
  };

  let query = cleanQuery;
  if (preserveAccessories && accessoryQuery) {
    query = accessoryQuery;
  }

  return {
    label: humanLabel,
    query,
    brand: brandForQuery,
    rawLabel: accessoryRichLabel || null,
    cleanLabel: cleanedLabel || null,
    queryVariants,
    accessoryQuery: queryVariants.accessory,
  };
}
