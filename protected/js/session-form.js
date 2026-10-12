/* ============================================================
   Tutoring Tracker Pro — Session form
   Client picker, Usual tiles, duration chips, open / prefill / save, locked-row corrections. Split out of sessions.js (roadmap 4.4).
   ============================================================ */
(function () {
  'use strict';

  const App = window.App;
  const $ = App.$;
  const escapeHtml = App.escapeHtml;
  const generateId = App.generateId;
  const formatCurrency = App.formatCurrency;
  const formatDate = App.formatDate;
  const formatDuration = App.formatDuration;
  const todayISO = App.todayISO;
  const num = App.num;
  const clientName = App.clientName;

  let sessionFormRevision = null;

  const SESSION_TYPES = ['in-person', 'online', 'hybrid', 'group']; // the Session Type select's options

  /* ==========================================================
     SESSION FORM: tap-to-pick clients, smart default status, duration chips
     (ported 2026-09-19 from the retired root app's picker; pure helpers first)
     ========================================================== */

  /**
   * PURE. Rows for the client picker: every ACTIVE client, plus whoever is already on the session being
   * edited even if inactive now (a locked row must still show its own clients). Order is decided once per
   * open so tiles do not jump while tapping: already-selected first, then most recently tutored, then A-Z.
   */
  function clientPickerRows(clients, sessions, selectedIds) {
    const selected = (selectedIds || []).map(String);
    const lastDate = {};
    (sessions || []).forEach((s) => (s.clientIds || []).forEach((cid) => {
      const k = String(cid), d = s.date || '';
      if (!lastDate[k] || d > lastDate[k]) lastDate[k] = d;
    }));
    return (clients || [])
      .filter((c) => (c.status || 'active') === 'active' || selected.includes(String(c.id)))
      .map((c) => ({ id: c.id, name: clientName(c), rate: c.rate, selected: selected.includes(String(c.id)),
        inactive: (c.status || 'active') !== 'active', last: lastDate[String(c.id)] || '' }))
      .sort((a, b) => (Number(b.selected) - Number(a.selected)) || b.last.localeCompare(a.last) || a.name.localeCompare(b.name));
  }

  /** PURE. A new session dated today or earlier has happened (Completed); a future one is Scheduled. */
  function defaultStatusForDate(date, today) {
    return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && date > today ? 'scheduled' : 'completed';
  }

  /** PURE. Duration chip minutes -> the decimal hours the form and the stored record use (45 -> 0.75). */
  const DURATION_CHIPS = Object.freeze([30, 45, 60, 90, 120]);

  function chipHours(minutes) {
    const m = Number(minutes);
    return DURATION_CHIPS.includes(m) ? m / 60 : null;
  }

  // Picker selection, in the order it will be stored. Editing starts from the session's own stored order,
  // so re-saving without touching the picker never records a client change.
  let pickedClientIds = [];

  // The default status follows the date until the owner picks a status himself.
  let statusTouched = false;

  function renderClientPicker(selectedIds) {
    pickedClientIds = (selectedIds || []).map(String);
    const picker = $('session-clients');
    if (!picker) return;
    const rows = clientPickerRows(App.state.clients, App.state.sessions, pickedClientIds);
    if (rows.length === 0) {
      picker.innerHTML = '<p class="client-picker-empty">No active clients. Add a client, or set someone back to Active on the Clients tab.</p>';
      return;
    }
    picker.innerHTML = rows.map((r) =>
      '<button type="button" class="client-pick' + (r.selected ? ' selected' : '') + '" data-action="toggle-session-client" data-id="' +
      escapeHtml(r.id) + '" aria-pressed="' + (r.selected ? 'true' : 'false') + '">' +
      '<span class="client-pick-name">' + escapeHtml(r.name) + (r.inactive ? ' <em class="client-pick-inactive">(inactive)</em>' : '') + '</span>' +
      '<span class="client-pick-rate">' + formatCurrency(r.rate) + '/hr</span></button>').join('');
  }

  /** IDs currently picked, as strings, in stored order. */
  function getSelectedSessionClientIds() {
    return [...pickedClientIds];
  }

  /** One tap toggles one client tile, then refreshes the amount / repeat-last hints. */
  function toggleSessionClient(btn) {
    if (!btn) return;
    const id = String(btn.getAttribute('data-id'));
    const on = !pickedClientIds.includes(id);
    pickedClientIds = on ? [...pickedClientIds, id] : pickedClientIds.filter((x) => x !== id);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.classList.toggle('selected', on);
    updateSessionPrefill();
  }

  /** New sessions only: keep Status in step with the date until the owner chooses a status himself. */
  function applySmartStatus() {
    if ($('session-id').value || statusTouched) return;
    $('session-status').value = defaultStatusForDate($('session-date').value, todayISO());
  }

  function markStatusTouched() { statusTouched = true; }

  /** Duration chip tapped: write decimal hours into the existing field. */
  function setSessionDuration(minutes) {
    const hours = chipHours(minutes);
    if (hours == null) return;
    $('session-duration').value = hours;
    syncDurationChips();
    updateSessionPrefill();
  }

  function syncDurationChips() {
    const hours = num($('session-duration').value);
    document.querySelectorAll('[data-action="set-session-duration"]').forEach((chip) => {
      const on = chipHours(chip.getAttribute('data-minutes')) === hours;
      chip.setAttribute('aria-pressed', on ? 'true' : 'false');
      chip.classList.toggle('selected', on);
    });
  }

  // "Usual" quick-pick tiles (Slice C): what he usually logs, read from the sessions on file. New sessions only.
  const USUAL_TILE_LIMIT = 5;

  let usualTiles = [];

  /** PURE. The one-line label of a tile: "Alpha + Beta · 2h · $300 · in-person · Tue/Thu". */
  function usualTileLabel(tile, clientsById) {
    const names = tile.clientIds.map((id) => App.clientName(clientsById[String(id)] || {})).join(' + ');
    const parts = [names, formatDuration(tile.duration), formatCurrency(tile.amount), tile.type || 'in-person'];
    if (tile.weekdays && tile.weekdays.length) parts.push(tile.weekdays.join('/'));
    return parts.join(' · ');
  }

  /** Paint the tiles above the client picker; hidden while editing or when nothing is usual yet. */
  function renderUsualTiles(editing) {
    const group = $('session-usual-group'), host = $('session-usual');
    if (!group || !host) return;
    usualTiles = editing || typeof App.usualTiles !== 'function' ? [] : App.usualTiles(App.state.sessions, App.state.clients, todayISO(), USUAL_TILE_LIMIT);
    group.hidden = usualTiles.length === 0;
    if (!usualTiles.length) { host.innerHTML = ''; return; }
    const clientsById = {};
    App.state.clients.forEach((c) => { clientsById[String(c.id)] = c; });
    host.innerHTML = usualTiles.map((tile, i) =>
      '<button type="button" class="usual-tile" data-action="pick-usual" data-index="' + i + '" aria-pressed="false" title="' +
      escapeHtml(tile.count + (tile.count === 1 ? ' session' : ' sessions') + ' on file') + '">' + escapeHtml(usualTileLabel(tile, clientsById)) + '</button>').join('');
    syncUsualTiles();
  }

  /** Mark the tile (if any) that matches what the form currently holds. */
  function syncUsualTiles() {
    const host = $('session-usual');
    if (!host || !usualTiles.length) return;
    const key = [...new Set(getSelectedSessionClientIds())].sort().join('+');
    const duration = num($('session-duration').value), amount = num($('session-amount').value), type = $('session-type').value || 'in-person';
    host.querySelectorAll('[data-action="pick-usual"]').forEach((btn) => {
      const tile = usualTiles[Number(btn.getAttribute('data-index'))];
      const on = !!tile && tile.key === key && tile.duration === duration && tile.amount === amount && tile.type === type && $('session-amount').value !== '';
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.classList.toggle('selected', on);
    });
  }

  /** One tap fills clients, duration, type, amount and time from a tile. Date, status, payment and mileage are left alone. */
  function pickUsualTile(index) {
    if ($('session-id').value) return;
    const tile = usualTiles[Number(index)];
    if (!tile) return;
    renderClientPicker(tile.clientIds);
    $('session-duration').value = tile.duration;
    $('session-type').value = tile.type || 'in-person';
    syncInPersonGroup();
    $('session-amount').value = tile.amount;
    $('session-time').value = tile.time || '';
    syncDurationChips();
    updateSessionPrefill();
  }

  function openSessionForm(id, prefillDate) {
    const locked = !!id && App.isProtectedSession(id);
    sessionFormRevision = App.repository.revision;
    statusTouched = false;
    const sessions = App.state.sessions;
    const clients = App.state.clients;
    const settings = App.state.settings;

    const modal = $('modal-session');
    const title = $('modal-session-title');
    const form = $('session-form');
    if (!modal || !form) return;

    form.reset();
    delete $('session-mileage').dataset.details;
    $('session-id').value = '';
    const note = $('session-protected-note');
    if (note) note.hidden = !locked;
    const editing = id ? sessions.find((ses) => String(ses.id) === String(id)) : null;
    const editingClientIds = editing && Array.isArray(editing.clientIds) ? editing.clientIds.map(String) : [];
    // A locked session can only carry a real outcome; it never goes back to scheduled.
    const scheduledOpt = $('session-status') && $('session-status').querySelector('option[value="scheduled"]');
    if (scheduledOpt) scheduledOpt.disabled = locked;

    // Tap-to-pick client tiles: active clients, plus whoever is on the session being edited (may be inactive now).
    renderClientPicker(editingClientIds);
    // Fill-in-one-tap tiles (hidden while editing).
    renderUsualTiles(!!id);

    if (id) {
      const s = sessions.find((ses) => String(ses.id) === String(id));
      if (!s) return;
      if (title) title.textContent = locked ? 'Edit Session (original kept)' : 'Edit Session';
      $('session-id').value = s.id;
      $('session-date').value = s.date || '';
      $('session-time').value = s.time || '';
      $('session-type').value = s.type || 'in-person';
      $('session-in-person-minutes').value = s.inPersonMinutes == null ? '' : s.inPersonMinutes;
      $('session-duration').value = s.duration || 1;
      $('session-amount').value = s.amount == null ? '' : s.amount;
      $('session-mileage').value = s.mileage || '';
      $('session-payment').value = s.paid ? 'paid' : (s.payment === 'waived' ? 'waived' : 'unpaid');
      // Blank when the stored row has no payment date: a no-edit save must not invent one (see saveSession).
      $('session-payment-date').value = s.paymentDate || (s.paid ? '' : todayISO());
      $('session-status').value = s.status || 'completed';
      $('session-notes').value = s.notes || '';
    } else {
      if (title) title.textContent = 'Add Session';
      $('session-date').value = prefillDate || todayISO();
      $('session-duration').value = settings.defaultDuration || 1;
      // Today or earlier = it happened (Completed); a future date = Scheduled. Still overridable.
      applySmartStatus();
      $('session-payment-date').value = todayISO();
      $('session-in-person-minutes').value = '';
    }

    syncInPersonGroup();
    syncDurationChips();
    togglePaymentDate();
    App.openModal('modal-session');
    updateSessionPrefill();
  }

  /** "Paid on" is only meaningful when the payment status is paid. */
  function togglePaymentDate() {
    const group = $('session-payment-date-group');
    if (group) group.hidden = $('session-payment').value !== 'paid';
  }

  /**
   * Locked (archived or finalized) sessions are edited through append-only correction events:
   * only the fields that actually changed are recorded; the original record is never touched.
   */
  async function saveCorrection(id, form) {
    const prev = App.state.sessions.find((s) => String(s.id) === String(id));
    if (!prev) return false;
    const fields = {};
    const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
    const prevClientIds = (prev.clientIds || []).map(String);
    if (!same(form.clientIds.map(String), prevClientIds)) fields.clientIds = form.clientIds;
    // Compare against what the form showed for the stored record (older rows omit some fields entirely).
    const shown = { date: prev.date || '', time: prev.time || '', type: prev.type || 'in-person', status: prev.status || 'completed',
      notes: prev.notes || '', payment: prev.paid ? 'paid' : (prev.payment === 'waived' ? 'waived' : 'unpaid') };
    Object.keys(shown).forEach((k) => { if (!same(form[k], shown[k])) fields[k] = form[k]; });
    // The form cannot display a legacy time that is not HH:MM, or a type outside its list; a no-edit save shows
    // '' / 'In Person' for those, and that default must not be written back as a correction.
    if (fields.time === '' && prev.time && !/^\d{2}:\d{2}$/.test(String(prev.time))) delete fields.time;
    if (fields.type === 'in-person' && prev.type && !SESSION_TYPES.includes(prev.type)) delete fields.type;
    if (num(form.duration) !== num(prev.duration)) fields.duration = num(form.duration);
    if (num(form.amount) !== num(prev.amount)) fields.amount = num(form.amount);
    if (!same(form.inPersonMinutes, prev.inPersonMinutes == null ? null : prev.inPersonMinutes)) fields.inPersonMinutes = form.inPersonMinutes;
    // Switched to a no-travel type in THIS edit (online, or hybrid with 0 minutes): its miles are stale, clear them.
    // Rows that were already no-travel keep whatever they hold; a no-edit save must stay "No changes".
    const switchedToNoTravel = App.noTravel(form) && !App.noTravel(prev) && num(prev.mileage) > 0;
    if (switchedToNoTravel) form.mileage = 0;
    if (num(form.mileage) !== num(prev.mileage)) {
      fields.mileage = num(form.mileage);
      fields.mileageManual = !form.mileageDetails && !switchedToNoTravel;
      if (form.mileageDetails) fields.mileageDetails = form.mileageDetails;
    }
    if (form.paid !== !!prev.paid) fields.paid = form.paid;
    if (!same(form.paymentDate, prev.paymentDate == null ? null : prev.paymentDate)) fields.paymentDate = form.paymentDate;
    if ('paid' in fields || 'payment' in fields) { fields.paid = form.paid; fields.payment = form.payment; fields.paymentDate = form.paymentDate; }
    if (Object.keys(fields).length === 0) { App.closeModal('modal-session'); App.showToast('No changes', 'info'); return true; }
    const saved = await App.runCommand('session.correct', { id, fields }, sessionFormRevision);
    if (!saved) return false;
    App.closeModal('modal-session');
    App.showMonthOf(form.date);
    App.showToast('Correction saved; original kept on file', 'success');
    return true;
  }

  /** Most recent completed session for a single client (by date, then createdAt). */
  function lastSessionForClient(clientId) {
    const sessions = App.state.sessions;
    const editingId = $('session-id').value;
    const matches = sessions.filter((s) =>
      String(s.id) !== String(editingId) &&
      s.status === 'completed' &&
      (s.clientIds || []).some((cid) => String(cid) === String(clientId))
    );
    if (matches.length === 0) return null;
    matches.sort((a, b) => {
      const d = (b.date || '').localeCompare(a.date || '');
      if (d !== 0) return d;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
    return matches[0];
  }

  /**
   * Refresh the live amount placeholder (rate x duration) and the
   * "Repeat last session" banner based on the currently selected client(s).
   * Only fires for brand-new sessions, not when editing an existing one.
   */
  function updateSessionPrefill() {
    const clients = App.state.clients;
    const amountEl = $('session-amount');
    const banner = $('repeat-last-banner');
    const isEditing = !!$('session-id').value;

    const selected = getSelectedSessionClientIds();

    // Live amount placeholder = avg rate x duration
    if (amountEl) {
      const duration = num($('session-duration').value) || 0;
      const rates = selected.map((cid) => {
        const c = clients.find((cl) => String(cl.id) === String(cid));
        return c ? num(c.rate) : 0;
      }).filter((r) => r > 0);
      if (rates.length > 0 && duration > 0) {
        const avg = rates.reduce((s, r) => s + r, 0) / rates.length;
        amountEl.placeholder = formatCurrency(avg * duration) + ' (auto)';
      } else {
        amountEl.placeholder = 'Auto-calculated';
      }
    }

    syncUsualTiles();

    // Repeat-last banner: only for a single selected client on a new session
    if (banner) {
      const textEl = $('repeat-last-text');
      if (!isEditing && selected.length === 1) {
        const last = lastSessionForClient(selected[0]);
        if (last) {
          banner.hidden = false;
          if (textEl) {
            textEl.textContent = 'Repeat last session (' +
              formatDate(last.date) + ' · ' + formatDuration(last.duration) + ' · ' +
              formatCurrency(last.amount) + ')';
          }
          banner.dataset.lastId = last.id;
        } else {
          banner.hidden = true;
          banner.dataset.lastId = '';
        }
      } else {
        banner.hidden = true;
        banner.dataset.lastId = '';
      }
    }
  }

  /** Fill the open session form from a client's most recent session. */
  function repeatLastSession() {
    if ($('session-id').value) return;
    const banner = $('repeat-last-banner');
    if (!banner || !banner.dataset.lastId) return;
    const sessions = App.state.sessions;
    const last = sessions.find((s) => String(s.id) === String(banner.dataset.lastId));
    if (!last) return;

    // Copy the session shape, keeping the form's chosen local date and payment status.
    // NOTE: mileage is intentionally NOT copied — it varies per trip (other
    // families, multi-stop days) and a stale value would skew the deduction.
    $('session-time').value = last.time || '';
    $('session-type').value = last.type || 'in-person';
    $('session-in-person-minutes').value = last.type === 'hybrid' && last.inPersonMinutes != null ? last.inPersonMinutes : '';
    syncInPersonGroup();
    $('session-duration').value = num(last.duration) || 1;
    $('session-amount').value = last.amount == null ? '' : last.amount;
    $('session-mileage').value = '';
    if (last.notes) $('session-notes').value = last.notes;
    syncDurationChips();

    App.showToast('Filled from ' + formatDate(last.date) + ' session (mileage left blank)', 'success');
    updateSessionPrefill();
  }

  async function saveSession() {
    const sessions = App.state.sessions;
    const clients = App.state.clients;

    const date = $('session-date').value;
    // Stored clientIds keep each client's own id type (number or string), exactly as before the picker.
    const selectedClients = getSelectedSessionClientIds().map((value) => {
      const client = clients.find((c) => String(c.id) === String(value));
      return client ? client.id : value;
    });
    const duration = num($('session-duration').value);

    if (!date) {
      App.showToast('Date is required', 'error');
      $('session-date').focus();
      return;
    }
    if (selectedClients.length === 0) {
      App.showToast('Select at least one client', 'error');
      return;
    }
    if (duration <= 0) {
      App.showToast('Duration must be greater than 0', 'error');
      $('session-duration').focus();
      return;
    }

    // Auto-calculate amount if blank
    let amount = num($('session-amount').value);
    if ($('session-amount').value === '') {
      const rates = selectedClients.map((cid) => {
        const c = clients.find((cl) => String(cl.id) === String(cid));
        return c ? num(c.rate) : 0;
      }).filter((r) => r > 0);
      const avgRate = rates.length > 0 ? rates.reduce((s, r) => s + r, 0) / rates.length : 0;
      amount = avgRate * duration;
    }

    // New-record share policy is applied by the repository.
    const primaryClient = clients.find((c) => String(c.id) === String(selectedClients[0]));

    const paymentVal = $('session-payment').value;
    const paid = paymentVal === 'paid';

    const id = $('session-id').value;
    const isNew = !id;
    // Today is only assumed when the row BECOMES paid in this save; an already-paid row keeps its stored date (or none).
    const wasPaid = id ? sessions.find((s) => String(s.id) === String(id)) : null;
    const paidOn = paid ? ($('session-payment-date').value || (wasPaid && wasPaid.paid ? (wasPaid.paymentDate == null ? null : wasPaid.paymentDate) : todayISO())) : null;
    if (id && App.isProtectedSession(id)) return saveCorrection(id, {
      date, time: $('session-time').value || '', clientIds: selectedClients, type: $('session-type').value || 'in-person',
      duration, amount, paid, payment: paymentVal, paymentDate: paidOn, status: $('session-status').value || 'completed',
      mileage: num($('session-mileage').value), mileageDetails: $('session-mileage').dataset.details || '',
      notes: ($('session-notes').value || '').trim(), inPersonMinutes: readInPersonMinutes(),
    });

    // Cents (audit 6a): a NEW amount on an unlocked session is stored in whole cents. Locked rows
    // returned above untouched, and an amount left unchanged in the form is never re-rounded.
    const storedRow = id ? sessions.find((s) => String(s.id) === String(id)) : null;
    amount = App.newAmount(amount, storedRow ? storedRow.amount : null);

    const sessionData = {
      id: id || generateId(),
      date,
      time: $('session-time').value || '',
      clientIds: selectedClients,
      type: $('session-type').value || 'in-person',
      // Slice F: hybrid rows carry their in-person minutes (null otherwise); the remote part needs no travel leg.
      inPersonMinutes: readInPersonMinutes(),
      duration,
      amount,
      paid,
      payment: paymentVal,
      paymentDate: paidOn,
      status: $('session-status').value || 'completed',
      mileage: num($('session-mileage').value),
      // Set by the form's auto-calc button; typing in the field clears it.
      mileageDetails: $('session-mileage').dataset.details || '',
      // Mileage is entered before finalization; no background writes follow.
      mileageCalculated: num($('session-mileage').value) > 0,
      // Hand-entered mileage is FINAL: nothing may overwrite it.
      mileageManual: num($('session-mileage').value) > 0 && !$('session-mileage').dataset.details,
      address: primaryClient ? primaryClient.address : '',
      notes: ($('session-notes').value || '').trim(),
      ...(isNew ? { recurring: null, createdAt: new Date().toISOString() } : {}),
      updatedAt: new Date().toISOString(),
    };

    if (!isNew) {
      const idx = sessions.findIndex((s) => String(s.id) === String(id));
      if (idx === -1) return;
      const prev = sessions[idx];
      sessionData.id = prev.id;
      // Same clients as before: keep the address the row already had (mileage routing depends on it).
      if (prev.address && JSON.stringify((prev.clientIds || []).map(String)) === JSON.stringify(selectedClients.map(String))) sessionData.address = prev.address;
      if (num(sessionData.mileage) === num(prev.mileage)) {
        delete sessionData.mileageDetails;
        delete sessionData.mileageCalculated;
      }
      // The edit form pre-fills the mileage field with the stored value, so a
      // non-zero value is NOT proof of manual entry. Only treat mileage as
      // manual (frozen against day recalcs) if it was already manual, or the
      // user actually CHANGED the value in this edit.
      const mileageVal = num($('session-mileage').value);
      const mileageAuto = !!$('session-mileage').dataset.details;
      sessionData.mileageManual = !mileageAuto && (prev.mileageManual === true ||
        (mileageVal > 0 && mileageVal !== num(prev.mileage)));
      // Switched to a no-travel type in THIS edit: the pre-filled miles are stale (review finding, Slice F).
      if (App.noTravel(sessionData) && !App.noTravel(prev) && num(sessionData.mileage) > 0) {
        Object.assign(sessionData, { mileage: 0, mileageManual: false, mileageCalculated: false, mileageDetails: '' });
      }
      // An old row that never had the key stays byte-stable on a no-edit save.
      if (sessionData.inPersonMinutes == null && !('inPersonMinutes' in prev)) delete sessionData.inPersonMinutes;
      // Cash-basis integrity: the "Paid on" field is pre-filled with the stored payment date, so an
      // already-paid session keeps its date unless the owner deliberately changes it.

    }

    const saved = await App.runCommand('session.save', { record: sessionData }, sessionFormRevision);
    if (!saved) return false;
    App.closeModal('modal-session');
    App.showMonthOf(sessionData.date);
    App.renderSessions();
    App.showToast(isNew ? 'Session added' : 'Session updated', 'success');
    return true;
  }

  /** The form's "Minutes in person": only a Hybrid session stores it; blank = unknown (null). */
  function readInPersonMinutes() {
    if (($('session-type').value || 'in-person') !== 'hybrid') return null;
    const raw = String($('session-in-person-minutes').value || '').trim();
    if (raw === '') return null;
    return Math.max(0, Math.round(num(raw)));
  }

  /** Show the minutes field for Hybrid only. */
  function syncInPersonGroup() {
    const group = $('session-in-person-group');
    if (group) group.hidden = ($('session-type').value || 'in-person') !== 'hybrid';
  }

  // Expose to App namespace
  App.openSessionForm = openSessionForm;
  App.togglePaymentDate = togglePaymentDate;
  App.saveSession = saveSession;
  App.updateSessionPrefill = updateSessionPrefill;
  App.repeatLastSession = repeatLastSession;
  App.pickUsualTile = pickUsualTile;
  App.usualTileLabel = usualTileLabel;
  App.clientPickerRows = clientPickerRows;
  App.defaultStatusForDate = defaultStatusForDate;
  App.chipHours = chipHours;
  App.DURATION_CHIPS = DURATION_CHIPS;
  App.toggleSessionClient = toggleSessionClient;
  App.getSelectedSessionClientIds = getSelectedSessionClientIds;
  App.applySmartStatus = applySmartStatus;
  App.markStatusTouched = markStatusTouched;
  App.setSessionDuration = setSessionDuration;
  App.syncDurationChips = syncDurationChips;
  App.syncInPersonGroup = syncInPersonGroup;
  App.readInPersonMinutes = readInPersonMinutes;

})();
