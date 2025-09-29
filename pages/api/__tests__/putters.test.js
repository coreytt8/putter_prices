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

test("AUCTION_WITH_BIN offers survive auction + hasBids filters", async () => {
  const { mapEbayItemToOffer, __testables__ } = await modulePromise;
  assert.ok(__testables__, "__testables__ export should be available");
  const { normalizeBuyingOptions } = __testables__;
  assert.equal(typeof normalizeBuyingOptions, "function", "normalizeBuyingOptions should be a function");

  const item = {
    title: "Test Auction With BIN",
    price: { value: "150", currency: "USD" },
    buyingOptions: ["AUCTION_WITH_BIN"],
    bidCount: "3",
    shippingOptions: [],
    itemSpecifics: [],
    localizedAspects: [],
    additionalProductIdentities: [],
    seller: {},
    returnTerms: {},
    itemLocation: {},
  };

  const offer = mapEbayItemToOffer(item);
  assert.ok(offer, "offer should be produced");
  const offerTypes = normalizeBuyingOptions(offer?.buying?.types);
  assert.ok(offerTypes.includes("AUCTION"), "normalized types should include AUCTION");

  const auctionFilterSet = new Set(normalizeBuyingOptions(["auction"]));
  const afterBuyingFilter = [offer].filter((o) => {
    const types = normalizeBuyingOptions(o?.buying?.types);
    return types.some((t) => auctionFilterSet.has(t));
  });
  assert.equal(afterBuyingFilter.length, 1, "auction filter retains AUCTION_WITH_BIN offer");

  const afterHasBidsFilter = afterBuyingFilter.filter((o) => {
    const types = normalizeBuyingOptions(o?.buying?.types);
    const isAuction = types.includes("AUCTION");
    return isAuction && Number(o?.buying?.bidCount) > 0;
  });
  assert.equal(afterHasBidsFilter.length, 1, "hasBids filter retains AUCTION_WITH_BIN offer");
});

test("bid-only auction price fallback passes onlyComplete + hasBids", async () => {
  const { mapEbayItemToOffer, __testables__ } = await modulePromise;
  const { normalizeBuyingOptions } = __testables__;

  const item = {
    title: "Bid Only Auction",
    currentBidPrice: { value: "42.5", currency: "USD" },
    buyingOptions: ["AUCTION"],
    bidCount: "7",
    image: { imageUrl: "https://example.com/putter.jpg" },
    shippingOptions: [
      {
        shippingCost: { value: "5.50", currency: "USD" },
      },
    ],
    itemSpecifics: [],
    localizedAspects: [],
    additionalProductIdentities: [],
    seller: {},
    returnTerms: {},
    itemLocation: {},
  };

  const offer = mapEbayItemToOffer(item);
  assert.ok(offer, "offer should be produced");
  assert.equal(offer.price, 42.5, "currentBidPrice should populate price");
  assert.equal(offer.currency, "USD", "currency should follow currentBidPrice currency");
  assert.equal(offer.total, 48.0, "shipping should contribute to total");

  const onlyCompleteFiltered = [offer].filter((o) => typeof o.price === "number" && o.image);
  assert.equal(onlyCompleteFiltered.length, 1, "onlyComplete filter should keep bid-only auction");

  const hasBidsFiltered = onlyCompleteFiltered.filter((o) => {
    const types = normalizeBuyingOptions(o?.buying?.types);
    const isAuction = types.includes("AUCTION");
    return isAuction && Number(o?.buying?.bidCount) > 0;
  });
  assert.equal(hasBidsFiltered.length, 1, "hasBids filter should keep bid-only auction");
});

