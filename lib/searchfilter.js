// lib/searchFilter.js

function norm(s) {
  return String(s || "").toLowerCase().trim();
}

function tokensFromQuery(q) {
  const t = norm(q).replace(/[#/_\-.]/g, " ");
  const stop = new Set([
    "putter","putters","golf","club","clubs","hand","handed","mens","women","ladies","lh","rh",
    "in","inch","inches"
  ]);
  return t.split(/\s+/).filter(x => x && !stop.has(x));
}

const ALIASES = {
  scotty: ["scotty","cameron","titleist"],
  cameron: ["scotty","cameron","titleist"],
  titleist: ["titleist","scotty","cameron"],
  taylormade: ["taylormade","taylor","made","tm","spider"],
  odyssey: ["odyssey","jailbird","tri-hot","white hot","versa","ai-one"],
  ping: ["ping","anser","pld","vault"],
  bettinardi: ["bettinardi","bb","studio stock","queen b"],
  lab: ["lab","l.a.b.","df","mezz","mez"]
};

function expandTokens(arr) {
  const out = new Set();
  arr.forEach(t => { out.add(t); (ALIASES[t] || []).forEach(a => out.add(a)); });
  return Array.from(out);
}

function hitsIn(text, toks) {
  const s = ` ${norm(text)} `;
  let n = 0;
  for (const tok of toks) {
    const esc = tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, "i");
    if (re.test(s)) n++;
  }
  return n;
}

const MODEL_TOKENS_ORDERED = [
  "newport 2","newport2","newport","napa","phantom","futura","fastback","squareback",
  "golo","anser","spider","jailbird","bb","studio stock","queen b","pld","vault","df","mezz"
];

const RARE_MODELS = new Set([
  "napa","tei3","circa","bb","np","np2","x5","x7","x5.5","x7.5","bee","timeless","golo","futura","fastback","squareback","fb","sb"
]);

// ===== Your function =====
function applySearchFilter(q, items) {
  // items: [{title,url,price,image}]
  const qLC = norm(q);
  const RAW = tokensFromQuery(q);
  const TOKENS = expandTokens(RAW);

  const brandKey = Object.keys(ALIASES).find(b => RAW.includes(b));
  const needBrand = Boolean(brandKey);
  const brandList = ALIASES[brandKey] || [];

  const foundModel = MODEL_TOKENS_ORDERED.find(t => qLC.includes(t));
  const brandInQuery = [
    "scotty","cameron","titleist","odyssey","ping","taylormade","bettinardi","lab","l.a.b."
  ].find(b => qLC.includes(b));

  let out = items.slice();

  // Model-first branch (great for short models like “napa”)
  if (foundModel) {
    const dash = foundModel.replace(/\s+/g,"-");
    const tight = foundModel.replace(/\s+/g,"");
    out = out.filter(p => {
      const T = norm(p.title), U = norm(p.url);
      const modelHit =
        T.includes(foundModel) || U.includes(foundModel) || U.includes(dash) || U.includes(tight);
      const brandOk = brandInQuery ? (T.includes(brandInQuery) || U.includes(brandInQuery)) : true;
      return modelHit && brandOk;
    }).sort((a,b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    return out;
  }

  // Token scoring fallback (title + URL)
  const hasRare = RAW.some(t => RARE_MODELS.has(t));
  const MIN = hasRare ? 1 : (RAW.length >= 2 ? 2 : 1);
  if (!TOKENS.length) return out;

  out = out
    .map(x => {
      const score = Math.max(hitsIn(x.title, TOKENS), hitsIn(x.url, TOKENS));
      const brandHit = needBrand
        ? (hitsIn(x.title, brandList) > 0 || hitsIn(x.url, brandList) > 0)
        : true;
      return { x, score, brandHit };
    })
    .filter(r => r.brandHit && r.score >= MIN)
    .sort((a,b) => (b.score - a.score) || ((a.x.price ?? Infinity) - (b.x.price ?? Infinity)))
    .map(r => r.x);

  return out;
}

// CommonJS export so API route can `require(...)`
module.exports = { applySearchFilter };
