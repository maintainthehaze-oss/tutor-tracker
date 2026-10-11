/* ============================================================
   Tutoring Tracker Pro — Clients
   Client CRUD, rendering, forms
   ============================================================ */
(function () {
  'use strict';

  const App = window.App;
  const $ = App.$;
  const escapeHtml = App.escapeHtml;
  const generateId = App.generateId;
  const formatCurrency = App.formatCurrency;
  const num = App.num;
  const clientName = App.clientName;
  const initials = App.initials;

  function renderClients(filter) {
    const clients = App.state.clients;
    const sessions = App.state.sessions;

    const grid = $('clients-grid');
    if (!grid) return;

    const searchInput = document.querySelector('[data-action="search-clients"]');
    const query = (filter || (searchInput ? searchInput.value : '')).toLowerCase().trim();

    let filtered = clients;
    if (query) {
      filtered = clients.filter((c) => {
        const name = clientName(c).toLowerCase();
        const subjects = (c.subjects || '').toLowerCase();
        const email = (c.email || '').toLowerCase();
        const family = (c.familyGroup || '').toLowerCase();
        return name.includes(query) || subjects.includes(query) || email.includes(query) || family.includes(query);
      });
    }

    // Update count
    const countEl = $('client-count');
    if (countEl) countEl.textContent = filtered.length;

    if (filtered.length === 0) {
      grid.innerHTML = '<div class="empty-state-block">' +
        '<p>' + (query ? 'No clients match your search.' : 'No clients yet. Click <strong>Add Client</strong> to get started.') + '</p></div>';
      return;
    }

    // Inactive clients sit in a collapsed section at the bottom. Keep it open across
    // re-renders if the user opened it, and open it while searching so matches are not hidden.
    const prevInactive = grid.querySelector('.inactive-clients');
    const inactiveOpen = !!query || !!(prevInactive && prevInactive.open);
    const inactive = filtered.filter((c) => c.status === 'inactive');
    const shown = filtered.filter((c) => c.status !== 'inactive');

    let html = renderClientGroup(shown);
    if (inactive.length) {
      html += '<details class="inactive-clients"' + (inactiveOpen ? ' open' : '') + '>' +
        '<summary>Inactive clients <span class="badge">' + inactive.length + '</span></summary>' +
        '<div class="clients-grid">' + renderClientGroup(inactive) + '</div>' +
        '</details>';
    }

    grid.innerHTML = html;

    // Update family datalist
    updateFamilyDatalist();
  }

  function renderClientGroup(list) {
    // Group by family
    const families = {};
    const noFamily = [];
    list.forEach((c) => {
      const fg = (c.familyGroup || '').trim();
      if (fg) {
        if (!families[fg]) families[fg] = [];
        families[fg].push(c);
      } else {
        noFamily.push(c);
      }
    });

    let html = '';

    // Family groups
    Object.keys(families).sort().forEach((fam) => {
      html += '<div class="family-group">';
      html += '<h3 class="family-header">' + escapeHtml(fam) + ' <span class="badge">' + families[fam].length + '</span></h3>';
      html += '<div class="family-members">';
      families[fam].forEach((c) => { html += renderClientCard(c); });
      html += '</div></div>';
    });

    // Individual clients
    noFamily.forEach((c) => { html += renderClientCard(c); });

    return html;
  }

  function renderClientCard(c) {
    const sessions = App.state.sessions;
    const name = clientName(c);
    const completedForClient = sessions.filter((s) => (s.clientIds || []).some((cid) => String(cid) === String(c.id)) && s.status === 'completed');
    const sessionCount = completedForClient.length;
    const statusClass = 'status-' + escapeHtml(c.status || 'active');

    // Sessions this month (momentum at a glance)
    const monthKey = App.currentMonth();
    const thisMonthCount = completedForClient.filter((s) => s.date && s.date.slice(0, 7) === monthKey).length;

    // No role="button"/tabindex here: the card holds real Edit/View/Delete buttons,
    // and a role="button" must not contain focusable descendants. The card stays
    // mouse-clickable via data-action; keyboard users use the labelled Edit button.
    return '<article class="client-card" data-action="edit-client" data-id="' + escapeHtml(c.id) + '">' +
      '<div class="client-avatar">' + escapeHtml(initials(c)) + '</div>' +
      '<div class="client-info">' +
        '<div class="client-name-row">' +
          '<strong class="client-name">' + escapeHtml(name) + '</strong>' +
          // Active is the norm, so only paused/inactive get a badge; keeps every card one name line tall.
          ((c.status || 'active') !== 'active' ? '<span class="status-badge ' + statusClass + '">' + escapeHtml(c.status) + '</span>' : '') +
        '</div>' +
        '<div class="client-details">' +
          (c.rate ? '<span>' + formatCurrency(c.rate) + '/hr</span>' : '') +
          (c.subjects ? '<span class="client-subjects">' + escapeHtml(c.subjects) + '</span>' : '') +
          (Array.isArray(c.slots) ? c.slots.map((slot) => '<span class="client-slot-line">' + escapeHtml(slotLine(slot)) + '</span>').join('') : '') +
        '</div>' +
        '<div class="client-meta">' +
          '<span>' + sessionCount + ' session' + (sessionCount !== 1 ? 's' : '') + '</span>' +
          '<span class="client-month-count">' + thisMonthCount + ' this month</span>' +
          (c.email ? '<span>' + escapeHtml(c.email) + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="client-actions">' +
        '<button class="btn btn-sm btn-icon" data-action="edit-client" data-id="' + escapeHtml(c.id) + '" title="Edit" aria-label="Edit ' + escapeHtml(name) + '">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>' +
        '</button>' +
        '<button class="btn btn-sm btn-icon" data-action="view-client-sessions" data-id="' + escapeHtml(c.id) + '" title="View sessions" aria-label="View sessions for ' + escapeHtml(name) + '">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>' +
        '</button>' +
        '<button class="btn btn-sm btn-icon btn-danger" data-action="delete-client" data-id="' + escapeHtml(c.id) + '" title="Retire" aria-label="Retire ' + escapeHtml(name) + '">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>' +
        '</button>' +
      '</div>' +
    '</article>';
  }

  /**
   * Smart family suggestion. Looks at the last name currently typed in the
   * client-name field, finds other clients who share it, and (if the family
   * field is empty) auto-fills the best family group. Always surfaces a hint.
   * @param {boolean} autofill - when true, write into the empty family field.
   */
  function suggestFamily(autofill) {
    const clients = App.state.clients;
    const nameEl = $('client-name');
    const familyEl = $('client-family');
    const hintEl = $('client-family-suggest');
    if (!nameEl || !familyEl) return;

    if (hintEl) { hintEl.hidden = true; hintEl.textContent = ''; }

    const nameVal = (nameEl.value || '').trim();
    if (!nameVal) return;

    const parts = nameVal.split(/\s+/);
    const lastName = parts.length > 1 ? parts.slice(1).join(' ') : '';
    if (!lastName) return; // need a surname to match on

    const editingId = $('client-id').value;
    const lastLc = lastName.toLowerCase();

    // Other clients (not the one being edited) who share this last name
    const relatives = clients.filter((c) =>
      String(c.id) !== String(editingId) &&
      (c.lastName || '').trim().toLowerCase() === lastLc
    );
    if (relatives.length === 0) return;

    // Prefer an existing family group already used by a relative; else "{Last} Family"
    const existingGroup = relatives.map((c) => (c.familyGroup || '').trim()).find(Boolean);
    const suggested = existingGroup || (lastName + ' Family');
    const relativeNames = relatives.map((c) => clientName(c)).join(', ');

    const familyEmpty = !(familyEl.value || '').trim();

    if (autofill && familyEmpty) {
      familyEl.value = suggested;
    }

    if (hintEl) {
      const filled = App.familyKey(familyEl.value) === App.familyKey(suggested);
      hintEl.innerHTML = (filled ? '&#10003; Grouped with ' : 'Same family as ') +
        escapeHtml(relativeNames) +
        (filled ? '' : ' &mdash; <button type="button" class="btn-link-inline" data-action="apply-family-suggest" data-family="' +
          escapeHtml(suggested) + '">Add to ' + escapeHtml(suggested) + '</button>');
      hintEl.hidden = false;
    }
  }

  function updateFamilyDatalist() {
    const clients = App.state.clients;
    const dl = $('family-list');
    if (!dl) return;
    const groups = new Set(clients.map((c) => (c.familyGroup || '').trim()).filter(Boolean));
    dl.innerHTML = Array.from(groups).sort().map((g) =>
      '<option value="' + escapeHtml(g) + '">').join('');
  }

  let clientFormRevision;

  /* ---- Weekly schedule (slice E3): slots edited in the client modal ----
     formSlots is this form's own working copy: [{ key, slot, original }]. `original` is the stored JSON of
     a slot as loaded (null for a new one). Save keeps an unchanged slot byte-identical and gives any
     edited or new slot a fresh id and through:null; the planner then replaces its pristine future rows. */
  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const SLOT_TYPES = [['in-person', 'In person'], ['online', 'Online'], ['hybrid', 'Hybrid'], ['group', 'Group']];
  const DURATION_CHIPS = [0.5, 1, 1.5, 2];
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  let formSlots = [];
  let formSlotKey = 0;

  /** First date on or after `from` that falls on weekday `day` (0 = Monday). */
  function nextOnOrAfter(from, day) {
    const wp = App.weekPlan;
    return wp.isoOf(wp.dayNum(from) + ((day - wp.weekdayOf(from) + 7) % 7));
  }
  function timeLabel(hhmm) {
    const m = /^(\d{2}):(\d{2})$/.exec(hhmm || '');
    if (!m) return String(hhmm || '');
    const h = Number(m[1]);
    return (h % 12 || 12) + ':' + m[2] + ' ' + (h < 12 ? 'AM' : 'PM');
  }
  /** "Tue 4:00 PM weekly" / "Tue 4:00 PM every 2 weeks". */
  function slotLine(slot) {
    if (!slot || !ISO_DATE.test(slot.anchor || '')) return 'Weekly slot';
    return DAY_LABELS[App.weekPlan.weekdayOf(slot.anchor)] + ' ' + timeLabel(slot.time) + (slot.every === 2 ? ' every 2 weeks' : ' weekly');
  }

  /** Same-family active clients other than the one being edited (the "Also attending" candidates). */
  function familyMates() {
    const key = App.familyKey($('client-family').value || '');
    const editing = $('client-id').value;
    if (!key) return [];
    return App.state.clients.filter((c) => String(c.id) !== String(editing) && (c.status || 'active') === 'active' && App.familyKey(c.familyGroup) === key);
  }

  /** A new slot starts from this client's usual session (time, duration, type, sibling set) when one exists. */
  function newSlotDefaults() {
    const today = App.todayISO();
    const slot = { id: 'new', anchor: today, every: 1, time: '16:00', duration: num(App.state.settings && App.state.settings.defaultDuration) || 1, type: 'in-person', with: [], through:null };
    const editing = $('client-id').value;
    if (!editing) return slot;
    const mates = new Set(familyMates().map((c) => String(c.id)));
    const fits = (sig) => sig.clientIds.map(String).includes(String(editing)) && sig.clientIds.every((id) => String(id) === String(editing) || mates.has(String(id)));
    const wp = App.weekPlan;
    const sig = App.sessionSignatures(App.state.sessions, App.state.clients, wp.isoOf(wp.dayNum(today) - 90)).find(fits) ||
      App.sessionSignatures(App.state.sessions, App.state.clients).find(fits);
    if (!sig) return slot;
    if (/^\d{2}:\d{2}$/.test(sig.time || '')) slot.time = sig.time;
    if (sig.duration > 0) slot.duration = sig.duration;
    if (SLOT_TYPES.some((t) => t[0] === sig.type)) slot.type = sig.type;
    slot.with = sig.clientIds.map(String).filter((id) => id !== String(editing));
    const top = Math.max(...sig.weekdays);
    if (top > 0) slot.anchor = nextOnOrAfter(today, sig.weekdays.indexOf(top));
    return slot;
  }

  function renderSlotRows() {
    const list = $('client-slot-list');
    if (!list) return;
    const mates = familyMates();
    list.innerHTML = formSlots.map((entry, i) => {
      const slot = entry.slot, k = escapeHtml(entry.key);
      const attr = (field) => ' data-slot-key="' + k + '" data-slot-field="' + field + '"';
      const day = ISO_DATE.test(slot.anchor || '') ? App.weekPlan.weekdayOf(slot.anchor) : -1;
      const sel = (cond) => (cond ? ' selected' : '');
      return '<div class="slot-row" data-slot-row="' + k + '">' +
        '<div class="slot-row-head"><strong>Slot ' + (i + 1) + '</strong>' +
          '<button type="button" class="btn btn-sm btn-icon" data-action="remove-client-slot" data-slot-key="' + k + '" aria-label="Remove weekly slot ' + (i + 1) + '">&times;</button></div>' +
        '<div class="slot-grid">' +
          '<label>Day<select class="input"' + attr('day') + '>' + DAY_NAMES.map((n, d) => '<option value="' + d + '"' + sel(d === day) + '>' + n + '</option>').join('') + '</select></label>' +
          '<label>Time<input type="time" class="input"' + attr('time') + ' value="' + escapeHtml(slot.time || '') + '"></label>' +
          '<label>Type<select class="input"' + attr('type') + '>' + SLOT_TYPES.map((t) => '<option value="' + t[0] + '"' + sel(slot.type === t[0]) + '>' + t[1] + '</option>').join('') + '</select></label>' +
          '<label>Every<select class="input"' + attr('every') + '><option value="1"' + sel(slot.every === 1) + '>Weekly</option><option value="2"' + sel(slot.every === 2) + '>Every 2 weeks</option></select></label>' +
          '<label>First session<input type="date" class="input"' + attr('anchor') + ' value="' + escapeHtml(slot.anchor || '') + '"></label>' +
        '</div>' +
        '<div class="slot-duration"><span class="slot-label">Duration (hours)</span><div class="duration-chips" role="group" aria-label="Quick duration">' +
          DURATION_CHIPS.map((d) => '<button type="button" class="duration-chip' + (slot.duration === d ? ' selected' : '') + '" data-action="set-slot-duration" data-slot-key="' + k + '" data-hours="' + d + '" aria-pressed="' + (slot.duration === d) + '">' + d + ' h</button>').join('') +
          '<input type="number" class="input slot-duration-input" min="0.25" step="0.25"' + attr('duration') + ' value="' + escapeHtml(slot.duration) + '" aria-label="Duration in hours"></div></div>' +
        (mates.length ? '<div class="slot-with"><span class="slot-label">Also attending</span><div class="client-picker">' + mates.map((c) => {
          const on = (slot.with || []).map(String).includes(String(c.id));
          return '<button type="button" class="client-pick' + (on ? ' selected' : '') + '" data-action="toggle-slot-with" data-slot-key="' + k + '" data-id="' + escapeHtml(c.id) + '" aria-pressed="' + on + '">' +
            '<span class="client-pick-name">' + escapeHtml(clientName(c)) + '</span></button>';
        }).join('') + '</div></div>' : '') +
      '</div>';
    }).join('');
  }

  function updateSlotsPaused() {
    const note = $('client-slots-paused');
    if (note) note.hidden = ($('client-status').value || 'active') === 'active';
  }

  const slotEntry = (key) => formSlots.find((e) => e.key === String(key)) || null;

  function onSlotClick(event) {
    const target = event.target && event.target.closest ? event.target.closest('[data-action]') : null;
    if (!target) return;
    const action = target.getAttribute('data-action');
    if (action === 'add-client-slot') {
      formSlots = formSlots.concat([{ key: String(++formSlotKey), slot: newSlotDefaults(), original: null }]);
      renderSlotRows();
      return;
    }
    const entry = slotEntry(target.getAttribute('data-slot-key'));
    if (!entry) return;
    if (action === 'remove-client-slot') formSlots = formSlots.filter((e) => e !== entry);
    else if (action === 'set-slot-duration') entry.slot.duration = Number(target.getAttribute('data-hours'));
    else if (action === 'toggle-slot-with') {
      const id = String(target.getAttribute('data-id'));
      const has = (entry.slot.with || []).map(String).includes(id);
      entry.slot.with = has ? entry.slot.with.filter((x) => String(x) !== id) : (entry.slot.with || []).concat([id]);
    } else return;
    renderSlotRows();
  }

  /** change/input from any slot control (delegated on body, so the rows can be re-rendered freely). */
  function onSlotInput(event) {
    const target = event.target;
    if (!target) return;
    if (target.id === 'client-status') { updateSlotsPaused(); return; }
    if (target.id === 'client-family') { if (event.type === 'change') renderSlotRows(); return; }
    const field = target.getAttribute && target.getAttribute('data-slot-field');
    const entry = field && slotEntry(target.getAttribute('data-slot-key'));
    if (!entry) return;
    const slot = entry.slot, value = target.value, committed = event.type === 'change';
    if (field === 'time') slot.time = value;
    else if (field === 'type') slot.type = value;
    else if (field === 'every') slot.every = Number(value);
    else if (field === 'duration') { const n = Number(value); slot.duration = value !== '' && Number.isFinite(n) ? n : 0; if (committed) renderSlotRows(); }
    else if (field === 'anchor') { slot.anchor = value; if (committed) renderSlotRows(); }
    else if (field === 'day') { slot.anchor = nextOnOrAfter(App.todayISO(), Number(value)); renderSlotRows(); }
  }

  if (document.body && document.body.addEventListener) {
    document.body.addEventListener('click', onSlotClick);
    document.body.addEventListener('change', onSlotInput);
    document.body.addEventListener('input', onSlotInput);
  }

  /** The slots to store: unchanged ones byte-identical, edited/new ones with a fresh id and through:null. */
  function slotsToSave() {
    return formSlots.map((entry) => {
      if (entry.original !== null && JSON.stringify(entry.slot) === entry.original) return JSON.parse(entry.original);
      return { ...JSON.parse(JSON.stringify(entry.slot)), id: generateId(), through:null };
    });
  }

  function renderLegacyClientDetails(client) {
    const section = $('client-legacy-details');
    const content = $('client-legacy-content');
    if (!section || !content) return;
    // The repository preserves these original fields, including unknown keys,
    // nested data, nulls and explicit zeroes. Do not infer or normalize values.
    const entries = client ? Object.entries(client).filter(([key]) => /company|split/i.test(key)) : [];
    content.textContent = entries.length ? JSON.stringify(Object.fromEntries(entries), null, 2) : '';
    section.hidden = entries.length === 0;
  }

  function openClientForm(id) {
    clientFormRevision = App.repository.revision;
    const clients = App.state.clients;

    const modal = $('modal-client');
    const title = $('modal-client-title');
    const form = $('client-form');
    if (!modal || !form) return;

    form.reset();
    $('client-id').value = '';
    formSlots = [];
    renderLegacyClientDetails(null);
    const more = $('client-more');
    if (more) more.open = false;

    if (id) {
      const c = clients.find((cl) => String(cl.id) === String(id));
      if (!c) return;
      if (title) title.textContent = 'Edit Client';

      $('client-id').value = c.id;

      // Parse name
      const nameInput = $('client-name');
      if (nameInput) nameInput.value = clientName(c);

      $('client-email').value = c.email || '';
      $('client-phone').value = c.phone || '';
      $('client-address').value = c.address || '';
      $('client-rate').value = c.rate || '';
      $('client-subjects').value = c.subjects || '';
      $('client-goals').value = c.goals || '';
      // Rarely used fields stay folded unless this client already has something in them.
      if (more) more.open = !!(c.subjects || c.goals);
      $('client-family').value = c.familyGroup || '';
      $('client-status').value = c.status || 'active';
      $('client-default-payment-method').value = c.defaultPaymentMethod || '';
      renderLegacyClientDetails(c);
      formSlots = (Array.isArray(c.slots) ? c.slots : []).map((slot) => {
        const copy = JSON.parse(JSON.stringify(slot));
        return { key: String(++formSlotKey), slot: copy, original: JSON.stringify(copy) };
      });
    } else {
      if (title) title.textContent = 'Add Client';
    }

    renderSlotRows();
    updateSlotsPaused();
    updateFamilyDatalist();
    // Surface family grouping hint (don't auto-fill an existing client's blank field)
    suggestFamily(false);
    App.openModal('modal-client');
  }

  async function saveClient() {
    const revision = clientFormRevision;

    const nameVal = ($('client-name').value || '').trim();
    const rate = $('client-rate').value;

    if (!nameVal) {
      App.showToast('Client name is required', 'error');
      $('client-name').focus();
      return;
    }
    if (!rate || num(rate) <= 0) {
      App.showToast('Valid hourly rate is required', 'error');
      $('client-rate').focus();
      return;
    }

    const parts = nameVal.split(/\s+/);
    const firstName = parts[0] || '';
    const lastName = parts.slice(1).join(' ') || '';

    const id = $('client-id').value;
    const isNew = !id;

    const slots = slotsToSave();
    for (let i = 0; i < slots.length; i++) {
      const problem = App.recurring.slotProblem(slots[i]);
      if (problem) { App.showToast('Weekly slot ' + (i + 1) + ': ' + problem, 'error'); return; }
    }

    const clientData = {
      id: id || generateId(),
      firstName,
      lastName,
      email: ($('client-email').value || '').trim(),
      phone: ($('client-phone').value || '').trim(),
      address: ($('client-address').value || '').trim(),
      rate: num(rate),
      subjects: ($('client-subjects').value || '').trim(),
      goals: ($('client-goals').value || '').trim(),
      // Joins an existing family's spelling if only casing/spacing differs.
      familyGroup: App.canonicalFamily($('client-family').value, id || null),
      status: $('client-status').value || 'active',
      // Slice D: how this family usually pays; pre-fills the Record payment modal. '' = not set.
      defaultPaymentMethod: ($('client-default-payment-method').value || '').trim(),
      // Slice E3: weekly slots. Unchanged ones are byte-identical; edited or new ones carry a fresh id and through:null.
      slots,
      updatedAt: new Date().toISOString(),
    };

    if (isNew) clientData.createdAt = new Date().toISOString();
    if (await App.runCommand('client.save', { record: clientData }, revision)) {
      App.closeModal('modal-client');
      App.showToast(isNew ? 'Client added' : 'Client updated', 'success');
      App.runRecurringPass().catch(() => {});
    }
  }

  function deleteClient(id) {
    const revision = App.repository.revision;
    const c = App.state.clients.find((cl) => String(cl.id) === String(id));
    if (!c) return;
    const name = clientName(c);
    App.showConfirm(
      'Retire Client',
      'Mark ' + name + ' inactive? Their sessions and records will be kept.',
      async () => {
        if (await App.runCommand('client.retire', { id }, revision)) {
          App.showToast(name + ' marked inactive', 'success');
          App.runRecurringPass().catch(() => {});
        }
      }
    );
  }

  // Expose to App namespace
  App.renderClients = renderClients;
  App.openClientForm = openClientForm;
  App.saveClient = saveClient;
  App.deleteClient = deleteClient;
  App.updateFamilyDatalist = updateFamilyDatalist;
  App.suggestFamily = suggestFamily;

})();
