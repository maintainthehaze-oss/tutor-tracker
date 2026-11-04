/* ============================================================
   Tutoring Tracker Pro — Dashboard
   Dashboard rendering, month-to-date comparison cards, charts, hours by family, outstanding
   ============================================================ */
(function () {
  'use strict';

  const App = window.App;
  const $ = App.$;
  const escapeHtml = App.escapeHtml;
  const formatCurrency = App.formatCurrency;
  const formatDate = App.formatDate;
  const formatDuration = App.formatDuration;
  const todayISO = App.todayISO;
  const num = App.num;
  const clientName = App.clientName;

  let incomeAuditOpen = false;
  function reportNotice(id, anchor, warnings) {
    if (anchor && anchor.tagName === 'CANVAS') anchor = anchor.parentNode;
    if (!anchor || !anchor.parentNode) return;
    let notice = $(id);
    if (!notice) {
      notice = document.createElement('p');
      notice.id = id;
      notice.className = 'text-muted';
      notice.setAttribute('role', 'status');
      anchor.parentNode.insertBefore(notice, anchor);
    }
    if (warnings.length) App.reportModel.renderNotice(notice, warnings, 'current-v2'); else { notice.textContent = ''; App.reportModel.renderNotice(notice, [], 'current-v2'); notice.textContent = ''; }
    notice.hidden = !warnings.length;
    if (id === 'income-report-notice') {
      notice.hidden = !warnings.length || !incomeAuditOpen;
      const toggle = $('income-audit-toggle');
      if (toggle) { toggle.hidden = !warnings.length; toggle.setAttribute('aria-expanded', String(incomeAuditOpen)); }
    }
  }
  App.toggleIncomeAudit = () => {
    incomeAuditOpen = !incomeAuditOpen;
    const n = $('income-report-notice'), b = $('income-audit-toggle');
    if (n) n.hidden = !incomeAuditOpen || !n.textContent;
    if (b) b.setAttribute('aria-expanded', String(incomeAuditOpen));
  };

  /* ==========================================================
     DASHBOARD
     ========================================================== */

  // Compare target for the cards and the family bars: the same month a year earlier (default) or last month.
  // Ruled 2026-11-04. In memory only: no storage key, nothing to disclose in SECURITY-PRIVACY.md.
  let compareMode = 'year';
  App.dashboardCompareMode = () => compareMode;
  App.setDashboardCompare = (mode) => { compareMode = mode === 'month' ? 'month' : 'year'; App.renderDashboard(); };

  const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function monthParts(key) { const [y, m] = key.split('-').map(Number); return { y, m }; }
  function shiftMonth(key, delta) { const { y, m } = monthParts(key); return App.monthKey(new Date(y, m - 1 + delta, 1)); }
  function daysInMonth(key) { const { y, m } = monthParts(key); return new Date(y, m, 0).getDate(); }
  const pad2 = (n) => String(n).padStart(2, '0');
  /** "Nov 1–4" / "Nov 1–4, 2025" for a window inside one month; "Nov" / "Nov 2025" when it covers the whole month. */
  function windowLabel(key, lastDay, withYear) {
    const { y, m } = monthParts(key);
    const whole = lastDay == null || lastDay >= daysInMonth(key);
    return MONTHS_SHORT[m - 1] + (whole ? '' : ' 1–' + lastDay) + (withYear ? (whole ? ' ' : ', ') + y : '');
  }

  /**
   * Month-to-date comparison, DAY-MATCHED: the 1st–Nth of this month against the 1st–Nth of the comparison
   * month, so the 4th of a month never reads as a collapse against a whole earlier month. `today` is ISO;
   * `mode` is 'year' (same month last year) or 'month' (last month). Realized money comes only from
   * App.reportModel; "on pace" adds this month's still-scheduled rows, the same operational read as the
   * header Projected pill (waived fees count $0).
   */
  function comparison(today, mode) {
    const thisMonth = today.slice(0, 7);
    const day = Number(today.slice(8, 10));
    const prevKey = shiftMonth(thisMonth, mode === 'month' ? -1 : -12);
    const prevDay = Math.min(day, daysInMonth(prevKey));
    const withYear = mode !== 'month';
    const current = App.reportModel.metrics({ month: thisMonth, dateEnd: today });
    const previous = App.reportModel.metrics({ month: prevKey, dateEnd: prevKey + '-' + pad2(prevDay) });
    const prevFull = App.reportModel.metrics({ month: prevKey });
    const scheduled = scheduledSessions().filter((s) => typeof s.date === 'string' && s.date.slice(0, 7) === thisMonth);
    const scheduledNet = scheduled.reduce((sum, s) => sum + App.revenueAmount(s) - App.revenueSplit(s), 0);
    const scheduledHours = scheduled.reduce((sum, s) => sum + num(s.duration), 0);
    const perHour = (m) => (m.hours > 0 ? m.yourCut / m.hours : 0);
    return {
      mode, thisMonth, prevKey, current, previous, prevFull,
      currentLabel: windowLabel(thisMonth, day, false),
      previousLabel: windowLabel(prevKey, prevDay, withYear),
      prevFullLabel: windowLabel(prevKey, null, withYear),
      pace: { net: current.yourCut + scheduledNet, hours: current.hours + scheduledHours, scheduledCount: scheduled.length, scheduledHours },
      perHour: { current: perHour(current), previous: perHour(previous) },
      warnings: [...current.warnings, ...previous.warnings, ...prevFull.warnings],
    };
  }

  /** Hours per family (siblings roll up; solo clients stand alone) in the two day-matched windows, busiest first, top 8. */
  function familyRows(cmp) {
    const byKey = new Map();
    cmp.current.groups.forEach((g) => byKey.set(g.key, { key: g.key, label: g.label, family: g.family, hours: g.hours, prevHours: 0, net: g.yourCut, sessions: g.sessions }));
    cmp.previous.groups.forEach((g) => {
      const row = byKey.get(g.key) || { key: g.key, label: g.label, family: g.family, hours: 0, prevHours: 0, net: 0, sessions: 0 };
      row.prevHours = g.hours;
      byKey.set(g.key, row);
    });
    return [...byKey.values()].filter((r) => r.hours > 0 || r.prevHours > 0)
      .sort((a, b) => b.hours - a.hours || b.prevHours - a.prevHours || a.label.localeCompare(b.label))
      .slice(0, 8);
  }

  function setText(id, text) { const el = $(id); if (el) el.textContent = text; }

  /** The ONE operational read in this file (read-guard exemption): rows still SCHEDULED, which the report
   *  model deliberately does not cover. Feeds the header Projected pill and the "On pace for" card. */
  function scheduledSessions() {
    return App.state.sessions.filter((s) => s.status === 'scheduled');
  }

  function renderDashboard() {
    const cmp = comparison(todayISO(), compareMode);
    const { current, previous, prevFull } = cmp;
    const select = document.querySelector('[data-action="dashboard-compare"]');
    if (select && select.value !== compareMode) select.value = compareMode;
    setText('dashboard-compare-label', cmp.currentLabel + ' vs ' + cmp.previousLabel);
    // One-line link to the Sessions-tab calendar (ruled 2026-11-04): count only, no grid here.
    setText('dash-scheduled-count', cmp.pace.scheduledCount + ' session' + (cmp.pace.scheduledCount === 1 ? '' : 's') + ' scheduled this month');

    // Net so far (month to date)
    setText('dash-net', formatCurrency(current.yourCut));
    const dashGrossSplit = $('dash-gross-split');
    // formatCurrency output is digits/punctuation only, safe to inject.
    if (dashGrossSplit) dashGrossSplit.innerHTML = 'Gross: ' + formatCurrency(current.gross) +
      (current.hasLegacyShare ? '<span class="split-info"> | Historical share: ' + formatCurrency(current.companySplit) + '</span>' : '');
    reportNotice('dashboard-report-notice', dashGrossSplit, cmp.warnings);
    setTrend('dash-revenue-trend', current.yourCut, previous.yourCut, formatCurrency(previous.yourCut) + ' in ' + cmp.previousLabel);

    // On pace for: realized so far plus everything still scheduled this month, against the comparison month's final
    setText('dash-pace', formatCurrency(cmp.pace.net));
    setText('dash-pace-sub', cmp.pace.scheduledCount > 0
      ? cmp.pace.scheduledCount + ' session' + (cmp.pace.scheduledCount === 1 ? '' : 's') + ' still scheduled this month'
      : 'Nothing more scheduled this month');
    setTrend('dash-pace-trend', cmp.pace.net, prevFull.yourCut, cmp.prevFullLabel + ' finished at ' + formatCurrency(prevFull.yourCut));

    // Hours so far
    setText('dash-hours', formatDuration(current.hours));
    setText('dash-hours-sub', current.sessionCount + ' session' + (current.sessionCount === 1 ? '' : 's') +
      (cmp.pace.scheduledHours > 0 ? ' · ' + formatDuration(cmp.pace.scheduledHours) + ' still scheduled' : ''));
    setTrend('dash-hours-trend', current.hours, previous.hours, formatDuration(previous.hours) + ' in ' + cmp.previousLabel);

    // Earned per hour actually worked (net / hours), not the list rate
    setText('dash-per-hour', formatCurrency(cmp.perHour.current) + '/h');
    setTrend('dash-per-hour-trend', cmp.perHour.current, cmp.perHour.previous, formatCurrency(cmp.perHour.previous) + '/h in ' + cmp.previousLabel);

    App.renderIncomeChart();
    renderFamilyHours(cmp);
    renderOutstanding();
    updateHeaderStats();

    // Year-over-year historical comparison (annual bars, unchanged)
    if (typeof App.renderYearOverYearChart === 'function') {
      App.renderYearOverYearChart();
    }
  }

  /** Arrow + percent, then `suffix` ("$360.00 in Nov 1–4, 2025") so the reader sees what the change is against. */
  function setTrend(elId, current, previous, suffix) {
    const el = $(elId);
    if (!el) return;
    const tail = suffix ? ' · ' + suffix : '';
    if (previous === 0 && current === 0) {
      el.textContent = suffix || '';
      el.className = 'card-trend';
      return;
    }
    const diff = current - previous;
    const pct = previous > 0 ? Math.round((diff / previous) * 100) : (current > 0 ? 100 : 0);
    if (diff > 0) {
      el.textContent = '▲ ' + pct + '%' + tail;
      el.className = 'card-trend trend-up';
    } else if (diff < 0) {
      el.textContent = '▼ ' + Math.abs(pct) + '%' + tail;
      el.className = 'card-trend trend-down';
    } else {
      el.textContent = '0%' + tail;
      el.className = 'card-trend';
    }
  }

  function updateHeaderStats() {
    // Header pills: Projected (hidden when nothing is scheduled), Owed, Backup (ruled 2026-10-11).
    // Revenue, session and client counts are on the dashboard cards.
    // Projected pill: every scheduled (not-yet-realized) session, any date.
    // Past-dated scheduled sessions get auto-completed on load, so this is
    // effectively "upcoming". Waived fees count as $0 via App.revenueAmount.
    const scheduled = scheduledSessions();
    const projected = scheduled.reduce((sum, s) => sum + App.revenueAmount(s), 0);
    const hpEl = $('header-projected');
    const hpPill = $('header-projected-pill');
    if (hpEl) hpEl.textContent = formatCurrency(projected);
    if (hpPill) {
      hpPill.hidden = projected <= 0;
      hpPill.title = 'Projected from ' + scheduled.length + ' scheduled session' + (scheduled.length === 1 ? '' : 's') +
        ' not yet completed (all dates, not yet realized). Waived fees excluded.';
    }
    // Operational payment targets remain live sessions; imported evidence is read-only.
    // Owed pill: ALL TIME, independent of the month shown elsewhere
    const owed = App.computeOwedByFamily();
    const hoEl = $('header-owed');
    if (hoEl) hoEl.textContent = formatCurrency(owed.total);
    const pill = $('header-owed-pill');
    if (pill) {
      pill.classList.toggle('has-owed', owed.total > 0);
      pill.title = owed.total > 0
        ? formatCurrency(owed.total) + ' owed across ' + owed.count + ' unpaid session' + (owed.count === 1 ? '' : 's') + ' (all time). Click to see them.'
        : 'Nothing owed. Click to see unpaid sessions.';
    }
  }

  function getChartColors() {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    return {
      primary: isDark ? '#6c63ff' : '#5a52d5',
      secondary: isDark ? '#ff6584' : '#e8547a',
      success: isDark ? '#2ecc71' : '#27ae60',
      gridColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
      textColor: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)',
      bgTransparent: 'transparent',
    };
  }

  function renderIncomeChart() {
    const canvas = $('income-chart');
    if (!canvas) return;
    let unavailable = $('income-chart-unavailable');
    if (!unavailable) {
      unavailable = document.createElement('p');
      unavailable.id = 'income-chart-unavailable';
      unavailable.className = 'text-muted';
      unavailable.setAttribute('role', 'status');
      unavailable.textContent = 'Income chart unavailable: the chart library is not loaded. Revenue totals remain available above.';
      canvas.parentNode.parentNode.insertBefore(unavailable, canvas.parentNode);
    }
    unavailable.hidden = typeof Chart !== 'undefined';
    canvas.parentNode.hidden = !unavailable.hidden;
    if (!unavailable.hidden) return;

    const rangeEl = document.querySelector('[data-action="income-chart-range"]');
    const rangeVal = rangeEl ? rangeEl.value : '12';

    const now = new Date();

    // One evidence boundary includes distinct historical IDs, even in overlapping months.
    const allSessions = App.reportModel.context().sessions.filter((s) => s.status === 'completed');

    // --- Determine month range ---
    let numMonths;
    if (rangeVal === 'all') {
      // Find earliest date across live + historical
      const allDates = allSessions.map((s) => s.date).filter((date) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date + 'T00:00:00')));
      const earliest = allDates.length > 0 ? allDates.reduce((a, b) => a < b ? a : b) : todayISO();
      const ed = new Date(earliest + 'T00:00:00');
      numMonths = Math.max(6, (now.getFullYear() - ed.getFullYear()) * 12 + now.getMonth() - ed.getMonth() + 1);
    } else {
      numMonths = parseInt(rangeVal) || 12;
    }

    const months = [];
    const labels = [];
    for (let i = numMonths - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = App.monthKey(d);
      months.push(key);
      labels.push(d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }));
    }

    const grossData = [];
    const companyData = [];
    const netData = [];
    const countData = [];
    // Same months one year earlier, so Oct 2026 sits directly over Oct 2025 (ruled 2026-11-04). Not drawn on All Time.
    const prevYearData = [];
    // Full "Month YYYY" labels for tooltip titles (the axis uses short labels)
    const fullLabels = months.map((m) => {
      const [y, mo] = m.split('-');
      return new Date(Number(y), Number(mo) - 1, 1)
        .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    });

    let hasLegacyShare = false;
    const warnings = [];
    months.forEach((m) => {
      const metrics = App.reportModel.metrics({ month: m });
      grossData.push(metrics.gross);
      companyData.push(metrics.companySplit);
      netData.push(metrics.yourCut);
      countData.push(metrics.sessionCount);
      hasLegacyShare = hasLegacyShare || metrics.hasLegacyShare;
      warnings.push(...metrics.warnings);
      if (rangeVal !== 'all') {
        const earlier = App.reportModel.metrics({ month: shiftMonth(m, -12) });
        prevYearData.push(earlier.yourCut);
        warnings.push(...earlier.warnings);
      }
    });
    const showPrevYear = rangeVal !== 'all' && prevYearData.some((v) => v > 0);
    reportNotice('income-report-notice', canvas, warnings);

    const colors = getChartColors();

    if (App.state.incomeChart) App.state.incomeChart.destroy();
    App.state.incomeChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Gross Income',
            data: grossData,
            borderColor: colors.primary,
            backgroundColor: colors.primary + '18',
            fill: true,
            tension: 0.3,
            pointRadius: rangeVal === 'all' ? 2 : 4,
            pointHoverRadius: 6,
            order: 3,
          },
          {
            label: 'Historical share',
            data: companyData,
            borderColor: colors.secondary,
            backgroundColor: colors.secondary + '18',
            fill: true,
            tension: 0.3,
            pointRadius: rangeVal === 'all' ? 2 : 3,
            pointHoverRadius: 5,
            order: 2,
          },
          {
            label: 'Net Revenue',
            data: netData,
            borderColor: colors.success,
            backgroundColor: colors.success + '28',
            fill: false,
            tension: 0.3,
            pointRadius: rangeVal === 'all' ? 2 : 4,
            pointHoverRadius: 6,
            borderWidth: 2.5,
            order: 1,
          },
          {
            label: 'Net, a year earlier',
            data: prevYearData,
            borderColor: colors.success,
            backgroundColor: 'transparent',
            borderDash: [6, 4],
            borderWidth: 1.5,
            fill: false,
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: 4,
            order: 0,
          },
        ].filter((dataset) => (dataset.label !== 'Historical share' || (hasLegacyShare && App.showSplit())) &&
                              (dataset.label !== 'Net, a year earlier' || showPrevYear)),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            labels: {
              color: colors.textColor,
              usePointStyle: true,
              pointStyle: 'circle',
              boxWidth: 8,
              boxHeight: 8,
              padding: 16,
              font: { size: 12 },
            },
          },
          tooltip: {
            mode: 'index',
            intersect: false,
            usePointStyle: true,
            padding: 12,
            titleFont: { size: 13, weight: '600' },
            bodyFont: { size: 12 },
            bodySpacing: 6,
            callbacks: {
              // Full "Month YYYY" instead of the abbreviated axis label
              title: (items) => items.length ? (fullLabels[items[0].dataIndex] || items[0].label) : '',
              label: (ctx) => '  ' + ctx.dataset.label + ': ' + formatCurrency(ctx.parsed.y),
              // Footer line: session count for the month
              footer: (items) => {
                if (!items.length) return '';
                const n = countData[items[0].dataIndex] || 0;
                return n + ' session' + (n === 1 ? '' : 's');
              },
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: colors.textColor,
              autoSkip: true,
              // Cap visible labels so All Time stays readable; let shorter ranges show all
              maxTicksLimit: rangeVal === 'all' ? 12 : (numMonths > 12 ? 12 : numMonths),
              maxRotation: rangeVal === 'all' ? 0 : 45,
              minRotation: 0,
            },
            grid: { color: colors.gridColor },
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: colors.textColor,
              maxTicksLimit: 6,
              // Abbreviate large dollar amounts: $1.2k, $15k
              callback: (v) => {
                if (Math.abs(v) >= 1000) {
                  const k = v / 1000;
                  return '$' + (k % 1 === 0 ? k : k.toFixed(1)) + 'k';
                }
                return '$' + v.toLocaleString();
              },
            },
            grid: { color: colors.gridColor },
          },
        },
      },
    });
  }

  /** "Hours by family": two bars per family, this month to date against the comparison window. Hours lead;
   *  money and session count sit in the row's title. A family with nothing in the comparison window shows a dash. */
  function renderFamilyHours(cmp) {
    const list = $('family-hours-list');
    if (!list) return;
    setText('family-hours-sub', cmp.currentLabel + ' vs ' + cmp.previousLabel);
    reportNotice('family-hours-report-notice', list, [...cmp.current.warnings, ...cmp.previous.warnings]);
    const rows = familyRows(cmp);
    if (rows.length === 0) {
      list.innerHTML = '<li class="empty-state">No sessions in ' + escapeHtml(cmp.currentLabel) + ' or ' + escapeHtml(cmp.previousLabel) + '</li>';
      return;
    }
    const max = Math.max(0.01, ...rows.map((r) => Math.max(r.hours, r.prevHours)));
    const pct = (h) => Math.round((h / max) * 100);
    list.innerHTML = rows.map((r) => {
      const title = formatDuration(r.hours) + ', ' + formatCurrency(r.net) + ', ' + r.sessions + ' session' + (r.sessions === 1 ? '' : 's') +
        ' in ' + cmp.currentLabel + '; ' + (r.prevHours > 0 ? formatDuration(r.prevHours) : 'nothing') + ' in ' + cmp.previousLabel;
      return '<li class="family-hours-item" title="' + escapeHtml(title) + '">' +
        '<span class="family-hours-name">' + escapeHtml(r.label) + (r.family ? ' <span class="outstanding-tag">family</span>' : '') + '</span>' +
        '<span class="family-hours-bars" aria-hidden="true">' +
          '<span class="family-hours-bar bar-now" style="width:' + pct(r.hours) + '%"></span>' +
          '<span class="family-hours-bar bar-then" style="width:' + pct(r.prevHours) + '%"></span>' +
        '</span>' +
        '<span class="family-hours-value">' + formatDuration(r.hours) +
          '<small>' + (r.prevHours > 0 ? formatDuration(r.prevHours) : '—') + '</small></span>' +
      '</li>';
    }).join('');
  }

  function renderOutstanding() {
    renderOwedList($('outstanding-list'), $('outstanding-total'));
  }

  /**
   * Shared "who owes what" renderer — used by the Dashboard card and the
   * Sessions tab panel so both always agree. Family-grouped, all time.
   */
  function renderOwedList(list, totalEl) {
    if (!list) return;
    const owed = App.computeOwedByFamily();

    if (totalEl) {
      totalEl.textContent = formatCurrency(owed.total);
      totalEl.classList.toggle('outstanding-zero', owed.total <= 0);
    }

    if (owed.groups.length === 0) {
      list.innerHTML = '<li class="empty-state">All caught up &#10003;</li>';
      return;
    }

    list.innerHTML = owed.groups.map((g) => {
      const parts = [g.count + ' unpaid session' + (g.count === 1 ? '' : 's')];
      if (g.family) {
        parts.unshift('<span class="outstanding-tag">family</span>');
        parts.push(g.members.map((m) => escapeHtml(clientName(m.client)) + ' ' + formatCurrency(m.amount)).join(' &middot; '));
      }
      return '<li class="outstanding-item">' +
        '<div class="outstanding-info">' +
          '<span class="outstanding-name">' + escapeHtml(g.label) + '</span>' +
          '<span class="outstanding-meta">' + parts.join(' &middot; ') + '</span>' +
        '</div>' +
        '<span class="outstanding-amount">' + formatCurrency(g.amount) + '</span>' +
        '<button class="btn btn-sm btn-mark-paid" data-action="mark-group-paid" data-key="' + escapeHtml(g.key) + '" data-label="' + escapeHtml(g.label) + '" title="Mark every unpaid session for this family paid today">Mark paid</button>' +
      '</li>';
    }).join('');
  }

  // Expose to App namespace
  App.renderDashboard = renderDashboard;
  App.renderOutstanding = renderOutstanding;
  App.renderOwedList = renderOwedList;
  App.updateHeaderStats = updateHeaderStats;
  App.renderIncomeChart = renderIncomeChart;
  App.renderFamilyHours = renderFamilyHours;
  App.dashboardComparison = comparison;
  App.dashboardFamilyRows = familyRows;

})();
