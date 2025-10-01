const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const modulePath = path.join(__dirname, "..", "sanitizeModelKey.js");
const moduleHref = pathToFileURL(modulePath).href;
const modulePromise = import(moduleHref);

const HEAD_COVER_REGEX = /\bhead(?:\s|-)?covers?\b/i;
const normalizeJetSetCheck = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

function hasJetSetTokens(value) {
  if (!value) {
    return false;
  }
  if (/\bjet\s+set\b/i.test(String(value))) {
    return true;
  }
  const normalized = normalizeJetSetCheck(value);
  return normalized.includes("jetset");
}

test("buildDealCtaHref removes noisy tokens and preserves modelKey", async () => {
  const { buildDealCtaHref } = await modulePromise;

  const deal = {
    modelKey: "SeeMore|Mini Giant|Deep Flange|Tour",
    label: "SeeMore Mini Giant Deep Flange Tour 🟢 w/Headcover 34\"",
    query: "SeeMore Mini Giant Deep Flange Tour 🟢 w/Headcover 34\"",
    queryVariants: {
      clean: "SeeMore Mini Giant Deep Flange Tour 🟢 w/Headcover 34\"",
      accessory: "SeeMore Mini Giant Deep Flange Tour 🟢 w/Headcover 34\" 🎯",
    },
    bestOffer: {
      title: "SeeMore Mini Giant Deep Flange Tour Putter 🟢 w/HC 34\"",
    },
  };

  const { href, query } = buildDealCtaHref(deal);

  assert.ok(query.includes("SeeMore"));
  assert.ok(query.includes("Mini Giant Deep Flange Tour"));
  assert.ok(/\bputter\b/i.test(query));
  assert.ok(
    HEAD_COVER_REGEX.test(query),
    "expected headcover tokens to be preserved"
  );
  assert.ok(!/🟢/.test(query), "expected emoji to be removed");
  assert.ok(!/🎯/.test(query), "expected emoji from accessory variant to be removed");

  const url = new URL(href, "https://example.com");
  assert.equal(url.pathname, "/putters");
  assert.equal(url.searchParams.get("modelKey"), deal.modelKey);
  assert.equal(url.searchParams.get("q"), query);
});

test("buildDealCtaHref preserves Jet Set phrase in sanitized outputs", async () => {
  const { sanitizeModelKey, deriveDealSearchPhrase, buildDealCtaHref } =
    await modulePromise;

  const rawKey = "Titleist|Scotty Cameron|Special Select Jet Set|Newport 2";
  const sanitized = sanitizeModelKey(rawKey);

  assert.match(
    sanitized.label,
    /\bjet set\b/i,
    "expected sanitizeModelKey label to retain Jet Set tokens"
  );
  assert.match(
    sanitized.query,
    /\bjet set\b/i,
    "expected sanitizeModelKey query to retain Jet Set tokens"
  );

  const deal = {
    modelKey: rawKey,
    label: "Scotty Cameron Special Select Jet Set Newport 2 34\" Putter",
    query: "Scotty Cameron Special Select Jet Set Newport 2 34\" Putter",
    queryVariants: {
      clean: "Scotty Cameron Special Select Jet Set Newport 2 34\" Putter",
      accessory:
        "Scotty Cameron Special Select Jet Set Newport 2 34\" Putter",
    },
    bestOffer: {
      title: "Scotty Cameron Special Select Jet Set Newport 2 Putter",
    },
  };

  const derivedPhrase = deriveDealSearchPhrase(deal);
  assert.match(
    derivedPhrase,
    /\bjet set\b/i,
    "expected deriveDealSearchPhrase to retain Jet Set tokens"
  );

  const { query, href } = buildDealCtaHref(deal);
  assert.match(query, /\bjet set\b/i, "expected CTA query to retain Jet Set tokens");

  const url = new URL(href, "https://example.com");
  assert.equal(url.searchParams.get("q"), query);
  assert.match(
    url.searchParams.get("q") || "",
    /\bjet set\b/i,
    "expected CTA URL to include Jet Set tokens"
  );
});

