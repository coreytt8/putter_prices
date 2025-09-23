// lib/variant-detect.cjs
function detectVariantSignals({ title = "", aspects = {} } = {}) {
  const t = `${title} ${(aspects && JSON.stringify(aspects)) || ""}`.toLowerCase();

  const tags = new Set();

  // Brand-agnostic
  if (t.includes("tour only") || t.includes("tour use only") || t.includes("tour issue")) tags.add("tour_only");
  if (t.includes("limited") || t.includes("small batch")) tags.add("limited");
  if (t.includes("prototype") || t.includes("proto")) tags.add("prototype");
  if (t.includes("welded")) tags.add("welded_neck");
  if (t.includes("gss") || t.includes("german stainless")) tags.add("gss");

  // Scotty Cameron specifics
  if (/circle[\s-]*t/.test(t) || t.includes(" tour dot ") || t.includes(" ct ")) tags.add("circle_t");
  if (/\b009\b|\b009m\b/.test(t)) tags.add("009");
  if (t.includes("timeless")) tags.add("timeless");
  if (t.includes("masterful")) tags.add("masterful");
  if (t.includes("super rat")) tags.add("super_rat");
  if (t.includes("tei3") || t.includes("teryllium")) tags.add("tei3");
  if (t.includes("button back")) tags.add("button_back");
  if (t.includes("jet set")) tags.add("jet_set");
  if (t.includes("cherry bomb") || t.includes("circle-t")) tags.add("tour_stamp");
  if (t.includes("coa") || t.includes("certificate")) tags.add("coa");

  // Ping examples
  if (t.includes("anser proto")) tags.add("prototype");
  if (t.includes("pld") || t.includes("vault")) tags.add("limited");

  // Odyssey examples
  if (t.includes("tour department")) tags.add("tour_only");

  // Accessory-only guards
  const neg = ["headcover only", "cover only", "weight kit", "weights only", "grip only", "shaft only", "head only"];
  if (neg.some(n => t.includes(n))) return [];

  return Array.from(tags);
}

function buildVariantKey(baseModel, tags = []) {
  if (!baseModel) return "";
  if (!tags.length) return "";
  const sorted = [...new Set(tags)].sort();
  return `${String(baseModel).toLowerCase()}|${sorted.join("|")}`;
}

module.exports = { detectVariantSignals, buildVariantKey };
