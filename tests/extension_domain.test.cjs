const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..', 'extension');
const context = vm.createContext({window: {}, URL, Date, Set, Number, String, Error});
for (const file of ['runtime/metadata.js', 'domain.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
}
const domain = vm.runInContext('NFSeDomain', context);

test('prepares the three portal stages with editable tomador', () => {
  const settings = domain.settings(domain.defaults());
  const prepared = domain.prepare({guest_name: 'Hóspede Exemplo', customer_document: '11.222.333/0001-81',
    competence: '2026-11-05', check_in: '02/11/2026', check_out: '05/11/2026', service_value: '600,00'}, settings);
  assert.equal(prepared.steps.length, 3);
  assert.equal(prepared.steps[0].fields.find(f => f.key === 'customer_document').value, '11222333000181');
  assert.equal(prepared.steps[2].fields.find(f => f.key === 'service_value').value, '600,00');
  assert.match(prepared.description, /Hóspede Exemplo/);
});

test('rejects invalid dates and documents', () => {
  const input = {guest_name: 'Exemplo', customer_document: '52998224725', competence: '2026-11-05',
    check_in: '02/11/2026', check_out: '05/11/2026', service_value: '600,00'};
  assert.throws(() => domain.prepare({...input, check_in: '31/02/2026'}, domain.defaults()), /data válida/);
  assert.throws(() => domain.prepare({...input, customer_document: '11111111111'}, domain.defaults()), /CPF ou CNPJ válido/);
});

test('imports lodging tariff only from the selected room', () => {
  const raw = {room: '02', guest_name: 'Titular Exemplo', customer_document: '529.982.247-25',
    check_in: '02/11/2026 14:30', check_out: '05/11/2026', lodging_total: 'R$ 600,00'};
  const stay = domain.stay(raw, '2');
  assert.equal(stay.service_value, '600,00');
  assert.equal(stay.customer_document, '52998224725');
  assert.throws(() => domain.stay({...raw, room: '03'}, '02'), /não corresponde/);
  assert.throws(() => domain.stay({...raw, lodging_total: 'Diárias 600,00 Consumo 80,00'}, '02'), /Subtotal/);
});
