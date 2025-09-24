// lib/variantMap.js
const RX = (re) => re; // helper so syntax highlighting is nice

export function detectVariant(title = "") {
  const t = String(title).toLowerCase();

  // Strong signals for Scotty Cameron variants
  if (/\bcircle\s*t\b/.test(t) || /\bct\b(?!\w)/.test(t) || /tour\s*only/.test(t) || /tour\s+issue/.test(t)) {
    return "CIRCLE_T"; // Tour-Only / Circle T
  }
  if (/\bgss\b/.test(t) || /german\s+stainless/.test(t)) {
    return "GSS";
  }
  if (/\b009m?\b/.test(t) || /\btimeless\b/.test(t)) {
    return "009";
  }
  if (/\bbutton\s*back\b/.test(t) || /\bbb\b/.test(t) && /button/.test(t)) {
    return "BUTTON_BACK";
  }
  if (/\bte[i1]3\b/.test(t) || /\bteryll?ium\b/.test(t)) {
    return "TEI3";
  }
  if (/\bgarage\b/.test(t) || /\bcustom\s*shop\b/.test(t)) {
    return "GARAGE";
  }
  if (/\blimited\b/.test(t) || /\ble\s+?(\d+)?\b/.test(t) || /\bmasters\b/.test(t)) {
    return "LIMITED";
  }

  // Odyssey / TaylorMade examples (expand as needed)
  if (/\btour\s+issue\b/.test(t)) return "TOUR_ISSUE";
  if (/\bproto(type)?\b/.test(t)) return "PROTO";
  if (/\bsmall\s*slant\b/.test(t)) return "SMALL_SLANT";

  return null; // base variant
}
