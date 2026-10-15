'use strict';
// Audit fix 1, phase 1: backup safety net. Pill-state logic is a pure function (backup-status.js);
// the wiring is exercised through the real ui.js with a fake DOM. No browser: NOT observed live.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, memoryStorage, readSource } = require('./helpers/harness.cjs');
const { bootUi } = require('./helpers/ui-app.cjs');

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-03-10T12:00:00').getTime();
const iso = ms => new Date(ms).toISOString();
const copy = x => JSON.parse(JSON.stringify(x)); // values created inside the vm context have foreign prototypes
const load = globals => loadApp(['app-core', 'backup-status'], { globals }).backupStatus;

test('backupState (pure): label, age, changes since, amber at 7 days or 10 changes', () => {
  const B = load({ localStorage: memoryStorage() }), meta = (revision, agoMs) => ({ revision, date: iso(NOW - agoMs) });
  const state = (m, revision) => { const s = B.backupState(m, revision, NOW); return [s.level, s.label]; };
  assert.deepEqual(state(meta(100, 3 * DAY), 112), ['amber', '3d / 12 changes']);   // the audit's example
  assert.deepEqual(state(meta(100, 0), 100), ['ok', 'today / 0 changes']);
  assert.deepEqual(state(meta(100, DAY + 1), 101), ['ok', '1d / 1 change']);
  assert.deepEqual(state(meta(100, 0), 109), ['ok', 'today / 9 changes']);
  assert.deepEqual(state(meta(100, 0), 110), ['amber', 'today / 10 changes']);
  // Age is counted in calendar days, not 24-hour spans (NOW is noon): 6 days 23 h ago is still the 7th day back.
  assert.deepEqual(state(meta(100, 6 * DAY + 11 * 60 * 60 * 1000), 100), ['ok', '6d / 0 changes']);
  assert.deepEqual(state(meta(100, 7 * DAY - 1), 100), ['amber', '7d / 0 changes']);
  assert.deepEqual(state(meta(100, 7 * DAY), 100), ['amber', '7d / 0 changes']);
  // A backup at 11 pm is "1d" the next morning, not "today".
  assert.deepEqual(state(meta(100, 13 * 60 * 60 * 1000), 100), ['ok', '1d / 0 changes']);
  assert.deepEqual(state(meta(100, 11 * 60 * 60 * 1000), 100), ['ok', 'today / 0 changes']);
  assert.deepEqual(state(meta(100, 400 * DAY), 100), ['amber', '400d / 0 changes']);
  // Never backed up from this browser: every saved change counts.
  assert.deepEqual(state(null, 0), ['ok', 'never / 0 changes']);
  assert.deepEqual(state(null, 9), ['ok', 'never / 9 changes']);
  assert.deepEqual(state(null, 10), ['amber', 'never / 10 changes']);
  // Records older than the last backup (a restore happened): bookkeeping no longer applies.
  assert.deepEqual(state(meta(100, 0), 40), ['amber', 'check']);
  // Records not open yet: no pill at all.
  for (const revision of [null, undefined, -1, 1.5, '7']) assert.equal(B.backupState(meta(1, 0), revision, NOW).level, 'hidden');
  // Garbage bookkeeping is treated as "never", not trusted and never thrown on.
  for (const bad of ['text', 7, [], {}, { revision: '5', date: iso(NOW) }, { revision: -1, date: iso(NOW) }, { revision: 5 }, { revision: 5, date: 'soon' }, { revision: 5, date: iso(NOW + 3 * DAY) }])
    assert.deepEqual(state(bad, 12), ['amber', 'never / 12 changes'], JSON.stringify(bad));
  const amber = B.backupState(meta(100, 8 * DAY), 103, NOW);
  assert.equal(amber.message, 'Last backup 8 days ago, 3 saved changes since. Time to back up.');
  assert.equal(amber.title, amber.message + ' Click to download a backup now.');
  assert.equal(B.AMBER_DAYS, 7); assert.equal(B.AMBER_CHANGES, 10);
});

test('bannerDue (pure): amber only, 24 h snooze, at most once per calendar day', () => {
  const B = load({ localStorage: memoryStorage() }), amber = { level: 'amber' }, today = '2026-03-10', yesterday = '2026-03-09';
  assert.equal(B.bannerDue(amber, null, NOW), true);
  assert.equal(B.bannerDue({ level: 'ok' }, null, NOW), false);
  assert.equal(B.bannerDue({ level: 'hidden' }, null, NOW), false);
  assert.equal(B.bannerDue(null, null, NOW), false);
  assert.equal(B.bannerDue(amber, { until: iso(NOW + 1) }, NOW), false, 'snoozed');
  assert.equal(B.bannerDue(amber, { until: iso(NOW) }, NOW), true, 'snooze just ended');
  assert.equal(B.bannerDue(amber, { until: iso(NOW - DAY), shownOn: today }, NOW), false, 'already shown today');
  assert.equal(B.bannerDue(amber, { shownOn: yesterday }, NOW), true);
  assert.equal(B.bannerDue(amber, { until: 'garbage', shownOn: 5 }, NOW), true);
});

