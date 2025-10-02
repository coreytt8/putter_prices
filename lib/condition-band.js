// lib/condition-band.js
export function mapConditionIdToBand(id) {
  const n = Number(id);
  if (n === 1000) return 'NEW';                 // New
  if ([1500,1750,2750,2000].includes(n)) return 'LIKE_NEW'; // new other/open box/refurb
  if (n === 2500) return 'GOOD';                // seller refurbished
  if (n === 3000) return 'USED';                // Used
  if (n === 4000) return 'LIKE_NEW';            // Very Good (tune if you prefer GOOD)
  if (n === 5000) return 'GOOD';                // Good
  if (n === 6000) return 'FAIR';                // Acceptable
  if (n === 7000) return 'FAIR';                // For parts/repair (or exclude)
  return 'USED';
}
