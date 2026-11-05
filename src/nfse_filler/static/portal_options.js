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
  const selected = target?.tagName === 'SELECT' ? target.selectedOptions[0]?.textContent : target?.value;
  return {status: target && matchesValue(selected || '') ? 'filled' : 'rejected'};
}
if (action === 'input') {
  const inputs = Array.from(document.querySelectorAll('.select2-container--open .select2-search__field, .select2-drop-active .select2-input, .chosen-with-drop .chosen-search input, .selectize-control .input-active input, .ts-wrapper.dropdown-active .ts-control input'))
    .filter(visible);
  return inputs.length === 1 ? {status: 'input', input: inputs[0]} : {status: 'missing'};
}
const options = Array.from(document.querySelectorAll(
  '.select2-results__option[role=option], .select2-results__option[role=treeitem], .select2-result-selectable, [role=listbox] [role=option], .ui-menu-item, .chosen-with-drop .chosen-results .active-result, .selectize-dropdown [data-selectable], .ts-dropdown [data-selectable]'
)).filter(el => visible(el) && el.getAttribute('aria-disabled') !== 'true');
const matches = options.filter(el => matchesValue(el.textContent));
if (matches.length !== 1) return {status: matches.length ? 'ambiguous' : 'option_missing'};
return {status: 'option', option: matches[0]};
