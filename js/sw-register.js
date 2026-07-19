(function () {
  'use strict';

  if (!('serviceWorker' in navigator)) return;

  let reloaded = false;
  // On FIRST install clients.claim() fires controllerchange on the fresh
  // page; only reload when a controller already existed (a real update).
  const hadController = !!navigator.serviceWorker.controller;

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').then(function (registration) {
      registration.addEventListener('updatefound', function () {
        const installingWorker = registration.installing;
        if (!installingWorker) return;
        installingWorker.addEventListener('statechange', function () {
          if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // A new version installed while an old one is controlling this
            // page — tell it to activate, then reload once cleanly instead
            // of leaving the tab running a mixed old/new version.
            if (window.App && typeof window.App.showToast === 'function') {
              window.App.showToast('App updated — refreshing…', 'info');
            }
            if (registration.waiting) {
              registration.waiting.postMessage({ type: 'SKIP_WAITING' });
            }
          }
        });
      });

      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (reloaded || !hadController) return;
        reloaded = true;
        location.reload();
      });
    }).catch(function (err) {
      console.warn('Service worker registration failed:', err);
    });
  });
})();
