/* ============================================================
   Tutoring Tracker Pro — Family payment intake + monthly statement
   (Slice D, 2026-10-11)

   "Record payment" on the Owed panel: amount received + date + method,
   allocated OLDEST-FIRST across the family's OWN unpaid sessions. Whole
   sessions only: an amount that lands part-way through a session is refused
   with the two nearest whole amounts, and an amount above what is owed is
   refused too. One `session.payment` event per covered session, dated the
   day the money arrived (cash basis: a January payment belongs to January's
   tax year, audit 6e). Sessions shared with another family are never touched
   here; the table marks those.

   Statement PDF per family + month: rows and month totals come from
   computeMetrics, the balance due comes from computeOwedByFamily, so the
   statement cannot disagree with the Owed panel. No new money math: the only
   arithmetic is the even multi-client split computeMetrics already uses, and
   cents comparisons go through App.roundCents.

   Pure model functions first; the only write is App.runCommand (session.payment).
   ============================================================ */
(function () {
  'use strict';

  const App = window.App;
  const $ = App.$;
  const num = App.num;
  const escapeHtml = App.escapeHtml;
  const formatCurrency = App.formatCurrency;
  const formatDate = App.formatDate;
  const formatDuration = App.formatDuration;
  const todayISO = App.todayISO;
  const clientName = App.clientName;

  /** Options offered by the Record payment modal and the client form. Stored as plain labels. */
  const PAYMENT_METHODS = Object.freeze(['Cash', 'Check', 'Venmo', 'Zelle', 'PayPal', 'Card', 'Other']);

  let paymentRevision = null;

  const cents = (n) => App.roundCents(n);
  const byDateThenId = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 :
    String(a.time || '') < String(b.time || '') ? -1 : String(a.time || '') > String(b.time || '') ? 1 :
    String(a.id).localeCompare(String(b.id)));
  const findClient = (id) => (App.state.clients || []).find((c) => String(c.id) === String(id));
  const inGroup = (key) => (id) => { const c = findClient(id); return !!c && App.groupKeyForClient(c) === key; };

  /* ---------- Pure model ---------- */

  /**
   * Oldest-first allocation of `amount` across `sessions` (the family's own unpaid rows).
   * Whole sessions only. Returns:
   *   ordered   the rows oldest first
   *   covered   the rows this amount pays for (a prefix of `ordered`)
   *   total     what the covered rows add up to (cents)
   *   owed      what every row adds up to (cents)
   *   exact     amount pays for at least one row and nothing is left over
   *   over      amount is more than everything owed
   *   next      the first row NOT covered (null when all are)
   * Pure: no state, no writes.
   */
  function allocatePayment(sessions, amount) {
    const received = cents(amount);
    const ordered = (sessions || []).slice().sort(byDateThenId);
    const covered = [];
    let running = 0;
    for (const s of ordered) {
      const next = running + num(s.amount);
      if (cents(next) > received) break;
      running = next;
      covered.push(s);
    }
    const owed = cents(ordered.reduce((sum, s) => sum + num(s.amount), 0));
    const total = cents(running);
    const remainder = cents(received - total);
    return {
      ordered, covered, total, owed, received, remainder,
      over: received > owed,
      exact: received > 0 && covered.length > 0 && remainder === 0,
      next: ordered[covered.length] || null,
    };
  }

  /** The family's usual method: the first member (active members first) with a defaultPaymentMethod set. */
  function familyDefaultMethod(key) {
    const members = (App.state.clients || []).filter((c) => App.groupKeyForClient(c) === key);
    const rank = (c) => (c.status === 'active' || c.status == null ? 0 : 1);
    const found = members.slice().sort((a, b) => rank(a) - rank(b)).find((c) => c.defaultPaymentMethod && String(c.defaultPaymentMethod).trim());
    return found ? String(found.defaultPaymentMethod).trim() : '';
  }

  /** Every group (family or solo client) that could receive a statement: active and paused clients. */
  function statementGroups() {
    const seen = new Map();
    (App.state.clients || []).forEach((c) => {
      if (c.status === 'inactive') return;
      const key = App.groupKeyForClient(c);
      if (!seen.has(key)) seen.set(key, { key, label: App.groupLabelForClient(c) });
    });
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  /**
   * Statement for one group and one 'YYYY-MM': the month's completed sessions touching the group
   * (same rows computeMetrics counts), month totals from that group's rollup, and the balance due
   * ALL TIME straight from computeOwedByFamily, so it equals the Owed panel by construction.
   */
  function statementModel(key, month) {
    const m = App.computeMetrics({ month });
    const group = m.groups.find((g) => g.key === key) || null;
    const mine = inGroup(key);
    const rows = m.sessions.filter((s) => (s.clientIds || []).some(mine)).sort(byDateThenId).map((s) => {
      const ids = s.clientIds || [];
      const members = ids.filter(mine).length;
      const shared = members < ids.length;
      // The even multi-client split computeMetrics uses; pinned equal to the group rollup by a test.
      const share = ids.length ? App.revenueAmount(s) / ids.length * members : 0;
      return {
        id: s.id, date: s.date, time: s.time || '',
        clients: ids.map(findClient).filter(Boolean).map(clientName).join(' + '),
        duration: num(s.duration), amount: App.revenueAmount(s), share, shared,
        waived: App.isWaived(s), paid: !!s.paid, paymentDate: s.paymentDate || '', paymentMethod: s.paymentMethod || '',
      };
    });
    const owedGroup = App.computeOwedByFamily().groups.find((g) => g.key === key) || null;
    const label = group ? group.label : (statementGroups().find((g) => g.key === key) || { label: key }).label;
    return {
      key, label, month,
      rows,
      charged: group ? group.gross : 0,
      unpaid: group ? group.outstanding : 0,
      paid: group ? group.gross - group.outstanding : 0,
      balance: owedGroup ? owedGroup.amount : 0,
      balanceCount: owedGroup ? owedGroup.count : 0,
    };
  }

  /* ---------- Record payment modal ---------- */

  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

  function methodOptions(selected) {
    const list = PAYMENT_METHODS.includes(selected) || !selected ? PAYMENT_METHODS : [selected, ...PAYMENT_METHODS];
    return '<option value="">(none)</option>' + list.map((m) =>
      '<option value="' + escapeHtml(m) + '"' + (m === selected ? ' selected' : '') + '>' + escapeHtml(m) + '</option>').join('');
  }

  function openRecordPayment(key, label) {
    const { own, shared } = App.owedSessionsForGroup(key);
    if (own.length === 0) {
      if (shared.length) App.showToast(plural(shared.length, 'session') + ' for ' + label + ' also bill another family. Mark those paid from the table.', 'error');
      else App.showToast('Nothing owed for ' + label, 'info');
      return;
    }
    paymentRevision = App.repository.revision;
    const allocation = allocatePayment(own, Number.MAX_SAFE_INTEGER);
    const title = $('modal-record-payment-title');
    if (title) title.textContent = 'Record payment — ' + label;
    $('record-payment-key').value = key;
    $('record-payment-label').value = label;
    let owedText = plural(own.length, 'unpaid session') + ' · ' + formatCurrency(allocation.owed) + ' owed';
    if (shared.length) owedText += '. ' + plural(shared.length, 'session') + ' shared with another family stay unpaid here; mark those from the table.';
    $('record-payment-owed').textContent = owedText;
    $('record-payment-amount').value = allocation.owed.toFixed(2);
    $('record-payment-date').value = todayISO();
    const method = $('record-payment-method');
    const usual = familyDefaultMethod(key);
    if (method) { method.innerHTML = methodOptions(usual); method.value = usual; }
    previewRecordPayment();
    App.openModal('modal-record-payment');
  }

  /** Live preview under the amount: which sessions this amount pays for, or why it is refused. */
  function previewRecordPayment() {
    const box = $('record-payment-preview');
    const save = $('record-payment-save');
    if (!box) return null;
    const key = $('record-payment-key').value;
    const { own } = App.owedSessionsForGroup(key);
    const amount = num($('record-payment-amount').value);
    const a = allocatePayment(own, amount);
    let html, ok = false;
    if (amount <= 0) {
      html = 'Enter the amount received.';
    } else if (a.over) {
      html = '<strong>' + formatCurrency(a.received) + ' is more than the ' + formatCurrency(a.owed) + ' owed.</strong> Enter ' + formatCurrency(a.owed) + ' or less; whole sessions only.';
    } else if (!a.exact) {
      const lower = a.covered.length ? formatCurrency(a.total) + ' pays ' + plural(a.covered.length, 'session') : 'no whole session';
      const upper = a.next ? formatCurrency(cents(a.total + num(a.next.amount))) + ' pays ' + plural(a.covered.length + 1, 'session') : '';
      html = '<strong>' + formatCurrency(a.received) + ' does not cover whole sessions.</strong> ' + lower + (upper ? '; ' + upper : '') + '.';
    } else {
      ok = true;
      html = 'Pays ' + plural(a.covered.length, 'session') + ', oldest first: ' +
        a.covered.map((s) => escapeHtml(formatDate(s.date)) + ' ' + formatCurrency(num(s.amount))).join(' · ') +
        (a.covered.length < a.ordered.length ? '. ' + plural(a.ordered.length - a.covered.length, 'session') + ' (' + formatCurrency(cents(a.owed - a.total)) + ') stay unpaid.' : '. Nothing left owed.');
    }
    box.innerHTML = html;
    box.classList.toggle('payment-preview-error', !ok);
    if (save) save.disabled = !ok;
    return ok ? a : null;
  }

  async function saveRecordPayment() {
    const revision = paymentRevision;
    const date = $('record-payment-date').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) { App.showToast('Date received is required', 'error'); $('record-payment-date').focus(); return false; }
    const a = previewRecordPayment();
    if (!a) { App.showToast('Enter an amount that covers whole sessions', 'error'); $('record-payment-amount').focus(); return false; }
    const method = ($('record-payment-method').value || '').trim();
    const payload = { ids: a.covered.map((s) => s.id), date };
    if (method) payload.method = method;
    if (!await App.runCommand('session.payment', payload, revision)) return false;
    App.closeModal('modal-record-payment');
    App.showToast('Recorded ' + formatCurrency(a.total) + ': ' + plural(a.covered.length, 'session') + ' paid', 'success');
    return true;
  }

  /* ---------- Statement PDF ---------- */

  function renderStatementControls() {
    const select = $('statement-family');
    if (!select) return;
    const groups = statementGroups();
    const current = select.value;
    select.innerHTML = groups.map((g) => '<option value="' + escapeHtml(g.key) + '">' + escapeHtml(g.label) + '</option>').join('');
    if (groups.some((g) => g.key === current)) select.value = current;
    const month = $('statement-month');
    if (month && !month.value) month.value = App.currentMonth();
  }

  function monthLabel(month) {
    const [y, m] = String(month).split('-').map(Number);
    if (!y || !m) return String(month);
    return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  function statementStatus(r) {
    if (r.waived) return 'Waived';
    if (r.paid) return 'Paid' + (r.paymentDate ? ' ' + formatDate(r.paymentDate) : '') + (r.paymentMethod ? ' · ' + r.paymentMethod : '');
    return 'Unpaid';
  }

  /** Builds the statement document with the given jsPDF constructor (injected so tests can capture it). */
  function buildStatementPDF(jsPDF, model) {
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text('Statement — ' + model.label, 14, 20);
    doc.setFontSize(10);
    doc.text(monthLabel(model.month) + ' · generated ' + new Date().toLocaleDateString(), 14, 28);
    const hasShared = model.rows.some((r) => r.shared);
    const head = ['Date', 'Client(s)', 'Hours', 'Amount'];
    if (hasShared) head.push('This family');
    head.push('Status');
    doc.autoTable({
      startY: 36,
      head: [head],
      body: model.rows.length ? model.rows.map((r) => {
        const row = [formatDate(r.date), r.clients, formatDuration(r.duration), formatCurrency(r.amount)];
        if (hasShared) row.push(r.shared ? formatCurrency(r.share) : '');
        row.push(statementStatus(r));
        return row;
      }) : [['No sessions this month', '', '', '', ...(hasShared ? [''] : []), '']],
      theme: 'grid',
      headStyles: { fillColor: [108, 99, 255] },
    });
    const y = doc.lastAutoTable.finalY + 10;
    doc.autoTable({
      startY: y,
      head: [['Summary', 'Amount']],
      body: [
        ['Charged this month', formatCurrency(model.charged)],
        ['Paid (of this month)', formatCurrency(model.paid)],
        ['Still unpaid (this month)', formatCurrency(model.unpaid)],
        ['Balance due, all time (' + plural(model.balanceCount, 'session') + ')', formatCurrency(model.balance)],
      ],
      theme: 'grid',
      headStyles: { fillColor: [108, 99, 255] },
    });
    if (hasShared) {
      doc.setFontSize(9);
      doc.text('"This family" is this family’s even share of a session billed to more than one family; totals use that share.', 14, doc.lastAutoTable.finalY + 8);
    }
    return doc;
  }

  function exportStatementPDF() {
    if (typeof window.jspdf?.jsPDF !== 'function' || typeof window.jspdf.jsPDF.API?.autoTable !== 'function') {
      App.showToast('PDF export unavailable in this preview.', 'error');
      return false;
    }
    const key = $('statement-family') ? $('statement-family').value : '';
    const month = $('statement-month') ? $('statement-month').value : '';
    if (!key) { App.showToast('Choose a family', 'error'); return false; }
    if (!/^\d{4}-\d{2}$/.test(month || '')) { App.showToast('Choose a month', 'error'); return false; }
    const model = statementModel(key, month);
    const doc = buildStatementPDF(window.jspdf.jsPDF, model);
    const slug = model.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'family';
    doc.save('statement-' + slug + '-' + month + '.pdf');
    App.showToast('Statement for ' + model.label + ', ' + monthLabel(month), 'success');
    return true;
  }

  App.PAYMENT_METHODS = PAYMENT_METHODS;
  App.allocatePayment = allocatePayment;
  App.familyDefaultMethod = familyDefaultMethod;
  App.statementGroups = statementGroups;
  App.statementModel = statementModel;
  App.openRecordPayment = openRecordPayment;
  App.previewRecordPayment = previewRecordPayment;
  App.saveRecordPayment = saveRecordPayment;
  App.renderStatementControls = renderStatementControls;
  App.buildStatementPDF = buildStatementPDF;
  App.exportStatementPDF = exportStatementPDF;
})();
