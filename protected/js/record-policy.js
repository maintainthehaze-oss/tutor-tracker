(function () {
  'use strict';
  const key = id => {
    if ((typeof id !== 'string' && typeof id !== 'number') || id === '' ||
        (typeof id === 'number' && !Number.isFinite(id))) throw new Error('Invalid record identity');
    return String(id);
  };
  function isProtectedRecord(id, archiveManifest, finalizedRegistry) {
    const k = key(id);
    return Object.hasOwn(archiveManifest || {}, k) || Object.hasOwn(finalizedRegistry || {}, k);
  }
  // Fields a correction event may overlay on a locked (archived or finalized) session.
  const CORRECTABLE_FIELDS = Object.freeze(['date','time','type','duration','amount','clientIds','address','notes',
    'mileage','mileageManual','mileageCalculated','mileageDetails','status','paid','payment','paymentDate']);
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  /** Throws unless `fields` is a valid, non-empty correction payload. */
  function validateCorrection(fields) {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new Error('Correction fields required');
    const keys = Object.keys(fields);
    if (!keys.length) throw new Error('Nothing to correct');
    keys.forEach(k => { if (!CORRECTABLE_FIELDS.includes(k)) throw new Error('Field cannot be corrected: ' + k); });
    const f = fields;
    if ('date' in f && (typeof f.date !== 'string' || !DATE_RE.test(f.date))) throw new Error('Session date required');
    if ('status' in f && !['completed','cancelled','no-show'].includes(f.status)) throw new Error('A locked session cannot go back to scheduled');
    if ('duration' in f && (!Number.isFinite(Number(f.duration)) || Number(f.duration) <= 0)) throw new Error('Invalid duration');
    if ('amount' in f && (!Number.isFinite(Number(f.amount)) || Number(f.amount) < 0)) throw new Error('Invalid amount');
    if ('mileage' in f && (!Number.isFinite(Number(f.mileage)) || Number(f.mileage) < 0)) throw new Error('Invalid mileage');
    if ('clientIds' in f && (!Array.isArray(f.clientIds) || !f.clientIds.length || f.clientIds.some(id => typeof id !== 'string' && typeof id !== 'number'))) throw new Error('Session clients required');
    if ('paid' in f && typeof f.paid !== 'boolean') throw new Error('Invalid paid flag');
    if ('payment' in f && !['paid','unpaid','waived'].includes(f.payment)) throw new Error('Invalid payment status');
    if ('paymentDate' in f && f.paymentDate !== null && (typeof f.paymentDate !== 'string' || !DATE_RE.test(f.paymentDate))) throw new Error('Invalid payment date');
    ['time','type','address','notes','mileageDetails'].forEach(k => { if (k in f && typeof f[k] !== 'string') throw new Error('Invalid ' + k); });
    ['mileageManual','mileageCalculated'].forEach(k => { if (k in f && typeof f[k] !== 'boolean') throw new Error('Invalid ' + k); });
  }
  /**
   * Overlay the append-only events for one session onto a (cloned) record, in event order; the last
   * event wins. The stored original is never touched. Marks `statusEvent` / `corrected` on the view.
   */
  function applyEvents(record, events) {
    const k = key(record.id);
    (events || []).forEach(ev => {
      if (!ev || key(ev.sessionId) !== k) return;
      if (ev.type === 'status') { record.status = ev.status; record.statusEvent = true; }
      else if (ev.type === 'payment') { record.paid = true; record.payment = 'paid'; record.paymentDate = ev.date; }
      else if (ev.type === 'correction') { Object.assign(record, ev.fields); record.corrected = true; }
    });
    return record;
  }
  window.App.recordPolicy = Object.freeze({ key, isProtectedRecord, applyEvents, validateCorrection, CORRECTABLE_FIELDS });
})();
