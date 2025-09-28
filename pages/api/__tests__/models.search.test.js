const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const searchModuleUrl = pathToFileURL(
  path.join(__dirname, '..', 'models', 'search.js')
).href;

test('treats trivial queries as wildcard and returns top models', async () => {
  const fakeRows = [
    { model_key: 'scotty_cameron_newport', cnt: 42 },
    { model_key: 'odyssey_white_hot', cnt: 31 },
  ];

  const { searchModels, default: handler } = await import(searchModuleUrl);

  const req = { query: { q: 'putter' } };
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  const fakeSql = (strings, ...values) => {
    const text = strings.join(' ');
    if (text.includes('SELECT')) {
      assert.ok(!text.includes('LOWER(i.model_key) LIKE'));
      return fakeRows;
    }

    assert.equal(text.trim(), '');
    return '';
  };

  await handler({ ...req, testSql: fakeSql }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    ok: true,
    q: 'putter',
    models: fakeRows,
  });

  const rows = await searchModels(fakeSql, 'putter');

  assert.deepEqual(rows, fakeRows);
});
