// lib/collector/tagAndFilter.js
export function tagAndFilter(items = []) {
  const out = [];
  for (const i of items) {
    const title = (i?.title || '').toLowerCase();
    if (!title) continue;
    const flags = {
      tour: /\btour\s*(only|issue|use)\b/.test(title),
      limited: /\blimited|ltd\b/.test(title),
      proto: /\bproto|prototype\b/.test(title),
      circleT: /\bcircle\s*t\b/.test(title),
      coa: /\bcoa\b/.test(title),
      gallery: /\bgallery\b/.test(title),
      hive: /\bhive\b/.test(title),
      pld: /\bpld\b/.test(title),
      wrx: /\bwrx\b/.test(title),
    };
    const isCollectible = Object.values(flags).some(Boolean);
    out.push({
      ...i,
      category: /head\s*cover|headcover/.test(title) ? 'headcover' : 'putter',
      collector_flags: flags,
      rarity_score: isCollectible
        ? Object.values(flags).filter(Boolean).length
        : 0,
    });
  }
  return out;
}
