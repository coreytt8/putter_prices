// lib/collector/tagAndFilter.js
import { extractCollectorFlags } from "./filters.js";

export function rarityScoreFromCues(cues = []) {
  let s = 0;
  const add = k => { s = Math.min(1, s + k); };
  const as = (kw) => cues.some(c => c.toLowerCase().includes(kw));

  if (as("tour")) add(0.3);
  if (as("circle t") || as("pld") || as("wrx") || as("hive") || as("small batch")) add(0.3);
  if (as("proto") || as("prototype") || as("one-off") || as("1/1")) add(0.3);
  if (as("coa") || as("certificate of authenticity")) add(0.2);
  return s || (cues.length ? 0.2 : 0);
}

export function tagAndFilter(rows) {
  return (rows || [])
    .map(row => {
      const title = row.title || row.name || "";
      const flags = extractCollectorFlags(title);
      if (flags.category === "reject") return null;
      return {
        ...row,
        category: flags.category,
        collector_flags: flags,
        rarity_score: rarityScoreFromCues(flags.cues),
      };
    })
    .filter(Boolean);
}
