// lib/deal-grade.js
// Deal grade thresholds (percentage below the in-band median):
// A+ ≥ 40%, A ≥ 25%, B ≥ 15%, C ≥ 5%, else no grade.

const LETTER_META = {
  "A+": { label: "Exceptional", color: "emerald" },
  A: { label: "Great", color: "emerald" },
  B: { label: "Strong", color: "sky" },
  C: { label: "Solid", color: "amber" },
};

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function gradeDeal({ savingsPct } = {}) {
  const pct = toFiniteNumber(savingsPct);
  if (!Number.isFinite(pct) || pct <= 0) {
    return { letter: null, label: null, color: null, deltaPct: null };
  }

  let letter = null;
  if (pct >= 0.40) letter = "A+";
  else if (pct >= 0.25) letter = "A";
  else if (pct >= 0.15) letter = "B";
  else if (pct >= 0.05) letter = "C";

  if (!letter) {
    return { letter: null, label: null, color: null, deltaPct: -pct };
  }

  const meta = LETTER_META[letter] || { label: null, color: null };
  return { letter, label: meta.label, color: meta.color, deltaPct: -pct };
}
