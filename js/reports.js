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

  function renderReports() {
    const sessions = App.state.sessions;
    const expenses = App.state.expenses;
    const settings = App.state.settings;

    const yearSelect = $('report-year');
    const year = yearSelect ? parseInt(yearSelect.value) : new Date().getFullYear();

    const yearSessions = sessions.filter((s) =>
      s.date && s.date.slice(0, 4) === String(year) && s.status === 'completed'
    );
    const yearExpenses = expenses.filter((e) => e.date && e.date.slice(0, 4) === String(year));

    const totalIncome = yearSessions.reduce((s, x) => s + num(x.amount), 0);
    const totalCompanySplit = yearSessions.reduce((s, x) => s + num(x.companyAmount), 0);
    const totalExpenses = yearExpenses.reduce((s, x) => s + num(x.amount), 0);
    const totalMiles = yearSessions.reduce((s, x) => s + num(x.mileage), 0);
    const totalHours = yearSessions.reduce((s, x) => s + num(x.duration), 0);

    // Summary cards
    const riEl = $('report-total-income');
    if (riEl) riEl.textContent = formatCurrency(totalIncome);
    const rcEl = $('report-company-split');
    if (rcEl) rcEl.textContent = formatCurrency(totalCompanySplit);
    const reEl = $('report-total-expenses');
    if (reEl) reEl.textContent = formatCurrency(totalExpenses);
    const rnEl = $('report-net-profit');
    if (rnEl) rnEl.textContent = formatCurrency(totalIncome - totalCompanySplit - totalExpenses - totalMiles * settings.mileageRate);
    const rsEl = $('report-total-sessions');
    if (rsEl) rsEl.textContent = yearSessions.length;
    const rmEl = $('report-total-miles');
    if (rmEl) rmEl.textContent = totalMiles.toFixed(1);

    // Monthly breakdown
    const tbody = $('report-tbody');
    if (tbody) {
      const months = [];
      for (let m = 0; m < 12; m++) {
        const monthKey = year + '-' + String(m + 1).padStart(2, '0');
        const mSessions = yearSessions.filter((s) => s.date.slice(0, 7) === monthKey);
        const mExpenses = yearExpenses.filter((e) => e.date.slice(0, 7) === monthKey);
        const income = mSessions.reduce((s, x) => s + num(x.amount), 0);
        const companySplit = mSessions.reduce((s, x) => s + num(x.companyAmount), 0);
        const exp = mExpenses.reduce((s, x) => s + num(x.amount), 0);
        const miles = mSessions.reduce((s, x) => s + num(x.mileage), 0);
        const hours = mSessions.reduce((s, x) => s + num(x.duration), 0);

        const monthName = new Date(year, m, 1).toLocaleDateString('en-US', { month: 'long' });
        months.push({ monthName, sessions: mSessions.length, hours, income, companySplit, exp, miles });
      }

      tbody.innerHTML = months.map((m) =>
        '<tr>' +
          '<td>' + m.monthName + '</td>' +
          '<td>' + m.sessions + '</td>' +
          '<td>' + formatDuration(m.hours) + '</td>' +
          '<td>' + formatCurrency(m.income) + '</td>' +
          '<td>' + formatCurrency(m.companySplit) + '</td>' +
          '<td>' + formatCurrency(m.exp) + '</td>' +
          '<td>' + formatCurrency(m.income - m.companySplit - m.exp) + '</td>' +
          '<td>' + m.miles.toFixed(1) + '</td>' +
          '<td>' + formatCurrency(m.miles * settings.mileageRate) + '</td>' +
        '</tr>'
      ).join('');
    }

    // Footer totals
    const mileageDed = totalMiles * settings.mileageRate;
    const feEl = $('report-foot-sessions'); if (feEl) feEl.textContent = yearSessions.length;
    const fhEl = $('report-foot-hours'); if (fhEl) fhEl.textContent = formatDuration(totalHours);
    const fiEl = $('report-foot-income'); if (fiEl) fiEl.textContent = formatCurrency(totalIncome);
    const fcEl = $('report-foot-split'); if (fcEl) fcEl.textContent = formatCurrency(totalCompanySplit);
    const fxEl = $('report-foot-expenses'); if (fxEl) fxEl.textContent = formatCurrency(totalExpenses);
    const fnEl = $('report-foot-net'); if (fnEl) fnEl.textContent = formatCurrency(totalIncome - totalCompanySplit - totalExpenses);
    const fmEl = $('report-foot-miles'); if (fmEl) fmEl.textContent = totalMiles.toFixed(1);
    const fdEl = $('report-foot-mileage-ded'); if (fdEl) fdEl.textContent = formatCurrency(mileageDed);

    // Per-client stats
    renderClientStats(year);
  }

  function renderClientStats(year) {
    const sessions = App.state.sessions;
    const clients = App.state.clients;

    const tbody = $('client-stats-tbody');
    if (!tbody) return;

    const yearSessions = sessions.filter((s) =>
      s.date && s.date.slice(0, 4) === String(year) && s.status === 'completed'
    );

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

  // Expose to App namespace
  App.renderReports = renderReports;
  App.renderTaxSummary = renderTaxSummary;
  App.getTaxData = getTaxData;
  App.exportTaxPDF = exportTaxPDF;

})();
