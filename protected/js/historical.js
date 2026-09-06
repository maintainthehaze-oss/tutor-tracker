/* ============================================================
   Tutoring Tracker Pro — Historical Data
   Reads protected repository history; import and clear are unavailable.
   Data never leaves the device. No file fetch, no network call.
   ============================================================ */
(function () {
  'use strict';

  const App = window.App;


  App.state.yoyChart = null;

  /* ----------------------------------------------------------
     Read historical sessions from the protected local repository.
  ---------------------------------------------------------- */
  function getHistoricalSessions() { return App.repository.read().historical; }
  function importHistoricalFile() { App.showToast('Historical import is unavailable until protected reconciliation is verified.', 'warning'); }
  function clearHistoricalData() { App.showToast('Historical evidence cannot be cleared.', 'warning'); }

  /* ----------------------------------------------------------
     Render (or re-render) the year-over-year chart.
     Called from renderDashboard(). Safe to call multiple times.
  ---------------------------------------------------------- */
  function renderYearOverYearChart() {
    const canvas = document.getElementById('yoy-chart');
    if (!canvas) return;
    let unavailable = document.getElementById('yoy-chart-unavailable');
    if (!unavailable) {
      unavailable = document.createElement('p');
      unavailable.id = 'yoy-chart-unavailable';
      unavailable.className = 'text-muted';
      unavailable.setAttribute('role', 'status');
      unavailable.textContent = 'Year-over-year chart unavailable: the chart library is not loaded. Yearly totals remain available in Reports.';
      canvas.parentNode.parentNode.insertBefore(unavailable, canvas.parentNode);
    }
    unavailable.hidden = typeof Chart !== 'undefined';
    canvas.parentNode.hidden = !unavailable.hidden;
    if (!unavailable.hidden) return;

    const sessions = App.reportModel.context().sessions;
    const sorted = Array.from(new Set(sessions.filter((s) => s.status === 'completed' && typeof s.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.date) && Number.isFinite(Date.parse(s.date + 'T00:00:00'))).map((s) => s.date.slice(0, 4)))).sort();
    const labels = [];
    const grossData = [];
    const cpData = [];
    const netData = [];
    let hasLegacyShare = false;
    const warnings = [];
    sorted.forEach(function (yr) {
      const metrics = App.reportModel.metrics({ year: yr });
      labels.push(yr);
      grossData.push(metrics.gross);
      cpData.push(metrics.companySplit);
      netData.push(metrics.yourCut);
      hasLegacyShare = hasLegacyShare || metrics.hasLegacyShare;
      warnings.push(...metrics.warnings);
    });
    let notice = document.getElementById('yoy-report-notice');
    if (!notice) {
      notice = document.createElement('p');
      notice.id = 'yoy-report-notice';
      notice.className = 'text-muted';
      notice.setAttribute('role', 'status');
      canvas.parentNode.parentNode.insertBefore(notice, canvas.parentNode);
    }
    notice.textContent = warnings.length ? App.reportModel.notice(warnings, 'current-v2') : '';
    notice.hidden = !warnings.length;

    const isDark    = document.documentElement.getAttribute('data-theme') !== 'light';
    const textColor = isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)';
    const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
    const colorNet  = isDark ? '#2ecc71' : '#27ae60';
    const colorGross= isDark ? '#6c63ff' : '#5a52d5';
    const colorCp   = isDark ? '#ff6584' : '#e8547a';

    if (App.state.yoyChart) {
      App.state.yoyChart.destroy();
      App.state.yoyChart = null;
    }

    // If no data at all, show empty state message and return
    if (sorted.length === 0) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    App.state.yoyChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Net Revenue',
            data: netData,
            backgroundColor: colorNet + 'cc',
            borderColor: colorNet,
            borderWidth: 1,
            borderRadius: 4,
            order: 1,
          },
          {
            label: 'Gross Revenue',
            data: grossData,
            backgroundColor: colorGross + '55',
            borderColor: colorGross,
            borderWidth: 1,
            borderRadius: 4,
            order: 2,
          },
          {
            label: 'Historical share',
            data: cpData,
            backgroundColor: colorCp + '55',
            borderColor: colorCp,
            borderWidth: 1,
            borderRadius: 4,
            order: 3,
          },
        ].filter((dataset) => dataset.label !== 'Historical share' || hasLegacyShare),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: textColor } },
          tooltip: {
            mode: 'index',
            intersect: false,
            callbacks: {
              label: function (ctx) {
                const val = ctx.parsed.y;
                return ctx.dataset.label + ': $' + val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
              },
            },
          },
        },
        scales: {
          x: {
            ticks: { color: textColor },
            grid:  { color: gridColor },
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: textColor,
              callback: function (v) { return '$' + v.toLocaleString(); },
            },
            grid: { color: gridColor },
          },
        },
      },
    });
  }

  // Expose to App namespace
  App.renderYearOverYearChart = renderYearOverYearChart;
  App.importHistoricalFile    = importHistoricalFile;
  App.clearHistoricalData     = clearHistoricalData;
  App.getHistoricalSessions   = getHistoricalSessions;

})();
