const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'background.js'), 'utf8');

function lookupWithStaleEdit(loadsAfterReload, needsForeground = false) {
  let now = 0;
  let reloads = 0;
  let closed = 0;
  let locateStep = 0;
  let activeTab = 1;
  const updates = [];
  const chrome = {
    runtime: {onInstalled: {addListener() {}}, onMessage: {addListener() {}}},
    sidePanel: {setPanelBehavior() {}},
    tabs: {
      async query(options) { return [{id: options.active ? activeTab : 1}]; },
      async create() { return {id: 2}; },
      async reload() { reloads++; },
      async update(id) { activeTab = id; updates.push(id); },
      async remove() { closed++; },
    },
    scripting: {
      async executeScript(options) {
        if (options.files) return [];
        const action = options.args[0];
        if (action === 'map_status') return [{result: {status: 'map_ready', cards: 49}}];
        if (action === 'reset_card') return [{result: {status: 'reset'}}];
        if (action === 'locate') {
          if (needsForeground && activeTab !== 2) return [{result: {status: 'card_not_opened'}}];
          const status = ['opening_card', 'opening_statement', 'located'][Math.min(locateStep++, 2)];
          return [{result: {status}}];
        }
        if (reloads && loadsAfterReload) return [{result: {status: 'read', data: {room: '02'}}}];
        return [{result: {status: 'not_ready', route: '#/editarOcupacao/21548', stale_map: true}}];
      },
    },
  };
  const context = vm.createContext({chrome, URL, Date: class extends Date { static now() { return now; } },
    setTimeout(callback, delay) { now += delay; callback(); }});
  vm.runInContext(source, context);
  return {lookup: vm.runInContext('lookup', context), counts: () => ({reloads, closed, activeTab, updates})};
}

test('reloads an edit route that still shows the map, then reads the room', async () => {
  const mock = lookupWithStaleEdit(true);
  assert.equal((await mock.lookup('02', {selectors: {}})).room, '02');
  assert.deepEqual(mock.counts(), {reloads: 1, closed: 1, activeTab: 1, updates: []});
});

test('reports a stale edit form clearly and closes the lookup tab', async () => {
  const mock = lookupWithStaleEdit(false);
  await assert.rejects(mock.lookup('02', {selectors: {}}), /não carregou o formulário/);
  assert.deepEqual(mock.counts(), {reloads: 1, closed: 1, activeTab: 1, updates: []});
});

test('temporarily activates the map tab when the card needs foreground input', async () => {
  const mock = lookupWithStaleEdit(true, true);
  assert.equal((await mock.lookup('02', {selectors: {}})).room, '02');
  assert.deepEqual(mock.counts(), {reloads: 1, closed: 1, activeTab: 1, updates: [2, 1]});
});
