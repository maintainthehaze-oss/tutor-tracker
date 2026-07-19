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
  const formatDate = App.formatDate;
  const todayISO = App.todayISO;
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

    // Group by family
    const families = {};
    const noFamily = [];
    filtered.forEach((c) => {
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

    grid.innerHTML = html;

    // Update family datalist
    updateFamilyDatalist();
  }

  function renderClientCard(c) {
    const sessions = App.state.sessions;
    const name = clientName(c);
    const completedForClient = sessions.filter((s) => (s.clientIds || []).some((cid) => String(cid) === String(c.id)) && s.status === 'completed');
    const sessionCount = completedForClient.length;
    const splitText = c.companySplit ? c.companySplit + '% split' : '';
    const statusClass = 'status-' + (c.status || 'active');

    // Sessions this month (momentum at a glance)
    const now = new Date();
    const monthKey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const thisMonthCount = completedForClient.filter((s) => s.date && s.date.slice(0, 7) === monthKey).length;

    // No role="button"/tabindex here: the card holds real Edit/View/Delete buttons,
    // and a role="button" must not contain focusable descendants. The card stays
    // mouse-clickable via data-action; keyboard users use the labelled Edit button.
    return '<article class="client-card" data-action="edit-client" data-id="' + escapeHtml(c.id) + '">' +
      '<div class="client-avatar">' + escapeHtml(initials(c)) + '</div>' +
      '<div class="client-info">' +
        '<div class="client-name-row">' +
          '<strong class="client-name">' + escapeHtml(name) + '</strong>' +
          '<span class="status-badge ' + statusClass + '">' + escapeHtml(c.status || 'active') + '</span>' +
        '</div>' +
        '<div class="client-details">' +
          (c.rate ? '<span>' + formatCurrency(c.rate) + '/hr</span>' : '') +
          (c.subjects ? '<span class="client-subjects">' + escapeHtml(c.subjects) + '</span>' : '') +
          (splitText ? '<span class="client-split">' + escapeHtml(splitText) + '</span>' : '') +
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
        '<button class="btn btn-sm btn-icon btn-danger" data-action="delete-client" data-id="' + escapeHtml(c.id) + '" title="Delete" aria-label="Delete ' + escapeHtml(name) + '">' +
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
      const filled = (familyEl.value || '').trim() === suggested;
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

  function openClientForm(id) {
    const clients = App.state.clients;

    const modal = $('modal-client');
    const title = $('modal-client-title');
    const form = $('client-form');
    if (!modal || !form) return;

    form.reset();
    $('client-id').value = '';
    $('split-history-tbody').innerHTML = '';
    const historyEl = $('split-history');
    if (historyEl) historyEl.hidden = true;

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
      $('client-family').value = c.familyGroup || '';
      $('client-company-name').value = c.companyName || '';
      $('client-company-pct').value = c.companySplit || '';
      $('client-split-effective').value = '';
      $('client-split-stop').value = '';
      $('client-status').value = c.status || 'active';

      // Split history
      if (c.splitHistory && c.splitHistory.length > 0) {
        $('split-history-tbody').innerHTML = c.splitHistory.map((sh) =>
          '<tr><td>' + escapeHtml(formatDate(sh.effectiveDate)) + '</td>' +
          '<td>' + (sh.stopDate ? escapeHtml(formatDate(sh.stopDate)) : '<em>Ongoing</em>') + '</td>' +
          '<td>' + escapeHtml(sh.company || c.companyName || '') + '</td>' +
          '<td>' + num(sh.split) + '%</td></tr>'
        ).join('');
      }
    } else {
      if (title) title.textContent = 'Add Client';
    }

    updateFamilyDatalist();
    // Surface family grouping hint (don't auto-fill an existing client's blank field)
    suggestFamily(false);
    App.openModal('modal-client');
  }

  function saveClient() {
    const clients = App.state.clients;

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
      familyGroup: ($('client-family').value || '').trim(),
      companyName: ($('client-company-name').value || '').trim(),
      companySplit: num($('client-company-pct').value),
      status: $('client-status').value || 'active',
      createdAt: isNew ? new Date().toISOString() : undefined,
      updatedAt: new Date().toISOString(),
    };

    const splitStopDate = ($('client-split-stop').value || '').trim() || null;

    if (isNew) {
      clientData.splitHistory = [];
      if (clientData.companySplit > 0) {
        clientData.splitHistory.push({
          split: clientData.companySplit,
          company: clientData.companyName,
          effectiveDate: $('client-split-effective').value || todayISO(),
          stopDate: splitStopDate,
        });
      }
      clients.push(clientData);
    } else {
      const idx = clients.findIndex((c) => String(c.id) === String(id));
      if (idx === -1) return;
      const existing = clients[idx];

      // Check if split changed
      const newSplit = clientData.companySplit;
      const oldSplit = existing.companySplit || 0;
      clientData.splitHistory = existing.splitHistory || [];
      clientData.createdAt = existing.createdAt;

      if (newSplit !== oldSplit || splitStopDate) {
        const effectiveDate = $('client-split-effective').value || todayISO();
        // If there's a previous entry without a stop date, set its stop to the new effective date
        if (clientData.splitHistory.length > 0) {
          const lastEntry = clientData.splitHistory[clientData.splitHistory.length - 1];
          if (!lastEntry.stopDate && newSplit !== oldSplit) {
            lastEntry.stopDate = effectiveDate;
          }
        }
        clientData.splitHistory.push({
          split: newSplit,
          company: clientData.companyName,
          effectiveDate,
          stopDate: splitStopDate,
        });
      }

      clients[idx] = clientData;

      // Offer to propagate split to family members
      if (newSplit !== oldSplit && clientData.familyGroup) {
        const familyMembers = clients.filter((c) =>
          String(c.id) !== String(id) && c.familyGroup === clientData.familyGroup
        );
        if (familyMembers.length > 0) {
          App.showConfirm(
            'Update Family Split?',
            'Apply the new ' + newSplit + '% split to all ' + familyMembers.length + ' other member(s) in the ' + clientData.familyGroup + ' family?',
            () => {
              const effectiveDate = $('client-split-effective').value || todayISO();
              familyMembers.forEach((fm) => {
                // Close the previous entry
                if (fm.splitHistory && fm.splitHistory.length > 0) {
                  const last = fm.splitHistory[fm.splitHistory.length - 1];
                  if (!last.stopDate) last.stopDate = effectiveDate;
                }
                fm.companySplit = newSplit;
                fm.companyName = clientData.companyName;
                fm.splitHistory = fm.splitHistory || [];
                fm.splitHistory.push({
                  split: newSplit,
                  company: clientData.companyName,
                  effectiveDate,
                  stopDate: splitStopDate,
                });
                fm.updatedAt = new Date().toISOString();
              });
              App.saveAndRender();
              App.showToast('Split updated for entire family', 'success');
            }
          );
        }
      }
    }

    App.closeModal('modal-client');
    App.saveAndRender();
    App.showToast(isNew ? 'Client added' : 'Client updated', 'success');
  }

  function deleteClient(id) {
    const clients = App.state.clients;
    const sessions = App.state.sessions;

    const c = clients.find((cl) => String(cl.id) === String(id));
    if (!c) return;
    const name = clientName(c);
    const sessionCount = sessions.filter((s) => (s.clientIds || []).some((cid) => String(cid) === String(id))).length;

    App.showConfirm(
      'Delete Client',
      'Delete ' + name + '?' + (sessionCount > 0 ? ' This will also remove ' + sessionCount + ' associated session(s).' : ''),
      () => {
        App.state.clients = clients.filter((cl) => String(cl.id) !== String(id));
        App.state.sessions = sessions.filter((s) => {
          if (!s.clientIds) return true;
          s.clientIds = s.clientIds.filter((cid) => String(cid) !== String(id));
          return s.clientIds.length > 0;
        });
        App.saveAndRender();
        App.showToast(name + ' deleted', 'success');
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
