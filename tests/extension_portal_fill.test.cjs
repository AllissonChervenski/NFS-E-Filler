const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const bgSource = fs.readFileSync(path.join(__dirname, '..', 'extension', 'background.js'), 'utf8');
const portalSource = fs.readFileSync(path.join(__dirname, '..', 'extension', 'runtime', 'portal_page.js'), 'utf8');

const funcMatch = bgSource.match(/func:\s*async\s*\((a,\s*p)\)\s*=>\s*\{([\s\S]*?)\}\s*,\s*args:/);
assert.ok(funcMatch, 'portalPage func should be present in background.js');

function createDOMContext(pathname = '/EmissorNacional/DPS/Servico') {
  const events = [];
  const jqueryEvents = [];
  const elements = [];

  class FakeClassList {
    constructor(classes = []) { this.classes = new Set(classes); }
    contains(c) { return this.classes.has(c); }
    add(c) { this.classes.add(c); }
    remove(c) { this.classes.delete(c); }
  }

  class FakeElement {
    constructor(tagName, attrs = {}) {
      this.tagName = tagName.toUpperCase();
      this.type = attrs.type || (this.tagName === 'SELECT' ? 'select-one' : 'text');
      this.id = attrs.id || '';
      this.name = attrs.name || '';
      this.value = attrs.value || '';
      this.checked = Boolean(attrs.checked);
      this.disabled = Boolean(attrs.disabled);
      this.readOnly = Boolean(attrs.readOnly);
      this.classList = new FakeClassList(attrs.classes || []);
      this.dataset = {...(attrs.dataset || {})};
      this.options = (attrs.options || []).map((opt, idx) => ({
        index: idx,
        value: typeof opt === 'string' ? opt : opt.value,
        textContent: typeof opt === 'string' ? opt : opt.text,
        disabled: Boolean(opt.disabled),
        parentElement: this,
      }));
      this.labels = [];
      this.children = [];
      this.parentElement = null;
      this.nextElementSibling = null;
      this.isConnected = true;
      elements.push(this);
    }
    get selectedOptions() { return this.options.filter(o => o.value === this.value); }
    get selectedIndex() { return this.options.findIndex(o => o.value === this.value); }
    dispatchEvent(event) { events.push({type: event.type, target: this}); return true; }
    blur() { events.push({type: 'blur', target: this}); }
    focus() { events.push({type: 'focus', target: this}); }
    click() {
      events.push({type: 'click', target: this});
      if (this.type === 'radio') this.checked = true;
      if (typeof this.onclick === 'function') this.onclick();
    }
    getAttribute(name) { return this[name] || null; }
    getClientRects() { return [{width: 100, height: 30}]; }
    getBoundingClientRect() { return {left: 10, top: 20, width: 100, height: 30}; }
    scrollIntoView() {}
    matches(selector) {
      const parts = selector.split(',').map(s => s.trim());
      return parts.some(part => {
        const tag = this.tagName.toLowerCase();
        if (part === tag || part.includes(tag)) return true;
        if (part.includes('input') && tag === 'input') return true;
        if (part.includes('select') && tag === 'select') return true;
        if (part.includes('textarea') && tag === 'textarea') return true;
        if (part.includes('.chosen-container') && this.classList.contains('chosen-container')) return true;
        if (part.includes('.select2-container') && this.classList.contains('select2-container')) return true;
        if (part.startsWith('#') && this.id === part.slice(1)) return true;
        return false;
      });
    }
    querySelectorAll(selector) {
      return this.children.filter(child => child.matches && child.matches(selector));
    }
    querySelector(selector) {
      if (selector.includes('.chosen-single') && this.classList.contains('chosen-container')) {
        return this.children.find(c => c.classList.contains('chosen-single')) || null;
      }
      if (selector.includes('.select2-selection') && this.classList.contains('select2-container')) {
        return this.children.find(c => c.classList.contains('select2-selection')) || null;
      }
      return null;
    }
    closest(selector) { return null; }
    cloneNode() {
      const copy = new FakeElement(this.tagName, {
        type: this.type, id: this.id, name: this.name, value: this.value,
        checked: this.checked, disabled: this.disabled, readOnly: this.readOnly
      });
      copy.textContent = this.textContent || '';
      return copy;
    }
  }

  function matchSimple(el, selector) {
    if (selector === '#modalLoading') return false;
    if (selector === 'form #btnAvancar' || selector === '#btnAvancar') return el.id === 'btnAvancar';
    if (selector.startsWith('#') && el.id === selector.slice(1)) return true;
    if (/\[id\*="avancar"/i.test(selector)) return /avancar/i.test(el.id);
    if (/\[id\*="avanca"/i.test(selector)) return /avanca/i.test(el.id);
    if (/\[name\*="avancar"/i.test(selector)) return /avancar/i.test(el.name);
    if (/\[name\*="avanca"/i.test(selector)) return /avanca/i.test(el.name);
    if (selector === 'button' && el.tagName === 'BUTTON') return true;
    if (selector === 'input[type="submit"]' && el.tagName === 'INPUT' && el.type === 'submit') return true;
    if (selector === 'button[type="submit"]' && el.tagName === 'BUTTON' && el.type === 'submit') return true;
    if (selector === 'input[type="button"]' && el.tagName === 'INPUT' && el.type === 'button') return true;
    if (selector === 'a.btn' && el.tagName === 'A' && el.classList.contains('btn')) return true;
    if (selector === 'a[role="button"]' && el.tagName === 'A') return true;
    if (selector === 'a' && el.tagName === 'A') return true;
    if (selector === '[role="button"]') return true;
    if (selector.startsWith('select[name="') && el.tagName === 'SELECT' && `select[name="${el.name}"]` === selector) return true;
    if (selector.startsWith('input[type="radio"][name="') && el.type === 'radio' && selector.includes(`name="${el.name}"`)) return true;
    if (selector.startsWith('input[name="') && el.tagName === 'INPUT' && `input[name="${el.name}"]` === selector) return true;
    if (selector.startsWith('textarea[name="') && el.tagName === 'TEXTAREA' && `textarea[name="${el.name}"]` === selector) return true;
    if (selector === '[data-nfse-target]') return Boolean(el.dataset?.nfseTarget);
    if (selector.includes('.chosen-search input') && el.classList.contains('chosen-search-input')) return true;
    if (selector.includes('.active-result') && el.classList.contains('active-result')) return true;
    if (selector.includes('.select2-search__field') && el.classList.contains('select2-search__field')) return true;
    if (selector.includes('.select2-results__option') && el.classList.contains('select2-results__option')) return true;
    return false;
  }

  const document = {
    readyState: 'complete',
    getElementById(id) { return elements.find(el => el.id === id) || null; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      const parts = selector.split(',').map(s => s.trim());
      return elements.filter(el => parts.some(part => matchSimple(el, part)));
    },
    createElement(tag) { return new FakeElement(tag); },
  };

  const inputProto = {};
  Object.defineProperty(inputProto, 'value', {
    get() { return this._val || ''; },
    set(v) { this._val = v; this.value = v; },
    configurable: true,
  });

  const windowObj = {
    document,
    location: {origin: 'https://www.nfse.gov.br', pathname},
    getComputedStyle: () => ({visibility: 'visible'}),
    crypto: {randomUUID: () => 'uuid-1234'},
    Event: class { constructor(type, options) { this.type = type; this.bubbles = options?.bubbles; } },
    MouseEvent: class { constructor(type, options) { this.type = type; this.bubbles = options?.bubbles; } },
    HTMLInputElement: {prototype: inputProto},
    HTMLTextAreaElement: {prototype: inputProto},
    jQuery: Object.assign(
      target => ({
        trigger(eventName) { jqueryEvents.push({type: eventName, target}); return this; },
        val(v) { if (target) target.value = v; return this; },
      }),
      {active: 0}
    ),
  };

  const context = vm.createContext({
    window: windowObj,
    document,
    location: windowObj.location,
    getComputedStyle: windowObj.getComputedStyle,
    crypto: windowObj.crypto,
    Event: windowObj.Event,
    MouseEvent: windowObj.MouseEvent,
    HTMLInputElement: windowObj.HTMLInputElement,
    HTMLTextAreaElement: windowObj.HTMLTextAreaElement,
    Array,
    String,
    Number,
    Boolean,
    setTimeout: (fn, delay) => fn(),
  });

  vm.runInContext(portalSource, context);
  const portalFunc = vm.runInContext(`async (a, p) => { ${funcMatch[2]} }`, context);

  return {
    context,
    document,
    elements,
    events,
    jqueryEvents,
    portalFunc,
    addSelect(attrs) { return new FakeElement('SELECT', attrs); },
    addRadio(attrs) { return new FakeElement('INPUT', {...attrs, type: 'radio'}); },
    addInput(attrs) { return new FakeElement('INPUT', {...attrs, type: attrs.type || 'text'}); },
    addTextarea(attrs) { return new FakeElement('TEXTAREA', attrs); },
  };
}

test('native_prepare fills NBS directly when option is present in select', async () => {
  const dom = createDOMContext('/EmissorNacional/DPS/Servico');
  const nbsSelect = dom.addSelect({
    id: 'ServicoPrestado_CodigoNBS',
    name: 'ServicoPrestado.CodigoNBS',
    classes: ['form-chosen'],
    options: [
      {value: '', text: 'Escolha'},
      {value: '103042000', text: '1.0304.20.00 - Hospedagem em hotéis'},
      {value: '103043000', text: '1.0304.30.00 - Outros'},
    ],
  });

  const field = {
    key: 'nbs',
    label: 'Item da NBS',
    value: '103042000',
    aliases: ['Item da NBS correspondente ao serviço/fornecimento prestado'],
    portal_selector: 'select[name="ServicoPrestado.CodigoNBS"]',
  };

  const result = await dom.portalFunc('native_prepare', {field, selector: '', used: []});
  assert.equal(result.status, 'filled');
  assert.equal(nbsSelect.value, '103042000');
  assert.ok(dom.jqueryEvents.some(e => e.type === 'chosen:updated' && e.target === nbsSelect));
  assert.ok(dom.events.some(e => e.type === 'change' && e.target === nbsSelect));
});

test('native_prepare falls to search_select for NBS when options are not preloaded', async () => {
  const dom = createDOMContext('/EmissorNacional/DPS/Servico');
  const nbsSelect = dom.addSelect({
    id: 'ServicoPrestado_CodigoNBS',
    name: 'ServicoPrestado.CodigoNBS',
    options: [{value: '', text: 'Escolha'}],
  });

  const widget = dom.document.createElement('DIV');
  widget.classList.add('chosen-container');
  const opener = dom.document.createElement('A');
  opener.classList.add('chosen-single');
  widget.children.push(opener);
  nbsSelect.nextElementSibling = widget;

  const field = {
    key: 'nbs',
    label: 'Item da NBS',
    value: '103042000',
    aliases: ['Item da NBS correspondente ao serviço/fornecimento prestado'],
    portal_selector: 'select[name="ServicoPrestado.CodigoNBS"]',
  };

  const prep = await dom.portalFunc('native_prepare', {field, selector: '', used: []});
  assert.equal(prep.status, 'ready');
  assert.equal(prep.kind, 'search_select');
});

test('native_prepare confirms pre-checked locked radio as confirmed', async () => {
  const dom = createDOMContext('/EmissorNacional/DPS/Tributacao');
  dom.addRadio({
    id: 'ISSQN_HaSuspensao_0',
    name: 'ISSQN.HaSuspensao',
    value: '0',
    disabled: true,
    checked: true,
  });

  const field = {
    key: 'iss_suspended',
    label: 'Exigibilidade do ISSQN suspensa',
    value: 'Não',
    aliases: ['A exigibilidade do recolhimento do ISSQN devido nesta operação está suspensa'],
    portal_selector: 'input[type="radio"][name="ISSQN.HaSuspensao"]',
  };

  const result = await dom.portalFunc('native_prepare', {field, selector: '', used: []});
  assert.equal(result.status, 'confirmed');
});

test('native_capture_select fires change and jQuery change on target to unlock next field', async () => {
  const dom = createDOMContext('/EmissorNacional/DPS/Servico');
  const munSelect = dom.addSelect({
    id: 'LocalPrestacao_CodigoMunicipioPrestacao',
    name: 'LocalPrestacao.CodigoMunicipioPrestacao',
    dataset: {nfseTarget: 'target-mun'},
    options: [
      {value: '', text: 'Escolha'},
      {value: '4300406', text: '4300406 - Alegrete - RS'},
    ],
  });
  munSelect.value = '4300406';

  let nationalEnabled = false;
  munSelect.onchange = () => { nationalEnabled = true; };

  const field = {
    key: 'municipality',
    label: 'Município da prestação',
    value: 'Alegrete/RS',
    aliases: ['Município'],
    portal_selector: 'select[name="LocalPrestacao.CodigoMunicipioPrestacao"]',
  };

  const captured = await dom.portalFunc('native_capture_select', {field, target: 'target-mun'});
  assert.equal(captured.status, 'filled');
  assert.equal(nationalEnabled, true);
  assert.ok(dom.jqueryEvents.some(e => e.type === 'change' && e.target === munSelect));
});

test('native_prepare prepares text input for debugger typing', async () => {
  const dom = createDOMContext('/EmissorNacional/DPS/Pessoas');
  const docInput = dom.addInput({id: 'Tomador_Inscricao', name: 'Tomador.Inscricao'});

  const field = {
    key: 'customer_document',
    label: 'CPF/CNPJ do tomador',
    value: '12.345.678/0001-95',
    aliases: ['CPF/CNPJ'],
    portal_selector: 'input[name="Tomador.Inscricao"]',
  };

  const prep = await dom.portalFunc('native_prepare', {field, selector: '', used: []});
  assert.equal(prep.status, 'ready');
  assert.equal(prep.kind, 'text');
  assert.equal(prep.value, '12345678000195');
});

test('advance button works properly', async () => {
  const dom = createDOMContext('/EmissorNacional/DPS/Pessoas');
  const advButton = dom.document.createElement('BUTTON');
  advButton.id = 'btnAvancar';
  advButton.type = 'submit';
  advButton.textContent = 'Avançar';

  const advRes = await dom.portalFunc('advance', {current: 'pessoas'});
  assert.equal(advRes.status, 'advancing');
});

test('advance button on Servico finds button without id but with submit and advance text', async () => {
  const dom = createDOMContext('/EmissorNacional/DPS/Servico');
  const backButton = dom.document.createElement('BUTTON');
  backButton.type = 'submit';
  backButton.textContent = 'Voltar';

  const advButton = dom.document.createElement('BUTTON');
  advButton.type = 'submit';
  advButton.classList.add('btn');
  advButton.classList.add('btn-primary');
  advButton.textContent = 'Avançar >';

  const advRes = await dom.portalFunc('advance', {current: 'servico'});
  assert.equal(advRes.status, 'advancing');
  assert.ok(dom.events.some(e => e.type === 'click' && e.target === advButton));
});

test('advance button finds input submit with value Avancar', async () => {
  const dom = createDOMContext('/EmissorNacional/DPS/Servico');
  const advInput = dom.document.createElement('INPUT');
  advInput.type = 'submit';
  advInput.value = 'Salvar e Avançar';

  const advRes = await dom.portalFunc('advance', {current: 'servico'});
  assert.equal(advRes.status, 'advancing');
  assert.ok(dom.events.some(e => e.type === 'click' && e.target === advInput));
});

test('advance returns available_buttons when button is truly missing', async () => {
  const dom = createDOMContext('/EmissorNacional/DPS/Servico');
  const otherButton = dom.document.createElement('BUTTON');
  otherButton.id = 'btnAjuda';
  otherButton.type = 'button';
  otherButton.textContent = 'Ajuda';

  const advRes = await dom.portalFunc('advance', {current: 'servico'});
  assert.equal(advRes.status, 'missing');
  assert.ok(advRes.available_buttons);
  assert.equal(advRes.available_buttons.length, 1);
  assert.equal(advRes.available_buttons[0].id, 'btnAjuda');
});
