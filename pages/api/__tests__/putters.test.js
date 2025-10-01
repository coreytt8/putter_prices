const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const modulePromise = import(pathToFileURL(path.join(__dirname, "..", "putters.js")).href);

function createMockRes() {
  return {
    statusCode: 200,
    jsonBody: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.jsonBody = body;
      return this;
    },
  };
}

async function collectBrowseQueriesFor(searchQuery) {
  const mod = await modulePromise;
  const handler = mod.default;
  assert.equal(typeof handler, "function", "default export should be a function");
  const { __testables__ } = mod;

  if (__testables__?.resetTokenCache) {
    __testables__.resetTokenCache();
  }

  const originalFetch = global.fetch;
  const originalClientId = process.env.EBAY_CLIENT_ID;
  const originalClientSecret = process.env.EBAY_CLIENT_SECRET;

  process.env.EBAY_CLIENT_ID = "test-id";
  process.env.EBAY_CLIENT_SECRET = "test-secret";

  const browseUrls = [];

  global.fetch = async (input) => {
    const url = typeof input === "string" ? input : input?.toString();
    if (!url) throw new Error("Missing URL in fetch stub");

    if (url.includes("/identity/")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "fake-token", expires_in: 7200 }),
        text: async () => "",
      };
    }

    if (url.startsWith("https://api.ebay.com/buy/browse/v1/item_summary/search")) {
      browseUrls.push(new URL(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({ itemSummaries: [], total: 0 }),
        text: async () => "",
      };
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const req = {
    method: "GET",
    query: {
      q: searchQuery,
      group: "false",
      samplePages: "1",
    },
    headers: { host: "test.local", "user-agent": "node" },
  };
  const res = createMockRes();

  try {
    await handler(req, res);
  } finally {
    global.fetch = originalFetch;
    process.env.EBAY_CLIENT_ID = originalClientId;
    process.env.EBAY_CLIENT_SECRET = originalClientSecret;
    if (__testables__?.resetTokenCache) {
      __testables__.resetTokenCache();
    }
  }

  assert.equal(res.statusCode, 200, "handler should respond with 200");
  return browseUrls;
}

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

test("isLikelyPutter filters accessory-heavy titles but keeps headcovers", async () => {
  const { __testables__ } = await modulePromise;
  const { isLikelyPutter } = __testables__;

  assert.equal(
    isLikelyPutter({ title: "Scotty Cameron Putter Weight Kit" }),
    false,
    "weight kit title should be filtered"
  );

  assert.equal(
    isLikelyPutter({ title: "Scotty Cameron Putter Headcover" }),
    true,
    "headcover title should still pass"
  );
});

test("tokenize + queryMentionsHeadcover handle punctuated head cover text", async () => {
  const { tokenize, __testables__ } = await modulePromise;
  const tokens = tokenize("Deluxe Putter Head-Cover");
  assert.ok(tokens.includes("headcover"), "hyphenated head cover should produce headcover token");

  const hcTokens = tokenize("Circle T HC");
  assert.ok(hcTokens.includes("hc"), "HC abbreviation should be tokenized");
  assert.ok(hcTokens.includes("headcover"), "HC abbreviation should expand to headcover token");

  const { queryMentionsHeadcover } = __testables__;
  assert.ok(
    typeof queryMentionsHeadcover === "function",
    "queryMentionsHeadcover should be exposed via __testables__"
  );
  assert.ok(
    queryMentionsHeadcover("Premium Head/Cover Protector"),
    "queryMentionsHeadcover should treat punctuation like whitespace"
  );
  assert.ok(queryMentionsHeadcover("hc"), "queryMentionsHeadcover should detect HC abbreviation");
});

test("normalizeSearchQ + recall helpers avoid putter for headcover intent", async () => {
  const { __testables__ } = await modulePromise;
  const { normalizeSearchQ, buildLimitedRecallQueries } = __testables__;

  assert.equal(typeof normalizeSearchQ, "function", "normalizeSearchQ should be exposed");
  assert.equal(typeof buildLimitedRecallQueries, "function", "buildLimitedRecallQueries should be exposed");

  const headcoverRaw = "Scotty Cameron Putter Headcover";
  const headcoverNormalized = normalizeSearchQ(headcoverRaw);
  assert.ok(/headcover/i.test(headcoverNormalized), "headcover token should remain");
  assert.ok(!/\bputter\b/i.test(headcoverNormalized), "putter should be stripped for headcover intent");

  const headcoverRecall = buildLimitedRecallQueries(headcoverRaw, headcoverNormalized);
  assert.ok(headcoverRecall.length > 0, "headcover recall variants should be produced");
  for (const variant of headcoverRecall) {
    assert.ok(!/\bputter\b/i.test(variant), `headcover recall variant should not include putter: ${variant}`);
  }

  const putterRaw = "Bettinardi BB8";
  const putterNormalized = normalizeSearchQ(putterRaw);
  assert.ok(/\bputter\b/i.test(putterNormalized), "regular putter search should include putter");

  const putterRecall = buildLimitedRecallQueries(putterRaw, putterNormalized);
  assert.ok(putterRecall.some((variant) => /\bputter\b/i.test(variant)), "putter recall variants should retain putter");
});

test("handler eBay calls omit putter for headcover queries", async () => {
  const browseUrls = await collectBrowseQueriesFor("Scotty Cameron headcover");
  assert.ok(browseUrls.length > 0, "headcover query should trigger eBay browse calls");
  for (const url of browseUrls) {
    const qParam = url.searchParams.get("q") || "";
    assert.ok(!/\bputter\b/i.test(qParam), `headcover query should not include putter (saw: ${qParam})`);
  }
});

test("API handler keeps HC-abbreviation headcover listings", async () => {
  const mod = await modulePromise;
  const handler = mod.default;
  assert.equal(typeof handler, "function", "default export should be a function");

  const originalFetch = global.fetch;
  const originalClientId = process.env.EBAY_CLIENT_ID;
  const originalClientSecret = process.env.EBAY_CLIENT_SECRET;

  process.env.EBAY_CLIENT_ID = "test-id";
  process.env.EBAY_CLIENT_SECRET = "test-secret";

  mod.__testables__?.resetTokenCache?.();

  const browseItems = [
    {
      itemId: "hc1",
      title: "Scotty Cameron Tour Only HC",
      price: { value: "125", currency: "USD" },
      itemWebUrl: "https://example.com/hc1",
      seller: { username: "seller1" },
      image: { imageUrl: "https://example.com/hc1.jpg" },
      shippingOptions: [],
      buyingOptions: ["FIXED_PRICE"],
      itemSpecifics: [],
      localizedAspects: [],
      additionalProductIdentities: [],
      returnTerms: {},
      itemLocation: {},
    },
  ];

  let browseCalls = 0;

  global.fetch = async (input) => {
    const url = typeof input === "string" ? input : input?.toString();
    if (!url) throw new Error("Missing URL in fetch stub");

    if (url.includes("/identity/")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "fake-token", expires_in: 7200 }),
        text: async () => "",
      };
    }

    if (url.startsWith("https://api.ebay.com/buy/browse/v1/item_summary/search")) {
      browseCalls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ itemSummaries: browseItems, total: browseItems.length }),
        text: async () => "",
      };
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const req = {
    method: "GET",
    query: { q: "Scotty Cameron HC", group: "false", samplePages: "1" },
    headers: { host: "test.local", "user-agent": "node" },
  };
  const res = createMockRes();

  try {
    await handler(req, res);
  } finally {
    global.fetch = originalFetch;
    process.env.EBAY_CLIENT_ID = originalClientId;
    process.env.EBAY_CLIENT_SECRET = originalClientSecret;
    mod.__testables__?.resetTokenCache?.();
  }

  assert.ok(browseCalls > 0, "eBay browse should be called");
  assert.equal(res.statusCode, 200, "handler should respond with 200");
  assert.ok(Array.isArray(res.jsonBody?.offers), "offers array should be returned");
  assert.equal(res.jsonBody.offers.length, 1, "HC listing should be retained");
  assert.equal(res.jsonBody.offers[0]?.title, browseItems[0].title, "title should match source listing");
});