test('backupFilename (pure): tutor-tracker-recovery-YYYY-MM-DD-rNNN.json with the LOCAL date', () => {
  const B = load({ localStorage: memoryStorage() });
  assert.equal(B.backupFilename(NOW, 7, true), 'tutor-tracker-recovery-2026-03-10-r007.json');
  assert.equal(B.backupFilename(NOW, 123, true), 'tutor-tracker-recovery-2026-03-10-r123.json');
  assert.equal(B.backupFilename(NOW, 4321, true), 'tutor-tracker-recovery-2026-03-10-r4321.json');
  assert.equal(B.backupFilename(new Date('2026-12-31T23:30:00').getTime(), 0, true), 'tutor-tracker-recovery-2026-12-31-r000.json');
  assert.equal(B.backupFilename(NOW, null, true), 'tutor-tracker-recovery-2026-03-10-r000.json');
  assert.equal(B.backupFilename(NOW, 7, false), 'synthetic-protected-backup-2026-03-10-r007.json');
});

test('bookkeeping lives in two UI keys, holds no records, and never throws when storage is unavailable', () => {
  const storage = memoryStorage(), B = load({ localStorage: storage });
  assert.equal(B.readMeta(), null);
  B.markShown(NOW); B.snooze(NOW);
  assert.deepEqual(copy(B.readSnooze()), { shownOn: '2026-03-10', until: iso(NOW + DAY) });
  B.recordBackup(42, NOW);
  assert.deepEqual(storage.dump(), { 'tutoring-backup-meta': JSON.stringify({ revision: 42, date: iso(NOW) }) }, 'a backup clears the snooze');
  assert.deepEqual(copy(B.readMeta()), { revision: 42, date: iso(NOW) });
  storage.setItem('tutoring-backup-meta', '{not json'); assert.equal(B.readMeta(), null);
  const broken = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); } };
  const blocked = load({ localStorage: broken });
  blocked.recordBackup(1, NOW); blocked.snooze(NOW); blocked.markShown(NOW);
  assert.equal(blocked.readMeta(), null); assert.equal(blocked.readSnooze(), null);
});

test('storage.persist() is feature-detected and every failure is silent', async () => {
  const persist = navigator => load({ localStorage: memoryStorage(), navigator }).requestPersistence();
  assert.equal(await persist({ storage: { persist: async () => true } }), true);
  assert.equal(await persist({ storage: { persist: async () => false } }), false);
  assert.equal(await persist({ storage: { persist: () => true } }), true, 'non-promise return');
  assert.equal(await persist({ storage: { persist: async () => { throw Error('denied'); } } }), false);
  assert.equal(await persist({ storage: { persist() { throw Error('sync failure'); } } }), false);
  assert.equal(await persist({ storage: {} }), false);
  assert.equal(await persist({}), false);
  assert.equal(await persist(undefined), false);
});

test('wiring: 10 saves turn the pill amber; a click downloads a dated file and resets it; survives reload', async () => {
  const ui = await bootUi();
  const pill = ui.field('header-backup-pill'), label = ui.field('header-backup'), banner = ui.field('backup-banner');
  banner.hidden = true;                                       // as in index.html
  const start = ui.App.repository.revision;
  assert.equal(pill.hidden, false); assert.equal(label.textContent, 'never / ' + start + ' change' + (start === 1 ? '' : 's'));
  assert.equal(pill.classList.contains('is-amber'), false);
  await ui.save(9 - start);
  assert.equal(label.textContent, 'never / 9 changes'); assert.equal(pill.classList.contains('is-amber'), false); assert.equal(banner.hidden, true);
  await ui.save(1);
  assert.equal(label.textContent, 'never / 10 changes'); assert.equal(pill.classList.contains('is-amber'), true);
  assert.equal(banner.hidden, false, 'banner appears when the pill turns amber');
  assert.match(ui.field('backup-banner-msg').textContent, /No backup has been downloaded from this browser yet: 10 saved changes/);
  // Remind me later: hidden, snoozed 24 h, further saves do not bring it back.
  await ui.click('dismiss-backup-banner');
  assert.equal(banner.hidden, true); assert.equal(ui.App.backupStatus.readSnooze().until, iso(ui.clock.now + DAY));
  await ui.save(2); assert.equal(banner.hidden, true); assert.equal(label.textContent, 'never / 12 changes');
  // Click the pill: dated file, bookkeeping recorded, pill reset. The store itself is untouched by a backup.
  const revision = ui.App.repository.revision, before = JSON.stringify(ui.disk());
  await ui.click('backup-data');
  await ui.waitFor(() => ui.downloads.length === 1, 'the backup download');
  assert.deepEqual(ui.downloads.map(d => [d.filename, d.type]), [['synthetic-protected-backup-2026-03-10-r012.json', 'application/json']]);
  assert.equal(JSON.parse(ui.downloads[0].content).snapshot.revision, revision, 'file name and contents describe the same revision');
  assert.equal(JSON.stringify(ui.disk()), before);
  assert.equal(label.textContent, 'today / 0 changes'); assert.equal(pill.classList.contains('is-amber'), false);
  assert.deepEqual(ui.storage.dump(), { 'tutoring-backup-meta': JSON.stringify({ revision, date: iso(ui.clock.now) }) });
  // Reload (same localStorage, same stored records): still reset.
  const again = await bootUi({ storage: ui.storage, stored: ui.disk(), time: ui.time });
  assert.equal(again.field('header-backup').textContent, 'today / 0 changes');
  assert.equal(again.field('header-backup-pill').classList.contains('is-amber'), false);
  // A week later with no new backup: amber again, and the banner is due again.
  ui.clock.now += 7 * DAY;
  const later = await bootUi({ storage: ui.storage, stored: ui.disk(), time: ui.time });
  later.field('backup-banner').hidden = true; later.App.refreshBackupStatus();
  assert.equal(later.field('header-backup').textContent, '7d / 0 changes');
  assert.equal(later.field('header-backup-pill').classList.contains('is-amber'), true);
  assert.equal(later.field('backup-banner').hidden, false);
});

