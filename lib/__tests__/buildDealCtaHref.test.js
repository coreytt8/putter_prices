const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const modulePath = path.join(__dirname, "..", "sanitizeModelKey.js");
const moduleHref = pathToFileURL(modulePath).href;
const modulePromise = import(moduleHref);

const HEAD_COVER_REGEX = /\bhead(?:\s|-)?covers?\b/i;

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
