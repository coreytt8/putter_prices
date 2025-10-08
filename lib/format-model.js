import { sanitizeModelKey } from "./sanitizeModelKey";

function combineBrandAndLabel(brand = "", label = "") {
  const brandText = String(brand || "").trim();
  const labelText = String(label || "").trim();
  if (!brandText && !labelText) return "";
  if (!brandText) return labelText;
  if (!labelText) return brandText;

  const lowerBrand = brandText.toLowerCase();
  const lowerLabel = labelText.toLowerCase();
  if (lowerLabel.startsWith(lowerBrand)) {
    return labelText;
  }
  return `${brandText} ${labelText}`.replace(/\s+/g, " ").trim();
}

function humanizeVariantToken(token = "") {
  const normalized = String(token || "").trim();
  if (!normalized) return "";
  const lower = normalized.toLowerCase();
  if (lower === "base" || lower === "standard" || lower === "stock") {
    return "";
  }
  if (lower === "cs") return "CS";
  if (lower === "slant") return "Slant";
  if (lower === "flow") return "Flow";
  if (/^[a-z]\d+$/i.test(normalized)) {
    return normalized.toUpperCase();
  }
  if (/^[\d.]+$/.test(normalized)) {
    return normalized;
  }
  const capped = normalized.replace(/^(\w)(.*)$/i, (_, first, rest) => `${first.toUpperCase()}${rest.toLowerCase()}`);
  return capped;
}

export function humanizeVariantKey(variantKey = "") {
  const raw = String(variantKey || "").trim();
  if (!raw) return "";
  const cleaned = raw
    .replace(/[|/]+/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  const parts = cleaned.split(" ").map((part) => humanizeVariantToken(part)).filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 2 && parts[0].length === 1) {
    return `${parts[0]}-${parts[1]}`;
  }
  return parts.join(" ");
}

function deriveSanitizedLabel({ brand, candidates }) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const sanitized = sanitizeModelKey(candidate, { storedBrand: brand });
    const cleanLabel = sanitized?.cleanLabel || sanitized?.label || "";
    const resolvedBrand = sanitized?.brand || brand || "";
    if (cleanLabel) {
      return { brand: resolvedBrand, label: cleanLabel };
    }
  }
  return { brand: brand || "", label: "" };
}

export function formatFullModelName(details = {}) {
  const brand = (details.brand || details.bestOffer?.brand || "").trim();
  const candidates = [
    details.modelKey,
    details.model,
    details.label,
    details.rawLabel,
    details.bestOfferTitle,
    details.bestOffer?.title,
    details.query,
    [brand, details.model].filter(Boolean).join(" "),
  ];

  const { brand: resolvedBrand, label: resolvedLabel } = deriveSanitizedLabel({ brand, candidates });
  let workingLabel = (resolvedLabel || details.model || "").trim();
  let workingBrand = (resolvedBrand || brand || "").trim();

  if (!workingLabel && details.model) {
    workingLabel = String(details.model || "").trim();
  }

  const variantHint = humanizeVariantKey(details.variantKey);
  if (variantHint) {
    const lowerLabel = (workingLabel || "").toLowerCase();
    if (!lowerLabel.includes(variantHint.toLowerCase())) {
      workingLabel = [workingLabel, variantHint].filter(Boolean).join(" ");
    }
  }

  const combined = combineBrandAndLabel(workingBrand, workingLabel);
  if (combined) {
    const normalizedBrand = (workingBrand || "").trim();
    const brandOnly = normalizedBrand && combined.trim().toLowerCase() === normalizedBrand.toLowerCase();
    if (!brandOnly) return combined;
  }

  if (workingBrand) {
    return `${workingBrand} putter`;
  }

  return "Live Smart Price deal";
}

export default formatFullModelName;