test("handler eBay calls retain putter for standard putter searches", async () => {
  const browseUrls = await collectBrowseQueriesFor("Scotty Cameron Newport 2");
  assert.ok(browseUrls.length > 0, "standard query should trigger eBay browse calls");
  assert.ok(
    browseUrls.some((url) => /\bputter\b/i.test(url.searchParams.get("q") || "")),
    "standard query should include putter term"
  );
});

test("handler passes decimal search terms through to eBay", async () => {
  const search = "Scotty Cameron Studio Style Newport 2.5";
  const browseUrls = await collectBrowseQueriesFor(search);
  assert.ok(browseUrls.length > 0, "decimal query should trigger eBay browse calls");
  for (const url of browseUrls) {
    const qParam = url.searchParams.get("q") || "";
    assert.ok(qParam.includes("2.5"), `expected decimal to persist in browse URL (saw: ${qParam})`);
  }
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

test("API handler sorts offers by total when shipping differs", async () => {
  const mod = await modulePromise;
  const handler = mod.default;
  assert.equal(typeof handler, "function", "default export should be a function");

  const originalFetch = global.fetch;
  const originalClientId = process.env.EBAY_CLIENT_ID;
  const originalClientSecret = process.env.EBAY_CLIENT_SECRET;

  process.env.EBAY_CLIENT_ID = "test-id";
  process.env.EBAY_CLIENT_SECRET = "test-secret";

  const browseItems = [
    {
      itemId: "1",
      title: "Test Free Ship Putter",
      price: { value: "100", currency: "USD" },
      itemWebUrl: "https://example.com/free",
      seller: { username: "seller1" },
      image: { imageUrl: "https://example.com/free.jpg" },
      shippingOptions: [
        { shippingCost: { value: "0", currency: "USD" } },
      ],
      buyingOptions: ["FIXED_PRICE"],
      itemSpecifics: [],
      localizedAspects: [],
      additionalProductIdentities: [],
      returnTerms: {},
      itemLocation: {},
    },
    {
      itemId: "2",
      title: "Test Paid Ship Putter",
      price: { value: "90", currency: "USD" },
      itemWebUrl: "https://example.com/paid",
      seller: { username: "seller2" },
      image: { imageUrl: "https://example.com/paid.jpg" },
      shippingOptions: [
        { shippingCost: { value: "25", currency: "USD" } },
      ],
      buyingOptions: ["FIXED_PRICE"],
      itemSpecifics: [],
      localizedAspects: [],
      additionalProductIdentities: [],
      returnTerms: {},
      itemLocation: {},
    },
  ];

  global.fetch = async (input) => {
    const url = typeof input === "string" ? input : input?.toString();
    if (!url) throw new Error("Missing URL in fetch stub");

    if (url.includes("/identity/")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "fake-token", expires_in: 7200 }),
        text: async () => "",
      };
    }

    if (url.startsWith("https://api.ebay.com/buy/browse/v1/item_summary/search")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ itemSummaries: browseItems, total: browseItems.length }),
        text: async () => "",
      };
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const req = {
    method: "GET",
    query: {
      q: "Test Putter",
      group: "false",
      samplePages: "1",
      sort: "best_price_asc",
      forceCategory: "false",
    },
    headers: { host: "test.local", "user-agent": "node" },
  };
  const res = createMockRes();

  try {
    await handler(req, res);
  } finally {
    global.fetch = originalFetch;
    process.env.EBAY_CLIENT_ID = originalClientId;
    process.env.EBAY_CLIENT_SECRET = originalClientSecret;
  }

  assert.equal(res.statusCode, 200, "handler should respond with 200");
  assert.ok(res.jsonBody, "response body should be captured");
  assert.ok(Array.isArray(res.jsonBody.offers), "offers array should be present");
  assert.equal(res.jsonBody.offers.length, browseItems.length, "all offers should be returned");

  const [first, second] = res.jsonBody.offers;
  assert.ok(first.total < second.total, "lowest total should surface first");
  assert.ok(first.price > second.price, "higher item price with free shipping should beat cheaper item with costly shipping");
  assert.equal(first.title, "Test Free Ship Putter");
  assert.equal(second.title, "Test Paid Ship Putter");
});

