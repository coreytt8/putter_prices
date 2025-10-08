// lib/collector/filters.js
import { BRAND_COLLECTOR_ALLOW, GLOBAL_COLLECTOR_ALLOW, HEADCOVER_ALLOW } from "./collectorTaxonomy.js";

export const HARD_DENY = [
  "\\b(grip|grips)\\b","weights?\\b","weight screw","shaft(?!.*putter)","adapter","head weight kit",
  "\\bballs?\\b","tennis","racket","hoodie","t-shirt","cap\\b","belt buckle","keychain",
  "training aid","practice mat","rangefinder","gps watch",
  "cover only\\b(?!.*(tour|circle|hive|small batch))",
];

const hasAny = (hay, needles) => {
  const t = hay.toLowerCase();
  return needles.some(k => t.includes(k.toLowerCase()));
};
const regexAny = (hay, patterns) => patterns.some(p => new RegExp(p, "i").test(hay));

export function extractCollectorFlags(title) {
  const t = (title || "").toLowerCase();
  if (!t) return { category: "reject" };
  if (regexAny(title, HARD_DENY)) return { category: "reject" };

  const isCover = hasAny(t, HEADCOVER_ALLOW);
  const cues = [];
  const brand_hit = [];

  GLOBAL_COLLECTOR_ALLOW.forEach(k => { if (t.includes(k)) cues.push(k); });
  for (const [brand, terms] of Object.entries(BRAND_COLLECTOR_ALLOW)) {
    const hit = terms.filter(k => t.includes(k));
    if (hit.length) { brand_hit.push(brand); cues.push(...hit); }
  }

  if (isCover && cues.length) return { category: "headcover_collectible", cues, brand_hit };
  if (cues.length)             return { category: "putter_collectible",     cues, brand_hit };
  return { category: "reject" };
}
