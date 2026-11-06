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
      if (a === 'route') return {status: document.readyState === 'complete' ? 'ready' : 'loading', path: location.pathname};
      if (a === 'advance') {
        const path = location.pathname.toLowerCase().replace(/\/$/, '');
        const currentValid = (p.current === 'pessoas' && (path.endsWith('/dps/pessoas') || path.endsWith('/dps/people'))) ||
          (p.current === 'servico' && (path.endsWith('/dps/servico') || path.endsWith('/dps/service'))) ||
          (p.current === 'tributacao' && (path.endsWith('/dps/tributacao') || path.endsWith('/dps/valores')));
        if (!currentValid) return {status: 'wrong_step', path: location.pathname};

        const visible = el => !!(el.getClientRects().length) &&
          getComputedStyle(el).visibility !== 'hidden' &&
          getComputedStyle(el).display !== 'none';

        const loader = document.querySelector('#modalLoading');
        if (document.readyState !== 'complete' || Number(window.jQuery?.active || 0) > 0 ||
            (loader && visible(loader))) return {status: 'loading'};

        const normalizeText = str => String(str || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .trim();

        const isNegativeText = text => /\b(voltar|anterior|cancelar|limpar|pesquisar|consultar|excluir|remover|fechar|ajuda)\b/i.test(text);

        const isAdvanceCandidate = el => {
          const text = normalizeText(el.innerText || el.textContent || el.value || el.getAttribute('value') || el.getAttribute('title') || el.getAttribute('aria-label'));
          if (isNegativeText(text)) return false;
          const id = normalizeText(el.id);
          const name = normalizeText(el.name);
          if (/avanc|pross|prox/i.test(id) || /avanc|pross|prox/i.test(name)) return true;
          if (/\b(avancar|avanca|prosseguir|proximo|proxima|continuar)\b/i.test(text) || /avanc/i.test(text)) return true;
          return false;
        };

        const buttonSelectors = [
          '#btnAvancar',
          '[id*="avancar" i]',
          '[id*="avanca" i]',
          '[name*="avancar" i]',
          '[name*="avanca" i]',
          'button[type="submit"]',
          'input[type="submit"]',
          'button',
          'input[type="button"]',
          'a.btn',
          'a[role="button"]',
          '[role="button"]',
          'a'
        ];

        const allCandidates = Array.from(document.querySelectorAll(buttonSelectors.join(',')))
          .filter(visible);

        const advanceMatches = allCandidates.filter(isAdvanceCandidate);

        let button = null;
        if (advanceMatches.length) {
          button = advanceMatches.find(el => /avanc/i.test(el.id)) ||
                   advanceMatches.find(el => el.type === 'submit' && el.closest('form')) ||
                   advanceMatches.find(el => el.type === 'submit') ||
                   advanceMatches.find(el => el.classList.contains('btn-primary')) ||
                   advanceMatches[0];
        }

        if (!button) {
          const form = document.querySelector('form#formDPS, form[action*="DPS" i], form');
          if (form) {
            const formSubmits = Array.from(form.querySelectorAll('button[type="submit"], input[type="submit"], button.btn-primary'))
              .filter(visible)
              .filter(el => {
                const text = normalizeText(el.innerText || el.textContent || el.value || '');
                return !isNegativeText(text);
              });
            if (formSubmits.length) {
              button = formSubmits[formSubmits.length - 1];
            }
          }
        }

        if (!button) {
          const available = Array.from(document.querySelectorAll('button, input[type=submit], input[type=button], a.btn'))
            .filter(visible)
            .map(b => ({
              tag: b.tagName.toLowerCase(),
              id: b.id || '',
              name: b.name || '',
              type: b.type || '',
              text: (b.innerText || b.textContent || b.value || '').trim().slice(0, 40)
            }));
          return {status: 'missing', available_buttons: available};
        }

        if (button.disabled || button.getAttribute('aria-disabled') === 'true' || button.classList.contains('disabled')) {
          return {status: 'disabled'};
        }

        button.scrollIntoView({block: 'center', inline: 'center'});
        button.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, cancelable: true, view: window}));
        button.dispatchEvent(new MouseEvent('mouseup', {bubbles: true, cancelable: true, view: window}));
        button.click();
        if (window.jQuery) {
          window.jQuery(button).trigger('click');
        }
        return {status: 'advancing'};
      }
      if (a === 'native_prepare') {
        const {field, selector, used} = p;
        const visible = element => !!element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
        const loader = document.querySelector('#modalLoading');
        if (document.readyState !== 'complete' || Number(window.jQuery?.active || 0) > 0 ||
            (loader && visible(loader))) return {status: 'not_ready'};

        const verification = rt.fill(field, selector, used, 'https://www.nfse.gov.br', false, 'verify');
        if (verification.status === 'confirmed') return {status: 'confirmed', target: verification.target};

        const mapping = selector || field.portal_selector;
        let mapped;
        try { mapped = Array.from(document.querySelectorAll(mapping)); }
        catch { return {status: 'invalid_selector'}; }
        if (!mapped.length) return {status: 'missing'};

        const point = element => {
          element.scrollIntoView({block: 'nearest', inline: 'nearest'});
          const rect = element.getBoundingClientRect();
          return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
        };

        const target = mapped.find(element => element.dataset.nfseTarget === verification.target) || mapped[0];

        if (target.type === 'radio') {
          const radios = target.name ? mapped.filter(element => element.type === 'radio' && element.name === target.name) : mapped;
          const matches = radios.filter(radio => {
            const label = radio.closest('label') || Array.from(radio.labels || [])[0];
            return rt.matches(label?.textContent || radio.getAttribute('aria-label') || radio.value, field.value, field.key) ||
              String(radio.value) === String(field.value);
          });
          if (matches.length !== 1) return {status: matches.length ? 'ambiguous' : 'option_missing'};
          const radio = matches[0];
          if (radio.disabled) return radio.checked ? {status: 'confirmed', target: verification.target} : {status: 'not_ready'};
          const hit = visible(radio) ? radio : radio.closest('label');
          if (!hit || !visible(hit)) return {status: 'not_ready'};
          return {status: 'ready', kind: 'click', target: verification.target, ...point(hit)};
        }

        if (mapped.length !== 1) return {status: 'ambiguous'};
        if (target.disabled || target.readOnly) return {status: 'not_ready'};

        if (target.tagName === 'SELECT') {
          const options = Array.from(target.options).filter(option => !option.disabled &&
            (rt.matches(option.textContent, field.value, field.key) ||
             rt.matches(option.value, field.value, field.key) ||
             String(option.value) === String(field.value)));
          if (options.length === 1) {
            target.value = options[0].value;
            target.dispatchEvent(new Event('input', {bubbles: true}));
            target.dispatchEvent(new Event('change', {bubbles: true}));
            if (typeof target.onchange === 'function') target.onchange();
            if (window.jQuery) {
              window.jQuery(target).trigger('change');
              window.jQuery(target).trigger('chosen:updated');
            }
            if (!target.dataset.nfseTarget) target.dataset.nfseTarget = verification.target || crypto.randomUUID();
            target.dataset.nfseExpectedValue = String(field.value);
            target.dataset.nfseSelectedValue = target.value;
            return {status: 'filled', target: target.dataset.nfseTarget};
          }
          if (options.length > 1) return {status: 'ambiguous'};

          const widget = target.nextElementSibling?.matches('.select2-container, .chosen-container, .selectize-control, .ts-wrapper')
            ? target.nextElementSibling
            : (target.id ? document.getElementById(`${target.id}_chosen`) || document.getElementById(`s2id_${target.id}`) : null);
          const opener = widget?.querySelector('.select2-selection, .select2-choice, .chosen-single, .chosen-choices, .selectize-input, .ts-control') || widget;
          if (opener && visible(opener)) {
            if (!target.dataset.nfseTarget) target.dataset.nfseTarget = verification.target || crypto.randomUUID();
            return {status: 'ready', kind: 'search_select', target: target.dataset.nfseTarget,
              initialValue: target.value, ...point(opener)};
          }
          if (!visible(target)) return {status: 'not_ready'};
          return {status: 'option_missing'};
        }

        if (!target.matches('input:not([type=hidden]), textarea') || !visible(target)) return {status: 'unsupported'};

        let value = String(field.value);
        if (field.key === 'competence' && target.type !== 'date') value = value.split('-').reverse().join('/');
        if (field.key === 'customer_document') value = value.replace(/[.\-/\s]/g, '').toUpperCase();
        return {status: 'ready', kind: 'text', target: verification.target, value, ...point(target)};
      }
      if (a === 'native_search_state') {
        const visible = element => !!element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
        const point = element => {
          element.scrollIntoView({block: 'nearest', inline: 'nearest'});
          const rect = element.getBoundingClientRect();
          return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
        };
        const options = Array.from(document.querySelectorAll(
          '.select2-results__option[role=option], .select2-results__option[role=treeitem], .select2-result-selectable, [role=listbox] [role=option], .ui-menu-item, .chosen-with-drop .chosen-results .active-result, .chosen-container-active .chosen-results .active-result, .selectize-dropdown [data-selectable], .ts-dropdown [data-selectable]'
        )).filter(element => visible(element) && element.getAttribute('aria-disabled') !== 'true' &&
          rt.matches(element.textContent, p.field.value, p.field.key));
        if (options.length === 1) return {status: 'option', ...point(options[0])};
        if (options.length > 1) return {status: 'ambiguous'};
        const inputs = Array.from(document.querySelectorAll(
          '.select2-container--open .select2-search__field, .select2-drop-active .select2-input, .chosen-with-drop .chosen-search input, .chosen-container-active .chosen-search input, .selectize-control .input-active input, .ts-wrapper.dropdown-active .ts-control input'
        )).filter(visible);
        if (inputs.length === 1) return {status: 'input', ...point(inputs[0])};
        return {status: inputs.length ? 'ambiguous' : 'not_ready'};
      }
      if (a === 'native_verify') {
        const result = rt.fill(p.field, p.selector, [], 'https://www.nfse.gov.br', false, 'verify');
        if (result.status === 'confirmed') return result;
        const selectedTarget = result.target && Array.from(document.querySelectorAll('[data-nfse-target]'))
          .find(element => element.dataset.nfseTarget === result.target);
        if (result.status === 'rejected' && selectedTarget?.tagName === 'SELECT' &&
            selectedTarget.dataset.nfseExpectedValue === String(p.field.value) &&
            selectedTarget.dataset.nfseSelectedValue &&
            selectedTarget.value === selectedTarget.dataset.nfseSelectedValue) {
          return {status: 'confirmed', target: result.target};
        }
        return result;
      }
      if (a === 'native_capture_select') {
        const selectedTarget = Array.from(document.querySelectorAll('[data-nfse-target]'))
          .find(element => element.dataset.nfseTarget === p.target);
        if (!selectedTarget || selectedTarget.tagName !== 'SELECT' || !selectedTarget.value) return {status: 'not_ready'};
        if (p.expectedOptionValue !== undefined && selectedTarget.value !== p.expectedOptionValue) return {status: 'not_ready'};
        if (p.initialValue !== undefined && selectedTarget.value === p.initialValue) {
          const verified = rt.fill(p.field, p.field.portal_selector, [], 'https://www.nfse.gov.br', false, 'verify');
          if (verified.status !== 'confirmed') return {status: 'not_ready'};
        }
        selectedTarget.dataset.nfseExpectedValue = String(p.field.value);
        selectedTarget.dataset.nfseSelectedValue = selectedTarget.value;
        selectedTarget.dispatchEvent(new Event('input', {bubbles: true}));
        selectedTarget.dispatchEvent(new Event('change', {bubbles: true}));
        if (typeof selectedTarget.onchange === 'function') selectedTarget.onchange();
        if (window.jQuery) {
          window.jQuery(selectedTarget).trigger('change');
          window.jQuery(selectedTarget).trigger('chosen:updated');
        }
        return {status: 'filled', target: p.target};
      }
      return {status: 'unknown_action'};
    }, args: [action, payload ?? null]});
  return result;
}

