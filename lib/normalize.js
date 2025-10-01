// lib/normalize.js
// ASCII-only; no smart quotes.

// lib/normalize.js  (ASCII only)
export function normalizeModelKey(title = "") {
  let s = String(title || "").toLowerCase();

  // unify quotes / inches marks
  s = s
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')  // various double quotes → "
    .replace(/[\u2018\u2019]/g, "'")             // various single quotes → '
    .replace(/[\u2033]/g, '"');                  // inch-like → "

  // remove 4-digit years like 2013, 2021, 2023, 2025
  s = s.replace(/\b(19|20)\d{2}\b/g, " ");

  // remove length measurements with units: 33", 35'', 34 in, 32-36 in, 34.5"
  s = s.replace(/\b(3[2-9]|40)(\.\d+)?(\s*-\s*(3[2-9]|40)(\.\d+)?)?\s*(?:in|inch|inches|["']{1,2})\b/g, " ");

  // remove bare standalone 32–40 at token boundaries (lengths without units)
  s = s.replace(/\b(3[2-9]|40)(?:\.\d+)?\b/g, " ");

  // remove handedness tokens
  s = s
    .replace(/\b(right|left)[-\s]*hand(?:ed)?\b/g, " ")
    .replace(/\b(?:rh|lh)\b/g, " ");

  // remove common non-model descriptors (keep core model/variant tokens)
  s = s.replace(/\b(putter|mallet|blade|shop|worn|good|fair|used|mint|new|very\s+good|like\s*new|club|head|only|silver|navy|white|black|red|gray|grey|with|w\/|cover|headcover|superstroke|pistol|grip|steel|graphite)\b/g, " ");

  // drop serial/id style tokens like "# 200683"
  s = s.replace(/#\s*\d{5,}/g, " ");

  // collapse hyphen fragments and clean
  s = s.replace(/\s-\s+/g, " ")
       .replace(/[^a-z0-9+#.\- ]+/g, " ")
       .replace(/\s{2,}/g, " ")
       .trim();

  // optional tidy-ups (extend over time)
  s = s
    .replace(/\bsquareback\s*#?\s*2\b/g, "squareback 2")
    .replace(/\bphantom\s*x\s*5\.?5\b/g, "phantom x 5.5")
    .replace(/\bnewport\s*#?\s*2\.?5\b/g, "newport 2.5");

  return s;
}

export function normalizeForSearch(title = "") {
  return String(title || '').toLowerCase().trim();
}
