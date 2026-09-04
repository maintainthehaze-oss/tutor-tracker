/* ========================================
   Service Worker — Tutoring Tracker Pro
   Cache-first with network fallback
   ======================================== */

const CACHE_NAME = 'tutor-tracker-v38';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './js/sw-register.js',
  './js/app-core.js',
  './js/sync.js',
  './js/dashboard.js',
  './js/historical.js',
  './js/clients.js',
  './js/sessions.js',
  './js/expenses.js',
  './js/ocr.js',
  './js/reports.js',
  './js/ui.js',
  // OCR engine (vendor/tesseract/*, ~11MB) is intentionally NOT precached —
  // the runtime fetch handler caches it after first use.
  './manifest.json',
  './icon.svg'
];

// External CDN assets to cache
const CDN_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf-autotable@5.0.8/dist/jspdf.plugin.autotable.min.js'
];

// API domains to skip caching
const API_DOMAINS = [
  'api.github.com',
  'api.openrouteservice.org',
  'fonts.gstatic.com'
];

// Install: cache core assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
  );
});

// Let the page decide when to activate a waiting worker (see sw-register.js)
// instead of hot-swapping caches under open tabs.
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch: cache-first for app assets, network-only for APIs
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip caching for API calls
  if (API_DOMAINS.some(domain => url.hostname.includes(domain))) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) return cached;

        return fetch(event.request)
          .then(response => {
            // Only cache successful responses from same origin or CDN
            if (response.ok && (url.origin === self.location.origin || CDN_ASSETS.some(a => event.request.url.startsWith(a)))) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
            }
            return response;
          })
          .catch(() => {
            // Offline fallback: return index.html for navigation requests
            if (event.request.destination === 'document') {
              return caches.match('./index.html');
            }
            return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
          });
      })
  );
});
