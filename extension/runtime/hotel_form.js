/* A competência é preservada e o tomador só é mantido por escolha explícita. */
(function (root) {
  function mergeStay(current, stay, keepDocument) {
    const result = {...current};
    for (const key of ['guest_name', 'check_in', 'check_out', 'service_value']) result[key] = stay[key];
    if (!(keepDocument && current.customer_document?.trim())) {
      result.customer_document = stay.customer_document || '';
    }
    return result;
  }
  function shouldAutoApply(status, pendingId, snapshot, current, blocked) {
    return !blocked && !status.busy && pendingId !== null && status.id === pendingId && status.status === 'done'
      && !!status.result && snapshot === JSON.stringify(current);
  }
  root.NFSeHotelForm = {mergeStay, shouldAutoApply};
  if (typeof module !== 'undefined' && module.exports) module.exports = {mergeStay, shouldAutoApply};
})(globalThis);
