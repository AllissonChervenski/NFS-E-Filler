location.hash = '#/mapaUh/';
window.pmsSaved = false;
window.wrongRoomOpened = false;
document.querySelector('#btn-alterar-ocupacao-85').onclick = () => {
  document.querySelector('#mapa-uhs-conteudo').hidden = true;
  document.querySelector('#edit-stay').hidden = false;
  location.hash = '#/editarOcupacao/99990';
};
document.querySelector('#btn-alterar-ocupacao-2').onclick = () => { window.wrongRoomOpened = true; };
document.querySelector('#btnSalvarEditarOcupacao').onclick = () => { window.pmsSaved = true; };