const PORTAL_ROUTES = {people: 'pessoas', service: 'servico', values: 'tributacao'};

function onStep(path, step) {
  if (typeof path !== 'string') return false;
  const p = path.toLowerCase().replace(/\/$/, '');
  if (step === 'people') return p.endsWith('/dps/pessoas') || p.endsWith('/dps/people');
  if (step === 'service') return p.endsWith('/dps/servico') || p.endsWith('/dps/service');
  if (step === 'values') return p.endsWith('/dps/tributacao') || p.endsWith('/dps/valores') || p.endsWith('/dps/values');
  return false;
}

async function debuggerCommand(target, method, params = {}) {
  return chrome.debugger.sendCommand(target, method, params);
}

function keyDetails(character) {
  const upper = character.toUpperCase();
  const punctuation = {
    ' ': ['Space', 32], '/': ['Slash', 191], ',': ['Comma', 188], '.': ['Period', 190],
    '-': ['Minus', 189], ':': ['Semicolon', 186], '(': ['Digit9', 57], ')': ['Digit0', 48],
  };
  const [punctuationCode, punctuationKeyCode] = punctuation[character] || ['Unidentified', 0];
  return {
    key: character,
    code: /^[0-9]$/.test(character) ? `Digit${character}` :
      (/^[A-Za-z]$/.test(character) ? `Key${upper}` : punctuationCode),
    windowsVirtualKeyCode: /^[A-Za-z0-9]$/.test(character) ? upper.charCodeAt(0) : punctuationKeyCode,
    nativeVirtualKeyCode: /^[A-Za-z0-9]$/.test(character) ? upper.charCodeAt(0) : punctuationKeyCode,
  };
}

