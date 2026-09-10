/* Protected staging worker. Root rollout requires a separate recovery gate. */
'use strict';
const PRODUCTION = self.location.origin === 'https://maintainthehaze-oss.github.io' &&
  self.location.pathname === '/tutor-tracker/protected/sw.js' &&
  self.registration.scope === 'https://maintainthehaze-oss.github.io/tutor-tracker/protected/';
const REVISION = 'protected-2026-09-10-v3';
if (!PRODUCTION && !['localhost','127.0.0.1','[::1]'].includes(self.location.hostname)) {
  throw Error('This worker is for localhost rehearsal only; deployment is disabled.');
}
const CACHE_NAME = PRODUCTION ? 'tutor-protected-' + REVISION : 'tutor-slice4-rehearsal-v2';
const ASSETS = [
  './', './index.html', './styles.css', './manifest.json', './icon.svg',
  './js/sw-register.js', './js/app-core.js', './js/record-policy.js',
  './js/repository.js', './js/report-model.js', './js/sync.js',
  './js/dashboard.js', './js/historical.js', './js/clients.js',
  './js/sessions.js', './js/expenses.js', './js/ocr.js', './js/reports.js', './js/ui.js',
  './vendor/reporting/chart.umd-4.4.7.js',
  './vendor/reporting/jspdf.umd-4.2.1.min.js',
  './vendor/reporting/jspdf.plugin.autotable-5.0.8.min.js',
  './fixtures/synthetic.json', './baseline/app-core.js.txt', './baseline/reports.js.txt',
  './baseline/historical.js.txt', './baseline/ui.js.txt'
];
if (PRODUCTION) ASSETS.push(
  './vendor/pdfjs/pdf.min.js', './vendor/pdfjs/pdf.worker.min.js',
  './vendor/tesseract/tesseract.min.js', './vendor/tesseract/worker.min.js',
  './vendor/tesseract/tesseract-core-lstm.wasm.js',
  './vendor/tesseract/tesseract-core-simd-lstm.wasm.js',
  './vendor/tesseract/eng.traineddata.gz'
);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
});
// Only the explicit rehearsal tool/test asks to activate a waiting update.
self.addEventListener('message', event => {
  if (!PRODUCTION && event.data?.type === 'ACTIVATE_REHEARSAL') self.skipWaiting();
  if (!PRODUCTION || !['VERIFY_PROTECTED', 'ACTIVATE_PROTECTED'].includes(event.data?.type)) return;
  event.waitUntil((async () => {
    const reply = value => event.ports[0]?.postMessage(value);
    const source = event.source;
    const windows = await self.clients.matchAll({type:'window', includeUncontrolled:true});
    const own = windows.filter(client => new URL(client.url).origin === self.location.origin);
    if (!source || !source.url.startsWith(self.registration.scope) || event.data.revision !== REVISION) {
      reply({ok:false, error:'The page and protected worker revisions do not match.'}); return;
    }
    if (own.length !== 1 || own[0].id !== source.id) {
      reply({ok:false, error:'Close all other tabs on this site before upgrading.'}); return;
    }
    reply({ok:true, revision:REVISION, scope:self.registration.scope, soleClient:true});
    if (event.data.type === 'ACTIVATE_PROTECTED') await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => !PRODUCTION && key.startsWith('tutor-slice4-rehearsal-') && key !== CACHE_NAME)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  const supported = ASSETS.some(asset => new URL(asset, self.registration.scope).pathname === url.pathname);
  if (!supported) return;
  event.respondWith(caches.open(CACHE_NAME).then(cache => cache.match(event.request, {ignoreSearch:true}))
    .then(cached => cached || fetch(event.request)));
});
