/* Leitura da tela carregada. Não chama API de alteração, fechamento ou lançamento. */
const [action, selectors, requestedRoom] = arguments;
const expectedOrigin = arguments[3] || 'https://desbravadorweb.com.br';
if (location.origin !== expectedOrigin) return {status: 'wrong_page'};
const visible = el => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
const content = document.querySelector('#conteudo-ajax');
if (!content || !content.children.length) return {status: 'empty'};
if (Number(window.jQuery?.active || 0) > 0) return {status: 'loading'};
const structure = el => ({tag: el.tagName.toLowerCase(), id: el.getAttribute('id') || '', classes: el.getAttribute('class') || '',
  name: el.getAttribute('name'), type: el.getAttribute('type'), visible: visible(el),
  attributes: Array.from(el.attributes).map(a => a.name).filter(name => name.startsWith('data-')),
  room_attributes: Object.fromEntries(['data-uh', 'data-quarto'].filter(name => /^[0-9]{1,5}[A-Za-z]?$/.test(el.getAttribute(name) || '')).map(name => [name, el.getAttribute(name)])),
  selector: el.getAttribute('id') ? `#${CSS.escape(el.getAttribute('id'))}` : null});
if (action === 'inspect') {
  const cleanLabel = el => {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('input, select, textarea, option, script, button, style').forEach(child => child.remove());
    return clone.textContent.replace(/\s+/g, ' ').trim().slice(0, 160);
  };
  return {status: 'inspected', path: location.pathname, route: location.hash.split('?')[0],
    fields: Array.from(document.querySelectorAll('#conteudo-ajax input:not([type=hidden]):not([type=password]), #conteudo-ajax select, #conteudo-ajax textarea, .modal input:not([type=hidden]):not([type=password]), .modal select, .modal textarea'))
      .map(el => ({...structure(el), labels: Array.from(el.labels || []).map(cleanLabel)})),
    elements: Array.from(document.querySelectorAll('#conteudo-ajax [id], #conteudo-ajax [data-uh], #conteudo-ajax [data-quarto], #conteudo-ajax [data-hospedagem], #conteudo-ajax [data-field], .modal [id]')).slice(0, 1500).map(structure),
    headers: Array.from(content.querySelectorAll('thead th')).map(cleanLabel)};
}
const canonicalRoom = NFSeDesbravadorData.canonicalRoom;
const read = el => el.matches('input, textarea') ? el.value.trim()
  : el.tagName === 'SELECT' ? (el.selectedOptions[0]?.textContent || '').trim() : el.textContent.trim();
try {
  const scopes = Array.from(document.querySelectorAll(selectors.scope || '#conteudo-ajax')).filter(visible);
  if (scopes.length > 1) return {status: 'ambiguous'};
  const scope = scopes[0];
  const hiddenRoom = selectors.room === '#hospedagemForm-uhSelecionada-abreviatura';
  const rooms = scope ? Array.from(scope.querySelectorAll(selectors.room)).filter(el => hiddenRoom || visible(el)) : [];
  if (rooms.length > 1) return {status: 'ambiguous'};
  const matchingRoom = rooms.length === 1 && canonicalRoom(read(rooms[0])) === canonicalRoom(requestedRoom);
  if (action === 'locate') {
    if (matchingRoom) return {status: 'located'};
    // O extrato oferece um link de navegação para a edição, sem salvar nada.
    if (/^#\/extratoContaHospedagem\/[0-9]+\/?$/.test(location.hash)) {
      const edit = content.querySelector('#btn-editar-ocupacao');
      if (!edit || !visible(edit)) return {status: 'not_ready'};
      edit.click();
      return {status: 'located'};
    }
    if (!selectors.room_card || location.hash.split('?')[0].replace(/\/$/, '') !== '#/mapaUh') return {status: 'wrong_room'};
    const lightwebCards = selectors.room_card === '#mapa-uhs-conteudo .uh-main';
    let cards = Array.from(content.querySelectorAll(selectors.room_card.replaceAll('{room}', CSS.escape(requestedRoom)))).filter(visible);
    if (lightwebCards) {
      const hasNumber = root => [root, ...root.querySelectorAll('*')].some(el =>
        visible(el) && !el.children.length && canonicalRoom(el.textContent) === canonicalRoom(requestedRoom));
      const byIcon = cards.filter(card => card.querySelector('.uh-icon') && hasNumber(card.querySelector('.uh-icon')));
      cards = byIcon.length ? byIcon : cards.filter(hasNumber);
    }
    if (cards.length !== 1) return {status: cards.length ? 'ambiguous' : 'missing'};
    if (cards[0].matches('input, select, textarea, button, [type=submit]')) return {status: 'invalid_selector'};
    if (lightwebCards) {
      const internalId = cards[0].id.match(/^uh-main-([0-9]+)$/)?.[1];
      const edit = internalId && document.getElementById(`btn-alterar-ocupacao-${internalId}`);
      if (!edit || edit.classList.contains('desabilitado') || edit.classList.contains('disabled') || edit.getAttribute('aria-disabled') === 'true') return {status: 'missing'};
      // O ID interno do card não é o número do quarto. Só este link é acionado.
      edit.click();
    } else cards[0].click();
    return {status: 'located'};
  }
  if (!matchingRoom) return {status: rooms.length ? 'wrong_room' : 'not_ready'};
  const data = {room: read(rooms[0])};
  for (const key of ['guest_name', 'check_in', 'check_out', 'lodging_total', 'customer_document']) {
    if (!selectors[key] && key === 'customer_document') { data[key] = ''; continue; }
    const matches = Array.from(scope.querySelectorAll(selectors[key])).filter(visible);
    if (matches.length > 1) return {status: 'ambiguous', field: key};
    if (!matches.length || !read(matches[0])) {
      if (key === 'customer_document') data[key] = '';
      else return {status: 'not_ready', field: key};
    } else data[key] = read(matches[0]);
  }
  if (selectors.guest_name === '#hospedagemForm-titular') {
    const value = selector => scope.querySelector(selector)?.value || '';
    const guests = Array.from(scope.querySelectorAll('[id^="div-hospede-"]')).flatMap(container => {
      const index = container.id.match(/^div-hospede-([0-9]+)$/)?.[1];
      if (index === undefined) return [];
      const type = value(`#hospede-tipoDocumento-${index}`).toUpperCase();
      const cpf = value(`#hospedagemForm-fnrh-${index}-cpf`);
      return [{id: value(`#hospedagemForm-hospedagemHospede-${index}-pessoaFisica-id`),
        name: value(`#hospede-nome-${index}`) || value(`#hospedagemForm-hospedagemHospede-${index}-nome`) || value(`#hospedagemForm-fnrh-${index}-nome`),
        document: cpf || (!type || ['CPF', 'CNPJ'].includes(type) ? value(`#hospede-documento-${index}`) : '')}];
    });
    const holder = NFSeDesbravadorData.holderIdentity({id: value('#hospedagemForm-titular_input'), name: data.guest_name}, guests);
    data.guest_name = holder.name;
    if (!selectors.customer_document) data.customer_document = holder.document;
  }
  return {status: 'read', data};
} catch { return {status: 'invalid_selector'}; }
