const LETTER_META = {
  A: { label: "Great", color: "green" },
  B: { label: "Good", color: "emerald" },
  C: { label: "Fair", color: "slate" },
  D: { label: "Over", color: "red" },
};

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function gradeDeal({ total, p10, p50, p90, dispersionRatio } = {}) {
  const totalNum = toFiniteNumber(total);
  const median = toFiniteNumber(p50);

  if (!Number.isFinite(totalNum) || !Number.isFinite(median) || median <= 0) {
    return { letter: null, label: null, color: null, deltaPct: null };
  }

  const lower = toFiniteNumber(p10);
  const upper = toFiniteNumber(p90);
  const deltaPct = Number.isFinite(median) && median !== 0 ? (median - totalNum) / median : null;

  let letter = "D";

  if (Number.isFinite(lower) && totalNum <= lower) {
    letter = "A";
  } else if (Number.isFinite(median) && totalNum <= median * 0.9) {
    letter = "B";
  } else if (Number.isFinite(upper) && totalNum <= upper) {
    letter = "C";
  }

  const dispersion = toFiniteNumber(dispersionRatio);
  if (Number.isFinite(dispersion) && dispersion > 1.5 && letter === "A") {
    letter = "B";
  }

  const meta = LETTER_META[letter] || { label: null, color: null };

  return {
    letter,
    label: meta.label,
    color: meta.color,
    deltaPct: Number.isFinite(deltaPct) ? deltaPct : null,
  };
}
