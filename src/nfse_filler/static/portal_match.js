/* Regras comuns ao select e aos resultados de busca do portal. */
const NFSePortalMatch = (() => {
  const normalize = raw => String(raw ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').replace(/\s*\/\s*/g, '/').trim().toLowerCase();
  const municipality = raw => normalize(raw)
    .replace(/^[0-9]{7}\s*[-–]\s*/, '')
    .replace(/^([a-z]{2})\s*[-–]\s*(.+)$/, '$2/$1')
    .replace(/\s*(?:\/|[-–]|\()\s*([a-z]{2})\)?$/, '/$1');
  const matches = (raw, value, key) => {
    if (key === 'municipality') return municipality(raw) === municipality(value);
    if (normalize(raw) === normalize(value)) return true;
    if (/^[0-9.]+$/.test(value)) {
      const code = String(raw).trim().match(/^[0-9.]+(?=\s|$|[-–])/);
      return !!code && code[0].replaceAll('.', '') === value.replaceAll('.', '');
    }
    return normalize(raw).startsWith(normalize(value) + ' -');
  };
  return {matches};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = NFSePortalMatch;
