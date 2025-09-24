// lib/variant-detect.cjs
// Turns listing text/aspects into normalized variant tags, then a stable variant_key.

function detectVariantSignals({ title = "", aspects = {} } = {}) {
  const t = `${title} ${(aspects && JSON.stringify(aspects)) || ""}`.toLowerCase();
  const tags = new Set();

  // Brand-agnostic / premium signals
  if (t.includes("tour only") || t.includes("tour use only") || t.includes("tour issue")) tags.add("tour_only");
  if (t.includes("limited") || t.includes("small batch")) tags.add("limited");
  if (t.includes("prototype") || t.includes("proto")) tags.add("prototype");
  if (t.includes("welded")) tags.add("welded_neck");
  if (/\bgss\b|german stainless/.test(t)) tags.add("gss");

  // Scotty Cameron
  if (/circle[\s-]*t|\bcircle-t\b|\btour dot\b|\bct\b/.test(t)) tags.add("circle_t");
  if (/\b009m?\b/.test(t)) tags.add("009");
  if (t.includes("timeless")) tags.add("timeless");
  if (t.includes("masterful")) tags.add("masterful");
  if (t.includes("super rat")) tags.add("super_rat");
  if (t.includes("tei3") || t.includes("teryllium")) tags.add("tei3");
  if (t.includes("button back")) tags.add("button_back");
  if (t.includes("jet set")) tags.add("jet_set");
  if (t.includes("cherry bomb") || t.includes("circle-t")) tags.add("tour_stamp");
  if (/\bcoa\b|certificate/.test(t)) tags.add("coa");

  // Ping
  if (t.includes("anser proto")) tags.add("prototype");
  if (/\bpld\b|vault/.test(t)) tags.add("limited");

  // Odyssey
  if (t.includes("tour department")) tags.add("tour_only");

  // Accessory-only guard (don’t tag accessories as premium putters)
  const neg = ["headcover only", "cover only", "weight kit", "weights only", "grip only", "shaft only", "head only"];
  if (neg.some(n => t.includes(n))) return [];

  return Array.from(tags);
}

function buildVariantKey(model, tags = []) {
  if (!model) return "";
  if (!tags.length) return "";
  const sorted = [...new Set(tags)].sort();
  return `${String(model).toLowerCase()}|${sorted.join("|")}`;
}

module.exports = { detectVariantSignals, buildVariantKey };
