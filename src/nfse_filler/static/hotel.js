'use strict';

let hotelBusy = false;
let hotelResult = null;
let hotelDiagnostics = null;
let hotelStatusId = -1;
let hotelLastStatus = '';
let hotelPendingLookupId = null;
let hotelLookupSnapshot = null;

function applyHotelStay() {
  if (!hotelResult || hotelBusy || busy) return;
  const data = window.NFSeHotelForm.mergeStay(inputData(), hotelResult,
    document.getElementById('hotel-keep-document').checked);
  for (const [key, value] of Object.entries(data)) {
    if (invoiceForm.elements[key]) invoiceForm.elements[key].value = value;
  }
  invalidate();
  livePreview();
  document.getElementById('hotel-status').textContent = 'Nome e CPF do titular importados quando disponíveis. Todos os campos continuam editáveis.';
}

function hotelActions() {
  for (const id of ['hotel-open', 'hotel-inspect', 'hotel-search', 'hotel-save']) {
    document.getElementById(id).disabled = hotelBusy;
  }
  document.getElementById('hotel-apply').disabled = hotelBusy || busy || !hotelResult;
}

function hotelStatus(status) {
  hotelBusy = status.busy;
  document.getElementById('hotel-status').textContent = status.message;
  const signature = `${status.id}:${status.status}`;
  if (signature !== hotelLastStatus || status.id !== hotelStatusId) {
    hotelStatusId = status.id;
    hotelLastStatus = signature;
    hotelDiagnostics = status.diagnostics;
    document.getElementById('hotel-download').hidden = !hotelDiagnostics;
    hotelResult = status.result;
    document.getElementById('hotel-preview').hidden = !hotelResult;
    if (hotelResult) {
      const rows = [['Quarto', hotelResult.room], ['Hóspede', hotelResult.guest_name],
        ['Check-in', hotelResult.check_in], ['Check-out', hotelResult.check_out],
        ['Subtotal de diárias', `R$ ${hotelResult.service_value}`],
        ['CPF/CNPJ sugerido', hotelResult.customer_document || 'Informe manualmente']];
      const list = document.getElementById('hotel-details');
      list.replaceChildren(...rows.map(([label, value]) => {
        const row = document.createElement('div');
        row.append(element('dt', '', label), element('dd', '', value));
        return row;
      }));
    }
  }
  if (status.id === hotelPendingLookupId && status.status === 'done' && !status.busy) {
    if (window.NFSeHotelForm.shouldAutoApply(status, hotelPendingLookupId, hotelLookupSnapshot, inputData(), busy)) {
      applyHotelStay();
    } else {
      document.getElementById('hotel-status').textContent = 'Consulta concluída. O formulário mudou durante a busca; confira a prévia e clique em Aplicar ao formulário.';
    }
    hotelPendingLookupId = null;
  } else if (status.id === hotelPendingLookupId && status.status === 'error') {
    hotelPendingLookupId = null;
  }
  hotelActions();
}

async function hotelAction(action, data = {}) {
  const snapshot = action === 'lookup' ? JSON.stringify(inputData()) : null;
  hotelBusy = true;
  hotelActions();
  try {
    const status = await api(`/api/desbravador/${action}`, data);
    if (action === 'lookup') {
      hotelPendingLookupId = status.id;
      hotelLookupSnapshot = snapshot;
    }
    hotelStatus(status);
  }
  catch (error) {
    hotelBusy = false;
    document.getElementById('hotel-status').textContent = error.message;
    hotelActions();
  }
}
document.getElementById('hotel-open').addEventListener('click', () => hotelAction('open'));
document.getElementById('hotel-inspect').addEventListener('click', () => hotelAction('inspect'));
document.getElementById('hotel-lookup').addEventListener('submit', event => {
  event.preventDefault();
  const room = document.getElementById('hotel-room').value.trim();
  if (!room) {
    document.getElementById('hotel-status').textContent = 'Informe o quarto apenas quando quiser fazer uma consulta.';
    return;
  }
  hotelAction('lookup', {room});
});
document.getElementById('hotel-download').addEventListener('click', () => {
  if (!hotelDiagnostics) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(hotelDiagnostics, null, 2)], {type: 'application/json'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'desbravador-estrutura.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.getElementById('hotel-apply').addEventListener('click', () => {
  applyHotelStay();
});
document.getElementById('hotel-config').addEventListener('submit', async event => {
  event.preventDefault();
  const data = new FormData(event.target);
  const config = {login_url: data.get('login_url'), selectors: {}};
  for (const [name, value] of data) {
    if (name !== 'login_url') config.selectors[name] = value;
  }
  try {
    await api('/api/desbravador/config', config);
    document.getElementById('hotel-status').textContent = 'Mapeamento salvo para as próximas consultas.';
  } catch (error) { document.getElementById('hotel-status').textContent = error.message; }
});

async function pollHotel() {
  try { hotelStatus(await api('/api/desbravador/status')); }
  catch (error) { document.getElementById('hotel-status').textContent = error.message; }
  setTimeout(pollHotel, hotelBusy ? 800 : 3000);
}
async function initHotel() {
  try {
    const {config, mapping_fields: fields} = await api('/api/desbravador/config');
    document.getElementById('hotel-login-url').value = config.login_url;
    const mapping = document.getElementById('hotel-mapping');
    for (const [key, title] of Object.entries(fields)) {
      const label = element('label', '', title);
      const input = document.createElement('input');
      input.name = key;
      input.maxLength = 500;
      input.value = config.selectors[key];
      input.placeholder = key === 'room_card' ? 'Ex.: [data-uh="{room}"]' : 'Seletor CSS identificado na tela';
      input.spellcheck = false;
      label.append(input);
      mapping.append(label);
    }
  } catch (error) { document.getElementById('hotel-status').textContent = error.message; }
  pollHotel();
}
initHotel();