test("API handler keeps offers when titles omit filler descriptors", async () => {
  const mod = await modulePromise;
  const handler = mod.default;
  assert.equal(typeof handler, "function", "default export should be a function");

  const originalFetch = global.fetch;
  const originalClientId = process.env.EBAY_CLIENT_ID;
  const originalClientSecret = process.env.EBAY_CLIENT_SECRET;

  process.env.EBAY_CLIENT_ID = "test-id";
  process.env.EBAY_CLIENT_SECRET = "test-secret";

  const browseItems = [
    {
      itemId: "1",
      title: "Scotty Cameron Newport 2 Putter Headcover Included",
      price: { value: "450", currency: "USD" },
      itemWebUrl: "https://example.com/headcover",
      seller: { username: "seller1" },
      image: { imageUrl: "https://example.com/headcover.jpg" },
      shippingOptions: [
        { shippingCost: { value: "0", currency: "USD" } },
      ],
      buyingOptions: ["FIXED_PRICE"],
      itemSpecifics: [],
      localizedAspects: [],
      additionalProductIdentities: [],
      returnTerms: {},
      itemLocation: {},
    },
    {
      itemId: "2",
      title: "Scotty Cameron Newport 2 Putter",
      price: { value: "425", currency: "USD" },
      itemWebUrl: "https://example.com/plain",
      seller: { username: "seller2" },
      image: { imageUrl: "https://example.com/plain.jpg" },
      shippingOptions: [
        { shippingCost: { value: "15", currency: "USD" } },
      ],
      buyingOptions: ["FIXED_PRICE"],
      itemSpecifics: [],
      localizedAspects: [],
      additionalProductIdentities: [],
      returnTerms: {},
      itemLocation: {},
    },
  ];

  global.fetch = async (input) => {
    const url = typeof input === "string" ? input : input?.toString();
    if (!url) throw new Error("Missing URL in fetch stub");

    if (url.includes("/identity/")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "fake-token", expires_in: 7200 }),
        text: async () => "",
      };
    }

    if (url.startsWith("https://api.ebay.com/buy/browse/v1/item_summary/search")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ itemSummaries: browseItems, total: browseItems.length }),
        text: async () => "",
      };
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const req = {
    method: "GET",
    query: {
      q: "Scotty Cameron Newport 2 headcover with small batch putter",
      group: "false",
      forceCategory: "false",
    },
    headers: { host: "test.local", "user-agent": "node" },
  };
  const res = createMockRes();

  try {
    await handler(req, res);
  } finally {
    global.fetch = originalFetch;
    process.env.EBAY_CLIENT_ID = originalClientId;
    process.env.EBAY_CLIENT_SECRET = originalClientSecret;
  }

  assert.equal(res.statusCode, 200, "handler should respond with 200");
  assert.ok(res.jsonBody, "response body should be captured");
  assert.ok(Array.isArray(res.jsonBody.offers), "offers array should be present");
  assert.equal(res.jsonBody.offers.length, 1, "only headcover-matching offer should remain");
  assert.equal(
    res.jsonBody.offers[0]?.title,
    "Scotty Cameron Newport 2 Putter Headcover Included",
    "headcover listing should survive query token filter"
  );
});

