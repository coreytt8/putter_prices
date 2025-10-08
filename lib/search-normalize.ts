import { PUTTER_CATALOG } from "./data/putterCatalog";
import { normalizeModelKey as normalizeCatalogKey } from "./normalize";
import { sanitizeModelKey, stripAccessoryTokens } from "./sanitizeModelKey";
import { formatFullModelName, humanizeVariantKey } from "./format-model";

interface CatalogEntry {
  brand: string;
  model: string;
  normalizedKey: string;
  canonicalName: string;
}

interface ResolvedModel extends CatalogEntry {
  aliasQueries: string[];
}

interface BuildCanonicalQueryDetails {
  brand?: string | null;
  model?: string | null;
  modelKey?: string | null;
  label?: string | null;
  rawLabel?: string | null;
  query?: string | null;
  bestOfferTitle?: string | null;
  bestOffer?: { title?: string | null; brand?: string | null } | null;
  variantKey?: string | null;
  rarityTier?: string | null;
}

function canonicalKey(value: string | null | undefined): string {
  const normalized = normalizeCatalogKey(String(value ?? "").replace(/[|]/g, " "));
  return normalized.replace(/\s+/g, " ").trim();
}

function synonymKey(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function splitTokens(value: string | null | undefined): string[] {
  return String(value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

const MODEL_LOOKUP = new Map<string, CatalogEntry>();
const SYNONYM_LOOKUP = new Map<string, string>();
const ALIAS_QUERIES = new Map<string, Set<string>>();

function registerModel(brand: string, model: string) {
  const canonical = canonicalKey(`${brand} ${model}`);
  if (!canonical) return;
  if (!MODEL_LOOKUP.has(canonical)) {
    MODEL_LOOKUP.set(canonical, {
      brand,
      model,
      normalizedKey: canonical,
      canonicalName: `${brand} ${model}`.trim(),
    });
  }
}

function registerAlias(canonicalName: string, alias: string) {
  const canonical = canonicalKey(canonicalName);
  if (!canonical) return;
  const aliasKey = synonymKey(alias);
  if (!aliasKey) return;
  SYNONYM_LOOKUP.set(aliasKey, canonical);
  if (!ALIAS_QUERIES.has(canonical)) {
    ALIAS_QUERIES.set(canonical, new Set());
  }
  ALIAS_QUERIES.get(canonical)?.add(alias.trim());
}

for (const entry of PUTTER_CATALOG) {
  registerModel(entry.brand, entry.model);
}

const SYNONYM_CONFIG = [
  {
    canonical: "Scotty Cameron Newport 2",
    aliases: ["np2", "np-2", "np_2", "np 2", "newport2"],
  },
  {
    canonical: "Scotty Cameron Phantom X 5",
    aliases: [
      "phantom x5",
      "phantomx5",
      "phantom x-5",
      "phantom-x5",
      "spider x5",
      "spiderx5",
      "spider x-5",
      "spider-x5",
      "spider x 5",
    ],
  },
  {
    canonical: "Evnroll ER5",
    aliases: ["er5", "er-5", "er_5", "er 5"],
  },
];

for (const cfg of SYNONYM_CONFIG) {
  for (const alias of cfg.aliases) {
    registerAlias(cfg.canonical, alias);
  }
}

function resolveFromTokens(tokens: string[]): string | null {
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const directKey = synonymKey(token);
    if (directKey && SYNONYM_LOOKUP.has(directKey)) {
      return SYNONYM_LOOKUP.get(directKey) ?? null;
    }
  }

  for (let i = 0; i < tokens.length - 1; i += 1) {
    const pair = `${tokens[i]}${tokens[i + 1]}`;
    const pairKey = synonymKey(pair);
    if (pairKey && SYNONYM_LOOKUP.has(pairKey)) {
      return SYNONYM_LOOKUP.get(pairKey) ?? null;
    }
    const spaced = canonicalKey(`${tokens[i]} ${tokens[i + 1]}`);
    if (spaced && MODEL_LOOKUP.has(spaced)) {
      return spaced;
    }
  }

  return null;
}

export function resolveModelKeyFromQuery(rawQuery: string | null | undefined): ResolvedModel | null {
  if (!rawQuery) return null;
  const baseNormalized = canonicalKey(rawQuery);
  if (baseNormalized && MODEL_LOOKUP.has(baseNormalized)) {
    const entry = MODEL_LOOKUP.get(baseNormalized)!;
    const aliases = Array.from(ALIAS_QUERIES.get(entry.normalizedKey) ?? []);
    return { ...entry, aliasQueries: aliases };
  }

  const tokens = splitTokens(rawQuery);
  const tokenCandidate = resolveFromTokens(tokens);
  if (tokenCandidate && MODEL_LOOKUP.has(tokenCandidate)) {
    const entry = MODEL_LOOKUP.get(tokenCandidate)!;
    const aliases = Array.from(ALIAS_QUERIES.get(entry.normalizedKey) ?? []);
    return { ...entry, aliasQueries: aliases };
  }

  const stripped = stripAccessoryTokens(rawQuery);
  const strippedNormalized = canonicalKey(stripped);
  if (strippedNormalized && MODEL_LOOKUP.has(strippedNormalized)) {
    const entry = MODEL_LOOKUP.get(strippedNormalized)!;
    const aliases = Array.from(ALIAS_QUERIES.get(entry.normalizedKey) ?? []);
    return { ...entry, aliasQueries: aliases };
  }

  const sanitized = sanitizeModelKey(rawQuery);
  const sanitizedLabel = sanitized?.cleanLabel || sanitized?.label || "";
  const sanitizedBrand = sanitized?.brand || "";
  if (sanitizedLabel) {
    const recombined = [sanitizedBrand, sanitizedLabel].filter(Boolean).join(" ");
    const recombinedKey = canonicalKey(recombined);
    if (recombinedKey && MODEL_LOOKUP.has(recombinedKey)) {
      const entry = MODEL_LOOKUP.get(recombinedKey)!;
      const aliases = Array.from(ALIAS_QUERIES.get(entry.normalizedKey) ?? []);
      return { ...entry, aliasQueries: aliases };
    }
  }

  return null;
}

function rarityHintFromTier(tier: string | null | undefined): string {
  if (!tier) return "";
  const normalized = String(tier).toLowerCase();
  if (normalized.includes("tour")) return "tour only";
  if (normalized.includes("limit")) return "limited";
  if (normalized.includes("retail")) return "retail";
  return "";
}

export function buildCanonicalQuery(details: BuildCanonicalQueryDetails = {}): string {
  const brand = (details.brand ?? details.bestOffer?.brand ?? "").trim();
  const candidates: Array<string | null | undefined> = [
    details.modelKey,
    details.model,
    details.label,
    details.rawLabel,
    details.query,
    details.bestOfferTitle,
    details.bestOffer?.title,
    [brand, details.model].filter(Boolean).join(" "),
  ];

  let resolved: ResolvedModel | null = null;
  for (const candidate of candidates) {
    if (!candidate) continue;
    const entry = resolveModelKeyFromQuery(candidate);
    if (entry) {
      resolved = entry;
      break;
    }
  }

  if (!resolved && brand && details.model) {
    resolved = resolveModelKeyFromQuery(`${brand} ${details.model}`);
  }

  let base = "";
  if (resolved) {
    base = resolved.canonicalName;
  } else {
    base = formatFullModelName(details);
  }

  const variantHint = humanizeVariantKey(details.variantKey ?? undefined);
  if (variantHint) {
    const lowerBase = base.toLowerCase();
    if (!lowerBase.includes(variantHint.toLowerCase())) {
      base = `${base} ${variantHint}`.trim();
    }
  }

  const rarityHint = rarityHintFromTier(details.rarityTier);
  if (rarityHint) {
    const lowerBase = base.toLowerCase();
    if (!lowerBase.includes(rarityHint)) {
      base = `${base} ${rarityHint}`.trim();
    }
  }

  if (!/\bputter\b/i.test(base)) {
    base = `${base} putter`;
  }

  return base.replace(/\s+/g, " ").trim();
}

export type { BuildCanonicalQueryDetails, ResolvedModel };
