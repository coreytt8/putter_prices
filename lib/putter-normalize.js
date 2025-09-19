export function normalizeModelKey(title = '') {
  return title
    .toLowerCase()
    .replace(/scotty\s*cameron|titleist|putter|golf|\b(rh|lh)\b|right\s*hand(ed)?|left\s*hand(ed)?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