test("buildDealCtaHref keeps Jet Set tokens across formatting variants", async () => {
  const { sanitizeModelKey, buildDealCtaHref } = await modulePromise;

  const variants = [
    {
      labelSegment: "Special Select JetSet",
      dealLabel: "Scotty Cameron Special Select JetSet Newport 2 34\" Putter",
      description: "JetSet",
    },
    {
      labelSegment: "Special Select Jet-Set",
      dealLabel: "Scotty Cameron Special Select Jet-Set Newport 2 34\" Putter",
      description: "Jet-Set",
    },
    {
      labelSegment: "Special Select Jet Set™",
      dealLabel: "Scotty Cameron Special Select Jet Set™ Newport 2 34\" Putter",
      description: "Jet Set™",
    },
  ];

  for (const variant of variants) {
    const rawKey = `Titleist|Scotty Cameron|${variant.labelSegment}|Newport 2`;
    const sanitized = sanitizeModelKey(rawKey);

    assert.ok(
      hasJetSetTokens(sanitized.label),
      `expected sanitizeModelKey label to retain Jet Set tokens for ${variant.description}`
    );

    const deal = {
      modelKey: rawKey,
      label: variant.dealLabel,
      query: variant.dealLabel,
      queryVariants: {
        clean: variant.dealLabel,
        accessory: variant.dealLabel,
      },
      bestOffer: {
        title: variant.dealLabel,
      },
    };

    const { query } = buildDealCtaHref(deal);
    assert.ok(
      hasJetSetTokens(query),
      `expected CTA query to retain Jet Set tokens for ${variant.description}`
    );
  }
});

test("buildDealCtaHref guards limited release phrases without protecting real accessory kits", async () => {
  const { sanitizeModelKey, buildDealCtaHref } = await modulePromise;

  const guardScenarios = [
    {
      description: "Jet Set release",
      rawKey: "Titleist|Scotty Cameron|Special Select Jet Set|Newport 2",
      deal: {
        modelKey: "Titleist|Scotty Cameron|Special Select Jet Set|Newport 2",
        label: "Scotty Cameron Special Select Jet Set Newport 2 Circle T Tool Putter",
        query: "Scotty Cameron Special Select Jet Set Newport 2 Circle T Tool Putter",
        queryVariants: {
          clean: "Scotty Cameron Special Select Jet Set Newport 2 Circle T Tool Putter",
          accessory: "Scotty Cameron Special Select Jet Set Newport 2 Circle T Tool Putter",
        },
        bestOffer: {
          title: "Scotty Cameron Special Select Jet Set Newport 2 Circle T Tool Putter",
        },
      },
      expected: /\bjet\s*set\b/i,
      extraAssertions: ({ query }) => {
        assert.match(
          query,
          /\btool\b/i,
          "expected Circle T Tool phrasing to preserve the tool token"
        );
      },
    },
    {
      description: "Bettinardi Tour Kit release",
      rawKey: "Bettinardi|Tour Dept|Tour Kit",
      deal: {
        modelKey: "Bettinardi|Tour Dept|Tour Kit",
        label: "Bettinardi Tour Kit DASS Hive 34\" Putter",
        query: "Bettinardi Tour Kit DASS Hive 34\" Putter",
        queryVariants: {
          clean: "Bettinardi Tour Kit DASS Hive 34\" Putter",
          accessory: "Bettinardi Tour Kit DASS Hive 34\" Putter",
        },
        bestOffer: {
          title: "Bettinardi Tour Kit DASS Hive 34\" Putter",
        },
      },
      expected: /\btour kit\b/i,
    },
  ];

  for (const scenario of guardScenarios) {
    const sanitized = sanitizeModelKey(scenario.rawKey);
    assert.match(
      sanitized.label,
      scenario.expected,
      `expected sanitizeModelKey label to retain ${scenario.description}`
    );

    const { query } = buildDealCtaHref(scenario.deal);
    assert.match(
      query,
      scenario.expected,
      `expected CTA query to retain ${scenario.description}`
    );
    if (typeof scenario.extraAssertions === "function") {
      scenario.extraAssertions({ query, sanitized });
    }
  }

  const accessoryDeal = {
    modelKey: "TaylorMade|Spider|Weight Kit",
    label: "TaylorMade Spider Weight Kit",
    query: "TaylorMade Spider Weight Kit",
    queryVariants: {
      clean: "TaylorMade Spider Weight Kit",
      accessory: "TaylorMade Spider Weight Kit",
    },
    bestOffer: {
      title: "TaylorMade Spider Weight Kit",
    },
  };

  const { query: accessoryQuery } = buildDealCtaHref(accessoryDeal);
  assert.doesNotMatch(
    accessoryQuery,
    /\bkit\b/i,
    "expected accessory kit tokens to be stripped from generic bundles"
  );
});

