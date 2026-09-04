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

  /* ==========================================================
     DASHBOARD
     ========================================================== */

  function renderDashboard() {
    const sessions = App.state.sessions;
    const clients = App.state.clients;

    const now = new Date();
    const thisMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthStr = lastMonth.getFullYear() + '-' + String(lastMonth.getMonth() + 1).padStart(2, '0');

    const completedSessions = sessions.filter((s) => s.status === 'completed');

    // This month sessions
    const thisMonthSessions = completedSessions.filter((s) => s.date && s.date.slice(0, 7) === thisMonth);
    const lastMonthSessions = completedSessions.filter((s) => s.date && s.date.slice(0, 7) === lastMonthStr);

    const thisRevenue = thisMonthSessions.reduce((sum, s) => sum + num(s.amount), 0);
    const thisCompanySplit = thisMonthSessions.reduce((sum, s) => sum + num(s.companyAmount), 0);
    const lastRevenue = lastMonthSessions.reduce((sum, s) => sum + num(s.amount), 0);
    const thisCount = thisMonthSessions.length;
    const lastCount = lastMonthSessions.length;

    const activeClients = clients.filter((c) => c.status === 'active').length;

    // Average rate from active clients
    const activeRates = clients.filter((c) => c.status === 'active' && num(c.rate) > 0);
    const avgRate = activeRates.length > 0
      ? activeRates.reduce((s, c) => s + num(c.rate), 0) / activeRates.length
      : 0;

    // Update cards
    const thisNet = thisRevenue - thisCompanySplit;
    const dashNet = $('dash-net');
    if (dashNet) dashNet.textContent = formatCurrency(thisNet);

    const dashGrossSplit = $('dash-gross-split');
    if (dashGrossSplit) dashGrossSplit.textContent = 'Gross: ' + formatCurrency(thisRevenue) + ' | Split: ' + formatCurrency(thisCompanySplit);

    const dashSess = $('dash-sessions');
    if (dashSess) dashSess.textContent = thisCount;

    const dashClients = $('dash-clients');
    if (dashClients) dashClients.textContent = activeClients;

    const dashRate = $('dash-avg-rate');
    if (dashRate) dashRate.textContent = formatCurrency(avgRate) + '/hr';

    // Trends
    const lastCompanySplit = lastMonthSessions.reduce((sum, s) => sum + num(s.companyAmount), 0);
    setTrend('dash-revenue-trend', thisNet, lastRevenue - lastCompanySplit);
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
    const sessions = App.state.sessions;
    const clients = App.state.clients;

    const now = new Date();
    const thisMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const completed = sessions.filter((s) => s.status === 'completed');
    const monthSessions = completed.filter((s) => s.date && s.date.slice(0, 7) === thisMonth);
    const revenue = monthSessions.reduce((sum, s) => sum + num(s.amount), 0);
    const companySplit = monthSessions.reduce((sum, s) => sum + num(s.companyAmount), 0);
    const active = clients.filter((c) => c.status === 'active').length;

    const hrEl = $('header-revenue');
    if (hrEl) hrEl.textContent = formatCurrency(revenue - companySplit);
    const hsEl = $('header-sessions');
    if (hsEl) hsEl.textContent = monthSessions.length;
    const hcEl = $('header-clients');
    if (hcEl) hcEl.textContent = active;

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
    if (typeof Chart === 'undefined') return;

    const rangeEl = document.querySelector('[data-action="income-chart-range"]');
    const rangeVal = rangeEl ? rangeEl.value : '12';

    const now = new Date();

    // --- Merge live sessions with historical data ---
    // Live sessions (current-year data takes priority over historical for overlapping months)
    const liveSessions = App.state.sessions.filter((s) => s.status === 'completed');

    // Historical sessions (stored as plain objects with date, amount, companyAmount)
    let historicalSessions = [];
    try {
      const raw = localStorage.getItem('tutoring-historical');
      if (raw) historicalSessions = JSON.parse(raw);
    } catch (e) { /* ignore */ }

    // Build a per-month map from historical, then overlay live data months
    const liveMonths = new Set(liveSessions.map((s) => s.date ? s.date.slice(0, 7) : null).filter(Boolean));

    // Historical sessions in months NOT already covered by live data
    const historicalFiltered = historicalSessions.filter(
      (s) => s.date && !liveMonths.has(s.date.slice(0, 7))
    );

    // All sessions to use for the chart
    const allSessions = [...liveSessions, ...historicalFiltered];

    // --- Determine month range ---
    let numMonths;
    if (rangeVal === 'all') {
      // Find earliest date across live + historical
      const allDates = allSessions.map((s) => s.date).filter(Boolean);
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
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
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

    months.forEach((m) => {
      const ms = allSessions.filter((s) => s.date && s.date.slice(0, 7) === m);
      const gross = ms.reduce((sum, s) => sum + num(s.amount), 0);
      const split = ms.reduce((sum, s) => sum + num(s.companyAmount || 0), 0);
      grossData.push(gross);
      companyData.push(split);
      netData.push(gross - split);
      countData.push(ms.length);
    });

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
            label: 'Company Split',
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
        ],
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

    const sessions = App.state.sessions;
    const clients = App.state.clients;

    // Completed only — scheduled/no-show sessions aren't realized revenue
    const completed = sessions.filter((s) => s.status === 'completed');
    const revenueByClient = {};

    completed.forEach((s) => {
      (s.clientIds || []).forEach((cid) => {
        revenueByClient[cid] = (revenueByClient[cid] || 0) + num(s.amount) / (s.clientIds.length || 1);
      });
    });

    const sorted = Object.entries(revenueByClient)
      .map(([id, rev]) => ({ client: clients.find((c) => String(c.id) === String(id)), revenue: rev }))
      .filter((x) => x.client)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);

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
      const name = g.family ? g.family : clientName(g.members[0].client);
      const parts = [g.count + ' unpaid session' + (g.count === 1 ? '' : 's')];
      if (g.family) {
        parts.unshift('<span class="outstanding-tag">family</span>');
        parts.push(g.members.map((m) => escapeHtml(clientName(m.client)) + ' ' + formatCurrency(m.amount)).join(' &middot; '));
      }
      return '<li class="outstanding-item">' +
        '<div class="outstanding-info">' +
          '<span class="outstanding-name">' + escapeHtml(name) + '</span>' +
          '<span class="outstanding-meta">' + parts.join(' &middot; ') + '</span>' +
        '</div>' +
        '<span class="outstanding-amount">' + formatCurrency(g.amount) + '</span>' +
        '<button class="btn btn-sm btn-mark-paid" data-action="mark-group-paid" data-key="' + escapeHtml(g.key) + '" title="Mark all ' + g.count + ' paid">Mark paid</button>' +
      '</li>';
    }).join('');
  }

  // Expose to App namespace
  App.renderDashboard = renderDashboard;
  App.renderOutstanding = renderOutstanding;
  App.renderOwedList = renderOwedList;
  App.updateHeaderStats = updateHeaderStats;
  App.renderIncomeChart = renderIncomeChart;

})();