async function nativeClick(target, x, y) {
  await debuggerCommand(target, 'Input.dispatchMouseEvent', {type: 'mouseMoved', x, y});
  await debuggerCommand(target, 'Input.dispatchMouseEvent', {type: 'mousePressed', x, y,
      button: 'left', buttons: 1, clickCount: 1});
  await debuggerCommand(target, 'Input.dispatchMouseEvent', {type: 'mouseReleased', x, y,
      button: 'left', buttons: 0, clickCount: 1});
}

async function nativePress(target, key, code, keyCode, modifiers = 0) {
  await debuggerCommand(target, 'Input.dispatchKeyEvent', {type: 'rawKeyDown', key, code, modifiers,
    windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode});
  await debuggerCommand(target, 'Input.dispatchKeyEvent', {type: 'keyUp', key, code, modifiers,
    windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode});
}

async function nativeReplaceText(target, value, blur = true) {
  await debuggerCommand(target, 'Input.dispatchKeyEvent', {type: 'rawKeyDown', key: 'Control', code: 'ControlLeft',
    modifiers: 2, windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17});
  await nativePress(target, 'a', 'KeyA', 65, 2);
  await debuggerCommand(target, 'Input.dispatchKeyEvent', {type: 'keyUp', key: 'Control', code: 'ControlLeft',
    modifiers: 0, windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17});
  await nativePress(target, 'Backspace', 'Backspace', 8);
  for (const character of String(value)) {
    const details = keyDetails(character);
    await debuggerCommand(target, 'Input.dispatchKeyEvent', {type: 'rawKeyDown', ...details});
    await debuggerCommand(target, 'Input.dispatchKeyEvent', {type: 'char', ...details,
      text: character, unmodifiedText: character});
    await debuggerCommand(target, 'Input.dispatchKeyEvent', {type: 'keyUp', ...details});
    await pause(35);
  }
  if (blur) await nativePress(target, 'Tab', 'Tab', 9);
}