test("buildDealCtaHref prefers sanitized search phrase retaining brand tokens", async () => {
  const { buildDealCtaHref } = await modulePromise;

  const scenarios = [
    {
      label: "Titleist Scotty Cameron Phantom X 5",
      deal: {
        modelKey: "Titleist|Scotty Cameron|Phantom X 5",
        label: "Titleist Scotty Cameron Phantom X 5",
        query: "Phantom X 5",
        queryVariants: {
          clean: "Phantom X 5",
          accessory: "Titleist Scotty Cameron Phantom X 5 Headcover",
        },
        bestOffer: {
          title: "Titleist Scotty Cameron Phantom X 5 Putter",
        },
      },
      expected: /\btitleist\b/i,
    },
    {
      label: "Ping PLD Anser 4",
      deal: {
        modelKey: "Ping|PLD|Anser 4",
        label: "Ping PLD Anser 4",
        query: "PLD Anser 4",
        queryVariants: {
          clean: "PLD Anser 4",
          accessory: "Ping PLD Anser 4 Headcover",
        },
        bestOffer: {
          title: "Ping PLD Anser 4 Putter",
        },
      },
      expected: /\bping\b/i,
    },
  ];

  for (const scenario of scenarios) {
    const { query } = buildDealCtaHref(scenario.deal);
    assert.match(
      query,
      scenario.expected,
      `expected query for ${scenario.label} to include the brand token`
    );
  }
});

test("buildDealCtaHref retains decimal delimiters in sanitized queries", async () => {
  const { buildDealCtaHref } = await modulePromise;

  const deal = {
    modelKey: "Titleist|Scotty Cameron|Studio Style|Newport 2.5",
    label: "Scotty Cameron Studio Style Newport 2.5", 
    query: "Scotty Cameron Studio Style Newport 2.5",
    queryVariants: {
      clean: "Scotty Cameron Studio Style Newport 2.5",
      accessory: "Scotty Cameron Studio Style Newport 2.5 Headcover",
    },
    bestOffer: {
      title: "Scotty Cameron Studio Style Newport 2.5 Putter",
    },
  };

  const { query } = buildDealCtaHref(deal);

  assert.ok(query.includes("2.5"), `expected query to retain decimal delimiter (saw: ${query})`);
  assert.ok(!/\b2\s+5\b/.test(query), "expected digits around decimal to stay together");
  assert.match(query, /\bputter\b/i, "expected sanitizeCandidate to append putter token");
});

test("buildDealCtaHref keeps headcover token for headcover-only deals", async () => {
  const { buildDealCtaHref } = await modulePromise;

  const deal = {
    modelKey: "Titleist|Scotty Cameron|Special Select|Headcover",
    label: "Scotty Cameron Special Select Headcover",
    query: "Scotty Cameron Special Select Headcover",
    queryVariants: {
      clean: "Scotty Cameron Special Select Headcover",
      accessory: "Scotty Cameron Special Select Headcover",
    },
  };

  const { query } = buildDealCtaHref(deal);

  assert.match(query, HEAD_COVER_REGEX);
  assert.ok(!/\bputter\b/i.test(query), "expected synthetic putter keyword to be removed");
});

