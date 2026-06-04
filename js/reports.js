/* ============================================================
   Tutoring Tracker Pro — Reports
   Reports and Tax Summary with PDF export
   ============================================================ */
(function () {
  'use strict';

  const App = window.App;
  const $ = App.$;
  const escapeHtml = App.escapeHtml;
  const formatCurrency = App.formatCurrency;
  const formatDate = App.formatDate;
  const formatDuration = App.formatDuration;
  const num = App.num;
  const clientName = App.clientName;
  const EXPENSE_CATEGORIES = App.EXPENSE_CATEGORIES;

  /* ==========================================================
     REPORTS
     ========================================================== */

  /** Read the current Reports filter-bar selections. */
  function getReportFilter() {
    const year = $('report-year') ? $('report-year').value : String(new Date().getFullYear());
    const monthSel = $('report-month') ? $('report-month').value : '';
    const family = $('report-family') ? $('report-family').value : '';
    const paid = $('report-paid') ? $('report-paid').value : '';
    const filter = { year, paid };
    if (monthSel) filter.month = year + '-' + monthSel;
    // family value is either "fam:<name>" for a family group or "cli:<id>" for an individual
    if (family.startsWith('fam:')) filter.family = family.slice(4);
    else if (family.startsWith('cli:')) filter.clientId = family.slice(4);
    return filter;
  }

  /** Populate the Family/Client filter dropdown from current clients. */
  function populateFamilyFilter() {
    const sel = $('report-family');
    if (!sel) return;
    const clients = App.state.clients;
    const current = sel.value;
    const families = [...new Set(clients.map((c) => App.clientFamily(c)).filter(Boolean))].sort();
    const loners = clients.filter((c) => !App.clientFamily(c)).sort((a, b) => clientName(a).localeCompare(clientName(b)));
    let html = '<option value="">All families</option>';
    families.forEach((f) => { html += '<option value="fam:' + escapeHtml(f) + '">' + escapeHtml(f) + '</option>'; });
    if (loners.length) {
      html += '<optgroup label="Individuals">';
      loners.forEach((c) => { html += '<option value="cli:' + escapeHtml(c.id) + '">' + escapeHtml(clientName(c)) + '</option>'; });
      html += '</optgroup>';
    }
    sel.innerHTML = html;
    sel.value = current; // preserve selection across re-renders
  }

  function renderReports() {
    const expenses = App.state.expenses;
    const settings = App.state.settings;

    populateFamilyFilter();
    const filter = getReportFilter();
    const year = parseInt(filter.year);

    // All money/session metrics come from the ONE shared model
    const M = App.computeMetrics(filter);

    // Expenses honor year + (optional) month. Expenses aren't per-client, so
    // family/client filters don't restrict them — note this in the label.
    let yearExpenses = expenses.filter((e) => e.date && e.date.slice(0, 4) === String(year));
    if (filter.month) yearExpenses = yearExpenses.filter((e) => e.date.slice(0, 7) === filter.month);
    const totalExpenses = yearExpenses.reduce((s, x) => s + num(x.amount), 0);
    const mileageDed = M.miles * settings.mileageRate;

    // Net profit = your cut (gross - company split) - expenses - mileage deduction
    const netProfit = M.yourCut - totalExpenses - mileageDed;

    // Summary cards
    const set = (id, val) => { const el = $(id); if (el) el.textContent = val; };
    set('report-total-income', formatCurrency(M.gross));
    set('report-company-split', formatCurrency(M.companySplit));
    set('report-your-cut', formatCurrency(M.yourCut));
    set('report-total-expenses', formatCurrency(totalExpenses));
    set('report-net-profit', formatCurrency(netProfit));
    set('report-total-sessions', M.sessionCount);
    set('report-total-miles', M.miles.toFixed(1));

    // Monthly breakdown — each month recomputed via the shared model (respects family/client/paid filters)
    const tbody = $('report-tbody');
    if (tbody) {
      let rows = '';
      for (let m = 0; m < 12; m++) {
        const monthKey = year + '-' + String(m + 1).padStart(2, '0');
        // If a specific month is selected, only show that one row
        if (filter.month && filter.month !== monthKey) continue;
        const mf = Object.assign({}, filter, { month: monthKey });
        const mm = App.computeMetrics(mf);
        const mExp = expenses
          .filter((e) => e.date && e.date.slice(0, 7) === monthKey)
          .reduce((s, x) => s + num(x.amount), 0);
        const monthName = new Date(year, m, 1).toLocaleDateString('en-US', { month: 'long' });
        rows +=
          '<tr>' +
            '<td>' + monthName + '</td>' +
            '<td>' + mm.sessionCount + '</td>' +
            '<td>' + formatDuration(mm.hours) + '</td>' +
            '<td>' + formatCurrency(mm.gross) + '</td>' +
            '<td>' + formatCurrency(mm.companySplit) + '</td>' +
            '<td>' + formatCurrency(mExp) + '</td>' +
            '<td>' + formatCurrency(mm.yourCut - mExp) + '</td>' +
            '<td>' + mm.miles.toFixed(1) + '</td>' +
            '<td>' + formatCurrency(mm.miles * settings.mileageRate) + '</td>' +
          '</tr>';
      }
      tbody.innerHTML = rows || '<tr><td colspan="9">No data for this selection</td></tr>';
    }

    // Footer totals
    set('report-foot-sessions', M.sessionCount);
    set('report-foot-hours', formatDuration(M.hours));
    set('report-foot-income', formatCurrency(M.gross));
    set('report-foot-split', formatCurrency(M.companySplit));
    set('report-foot-expenses', formatCurrency(totalExpenses));
    set('report-foot-net', formatCurrency(M.yourCut - totalExpenses));
    set('report-foot-miles', M.miles.toFixed(1));
    set('report-foot-mileage-ded', formatCurrency(mileageDed));

    // Family breakdown + per-client stats
    renderFamilyStats(M);
    renderClientStats(year, filter);
  }

  /** Render the per-family (or individual) rollup table from shared metrics. */
  function renderFamilyStats(M) {
    const tbody = $('family-stats-tbody');
    if (!tbody) return;

    const rows = M.groups;
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7">No data for this selection</td></tr>';
    } else {
      tbody.innerHTML = rows.map((g) =>
        '<tr>' +
          '<td>' + escapeHtml(g.key) + '</td>' +
          '<td>' + g.sessions + '</td>' +
          '<td>' + formatDuration(g.hours) + '</td>' +
          '<td>' + formatCurrency(g.gross) + '</td>' +
          '<td>' + formatCurrency(g.companySplit) + '</td>' +
          '<td>' + formatCurrency(g.yourCut) + '</td>' +
          '<td>' + (g.outstanding > 0 ? '<span class="owe">' + formatCurrency(g.outstanding) + '</span>' : '—') + '</td>' +
        '</tr>'
      ).join('');
    }

    const set = (id, val) => { const el = $(id); if (el) el.textContent = val; };
    set('family-foot-sessions', M.sessionCount);
    set('family-foot-hours', formatDuration(M.hours));
    set('family-foot-gross', formatCurrency(M.gross));
    set('family-foot-split', formatCurrency(M.companySplit));
    set('family-foot-cut', formatCurrency(M.yourCut));
    set('family-foot-outstanding', formatCurrency(M.outstanding));
  }

  function renderClientStats(year, filter) {
    const clients = App.state.clients;

    const tbody = $('client-stats-tbody');
    if (!tbody) return;

    // Use the shared metrics model's filtered session set so per-client stats
    // respect the same year/month/family/paid filters as everything else.
    const M = App.computeMetrics(filter || { year: String(year) });
    const yearSessions = M.sessions;

    const stats = {};
    yearSessions.forEach((s) => {
      (s.clientIds || []).forEach((cid) => {
        if (!stats[cid]) stats[cid] = { sessions: 0, hours: 0, revenue: 0, lastDate: '' };
        const share = num(s.amount) / (s.clientIds.length || 1);
        stats[cid].sessions++;
        stats[cid].hours += num(s.duration);
        stats[cid].revenue += share;
        if (s.date > stats[cid].lastDate) stats[cid].lastDate = s.date;
      });
    });

    const rows = Object.entries(stats)
      .map(([cid, st]) => {
        const c = clients.find((cl) => String(cl.id) === String(cid));
        return { name: c ? clientName(c) : 'Unknown', ...st };
      })
      .sort((a, b) => b.revenue - a.revenue);

    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6">No session data for this year</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map((r) =>
      '<tr>' +
        '<td>' + escapeHtml(r.name) + '</td>' +
        '<td>' + r.sessions + '</td>' +
        '<td>' + formatDuration(r.hours) + '</td>' +
        '<td>' + formatCurrency(r.revenue) + '</td>' +
        '<td>' + (r.hours > 0 ? formatCurrency(r.revenue / r.hours) + '/hr' : '-') + '</td>' +
        '<td>' + escapeHtml(formatDate(r.lastDate)) + '</td>' +
      '</tr>'
    ).join('');
  }

  /* ==========================================================
     TAX SUMMARY
     ========================================================== */

  function getTaxData(year) {
    const sessions = App.state.sessions;
    const expenses = App.state.expenses;
    const settings = App.state.settings;

    const yearStr = String(year);
    const yearSessions = sessions.filter((s) =>
      s.date && s.date.slice(0, 4) === yearStr && s.status === 'completed'
    );
    const yearExpenses = expenses.filter((e) => e.date && e.date.slice(0, 4) === yearStr);

    const grossIncome = yearSessions.reduce((s, x) => s + num(x.amount), 0);
    const companyTotal = yearSessions.reduce((s, x) => s + num(x.companyAmount), 0);
    const netIncome = grossIncome; // Company split is reported separately
    const totalMiles = yearSessions.reduce((s, x) => s + num(x.mileage), 0);
    const mileageDeduction = totalMiles * settings.mileageRate;

    // Categorize expenses
    const expByCategory = {};
    yearExpenses.forEach((e) => {
      const cat = e.category || 'other';
      expByCategory[cat] = (expByCategory[cat] || 0) + num(e.amount);
    });

    // Map to Schedule C lines
    const line9 = mileageDeduction;
    const line10 = companyTotal; // Commissions
    const line15 = expByCategory['insurance'] || 0;
    const line17 = expByCategory['professional'] || 0;
    const line18 = expByCategory['office'] || 0;
    const line22 = expByCategory['supplies'] || 0;
    const line25 = expByCategory['utilities'] || 0;

    // "Other" expenses for line 27a
    const mapped = ['insurance', 'professional', 'office', 'supplies', 'utilities'];
    const otherExpenses = {};
    yearExpenses.forEach((e) => {
      const cat = e.category || 'other';
      if (!mapped.includes(cat)) {
        const label = EXPENSE_CATEGORIES.find((c) => c.value === cat);
        const name = label ? label.label : cat;
        otherExpenses[name] = (otherExpenses[name] || 0) + num(e.amount);
      }
    });
    const line27a = Object.values(otherExpenses).reduce((s, v) => s + v, 0);

    const line28 = line9 + line10 + line15 + line17 + line18 + line22 + line25 + line27a;
    const line31 = grossIncome - line28;

    return {
      grossIncome, companyTotal, netIncome, totalMiles, mileageDeduction,
      line9, line10, line15, line17, line18, line22, line25, line27a, line28, line31,
      otherExpenses, expByCategory,
    };
  }

  function renderTaxSummary() {
    const settings = App.state.settings;

    const yearSelect = $('tax-year');
    const year = yearSelect ? parseInt(yearSelect.value) : new Date().getFullYear();
    const data = getTaxData(year);

    // Part I - Income
    const l1 = $('tax-line1'); if (l1) l1.textContent = formatCurrency(data.grossIncome);
    const l5 = $('tax-line5'); if (l5) l5.textContent = formatCurrency(data.grossIncome);
    const l7 = $('tax-line7'); if (l7) l7.textContent = formatCurrency(data.grossIncome);

    // Part II - Expenses
    const l9 = $('tax-line9'); if (l9) l9.textContent = formatCurrency(data.line9);
    const l10 = $('tax-line10'); if (l10) l10.textContent = formatCurrency(data.line10);
    const l15 = $('tax-line15'); if (l15) l15.textContent = formatCurrency(data.line15);
    const l17 = $('tax-line17'); if (l17) l17.textContent = formatCurrency(data.line17);
    const l18 = $('tax-line18'); if (l18) l18.textContent = formatCurrency(data.line18);
    const l22 = $('tax-line22'); if (l22) l22.textContent = formatCurrency(data.line22);
    const l25 = $('tax-line25'); if (l25) l25.textContent = formatCurrency(data.line25);
    const l27a = $('tax-line27a'); if (l27a) l27a.textContent = formatCurrency(data.line27a);
    const l28 = $('tax-line28'); if (l28) l28.textContent = formatCurrency(data.line28);

    // Net profit
    const l31 = $('tax-line31'); if (l31) l31.textContent = formatCurrency(data.line31);

    // Mileage detail
    const tmEl = $('tax-total-miles'); if (tmEl) tmEl.textContent = data.totalMiles.toFixed(1);
    const trEl = $('tax-irs-rate'); if (trEl) trEl.textContent = '$' + settings.mileageRate.toFixed(3) + '/mi';
    const tdEl = $('tax-mileage-deduction'); if (tdEl) tdEl.textContent = formatCurrency(data.mileageDeduction);

    // Estimated tax payments log (record-keeping)
    renderTaxPayments(year);

    // Other expenses detail
    const otherTbody = $('tax-other-expenses-tbody');
    if (otherTbody) {
      const entries = Object.entries(data.otherExpenses);
      if (entries.length === 0) {
        otherTbody.innerHTML = '<tr><td colspan="2">No other expenses</td></tr>';
      } else {
        otherTbody.innerHTML = entries.map(([cat, amt]) =>
          '<tr><td>' + escapeHtml(cat) + '</td><td>' + formatCurrency(amt) + '</td></tr>'
        ).join('');
      }
    }
  }

  function exportTaxPDF() {
    const settings = App.state.settings;

    if (typeof window.jspdf === 'undefined') {
      App.showToast('jsPDF not loaded. Please try again.', 'error');
      return;
    }

    const yearSelect = $('tax-year');
    const year = yearSelect ? parseInt(yearSelect.value) : new Date().getFullYear();
    const data = getTaxData(year);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.setFontSize(18);
    doc.text('Schedule C Summary - Tax Year ' + year, 14, 20);
    doc.setFontSize(10);
    doc.text('Generated by Tutoring Tracker Pro on ' + new Date().toLocaleDateString(), 14, 28);

    // Part I
    doc.setFontSize(14);
    doc.text('Part I - Income', 14, 40);

    doc.autoTable({
      startY: 44,
      head: [['Line', 'Description', 'Amount']],
      body: [
        ['1', 'Gross receipts (tutoring income)', formatCurrency(data.grossIncome)],
        ['5', 'Gross profit', formatCurrency(data.grossIncome)],
        ['7', 'Gross income', formatCurrency(data.grossIncome)],
      ],
      theme: 'grid',
      headStyles: { fillColor: [108, 99, 255] },
    });

    // Part II
    const afterIncome = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(14);
    doc.text('Part II - Expenses', 14, afterIncome);

    doc.autoTable({
      startY: afterIncome + 4,
      head: [['Line', 'Description', 'Amount']],
      body: [
        ['9', 'Car and truck expenses (mileage)', formatCurrency(data.line9)],
        ['10', 'Commissions and fees (company split)', formatCurrency(data.line10)],
        ['15', 'Insurance', formatCurrency(data.line15)],
        ['17', 'Professional services', formatCurrency(data.line17)],
        ['18', 'Office expenses', formatCurrency(data.line18)],
        ['22', 'Supplies', formatCurrency(data.line22)],
        ['25', 'Utilities', formatCurrency(data.line25)],
        ['27a', 'Other expenses', formatCurrency(data.line27a)],
        ['28', 'Total expenses', formatCurrency(data.line28)],
      ],
      theme: 'grid',
      headStyles: { fillColor: [108, 99, 255] },
    });

    // Net Profit
    const afterExp = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(14);
    doc.text('Net Profit (Line 31): ' + formatCurrency(data.line31), 14, afterExp);

    // Mileage Detail
    doc.setFontSize(12);
    doc.text('Mileage Detail', 14, afterExp + 12);
    doc.setFontSize(10);
    doc.text('Total miles: ' + data.totalMiles.toFixed(1), 14, afterExp + 20);
    doc.text('IRS rate: $' + settings.mileageRate.toFixed(3) + '/mi', 14, afterExp + 26);
    doc.text('Deduction: ' + formatCurrency(data.mileageDeduction), 14, afterExp + 32);

    doc.save('TaxSummary_' + year + '.pdf');
    App.showToast('Tax PDF exported', 'success');
  }

  /* ==========================================================
     ESTIMATED TAX PAYMENTS (record-keeping only)
     ========================================================== */

  function renderTaxPayments(year) {
    const tbody = $('tax-payments-tbody');
    if (!tbody) return;
    const payments = (App.state.taxPayments || [])
      .filter((p) => p.date && p.date.slice(0, 4) === String(year))
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    if (payments.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5">No estimated tax payments logged for ' + year + '</td></tr>';
    } else {
      tbody.innerHTML = payments.map((p) =>
        '<tr>' +
          '<td>' + escapeHtml(formatDate(p.date)) + '</td>' +
          '<td>' + escapeHtml(p.agency || '') + '</td>' +
          '<td>' + formatCurrency(p.amount) + '</td>' +
          '<td>' + escapeHtml(p.note || '') + '</td>' +
          '<td><button class="btn btn-sm btn-icon btn-danger" data-action="delete-tax-payment" data-id="' + escapeHtml(p.id) + '" title="Delete" aria-label="Delete payment">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>' +
          '</button></td>' +
        '</tr>'
      ).join('');
    }
    const total = payments.reduce((s, p) => s + num(p.amount), 0);
    const totEl = $('tax-payments-total');
    if (totEl) totEl.innerHTML = '<strong>' + formatCurrency(total) + '</strong>';
  }

  function openTaxPaymentForm(id) {
    const form = $('tax-payment-form');
    if (form) form.reset();
    $('tax-payment-id').value = '';
    const title = $('modal-tax-payment-title');
    if (id) {
      const p = (App.state.taxPayments || []).find((x) => String(x.id) === String(id));
      if (p) {
        if (title) title.textContent = 'Edit Tax Payment';
        $('tax-payment-id').value = p.id;
        $('tax-payment-date').value = p.date || '';
        $('tax-payment-agency').value = p.agency || 'IRS';
        $('tax-payment-amount').value = p.amount || '';
        $('tax-payment-note').value = p.note || '';
      }
    } else {
      if (title) title.textContent = 'Add Estimated Tax Payment';
      // default the date to today
      $('tax-payment-date').value = App.todayISO();
    }
    App.openModal('modal-tax-payment');
  }

  function saveTaxPayment() {
    const date = $('tax-payment-date').value;
    const amount = num($('tax-payment-amount').value);
    if (!date) { App.showToast('Date is required', 'error'); return; }
    if (amount <= 0) { App.showToast('Enter a valid amount', 'error'); return; }

    const id = $('tax-payment-id').value;
    const payments = App.state.taxPayments || [];
    const data = {
      id: id || App.generateId(),
      date,
      agency: $('tax-payment-agency').value || 'IRS',
      amount,
      note: ($('tax-payment-note').value || '').trim(),
      updatedAt: new Date().toISOString(),
    };
    if (id) {
      const idx = payments.findIndex((p) => String(p.id) === String(id));
      if (idx !== -1) payments[idx] = data;
    } else {
      payments.push(data);
    }
    App.state.taxPayments = payments;
    App.saveData();
    App.closeModal('modal-tax-payment');
    App.renderTaxSummary();
    App.showToast(id ? 'Payment updated' : 'Payment added', 'success');
  }

  function deleteTaxPayment(id) {
    App.showConfirm('Delete Payment', 'Remove this estimated tax payment from your records?', () => {
      App.state.taxPayments = (App.state.taxPayments || []).filter((p) => String(p.id) !== String(id));
      App.saveData();
      App.renderTaxSummary();
      App.showToast('Payment deleted', 'success');
    });
  }

  // Expose to App namespace
  App.renderReports = renderReports;
  App.renderTaxSummary = renderTaxSummary;
  App.getTaxData = getTaxData;
  App.exportTaxPDF = exportTaxPDF;
  App.openTaxPaymentForm = openTaxPaymentForm;
  App.saveTaxPayment = saveTaxPayment;
  App.deleteTaxPayment = deleteTaxPayment;

})();