test("headcover queries ignore length/dex tokens during filtering", async () => {
  const mod = await modulePromise;
  const handler = mod.default;
  assert.equal(typeof handler, "function", "default export should be a function");

  const originalFetch = global.fetch;
  const originalClientId = process.env.EBAY_CLIENT_ID;
  const originalClientSecret = process.env.EBAY_CLIENT_SECRET;

  process.env.EBAY_CLIENT_ID = "test-id";
  process.env.EBAY_CLIENT_SECRET = "test-secret";

  const browseItems = [
    {
      itemId: "hc-token-filter",
      title: "Scotty Cameron Newport 2 Headcover",
      price: { value: "150", currency: "USD" },
      itemWebUrl: "https://example.com/headcover",
      seller: { username: "cover-seller" },
      image: { imageUrl: "https://example.com/headcover.jpg" },
      shippingOptions: [
        { shippingCost: { value: "0", currency: "USD" } },
      ],
      buyingOptions: ["FIXED_PRICE"],
      itemSpecifics: [],
      localizedAspects: [],
      additionalProductIdentities: [],
      returnTerms: {},
      itemLocation: {},
    },
  ];

  global.fetch = async (input) => {
    const url = typeof input === "string" ? input : input?.toString();
    if (!url) throw new Error("Missing URL in fetch stub");

    if (url.includes("/identity/")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "fake-token", expires_in: 7200 }),
        text: async () => "",
      };
    }

    if (url.startsWith("https://api.ebay.com/buy/browse/v1/item_summary/search")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ itemSummaries: browseItems, total: browseItems.length }),
        text: async () => "",
      };
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const req = {
    method: "GET",
    query: {
      q: "Scotty Cameron Newport 2 35in RH headcover",
      group: "false",
      forceCategory: "false",
    },
    headers: { host: "test.local", "user-agent": "node" },
  };
  const res = createMockRes();

  try {
    await handler(req, res);
  } finally {
    global.fetch = originalFetch;
    process.env.EBAY_CLIENT_ID = originalClientId;
    process.env.EBAY_CLIENT_SECRET = originalClientSecret;
  }

  assert.equal(res.statusCode, 200, "handler should respond with 200");
  assert.ok(res.jsonBody, "response body should be captured");
  assert.ok(Array.isArray(res.jsonBody.offers), "offers array should be present");
  assert.equal(res.jsonBody.offers.length, 1, "headcover listing should remain despite missing spec tokens");
  assert.equal(
    res.jsonBody.offers[0]?.title,
    "Scotty Cameron Newport 2 Headcover",
    "headcover-only listing should survive when query includes length/dex tokens"
  );
});

