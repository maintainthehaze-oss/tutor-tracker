/* KILL SWITCH — root worker retired 2026-09-10 (owner ruling: no offline caching anywhere).
   Browsers still holding the old root worker (v41 cache or the retirement worker) fetch
   this on their next root visit. It activates immediately, deletes every cache, unregisters,
   and reloads open tabs; the plain-JS redirect in index.html then sends them to protected/. */
'use strict';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => caches.delete(key)));
    await self.registration.unregister();
    const tabs = await self.clients.matchAll({type:'window', includeUncontrolled:true});
    tabs.forEach(tab => tab.navigate(tab.url).catch(() => {}));
  })());
});