test("fetchEbayBrowse forwards supported sort options", async () => {
  const { fetchEbayBrowse } = await modulePromise;

  const originalFetch = global.fetch;
  const originalClientId = process.env.EBAY_CLIENT_ID;
  const originalClientSecret = process.env.EBAY_CLIENT_SECRET;

  process.env.EBAY_CLIENT_ID = "test-id";
  process.env.EBAY_CLIENT_SECRET = "test-secret";

  const scenarios = [
    { label: "newly listed", input: "newlylisted", expected: "newlyListed" },
    { label: "best price ascending", input: "best_price_asc", expected: "pricePlusShippingLowest" },
    { label: "best price descending", input: "best_price_desc", expected: "pricePlusShippingHighest" },
  ];

  let oauthCalls = 0;
  let browseCalls = 0;
  let currentScenario = null;

  global.fetch = async (url) => {
    const str = typeof url === "string" ? url : url?.toString();
    if (!str) throw new Error("Missing URL in fetch stub");

    if (str.includes("/identity/")) {
      oauthCalls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "fake-token", expires_in: 7200 }),
        text: async () => "",
      };
    }

    if (str.startsWith("https://api.ebay.com/buy/browse/v1/item_summary/search")) {
      browseCalls += 1;
      assert.ok(currentScenario, "Scenario context should be set for browse call");
      const actualSort = new URL(str).searchParams.get("sort");
      assert.equal(
        actualSort,
        currentScenario.expected,
        `${currentScenario.label} → expected sort param`
      );
      return {
        ok: true,
        status: 200,
        json: async () => ({ itemSummaries: [] }),
        text: async () => "",
      };
    }

    throw new Error(`Unexpected fetch URL: ${str}`);
  };

  try {
    for (const scenario of scenarios) {
      currentScenario = scenario;
      await fetchEbayBrowse({ q: "test", sort: scenario.input });
    }
  } finally {
    global.fetch = originalFetch;
    process.env.EBAY_CLIENT_ID = originalClientId;
    process.env.EBAY_CLIENT_SECRET = originalClientSecret;
    currentScenario = null;
  }

  assert.equal(browseCalls, scenarios.length);
  assert.ok(oauthCalls >= 1, "OAuth token should be requested at least once");
});

test("fetchEbayBrowse applies auction + hasBids filters", async () => {
  const { fetchEbayBrowse } = await modulePromise;

  const originalFetch = global.fetch;
  const originalClientId = process.env.EBAY_CLIENT_ID;
  const originalClientSecret = process.env.EBAY_CLIENT_SECRET;

  process.env.EBAY_CLIENT_ID = "test-id";
  process.env.EBAY_CLIENT_SECRET = "test-secret";

  let browseCallUrl = null;

  global.fetch = async (url, opts) => {
    const str = typeof url === "string" ? url : url?.toString();
    if (!str) throw new Error("Missing URL in fetch stub");

    if (str.includes("/identity/")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "fake-token", expires_in: 7200 }),
        text: async () => "",
      };
    }

    if (str.startsWith("https://api.ebay.com/buy/browse/v1/item_summary/search")) {
      browseCallUrl = str;
      return {
        ok: true,
        status: 200,
        json: async () => ({ itemSummaries: [] }),
        text: async () => "",
      };
    }

    throw new Error(`Unexpected fetch URL: ${str}`);
  };

  try {
    await fetchEbayBrowse({
      q: "test",
      buyingOptions: ["AUCTION"],
      hasBids: true,
    });
  } finally {
    global.fetch = originalFetch;
    process.env.EBAY_CLIENT_ID = originalClientId;
    process.env.EBAY_CLIENT_SECRET = originalClientSecret;
  }

  assert.ok(browseCallUrl, "Browse call should have been captured");
  const params = new URL(browseCallUrl).searchParams;
  const filterParam = params.get("filter");
  assert.ok(filterParam, "filter parameter should be present");
  const filters = filterParam.split(",");
  assert.ok(filters.includes("buyingOptions:{AUCTION}"), "buyingOptions filter should be applied");
  assert.ok(filters.includes("bidCount:[1..]"), "bidCount filter should be applied when hasBids=true");
});
