// lib/specs.js
// Title-first parser with a few common eBay aspect keys as a fallback.

const INCH_RX = /(?:(?:^|\s)(?:length|l|len)\s*[:\-]?\s*)?(\d{2}(?:\.\d)?)\s*(?:\"|in(?:ch|ches)?\b)/i;
const LH_RX = /\b(left\s*hand(?:ed)?|LH)\b/i;
const RH_RX = /\b(right\s*hand(?:ed)?|RH)\b/i;

const MALLET_RX = /\b(mallet|spider|phantom|ten|eleven|seven|tyne|tomcat|fetch|inovai|bb48)\b/i;
const BLADE_RX  = /\b(blade|anser|newport|san\s*diego|8802|tr)\b/i;

const HEADCOVER_RX = /\b(head\s*cover|headcover|hc|with\s*cover|includes\s*cover)\b/i;
const SHAFT_RX = /\b(black\s*shaft|stealth\s*shaft|graphite\s*shaft|steel\s*shaft|matte\s*black|blacked\s*out)\b/i;

// Hosel styles (very common in putter titles)
const HOSEL_MAP = [
  { rx: /\b(plumber'?s?\s*neck|plumbers?\s*neck|plumber)\b/i, val: "plumber" },
  { rx: /\b(flow\s*neck|flowneck)\b/i, val: "flow" },
  { rx: /\b(slant\s*neck|slantneck|short\s*slant|mid\s*slant)\b/i, val: "slant" },
  { rx: /\b(double[-\s]*bend)\b/i, val: "double-bend" },
  { rx: /\b(single[-\s]*bend)\b/i, val: "single-bend" },
  { rx: /\b(center\s*(shaft|shafted)|centershaft(ed)?)\b/i, val: "center" },
];

// Head weights (common for Camerons)
const WEIGHT_RX = /\b(3[0-9]{2})\s*g\b/i; // 300–399 g
// Finishes
const FINISH_MAP = [
  { rx: /\b(jet\s*black|tour\s*black|black\s*oxide|black(?:ed)?\b)\b/i, val: "black" },
  { rx: /\b(raw|bead\s*blast|brushed)\b/i, val: "raw" },
  { rx: /\b(stainless|ss)\b/i, val: "stainless" },
  { rx: /\b(copper|cupr?ous|champagne)\b/i, val: "copper" },
  { rx: /\b(silver|chrome|nickel)\b/i, val: "silver" },
];

function pickHosel(str) {
  for (const h of HOSEL_MAP) if (h.rx.test(str)) return h.val;
  return null;
}
function pickFinish(str) {
  for (const f of FINISH_MAP) if (f.rx.test(str)) return f.val;
  return null;
}

export function parseSpecs({ title = "", specifics = {} } = {}) {
  const t = String(title || "").trim();

  // length (inches)
  let length_in = null;
  const mLen = t.match(INCH_RX);
  if (mLen) {
    const n = Number(mLen[1]);
    if (Number.isFinite(n) && n >= 30 && n <= 40) length_in = n;
  }

  // dexterity
  let dexterity = null;
  if (LH_RX.test(t)) dexterity = "LEFT";
  else if (RH_RX.test(t)) dexterity = "RIGHT";

  // head type
  let head_type = null;
  if (MALLET_RX.test(t)) head_type = "MALLET";
  else if (BLADE_RX.test(t)) head_type = "BLADE";

  // convenience flags
  const has_headcover = HEADCOVER_RX.test(t) || null;

  // shaft hint (color/material vibe)
  const shaft = (t.match(SHAFT_RX)?.[0] || "")
    .replace(/\s*shaft\s*/i, "")
    .trim()
    .toLowerCase() || null;

  // hosel
  const hosel = pickHosel(t);

  // head weight
  const mW = t.match(WEIGHT_RX);
  const head_weight_g = mW ? Number(mW[1]) : null;

  // finish
  const finish = pickFinish(t);

  // -------- Item specifics (fallbacks / overrides) --------
  const sp = specifics || {};
  const spLower = Object.fromEntries(Object.entries(sp).map(([k,v]) => [k.toLowerCase(), String(v || "").toLowerCase()]));

  // dexterity from specifics
  if (!dexterity) {
    const sd = spLower.dexterity || spLower.hand || spLower.handedness || "";
    if (/left/.test(sd)) dexterity = "LEFT";
    else if (/right/.test(sd)) dexterity = "RIGHT";
  }

  // length from specifics
  if (!length_in) {
    const cand = sp["Length"] || sp["Club Length"] || spLower["club length"];
    if (cand) {
      const n = Number(String(cand).replace(/[^\d.]/g, ""));
      if (Number.isFinite(n) && n >= 30 && n <= 40) length_in = n;
    }
  }

  // head type from specifics
  if (!head_type) {
    const sh = sp["Head Shape"] || spLower["head shape"] || sp["Club Type"] || spLower["club type"] || "";
    if (/mallet/.test(String(sh))) head_type = "MALLET";
    else if (/blade/.test(String(sh))) head_type = "BLADE";
  }

  // hosel / finish from specifics (coarse)
  const hoselFromSp = pickHosel(JSON.stringify(sp));
  const finishFromSp = pickFinish(JSON.stringify(sp));

  return {
    dexterity,
    head_type,
    length_in,
    has_headcover,
    shaft,
    hosel: hosel || hoselFromSp,
    head_weight_g,
    finish: finish || finishFromSp,
  };
}
