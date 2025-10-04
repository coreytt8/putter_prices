// lib/variant-detect.js
// Robust tag detector for limited / tour / special variants across brands.
// Produces stable, lowercase tags; order is normalized by buildVariantKey.
//
// IMPORTANT:
// - detectVariantTags() returns ONLY "core" variant tags (used in variant_key).
// - detectVariantHints() returns child-line hints (for chips/UX, NOT in variant_key).

const RE = (s, flags = "i") => new RegExp(s, flags);

// helper: push uniq
function pushTag(arr, t) {
  if (!t) return;
  const v = String(t).trim().toLowerCase();
  if (v && !arr.includes(v)) arr.push(v);
}

// -------- Negative filters (skip accessories/parts) ----------
const NEGATIVE_HINTS = [
  RE("\\bhead\\s*cover\\b|\\bheadcover\\b|\\bcover\\b"),
  RE("\\bweights?\\b|\\bweight\\s*kit\\b"),
  RE("\\btool\\b|\\bwrench\\b|\\bscrew\\b|\\bsleeve\\b|\\badapter\\b|\\bcap\\b"),
  RE("\\bshaft\\s*only\\b|\\bgrip\\s*only\\b|\\bhead\\s*only\\b|\\bclub\\s*head\\s*only\\b"),
];

// -------- Core “special / build” tags (used in variant_key) ----------
const TAG_RULES = [
  // Tour / Proto / Department
  ["circle_t",        [RE("\\b(circle\\s*t|\\bct\\b|circle[-\\s]?t)")]],
  ["tour_only",       [RE("\\btour\\s*only\\b"), RE("\\btour\\s*(?:dept|department)\\b")]],
  ["tour_issue",      [RE("\\btour\\s*issue\\b")]],
  ["prototype",       [RE("\\bprototype\\b|\\bproto\\b")]],

  // Scotty Cameron
  ["gss",             [RE("\\bgss\\b|german\\s*stainless")]],
  ["sss",             [RE("\\bsss\\b|studio\\s*stainless")]],
  ["button_back",     [RE("\\bbutton\\s*back\\b|\\bbuttonback\\b")]],
  ["champions_choice",[RE("\\bchamp(?:ion)?s?\\s*choice\\b")]],
  ["tei3",            [RE("\\btei\\s*3\\b|\\btei3\\b")]],
  ["jet_set",         [RE("\\bjet\\s*set\\b")]],
  ["t22",             [RE("\\bt22\\b")]],
  ["009",             [RE("\\b009\\b")]],
  ["tour_rat",        [RE("\\btour\\s*rat\\b")]],
  ["garage",          [RE("\\bgarage\\b")]],
  ["plus",            [RE("\\bplus\\b")]], // e.g., Newport 2 Plus

  // TaylorMade Spider notable build patterns
  ["double_bend",     [RE("\\bdouble\\s*bend\\b|\\bdb\\b(?![a-z])")]],
  ["single_bend",     [RE("\\bsingle\\s*bend\\b|\\bsb\\b(?![a-z])")]],
  ["l_neck",          [RE("\\bl[-\\s]*neck\\b|\\bl\\s*neck\\b")]],
  ["flow_neck",       [RE("\\bflow\\s*neck\\b|\\bfn\\b(?![a-z])")]],
  ["small_slant",     [RE("\\bsmall\\s*slant\\b")]],
  ["counterbalance",  [RE("\\bcounter\\s*balance\\b|\\bcb\\b(?![a-z])")]],
  ["zt",              [RE("\\bzt\\b")]],            // Spider 5K ZT
  // (counterbalance already captured; “zt cb” becomes zt + counterbalance)

  // Ping
  ["pld",             [RE("\\bpld\\b")]],
  ["wrx",             [RE("\\bwrx\\b")]],

  // Odyssey / Toulon
  ["small_batch",     [RE("\\bsmall\\s*batch\\b")]],
  ["toulon_garage",   [RE("\\btoulon\\s*garage\\b")]],
  ["stroke_lab",      [RE("\\bstroke\\s*lab\\b")]],

  // Bettinardi
  ["hive",            [RE("\\bhive\\b")]],
  ["dass",            [RE("\\bdass\\b|double\\s*aged\\s*stainless")]],
  ["tour_dept",       [RE("\\btour\\s*dept\\b")]],
  ["inovai",          [RE("\\binovai\\b")]],
  ["studio_stock",    [RE("\\bstudio\\s*stock\\b")]],
  ["queen_b",         [RE("\\bqueen\\s*b\\b")]],

  // L.A.B.
  ["mezz_1",          [RE("\\bmezz\\.?1\\b")]],
  ["df_2_1",          [RE("\\bdf\\s*2\\.?1\\b")]],

  // Evnroll
  ["evnroll",         [RE("\\ber\\d+(?:\\.\\d+)?\\b")]],

  // General limited runs / editions
  ["limited",         [RE("\\blimited\\b|\\bltd\\b|\\blim(?:ited)?\\s*edition\\b")]],
];

