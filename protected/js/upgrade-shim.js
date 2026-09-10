/* Loaded before App. Offline caching and the install-as-app behaviour were removed
   2026-09-10 (owner ruling: desktop browser only). This file:
   1. Unregisters any protected-scope service worker still installed in this browser
      and deletes its caches, so every load is served fresh from GitHub Pages.
   2. Keeps window.TrackerUpgrade so the device-upgrade / private-restore code paths
      in ui.js still resolve. Root retirement already shipped (c3f8640) and the root
      redirect is plain JS (protected-redirect.js), so retireLegacyRoot is a no-op. */
(function () {
  'use strict';
  const revision = 'no-offline-2026-09-10';
  const origin = 'https://maintainthehaze-oss.github.io';
  const scope = origin + '/tutor-tracker/protected/';
  const production = location.origin === origin && location.pathname.startsWith('/tutor-tracker/');

  async function removeOfflineWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs
        .filter(reg => reg.scope === scope || reg.scope.endsWith('/protected/'))
        .map(reg => reg.unregister()));
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k.startsWith('tutor-protected-') || k.startsWith('tutor-slice4-'))
          .map(k => caches.delete(k)));
      }
    } catch (e) { /* best effort; the kill-switch sw.js also cleans up */ }
  }
  const removed = removeOfflineWorker();

  async function ready() {
    if (!production) throw Error('Open the protected tracker on the live site before activating records.');
    await removed;
    return {ok:true, revision, scope, soleClient:true};
  }
  async function activateUpdate() { await removed; }
  async function retireLegacyRoot() { await ready(); return {ok:true, revision, scope, soleClient:true}; }
  window.TrackerUpgrade = Object.freeze({production, revision, ready, assertReady:ready, activateUpdate, retireLegacyRoot});
})();