async function nativeFillField(tab, debugTarget, field, selector, used) {
  const prepared = await portalPage(tab.id, 'native_prepare', {field, selector, used});
  if (prepared?.status === 'confirmed') return prepared;
  if (prepared?.status !== 'ready') return {status: prepared?.status || 'not_ready', target: prepared?.target || null};
  await nativeClick(debugTarget, prepared.x, prepared.y);
  if (prepared.kind === 'text') {
    await nativeReplaceText(debugTarget, prepared.value);
    await pause(300);
    return {status: 'filled', target: prepared.target};
  }
  if (prepared.kind === 'click') {
    await pause(300);
    return {status: 'filled', target: prepared.target};
  }
  if (prepared.kind !== 'search_select') return {status: 'unsupported', target: prepared.target};
  let searchState = {status: 'not_ready'};
  const openDeadline = Date.now() + 5000;
  while (Date.now() < openDeadline) {
    searchState = await portalPage(tab.id, 'native_search_state', {field});
    if (['input', 'option', 'ambiguous'].includes(searchState.status)) break;
    await pause(150);
  }
  if (searchState.status === 'ambiguous') return searchState;
  if (searchState.status === 'input') {
    await nativeClick(debugTarget, searchState.x, searchState.y);
    let query = String(field.value).trim();
    if (field.key === 'municipality') {
      query = query.replace(/\s*(?:\/|[-–]|\()\s*[A-Za-z]{2}\)?$/, '').trim();
    } else if (field.key === 'nbs' && /^\d{9}$/.test(query)) {
      query = `${query[0]}.${query.slice(1, 5)}.${query.slice(5, 7)}.${query.slice(7)}`;
    } else if (field.key === 'national_tax' && /^\d{6}$/.test(query)) {
      query = `${query.slice(0, 2)}.${query.slice(2, 4)}.${query.slice(4)}`;
    }
    await nativeReplaceText(debugTarget, query, false);
  }
  const optionDeadline = Date.now() + 10000;
  while (searchState.status !== 'option' && Date.now() < optionDeadline) {
    await pause(180);
    searchState = await portalPage(tab.id, 'native_search_state', {field});
    if (searchState.status === 'ambiguous') return searchState;
  }
  if (searchState.status !== 'option') return {status: 'option_missing', target: prepared.target};
  await nativeClick(debugTarget, searchState.x, searchState.y);
  const selectionDeadline = Date.now() + 5000;
  let captured = {status: 'not_ready'};
  while (Date.now() < selectionDeadline) {
    await pause(180);
    captured = await portalPage(tab.id, 'native_capture_select', {field, target: prepared.target,
      initialValue: prepared.initialValue});
    if (captured.status === 'filled') return captured;
  }
  return captured;
}

