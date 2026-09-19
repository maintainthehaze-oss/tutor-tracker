/* ============================================================
   Tutoring Tracker Pro — Dashboard
   Dashboard rendering, charts, top clients, heatmap, calendar
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
    notice.textContent = warnings.length ? App.reportModel.notice(warnings, 'current-v2') : '';
    notice.hidden = !warnings.length;
  }

  /* ==========================================================
     DASHBOARD
     ========================================================== */

  function renderDashboard() {
    renderWeekStrip();
    const clients = App.state.clients;

    const now = new Date();
    const thisMonth = App.currentMonth();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthStr = App.monthKey(lastMonth);

    const current = App.reportModel.metrics({ month: thisMonth });
    const previous = App.reportModel.metrics({ month: lastMonthStr });
    const thisRevenue = current.gross;
    const thisCompanySplit = current.companySplit;
    const thisCount = current.sessionCount;
    const lastCount = previous.sessionCount;

    const activeClients = clients.filter((c) => c.status === 'active').length;

    // Average rate from active clients
    const activeRates = clients.filter((c) => c.status === 'active' && num(c.rate) > 0);
    const avgRate = activeRates.length > 0
      ? activeRates.reduce((s, c) => s + num(c.rate), 0) / activeRates.length
      : 0;

    // Update cards
    const thisNet = current.yourCut;
    const dashNet = $('dash-net');
    if (dashNet) dashNet.textContent = formatCurrency(thisNet);

    const dashGrossSplit = $('dash-gross-split');
    // formatCurrency output is digits/punctuation only, safe to inject.
    if (dashGrossSplit) dashGrossSplit.innerHTML = 'Gross: ' + formatCurrency(thisRevenue) +
      (current.hasLegacyShare ? '<span class="split-info"> | Historical share: ' + formatCurrency(thisCompanySplit) + '</span>' : '');
    reportNotice('dashboard-report-notice', dashGrossSplit, [...current.warnings, ...previous.warnings]);

    const dashSess = $('dash-sessions');
    if (dashSess) dashSess.textContent = thisCount;

    const dashClients = $('dash-clients');
    if (dashClients) dashClients.textContent = activeClients;

    const dashRate = $('dash-avg-rate');
    if (dashRate) dashRate.textContent = formatCurrency(avgRate) + '/hr';

    // Trends
    setTrend('dash-revenue-trend', thisNet, previous.yourCut);
    setTrend('dash-sessions-trend', thisCount, lastCount);

    // Charts
    renderIncomeChart();

    // Top clients
    renderTopClients();

    // Outstanding / unpaid
    renderOutstanding();

    // Heatmap

    // Header stats
    updateHeaderStats();

    // Year-over-year historical comparison
    if (typeof App.renderYearOverYearChart === 'function') {
      App.renderYearOverYearChart();
    }
  }

  function setTrend(elId, current, previous) {
    const el = $(elId);
    if (!el) return;
    if (previous === 0 && current === 0) {
      el.textContent = '';
      el.className = 'card-trend';
      return;
    }
    const diff = current - previous;
    const pct = previous > 0 ? Math.round((diff / previous) * 100) : (current > 0 ? 100 : 0);
    if (diff > 0) {
      el.innerHTML = '&#9650; ' + pct + '%';
      el.className = 'card-trend trend-up';
    } else if (diff < 0) {
      el.innerHTML = '&#9660; ' + Math.abs(pct) + '%';
      el.className = 'card-trend trend-down';
    } else {
      el.textContent = '0%';
      el.className = 'card-trend';
    }
  }

  function updateHeaderStats() {
    const clients = App.state.clients;

    const thisMonth = App.currentMonth();
    const month = App.reportModel.metrics({ month: thisMonth });
    const active = clients.filter((c) => c.status === 'active').length;

    const hrEl = $('header-revenue');
    if (hrEl) {
      hrEl.textContent = formatCurrency(month.yourCut);
      hrEl.title = month.warnings.length ? App.reportModel.notice(month.warnings, 'current-v2') : '';
    }
    // Projected pill: every scheduled (not-yet-realized) session, any date.
    // Past-dated scheduled sessions get auto-completed on load, so this is
    // effectively "upcoming". Waived fees count as $0 via App.revenueAmount.
    const scheduled = App.state.sessions.filter((s) => s.status === 'scheduled');
    const projected = scheduled.reduce((sum, s) => sum + App.revenueAmount(s), 0);
    const hpEl = $('header-projected');
    const hpPill = $('header-projected-pill');
    if (hpEl) hpEl.textContent = formatCurrency(projected);
    if (hpPill) {
      hpPill.hidden = projected <= 0;
      hpPill.title = 'Projected from ' + scheduled.length + ' scheduled session' + (scheduled.length === 1 ? '' : 's') +
        ' not yet completed (all dates, not yet realized). Waived fees excluded.';
    }
    const hsEl = $('header-sessions');
    if (hsEl) hsEl.textContent = month.sessionCount;
    const hcEl = $('header-clients');
    if (hcEl) hcEl.textContent = active;

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
    });
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
        ].filter((dataset) => dataset.label !== 'Historical share' || (hasLegacyShare && App.showSplit())),
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

  function renderTopClients() {
    const list = $('top-clients-list');
    if (!list) return;

    const metrics = App.reportModel.metrics({});
    const revenueByClient = new Map();
    metrics.groups.forEach((group) => {
      Object.values(group.members).forEach((member) => {
        const key = String(member.client.id);
        const existing = revenueByClient.get(key);
        if (existing) existing.revenue += member.gross;
        else revenueByClient.set(key, { client: member.client, revenue: member.gross });
      });
    });
    const sorted = Array.from(revenueByClient.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);
    reportNotice('top-clients-report-notice', list, metrics.warnings);

    if (sorted.length === 0) {
      list.innerHTML = '<li class="empty-state">No session data yet</li>';
      return;
    }

    list.innerHTML = sorted.map((x, i) =>
      '<li class="top-client-item">' +
        '<span class="top-rank">' + (i + 1) + '</span>' +
        '<span class="top-name">' + escapeHtml(clientName(x.client)) + '</span>' +
        '<span class="top-revenue">' + formatCurrency(x.revenue) + '</span>' +
      '</li>'
    ).join('');
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
        '<button class="btn btn-sm btn-mark-paid" data-action="mark-group-paid" data-key="' + escapeHtml(g.key) + '" data-label="' + escapeHtml(g.label) + '" title="Mark all paid">Mark paid</button>' +
      '</li>';
    }).join('');
  }

  /* ==========================================================
     "THIS WEEK" STRIP
     Every session dated today-7 .. today+7, grouped by day, with one-tap exceptions.
     The taps are handled in ui.js (strip-status, strip-skip, quick-complete / -noshow / -cancel).
     ========================================================== */

  const STRIP_DAYS = 7;
  const STRIP_CHIPS = Object.freeze([
    { status: 'completed', label: 'Happened', quick: 'quick-complete' },
    { status: 'no-show', label: 'No-show', quick: 'quick-noshow' },
    { status: 'cancelled', label: 'Cancelled', quick: 'quick-cancel' },
  ]);
  const STRIP_PAID_TITLE = 'Marked paid: un-pay with the pencil first';

  /** 'YYYY-MM-DD' plus n days. UTC arithmetic on the date STRING, so a DST change can never shift a day. */
  function shiftISO(iso, days) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d) + days * 864e5).toISOString().slice(0, 10);
  }

  /**
   * PURE (no DOM, no clock). One entry per calendar day from today-7 to today+7, oldest first, each
   * holding that day's sessions in time order. `mode` decides which chips a row gets:
   *   paid     any paid row: chips shown but disabled (un-pay with the pencil first)
   *   correct  locked (archived or finalized) and unpaid: Happened / No-show / Cancelled as a correction
   *   skip     unlocked and dated after today: Skip
   *   status   unlocked and dated today or earlier: Happened / No-show / Cancelled
   * `isLocked` defaults to the repository's own answer; tests may pass their own.
   */
  function weekStripDays(sessions, clients, today, isLocked) {
    const locked = isLocked || App.isProtectedSession;
    const names = new Map((clients || []).map((c) => [String(c.id), clientName(c)]));
    const first = shiftISO(today, -STRIP_DAYS), last = shiftISO(today, STRIP_DAYS);
    const inWindow = (sessions || []).filter((s) => typeof s.date === 'string' && s.date >= first && s.date <= last);
    const days = [];
    for (let offset = -STRIP_DAYS; offset <= STRIP_DAYS; offset++) {
      const date = shiftISO(today, offset);
      const rows = inWindow.filter((s) => s.date === date).map((s) => {
        const status = s.status || 'completed', isLockedRow = !!locked(s.id), waived = App.isWaived(s);
        return {
          id: String(s.id), time: typeof s.time === 'string' ? s.time : '', status, waived, paid: !!s.paid,
          names: (s.clientIds || []).map((cid) => names.get(String(cid)) || 'Unknown').join(', '),
          duration: num(s.duration), amount: num(s.amount),
          mode: s.paid ? 'paid' : isLockedRow ? 'correct' : date > today ? 'skip' : 'status',
          canMarkPaid: isLockedRow && status === 'completed' && !s.paid && !waived,
        };
      }).sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
      days.push({ date, isToday: offset === 0, rows });
    }
    return days;
  }

  function stripChips(row) {
    const id = escapeHtml(row.id);
    if (row.mode === 'skip') {
      return '<button type="button" class="duration-chip strip-chip" data-action="strip-skip" data-id="' + id +
        '" title="Remove this session. Undo is offered for 8 seconds.">Skip</button>';
    }
    return STRIP_CHIPS.map((chip) => {
      const lit = row.mode !== 'status' && row.status === chip.status;
      const action = row.mode === 'status' ? chip.quick : 'strip-status';
      return '<button type="button" class="duration-chip strip-chip' + (lit ? ' selected' : '') + '" data-action="' + action +
        '" data-status="' + chip.status + '" data-id="' + id + '" aria-pressed="' + (lit ? 'true' : 'false') + '"' +
        (row.mode === 'paid' ? ' disabled title="' + STRIP_PAID_TITLE + '"' : '') + '>' + chip.label + '</button>';
    }).join('');
  }

  /** PURE. Markup for the strip body: days that have sessions, plus today (always, so its "+" is there). */
  function weekStripHtml(days) {
    const empty = !days.some((day) => day.rows.length);
    return (empty ? '<p class="empty-state">Nothing scheduled this week. Tap + to add a session.</p>' : '') +
      days.filter((day) => day.isToday || day.rows.length).map((day) => {
      const label = new Date(day.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      return '<section class="strip-day' + (day.isToday ? ' strip-today' : '') + '" data-date="' + day.date + '">' +
        '<header class="strip-day-head">' +
          '<span class="strip-day-label">' + (day.isToday ? 'Today &middot; ' : '') + escapeHtml(label) + '</span>' +
          '<button type="button" class="btn btn-sm btn-icon strip-add" data-action="strip-add" data-date="' + day.date +
            '" title="Add a session on this day" aria-label="Add a session on ' + escapeHtml(label) + '">+</button>' +
        '</header>' +
        (day.rows.length ? '<ul class="strip-rows">' + day.rows.map((row) =>
          '<li class="strip-row" data-id="' + escapeHtml(row.id) + '">' +
            '<span class="strip-time">' + escapeHtml(row.time || '-') + '</span>' +
            '<span class="strip-info">' +
              '<span class="strip-names">' + escapeHtml(row.names || '-') + '</span>' +
              '<span class="strip-meta">' + formatDuration(row.duration) + ' &middot; ' + formatCurrency(row.amount) +
                (row.waived ? ' &middot; waived' : row.paid ? ' &middot; paid' : '') +
                (row.status === 'scheduled' ? ' &middot; scheduled' : '') + '</span>' +
            '</span>' +
            '<span class="strip-chips" role="group" aria-label="What happened">' + stripChips(row) + '</span>' +
            (row.canMarkPaid ? '<button type="button" class="btn btn-sm btn-mark-paid" data-action="mark-paid" data-id="' +
              escapeHtml(row.id) + '" title="Mark this session paid">Mark paid</button>' : '') +
          '</li>').join('') + '</ul>' : '') +
      '</section>';
    }).join('');
  }

  /** Runs first in renderDashboard. It must never stop the rest of the dashboard (or init) from painting. */
  function renderWeekStrip() {
    const body = $('week-strip-body');
    if (!body) return;
    try {
      body.innerHTML = weekStripHtml(weekStripDays(App.state.sessions, App.state.clients, todayISO()));
    } catch (error) {
      console.error('This-week strip could not be drawn', error);
      body.innerHTML = '<p class="empty-state">This week could not be shown. The Sessions tab still has everything.</p>';
    }
  }

  // Expose to App namespace
  App.weekStripDays = weekStripDays;
  App.weekStripHtml = weekStripHtml;
  App.renderWeekStrip = renderWeekStrip;
  App.STRIP_PAID_TITLE = STRIP_PAID_TITLE;
  App.renderDashboard = renderDashboard;
  App.renderOutstanding = renderOutstanding;
  App.renderOwedList = renderOwedList;
  App.updateHeaderStats = updateHeaderStats;
  App.renderIncomeChart = renderIncomeChart;

})();
