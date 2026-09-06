/* Loaded before App: only the protected production entry registers automatically. */
(function () {
  'use strict';
  const revision = 'protected-2026-09-06-v1';
  const origin = 'https://maintainthehaze-oss.github.io';
  const scope = origin + '/tutor-tracker/protected/';
  const production = location.origin === origin &&
    (location.pathname === '/tutor-tracker/' || location.pathname.startsWith('/tutor-tracker/'));
  const protectedPage = production && location.href.startsWith(scope);
  const bootController = navigator.serviceWorker?.controller;
  let registration;
  let failure;
  const installed = protectedPage && 'serviceWorker' in navigator
    ? navigator.serviceWorker.register(scope + 'sw.js', {scope, updateViaCache:'none'})
      .then(value => { registration = value; return value; })
      .catch(error => { failure = error; return null; })
    : Promise.resolve(null);
  function ask(worker, type, expectedRevision = revision) {
    return new Promise((resolve, reject) => {
      if (!worker) { reject(Error('The protected offline worker is not ready. Reload when installation finishes.')); return; }
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); reject(Error('The protected worker did not answer. Reload and retry.')); }, 10000);
      channel.port1.onmessage = event => {
        clearTimeout(timer); channel.port1.close();
        if (!event.data?.ok || event.data.revision !== expectedRevision || event.data.scope !== scope || !event.data.soleClient) {
          reject(Error(event.data?.error || 'Protected worker verification failed.')); return;
        }
        resolve(event.data);
      };
      worker.postMessage({type, revision:expectedRevision}, [channel.port2]);
    });
  }
  async function ready() {
    if (!protectedPage) throw Error('Open the protected upgrade page before activating records.');
    await installed;
    if (failure) throw failure;
    const controller = navigator.serviceWorker.controller;
    if (!controller || controller.scriptURL !== scope + 'sw.js') {
      throw Error('The protected worker is installing. Reload this page before activating records.');
    }
    if (bootController !== controller) {
      location.reload();
      throw Error('Reloading under protected code before activation.');
    }
    if (registration?.waiting || registration?.installing) throw Error('An update is pending. Finish the protected update before activating records.');
    return ask(controller, 'VERIFY_PROTECTED');
  }
  async function activateUpdate(expectedRevision = revision) {
    await installed;
    if (!registration?.waiting) throw Error('There is no waiting protected update.');
    // The next document must execute entirely under the new controller.
    const reload = () => location.reload();
    navigator.serviceWorker.addEventListener('controllerchange', reload, {once:true});
    try { await ask(registration.waiting, 'ACTIVATE_PROTECTED', expectedRevision); }
    catch (error) { navigator.serviceWorker.removeEventListener('controllerchange', reload); throw error; }
  }
  // UI calls this only after comparing the reopened private recovery file byte for byte.
  async function retireLegacyRoot() {
    await ready();
    const root = origin + '/tutor-tracker/';
    const rootRevision = 'root-retirement-2026-09-06-v1';
    const reg = await navigator.serviceWorker.register(root + 'sw.js', {scope:root, updateViaCache:'none'});
    if (reg.installing) await new Promise((resolve, reject) => {
      const worker = reg.installing;
      const timer = setTimeout(() => reject(Error('Root worker installation timed out.')), 30000);
      function changed() {
        if (['installed','activated','redundant'].includes(worker.state)) {
          clearTimeout(timer); worker.removeEventListener('statechange', changed);
          worker.state === 'redundant' ? reject(Error('Root worker installation failed.')) : resolve();
        }
      }
      worker.addEventListener('statechange', changed); changed();
    });
    const worker = reg.waiting || reg.active;
    if (!worker) throw Error('The root retirement worker is unavailable.');
    function verify(type) {
      return new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        const timer = setTimeout(() => { channel.port1.close(); reject(Error('Root retirement worker did not answer.')); }, 10000);
        channel.port1.onmessage = event => {
          clearTimeout(timer); channel.port1.close();
          const data = event.data;
          if (!data?.ok || data.revision !== rootRevision || data.scope !== root || !data.soleClient) {
            reject(Error(data?.error || 'Root retirement verification failed.')); return;
          }
          resolve(data);
        };
        worker.postMessage({type, revision:rootRevision, backupVerified:true}, [channel.port2]);
      });
    }
    await verify('RETIRE_LEGACY');
    if (worker.state !== 'activated') await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Root retirement activation timed out.')), 30000);
      function changed() {
        if (['activated','redundant'].includes(worker.state)) {
          clearTimeout(timer); worker.removeEventListener('statechange', changed);
          worker.state === 'activated' ? resolve() : reject(Error('Root retirement failed.'));
        }
      }
      worker.addEventListener('statechange', changed); changed();
    });
    const current = await navigator.serviceWorker.getRegistration(root);
    if (current?.active !== worker) throw Error('Root retirement worker changed during verification.');
    await ready();
    return verify('VERIFY_ROOT_RETIREMENT');
  }
  window.TrackerUpgrade = Object.freeze({production, revision, ready, assertReady:ready, activateUpdate, retireLegacyRoot});
})();