// -------- Brand- / line- “child hints” (NOT used in variant_key) ----------
const CHILD_LINE_RULES = [
  // Scotty sub-lines
  ["phantom_x",       [RE("\\bphantom\\s*x\\b")]],
  ["super_select",    [RE("\\bsuper\\s*select\\b")]],
  ["special_select",  [RE("\\bspecial\\s*select\\b")]],
  ["studio_select",   [RE("\\bstudio\\s*select\\b")]],
  ["select",          [RE("\\bselect\\b")]],

  // TaylorMade Spider line families
  ["spider_tour",     [RE("\\bspider\\s*tour\\b")]],
  ["spider_x",        [RE("\\bspider\\s*x\\b")]],
  ["spider_v",        [RE("\\bspider\\s*v\\b")]],
  ["spider_s",        [RE("\\bspider\\s*s\\b")]],
  ["gt",              [RE("\\bspider\\s*gt\\b")]],
  ["gtx",             [RE("\\bspider\\s*gtx\\b")]],
  ["5k",              [RE("\\bspider\\s*5\\s*k\\b|\\b5k\\b")]],

  // Ping series
  ["karsten",         [RE("\\bkarsten\\b")]],
  ["anser_2d",        [RE("\\banser\\s*2\\s*d\\b")]],
  ["prime_tyne",      [RE("\\bprime\\s*tyne\\b")]],
  ["sigma",           [RE("\\bsigma\\s*2?\\b")]],
  ["vault",           [RE("\\bvault\\b")]],
  ["redwood",         [RE("\\bredwood\\b")]],

  // Odyssey series
  ["white_hot_og",    [RE("\\bwhite\\s*hot\\s*og\\b")]],
  ["ai_one",          [RE("\\bai[-\\s]*one\\b|\\bai-?1\\b")]],
  ["triple_track",    [RE("\\btriple\\s*track\\b")]],
  ["toulon",          [RE("\\btoulon\\b")]],
];

// ---------- Detection ----------

/**
 * Detect ONLY core variant tags (used to build variant_key).
 * @param {string} title
 * @param {string} extra
 * @returns {string[]} tags
 */
export function detectVariantTags(title = "", extra = "") {
  const text = `${String(title || "")} ${String(extra || "")}`.toLowerCase();

  // skip accessory/parts listings
  if (NEGATIVE_HINTS.some((r) => r.test(text))) return [];

  const tags = [];
  for (const [tag, patterns] of TAG_RULES) {
    if (patterns.some((r) => r.test(text))) pushTag(tags, tag);
  }
  return tags;
}

/**
 * Detect child-line hints (NOT included in variant_key; OK for chips/UX only).
 * @param {string} title
 * @param {string} extra
 * @returns {string[]} child tags
 */
export function detectVariantHints(title = "", extra = "") {
  const text = `${String(title || "")} ${String(extra || "")}`.toLowerCase();
  const tags = [];
  for (const [tag, patterns] of CHILD_LINE_RULES) {
    if (patterns.some((r) => r.test(text))) pushTag(tags, tag);
  }
  return tags;
}

// ---------- Key + Labels ----------

/**
 * Stable “model|tag|tag” key with sorted tags.
 * Only pass CORE tags here (from detectVariantTags).
 */
export function buildVariantKey(modelKey = "", tags = []) {
  const normModel = String(modelKey || "").trim().toLowerCase();
  const uniqTags = Array.from(
    new Set((tags || []).filter(Boolean).map((t) => String(t).trim().toLowerCase()))
  );
  if (!normModel || uniqTags.length === 0) return "";
  const sorted = uniqTags.sort();
  return `${normModel}|${sorted.join("|")}`;
}

const PRETTY = new Map([
  // tour / proto
  ["circle_t", "Circle T"],
  ["tour_only", "Tour Only"],
  ["tour_issue", "Tour Issue"],
  ["prototype", "Prototype"],

  // scotty
  ["gss", "GSS"],
  ["sss", "SSS"],
  ["button_back", "Button Back"],
  ["champions_choice", "Champions Choice"],
  ["tei3", "TeI3"],
  ["jet_set", "Jet Set"],
  ["t22", "T22"],
  ["009", "009"],
  ["tour_rat", "Tour Rat"],
  ["garage", "Garage"],
  ["plus", "Plus"],

  // build/neck
  ["counterbalance", "Counterbalance"],
  ["armlock", "Armlock"],
  ["l_neck", "L-Neck"],
  ["double_bend", "Double Bend"],
  ["single_bend", "Single Bend"],
  ["flow_neck", "Flow Neck"],
  ["small_slant", "Small Slant"],
  ["zt", "ZT"],

  // ping
  ["pld", "PLD"],
  ["wrx", "WRX"],

  // odyssey/toulon
  ["small_batch", "Small Batch"],
  ["toulon_garage", "Toulon Garage"],
  ["stroke_lab", "Stroke Lab"],

  // bettinardi
  ["hive", "Hive"],
  ["dass", "DASS"],
  ["tour_dept", "Tour Dept"],
  ["inovai", "Inovai"],
  ["studio_stock", "Studio Stock"],
  ["queen_b", "Queen B"],

  // L.A.B.
  ["mezz_1", "Mezz.1"],
  ["df_2_1", "DF 2.1"],

  // evnroll
  ["evnroll", "Evnroll"],

  // general
  ["limited", "Limited"],

  // child-line (for chips/UX if you show them)
  ["phantom_x", "Phantom X"],
  ["super_select", "Super Select"],
  ["special_select", "Special Select"],
  ["studio_select", "Studio Select"],
  ["select", "Select"],
  ["spider_tour", "Spider Tour"],
  ["spider_x", "Spider X"],
  ["spider_v", "Spider V"],
  ["spider_s", "Spider S"],
  ["gt", "Spider GT"],
  ["gtx", "Spider GTX"],
  ["5k", "5K"],
  ["karsten", "Karsten"],
  ["anser_2d", "Anser 2D"],
  ["prime_tyne", "Prime Tyne"],
  ["sigma", "Sigma"],
  ["vault", "Vault"],
  ["redwood", "Redwood"],
  ["white_hot_og", "White Hot OG"],
  ["ai_one", "Ai One"],
  ["triple_track", "Triple Track"],
  ["toulon", "Toulon"],
]);

export function prettyTag(tag) {
  const t = String(tag || "").trim().toLowerCase();
  return PRETTY.get(t) || t.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}
