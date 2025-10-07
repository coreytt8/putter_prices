// lib/deal-grade.js
// Deal grade vs p50 (median) using Corey’s thresholds:
// A+ ≥ 40% below, A 25–40% below, B 15–25% below, C 5–15% below, else D (Over)
const LETTER_META = {
  "A+": { label: "Great", color: "emerald" }, // badge uses emerald-600 text-white
  A:    { label: "Great", color: "green"   }, // badge uses green-600 text-white
  B:    { label: "Good",  color: "amber500"},
  C:    { label: "Fair",  color: "amber300"},
  D:    { label: "Over",  color: "red"     },
};

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function gradeDeal({ total, p50, p10, p90, dispersionRatio } = {}) {
  const price = toFiniteNumber(total);
  const median = toFiniteNumber(p50);
  if (!Number.isFinite(price) || !Number.isFinite(median) || median <= 0) {
    return { letter: null, label: null, color: null, deltaPct: null };
  }

  const deltaPct = (price - median) / median; // negative = below median (better)

  let letter = "D"; // default = Over
  if (deltaPct <= -0.40) letter = "A+";
  else if (deltaPct <= -0.25) letter = "A";
  else if (deltaPct <= -0.15) letter = "B";
  else if (deltaPct <= -0.05) letter = "C";

  // (Optional) knock down screaming A’s in highly dispersed markets:
  const dispersion = toFiniteNumber(dispersionRatio);
  if (letter === "A" && Number.isFinite(dispersion) && dispersion > 1.5) {
    letter = "B";
  }

  const meta = LETTER_META[letter] || { label: null, color: null };
  return { letter, label: meta.label, color: meta.color, deltaPct };
}
