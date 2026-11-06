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
