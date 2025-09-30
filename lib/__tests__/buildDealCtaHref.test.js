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
  assert.ok(!/headcover/i.test(query), "expected accessory tokens to be removed");
  assert.ok(!/🟢/.test(query), "expected emoji to be removed");
  assert.ok(!/🎯/.test(query), "expected emoji from accessory variant to be removed");

  const url = new URL(href, "https://example.com");
  assert.equal(url.pathname, "/putters");
  assert.equal(url.searchParams.get("modelKey"), deal.modelKey);
  assert.equal(url.searchParams.get("q"), query);
});
