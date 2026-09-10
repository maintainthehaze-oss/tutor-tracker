/* KILL SWITCH — offline caching removed 2026-09-10 (owner ruling: desktop browser only).
   Browsers that still have the old protected worker will fetch this file on their
   next visit (updateViaCache was 'none'). It activates immediately, deletes every
   cache it owned, unregisters itself, and reloads open tabs so they run uncached. */
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
