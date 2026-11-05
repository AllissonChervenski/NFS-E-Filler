const {test} = require('node:test');
const assert = require('node:assert/strict');
const {displayDate, maskDate} = require('../src/nfse_filler/static/dates.js');

test('shows Brazilian dates and converts ISO without changing day/month', () => {
  assert.equal(displayDate('02/11/2026'), '02/11/2026');
  assert.equal(displayDate('2026-11-02'), '02/11/2026');
  assert.equal(displayDate('2/11/2026'), '—');
  assert.equal(displayDate(''), '—');
});

test('masks typing, pasting and partial dates in Brazilian order', () => {
  for (const [input, expected] of [
    ['0', '0'], ['021', '02/1'], ['02112', '02/11/2'],
    ['02112026', '02/11/2026'], ['02/11/2026', '02/11/2026'],
    ['2026-11-02', '02/11/2026'], ['', ''],
  ]) assert.equal(maskDate(input), expected);
});
