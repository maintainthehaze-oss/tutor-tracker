/* ============================================================
   Tutoring Tracker Pro — Historical Data
   Reads/writes ONLY from localStorage key 'tutoring-historical'.
   Data never leaves the device. No file fetch, no network call.
   ============================================================ */
(function () {
  'use strict';

  const App = window.App;
  const STORAGE_KEY = 'tutoring-historical';

  App.state.yoyChart = null;

  /* ----------------------------------------------------------
     Read historical sessions from localStorage (device only).
  ---------------------------------------------------------- */
  function getHistoricalSessions() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.warn('[historical] Could not read localStorage:', e.message);
      return [];
    }
  }

  /* ----------------------------------------------------------
     Write historical sessions to localStorage.
  ---------------------------------------------------------- */
  function saveHistoricalSessions(sessions) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
      return true;
    } catch (e) {
      App.showToast('Historical data too large for storage: ' + e.message, 'error');
      return false;
    }
  }

  /* ----------------------------------------------------------
     Import: called when the user selects their JSON file.
     Reads the file client-side, validates, saves to localStorage.
  ---------------------------------------------------------- */
  function importHistoricalFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const data = JSON.parse(e.target.result);
        const sessions = Array.isArray(data.sessions) ? data.sessions : (Array.isArray(data) ? data : null);
        if (!sessions) {
          App.showToast('Invalid file — expected { sessions: [...] }', 'error');
          return;
        }
        // Basic validation: each entry must have date and amount
        const valid = sessions.filter(function (s) {
          return s && s.date && typeof s.date === 'string';
        });
        if (valid.length === 0) {
          App.showToast('No valid session records found in file', 'error');
          return;
        }
        if (saveHistoricalSessions(valid)) {
          App.showToast('Loaded ' + valid.length + ' historical sessions (stored locally only)', 'success');
          // Re-render dashboard chart
          if (typeof App.renderYearOverYearChart === 'function') {
            App.renderYearOverYearChart();
          }
        }
      } catch (err) {
        App.showToast('Could not parse file: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  }

  /* ----------------------------------------------------------
     Clear all historical data from localStorage.
  ---------------------------------------------------------- */
  function clearHistoricalData() {
    localStorage.removeItem(STORAGE_KEY);
    App.showToast('Historical data cleared', 'success');
    if (typeof App.renderYearOverYearChart === 'function') {
      App.renderYearOverYearChart();
    }
  }

  /* ----------------------------------------------------------
     Aggregate net revenue per calendar year from a session array.
     Only counts completed sessions with amount > 0.
  ---------------------------------------------------------- */
  function netByYear(sessions) {
    const map = {};
    sessions.forEach(function (s) {
      if (s.status !== 'completed') return;
      const amt = parseFloat(s.amount) || 0;
      if (amt === 0) return;
      const cp  = parseFloat(s.companyAmount) || 0;
      const yr  = s.date ? s.date.slice(0, 4) : null;
      if (!yr) return;
      if (!map[yr]) map[yr] = { gross: 0, cp: 0 };
      map[yr].gross += amt;
      map[yr].cp    += cp;
    });
    return map;
  }

  /* ----------------------------------------------------------
     Render (or re-render) the year-over-year chart.
     Called from renderDashboard(). Safe to call multiple times.
  ---------------------------------------------------------- */
  function renderYearOverYearChart() {
    const canvas = document.getElementById('yoy-chart');
    if (!canvas) return;
    if (typeof Chart === 'undefined') return;

    const historicalSessions = getHistoricalSessions();

    // Build year maps
    const histMap = netByYear(historicalSessions);
    const liveMap = netByYear(App.state.sessions || []);

    // Merge — live data wins for any year that overlaps
    const allYears = new Set(Object.keys(histMap).concat(Object.keys(liveMap)));
    const sorted = Array.from(allYears).sort();

    const labels    = [];
    const grossData = [];
    const cpData    = [];
    const netData   = [];

    sorted.forEach(function (yr) {
      const h = histMap[yr] || { gross: 0, cp: 0 };
      const l = liveMap[yr] || { gross: 0, cp: 0 };
      // Live sessions take priority for years that have them
      const gross = l.gross > 0 ? l.gross : h.gross;
      const cp    = l.gross > 0 ? l.cp    : h.cp;
      labels.push(yr);
      grossData.push(parseFloat(gross.toFixed(2)));
      cpData.push(parseFloat(cp.toFixed(2)));
      netData.push(parseFloat((gross - cp).toFixed(2)));
    });

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
            label: 'Company Split',
            data: cpData,
            backgroundColor: colorCp + '55',
            borderColor: colorCp,
            borderWidth: 1,
            borderRadius: 4,
            order: 3,
          },
        ],
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
