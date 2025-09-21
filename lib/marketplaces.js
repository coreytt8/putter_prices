export const MARKET_OPTIONS = [
  { code: "EBAY_US", label: "United States" },
  { code: "EBAY_GB", label: "United Kingdom" },
  { code: "EBAY_DE", label: "Germany" },
  { code: "EBAY_FR", label: "France" },
  { code: "EBAY_IT", label: "Italy" },
  { code: "EBAY_ES", label: "Spain" },
  { code: "EBAY_AU", label: "Australia" },
  { code: "EBAY_CA", label: "Canada" },
  { code: "EBAY_IE", label: "Ireland" },
  { code: "EBAY_NL", label: "Netherlands" },
  { code: "EBAY_PL", label: "Poland" },
  { code: "EBAY_AT", label: "Austria" },
  { code: "EBAY_CH", label: "Switzerland" },
  { code: "EBAY_BE", label: "Belgium" },
  { code: "EBAY_SG", label: "Singapore" },
  { code: "EBAY_HK", label: "Hong Kong" },
];

export function loadSite() {
  if (typeof window === "undefined") return "EBAY_US";
  return localStorage.getItem("ebay_site") || "EBAY_US";
}
export function saveSite(site) {
  if (typeof window === "undefined") return;
  localStorage.setItem("ebay_site", site);
}
