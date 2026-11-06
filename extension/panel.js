const meta = window.NFSeExtensionMetadata;
const $ = selector => document.querySelector(selector);
const form = $('#invoice-form');
let settings = NFSeDomain.defaults();
let hotelConfig = NFSeDomain.hotelDefaults();
let prepared = null;
let hotelResult = null;
let diagnostics = null;
let hotelDiagnostics = null;
let busy = false;

function notice(message, ok = false) {
  $('#notice').hidden = !message;
  $('#notice').textContent = message || '';
  $('#notice').style.color = ok ? '#1b5147' : '';
}
function currentInput() { return Object.fromEntries(new FormData(form)); }
function actions() {
  document.querySelectorAll('[data-step]').forEach(button => button.disabled = !prepared || busy);
  $('#fill-all').disabled = !prepared || busy;
}
function invalidate() { prepared = null; $('#review').hidden = true; actions(); }
function row(label, value) {
  const line = document.createElement('div');
  const dt = document.createElement('dt'), dd = document.createElement('dd');
  dt.textContent = label; dd.textContent = value; line.append(dt, dd);
  return line;
}
function field(label, name, value, choices) {
  const container = document.createElement('label');
  container.textContent = label;
  const input = choices ? document.createElement('select') : document.createElement('input');
  input.name = name;
  if (choices) for (const choice of choices) {
    const option = document.createElement('option'); option.value = option.textContent = choice; input.append(option);
  }
  input.value = value || '';
  container.append(input);
  return container;
}
function renderSettings() {
  const destination = $('#settings-fields'); destination.replaceChildren();
  for (const [step, title] of Object.entries(meta.steps)) {
    const heading = document.createElement('h2'); heading.textContent = title; destination.append(heading);
    for (const item of meta.fields.filter(f => f.step === step)) destination.append(field(item.label, item.key, settings.values[item.key], item.choices));
  }
  const selectors = $('#selectors-fields'); selectors.replaceChildren();
  for (const item of [...meta.fields, ...meta.variable_fields]) selectors.append(field(`${meta.steps[item.step]} · ${item.label}`, item.key, settings.selectors[item.key] || ''));
  $('#hotel-config').elements.login_url.value = hotelConfig.login_url;
  const hotel = $('#hotel-fields'); hotel.replaceChildren();
  for (const [key, label] of Object.entries(meta.hotel_mapping_fields)) hotel.append(field(label, key, hotelConfig.selectors[key]));
}
async function send(type, values = {}) {
  const reply = await chrome.runtime.sendMessage({type, ...values});
  if (!reply?.ok) throw Error(reply?.error || 'O navegador não respondeu.');
  return reply.result;
}
function download(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'}));
  const link = document.createElement('a'); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function setView(name) {
  $('#note-view').hidden = name !== 'note'; $('#settings-view').hidden = name !== 'settings';
  $('#tab-note').classList.toggle('active', name === 'note'); $('#tab-settings').classList.toggle('active', name === 'settings');
}
$('#tab-note').onclick = () => setView('note');
$('#tab-settings').onclick = () => setView('settings');
for (const key of ['check_in', 'check_out']) {
  form.elements[key].addEventListener('input', event => {
    const input = event.target; const position = input.selectionStart;
    const before = window.NFSeDates.maskDate(input.value.slice(0, position));
    input.value = window.NFSeDates.maskDate(input.value); input.setSelectionRange(before.length, before.length);
  });
}
form.addEventListener('input', invalidate);
form.addEventListener('submit', event => {
  event.preventDefault();
  try {
    prepared = NFSeDomain.prepare(currentInput(), settings);
    $('#description').textContent = prepared.description;
    $('#amount').textContent = new Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'BRL'}).format(Number(prepared.amount));
    $('#review').hidden = false; actions(); notice('Nota preparada. Confira antes de preencher.', true);
  } catch (error) { notice(error.message); }
});
$('#lookup-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  const room = $('#room').value.trim();
  if (!room) { notice('Informe o quarto a consultar.'); return; }
  const snapshot = JSON.stringify(currentInput()); busy = true; actions();
  try {
    const raw = await send('lookup', {room, config: hotelConfig});
    hotelResult = NFSeDomain.stay(raw, room);
    $('#hotel-details').replaceChildren(...[
      ['Quarto', hotelResult.room], ['Titular', hotelResult.guest_name], ['CPF/CNPJ sugerido', hotelResult.customer_document || 'Informe manualmente'],
      ['Check-in', hotelResult.check_in], ['Check-out', hotelResult.check_out], ['Total de diárias', `R$ ${hotelResult.service_value}`]
    ].map(([label, value]) => row(label, value)));
    $('#hotel-preview').hidden = false;
    if (snapshot === JSON.stringify(currentInput())) applyHotel();
    else notice('Consulta concluída. Confira a prévia e aplique os dados.', true);
  } catch (error) { notice(error.message); }
  finally { busy = false; actions(); }
});
function applyHotel() {
  if (!hotelResult) return;
  const merged = window.NFSeHotelForm.mergeStay(currentInput(), hotelResult, $('#keep-document').checked);
  for (const [key, value] of Object.entries(merged)) if (form.elements[key]) form.elements[key].value = value;
  invalidate(); notice('Hospedagem importada. Nome e CPF/CNPJ continuam editáveis.', true);
}
$('#apply-hotel').onclick = applyHotel;
$('#open-hotel').onclick = async () => { try { await send('openHotel', {url: hotelConfig.login_url}); } catch (error) { notice(error.message); } };
$('#inspect-hotel').onclick = async () => {
  try { hotelDiagnostics = await send('inspectHotel', {config: hotelConfig}); $('#download-hotel').hidden = false; notice('Tela do Desbravador inspecionada.', true); }
  catch (error) { notice(error.message); }
};
$('#download-hotel').onclick = () => hotelDiagnostics && download('desbravador-estrutura.json', hotelDiagnostics);
$('#open-portal').onclick = async () => { try { await send('openPortal'); } catch (error) { notice(error.message); } };
$('#inspect').onclick = async () => {
  try { diagnostics = await send('inspect'); $('#download').hidden = false; notice('Campos inspecionados.', true); }
  catch (error) { notice(error.message); }
};
$('#download').onclick = () => diagnostics && download('nfse-campos.json', diagnostics);
document.querySelectorAll('[data-step]').forEach(button => button.onclick = async () => {
  if (!prepared || busy) return;
  busy = true; actions(); $('#status').textContent = `Preenchendo ${meta.steps[button.dataset.step]}…`;
  try {
    const result = await send('fill', {step: button.dataset.step, prepared, selectors: settings.selectors});
    $('#status').textContent = result.message;
    $('#completed').replaceChildren(...result.completed.map(label => { const li = document.createElement('li'); li.textContent = label; return li; }));
  } catch (error) { $('#status').textContent = error.message; }
  finally { busy = false; actions(); }
});
$('#fill-all').onclick = async () => {
  if (!prepared || busy) return;
  busy = true; actions(); $('#status').textContent = 'Iniciando preenchimento completo…';
  $('#completed').replaceChildren();
  try {
    const result = await send('fillAll', {prepared, selectors: settings.selectors});
    $('#status').textContent = result.message;
    $('#completed').replaceChildren(...result.completed.map(label => {
      const li = document.createElement('li'); li.textContent = label; return li;
    }));
  } catch (error) { $('#status').textContent = error.message; }
  finally { busy = false; actions(); }
};
chrome.runtime.onMessage.addListener(message => {
  if (message.type !== 'progress') return;
  $('#status').textContent = message.message;
  $('#completed').replaceChildren(...message.completed.map(label => { const li = document.createElement('li'); li.textContent = label; return li; }));
});
$('#settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const values = Object.fromEntries(meta.fields.map(f => [f.key, $('#settings-fields').querySelector(`[name="${f.key}"]`).value]));
    const selectors = Object.fromEntries([...meta.fields, ...meta.variable_fields].map(f => [f.key, $('#selectors-fields').querySelector(`[name="${f.key}"]`).value]));
    settings = NFSeDomain.settings({values, selectors});
    await chrome.storage.local.set({settings}); invalidate(); notice('Configurações salvas.', true);
  } catch (error) { notice(error.message); }
});
$('#hotel-config').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const all = Object.fromEntries(new FormData(event.target));
    const login_url = all.login_url; delete all.login_url;
    hotelConfig = NFSeDomain.hotelConfig({login_url, selectors: all});
    await chrome.storage.local.set({hotelConfig}); notice('Mapeamento salvo.', true);
  } catch (error) { notice(error.message); }
});
for (const [id, key, validator] of [['import-settings', 'settings', NFSeDomain.settings], ['import-hotel', 'hotelConfig', NFSeDomain.hotelConfig]]) {
  $(`#${id}`).addEventListener('change', async event => {
    try {
      const file = event.target.files[0]; if (!file) return;
      const value = validator(JSON.parse(await file.text()));
      await chrome.storage.local.set({[key]: value});
      if (key === 'settings') { settings = value; invalidate(); } else hotelConfig = value;
      renderSettings(); notice('Arquivo importado.', true);
    } catch (error) { notice(`Importação recusada: ${error.message}`); }
    finally { event.target.value = ''; }
  });
}
async function init() {
  const saved = await chrome.storage.local.get(['settings', 'hotelConfig']);
  try { if (saved.settings) settings = NFSeDomain.settings(saved.settings); } catch (error) { notice(error.message); }
  try { if (saved.hotelConfig) hotelConfig = NFSeDomain.hotelConfig(saved.hotelConfig); } catch (error) { notice(error.message); }
  const now = new Date();
  form.elements.competence.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  renderSettings(); actions();
}
init().catch(error => notice(error.message));
