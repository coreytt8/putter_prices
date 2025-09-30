import test from "node:test";
import assert from "node:assert/strict";

import { buildDealsFromRows } from "./top-deals.js";

function createRow(overrides = {}) {
  return {
    model_key: "Scotty Cameron|Phantom X 5|Headcover",
    brand: "Scotty Cameron",
    title: "Scotty Cameron Phantom X 5 putter with headcover",
    image_url: null,
    url: "https://example.com/listing",
    currency: "USD",
    head_type: null,
    dexterity: null,
    length_in: null,
    item_id: "123",
    price: 299.99,
    shipping: 0,
    total: 299.99,
    observed_at: "2024-01-01T00:00:00.000Z",
    condition: "USED",
    n: 20,
    window_days: 30,
    p10_cents: 30000,
    p50_cents: 45000,
    p90_cents: 60000,
    dispersion_ratio: 2,
    stats_source: "aggregated",
    aggregated_n: 20,
    aggregated_updated_at: "2024-01-01T00:00:00.000Z",
    live_n: null,
    live_p10_cents: null,
    live_p50_cents: null,
    live_p90_cents: null,
    live_dispersion_ratio: null,
    live_updated_at: null,
    listing_count: 5,
    ...overrides,
  };
}

test("buildDealsFromRows keeps clean putter query primary when accessories appear in the title", () => {
  const rows = [createRow()];

  const deals = buildDealsFromRows(rows, 5);

  assert.equal(deals.length, 1);
  const [deal] = deals;

  assert.equal(deal.queryVariants.clean, "Scotty Cameron Phantom X");
  assert.equal(deal.queryVariants.accessory, "Scotty Cameron Phantom X Headcover");
  assert.equal(
    deal.query,
    deal.queryVariants.clean,
    "Expected the exported query to remain on the clean variant"
  );
});

test("buildDealsFromRows filters out accessory dominated weight kit rows", () => {
  const rows = [
    createRow({
      item_id: "weight-kit",
      model_key: "Scotty Cameron|Phantom X 5|Weight Kit",
      title: "Scotty Cameron Phantom X 5 weight kit 2pcs 10g",
      total: 150,
      price: 150,
      p50_cents: 40000,
    }),
  ];

  const deals = buildDealsFromRows(rows, 5);

  assert.equal(deals.length, 0, "weight kit rows should be ignored");
});

test("buildDealsFromRows keeps headcover rows even with accessory tokens", () => {
  const rows = [
    createRow({
      item_id: "headcover-kit",
      title: "Scotty Cameron Phantom X 5 headcover weight kit bundle",
      total: 150,
      price: 150,
      p50_cents: 40000,
    }),
  ];

  const deals = buildDealsFromRows(rows, 5);

  assert.equal(deals.length, 1, "headcover listings should remain");
  assert.equal(deals[0].bestOffer.itemId, "headcover-kit");
});
