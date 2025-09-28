const test = require("node:test");
const assert = require("node:assert/strict");

const { mapEbayItemToOffer } = require("../putters.js");

test("legacy bidCount is honored by hasBids filter", () => {
  const legacyOnlyItem = {
    title: "Sample Putter",
    price: { value: "199.99", currency: "USD" },
    bidCount: "4",
    buyingOptions: ["AUCTION"],
    sellingStatus: {},
  };

  const offer = mapEbayItemToOffer(legacyOnlyItem);

  assert.strictEqual(offer.buying.bidCount, 4);

  const filtered = [offer].filter((o) => Number(o?.buying?.bidCount) > 0);
  assert.strictEqual(filtered.length, 1);
});
