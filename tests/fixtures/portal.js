window.emitted = false;
const delayedReset = selector => {
  if (!window.delayServiceReady) return;
  if (window.jQuery) window.jQuery.active++;
  setTimeout(() => {
    const old = document.querySelector(selector);
    const replacement = old.cloneNode(true);
    replacement.selectedIndex = 0;
    old.replaceWith(replacement);
    if (window.jQuery) window.jQuery.active--;
  }, 1500);
};
document.querySelector('[name="ServicoPrestado.CodigoNBS"]').onchange = () => {
  delayedReset('[name="ServicoPrestado.CodigoIndOp"]');
};
document.querySelector('#cst').onchange = () => { delayedReset('#classification'); };
window.lockedRadioChanges = 0;
for (const name of ['ISSQN.HaSuspensao', 'ISSQN.HaBeneficioMunicipal']) {
  document.querySelectorAll(`input[name="${name}"]`).forEach(el => {
    el.onchange = () => { window.lockedRadioChanges++; };
  });
}
document.querySelector('input[name="ValorTributos.TipoValorTributos"][value="4"]').onchange = () => {
  document.querySelector('input[name="ValorTributos.AliquotaSN"]').hidden = false;
};
window.serviceChanges = {country: 0, municipality: 0};
document.querySelector('[name="LocalPrestacao.CodigoPaisPrestacao"]').onchange = () => {
  window.serviceChanges.country++;
};
document.querySelector('[name="LocalPrestacao.CodigoMunicipioPrestacao"]').onchange = () => {
  window.serviceChanges.municipality++;
  const enable = () => { document.querySelector('#national').disabled = false; };
  if (window.delayServiceReady) setTimeout(enable, 80); else enable();
};
document.querySelector('#national').onchange = () => {
  const enable = () => { document.querySelector('#description').readOnly = false; };
  if (window.delayServiceReady) setTimeout(enable, 80); else enable();
};
document.querySelectorAll('[name="PreencherInfoIBSCBS"]').forEach(input => {
  input.addEventListener('change', () => {
    document.querySelector('#DataCompetencia').hidden = false;
    for (const name of ['EhCompraGovernamental', 'DestinatarioEhOAdquirente', 'Intermediario.LocalDomicilio']) {
      document.querySelectorAll(`input[name="${name}"]`).forEach(el => { el.disabled = false; });
    }
  });
});
document.querySelector('#emit').onclick = () => { window.emitted = true; };
document.querySelector('#country').oninput = () => {
  document.querySelector('#country-options').hidden = false;
};
document.querySelector('#brazil').onclick = () => {
  document.querySelector('#country').value = 'Brasil';
  document.querySelector('#country').dataset.selectedCode = 'BR';
  document.querySelector('#country-options').hidden = true;
};
