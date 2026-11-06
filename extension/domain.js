/* Validação local. Valores fiscais vêm dos mesmos metadados da aplicação web. */
const NFSeDomain = (() => {
  const meta = window.NFSeExtensionMetadata;
  const defaults = () => ({values: Object.fromEntries(meta.fields.map(f => [f.key, f.default])), selectors: {}});
  const hotelDefaults = () => ({login_url: 'https://desbravadorweb.com.br/acesso/3672', selectors: {...meta.hotel_selectors}});
  const cleanDocument = value => String(value || '').replace(/[.\-/\s]/g, '').toUpperCase();
  function validDocument(raw) {
    if (typeof raw !== 'string' || !/^[0-9A-Za-z.\-/\s]+$/.test(raw)) return false;
    const doc = cleanDocument(raw);
    if (!/^(?:[0-9]{11}|[A-Z0-9]{12}[0-9]{2})$/.test(doc) || new Set(doc).size === 1) return false;
    const numbers = [...doc].map(c => c.charCodeAt(0) - 48);
    const weights = doc.length === 11
      ? [[10,9,8,7,6,5,4,3,2], [11,10,9,8,7,6,5,4,3,2]]
      : [[5,4,3,2,9,8,7,6,5,4,3,2], [6,5,4,3,2,9,8,7,6,5,4,3,2]];
    return weights.every((row, index) => {
      const remainder = row.reduce((sum, w, i) => sum + numbers[i] * w, 0) % 11;
      return numbers[doc.length - 2 + index] === (remainder < 2 ? 0 : 11 - remainder);
    });
  }
  function money(raw, label, allowZero = false) {
    let value = String(raw || '').trim();
    if (value.length > 24) throw Error(`${label}: valor acima do limite permitido.`);
    if (value.includes(',')) {
      if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}$/.test(value)) throw Error(`${label}: use o formato 1.250,00.`);
      value = value.replaceAll('.', '').replace(',', '.');
    } else if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw Error(`${label}: informe um número com até duas casas decimais.`);
    const cents = Math.round(Number(value) * 100);
    if (!Number.isSafeInteger(cents) || cents < 0 || (!allowZero && !cents)) throw Error(`${label}: valor fora do intervalo permitido.`);
    return cents;
  }
  function date(raw, label) {
    const text = String(raw || '');
    let year, month, day;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) [day, month, year] = text.split('/').map(Number);
    else if (/^\d{4}-\d{2}-\d{2}$/.test(text)) [year, month, day] = text.split('-').map(Number);
    else throw Error(`${label}: informe uma data válida.`);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw Error(`${label}: informe uma data válida.`);
    return {iso: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      br: `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`};
  }
  function settings(data) {
    if (!data || typeof data !== 'object' || !data.values || typeof data.values !== 'object' || !data.selectors || typeof data.selectors !== 'object') throw Error('Configuração inválida.');
    const keys = meta.fields.map(f => f.key);
    if (Object.keys(data.values).length !== keys.length || keys.some(k => !(k in data.values))) throw Error('Os campos da configuração não correspondem ao roteiro.');
    const allowed = new Set([...keys, ...meta.variable_fields.map(f => f.key)]);
    const values = {};
    for (const f of meta.fields) {
      const value = data.values[f.key];
      if (typeof value !== 'string' || !value.trim() || value.length > 1000 || (f.choices && !f.choices.includes(value))) throw Error(`${f.label}: valor inválido.`);
      values[f.key] = value.trim();
    }
    if (money(values.simple_rate, 'Alíquota', true) > 10000) throw Error('Alíquota: valor fora do intervalo permitido.');
    const selectors = {};
    for (const [key, value] of Object.entries(data.selectors)) {
      if (!allowed.has(key) || typeof value !== 'string' || value.length > 500) throw Error(`Seletor inválido: ${key}.`);
      if (value.trim()) selectors[key] = value.trim();
    }
    return {values, selectors};
  }
  function hotelConfig(data) {
    const url = new URL(String(data?.login_url || ''));
    if (url.origin !== 'https://desbravadorweb.com.br' || !/^\/acesso\/\d+\/?$/.test(url.pathname) || url.search || url.hash) throw Error('Endereço do Desbravador inválido.');
    const keys = Object.keys(meta.hotel_selectors);
    if (!data.selectors || keys.some(k => typeof data.selectors[k] !== 'string' || data.selectors[k].length > 500)) throw Error('Mapeamento do Desbravador inválido.');
    let selectors = Object.fromEntries(keys.map(k => [k, data.selectors[k].trim()]));
    if (['room', 'guest_name', 'check_in', 'check_out', 'lodging_total'].every(k => !selectors[k])) selectors = {...meta.hotel_selectors};
    if (selectors.room_card && selectors.room_card !== meta.hotel_selectors.room_card && !selectors.room_card.includes('{room}')) throw Error('O seletor do card deve incluir {room}.');
    return {login_url: url.href, selectors};
  }
  function prepare(input, config) {
    const name = String(input.guest_name || '').trim();
    if (!name || name.length > 200) throw Error('Informe o nome do hóspede (até 200 caracteres).');
    const competence = date(input.competence, 'Competência');
    const checkIn = date(input.check_in, 'Check-in');
    const checkOut = date(input.check_out, 'Check-out');
    if (checkOut.iso <= checkIn.iso) throw Error('O check-out deve ser posterior ao check-in.');
    if (!validDocument(input.customer_document)) throw Error('Informe um CPF ou CNPJ válido para o tomador.');
    const cents = money(input.service_value, 'Valor da hospedagem');
    if (cents > 99999999999999) throw Error('Valor da hospedagem acima do limite permitido.');
    const amount = (cents / 100).toFixed(2);
    const description = `Hospedagem de ${name}. Check-in no dia ${checkIn.br} e Check-out ${checkOut.br}`;
    const values = {...config.values, competence: competence.iso, customer_document: cleanDocument(input.customer_document),
      description, service_value: amount.replace('.', ',')};
    const byKey = Object.fromEntries([...meta.fields, ...meta.variable_fields].map(f => [f.key, f]));
    return {description, amount, steps: Object.entries(meta.steps).map(([key, label]) =>
      ({key, label, fields: meta.step_fields[key].map(k => ({...byKey[k], value: values[k]}))}))};
  }
  function stay(raw, room) {
    const canonicalRoom = value => {
      const text = String(value || '').trim().toUpperCase();
      return /^\d+$/.test(text) ? text.replace(/^0+(?=\d)/, '') : text;
    };
    if (canonicalRoom(raw.room) !== canonicalRoom(room)) throw Error('O quarto aberto não corresponde ao solicitado.');
    const name = String(raw.guest_name || '').trim();
    if (!name || name.length > 200) throw Error('Nome do titular não encontrado.');
    const checkIn = date(String(raw.check_in || '').split(' ')[0], 'Check-in');
    const checkOut = date(String(raw.check_out || '').split(' ')[0], 'Check-out');
    if (checkOut.iso <= checkIn.iso) throw Error('Datas da hospedagem inválidas.');
    const token = String(raw.lodging_total || '').match(/(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}/g);
    if (!token || token.length !== 1) throw Error('Subtotal de diárias não identificado.');
    const cents = money(token[0], 'Subtotal de diárias');
    return {room, guest_name: name, customer_document: validDocument(raw.customer_document) ? cleanDocument(raw.customer_document) : '',
      check_in: checkIn.br, check_out: checkOut.br, service_value: (cents / 100).toFixed(2).replace('.', ',')};
  }
  return {defaults, hotelDefaults, settings, hotelConfig, prepare, stay, validDocument};
})();