async function fillFields(tab, step, prepared, selectors, progressPrefix = '', previousCompleted = []) {
  const url = new URL(tab.url);
  if (!PORTAL_ROUTES[step] || !onStep(url.pathname, step)) {
    throw Error(`Abra a etapa ${prepared.steps.find(item => item.key === step)?.label || ''} no portal da NFS-e.`);
  }
  const fields = prepared.steps.find(item => item.key === step)?.fields;
  if (!fields) throw Error('Prepare a nota antes de preencher.');
  const completed = [], used = [];
  const debugTarget = {tabId: tab.id};
  let attached = false;
  try {
    await chrome.debugger.attach(debugTarget, '1.3');
    attached = true;
    await pause(200);
    for (const field of fields) {
      const deadline = Date.now() + 30000;
      let written = false, stableAt = 0, target = null, last = 'not_ready';
      while (Date.now() < deadline) {
        const result = written
          ? await portalPage(tab.id, 'native_verify', {field, selector: selectors[field.key] || ''})
          : await nativeFillField(tab, debugTarget, field, selectors[field.key] || '', used);
        last = result.status;
        if (!written && last === 'filled') {
          written = true;
          target = result.target;
          stableAt = 0;
          await pause(600);
          continue;
        }
        if (!written && last === 'confirmed') {
          written = true;
          target = result.target;
          stableAt = Date.now();
        } else if (written && last === 'confirmed') {
          if (result.target !== target) { target = result.target; stableAt = Date.now(); }
          if (Date.now() - stableAt >= 600) break;
        } else if (written && last === 'rejected') {
          written = false;
          stableAt = 0;
        } else if (!['missing', 'not_ready', 'option_missing', 'search_unavailable', 'rejected', 'filled'].includes(last)) {
          break;
        }
        await pause(200);
      }
      if (last !== 'confirmed') throw Error(`${field.label}: campo não confirmado (${last}). Os campos anteriores permanecem preenchidos.`);
      used.push(target);
      completed.push(field.label);
      chrome.runtime.sendMessage({
        type: 'progress',
        completed: [...previousCompleted, ...completed.map(label => `${progressPrefix}${label}`)],
        message: `Confirmado: ${field.label}`
      }).catch(() => {});
    }
  } catch (error) {
    if (/Another debugger is already attached|Cannot attach|target is being closed/i.test(error.message || '')) {
      throw Error('Não foi possível controlar a aba da NFS-e com entrada nativa. Feche o DevTools dessa aba e tente novamente.');
    }
    throw error;
  } finally {
    if (attached) await chrome.debugger.detach(debugTarget).catch(() => {});
  }
  return completed;
}

