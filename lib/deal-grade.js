// lib/deal-grade.js
// Grades a deal vs the model median (p50). Keeps logic simple and explainable.

export function computeSavings(total, p50Cents) {
  const p50 = Number(p50Cents || 0) / 100;
  const t = Number(total || 0);
  if (!Number.isFinite(p50) || p50 <= 0 || !Number.isFinite(t) || t <= 0) {
    return { amount: 0, pct: 0 };
  }
  const amount = Math.max(0, p50 - t);
  const pct = amount / p50;
  return { amount, pct };
}

// Simple banding; we can later tune by dispersion, sample size, or condition.
export function gradeFromPct(pct) {
  if (!Number.isFinite(pct)) return "—";
  if (pct >= 0.30) return "A";
  if (pct >= 0.20) return "B";
  if (pct >= 0.10) return "C";
  if (pct > 0.0) return "D";
  return "F"; // at/above median price, not a "deal"
}

export function dealGrade(total, p50Cents) {
  const { amount, pct } = computeSavings(total, p50Cents);
  return { letter: gradeFromPct(pct), savingsAmount: amount, savingsPct: pct };
}
