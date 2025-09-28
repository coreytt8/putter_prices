const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const modulePromise = import(pathToFileURL(path.join(__dirname, "..", "top-deals.js")).href);

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