test("headcover-only listings survive strict putter filter when requested", async () => {
  const mod = await modulePromise;
  const handler = mod.default;
  assert.equal(typeof handler, "function", "default export should be a function");

  const originalFetch = global.fetch;
  const originalClientId = process.env.EBAY_CLIENT_ID;
  const originalClientSecret = process.env.EBAY_CLIENT_SECRET;

  process.env.EBAY_CLIENT_ID = "test-id";
  process.env.EBAY_CLIENT_SECRET = "test-secret";

  const browseItems = [
    {
      itemId: "headcover-only",
      title: "Scotty Cameron Studio Style Headcover",
      price: { value: "120", currency: "USD" },
      itemWebUrl: "https://example.com/headcover-only",
      seller: { username: "studio-style" },
      image: { imageUrl: "https://example.com/headcover-only.jpg" },
      shippingOptions: [
        { shippingCost: { value: "0", currency: "USD" } },
      ],
      buyingOptions: ["FIXED_PRICE"],
      itemSpecifics: [],
      localizedAspects: [],
      additionalProductIdentities: [],
      returnTerms: {},
      itemLocation: {},
    },
    {
      itemId: "shaft-accessory",
      title: "Scotty Cameron Putter Shaft Replacement",
      price: { value: "80", currency: "USD" },
      itemWebUrl: "https://example.com/shaft-accessory",
      seller: { username: "shaft-seller" },
      image: { imageUrl: "https://example.com/shaft-accessory.jpg" },
      shippingOptions: [
        { shippingCost: { value: "8", currency: "USD" } },
      ],
      buyingOptions: ["FIXED_PRICE"],
      itemSpecifics: [],
      localizedAspects: [],
      additionalProductIdentities: [],
      returnTerms: {},
      itemLocation: {},
    },
  ];

  global.fetch = async (input) => {
    const url = typeof input === "string" ? input : input?.toString();
    if (!url) throw new Error("Missing URL in fetch stub");

    if (url.includes("/identity/")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "fake-token", expires_in: 7200 }),
        text: async () => "",
      };
    }

    if (url.startsWith("https://api.ebay.com/buy/browse/v1/item_summary/search")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ itemSummaries: browseItems, total: browseItems.length }),
        text: async () => "",
      };
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const req = {
    method: "GET",
    query: {
      q: "Scotty Cameron studio style headcover",
      group: "false",
      forceCategory: "false",
    },
    headers: { host: "test.local", "user-agent": "node" },
  };
  const res = createMockRes();

  try {
    await handler(req, res);
  } finally {
    global.fetch = originalFetch;
    process.env.EBAY_CLIENT_ID = originalClientId;
    process.env.EBAY_CLIENT_SECRET = originalClientSecret;
  }

  assert.equal(res.statusCode, 200, "handler should respond with 200");
  assert.ok(res.jsonBody, "response body should be captured");
  assert.ok(Array.isArray(res.jsonBody.offers), "offers array should be present");
  assert.equal(res.jsonBody.offers.length, 1, "headcover-only listing should survive filtering");
  assert.equal(
    res.jsonBody.offers[0]?.title,
    "Scotty Cameron Studio Style Headcover",
    "headcover listing without 'putter' should be retained when query mentions headcovers"
  );
});

