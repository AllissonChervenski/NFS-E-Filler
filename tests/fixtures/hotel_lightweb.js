location.hash = '#/mapaUh/';
window.pmsSaved = false;
window.wrongRoomOpened = false;
document.querySelector('#uh-main-85 .uh-icon').onclick = () => {
  document.querySelector('#uh-main-85').classList.add('open');
  document.querySelector('#btn-extratoConta-85').hidden = false;
};
document.querySelector('#btn-extratoConta-85').onclick = event => {
  event.stopPropagation();
  document.querySelector('#mapa-uhs-conteudo').hidden = true;
  document.querySelector('#statement').hidden = false;
  location.hash = '#/extratoContaHospedagem/99990';
};
document.querySelector('#btn-editar-ocupacao').onclick = () => {
  document.querySelector('#statement').hidden = true;
  document.querySelector('#edit-stay').hidden = false;
  location.hash = '#/editarOcupacao/99990';
};
document.querySelector('#btn-extratoConta-2').onclick = () => { window.wrongRoomOpened = true; };
document.querySelector('#btnSalvarEditarOcupacao').onclick = () => { window.pmsSaved = true; };
