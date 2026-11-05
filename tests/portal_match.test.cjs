const {test} = require('node:test');
const assert = require('node:assert/strict');
const {matches} = require('../src/nfse_filler/static/portal_match.js');

test('municipality formats keep the city and state together', () => {
  for (const text of ['Alegrete/RS', 'Alegrete / RS', 'Alegrete - RS', 'Alegrete (RS)',
    'RS - Alegrete', '4300406 - Alegrete/RS']) {
    assert.equal(matches(text, 'Alegrete/RS', 'municipality'), true, text);
  }
  for (const text of ['Alegrete/PI', 'Alegrete do Piauí/PI', 'Alegrete']) {
    assert.equal(matches(text, 'Alegrete/RS', 'municipality'), false, text);
  }
});

test('tax codes require a complete code rather than a numeric prefix', () => {
  assert.equal(matches('000 - Tributação', '000', 'cst'), true);
  assert.equal(matches('000001 - Classificação', '000', 'cst'), false);
  assert.equal(matches('1.0304.20.00 - Hospedagem', '103042000', 'nbs'), true);
});
