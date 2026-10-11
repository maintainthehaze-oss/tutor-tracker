/* ============================================================
   Tutoring Tracker Pro — Mileage
   OpenRouteService routing, day-order legs, the Settings / toolbar
   "Calculate mileage by day" tool. Split out of sessions.js (roadmap 4.4).
   Session rules (isDriveStop, noTravel) stay in sessions.js.
   ============================================================ */
(function () {
  'use strict';

  const App = window.App;
  const $ = App.$;
  const formatDate = App.formatDate;
  const num = App.num;

  /* ==========================================================
     MILEAGE CALCULATION (OpenRouteService; day-sequential legs)
     Drive order per day: home -> stop 1 -> ... -> stop n -> home. Each stop is
     credited the leg that arrives at it; the last stop also gets the return
     leg (so a lone session = a round trip). Hand-entered miles are never
     changed, but they still shape the route. Only real driving routes are
     written: no estimates, no guesses. Nothing runs in the background.
     ========================================================== */

  const ORS_BASE = 'https://api.openrouteservice.org';
  const geocodeCache = new Map(); // address -> [lng, lat]
  const routeCache = new Map();   // 'from|to' -> one-way miles
  let orsRouteCalls = 0;
  const ORS_FATAL = /API key|reach OpenRouteService|rate limit|OpenRouteService error|Business Address/;

  // Key goes in the Authorization header, never the query string: URLs leak
  // into browser history, referrers and network logs.
  async function orsFetch(path, options) {
    let resp;
    try {
      resp = await fetch(ORS_BASE + path, options);
    } catch (e) {
      // ORS answers a bad/missing key with 401/403 and NO CORS headers, so the
      // browser reports it as a network failure. Cover both causes.
      throw new Error('Could not reach OpenRouteService. Check the API key in Settings, or your connection.');
    }
    if (resp.status === 401 || resp.status === 403) throw new Error('OpenRouteService rejected the API key. Check it in Settings.');
    if (resp.status === 429) throw new Error('OpenRouteService rate limit reached. Try again in a minute.');
    if (resp.status === 404) return null; // directions: no route between the points
    if (!resp.ok) throw new Error('OpenRouteService error (HTTP ' + resp.status + ').');
    return resp.json();
  }

  /** [lng, lat] for an address, or null when ORS cannot find it. Cached per page load. */
  async function geocode(address) {
    if (geocodeCache.has(address)) return geocodeCache.get(address);
    const data = await orsFetch('/geocode/search?text=' + encodeURIComponent(address) + '&size=1&boundary.country=US',
      { headers: { Authorization: App.state.settings.orsApiKey } });
    if (data && data.features && data.features.length > 0) {
      const c = data.features[0].geometry.coordinates;
      geocodeCache.set(address, [c[0], c[1]]);
      return geocodeCache.get(address);
    }
    return null;
  }

  /** One-way driving miles between two addresses (real route only). Cached per address pair. */
  async function routeMiles(from, to) {
    if (from === to) return 0;
    const k = from + '|' + to;
    if (routeCache.has(k)) return routeCache.get(k);
    const a = await geocode(from);
    if (!a) throw new Error('Could not locate address: ' + from);
    const b = await geocode(to);
    if (!b) throw new Error('Could not locate address: ' + to);
    const data = await orsFetch('/v2/directions/driving-car', {
      method: 'POST',
      headers: { Authorization: App.state.settings.orsApiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: [a, b] }),
    });
    orsRouteCalls++;
    if (!data || !data.routes || !data.routes.length) throw new Error('No driving route between ' + from + ' and ' + to);
    const miles = data.routes[0].summary.distance / 1609.34;
    routeCache.set(k, miles);
    // Free ORS tier allows 40 directions calls a minute; pace long runs.
    await new Promise((r) => setTimeout(r, orsRouteCalls > 30 ? 1600 : 250));
    return miles;
  }

  /** Where a session happened: the address stored on it, else the first of its clients with one. */
  function sessionAddress(s) {
    if (s.address && s.address.trim()) return s.address.trim();
    for (const cid of (s.clientIds || [])) {
      const c = App.state.clients.find((cl) => String(cl.id) === String(cid));
      if (c && c.address && c.address.trim()) return c.address.trim();
    }
    return '';
  }

  /** Values this tool may (re)write: hand-entered miles are final; miles from the retired
   *  root app's own recalc ("Leg n of m (real route)") are left alone as well. */
  const OWN_DETAILS = /^(Driving route, round trip:|Straight-line estimate|Leg \d+ of \d+ .*\(driving route, day order\))/;
  function isAutoMileage(s) {
    return s.mileageManual !== true && (num(s.mileage) === 0 || OWN_DETAILS.test(s.mileageDetails || ''));
  }

  /** The day's stops in drive order (by time; blank time first). `extra` = an unsaved form session. */
  function dayStops(date, extra, excludeId) {
    const rows = App.state.sessions
      .filter((s) => s.date === date && String(s.id) !== String(excludeId) && App.isDriveStop(s))
      .map((s) => ({ session: s, address: sessionAddress(s), time: s.time || '' }));
    if (extra) rows.push(extra);
    rows.sort((a, b) => a.time.localeCompare(b.time));
    return rows;
  }

  /** Route one day's stops home -> ... -> home. Returns the stops with miles + details, or throws. */
  async function planDay(stops) {
    const home = (App.state.settings.businessAddress || '').trim();
    const missing = stops.find((x) => !x.address);
    if (missing) throw new Error('A session that day has no address (client has none on file).');
    const route = [home, ...stops.map((x) => x.address), home];
    const legs = [];
    for (let i = 0; i < route.length - 1; i++) legs.push(await routeMiles(route[i], route[i + 1]));
    return stops.map((x, i) => {
      const last = i === stops.length - 1;
      const miles = legs[i] + (last ? legs[legs.length - 1] : 0);
      return { ...x, miles: Math.round(miles * 10) / 10,
        details: 'Leg ' + (i + 1) + ' of ' + stops.length + (last ? ' + return home' : '') + ' (driving route, day order)' };
    });
  }

  function requireMileageSetup() {
    const settings = App.state.settings;
    if (!(settings.businessAddress || '').trim()) throw new Error('Set your Business Address in Settings first.');
    if (!settings.orsApiKey) throw new Error('Add your OpenRouteService API key in Settings first.');
  }

  /** Settings tool: route every day that has an auto-calculable session, in drive order.
   *  Fills 0-mi sessions, corrects this tool's own earlier values, never touches hand-entered miles. */
  async function calculateMileageByDay() {
    try { requireMileageSetup(); } catch (e) { App.showToast(e.message, 'warning'); return false; }
    const dates = new Set();
    let targets = 0;
    App.state.sessions.forEach((s) => {
      if (!App.isDriveStop(s) || !isAutoMileage(s) || !/^\d{4}-\d{2}-\d{2}$/.test(s.date || '')) return;
      dates.add(s.date); targets++;
    });
    if (!targets) { App.showToast('Nothing to calculate: every in-person session already has miles (hand-entered miles are never changed).', 'info'); return false; }
    const addresses = new Set();
    let noAddress = 0;
    dates.forEach((d) => dayStops(d).forEach((x) => { if (x.address) addresses.add(x.address); else noAddress++; }));
    App.showConfirm('Calculate mileage by day',
      dates.size + ' day' + (dates.size === 1 ? '' : 's') + ' (' + targets + ' session' + (targets === 1 ? '' : 's') + ') will be routed in drive order:' +
      ' home, then each session in time order, then home. Each session gets its own leg; the last one also gets the drive home.' +
      ' Hand-entered miles are never changed. Locked sessions keep their original on file.' +
      (noAddress ? ' ' + noAddress + ' session' + (noAddress === 1 ? '' : 's') + ' with no client address will make their day skip.' : '') +
      ' Up to ' + (addresses.size + 1) + ' addresses go to OpenRouteService. Continue?',
      () => runCalculateMileageByDay([...dates].sort()));
    return true;
  }

  async function runCalculateMileageByDay(dates) {
    // The same action sits on the Sessions toolbar and in Settings: every button shows the progress.
    const btns = [...document.querySelectorAll('[data-action="calc-mileage-by-day"]')];
    const labels = btns.map((b) => b.textContent);
    btns.forEach((b) => { b.disabled = true; });
    const btn = { set textContent(t) { btns.forEach((b) => { b.textContent = t; }); } };
    const updates = [], corrections = [], skipped = [];
    let unchanged = 0;
    try {
      for (let i = 0; i < dates.length; i++) {
        const date = dates[i];
        if (btn) btn.textContent = 'Routing day ' + (i + 1) + ' of ' + dates.length + '...';
        let planned;
        try {
          planned = await planDay(dayStops(date));
        } catch (e) {
          if (ORS_FATAL.test(e.message)) throw e; // key, network, home address: abort the whole run
          skipped.push(formatDate(date) + ': ' + e.message);
          continue;
        }
        planned.forEach((x) => {
          if (!x.session || !isAutoMileage(x.session)) return;
          if (Math.abs(x.miles - num(x.session.mileage)) < 0.05) { unchanged++; return; }
          const fields = { mileage: x.miles, mileageCalculated: true, mileageManual: false, mileageDetails: x.details };
          (App.isProtectedSession(x.session.id) ? corrections : updates).push({ id: x.session.id, fields });
        });
      }
      for (const u of updates) {
        if (!await App.runCommand('session.update', { ids: [u.id], patch: u.fields }, App.repository.revision)) return false;
      }
      if (corrections.length) {
        if (!await App.runCommand('session.correctMany', { items: corrections }, App.repository.revision)) return false;
      }
      const written = updates.length + corrections.length;
      if (skipped.length) console.warn('Calculate mileage by day: days left unchanged:', skipped);
      App.showToast('Mileage set on ' + written + ' session' + (written === 1 ? '' : 's') + ' across ' + dates.length + ' day' + (dates.length === 1 ? '' : 's') + '.' +
        (unchanged ? ' ' + unchanged + ' already correct.' : '') +
        (skipped.length ? ' ' + skipped.length + ' day' + (skipped.length === 1 ? '' : 's') + ' skipped (no address or no route); see console.' : ''),
        skipped.length ? 'warning' : 'success');
      return true;
    } catch (e) {
      App.showToast(e.message || 'Mileage calculation failed', 'error');
      return false;
    } finally {
      btns.forEach((b, i) => { b.disabled = false; b.textContent = labels[i]; });
    }
  }

  // Expose to App namespace
  App.calculateMileageByDay = calculateMileageByDay;
  App.sessionAddress = sessionAddress;
  App.mileage = { sessionAddress, isAutoMileage, dayStops, planDay, requireMileageSetup };

})();