async function fill(step, prepared, selectors) {
  const tab = await oneTab('https://www.nfse.gov.br/EmissorNacional/DPS/*', 'da Emissão Completa');
  const completed = await fillFields(tab, step, prepared, selectors);
  return {completed, message: `Etapa ${prepared.steps.find(item => item.key === step).label} preenchida. Confira e avance no portal.`};
}

async function advance(tab, currentStep, nextStep) {
  const currentLabel = currentStep === 'people' ? 'Pessoas' : 'Serviço';
  let result = {status: 'waiting'};
  const clickDeadline = Date.now() + 10000;
  while (Date.now() < clickDeadline) {
    try {
      result = await portalPage(tab.id, 'advance', {current: PORTAL_ROUTES[currentStep]});
      if (result?.status === 'advancing') break;
    } catch (error) {
      if (!/Cannot access|No tab with id|frame|receiving end/i.test(error.message || '')) throw error;
      result = {status: 'advancing'};
      break;
    }
    await pause(300);
  }
  if (result?.status !== 'advancing') {
    const detail = result?.available_buttons?.length
      ? ` [botões na página: ${result.available_buttons.map(b => `${b.tag}#${b.id} "${b.text}"`).join(', ')}]`
      : '';
    throw Error(`Não foi possível avançar após ${currentLabel}: ${result?.status || 'sem resposta'}.${detail}`);
  }
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    await pause(300);
    try {
      const page = await portalPage(tab.id, 'route', null);
      if (page?.status === 'ready' && onStep(page.path, nextStep)) {
        tab.url = new URL(page.path, 'https://www.nfse.gov.br').href;
        return;
      }
    } catch (error) {
      if (error.message && !/Cannot access|No tab with id|frame|receiving end/i.test(error.message)) throw error;
    }
  }
  throw Error(`O portal não abriu a etapa ${nextStep === 'service' ? 'Serviço' : 'Valores'}. Confira as mensagens de validação na página.`);
}

async function fillAll(prepared, selectors) {
  const tab = await oneTab('https://www.nfse.gov.br/EmissorNacional/DPS/*', 'da Emissão Completa');
  if (!onStep(new URL(tab.url).pathname, 'people')) throw Error('Abra a etapa Pessoas da Emissão Completa para iniciar o preenchimento completo.');
  const steps = ['people', 'service', 'values'];
  const completed = [];
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const label = prepared.steps.find(item => item.key === step).label;
    chrome.runtime.sendMessage({type: 'progress', completed, message: `Preenchendo ${label}…`}).catch(() => {});
    const fields = await fillFields(tab, step, prepared, selectors, `${label}: `, completed);
    completed.push(...fields.map(field => `${label}: ${field}`));
    if (index < steps.length - 1) {
      await pause(500);
      await advance(tab, step, steps[index + 1]);
    }
  }
  return {completed, message: 'Pessoas, Serviço e Valores preenchidos. Confira a etapa Valores e emita manualmente.'};
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  (async () => {
    if (message.type === 'lookup') return lookup(message.room, message.config);
    if (message.type === 'fill') return fill(message.step, message.prepared, message.selectors);
    if (message.type === 'fillAll') return fillAll(message.prepared, message.selectors);
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
