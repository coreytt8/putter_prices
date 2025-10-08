const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const modulePath = path.join(__dirname, "..", "deal-label.js");
const moduleHref = pathToFileURL(modulePath).href;

const modulePromise = import(/* webpackIgnore: true */ moduleHref);

test("composeDealLabel falls back to model key segments when sanitized metadata is empty", async () => {
  const { composeDealLabel } = await modulePromise;

  const row = {
    brand: "Scotty Cameron",
    model_key: "Titleist|Scotty Cameron|Newport Jet Set|Newport 2",
    title: "Scotty Cameron",
  };

  const { label } = composeDealLabel(row, null);
  assert.equal(label, "Scotty Cameron Newport Jet Set Newport 2");
});

test("composeDealLabel reuses listing title when it carries model detail", async () => {
  const { composeDealLabel } = await modulePromise;

  const row = {
    brand: "Scotty Cameron",
    model_key: "Scotty Cameron",
    title: "Scotty Cameron Phantom X 5.5 Tour Putter",
  };

  const sanitized = {
    brand: "Scotty Cameron",
    cleanLabel: "",
    label: "",
  };

  const { label } = composeDealLabel(row, sanitized);
  assert.equal(label, "Scotty Cameron Phantom X 5.5 Tour Putter");
});
