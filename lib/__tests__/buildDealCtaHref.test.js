const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const modulePath = path.join(__dirname, "..", "sanitizeModelKey.js");
const moduleHref = pathToFileURL(modulePath).href;
const modulePromise = import(moduleHref);

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
  assert.ok(/headcover/i.test(query), "expected headcover tokens to be preserved");
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

  assert.match(query, /\bheadcovers?\b/i);
  assert.match(query, /\bputter\b/i);
});
