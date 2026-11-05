'use strict';

const {displayDate, maskDate} = window.NFSeDates;

const $ = selector => document.querySelector(selector);
const invoiceForm = $('#invoice-form');
const settingsForm = $('#settings-form');
const prepareButton = invoiceForm.querySelector('button[type="submit"]');
let state;
let prepared = null;
let preparedInput = null;
let settingsDirty = false;
let busy = false;
let noticeTimer;
let diagnostics = null;
const currency = new Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'BRL'});

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function notice(message, success = false) {
  clearTimeout(noticeTimer);
  $('#notice').textContent = message;
  $('#notice').className = success ? 'notice success' : 'notice';
  $('#notice').hidden = false;
  if (success) noticeTimer = setTimeout(() => { $('#notice').hidden = true; }, 5000);
}

async function api(path, payload) {
  const options = payload === undefined ? {} : {
    method: 'POST', headers: {'Content-Type': 'application/json', 'X-NFSE-Request': 'local'},
    body: JSON.stringify(payload),
  };
  let response;
  try { response = await fetch(path, options); }
  catch { throw new Error('Não foi possível acessar o aplicativo. Verifique se o servidor local está aberto.'); }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Não foi possível concluir a operação.');
  return result;
}

function showView(view) {
  const isInvoice = view === 'invoice';
  $('#invoice-view').hidden = !isInvoice;
  $('#settings-view').hidden = isInvoice;
  for (const name of ['invoice', 'settings']) {
    const button = $(`#nav-${name}`);
    button.classList.toggle('active', name === view);
    if (name === view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  $('#notice').hidden = true;
  window.scrollTo({top: 0});
}
$('#nav-invoice').addEventListener('click', () => showView('invoice'));
$('#nav-settings').addEventListener('click', () => showView('settings'));
$('#edit-settings').addEventListener('click', () => showView('settings'));

function updateActions() {
  $('#open-portal').disabled = busy;
  $('#inspect-portal').disabled = busy;
  document.querySelectorAll('[data-step]').forEach(button => { button.disabled = busy || !prepared; });
  prepareButton.disabled = busy || !state;
  $('#save-settings').disabled = busy || !state;
}

function invalidate() {
  prepared = null;
  preparedInput = null;
  $('#review-details').hidden = true;
  $('#preview-state').textContent = 'Rascunho';
  $('#preview-state').classList.remove('ready');
  $('#prepare-hint').textContent = 'Prepare os dados da hospedagem para habilitar as etapas.';
  updateActions();
}

const inputData = () => Object.fromEntries(new FormData(invoiceForm));
for (const name of ['check_in', 'check_out']) {
  invoiceForm.elements[name].addEventListener('input', event => {
    const input = event.target;
    const caret = input.selectionStart;
    const prefixLength = maskDate(input.value.slice(0, caret)).length;
    input.value = maskDate(input.value);
    input.setSelectionRange(prefixLength, prefixLength);
  });
}
function livePreview() {
  const data = inputData();
  let amount = data.service_value.trim();
  if (amount.includes(',')) amount = amount.replaceAll('.', '').replace(',', '.');
  const number = /^\d+(\.\d{1,2})?$/.test(amount) ? Number(amount) : 0;
  $('#preview-amount').textContent = currency.format(Number.isFinite(number) ? number : 0);
  $('#preview-in').textContent = displayDate(data.check_in);
  $('#preview-out').textContent = displayDate(data.check_out);
  const complete = data.guest_name.trim() && data.check_in && data.check_out;
  $('#preview-description').textContent = complete
    ? `Hospedagem de ${data.guest_name.trim()}. Check-in no dia ${displayDate(data.check_in)} e Check-out ${displayDate(data.check_out)}`
    : 'O nome do hóspede e as datas da estadia compõem a descrição automaticamente.';
  $('#copy-description').disabled = !complete;
}
invoiceForm.addEventListener('input', () => { invalidate(); livePreview(); });

function renderSettings() {
  $('#settings-fields').replaceChildren();
  $('#selector-fields').replaceChildren();
  for (const [step, title] of Object.entries(state.steps)) {
    const section = element('section', 'card settings-group');
    section.append(element('h2', '', title));
    const grid = element('div', 'form-grid');
    for (const field of state.fields.filter(f => f.step === step)) {
      const label = element('label', field.key === 'regime' ? 'full' : '', field.label);
      const input = element(field.choices ? 'select' : 'input');
      input.name = field.key;
      input.id = `setting-${field.key}`;
      input.required = true;
      if (field.choices) {
        for (const choice of field.choices) {
          const option = element('option', '', choice);
          option.value = choice;
          input.append(option);
        }
      } else { input.maxLength = 1000; }
      if (field.kind === 'rate') input.inputMode = 'decimal';
      input.value = state.settings.values[field.key];
      label.append(input);
      if (field.hint) label.append(element('small', '', field.hint));
      grid.append(label);
    }
    section.append(grid);
    $('#settings-fields').append(section);
  }
  for (const field of [...state.variable_fields, ...state.fields]) {
    const label = element('label', '', `${state.steps[field.step]} · ${field.label}`);
    const input = element('input');
    input.name = `selector:${field.key}`;
    input.id = `selector-${field.key}`;
    input.value = state.settings.selectors[field.key] || '';
    input.placeholder = 'Automático pelo rótulo';
    input.maxLength = 500;
    input.spellcheck = false;
    label.append(input);
    $('#selector-fields').append(label);
  }
  renderSummarySettings();
  $('#save-status').textContent = 'Configuração atual carregada.';
}

function renderSummarySettings(values = state.settings.values) {
  $('#summary-municipality').textContent = values.municipality;
  $('#summary-national').textContent = values.national_tax;
  $('#summary-rate').textContent = `${values.simple_rate.replace('.', ',')}%`;
}

settingsForm.addEventListener('input', () => {
  settingsDirty = true;
  invalidate();
  $('#save-status').textContent = 'Alterações ainda não salvas.';
});
settingsForm.addEventListener('submit', async event => {
  event.preventDefault();
  const values = {}, selectors = {};
  for (const [key, value] of new FormData(settingsForm)) {
    if (key.startsWith('selector:')) { if (value.trim()) selectors[key.slice(9)] = value.trim(); }
    else values[key] = value.trim();
  }
  $('#save-settings').disabled = true;
  try {
    state.settings = await api('/api/settings', {values, selectors});
    settingsDirty = false;
    invalidate();
    renderSummarySettings();
    $('#save-status').textContent = 'Configurações salvas neste computador.';
    notice('Configurações salvas. Elas serão usadas nos próximos preenchimentos.', true);
  } catch (error) { notice(error.message); }
  finally { updateActions(); }
});

function renderReview(invoice) {
  const content = $('#review-content');
  content.replaceChildren();
  for (const step of invoice.steps) {
    const group = element('section', 'review-group');
    group.append(element('h3', '', step.label));
    const list = element('dl');
    for (const field of step.fields) {
      const row = element('div', 'review-row');
      row.append(element('dt', '', field.label), element('dd', '',
        field.key === 'competence' ? displayDate(field.value) : field.value));
      list.append(row);
    }
    group.append(list);
    content.append(group);
  }
  $('#review-details').hidden = false;
}

invoiceForm.addEventListener('submit', async event => {
  event.preventDefault();
  const data = inputData();
  prepareButton.disabled = true;
  try {
    if (settingsDirty) throw new Error('Salve as alterações em Configurações antes de preparar a nota.');
    const result = await api('/api/preview', data);
    if (settingsDirty || JSON.stringify(inputData()) !== JSON.stringify(data)) return;
    prepared = result;
    preparedInput = data;
    $('#preview-description').textContent = result.description;
    $('#preview-amount').textContent = currency.format(Number(result.amount));
    $('#preview-state').textContent = 'Preparada';
    $('#preview-state').classList.add('ready');
    $('#prepare-hint').textContent = 'Escolha a etapa que está aberta no portal. Confira os campos antes de avançar.';
    renderReview(result);
    renderSummarySettings(Object.fromEntries(result.steps.flatMap(step => step.fields.map(field => [field.key, field.value]))));
    $('#notice').hidden = true;
  } catch (error) { invalidate(); notice(error.message); }
  finally { updateActions(); }
});

async function copy(text) {
  try { await navigator.clipboard.writeText(text); notice('Copiado para a área de transferência.', true); }
  catch { notice('Não foi possível copiar automaticamente. Selecione o texto da prévia e copie manualmente.'); }
}
$('#copy-description').addEventListener('click', () => copy($('#preview-description').textContent));
$('#copy-all').addEventListener('click', () => {
  if (!prepared) return;
  copy(prepared.steps.map(step => `${step.label}\n` + step.fields.map(field =>
    `${field.label}: ${field.key === 'competence' ? displayDate(field.value) : field.value}`).join('\n')).join('\n\n'));
});

function renderStatus(status) {
  busy = status.busy;
  $('#automation-status').className = `automation-status ${status.status}`;
  $('#status-message').textContent = status.message;
  $('#completed-fields').replaceChildren(...status.completed.map(label => element('li', '', label)));
  $('#completed-fields').hidden = !status.completed.length;
  diagnostics = status.diagnostics || null;
  $('#download-diagnostics').hidden = !diagnostics;
  updateActions();
}
$('#open-portal').addEventListener('click', async () => {
  busy = true;
  updateActions();
  try { renderStatus(await api('/api/browser/open', {})); }
  catch (error) { busy = false; notice(error.message); updateActions(); }
});
$('#inspect-portal').addEventListener('click', async () => {
  busy = true;
  updateActions();
  try { renderStatus(await api('/api/browser/inspect', {})); }
  catch (error) { busy = false; notice(error.message); updateActions(); }
});
$('#download-diagnostics').addEventListener('click', () => {
  if (!diagnostics) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(diagnostics, null, 2)], {type: 'application/json'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'nfse-campos.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.querySelectorAll('[data-step]').forEach(button => {
  button.addEventListener('click', async () => {
    if (!prepared || !preparedInput) return;
    busy = true;
    updateActions();
    try { renderStatus(await api('/api/browser/fill', {step: button.dataset.step,
      invoice: preparedInput, settings_signature: prepared.settings_signature})); }
    catch (error) { busy = false; notice(error.message); updateActions(); }
  });
});

async function poll() {
  try { renderStatus(await api('/api/status')); }
  catch (error) {
    $('#status-message').textContent = error.message;
    $('#automation-status').className = 'automation-status error';
  }
  setTimeout(poll, busy ? 800 : 3000);
}

async function init() {
  prepareButton.disabled = true;
  $('#save-settings').disabled = true;
  // Data local, sem deslocar o dia pelo fuso horário do UTC.
  const now = new Date();
  $('#competence').value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  try {
    state = await api('/api/state');
    renderSettings();
    renderStatus(state.automation);
    livePreview();
    poll();
  } catch (error) { notice(error.message); }
}
init();
