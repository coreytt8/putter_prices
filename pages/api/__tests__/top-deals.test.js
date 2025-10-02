const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const modulePath = path.join(__dirname, "..", "top-deals.js");
const moduleHref = pathToFileURL(modulePath).href;

// Regular import once (used by the first/second tests)
const modulePromise = import(/* webpackIgnore: true */ moduleHref);

// Fresh importer for reloading the module (third test)
// Appends a cache-busting query and asks bundlers to skip static analysis.
async function importFreshFromHref(href) {
  const freshHref = href + (href.includes("?") ? "&" : "?") + "t=" + Date.now();
  return import(/* webpackIgnore: true */ freshHref);
}

test("loadRankedDeals returns listings observed before midnight when window is rolling", async () => {
  const { loadRankedDeals } = await modulePromise;

  const originalNow = Date.now;
  Date.now = () => new Date("2024-01-02T02:00:00Z").getTime();

  try {
    const observedAt = "2024-01-01T21:30:00.000Z";
    const mockRow = {
      model_key: "acme_racer",
      brand: "Acme",
      title: "Acme Racer",
      image_url: "https://example.com/putter.jpg",
      url: "https://example.com/listing",
      currency: "USD",
      head_type: "Blade",
      dexterity: "Right",
      length_in: 34,
      item_id: "123",
      price: 80,
      shipping: 10,
      total: 90,
      observed_at: observedAt,
      condition: "USED",
      n: 8,
      window_days: 30,
      p10_cents: 10000,
      p50_cents: 15000,
      p90_cents: 20000,
      dispersion_ratio: 0.4,
      updated_at: "2024-01-01T18:00:00Z",
      listing_count: 3,
    };

    const calls = [];
    const mockSql = async (strings, ...values) => {
      calls.push(values);
      if (values.length === 0) {
        return [];
      }
      return [mockRow];
    };

    const { deals, windowHours } = await loadRankedDeals(mockSql, 6, [24]);

    assert.equal(windowHours, 24);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].length, 1, "expected rolling window parameter in query");
    assert.ok(calls[0][0] instanceof Date);
    assert.equal(deals.length, 1);
    const [deal] = deals;
    assert.equal(deal.bestOffer.observedAt, observedAt);
    assert.equal(deal.label, "Acme");
    assert.equal(deal.savings.amount, 60);
    assert.equal(Math.round(deal.savings.percent * 100) / 100, 0.4);
  } finally {
    Date.now = originalNow;
  }
});

test("loadRankedDeals surfaces refreshed totals for long-running listings", async () => {
  const { loadRankedDeals } = await modulePromise;

  const refreshedRow = {
    model_key: "acme_racer",
    brand: "Acme",
    title: "Acme Racer",
    image_url: "https://example.com/putter.jpg",
    url: "https://example.com/listing",
    currency: "USD",
    head_type: "Blade",
    dexterity: "Right",
    length_in: 34,
    item_id: "123",
    price: 120,
    shipping: 5,
    total: 125,
    observed_at: "2024-01-08T18:00:00.000Z",
    condition: "USED",
    n: 12,
    window_days: 30,
    p10_cents: 16000,
    p50_cents: 20000,
    p90_cents: 24000,
    dispersion_ratio: 0.35,
    updated_at: "2024-01-08T17:00:00Z",
    listing_count: 4,
  };

  const mockSql = async () => [refreshedRow];

  const { deals } = await loadRankedDeals(mockSql, 6, [24]);

  assert.equal(deals.length, 1);
  const [deal] = deals;
  assert.equal(deal.bestOffer.total, refreshedRow.total);
  assert.equal(deal.bestOffer.price, refreshedRow.price);
  assert.equal(deal.bestOffer.shipping, refreshedRow.shipping);
  assert.equal(
    Math.round(deal.savings.amount),
    Math.round((refreshedRow.p50_cents / 100) - refreshedRow.total)
  );
});

