/* ============================================================
   Tutoring Tracker Pro — Sessions
   Session records: cents, locked-row detail, delete / inline edit / auto-complete, travel rules.
   Table, form and mileage routing live in session-table.js, session-form.js, mileage.js (roadmap 4.4).
   ============================================================ */
(function () {
  'use strict';

  const App = window.App;
  const $ = App.$;
  const escapeHtml = App.escapeHtml;
  const formatDate = App.formatDate;
  const todayISO = App.todayISO;
  const num = App.num;

  /** Round to whole cents. The 6-decimal pass removes floating-point noise first, so a product such as
   *  62.50 x 0.83 = 51.875 (or 51.87499999999999) becomes 51.88 and 1.005 becomes 1.01. */
  function roundCents(n) {
    return Math.round(Number((num(n) * 100).toFixed(6))) / 100;
  }

  /** Cents for NEW money only (audit 6a). A value equal to the amount already stored on the row is
   *  passed through untouched, so opening and re-saving a session never re-rounds what is on file. */
  function newAmount(value, storedAmount) {
    const typed = num(value);
    return storedAmount != null && typed === num(storedAmount) ? typed : roundCents(typed);
  }

  function rejectProtected(id) {
    if (!App.isProtectedSession(id)) return false;
    App.showToast('Locked session: use the pencil to save a correction, or Duplicate it.', 'warning');
    return true;
  }

  function openSessionDetail(id) {
    if (!App.isProtectedSession(id)) return;
    const snapshot = App.repository.snapshot();
    const archived = App.isArchivedRecord('sessions', id);
    const evidence = archived ? snapshot.archive.originals : snapshot.finalized[String(id)];
    const record = archived
      ? evidence.sessions.find((s) => String(s.id) === String(id))
      : evidence && evidence.record;
    const content = $('session-detail-content');
    if (!record || !content) return;

    const title = $('modal-session-detail-title');
    if (title) title.textContent = archived ? 'Historical session — read-only' : 'Finalized session — read-only';
    const rawValue = (field) => Object.hasOwn(record, field) ? JSON.stringify(record[field]) : 'Missing (not stored)';
    const fields = [
      ['Date', 'date'], ['Time', 'time'], ['Duration', 'duration'],
      ['Amount', 'amount'], ['Rate', 'rate'], ['Hourly rate', 'hourlyRate'],
      ['Company share percent', 'companySplit'], ['Company share amount', 'companyAmount'],
      ['Status', 'status'], ['Paid', 'paid'], ['Payment', 'payment'], ['Payment date', 'paymentDate']
    ];
    content.innerHTML = '<p>Original stored values. Missing means the field was not stored; null is an explicitly stored empty value. Quoted values are text. No values below are recalculated.</p>' +
      '<dl>' + fields.map(([label, field]) => {
        const cls = /^company/.test(field) ? ' class="split-info"' : '';
        return '<dt' + cls + '>' + label + '</dt><dd' + cls + '>' + escapeHtml(rawValue(field)) + '</dd>';
      }).join('') + '</dl>';
    const appendEvidence = (label, value) => {
      const heading = document.createElement('h3');
      heading.textContent = label;
      const pre = document.createElement('pre');
      pre.textContent = JSON.stringify(value, null, 2);
      content.append(heading, pre);
    };
    appendEvidence('Original session record', record);
    const clientIds = Array.isArray(record.clientIds) ? record.clientIds :
      (Object.hasOwn(record, 'clientId') ? [record.clientId] : []);
    appendEvidence('Clients captured with the original record', evidence.clients.filter((client) =>
      clientIds.some((clientId) => String(clientId) === String(client.id))));
    // Show stored pricing defaults only, never unrelated settings such as credentials.
    const pricingSettings = {};
    Object.keys(evidence.settings).filter((field) => /rate|price|split|company|duration/i.test(field)).forEach((field) => {
      pricingSettings[field] = evidence.settings[field];
    });
    appendEvidence('Original pricing settings (stored fields only)', pricingSettings);
    appendEvidence('Later events (status, payment, corrections) — separate from the original record', snapshot.events.filter((event) => String(event.sessionId) === String(id)));
    App.openModal('modal-session-detail');
  }

  /** Trash can on a locked row: deletion is impossible (append-only evidence), so offer a cancel
   *  correction instead. The original stays on file; the row drops out of revenue, hours and miles. */
  function voidLockedSession(s) {
    if (['cancelled', 'no-show'].includes(s.status)) {
      App.showToast('Locked session is already ' + s.status + '. It stays on file and does not count.', 'info');
      return;
    }
    if (s.paid) {
      App.showToast('This session is marked paid. Use the pencil to un-pay it first, then cancel it.', 'warning');
      return;
    }
    const revision = App.repository.revision;
    App.showConfirm('Cancel locked session',
      'Locked sessions are kept on file and cannot be deleted. Mark the ' + formatDate(s.date) +
      ' session as cancelled instead? It drops out of revenue, hours and miles; the original stays on file.',
      async () => {
        if (!await App.runCommand('session.correct', { id: s.id, fields: { status: 'cancelled' } }, revision)) return;
        App.showToast('Session cancelled; original kept on file', 'success');
      });
  }

  function deleteSession(id) {
    const revision = App.repository.revision;
    const s = App.state.sessions.find((ses) => String(ses.id) === String(id));
    if (!s) return;
    if (App.isProtectedSession(id)) { voidLockedSession(s); return; }
    App.showConfirm('Delete Session', 'Delete this session from ' + formatDate(s.date) + '?', async () => {
      if (!await App.runCommand('session.delete', { ids: [id] }, revision)) return;
      App.state.selectedSessions.delete(id);
      App.updateBulkBar();
      App.showToast('Session deleted', 'success');
    });
  }

  async function handleInlineEdit(el) {
    const revision = App.repository.revision;
    const id = el.getAttribute('data-id');
    const field = el.getAttribute('data-field');
    if (rejectProtected(id)) { App.renderSessions(); return false; }
    const s = App.state.sessions.find((ses) => String(ses.id) === String(id));
    if (!s) return false;
    const patch = {};
    switch (field) {
      case 'date': case 'time': case 'status': patch[field] = el.value; break;
      case 'duration': patch.duration = num(el.value); break;
      case 'amount': patch.amount = newAmount(el.value, s.amount); break;
      case 'payment':
        patch.paid = el.value === 'paid';
        patch.payment = el.value;
        patch.paymentDate = patch.paid ? (s.paymentDate || todayISO()) : null;
        break;
      default: return false;
    }
    const saved = await App.runCommand('session.update', { ids: [id], patch }, revision);
    if (saved && field === 'date') App.showMonthOf(patch.date);
    App.renderSessions();
    return saved;
  }

  /**
   * Scheduled sessions dated before today are treated as having happened and
   * flip to completed on load (owner ruling 2026-09-15). Completed sessions
   * lock, so a session that did NOT happen must be cancelled on or before its
   * date. Rows that would fail validation are left alone rather than blocking
   * the whole batch.
   */
  async function autoCompleteOverdue() {
    if (!App.repository.ready || App.repository.maintenance) return 0;
    const today = todayISO();
    const past = (s) => s.status === 'scheduled' && typeof s.date === 'string' && s.date < today;
    const overdue = App.state.sessions.filter((s) =>
      past(s) && !App.isProtectedSession(s.id) &&
      num(s.duration) > 0 && Number.isFinite(Number(s.amount)) && Number(s.amount) >= 0 &&
      Array.isArray(s.clientIds) && s.clientIds.length > 0);
    // Pre-activation scheduled sessions are read-only; they complete through an append-only status event.
    const archivedOverdue = App.state.sessions.filter((s) => past(s) && App.isArchivedRecord('sessions', s.id));
    let done = 0;
    const completedIds = [];
    if (overdue.length && await App.runCommand('session.update',
      { ids: overdue.map((s) => s.id), patch: { status: 'completed' } }, App.repository.revision)) { done += overdue.length; completedIds.push(...overdue.map((s) => s.id)); }
    if (archivedOverdue.length && await App.runCommand('session.status',
      { ids: archivedOverdue.map((s) => s.id), status: 'completed' }, App.repository.revision)) { done += archivedOverdue.length; completedIds.push(...archivedOverdue.map((s) => s.id)); }
    if (done === 0) return 0;
    App.showToast(done + ' past scheduled session' + (done === 1 ? '' : 's') +
      ' auto-completed (date has passed)', 'success');
    return done;
  }

  /** Status select on an archived (pre-activation) scheduled row changed. */
  async function setArchivedStatus(el) {
    const id = el.getAttribute('data-id'), status = el.value;
    if (status === 'scheduled') { App.renderSessions(); return; }
    const ok = await App.runCommand('session.status', { ids: [id], status }, App.repository.revision);
    if (ok) App.showToast('Session marked ' + status, 'success'); else App.renderSessions();
  }

  /** Slice F: a hybrid session with 0 minutes in person happened entirely remotely. (Unset = legacy hybrid, still a stop.) */
  function hybridNoTravel(s) {
    return s.type === 'hybrid' && typeof s.inPersonMinutes === 'number' && s.inPersonMinutes === 0;
  }

  /** No travel leg at all: online, or hybrid with 0 minutes in person. */
  function noTravel(s) {
    return (s.type || 'in-person') === 'online' || hybridNoTravel(s);
  }

  function isDriveStop(s) {
    return (s.type || 'in-person') !== 'online' && !hybridNoTravel(s) && ['completed', 'scheduled'].includes(s.status || 'completed');
  }

  // Expose to App namespace
  App.openSessionDetail = openSessionDetail;
  App.deleteSession = deleteSession;
  App.handleInlineEdit = handleInlineEdit;
  App.autoCompleteOverdue = autoCompleteOverdue;
  App.setArchivedStatus = setArchivedStatus;
  App.roundCents = roundCents;
  App.newAmount = newAmount;
  App.isDriveStop = isDriveStop;
  App.noTravel = noTravel;

})();
