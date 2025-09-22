// lib/specs.js
// Lightweight, title-first parser. Works even when itemSpecifics are sparse.

const INCH_RX = /(?:(?:^|\s)(?:length|l|len)\s*[:\-]?\s*)?(\d{2}(?:\.\d)?)\s*(?:\"|in(?:ch|ches)?\b)/i;
const LH_RX = /\b(left\s*hand(?:ed)?|LH)\b/i;
const RH_RX = /\b(right\s*hand(?:ed)?|RH)\b/i;

const MALLET_RX = /\b(mallet|spider|phantom|ten|eleven|seven|tyne|tomcat|fetch|inovai|bb48)\b/i;
const BLADE_RX  = /\b(blade|anser|newport|san\s*diego|8802|8802-style|tr)\b/i;

const HEADCOVER_RX = /\b(head\s*cover|headcover|hc|with\s*cover|includes\s*cover)\b/i;
const SHAFT_RX = /\b(black\s*shaft|stealth\s*shaft|graphite\s*shaft|steel\s*shaft|matte\s*black|blacked\s*out)\b/i;

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

  // head type (best-effort)
  let head_type = null;
  if (MALLET_RX.test(t)) head_type = "MALLET";
  else if (BLADE_RX.test(t)) head_type = "BLADE";

  // headcover + shaft hints
  const has_headcover = HEADCOVER_RX.test(t);
  const shaft = (t.match(SHAFT_RX)?.[0] || "")
    .replace(/\s*shaft\s*/i, "")
    .trim()
    .toLowerCase() || null;

  // If item specifics are provided, prefer them to title where sensible
  const sp = specifics || {};
  // (These keys vary a lot across listings; keep it conservative.)
  const spDex = String(sp.Dexterity || sp.Hand || sp.Handedness || "").toLowerCase();
  if (!dexterity) {
    if (/left/.test(spDex)) dexterity = "LEFT";
    else if (/right/.test(spDex)) dexterity = "RIGHT";
  }
  if (!length_in) {
    const spLen = Number(String(sp.Length || sp["Club Length"] || "").replace(/[^\d.]/g, ""));
    if (Number.isFinite(spLen) && spLen >= 30 && spLen <= 40) length_in = spLen;
  }
  if (!head_type) {
    const spHead = String(sp["Club Type"] || sp["Head Shape"] || "").toLowerCase();
    if (/mallet/.test(spHead)) head_type = "MALLET";
    else if (/blade/.test(spHead)) head_type = "BLADE";
  }

  return { dexterity, head_type, length_in, has_headcover, shaft };
}
