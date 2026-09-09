/* Root retirement worker: no record or cache mutation, including during activation. */
'use strict';
const ROOT = 'https://maintainthehaze-oss.github.io/tutor-tracker/';
const PROTECTED = ROOT + 'protected/';
const REVISION = 'root-retirement-2026-09-06-v1';
if (self.location.href !== ROOT + 'sw.js' || self.registration.scope !== ROOT) {
  throw Error('Root retirement worker is restricted to the production root.');
}
self.addEventListener('message', event => {
  if (!['RETIRE_LEGACY', 'VERIFY_ROOT_RETIREMENT'].includes(event.data?.type)) return;
  event.waitUntil((async () => {
    const reply = value => event.ports[0]?.postMessage(value);
    const windows = await self.clients.matchAll({type:'window', includeUncontrolled:true});
    const own = windows.filter(client => new URL(client.url).origin === self.location.origin);
    if (!event.source?.url.startsWith(PROTECTED) || event.data.revision !== REVISION ||
        event.data.backupVerified !== true || own.length !== 1 || own[0].id !== event.source.id) {
      reply({ok:false, error:'Root retirement requires verified recovery and one protected tab.'}); return;
    }
    reply({ok:true, revision:REVISION, scope:ROOT, soleClient:true});
    if (event.data.type === 'RETIRE_LEGACY') await self.skipWaiting();
  })());
});
// No clients.claim(): the protected worker continues to control its existing page.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.mode === 'navigate' && url.origin === self.location.origin &&
      ['/tutor-tracker/', '/tutor-tracker/index.html'].includes(url.pathname)) {
    event.respondWith(Promise.resolve(Response.redirect(PROTECTED, 302)));
  }
});
