export function isLabsOn() {
  return process.env.NEXT_PUBLIC_LABS === "1";
}
export function getCompareIds() {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem("compareIds") || "[]"); } catch { return []; }
}
export function addToCompare(id) {
  if (typeof window === "undefined") return;
  const set = new Set(getCompareIds());
  set.add(id);
  localStorage.setItem("compareIds", JSON.stringify([...set]));
}
export function compareUrl() {
  const ids = getCompareIds();
  return `/labs/compare?ids=${encodeURIComponent(ids.join(","))}`;
}