test('wiring: the banner shows at most once per calendar day, and persist() refusal or absence is harmless', async () => {
  const data = require('./helpers/money-fixture.cjs').rawFixture();
  const ui = await bootUi({ data, navigator: {} });
  const banner = ui.field('backup-banner'); banner.hidden = true;
  await ui.save(10 - ui.App.repository.revision);
  assert.equal(banner.hidden, false); assert.equal(ui.App.backupStatus.readSnooze().shownOn, '2026-03-10');
  // Same day, fresh page load: pill still amber, banner stays away.
  const sameDay = await bootUi({ storage: ui.storage, stored: ui.disk(), time: ui.time, navigator: { storage: { persist: async () => false } } });
  sameDay.field('backup-banner').hidden = true; sameDay.App.refreshBackupStatus(); await sameDay.save(1);
  assert.equal(sameDay.field('backup-banner').hidden, true);
  assert.equal(sameDay.field('header-backup-pill').classList.contains('is-amber'), true);
  await sameDay.waitFor(() => /has not marked the tracker's storage as persistent/.test(sameDay.field('header-backup-pill').title), 'the persist() refusal to reach the tooltip');
  // Next calendar day: once more.
  ui.clock.now += DAY;
  const nextDay = await bootUi({ storage: ui.storage, stored: sameDay.disk(), time: ui.time });
  nextDay.field('backup-banner').hidden = true; nextDay.App.refreshBackupStatus();
  assert.equal(nextDay.field('backup-banner').hidden, false);
});

test('static: pill markup, script order, production file name, no File System Access API, gitignore', () => {
  const html = readSource('index.html'), ui = readSource('js/ui.js'), status = readSource('js/backup-status.js');
  assert.match(html, /<button type="button" class="stat-pill stat-pill-backup"[^>]*data-action="backup-data"[^>]*id="header-backup-pill"[^>]*hidden>/);
  assert.ok(html.includes('id="header-backup"'));
  const order = ['js/app-core.js', 'js/backup-status.js', 'js/ui.js'].map(src => html.indexOf('<script src="' + src + '"'));
  assert.ok(order[0] > 0 && order[0] < order[1] && order[1] < order[2], 'backup-status.js must load after app-core and before ui');
  assert.ok(ui.includes('App.backupStatus.backupFilename(now, revision, production())'));
  assert.ok(ui.indexOf('downloadFile(json, App.backupStatus.backupFilename') < ui.indexOf('App.backupStatus.recordBackup(revision, now);'), 'bookkeeping is recorded only after the download call');
  assert.ok(!ui.includes("'tutor-tracker-private-recovery.json'"));
  for (const source of [ui, status]) assert.doesNotMatch(source, /showSaveFilePicker|showDirectoryPicker|FileSystem(File|Directory)Handle/);
  assert.doesNotMatch(status, /fetch\(|XMLHttpRequest|sendBeacon|indexedDB|App\.repository/, 'bookkeeping module must not touch records or the network');
  assert.ok(readSource('styles.css').includes('.stat-pill[hidden] { display: none; }'));
  const ignore = require('node:fs').readFileSync(require('node:path').join(__dirname, '../.gitignore'), 'utf8');
  assert.ok(ignore.split(/\r?\n/).includes('*recovery*.json'), 'dated recovery files must never be committable to the public repo');
});
