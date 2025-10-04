// lib/variant-detect.js
// Robust tag detector for limited / tour / special variants across brands.
// Produces stable, lowercase tags; order is normalized by buildVariantKey.

const RE = (s, flags = "i") => new RegExp(s, flags);

// Helper: push unique
function pushTag(arr, t) {
  if (t && !arr.includes(t)) arr.push(t);
}

// ---- Core tag dictionary (brand-agnostic) ----
// Each entry is [tag, [regex...]]; keep regex conservative to avoid false hits.
const TAG_RULES = [
  // Tour / Circle T / Proto / Tour Issue
  ["circle_t", [RE("\\b(circle\\s*t|\\bct\\b|circle[-\\s]?t)")]],
  ["tour_only", [RE("\\btour\\s*only\\b"), RE("\\btour\\s*(dept|department)\\b"), RE("\\btour\\s*(proto|prototype)\\b")]],
  ["tour_issue", [RE("\\btour\\s*issue\\b")]],
  ["prototype", [RE("\\bprototype\\b|\\bproto\\b")]],

  // Scotty Cameron family
  ["gss", [RE("\\bgss\\b|german\\s*stainless")]],
  ["sss", [RE("\\bsss\\b|studio\\s*stainless")]],
  ["button_back", [RE("\\bbutton\\s*back\\b")]],
  ["champions_choice", [RE("\\bchamp(ion)?s?\\s*choice\\b")]],
  ["tei3", [RE("\\btei\\s*3\\b|\\btei3\\b")]],
  ["jet_set", [RE("\\bjet\\s*set\\b")]],
  ["t22", [RE("\\bt22\\b")]],
  ["009", [RE("\\b009\\b")]],
  ["tour_rat", [RE("\\btour\\s*rat\\b")]],
  ["garage", [RE("\\bgarage\\b")]],

  // Bettinardi special
  ["hive", [RE("\\bhive\\b")]],
  ["dass", [RE("\\bdass\\b|double\\s*aged\\s*stainless")]],
  ["tour_dept", [RE("\\btour\\s*dept\\b")]],

  // Odyssey/Toulon special
  ["small_batch", [RE("\\bsmall\\s*batch\\b")]],
  ["toulon_garage", [RE("\\btoulon\\s*garage\\b")]],

  // Ping special
  ["wrx", [RE("\\bwrx\\b")]],
  ["pld", [RE("\\bpld\\b")]],

  // LAB/Evnroll/etc. (limited runs)
  ["limited", [RE("\\blimited\\b|\\bltd\\b|\\blim(?:ited)?\\s*edition\\b")]],

  // Neck / format / build (generic)
  ["counterbalance", [RE("\\bcounter\\s*balance|counterbalanced|\\bc-b\\b|\\bcb\\b(?![a-z])")]],
  ["armlock", [RE("\\barmlock\\b|arm\\s*lock")]],
  ["l_neck", [RE("\\bl[-\\s]*neck\\b|\\bl\\s*neck\\b")]],
  ["double_bend", [RE("\\bdouble\\s*bend\\b|double-bend|\\bdbl\\s*bend\\b|\\bdb\\b(?![a-z])")]],
  ["single_bend", [RE("\\bsingle\\s*bend\\b|\\bsb\\b(?![a-z])")]],
  ["flow_neck", [RE("\\bflow\\s*neck\\b|\\bfn\\b(?![a-z])")]],
  ["center_shaft", [RE("\\bcenter\\s*shaft(?:ed)?\\b|\\bcentershaft\\b|\\bcs\\b(?![a-z])")]],
  ["heel_shaft", [RE("\\bheel[-\\s]*shaft(?:ed)?\\b")]],

  // Truss hosels
  ["truss_tm1", [RE("\\btruss\\s*tm1\\b")]],
  ["truss_tm2", [RE("\\btruss\\s*tm2\\b")]],

  // Spider Tour – context-sensitive helpers:
  // - #3 ≈ small slant; #1 ≈ L-neck; "Scheffler" is the L-neck signature.
  ["small_slant", [
    // explicit text
    RE("\\bsmall\\s*slant\\b|\\bshort\\s*slant\\b"),
    // contextual “#3” when Spider Tour appears
    RE("(?=.*spider\\s*tour)\\s*#?\\s*3\\b")
  ]],
  ["l_neck_ctx", [
    // contextual “#1” when Spider Tour appears
    RE("(?=.*spider\\s*tour)\\s*#?\\s*1\\b"),
    // “Scheffler” = L-neck on Spider Tour
    RE("(?=.*spider\\s*tour)scheffler")
  ]],
];

