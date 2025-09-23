// lib/specs-parse.js
// Heuristic parsers from title + description → structured specs

const YES = true;

export function normalizeModelKey(raw = '') {
  return (raw || '')
    .toLowerCase()
    .replace(/scotty\s*cameron|titleist|putter|golf|\b(rh|lh)\b|right\s*hand(ed)?|left\s*hand(ed)?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectDexterity(s = '') {
  const t = s.toLowerCase();
  if (/\b(left hand|left-hand|left handed|lh)\b/.test(t)) return 'LEFT';
  if (/\b(right hand|right-hand|right handed|rh)\b/.test(t)) return 'RIGHT';
  return null;
}

export function detectHeadType(s = '') {
  const t = s.toLowerCase();
  // common mallet families
  if (/\bmallet\b/.test(t) || /\bphantom\b/.test(t) || /\bten\b/.test(t) || /\bmezz\b/.test(t) || /\ber\d+\b/.test(t) || /\binovai\b/.test(t)) {
    return 'MALLET';
  }
  // common blade families
  if (/\bblade\b/.test(t) || /\banser\b/.test(t) || /\bnewport\b/.test(t) || /\b8802\b/.test(t) || /\bsan diego\b/.test(t)) {
    return 'BLADE';
  }
  return null;
}

export function extractLengthInches(s = '') {
  const t = s.toLowerCase().replace(/[”“”]/g, '"');
  const m = t.match(/\b(3[3-6])\s*(?:in|inch|")\b/);
  if (m) return Number(m[1]);
  const m2 = t.match(/\b(3[3-6])\b/);
  if (m2) return Number(m2[1]);
  return null;
}

export function parseShaft(s = '') {
  const t = s.toLowerCase();
  if (/\b(black) (shaft)\b/.test(t)) return 'black';
  if (/\b(stepless|steel)\b/.test(t)) return 'steel';
  if (/\b(chrome)\b/.test(t)) return 'chrome';
  if (/\b(graphite)\b/.test(t)) return 'graphite';
  return null;
}

export function parseHoselOrNeck(s = '') {
  const t = s.toLowerCase();
  if (/\b(plumber'?s|plumbers|plumber)\b/.test(t)) return 'plumber’s';
  if (/\b(slant|slant neck|short slant)\b/.test(t)) return 'slant';
  if (/\b(flow|flow neck|flowneck)\b/.test(t)) return 'flow';
  if (/\b(single bend)\b/.test(t)) return 'single bend';
  if (/\b(double bend)\b/.test(t)) return 'double bend';
  return null;
}

export function parseToeHang(s = '') {
  const t = s.toLowerCase();
  if (/\bface ?balanced\b/.test(t)) return 'face balanced';
  if (/\bslight toe hang\b/.test(t)) return 'slight';
  if (/\bmoderate toe hang\b/.test(t)) return 'moderate';
  if (/\bstrong toe hang\b/.test(t)) return 'strong';
  return null;
}

export function parseInsertOrFace(s = '') {
  const t = s.toLowerCase();
  if (/\b(insert)\b/.test(t)) {
    if (/\b(white hot)\b/.test(t)) return 'White Hot insert';
    if (/\b(milled)\b/.test(t)) return 'milled insert';
    return 'insert';
  }
  if (/\bmilled\b/.test(t)) return 'milled';
  return null;
}

export function parseGrip(s = '') {
  const t = s.toLowerCase();
  if (/\b(superstroke|super stroke)\b/.test(t)) return 'SuperStroke';
  if (/\b(pistol)\b/.test(t)) return 'pistol';
  if (/\b(lamkin)\b/.test(t)) return 'Lamkin';
  if (/\b(scotty|matador)\b/.test(t)) return 'Scotty';
  return null;
}

export function parseHeadcover(s = '') {
  const t = s.toLowerCase();
  if (/\bhead ?cover\b/.test(t) || /\bhc\b/.test(t) || /\bwith cover\b/.test(t) || /\bincludes (the )?cover\b/.test(t)) return YES;
  return null;
}

export function parseLoft(s = '') {
  const m = s.toLowerCase().match(/\b([1-6](?:\.\d)?)\s*°\s*loft\b/);
  if (m) return Number(m[1]);
  return null;
}

export function parseLie(s = '') {
  const m = s.toLowerCase().match(/\b([6-9]\d(?:\.\d)?)\s*°\s*lie\b/);
  if (m) return Number(m[1]);
  return null;
}

export function coalesceSpecsFrom(title = '', desc = '') {
  const hay = `${title || ''}\n${desc || ''}`;

  const out = {};
  const dex = detectDexterity(hay); if (dex) out.dexterity = dex;
  const head = detectHeadType(hay); if (head) out.headType = head;
  const len = extractLengthInches(hay); if (len) out.length = len;

  const shaft = parseShaft(hay); if (shaft) out.shaft = shaft;
  const hosel = parseHoselOrNeck(hay); if (hosel) out.hosel = hosel;
  const toeHang = parseToeHang(hay); if (toeHang) out.toeHang = toeHang;
  const insert = parseInsertOrFace(hay); if (insert) out.face = insert;
  const grip = parseGrip(hay); if (grip) out.grip = grip;
  const hasHeadcover = parseHeadcover(hay); if (hasHeadcover != null) out.hasHeadcover = !!hasHeadcover;

  const loft = parseLoft(hay); if (loft != null) out.loft = loft;
  const lie = parseLie(hay); if (lie != null) out.lie = lie;

  return out;
}