test("head cover query matches combined headcover token", async () => {
  const mod = await modulePromise;
  const handler = mod.default;
  assert.equal(typeof handler, "function", "default export should be a function");

  const originalFetch = global.fetch;
  const originalClientId = process.env.EBAY_CLIENT_ID;
  const originalClientSecret = process.env.EBAY_CLIENT_SECRET;

  process.env.EBAY_CLIENT_ID = "test-id";
  process.env.EBAY_CLIENT_SECRET = "test-secret";

  const browseItems = [
    {
      itemId: "ks1-headcover",
      title: "Kirkland KS-1 Putter Head-Cover",
      price: { value: "45", currency: "USD" },
      itemWebUrl: "https://example.com/ks1-headcover",
      seller: { username: "kirkland-seller" },
      image: { imageUrl: "https://example.com/ks1-headcover.jpg" },
      shippingOptions: [
        { shippingCost: { value: "0", currency: "USD" } },
      ],
      buyingOptions: ["FIXED_PRICE"],
      itemSpecifics: [],
      localizedAspects: [],
      additionalProductIdentities: [],
      returnTerms: {},
      itemLocation: {},
    },
  ];

  global.fetch = async (input) => {
    const url = typeof input === "string" ? input : input?.toString();
    if (!url) throw new Error("Missing URL in fetch stub");

    if (url.includes("/identity/")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "fake-token", expires_in: 7200 }),
        text: async () => "",
      };
    }

    if (url.startsWith("https://api.ebay.com/buy/browse/v1/item_summary/search")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ itemSummaries: browseItems, total: browseItems.length }),
        text: async () => "",
      };
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const req = {
    method: "GET",
    query: {
      q: "kirkland signature ks1 head cover putter",
      group: "false",
      forceCategory: "false",
    },
    headers: { host: "test.local", "user-agent": "node" },
  };
  const res = createMockRes();

  try {
    await handler(req, res);
  } finally {
    global.fetch = originalFetch;
    process.env.EBAY_CLIENT_ID = originalClientId;
    process.env.EBAY_CLIENT_SECRET = originalClientSecret;
  }

  assert.equal(res.statusCode, 200, "handler should respond with 200");
  assert.ok(res.jsonBody, "response body should be captured");
  assert.ok(Array.isArray(res.jsonBody.offers), "offers array should be present");
  assert.equal(res.jsonBody.offers.length, 1, "headcover listing should survive token filtering");
  assert.equal(
    res.jsonBody.offers[0]?.title,
    "Kirkland KS-1 Putter Head-Cover",
    "head cover query should match combined headcover token"
  );
});

test("headcover query tolerates missing non-essential tokens", async () => {
  const mod = await modulePromise;
  const handler = mod.default;
  assert.equal(typeof handler, "function", "default export should be a function");

  const originalFetch = global.fetch;
  const originalClientId = process.env.EBAY_CLIENT_ID;
  const originalClientSecret = process.env.EBAY_CLIENT_SECRET;

  process.env.EBAY_CLIENT_ID = "test-id";
  process.env.EBAY_CLIENT_SECRET = "test-secret";

  const browseItems = [
    {
      itemId: "catalina-headcover",
      title: "Scotty Cameron Catalina Headcover",
      price: { value: "150", currency: "USD" },
      itemWebUrl: "https://example.com/catalina-headcover",
      seller: { username: "catalina-seller" },
      image: { imageUrl: "https://example.com/catalina-headcover.jpg" },
      shippingOptions: [
        { shippingCost: { value: "0", currency: "USD" } },
      ],
      buyingOptions: ["FIXED_PRICE"],
      itemSpecifics: [],
      localizedAspects: [],
      additionalProductIdentities: [],
      returnTerms: {},
      itemLocation: {},
    },
    {
      itemId: "generic-headcover",
      title: "Blade Putter Headcover",
      price: { value: "60", currency: "USD" },
      itemWebUrl: "https://example.com/generic-headcover",
      seller: { username: "generic-seller" },
      image: { imageUrl: "https://example.com/generic-headcover.jpg" },
      shippingOptions: [
        { shippingCost: { value: "5", currency: "USD" } },
      ],
      buyingOptions: ["FIXED_PRICE"],
      itemSpecifics: [],
      localizedAspects: [],
      additionalProductIdentities: [],
      returnTerms: {},
      itemLocation: {},
    },
  ];

  global.fetch = async (input) => {
    const url = typeof input === "string" ? input : input?.toString();
    if (!url) throw new Error("Missing URL in fetch stub");

    if (url.includes("/identity/")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "fake-token", expires_in: 7200 }),
        text: async () => "",
      };
    }

    if (url.startsWith("https://api.ebay.com/buy/browse/v1/item_summary/search")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ itemSummaries: browseItems, total: browseItems.length }),
        text: async () => "",
      };
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const req = {
    method: "GET",
    query: {
      q: "Scotty Cameron Classics Catalina 35in putter head cover",
      group: "false",
      forceCategory: "false",
    },
    headers: { host: "test.local", "user-agent": "node" },
  };
  const res = createMockRes();

  try {
    await handler(req, res);
  } finally {
    global.fetch = originalFetch;
    process.env.EBAY_CLIENT_ID = originalClientId;
    process.env.EBAY_CLIENT_SECRET = originalClientSecret;
  }

  assert.equal(res.statusCode, 200, "handler should respond with 200");
  assert.ok(res.jsonBody, "response body should be captured");
  assert.ok(Array.isArray(res.jsonBody.offers), "offers array should be present");
  assert.equal(
    res.jsonBody.offers.length,
    1,
    "only listings sharing relevant non-headcover tokens should remain"
  );
  assert.equal(
    res.jsonBody.offers[0]?.title,
    "Scotty Cameron Catalina Headcover",
    "headcover listing missing some query tokens should survive filtering"
  );
});

