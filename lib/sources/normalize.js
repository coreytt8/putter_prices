// Map vendor condition strings → your bands
export function mapCondition(raw = "") {
  const s = String(raw || "").toLowerCase();
  if (!s) return "";
  if (/(^|\s)(new|brand\s*new|unused)(\s|$)/.test(s)) return "NEW";
  if (/(mint|like[-\s]*new|9\/10)/.test(s)) return "LIKE_NEW";
  if (/(very\s*good|8\/10|good)/.test(s)) return "GOOD";
  if (/(fair|7\/10|acceptable|used)/.test(s)) return "FAIR";
  return "USED";
}

export function inferSpecsFromTitle(title = "") {
  const t = String(title).toLowerCase();
  const dex =
    /(^|\s)(left|lh)(\s|$)/.test(t) ? "LEFT" :
    /(^|\s)(right|rh)(\s|$)/.test(t) ? "RIGHT" : undefined;

  const head =
    /mallet/.test(t) ? "MALLET" :
    /blade/.test(t) ? "BLADE" : undefined;

  const lenMatch = t.match(/\b(33|34|35|36)\b/);
  const length = lenMatch ? Number(lenMatch[1]) : undefined;

  return { dexterity: dex, headType: head, length };
}

export function num(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

export function median(nums) {
  const a = nums.slice().sort((x,y)=>x-y);
  const n = a.length;
  if (!n) return null;
  return n % 2 ? a[(n-1)/2] : (a[n/2-1] + a[n/2]) / 2;
}

export function dedupeKey(o) {
  return `${o.source}::${o.url}`;
}
