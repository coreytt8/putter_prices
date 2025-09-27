// /lib/variants.js
// Cohort classification for editions & special variants.

const SCOTTY = [
  { rx: /\bcircle\s*t\b|\bct\b/i, edition: "tour", tag: "Circle T" },
  { rx: /\btour\s*(only|dept|department|issue)?\b/i, edition: "tour", tag: "Tour Only" },
  { rx: /\bprototype\b/i, edition: "tour", tag: "Prototype" },
  { rx: /\bgss\b|\bgerman\s*stainless\b/i, edition: "tour", tag: "GSS" },
  { rx: /\b009m?\b/i, edition: "tour", tag: "009" },
  { rx: /\bch(ampions)?\s*choice\b/i, edition: "limited", tag: "Champions Choice" },
  { rx: /\bbutton\s*back\b/i, edition: "limited", tag: "Button Back" },
  { rx: /\btei?3\b|\bteryll?ium\b/i, edition: "limited", tag: "TeI3" },
  { rx: /\blimited\b|\ble\b|\bgarage\b/i, edition: "limited", tag: "Limited" },
  { rx: /\bcustom\s*shop\b|\bcustom\b/i, edition: "custom", tag: "Custom" },
];

const ODYSSEY = [
  { rx: /\btoulon\b/i, edition: "limited", tag: "Toulon LE" },
  { rx: /\btour\s*(issue|only)?\b/i, edition: "tour", tag: "Tour" },
  { rx: /\blimited\b|\ble\b/i, edition: "limited", tag: "Limited" },
  { rx: /\bprototype\b/i, edition: "tour", tag: "Prototype" },
];

const PING = [
  { rx: /\bplat(inum)?\s*limited\b/i, edition: "limited", tag: "Platinum Limited" },
  { rx: /\btour\b/i, edition: "tour", tag: "Tour" },
];

const TM = [
  { rx: /\btour\s*(issue|only)?\b/i, edition: "tour", tag: "Tour" },
  { rx: /\blimited\b|\ble\b/i, edition: "limited", tag: "Limited" },
  { rx: /\bproto(type)?\b/i, edition: "tour", tag: "Prototype" },
];

const BRAND_RULES = {
  "scotty cameron": SCOTTY,
  "titleist": SCOTTY,
  "odyssey": ODYSSEY,
  "ping": PING,
  "taylormade": TM,
  "taylor made": TM,
};

const GENERIC = [
  { rx: /\btour\s*(only|issue)?\b/i, edition: "tour", tag: "Tour" },
  { rx: /\blimited\b|\ble\b/i, edition: "limited", tag: "Limited" },
  { rx: /\bproto(type)?\b/i, edition: "tour", tag: "Prototype" },
  { rx: /\bcustom\b/i, edition: "custom", tag: "Custom" },
];

export function classifyEdition(brand = "", title = "") {
  const b = (brand || "").toLowerCase().trim();
  const t = title || "";
  const rules = BRAND_RULES[b] || GENERIC;

  let edition = "standard";
  const variantTags = [];

  for (const r of rules) {
    if (r.rx.test(t)) {
      edition = r.edition === "tour" ? "tour" :
                r.edition === "limited" ? "limited" :
                r.edition === "custom" ? "custom" : "standard";
      if (r.tag) variantTags.push(r.tag);
    }
  }
  return { edition, variantTags };
}
