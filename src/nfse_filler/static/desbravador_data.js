/* Associação do titular à ficha: nunca presume que ele seja o primeiro hóspede. */
const NFSeDesbravadorData = (() => {
  const normalizeName = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').trim().toUpperCase();
  function holderIdentity(holder, guests) {
    let name = String(holder.name || '').trim();
    const suffix = name.match(/\s*(?:[-–]|\()\s*(?:CPF|CNPJ)?\s*:?\s*((?:[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2})|(?:[A-Z0-9]{2}\.[A-Z0-9]{3}\.[A-Z0-9]{3}\/[A-Z0-9]{4}-[0-9]{2})|(?:[0-9]{11})|(?:[A-Z0-9]{12}[0-9]{2}))\)?\s*$/i);
    if (suffix) {
      name = name.slice(0, suffix.index).trim();
      return {name, document: suffix[1]};
    }
    const matching = guests.filter(guest => holder.id && guest.id
      ? String(holder.id) === String(guest.id) && normalizeName(name) === normalizeName(guest.name)
      : name && normalizeName(name) === normalizeName(guest.name));
    return {name, document: matching.length === 1 ? matching[0].document || '' : ''};
  }
  const canonicalRoom = raw => /^[0-9]+$/.test(String(raw).trim())
    ? String(raw).trim().replace(/^0+(?=[0-9])/, '') : String(raw).trim().toUpperCase();
  return {holderIdentity, canonicalRoom};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = NFSeDesbravadorData;
