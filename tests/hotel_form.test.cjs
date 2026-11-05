const {test} = require('node:test');
const assert = require('node:assert/strict');
const {mergeStay, shouldAutoApply} = require('../src/nfse_filler/static/hotel_form.js');
const stay = {guest_name: 'Teste', check_in: '02/11/2026', check_out: '05/11/2026',
  service_value: '600,00', customer_document: '52998224725'};

test('keeps company document and competence while importing a guest stay', () => {
  const current = {customer_document: '11222333000181', competence: '2026-11-05'};
  const result = mergeStay(current, stay, true);
  assert.equal(result.customer_document, current.customer_document);
  assert.equal(result.competence, current.competence);
  assert.equal(result.service_value, '600,00');
  assert.equal(current.guest_name, undefined);
});

test('imports the current guest document and clears a previous guest document if absent', () => {
  assert.equal(mergeStay({}, stay, true).customer_document, stay.customer_document);
  assert.equal(mergeStay({customer_document: '11222333000181'}, stay, false).customer_document, stay.customer_document);
  assert.equal(mergeStay({customer_document: '11222333000181'}, {...stay, customer_document: ''}, false).customer_document, '');
  assert.equal(mergeStay({customer_document: '11222333000181'}, {...stay, customer_document: ''}, true).customer_document, '11222333000181');
});

test('automatically applies only a requested lookup and never overwrites later manual edits', () => {
  const current = {guest_name: '', customer_document: ''};
  const snapshot = JSON.stringify(current);
  const status = {id: 7, status: 'done', result: stay};
  assert.equal(shouldAutoApply(status, 7, snapshot, current, false), true);
  assert.equal(shouldAutoApply(status, null, snapshot, current, false), false);
  assert.equal(shouldAutoApply(status, 6, snapshot, current, false), false);
  assert.equal(shouldAutoApply(status, 7, snapshot, {...current, customer_document: '11222333000181'}, false), false);
  assert.equal(shouldAutoApply(status, 7, snapshot, current, true), false);
  assert.equal(shouldAutoApply({...status, busy: true}, 7, snapshot, current, false), false);
});
