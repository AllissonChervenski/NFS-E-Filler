/* Datas exibidas sempre no formato brasileiro, independentemente do navegador. */
(function (root) {
  function displayDate(value) {
    const raw = String(value || '');
    if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(raw)) return raw.split('-').reverse().join('/');
    if (/^[0-9]{2}\/[0-9]{2}\/[0-9]{4}$/.test(raw)) return raw;
    return '—';
  }

  function maskDate(value) {
    let raw = String(value || '');
    if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(raw)) raw = displayDate(raw);
    return raw.replace(/[^0-9]/g, '').slice(0, 8)
      .replace(/^([0-9]{2})([0-9])/, '$1/$2')
      .replace(/^([0-9]{2}\/[0-9]{2})([0-9])/, '$1/$2');
  }

  const dates = Object.freeze({displayDate, maskDate});
  root.NFSeDates = dates;
  if (typeof module !== 'undefined' && module.exports) module.exports = dates;
})(globalThis);