test("buildDealCtaHref strips trailing putter token for headcover-only deals", async () => {
  const { buildDealCtaHref } = await modulePromise;

  const deal = {
    modelKey: "Titleist|Scotty Cameron|Studio Style|Headcover",
    label: "Scotty Cameron Studio Style Head Cover - Blue", // no putter token present
    query: "Scotty Cameron Studio Style Head Cover - Blue",
    queryVariants: {
      clean: "Scotty Cameron Studio Style Head Cover - Blue",
      accessory: "Scotty Cameron Studio Style Head Cover - Blue",
    },
    bestOffer: { title: "Scotty Cameron Studio Style Headcover - Blue" },
  };

  const { query } = buildDealCtaHref(deal);

  assert.match(query, HEAD_COVER_REGEX);
  assert.ok(!/\bputter\b/i.test(query), "expected trailing putter token to be stripped");
  assert.ok(/studio style/i.test(query), "expected model tokens to persist");
});

test("buildDealCtaHref retains putter keyword when deal data includes putter", async () => {
  const { buildDealCtaHref } = await modulePromise;

  const deal = {
    modelKey: "SeeMore|Mini Giant|Deep Flange|Tour",
    label: "SeeMore Mini Giant Deep Flange Tour w/ Headcover 34\"",
    query: "SeeMore Mini Giant Deep Flange Tour w/ Headcover 34\"",
    queryVariants: {
      clean: "SeeMore Mini Giant Deep Flange Tour w/ Headcover 34\"",
      accessory: "SeeMore Mini Giant Deep Flange Tour w/ Headcover 34\"",
    },
    bestOffer: {
      title: "SeeMore Mini Giant Deep Flange Tour Putter w/ Headcover 34\"",
    },
  };

  const { query } = buildDealCtaHref(deal);

  assert.match(query, HEAD_COVER_REGEX);
  assert.match(query, /\bputter\b/i, "expected putter keyword to remain for true putter deal");
});

test("buildDealCtaHref drops synthetic putter for HC-only phrasing", async () => {
  const { buildDealCtaHref } = await modulePromise;

  const deal = {
    modelKey: "Titleist|Scotty Cameron|Tour Only|Headcover",
    label: "Scotty Cameron Tour Only HC",
    query: "Scotty Cameron Tour Only HC",
    queryVariants: {
      clean: "Scotty Cameron Tour Only HC",
      accessory: "Scotty Cameron Tour Only HC",
    },
  };

  const { query } = buildDealCtaHref(deal);

  assert.ok(/\bhc\b/i.test(query), "expected HC abbreviation to remain in query");
  assert.ok(!/\bputter\b/i.test(query), "expected synthetic putter keyword to be removed for HC-only phrase");
});

test("buildDealCtaHref drops length and dexterity tokens from headcover queries", async () => {
  const { buildDealCtaHref } = await modulePromise;

  const deal = {
    modelKey: "Titleist|Scotty Cameron|Newport 2|Headcover",
    label: "Scotty Cameron Newport 2 35in RH headcover", 
    query: "Scotty Cameron Newport 2 35in RH headcover",
    queryVariants: {
      clean: "Scotty Cameron Newport 2 35in RH headcover",
      accessory: "Scotty Cameron Newport 2 35in RH headcover",
    },
  };

  const { query } = buildDealCtaHref(deal);

  assert.match(query, HEAD_COVER_REGEX, "expected headcover token to persist");
  assert.ok(!/\b35(?:in|inch|inches)?\b/i.test(query), "expected length tokens to be removed");
  assert.ok(!/\brh\b/i.test(query), "expected dexterity tokens to be removed");
});
