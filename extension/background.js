const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true});
});

async function oneTab(pattern, label) {
  const tabs = await chrome.tabs.query({url: pattern});
  if (tabs.length !== 1) throw Error(`Deixe uma única aba ${label} aberta no Chrome.`);
  return tabs[0];
}

async function hotelPage(tabId, action, selectors, room) {
  await chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', files: ['runtime/hotel_page.js']});
  const [{result}] = await chrome.scripting.executeScript({target: {tabId}, world: 'MAIN',
    func: (a, s, r) => window.NFSeExtensionHotel.run(a, s, r), args: [action, selectors, room]});
  return result;
}

async function lookup(room, config) {
  if (typeof room !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 -]{0,19}$/.test(room.trim())) throw Error('Informe um quarto válido (até 20 caracteres).');
  if (!(await chrome.tabs.query({url: 'https://desbravadorweb.com.br/*'})).length) throw Error('Abra o Desbravador e faça login no Chrome atual.');
  const [previousTab] = await chrome.tabs.query({active: true, currentWindow: true});
  const tab = await chrome.tabs.create({url: 'https://desbravadorweb.com.br/#/mapaUh/', active: false});
  let activatedForMenu = false;
  try {
    const deadline = Date.now() + 30000;
    await pause(1000);
    let mapReady = false;
    let cardCount = 0;
    let stableAt = 0;
    while (Date.now() < deadline && !mapReady) {
      try {
        const state = await hotelPage(tab.id, 'map_status', config.selectors, room.trim());
        if (state?.status === 'map_ready') {
          if (state.cards !== cardCount) { cardCount = state.cards; stableAt = Date.now(); }
          else if (Date.now() - stableAt >= 750) mapReady = true;
        } else { cardCount = 0; stableAt = 0; }
      } catch (error) {
        if (error.message && !/Cannot access|No tab with id|frame|receiving end/i.test(error.message)) throw error;
      }
      if (!mapReady) await pause(250);
    }
    if (!mapReady) throw Error('O mapa de UH não terminou de carregar. Confira o login no Desbravador e tente novamente.');
    let located = false;
    let last = 'loading';
    let staleSince = 0;
    let reloadAt = 0;
    let lastField = '';
    while (Date.now() < deadline) {
      try {
        const result = await hotelPage(tab.id, located ? 'read' : 'locate', config.selectors, room.trim());
        last = result?.status || 'loading';
        if (last === 'located') located = true;
        else if (last === 'read') return result.data;
        else if (last === 'card_not_opened' && !activatedForMenu) {
          await chrome.tabs.update(tab.id, {active: true});
          activatedForMenu = true;
          await hotelPage(tab.id, 'reset_card', config.selectors, room.trim());
          await pause(500);
          last = 'opening_card';
        }
        else if (last === 'not_ready') {
          lastField = result.field || '';
          const staleEdit = located && /^#\/editarOcupacao\/[0-9]+\/?$/.test(result.route || '') && result.stale_map;
          if (staleEdit) {
            if (!staleSince) staleSince = Date.now();
            if (!reloadAt && Date.now() - staleSince >= 1500) {
              await chrome.tabs.reload(tab.id);
              reloadAt = Date.now();
            } else if (reloadAt && Date.now() - reloadAt >= 5000) {
              throw Error('A edição da hospedagem abriu, mas o Desbravador não carregou o formulário. Reabra o mapa de UH e tente novamente.');
            }
          } else staleSince = 0;
        }
        else if (!['loading', 'empty', 'not_ready', 'missing', 'opening_card', 'opening_statement'].includes(last)) {
          throw Error(({missing: 'Quarto não encontrado no mapa.', ambiguous: 'Mais de um quarto corresponde ao número informado.',
            wrong_room: 'A edição aberta não corresponde ao quarto solicitado.', wrong_page: 'Entre no Desbravador na aba atual.',
            invalid_selector: 'Mapeamento do Desbravador inválido.',
            card_not_opened: 'Não foi possível abrir o menu do quarto no mapa de UH.'})[last] || 'Não foi possível ler a hospedagem.');
        }
      } catch (error) {
        if (error.message && !/Cannot access|No tab with id|frame|receiving end/i.test(error.message)) throw error;
      }
      await pause(300);
    }
    if (last === 'missing') throw Error('Quarto não encontrado no mapa. Inspecione a tela para conferir o número exibido no card.');
    if (reloadAt && last === 'not_ready') throw Error('A edição da hospedagem não carregou após atualizar a página do Desbravador.');
    if (lastField && last === 'not_ready') throw Error(`O campo ${lastField} não carregou na edição da hospedagem. Confira o mapeamento.`);
    throw Error(`A consulta demorou demais (${last}). Confira o login e o mapa de UH.`);
  } finally {
    if (activatedForMenu && previousTab?.id) {
      const [currentTab] = await chrome.tabs.query({active: true, currentWindow: true}).catch(() => []);
      if (currentTab?.id === tab.id) await chrome.tabs.update(previousTab.id, {active: true}).catch(() => {});
    }
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function portalPage(tabId, action, payload) {
  await chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', files: ['runtime/portal_page.js']});
  const [{result}] = await chrome.scripting.executeScript({target: {tabId}, world: 'MAIN',
    func: async (a, p) => {
      const rt = window.NFSeExtensionPortal;
      if (a === 'inspect') return rt.inspect();
      const {field, selector, used, verify} = p;
      let result = rt.fill(field, selector, used, 'https://www.nfse.gov.br', false, verify ? 'verify' : undefined);
      if (result.status !== 'search') return result;
      const target = result.target;
      let search = result.input ? {status: 'input', input: result.input} : null;
      for (let i = 0; !search || search.status !== 'input'; i++) {
        if (i >= 25) break;
        search = rt.option(field.value, 'input', target, 'https://www.nfse.gov.br', field.key);
        if (search.status === 'input') break;
        if (i === 0 && result.opener) result.opener.click();
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      if (!search || search.status !== 'input') return {status: 'search_unavailable'};
      const query = field.key === 'municipality' ? String(field.value).replace(/\s*(?:\/|[-–]|\()\s*[A-Za-z]{2}\)?$/, '').trim() : field.value;
      const input = search.input;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, query);
      input.dispatchEvent(new Event('input', {bubbles: true}));
      input.dispatchEvent(new Event('keyup', {bubbles: true}));
      let option;
      for (let i = 0; i < 40; i++) {
        option = rt.option(field.value, 'option', target, 'https://www.nfse.gov.br', field.key);
        if (option.status !== 'option_missing') break;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      if (option.status !== 'option') return {status: option.status};
      option.option.click();
      const selected = rt.option(field.value, 'verify', target, 'https://www.nfse.gov.br', field.key);
      return {status: selected.status, target};
    }, args: [action, payload]});
  return result;
}

async function fill(step, prepared, selectors) {
  const tab = await oneTab('https://www.nfse.gov.br/EmissorNacional/DPS/*', 'da Emissão Completa');
  const url = new URL(tab.url);
  const routes = {people: 'pessoas', service: 'servico', values: 'tributacao'};
  if (!routes[step] || !url.pathname.toLowerCase().replace(/\/$/, '').endsWith(`/dps/${routes[step]}`)) throw Error('Abra a etapa correspondente no portal da NFS-e.');
  const fields = prepared.steps.find(item => item.key === step)?.fields;
  if (!fields) throw Error('Prepare a nota antes de preencher.');
  const completed = [], used = [];
  for (const field of fields) {
    const deadline = Date.now() + 30000;
    let written = false, stableAt = 0, target = null, last = 'not_ready';
    while (Date.now() < deadline) {
      const result = await portalPage(tab.id, 'field', {field, selector: selectors[field.key] || '', used: written ? [] : used, verify: written});
      last = result.status;
      if (!written && last === 'filled') { written = true; stableAt = 0; await pause(600); continue; }
      if (written && last === 'confirmed') {
        if (result.target !== target) { target = result.target; stableAt = Date.now(); }
        if (Date.now() - stableAt >= 600) break;
      } else if (written && last === 'rejected') { written = false; stableAt = 0; }
      else if (!['missing', 'not_ready', 'option_missing', 'search_unavailable', 'rejected', 'filled'].includes(last)) break;
      await pause(200);
    }
    if (last !== 'confirmed') throw Error(`${field.label}: campo não confirmado (${last}). Os campos anteriores permanecem preenchidos.`);
    used.push(target);
    completed.push(field.label);
    chrome.runtime.sendMessage({type: 'progress', completed, message: `Confirmado: ${field.label}`}).catch(() => {});
  }
  return {completed, message: `Etapa ${prepared.steps.find(item => item.key === step).label} preenchida. Confira e avance no portal.`};
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  (async () => {
    if (message.type === 'lookup') return lookup(message.room, message.config);
    if (message.type === 'fill') return fill(message.step, message.prepared, message.selectors);
    if (message.type === 'inspect') {
      const tab = await oneTab('https://www.nfse.gov.br/EmissorNacional/DPS/*', 'da Emissão Completa');
      return portalPage(tab.id, 'inspect');
    }
    if (message.type === 'inspectHotel') {
      const tabs = await chrome.tabs.query({url: 'https://desbravadorweb.com.br/*'});
      if (!tabs.length) throw Error('Abra o Desbravador no Chrome antes de inspecionar.');
      const tab = tabs.find(item => item.active) || tabs[0];
      return hotelPage(tab.id, 'inspect', message.config.selectors, '');
    }
    if (message.type === 'openPortal') return chrome.tabs.create({url: 'https://www.nfse.gov.br/EmissorNacional/DPS/Pessoas'});
    if (message.type === 'openHotel') return chrome.tabs.create({url: message.url});
    throw Error('Ação desconhecida.');
  })().then(result => respond({ok: true, result}), error => respond({ok: false, error: error.message || 'Falha no navegador.'}));
  return true;
});
