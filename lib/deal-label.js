import { PUTTER_CATALOG } from './data/putterCatalog.js';
import { normalizeModelKey } from './normalize.js';
import { sanitizeModelKey } from './sanitizeModelKey.js';

const BRAND_SYNONYM_LOOKUP = new Map([
  ['scottycameron', new Set(['titleist'])],
  ['odyssey', new Set(['callaway'])],
]);

const CATALOG_LOOKUP = (() => {
  const map = new Map();
  for (const entry of PUTTER_CATALOG) {
    const key = normalizeModelKey(`${entry.brand} ${entry.model}`);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(entry);
  }
  return map;
})();

export function formatModelLabel(modelKey = '', brand = '', title = '') {
  const normalized = String(modelKey || '').trim();
  if (normalized && CATALOG_LOOKUP.has(normalized)) {
    const [first] = CATALOG_LOOKUP.get(normalized);
    if (first) return `${first.brand} ${first.model}`;
  }

  const brandTitle = String(brand || '').trim();
  const listingTitle = String(title || '').trim();

  if (brandTitle && listingTitle) {
    const lowerBrand = brandTitle.toLowerCase();
    const lowerTitle = listingTitle.toLowerCase();
    if (lowerTitle.startsWith(lowerBrand)) {
      return listingTitle;
    }
    return `${brandTitle} ${listingTitle}`.replace(/\s+/g, ' ').trim();
  }

  if (listingTitle) return listingTitle;
  if (brandTitle) return brandTitle;
  if (!normalized) return 'Live Smart Price deal';
  return normalized
    .split(' ')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ''))
    .join(' ');
}

function normalizeForComparison(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function deriveModelFromKey(modelKey = '', brand = '') {
  const normalizedBrand = normalizeForComparison(brand);
  const synonymSet = BRAND_SYNONYM_LOOKUP.get(normalizedBrand) || new Set();
  const parts = String(modelKey || '')
    .split('|')
    .map((part) => String(part || '').trim())
    .filter(Boolean);

  if (!parts.length) return '';

  const seen = new Set();
  const cleaned = [];
  for (const part of parts) {
    const normalizedPart = normalizeForComparison(part);
    if (!normalizedPart) continue;
    if (normalizedPart === normalizedBrand) continue;
    if (synonymSet.has(normalizedPart)) continue;
    if (seen.has(normalizedPart)) continue;
    seen.add(normalizedPart);
    cleaned.push(part);
  }

  return cleaned.join(' ').trim();
}

export function combineBrandAndLabel(brand = '', label = '') {
  const brandText = String(brand || '').trim();
  const labelText = String(label || '').trim();
  if (!brandText && !labelText) return '';
  if (!brandText) return labelText;
  if (!labelText) return brandText;

  const lowerBrand = brandText.toLowerCase();
  const lowerLabel = labelText.toLowerCase();
  if (lowerLabel.startsWith(lowerBrand)) {
    return labelText;
  }
  return `${brandText} ${labelText}`.replace(/\s+/g, ' ').trim();
}

export function composeDealLabel(row = {}, sanitized = null) {
  const cleanLabel = typeof sanitized?.cleanLabel === 'string' ? sanitized.cleanLabel.trim() : '';
  const sanitizedLabel = typeof sanitized?.label === 'string' ? sanitized.label.trim() : '';
  let modelLabel = cleanLabel || sanitizedLabel;

  let titleSanitized = null;
  if (row?.title) {
    titleSanitized = sanitizeModelKey(row.title, { storedBrand: row.brand });
    const fromTitleClean = typeof titleSanitized?.cleanLabel === 'string' ? titleSanitized.cleanLabel.trim() : '';
    const fromTitleLabel = typeof titleSanitized?.label === 'string' ? titleSanitized.label.trim() : '';
    if (!modelLabel) {
      modelLabel = fromTitleClean || fromTitleLabel || '';
    }
  }

  const brandCandidate = typeof sanitized?.brand === 'string' ? sanitized.brand.trim() : '';
  const fallbackBrand = typeof row?.brand === 'string' ? row.brand.trim() : '';
  const brand = brandCandidate || fallbackBrand;

  const normalizedBrand = normalizeForComparison(brand);
  let normalizedModel = normalizeForComparison(modelLabel);

  if (normalizedBrand && normalizedBrand === normalizedModel) {
    const additionalCandidates = [];
    if (typeof row?.model === 'string') additionalCandidates.push(row.model);
    if (typeof row?.title === 'string') additionalCandidates.push(row.title);

    for (const candidate of additionalCandidates) {
      const candidateSanitized = sanitizeModelKey(candidate, { storedBrand: row.brand });
      let candidateLabel =
        (typeof candidateSanitized?.cleanLabel === 'string' && candidateSanitized.cleanLabel.trim()) ||
        (typeof candidateSanitized?.label === 'string' && candidateSanitized.label.trim()) ||
        '';

      if (!candidateLabel) {
        candidateLabel = String(candidate || '').trim();
      }

      if (!candidateLabel) continue;

      const normalizedCandidate = normalizeForComparison(candidateLabel);
      if (normalizedCandidate && normalizedCandidate !== normalizedBrand) {
        modelLabel = candidateLabel;
        normalizedModel = normalizedCandidate;
        break;
      }
    }

    if (normalizedBrand === normalizedModel) {
      const derivedFromKey = deriveModelFromKey(row?.model_key, brand);
      if (derivedFromKey) {
        modelLabel = derivedFromKey;
        normalizedModel = normalizeForComparison(modelLabel);
      }
    }

    if (normalizedBrand === normalizedModel) {
      if (titleSanitized) {
        const rawTitle = String(row?.title || '').trim();
        const normalizedRaw = normalizeForComparison(rawTitle);
        if (normalizedRaw && normalizedRaw !== normalizedBrand) {
          modelLabel = rawTitle;
          normalizedModel = normalizedRaw;
        } else {
          modelLabel = '';
        }
      } else {
        modelLabel = '';
      }
    }
  }

  let label = combineBrandAndLabel(brand, modelLabel);
  if (label && normalizedBrand && normalizeForComparison(label) === normalizedBrand) {
    const formatted = formatModelLabel(row?.model_key, brand || row?.brand, row?.title);
    if (formatted && normalizeForComparison(formatted) !== normalizedBrand) {
      label = formatted;
      if (brand && formatted.toLowerCase().startsWith(brand.toLowerCase())) {
        modelLabel = formatted.slice(brand.length).trim();
      } else {
        modelLabel = formatted;
      }
    } else {
      const rawTitle = String(row?.title || '').trim();
      if (rawTitle && normalizeForComparison(rawTitle) !== normalizedBrand) {
        label = rawTitle;
        if (brand && rawTitle.toLowerCase().startsWith(brand.toLowerCase())) {
          modelLabel = rawTitle.slice(brand.length).trim();
        } else {
          modelLabel = rawTitle;
        }
      }
    }
  }
  if (!label) {
    label = formatModelLabel(row?.model_key, row?.brand, row?.title);
  }

  return {
    label: label || 'Live Smart Price deal',
    brand: brand || null,
    modelLabel: modelLabel || '',
  };
}

export default composeDealLabel;