// ---- Brand-aware “child models” (for better grouping) ----
const CHILD_LINE_RULES = [
  // Scotty Cameron sub-lines
  ["phantom_x", [RE("\\bphantom\\s*x\\b")]],
  ["super_select", [RE("\\bsuper\\s*select\\b")]],
  ["special_select", [RE("\\bspecial\\s*select\\b")]],
  ["studio_select", [RE("\\bstudio\\s*select\\b")]],
  ["select", [RE("\\bselect\\b")]],

  // TaylorMade Spider families
  ["spider_tour", [RE("\\bspider\\s*tour\\b")]],
  ["spider_x", [RE("\\bspider\\s*x\\b")]],
  ["spider_v", [RE("\\bspider\\s*v\\b")]],
  ["spider_z", [RE("\\bspider\\s*z\\b")]],
  ["gt", [RE("\\bspider\\s*gt\\b")]],
  ["gtx", [RE("\\bspider\\s*gtx\\b")]],
  ["5k", [RE("\\bspider\\s*5\\s*k\\b|\\b5k\\b")]],

  // Ping series
  ["karsten", [RE("\\bkarsten\\b")]],
  ["anser_2d", [RE("\\banser\\s*2\\s*d\\b")]],
  ["prime_tyne", [RE("\\bprime\\s*tyne\\b")]],
  ["sigma", [RE("\\bsigma\\s*2?\\b")]],
  ["vault", [RE("\\bvault\\b")]],
  ["redwood", [RE("\\bredwood\\b")]],

  // Odyssey series
  ["white_hot_og", [RE("\\bwhite\\s*hot\\s*og\\b")]],
  ["ai_one", [RE("\\bai[-\\s]*one\\b|\\bai-?1\\b")]],
  ["stroke_lab", [RE("\\bstroke\\s*lab\\b")]],
  ["triple_track", [RE("\\btriple\\s*track\\b")]],
  ["toulon", [RE("\\btoulon\\b")]],

  // Bettinardi series
  ["queen_b", [RE("\\bqueen\\s*b\\b")]],
  ["studio_stock", [RE("\\bstudio\\s*stock\\b")]],
  ["inovai", [RE("\\binovai\\b")]],
];

// Optional: ignore terms that shouldn’t create variants
const NEGATIVE_HINTS = [
  RE("\\bcover\\b"),              // headcovers
  RE("\\bweights?\\b"),           // accessory weights
  RE("\\btool\\b"),               // tools, wrenches
  RE("\\bshaft\\s*only\\b"),      // parts-only
  RE("\\bhead\\s*only\\b"),       // heads-only
];

// Core detector from a listing title (plus optional subtitle/etc.)
export function detectVariantTags(title = "", extra = "") {
  const text = `${String(title || "")} ${String(extra || "")}`.toLowerCase();

  // quick ignore: if it looks like accessory-only listing
  if (NEGATIVE_HINTS.some((r) => r.test(text))) return [];

  const tags = [];

  for (const [tag, patterns] of TAG_RULES) {
    if (patterns.some((r) => r.test(text))) {
      // fold l_neck_ctx into l_neck so we don’t expose two labels
      pushTag(tags, tag === "l_neck_ctx" ? "l_neck" : tag);
    }
  }
  for (const [tag, patterns] of CHILD_LINE_RULES) {
    if (patterns.some((r) => r.test(text))) pushTag(tags, tag);
  }

  return tags;
}

// Stable “model|tag|tag” key with sorted tags
export function buildVariantKey(modelKey = "", tags = []) {
  const normModel = String(modelKey || "").trim().toLowerCase();
  const uniqTags = Array.from(new Set((tags || []).filter(Boolean).map((t) => String(t).trim().toLowerCase())));
  if (!normModel || uniqTags.length === 0) return "";
  const sorted = uniqTags.sort();
  return `${normModel}|${sorted.join("|")}`;
}

// Optional pretty label for chips (map tag → human label)
const PRETTY = new Map([
  ["circle_t", "Circle T"],
  ["tour_only", "Tour Only"],
  ["tour_issue", "Tour Issue"],
  ["prototype", "Prototype"],
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
  ["hive", "Hive"],
  ["dass", "DASS"],
  ["tour_dept", "Tour Dept"],
  ["small_batch", "Small Batch"],
  ["toulon_garage", "Toulon Garage"],
  ["wrx", "WRX"],
  ["pld", "PLD"],
  ["limited", "Limited"],

  ["counterbalance", "Counterbalance"],
  ["armlock", "Armlock"],
  ["l_neck", "L-Neck"],
  ["double_bend", "Double Bend"],
  ["single_bend", "Single Bend"],
  ["flow_neck", "Flow Neck"],
  ["center_shaft", "Center Shaft"],
  ["heel_shaft", "Heel Shaft"],

  // Truss
  ["truss_tm1", "Truss TM1"],
  ["truss_tm2", "Truss TM2"],

  // child lines:
  ["phantom_x", "Phantom X"],
  ["super_select", "Super Select"],
  ["special_select", "Special Select"],
  ["studio_select", "Studio Select"],
  ["select", "Select"],

  ["spider_tour", "Spider Tour"],
  ["spider_x", "Spider X"],
  ["spider_v", "Spider V"],
  ["spider_z", "Spider Z"],
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
  ["stroke_lab", "Stroke Lab"],
  ["triple_track", "Triple Track"],
  ["toulon", "Toulon"],

  ["queen_b", "Queen B"],
  ["studio_stock", "Studio Stock"],
  ["inovai", "Inovai"],
]);

export function prettyTag(tag) {
  return PRETTY.get(tag) || tag.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}
