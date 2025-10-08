import { PUTTER_CATALOG } from './data/putterCatalog';
import { normalizeModelKey } from './normalize';
import { sanitizeModelKey } from './sanitizeModelKey';

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

  if (!modelLabel && row?.title) {
    const fromTitle = sanitizeModelKey(row.title, { storedBrand: row.brand });
    const fromTitleClean = typeof fromTitle?.cleanLabel === 'string' ? fromTitle.cleanLabel.trim() : '';
    const fromTitleLabel = typeof fromTitle?.label === 'string' ? fromTitle.label.trim() : '';
    modelLabel = fromTitleClean || fromTitleLabel || '';
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
      const candidateLabel =
        (typeof candidateSanitized?.cleanLabel === 'string' && candidateSanitized.cleanLabel.trim()) ||
        (typeof candidateSanitized?.label === 'string' && candidateSanitized.label.trim()) ||
        '';

      if (!candidateLabel) continue;

      const normalizedCandidate = normalizeForComparison(candidateLabel);
      if (normalizedCandidate && normalizedCandidate !== normalizedBrand) {
        modelLabel = candidateLabel;
        normalizedModel = normalizedCandidate;
        break;
      }
    }

    if (normalizedBrand === normalizedModel) {
      modelLabel = '';
    }
  }

  let label = combineBrandAndLabel(brand, modelLabel);
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
