// lib/collector/collectorTaxonomy.js
export const BRAND_SYNONYMS = {
  "scotty cameron": ["scotty","cameron"],
  "bettinardi": ["betti","hive"],
  "ping": ["ping","pld","wrx"],
  "odyssey": ["odyssey","toulon"],
  "toulon": ["toulon"],
  "taylormade": ["taylormade","tm","spider"],
  "callaway": ["callaway"],
  "mizuno": ["mizuno"],
  "l.a.b.": ["lab","l.a.b","lie angle balance","l.a.b golf"],
  "evnroll": ["evnroll","er"],
  "pxg": ["pxg"],
  "sik": ["sik"],
  "swag": ["swag"],
  "logan olson": ["olson","logan olson","olson manufacturing"],
  "byron morgan": ["byron","byron morgan"],
  "see more": ["seemore","see more"],
};

export const GLOBAL_COLLECTOR_ALLOW = [
  "tour only","tour issue","tour use only","prototype","proto","one-off","1/1","limited","ltd",
  "hand made","handmade","hand-stamped","hand stamp","weld neck","welded","raw","black ox",
  "certificate of authenticity","coa"
];

export const BRAND_COLLECTOR_ALLOW = {
  "scotty cameron": [
    "circle t","ct","009","009m","009m+","gss","gss inlay","button back","buttonback",
    "jet set","masterful","timeless","tour rat","tourtype","xperimental","experimental","tiffany"
  ],
  "bettinardi": [
    "tour dept","tour department","hive","dass","ss303","fit face","tour issue","proto","bbzero","jm"
  ],
  "ping": [
    "pld limited","pld milled","wrx","anser tour","anser 2d","proto","tour issue"
  ],
  "odyssey": [
    "toulon small batch","toulon garage","tour prototype","protype","odyssey works tour","tour issue"
  ],
  "toulon": ["small batch","garage","tour issue","proto"],
  "taylormade": ["tour issue","mytp","my tp","spider limited","proto"],
  "callaway": ["tour issue","proto","limited"],
  "mizuno": ["milled tour","proto","limited"],
  "l.a.b.": ["tour issue","proto","limited","df3 limited","mez proto"],
  "evnroll": ["tour spec","proto","one-off","limited"],
  "pxg": ["prototype","tour issue","one-off","limited"],
  "sik": ["tour issue","proto","limited"],
  "swag": ["limited","proto","tour","putter lab","one-off"],
  "logan olson": ["handmade","prototype","one-off","raw","black ox","tiffany"],
  "byron morgan": ["handmade","dass","ss303","proto","one-off"],
  "see more": ["proto","tour dept","tour issue","limited"],
};

export const HEADCOVER_ALLOW = [
  "headcover","head cover","cover","dancing","circle t cover","tour rat cover",
  "jet set cover","small batch cover","hive cover"
];
