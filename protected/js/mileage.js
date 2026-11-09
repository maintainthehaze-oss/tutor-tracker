/* ============================================================
   Tutoring Tracker Pro — Mileage
   OpenRouteService routing, day-order legs, the Sessions-toolbar / Settings
   "Calculate now" tool (offline scan + review, 2026-11-09). Split out of sessions.js (roadmap 4.4).
   Session-form pin button (calcFormMileage). Session rules (isDriveStop, noTravel) stay in sessions.js.
   ============================================================ */
(function () {
  'use strict';

  const App = window.App;
  const $ = App.$;
  const formatDate = App.formatDate;
  const num = App.num;
  const escapeHtml = App.escapeHtml;

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

  /** The details label for stop i (0-based) of n that day. */
  function legLabel(i, n) {
    return 'Leg ' + (i + 1) + ' of ' + n + (i === n - 1 ? ' + return home' : '') + ' (driving route, day order)';
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
      return { ...x, miles: Math.round(miles * 10) / 10, details: legLabel(i, stops.length) };
    });
  }

  function requireMileageSetup() {
    const settings = App.state.settings;
    if (!(settings.businessAddress || '').trim()) throw new Error('Set your Business Address in Settings first.');
    if (!settings.orsApiKey) throw new Error('Add your OpenRouteService API key in Settings first.');
  }

  /* ==========================================================
     CALCULATE NOW (Sessions toolbar + Settings; replaced "Calculate mileage by day" 2026-11-09)
     The old tool re-routed every writable row in all history on each click (73 rows over 55
     days on real data, 68 of them locked) and copied whatever ORS answered that day; a leg
     also went stale when a second stop was added after the first had been calculated.
     This one scans offline first. A "shape" is one leg as the day's drive sees it: where the
     drive came from (home or the previous stop), this address, and whether it drives home
     afterwards. Rows that already carry the correct day-order label vote for their shape's
     miles; a shape with 2+ agreeing rows is known and needs no lookup. Only writable rows
     that are blank, labelled for a day that has since changed, or more than 10% off a known
     shape are proposed, and the owner ticks what gets written. Nothing is stored outside the
     session rows: settings are copied into every locked row and reconciliation demands
     settings equality, so a route table there would break both.
     ========================================================== */

  const DAY_ORDER_LABEL = /^Leg (\d+) of (\d+)( \+ return home)? \(driving route, day order\)$/;
  const JUMP_RATIO = 0.1;  // further than this from the known value = a jump; at or under it the row is left alone
  const SAME_MILES = 0.05; // closer than this = already right (same tolerance as the pin button)
  const TAGS = { blank: ['Blank', 'blank'], stale: ['Day changed', 'stale'], jump: ['Jump', 'jump'], route: ['New route, check it', 'new'] };

  /** One day's stops with their shapes. `ordered` is false when 2+ stops share no reliable time order
   *  (a blank time); `complete` is false when a stop has no address. Shapes exist only on good days. */
  function dayShapes(date, home) {
    const raw = dayStops(date);
    const ordered = raw.length < 2 || raw.every((x) => x.time);
    const complete = raw.every((x) => x.address);
    const stops = raw.map((x, i) => {
      const last = i === raw.length - 1, from = i === 0 ? home : raw[i - 1].address;
      return { ...x, last, from, label: legLabel(i, raw.length), shape: ordered && complete ? from + '|' + x.address + '|' + (last ? 'home' : 'on') : null };
    });
    return { date, stops, ordered, complete };
  }

  /** What history says a shape is worth: the single most common value (at 0.1 mi) backed by 2+ rows whose
   *  label is right for their actual day position. Ties or fewer than 2 rows leave the shape unknown. */
  function shapeConsensus(days) {
    const votes = new Map(); // shape -> Map(miles -> rows)
    days.forEach((d) => d.stops.forEach((x) => {
      if (!x.shape || (x.session.mileageDetails || '') !== x.label) return;
      const miles = Math.round(num(x.session.mileage) * 10) / 10;
      const tally = votes.get(x.shape) || new Map();
      tally.set(miles, (tally.get(miles) || 0) + 1);
      votes.set(x.shape, tally);
    }));
    const known = new Map();
    votes.forEach((tally, shape) => {
      const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
      if (ranked[0][1] >= 2 && (ranked.length === 1 || ranked[1][1] < ranked[0][1])) known.set(shape, ranked[0][0]);
    });
    return known;
  }

  /** Why a writable row needs work: 'blank' (0 mi), 'stale' (label no longer fits its day, or an older
   *  tool label), 'jump' (label right, shape known, value off by more than 10%), or null. */
  function rowIssue(x, known) {
    const miles = num(x.session.mileage), details = x.session.mileageDetails || '';
    if (miles === 0) return 'blank';
    if (details !== x.label) return 'stale';
    const want = known.get(x.shape);
    if (want != null && Math.abs(miles - want) > want * JUMP_RATIO) return 'jump';
    return null;
  }

  /** On a day whose order is unknown only the count is certain: blank, a foreign label, or the wrong n. */
  function roughIssue(x, n) {
    if (num(x.session.mileage) === 0) return 'blank';
    const m = DAY_ORDER_LABEL.exec(x.session.mileageDetails || '');
    return !m || Number(m[2]) !== n ? 'stale' : null;
  }

  /** Offline scan of every day with a drive stop. Pure: reads App.state, calls nothing, writes nothing.
   *  Returns { proposals (answered from history), lookups (stops whose shape history cannot answer),
   *  skipped (dates with work that cannot be placed: no time order or no address), addresses (for the
   *  lookups' ORS disclosure) }. */
  function planCalculateNow() {
    const home = (App.state.settings.businessAddress || '').trim();
    const dates = new Set();
    App.state.sessions.forEach((s) => { if (App.isDriveStop(s) && /^\d{4}-\d{2}-\d{2}$/.test(s.date || '')) dates.add(s.date); });
    const days = [...dates].sort().map((d) => dayShapes(d, home));
    const known = shapeConsensus(days);
    const proposals = [], lookups = [], skipped = [], addresses = new Set();
    days.forEach((day) => {
      const writable = day.stops.filter((x) => isAutoMileage(x.session));
      if (!day.ordered || !day.complete) {
        if (writable.some((x) => (day.ordered ? rowIssue(x, known) : roughIssue(x, day.stops.length)))) skipped.push(day.date);
        return;
      }
      writable.forEach((x) => {
        const reason = rowIssue(x, known);
        if (!reason) return;
        const want = known.get(x.shape);
        if (want == null) {
          lookups.push({ ...x, reason, home });
          [x.from, x.address, home].forEach((a) => { if (a) addresses.add(a); });
          return;
        }
        const proposal = toProposal(x, want, reason, 'history');
        if (proposal) proposals.push(proposal);
      });
    });
    return { proposals, lookups, skipped, addresses };
  }

  /** One review row, or null when the row already says exactly this (label right, miles within 0.05). */
  function toProposal(x, miles, reason, source) {
    const s = x.session;
    if ((s.mileageDetails || '') === x.label && Math.abs(miles - num(s.mileage)) < SAME_MILES) return null;
    return { id: s.id, date: s.date, time: s.time || '', clientIds: s.clientIds || [], old: num(s.mileage), miles, label: x.label, reason, source };
  }

  /** Real ORS routes for the stops history could not answer, only the legs those stops need. A fatal
   *  error (key, network, rate limit) throws; a day whose address cannot be located is skipped. */
  async function lookupStops(lookups, progress) {
    const proposals = [], skipped = [];
    const dates = [...new Set(lookups.map((x) => x.session.date))];
    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      if (progress) progress('Routing day ' + (i + 1) + ' of ' + dates.length + '...');
      try {
        for (const x of lookups.filter((y) => y.session.date === date)) {
          const miles = await routeMiles(x.from, x.address) + (x.last ? await routeMiles(x.address, x.home) : 0);
          const proposal = toProposal(x, Math.round(miles * 10) / 10, x.reason, 'route');
          if (proposal) proposals.push(proposal);
        }
      } catch (e) {
        if (ORS_FATAL.test(e.message)) throw e; // key, network, home address: abort the whole run
        skipped.push(date);
      }
    }
    return { proposals, skipped };
  }

  // Review state: what the modal shows until Save selected or Cancel. Cancel writes nothing.
  let pending = [], pendingSkipped = [];

  /** Toolbar / Settings button: scan offline, confirm only when ORS is needed, then review. */
  async function calculateNow() {
    const btns = [...document.querySelectorAll('[data-action="calc-now"]')];
    if (btns.some((b) => b.disabled)) return false; // a run is in progress
    const plan = planCalculateNow();
    const skippedNote = (n) => (n ? ' ' + n + ' day' + (n === 1 ? '' : 's') + ' skipped: a session there has no time or no address, so its legs cannot be placed.' : '');
    if (!plan.proposals.length && !plan.lookups.length) {
      App.showToast('Nothing to calculate: every routed session matches its day.' + skippedNote(plan.skipped.length), plan.skipped.length ? 'warning' : 'info');
      return false;
    }
    if (!plan.lookups.length) { openReview(plan.proposals, plan.skipped); return true; }
    try { requireMileageSetup(); } catch (e) { App.showToast(e.message, 'warning'); return false; }
    const n = plan.lookups.length;
    App.showConfirm('Calculate now',
      n + ' session' + (n === 1 ? ' has' : 's have') + ' a leg your earlier sessions have never driven, so ' + (n === 1 ? 'it needs' : 'they need') + ' a real route.' +
      ' Up to ' + plan.addresses.size + ' address' + (plan.addresses.size === 1 ? '' : 'es') + ' go to OpenRouteService; ' +
      (plan.proposals.length ? plan.proposals.length + ' other change' + (plan.proposals.length === 1 ? ' is' : 's are') + ' answered from your own history, offline.' : 'nothing else leaves this device.') +
      ' You review every change before anything is saved. Continue?',
      () => runLookups(plan));
    return true;
  }

  async function runLookups(plan) {
    // The same action sits on the Sessions toolbar and in Settings: every button shows the progress.
    const btns = [...document.querySelectorAll('[data-action="calc-now"]')];
    const labels = btns.map((b) => b.innerHTML); // innerHTML: the toolbar button carries an icon
    btns.forEach((b) => { b.disabled = true; });
    try {
      const found = await lookupStops(plan.lookups, (t) => btns.forEach((b) => { b.textContent = t; }));
      openReview(plan.proposals.concat(found.proposals), plan.skipped.concat(found.skipped));
      return true;
    } catch (e) {
      App.showToast(e.message || 'Mileage calculation failed', 'error');
      return false;
    } finally {
      btns.forEach((b, i) => { b.disabled = false; b.innerHTML = labels[i]; });
    }
  }

  /** Client last names on a row, for the review list. */
  function proposalWho(clientIds) {
    const names = clientIds.map((cid) => {
      const c = App.state.clients.find((cl) => String(cl.id) === String(cid));
      return c ? ((c.lastName || '').trim() || App.clientName(c)) : 'Unknown';
    });
    return [...new Set(names)].join(' + ');
  }

  function openReview(proposals, skipped) {
    pending = proposals.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    pendingSkipped = skipped;
    const list = $('calc-now-list'), note = $('calc-now-note');
    if (!list) return;
    const rows = pending.map((p) => {
      const tag = TAGS[p.source === 'route' ? 'route' : p.reason];
      return '<tr>' +
        '<td><input type="checkbox" checked data-id="' + escapeHtml(String(p.id)) + '" aria-label="Save this change"></td>' +
        '<td>' + escapeHtml(formatDate(p.date)) + (p.time ? ' <span class="text-muted">' + escapeHtml(p.time) + '</span>' : '') + '</td>' +
        '<td class="calc-now-who">' + escapeHtml(proposalWho(p.clientIds)) + '</td>' +
        '<td class="calc-now-miles">' + escapeHtml(p.old.toFixed(1)) + ' &rarr; <strong>' + escapeHtml(p.miles.toFixed(1)) + '</strong></td>' +
        '<td><span class="calc-tag calc-tag-' + tag[1] + '" title="' + escapeHtml(p.label) + '">' + escapeHtml(tag[0]) + '</span></td>' +
        '</tr>';
    });
    list.innerHTML = '<table class="data-table data-table-sm calc-now-table"><thead><tr><th aria-label="Save"></th><th>Date</th><th>Client</th><th>Miles</th><th>Why</th></tr></thead>' +
      '<tbody>' + rows.join('') + '</tbody></table>';
    if (note) {
      note.textContent = skipped.length
        ? skipped.length + ' day' + (skipped.length === 1 ? '' : 's') + ' skipped (' + skipped.map(formatDate).join(', ') + '): a session there has no time or no address, so its legs cannot be placed.'
        : '';
      note.hidden = !skipped.length;
    }
    App.openModal('modal-calc-now');
  }

  /** Save selected: write the ticked rows only. Unlocked rows update in place; locked rows take one
   *  correctMany (append-only, originals kept). runCommand re-renders and reports a stale revision. */
  async function saveCalculateNow() {
    const list = $('calc-now-list');
    const ticked = new Set([...(list ? list.querySelectorAll('input[data-id]') : [])].filter((el) => el.checked).map((el) => el.getAttribute('data-id')));
    const chosen = pending.filter((p) => ticked.has(String(p.id)));
    const left = pending.length - chosen.length, skipped = pendingSkipped.length;
    App.closeModal('modal-calc-now');
    pending = []; pendingSkipped = [];
    if (!await applyProposals(chosen)) return false;
    App.showToast('Mileage set on ' + chosen.length + ' session' + (chosen.length === 1 ? '' : 's') + '.' +
      (left ? ' ' + left + ' left as ' + (left === 1 ? 'it was' : 'they were') + '.' : '') +
      (skipped ? ' ' + skipped + ' day' + (skipped === 1 ? '' : 's') + ' skipped (no time order or no address).' : ''),
      skipped ? 'warning' : 'success');
    return true;
  }

  async function applyProposals(proposals) {
    const updates = [], corrections = [];
    proposals.forEach((p) => {
      const fields = { mileage: p.miles, mileageCalculated: true, mileageManual: false, mileageDetails: p.label };
      (App.isProtectedSession(p.id) ? corrections : updates).push({ id: p.id, fields });
    });
    for (const u of updates) {
      if (!await App.runCommand('session.update', { ids: [u.id], patch: u.fields }, App.repository.revision)) return false;
    }
    if (corrections.length) {
      if (!await App.runCommand('session.correctMany', { items: corrections }, App.repository.revision)) return false;
    }
    return true;
  }

  /** Session-form pin button: this session's leg within its day, in drive order. Editable before save. */
  async function calcFormMileage() {
    const input = $('session-mileage');
    const btn = document.querySelector('[data-action="calc-mileage"]');
    if (!input) return false;
    const selected = App.getSelectedSessionClientIds();
    if (selected.length === 0) { App.showToast('Select a client first', 'warning'); return false; }
    if (($('session-type').value || 'in-person') === 'online') {
      App.showToast('Online session: no travel. Change Session Type to In Person to calculate mileage.', 'warning');
      return false;
    }
    if (App.readInPersonMinutes() === 0) {
      App.showToast('Hybrid with 0 minutes in person: no travel, so no mileage.', 'warning');
      return false;
    }
    const date = $('session-date').value;
    if (!date) { App.showToast('Enter the session date first', 'warning'); return false; }
    const address = sessionAddress({ clientIds: selected });
    if (btn) btn.disabled = true;
    // The lookup waits on the network; if the form was closed or reopened meanwhile, the result belongs to nobody.
    const gen = App.getModalGeneration ? App.getModalGeneration() : null;
    const stale = () => gen != null && App.getModalGeneration && App.getModalGeneration() !== gen;
    try {
      requireMileageSetup();
      if (!address) throw new Error('This client has no address on file. Add it on the Clients tab.');
      const extra = { session: null, address, time: $('session-time').value || '' };
      const planned = await planDay(dayStops(date, extra, $('session-id').value));
      if (stale()) return false;
      const mine = planned.find((x) => x.session === null);
      input.value = mine.miles;
      input.dataset.details = mine.details;
      const others = planned.filter((x) => x.session && isAutoMileage(x.session) && Math.abs(x.miles - num(x.session.mileage)) >= 0.05);
      App.showToast(mine.miles.toFixed(1) + ' mi: ' + mine.details.replace(' (driving route, day order)', '') +
        ' that day. Edit before saving if needed.' +
        (others.length ? ' ' + others.length + ' other session' + (others.length === 1 ? '' : 's') +
          ' that day will change: press "Calculate now" on the Sessions tab after saving.' : ''),
        others.length ? 'warning' : 'success');
      return true;
    } catch (e) {
      App.showToast(e.message || 'Mileage calculation failed', 'error');
      return false;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // Typing over an auto-calculated figure makes it hand-entered again.
  document.addEventListener('input', (e) => {
    if (e.target && e.target.id === 'session-mileage') delete e.target.dataset.details;
  });

  // Expose to App namespace
  App.calcFormMileage = calcFormMileage;
  App.calculateNow = calculateNow;
  App.saveCalculateNow = saveCalculateNow;
  App.sessionAddress = sessionAddress;
  App.mileage = { sessionAddress, isAutoMileage, dayStops, planDay, requireMileageSetup, legLabel,
    dayShapes, shapeConsensus, rowIssue, planCalculateNow, lookupStops, applyProposals, TAGS };

})();