test("headcover query requires headcover token but allows partial non-headcover matches", async () => {
  const mod = await modulePromise;
  const handler = mod.default;
  assert.equal(typeof handler, "function", "default export should be a function");

  const originalFetch = global.fetch;
  const originalClientId = process.env.EBAY_CLIENT_ID;
  const originalClientSecret = process.env.EBAY_CLIENT_SECRET;

  process.env.EBAY_CLIENT_ID = "test-id";
  process.env.EBAY_CLIENT_SECRET = "test-secret";

  const browseItems = [
    {
      itemId: "phantom-headcover",
      title: "Scotty Cameron Phantom X Headcover",
      price: { value: "180", currency: "USD" },
      itemWebUrl: "https://example.com/phantom-headcover",
      seller: { username: "phantom-seller" },
      image: { imageUrl: "https://example.com/phantom-headcover.jpg" },
      shippingOptions: [
        { shippingCost: { value: "0", currency: "USD" } },
      ],
      buyingOptions: ["FIXED_PRICE"],
      itemSpecifics: [],
      localizedAspects: [],
      additionalProductIdentities: [],
      returnTerms: {},
      itemLocation: {},
    },
    {
      itemId: "phantom-putter",
      title: "Scotty Cameron Phantom X 5.5 Putter",
      price: { value: "450", currency: "USD" },
      itemWebUrl: "https://example.com/phantom-putter",
      seller: { username: "putter-seller" },
      image: { imageUrl: "https://example.com/phantom-putter.jpg" },
      shippingOptions: [
        { shippingCost: { value: "20", currency: "USD" } },
      ],
      buyingOptions: ["FIXED_PRICE"],
      itemSpecifics: [],
      localizedAspects: [],
      additionalProductIdentities: [],
      returnTerms: {},
      itemLocation: {},
    },
  ];

  global.fetch = async (input) => {
    const url = typeof input === "string" ? input : input?.toString();
    if (!url) throw new Error("Missing URL in fetch stub");

    if (url.includes("/identity/")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "fake-token", expires_in: 7200 }),
        text: async () => "",
      };
    }

    if (url.startsWith("https://api.ebay.com/buy/browse/v1/item_summary/search")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ itemSummaries: browseItems, total: browseItems.length }),
        text: async () => "",
      };
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const req = {
    method: "GET",
    query: {
      q: "Scotty Cameron Phantom X 5.5 Circle T headcover",
      group: "false",
      forceCategory: "false",
    },
    headers: { host: "test.local", "user-agent": "node" },
  };
  const res = createMockRes();

  try {
    await handler(req, res);
  } finally {
    global.fetch = originalFetch;
    process.env.EBAY_CLIENT_ID = originalClientId;
    process.env.EBAY_CLIENT_SECRET = originalClientSecret;
  }

  assert.equal(res.statusCode, 200, "handler should respond with 200");
  assert.ok(res.jsonBody, "response body should be captured");
  assert.ok(Array.isArray(res.jsonBody.offers), "offers array should be present");
  assert.equal(res.jsonBody.offers.length, 1, "only headcover listing should remain");
  assert.equal(
    res.jsonBody.offers[0]?.title,
    "Scotty Cameron Phantom X Headcover",
    "headcover listing should remain even when some non-headcover tokens are missing"
  );
});

