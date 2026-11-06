window.NFSeExtensionPortal = (() => {
/* Regras comuns ao select e aos resultados de busca do portal. */
const NFSePortalMatch = (() => {
  const normalize = raw => String(raw ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').replace(/\s*\/\s*/g, '/').trim().toLowerCase();
  const municipality = raw => normalize(raw)
    .replace(/^[0-9]{7}\s*[-–]\s*/, '')
    .replace(/^([a-z]{2})\s*[-–]\s*(.+)$/, '$2/$1')
    .replace(/\s*(?:\/|[-–]|\()\s*([a-z]{2})\)?$/, '/$1');
  const matches = (raw, value, key) => {
    if (key === 'municipality') return municipality(raw) === municipality(value);
    if (normalize(raw) === normalize(value)) return true;
    if (/^[0-9.]+$/.test(value)) {
      const code = String(raw).trim().match(/^[0-9.]+(?=\s|$|[-–])/);
      return !!code && code[0].replaceAll('.', '') === value.replaceAll('.', '');
    }
    return normalize(raw).startsWith(normalize(value) + ' -');
  };
  return {matches};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = NFSePortalMatch;

const fill = function () {
/* Executado somente na aba autenticada do DPS, via WebDriver. */
const [field, selector, used] = arguments;
const verifyOnly = arguments[5] === 'verify';
const expectedOrigin = arguments[3] || 'https://www.nfse.gov.br';
if (location.origin !== expectedOrigin || (expectedOrigin === 'https://www.nfse.gov.br' &&
    !location.pathname.startsWith('/EmissorNacional/DPS/'))) return {status: 'wrong_page'};
const normalize = value => String(value ?? '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[\s*?:]+$/g, '')
  .replace(/\s+/g, ' ').replace(/\s*\/\s*/g, '/').trim().toLowerCase();
const visible = el => !!(el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden';
const loader = document.querySelector('#modalLoading');
if (document.readyState !== 'complete' || Number(window.jQuery?.active || 0) > 0 ||
    (loader && visible(loader))) return {status: 'not_ready'};
const radioLabels = el => el.closest('label') ? [el.closest('label')] : Array.from(el.labels || []);
const widgetFor = el => {
  const sibling = el.nextElementSibling;
  if (sibling?.matches('.select2-container, .chosen-container, .selectize-control, .ts-wrapper')) return sibling;
  return el.id ? document.getElementById(el.id + '_chosen') || document.getElementById('s2id_' + el.id) : null;
};
const accessible = el => visible(el) || (el.tagName === 'SELECT' &&
  visible(el.parentElement) && (el.classList.contains('select2-hidden-accessible') ||
    el.classList.contains('select2-offscreen') ||
    (widgetFor(el) && visible(widgetFor(el))))) ||
  (el.type === 'radio' && radioLabels(el).some(visible));
const usable = el => accessible(el) && (!el.disabled || (el.type === 'radio' && el.checked));
const controlSelector = 'input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea';
const controls = el => Array.from(el.querySelectorAll(controlSelector)).filter(usable);
const aliases = field.aliases.map(normalize);
const labelText = el => {
  const copy = el.cloneNode(true);
  copy.querySelectorAll('input, select, textarea, button, .tooltip, .help-block, .field-validation-error')
    .forEach(child => child.remove());
  return normalize(copy.textContent).replace(/\s*\(obrigatorio\)$/, '').trim();
};
const optionMatches = (text, value) => NFSePortalMatch.matches(text, value, field.key);
const selectMatches = el => Array.from(el.options).filter(o => !o.disabled &&
  (normalize(o.value) === normalize(field.value) ||
   optionMatches(o.value, String(field.value)) ||
   optionMatches(o.textContent, String(field.value))));
let candidates = [];
// Um seletor conhecido nunca recai em outro CPF/CNPJ ou pergunta de endereço.
const mapping = selector || field.portal_selector;
if (mapping) {
  try {
    const mapped = Array.from(document.querySelectorAll(mapping));
    candidates = mapped.filter(usable);
    if (mapped.length && !candidates.length) return {status: 'not_ready'};
  }
  catch { return {status: 'invalid_selector'}; }
} else {
  for (const label of document.querySelectorAll('label, legend, [role=group], [aria-label]')) {
    const text = label.getAttribute('aria-label') ? normalize(label.getAttribute('aria-label')) : labelText(label);
    if (!aliases.includes(text)) continue;
    if (label.matches(controlSelector) && usable(label)) candidates.push(label);
    else if (label.control && usable(label.control)) candidates.push(label.control);
    else {
      let group = label;
      for (let level = 0; group && level < 4; level++, group = group.parentElement) {
        const items = controls(group);
        if (items.length === 1) { candidates.push(items[0]); break; }
        if (items.length && items.every(i => i.type === 'radio' && i.name && i.name === items[0].name)) {
          candidates.push(group); break;
        }
        if (items.length > 1) break;
      }
    }
  }
  if (!candidates.length) {
    // Associações ARIA também podem apontar para spans em vez de labels.
    for (const control of document.querySelectorAll(controlSelector)) {
      if (!usable(control)) continue;
      const labels = (control.getAttribute('aria-labelledby') || '').split(/\s+/)
        .map(id => document.getElementById(id)).filter(Boolean);
      if (labels.some(label => aliases.includes(labelText(label)))) candidates.push(control);
    }
  }
  if (!candidates.length && field.identifiers?.length) {
    const canonical = text => normalize(text).replace(/[^a-z0-9]/g, '');
    const identifiers = field.identifiers.map(canonical);
    for (const control of document.querySelectorAll(controlSelector)) {
      const names = [control.id, control.name].flatMap(value => String(value || '').split(/[.\[\]_]/));
      if (usable(control) && names.some(name => identifiers.includes(canonical(name)))) candidates.push(control);
    }
  }
}
candidates = [...new Set(candidates)];
if (!candidates.length) return {status: 'missing'};
if (candidates.length > 1 && candidates.every(el => el.type === 'radio' && el.name &&
    el.name === candidates[0].name && el.form === candidates[0].form)) candidates = [candidates[0]];
if (candidates.length > 1 && candidates.every(el => el.tagName === 'SELECT')) {
  const specific = candidates.filter(el => selectMatches(el).length === 1);
  if (specific.length === 1) candidates = specific;
}
if (candidates.length !== 1) return {status: 'ambiguous'};
let target = candidates[0];
if (!target.matches(controlSelector)) {
  const items = controls(target);
  if (items.length === 1) target = items[0];
  else if (!items.length || !items.every(i => i.type === 'radio' && i.name && i.name === items[0].name)) {
    return {status: 'unsupported'};
  }
}
const radios = target.type === 'radio'
  ? (target.name ? Array.from(document.querySelectorAll('input[type=radio]')).filter(i => i.name === target.name && i.form === target.form && usable(i)) : [target])
  : controls(target).filter(i => i.type === 'radio');
if (radios.length) {
  const matching = radios.filter(r => radioLabels(r).some(l => labelText(l) === normalize(field.value)) ||
    normalize(r.getAttribute('aria-label')) === normalize(field.value) || normalize(r.value) === normalize(field.value));
  if (matching.length !== 1) return {status: matching.length ? 'ambiguous' : 'option_missing'};
  target = matching[0];
}
if (!usable(target) || (target.readOnly && !verifyOnly)) return {status: 'not_ready'};
if (arguments[4]) return {status: 'present'};
// Uma identidade por grupo impede que dois códigos sobrescrevam o mesmo controle.
const identityElement = radios.length ? radios[0] : target;
if (!identityElement.dataset.nfseTarget) identityElement.dataset.nfseTarget = crypto.randomUUID();
const identity = identityElement.dataset.nfseTarget;
if (used.includes(identity)) return {status: 'duplicate'};
const comparable = raw => {
  let text = String(raw).trim();
  if (field.key === 'customer_document') return text.replace(/[.\-/\s]/g, '').toUpperCase();
  if (['simple_rate', 'service_value'].includes(field.key)) {
    text = text.replace(/^R\$\s*/, '');
    if (text.includes(',')) text = text.replaceAll('.', '').replace(',', '.');
    if (!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(text)) return null;
    const [whole, fraction = ''] = text.split('.');
    return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))).toString();
  }
  if (field.key === 'competence') return text.replace(/\D/g, '');
  if (['national_tax', 'municipal_tax', 'nbs', 'operation_indicator', 'cst', 'classification'].includes(field.key)) {
    return text.replace(/[.\s]/g, '');
  }
  return text;
};
let value = String(field.value);
if (field.key === 'competence' && target.type !== 'date') value = value.split('-').reverse().join('/');
if (target.type === 'number') value = value.replace(',', '.');
if (verifyOnly) {
  let confirmed;
  if (target.type === 'radio') confirmed = target.checked;
  else if (target.tagName === 'SELECT') {
    const selected = Array.from(target.selectedOptions || (target.selectedIndex >= 0 ? [target.options[target.selectedIndex]] : []));
    confirmed = selected.some(option => !option.disabled && (
      normalize(option.value) === normalize(field.value) ||
      optionMatches(option.value, String(field.value)) ||
      optionMatches(option.textContent, String(field.value))
    ));
  }
  else confirmed = comparable(target.value) !== null && comparable(target.value) === comparable(value);
  return {status: target.isConnected && confirmed ? 'confirmed' : 'rejected', target: identity};
}
const fire = () => { target.dispatchEvent(new Event('input', {bubbles: true}));
  target.dispatchEvent(new Event('change', {bubbles: true}));
  if (typeof target.onchange === 'function') target.onchange();
  target.blur(); };
if (target.type === 'radio') {
  if (!target.checked) {
    const label = radioLabels(target).find(visible);
    (visible(target) ? target : label).click();
    target.dispatchEvent(new Event('input', {bubbles: true}));
    target.dispatchEvent(new Event('change', {bubbles: true}));
    if (typeof target.onchange === 'function') target.onchange();
    if (window.jQuery) window.jQuery(target).trigger('change');
  }
  return {status: target.checked ? 'filled' : 'rejected', target: identity};
}
if (target.tagName === 'SELECT') {
  const matches = selectMatches(target);
  if (!matches.length) {
    const holder = widgetFor(target);
    const opener = holder?.querySelector('.select2-selection') ||
      holder?.querySelector('.select2-choice, .chosen-single, .chosen-choices, .selectize-input, .ts-control');
    if (opener && visible(opener)) return {status: 'search', target: identity, opener};
  }
  if (matches.length !== 1) return {status: matches.length ? 'ambiguous' : 'option_missing'};
  if (target.value !== matches[0].value) {
    target.value = matches[0].value;
    fire();
    if (window.jQuery) {
      window.jQuery(target).trigger('change');
      window.jQuery(target).trigger('chosen:updated');
    }
  }
  return {status: target.isConnected && target.value === matches[0].value ? 'filled' : 'rejected', target: identity};
}
if (!['text', 'tel', 'number', 'date', 'search', 'textarea'].includes(target.type)) return {status: 'unsupported'};
// Autocompletes precisam de seleção explícita para vincular o código interno ao texto.
if (target.getAttribute('role') === 'combobox' || target.getAttribute('aria-autocomplete') ||
    target.classList.contains('ui-autocomplete-input')) return {status: 'search', target: identity, input: target};
const proto = target.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
target.focus();
Object.getOwnPropertyDescriptor(proto, 'value').set.call(target, value);
fire();
return {status: target.isConnected && comparable(target.value) === comparable(value) ? 'filled' : 'rejected', target: identity};

};
const option = function () {
/* Localiza uma opção de autocomplete sem clicar em botões de navegação. */
const [value, action, identity] = arguments;
const fieldKey = arguments[4];
const expectedOrigin = arguments[3] || 'https://www.nfse.gov.br';
if (location.origin !== expectedOrigin || (expectedOrigin === 'https://www.nfse.gov.br' &&
    !location.pathname.startsWith('/EmissorNacional/DPS/'))) return {status: 'wrong_page'};
const visible = el => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
const matchesValue = raw => NFSePortalMatch.matches(raw, value, fieldKey);
if (action === 'verify') {
  const target = Array.from(document.querySelectorAll('[data-nfse-target]'))
    .find(el => el.dataset.nfseTarget === identity);
  const selectedText = target?.tagName === 'SELECT' ? target.selectedOptions[0]?.textContent : target?.value;
  const selectedVal = target?.value;
  const ok = target && (matchesValue(selectedText || '') || matchesValue(selectedVal || ''));
  return {status: ok ? 'filled' : 'rejected'};
}
if (action === 'input') {
  const inputs = Array.from(document.querySelectorAll('.select2-container--open .select2-search__field, .select2-drop-active .select2-input, .chosen-with-drop .chosen-search input, .chosen-container-active .chosen-search input, .selectize-control .input-active input, .ts-wrapper.dropdown-active .ts-control input'))
    .filter(visible);
  return inputs.length === 1 ? {status: 'input', input: inputs[0]} : {status: 'missing'};
}
const options = Array.from(document.querySelectorAll(
  '.select2-results__option[role=option], .select2-results__option[role=treeitem], .select2-result-selectable, [role=listbox] [role=option], .ui-menu-item, .chosen-with-drop .chosen-results .active-result, .chosen-container-active .chosen-results .active-result, .selectize-dropdown [data-selectable], .ts-dropdown [data-selectable]'
)).filter(el => visible(el) && el.getAttribute('aria-disabled') !== 'true');
const matches = options.filter(el => matchesValue(el.textContent));
if (matches.length !== 1) return {status: matches.length ? 'ambiguous' : 'option_missing'};
return {status: 'option', option: matches[0]};

};
const inspect = function () {
/* Relatório estrutural: não lê value, HTML completo, cookies nem opções dos selects. */
const expectedOrigin = arguments[0] || 'https://www.nfse.gov.br';
if (location.origin !== expectedOrigin || (expectedOrigin === 'https://www.nfse.gov.br' &&
    !location.pathname.startsWith('/EmissorNacional/DPS/'))) return {status: 'wrong_page'};
const visible = el => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
const tomadorDocument = document.querySelector('#Tomador_Inscricao');
const tomadorName = document.querySelector('#Tomador_Nome');
const text = el => {
  const copy = el.cloneNode(true);
  copy.querySelectorAll('input, select, textarea, option, button, script, style, .tooltip, .help-block')
    .forEach(child => child.remove());
  return copy.textContent.replace(/\s+/g, ' ').trim().slice(0, 200);
};
return {
  status: 'inspected', path: location.pathname, iframe_count: document.querySelectorAll('iframe').length,
  page_state: {
    viewport_width: window.innerWidth, viewport_height: window.innerHeight,
    ready_state: document.readyState, ajax_active: Number(window.jQuery?.active || 0),
    loading_visible: !!(document.querySelector('#modalLoading') && visible(document.querySelector('#modalLoading'))),
    advance_disabled: !!document.querySelector('#btnAvancar')?.disabled,
    active_element: document.activeElement?.id || document.activeElement?.tagName?.toLowerCase() || '',
    tomador_document_shape: tomadorDocument ? tomadorDocument.value.replace(/[A-Z0-9]/gi, 'X') : '',
    tomador_name_present: !!tomadorName?.value.trim(),
  },
  fields: Array.from(document.querySelectorAll('input:not([type=hidden]):not([type=password]):not([type=submit]):not([type=button]), select, textarea'))
    .map(el => {
      const aria = (el.getAttribute('aria-labelledby') || '').split(/\s+/)
        .map(id => document.getElementById(id)).filter(Boolean);
      return {
        tag: el.tagName.toLowerCase(), type: el.type, id: el.id, name: el.name,
        classes: el.className,
        next_element: el.nextElementSibling ? {tag: el.nextElementSibling.tagName.toLowerCase(), classes: el.nextElementSibling.className} : null,
        labels: [...new Set([...Array.from(el.labels || []), ...aria].map(text))],
        visible: visible(el), disabled: el.disabled, readonly: !!el.readOnly,
        selector: el.id ? `#${CSS.escape(el.id)}` : null,
      };
    }),
};

};
return {fill, option, inspect, matches: NFSePortalMatch.matches};
})();
