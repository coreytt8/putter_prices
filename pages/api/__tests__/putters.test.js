const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const modulePromise = import(pathToFileURL(path.join(__dirname, "..", "putters.js")).href);

test("mapEbayItemToOffer normalizes bid count variants", async () => {
  const { mapEbayItemToOffer } = await modulePromise;

  const baseItem = {
    title: "Test Putter",
    price: { value: "199.99", currency: "USD" },
    buyingOptions: ["AUCTION"],
    shippingOptions: [],
    itemSpecifics: [],
    localizedAspects: [],
    additionalProductIdentities: [],
    seller: {},
    returnTerms: {},
    itemLocation: {},
  };

  const fixtures = [
    {
      desc: "sellingStatus array with string bidCount",
      item: {
        ...baseItem,
        sellingStatus: [{ bidCount: ["4"] }],
      },
    },
    {
      desc: "sellingStatus object with __value__ wrapper",
      item: {
        ...baseItem,
        sellingStatus: { bidCount: { __value__: "4" } },
      },
    },
  ];

  for (const { desc, item } of fixtures) {
    const offer = mapEbayItemToOffer(item);
    assert.equal(offer?.buying?.bidCount, 4, `${desc} → bidCount`);
    const filtered = [offer].filter((o) => Number(o?.buying?.bidCount) > 0);
    assert.equal(filtered.length, 1, `${desc} → hasBids filter retains offer`);
  }
});