test("headcover queries broaden categories but still block other accessories", async () => {
  const mod = await modulePromise;
  const handler = mod.default;
  assert.equal(typeof handler, "function", "default export should be a function");

  const originalFetch = global.fetch;
  const originalClientId = process.env.EBAY_CLIENT_ID;
  const originalClientSecret = process.env.EBAY_CLIENT_SECRET;

  process.env.EBAY_CLIENT_ID = "test-id";
  process.env.EBAY_CLIENT_SECRET = "test-secret";

  const browseItems = [
    {
      itemId: "hc-1",
      title: "Scotty Cameron Putter Headcover - My Girl",
      price: { value: "199", currency: "USD" },
      itemWebUrl: "https://example.com/headcover",
      seller: { username: "seller1" },
      image: { imageUrl: "https://example.com/headcover.jpg" },
      shippingOptions: [
        { shippingCost: { value: "0", currency: "USD" } },
      ],
      buyingOptions: ["FIXED_PRICE"],
      itemSpecifics: [],
      localizedAspects: [],
      additionalProductIdentities: [],
      returnTerms: {},
      itemLocation: {},
    },
    {
      itemId: "hc-weights",
      title: "Scotty Cameron Putter Headcover with 15g Weights",
      price: { value: "225", currency: "USD" },
      itemWebUrl: "https://example.com/headcover-weights",
      seller: { username: "seller2" },
      image: { imageUrl: "https://example.com/headcover-weights.jpg" },
      shippingOptions: [
        { shippingCost: { value: "12", currency: "USD" } },
      ],
      buyingOptions: ["FIXED_PRICE"],
      itemSpecifics: [],
      localizedAspects: [],
      additionalProductIdentities: [],
      returnTerms: {},
      itemLocation: {},
    },
    {
      itemId: "shaft-1",
      title: "Scotty Cameron Putter Shaft Replacement",
      price: { value: "80", currency: "USD" },
      itemWebUrl: "https://example.com/shaft",
      seller: { username: "seller3" },
      image: { imageUrl: "https://example.com/shaft.jpg" },
      shippingOptions: [
        { shippingCost: { value: "8", currency: "USD" } },
      ],
      buyingOptions: ["FIXED_PRICE"],
      itemSpecifics: [],
      localizedAspects: [],
      additionalProductIdentities: [],
      returnTerms: {},
      itemLocation: {},
    },
  ];

  const browseCallParams = [];

  global.fetch = async (input) => {
    const url = typeof input === "string" ? input : input?.toString();
    if (!url) throw new Error("Missing URL in fetch stub");

    if (url.includes("/identity/")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "fake-token", expires_in: 7200 }),
        text: async () => "",
      };
    }

    if (url.startsWith("https://api.ebay.com/buy/browse/v1/item_summary/search")) {
      browseCallParams.push(new URL(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({ itemSummaries: browseItems, total: browseItems.length }),
        text: async () => "",
      };
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const req = {
    method: "GET",
    query: {
      q: "Scotty Cameron headcover",
      group: "false",
      samplePages: "1",
    },
    headers: { host: "test.local", "user-agent": "node" },
  };
  const res = createMockRes();

  try {
    await handler(req, res);
  } finally {
    global.fetch = originalFetch;
    process.env.EBAY_CLIENT_ID = originalClientId;
    process.env.EBAY_CLIENT_SECRET = originalClientSecret;
  }

  assert.equal(res.statusCode, 200, "handler should respond with 200");
  assert.ok(res.jsonBody, "response body should be captured");
  assert.ok(Array.isArray(res.jsonBody.offers), "offers array should be present");
  assert.equal(res.jsonBody.offers.length, 1, "only pure headcover listing should remain");
  assert.equal(
    res.jsonBody.offers[0]?.title,
    "Scotty Cameron Putter Headcover - My Girl",
    "headcover-only listing should remain after accessory guard"
  );

  assert.ok(browseCallParams.length > 0, "eBay Browse should be called at least once");
  for (const callUrl of browseCallParams) {
    const categoryIds = callUrl.searchParams.get("category_ids");
    assert.ok(categoryIds, "category ids should be requested when forcing category");
    assert.ok(categoryIds.includes("115280"), "golf club category should be enforced");
    assert.ok(categoryIds.includes("36278"), "headcover category should be added for headcover queries");
  }
});