test("buildDealsFromRows decorates URLs with affiliate params when configured", async () => {
  const originalEnv = {
    campid: process.env.EPN_CAMPID,
    customid: process.env.EPN_CUSTOMID,
    toolid: process.env.EPN_TOOLID,
    mkcid: process.env.EPN_MKCID,
    mkrid: process.env.EPN_MKRID,
    siteid: process.env.EPN_SITEID,
    mkevt: process.env.EPN_MKEVT,
  };

  process.env.EPN_CAMPID = "987654";
  process.env.EPN_CUSTOMID = "putteriq-test";
  process.env.EPN_TOOLID = "20001";
  process.env.EPN_MKCID = "9";
  process.env.EPN_MKRID = "711-99999-12345-0";
  process.env.EPN_SITEID = "123";
  process.env.EPN_MKEVT = "5";

  try {
    // Fresh import so env vars are picked up cleanly
    const freshModule = await importFreshFromHref(moduleHref);
    const { buildDealsFromRows } = freshModule;

    const rows = [
      {
        model_key: "acme_racer",
        brand: "Acme",
        title: "Acme Racer Putter",
        image_url: "https://example.com/putter.jpg",
        url: "https://www.ebay.com/itm/123?foo=bar",
        currency: "USD",
        head_type: "Blade",
        dexterity: "Right",
        length_in: 34,
        item_id: "123",
        price: 80,
        shipping: 10,
        total: 90,
        observed_at: "2024-01-02T18:00:00.000Z",
        condition: "USED",
        n: 8,
        window_days: 30,
        p10_cents: 10000,
        p50_cents: 15000,
        p90_cents: 20000,
        dispersion_ratio: 0.4,
        updated_at: "2024-01-02T17:00:00Z",
        listing_count: 3,
      },
    ];

    const [deal] = buildDealsFromRows(rows, 5);
    const decorated = new URL(deal.bestOffer.url);

    assert.equal(decorated.searchParams.get("campid"), process.env.EPN_CAMPID);
    assert.equal(decorated.searchParams.get("customid"), process.env.EPN_CUSTOMID);
    assert.equal(decorated.searchParams.get("toolid"), process.env.EPN_TOOLID);
    assert.equal(decorated.searchParams.get("mkcid"), process.env.EPN_MKCID);
    assert.equal(decorated.searchParams.get("mkrid"), process.env.EPN_MKRID);
    assert.equal(decorated.searchParams.get("siteid"), process.env.EPN_SITEID);
    assert.equal(decorated.searchParams.get("mkevt"), process.env.EPN_MKEVT);
    assert.equal(decorated.searchParams.get("campid"), "987654");
    assert.equal(decorated.searchParams.get("foo"), "bar");
  } finally {
    process.env.EPN_CAMPID = originalEnv.campid;
    process.env.EPN_CUSTOMID = originalEnv.customid;
    process.env.EPN_TOOLID = originalEnv.toolid;
    process.env.EPN_MKCID = originalEnv.mkcid;
    process.env.EPN_MKRID = originalEnv.mkrid;
    process.env.EPN_SITEID = originalEnv.siteid;
    process.env.EPN_MKEVT = originalEnv.mkevt;
  }
});

test("buildDealsFromRows omits compatibility accessory listings", async () => {
  const { buildDealsFromRows } = await modulePromise;

  const rows = [
    {
      model_key: "titleist_scotty_cameron_super_select",
      brand: "Titleist",
      title: "2/10pcs Weight Fit for Scotty Cameron Putter",
      image_url: "https://example.com/accessory.jpg",
      url: "https://example.com/listing",
      currency: "USD",
      head_type: "Blade",
      dexterity: "Right",
      length_in: null,
      item_id: "456",
      price: 25,
      shipping: 5,
      total: 30,
      observed_at: "2024-01-02T18:00:00.000Z",
      condition: "NEW",
      n: 10,
      window_days: 30,
      p10_cents: 9000,
      p50_cents: 15000,
      p90_cents: 21000,
      dispersion_ratio: 0.3,
      updated_at: "2024-01-02T17:00:00Z",
      listing_count: 4,
    },
  ];

  const deals = buildDealsFromRows(rows, 5);

  assert.equal(deals.length, 0);
});
