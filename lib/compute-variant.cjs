// lib/compute-variant.cjs
const { detectVariantSignals, buildVariantKey } = require("./variant-detect.cjs");

function toAspectsObject(itemSpecifics) {
  if (!Array.isArray(itemSpecifics)) return itemSpecifics || {};
  const out = {};
  for (const kv of itemSpecifics) {
    if (kv?.name && kv?.value) out[kv.name] = kv.value;
  }
  return out;
}

function computeVariantFields({ model, title, itemSpecifics }) {
  const aspects = toAspectsObject(itemSpecifics);
  const tags = detectVariantSignals({ title, aspects });
  const variant = tags.join(", ");
  const variant_key = buildVariantKey(model, tags);
  return { variant, variant_key };
}

module.exports = { computeVariantFields, toAspectsObject };
