const {test} = require('node:test');
const assert = require('node:assert/strict');
const {holderIdentity, canonicalRoom} = require('../src/nfse_filler/static/desbravador_data.js');

test('uses the holder ID instead of blindly copying the first guest document', () => {
  const result = holderIdentity({id: '20', name: 'Titular de Teste'}, [
    {id: '10', name: 'Outro Hóspede', document: '11144477735'},
    {id: '20', name: 'Titular de Teste', document: '52998224725'},
  ]);
  assert.deepEqual(result, {name: 'Titular de Teste', document: '52998224725'});
});

test('uses a unique matching name when IDs are unavailable; rejects ambiguous names', () => {
  const guests = [{name: 'Outro', document: '11144477735'}, {name: 'José de Teste', document: '52998224725'}];
  assert.equal(holderIdentity({name: 'JOSE DE TESTE'}, guests).document, '52998224725');
  assert.equal(holderIdentity({name: 'José de Teste'}, [...guests, guests[1]]).document, '');
  assert.equal(holderIdentity({id: '99', name: 'José de Teste'}, [{...guests[1], id: '20'}]).document, '');
  assert.equal(holderIdentity({id: '20', name: 'Empresa de Teste'}, [{...guests[1], id: '20'}]).document, '');
});

test('separates explicit document suffixes from the holder name', () => {
  assert.deepEqual(holderIdentity({name: 'Titular de Teste - 529.982.247-25'}, []),
    {name: 'Titular de Teste', document: '529.982.247-25'});
  assert.equal(canonicalRoom('02'), canonicalRoom('2'));
  assert.notEqual(canonicalRoom('02A'), canonicalRoom('02B'));
});
