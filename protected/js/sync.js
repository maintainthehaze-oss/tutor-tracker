/* Local-only staged reconciliation. No production network transport is installed. */
(function () {
  'use strict';
  const App = window.App;
  const label = 'Local sync rehearsal';
  const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const same = (a, b) => App.Repository.canonical(a) === App.Repository.canonical(b);
  const identity = () => crypto.randomUUID();
  function remoteResult(value, expectedId) {
    if (!value || typeof value.gistId !== 'string' || !value.gistId ||
        (expectedId && value.gistId !== expectedId) ||
        !['string', 'number'].includes(typeof value.version) || typeof value.portable !== 'string') {
      throw Error('Invalid rehearsal mirror response. Connection was not changed.');
    }
    return value;
  }
  function create({repository, transport, connection}) {
    const stages = new Map();
    let sequence = Promise.resolve();
    const serial = action => { const job = sequence.then(action); sequence = job.catch(() => {}); return job; };
    async function readConnection() {
      const value = await connection.read();
      if (value && (value.kind !== 'local-sync-rehearsal' ||
          (value.gistId != null && typeof value.gistId !== 'string') ||
          (value.pending && (typeof value.pending.key !== 'string' || typeof value.pending.portable !== 'string')))) {
        throw Error('Unrecognized local rehearsal connection.');
      }
      return value;
    }
    async function saveConnection(expected, next) {
      if (await connection.compareAndSwap(expected, next) === false) throw Error('Another tab changed the rehearsal connection. Stage again.');
    }
    async function stage(direction) {
      const config = await readConnection();
      const local = await repository.exportPortable();
      let remote = null, portable = local;
      if (config && config.gistId) {
        remote = remoteResult(await transport.read(config.gistId), config.gistId);
        await repository.inspectPortable(remote.portable);
        portable = await repository.reconcilePortable(local, remote.portable);
      } else if (direction === 'pull') {
        throw Error('No local rehearsal mirror exists yet. Stage a push first.');
      } else if (config && config.pending) {
        // Retry the saved payload and identity after a lost response.
        portable = config.pending.portable;
        await repository.inspectPortable(portable);
      }
      // Recovery only restores the saved mirror identity. Bind approval to today's
      // local state, without trying to merge yesterday's pending settings into it.
      const recovering = !!(config && !config.gistId && config.pending);
      const staged = await repository.stagePortable(recovering ? local : portable);
      const id = identity();
      const summary = {...staged.summary, label, direction,
        message: direction === 'pull' ? 'Merge compatible mirror records into this local preview. Existing records are retained.' :
          recovering ? 'Recover the saved first push using the same local mirror identity. Current local records are retained; reconciliation is a separate next step.' :
            remote ? 'Update the local rehearsal mirror only if its version is unchanged.' : 'Create a local rehearsal copy. Nothing is sent online.'};
      if (stages.size >= 20) stages.delete(stages.keys().next().value);
      stages.set(id, {direction, config: copy(config), local, remote: copy(remote), portable, repositoryStage: staged.id});
      return {id, summary};
    }
    async function commit(id) {
      const staged = stages.get(id);
      stages.delete(id);
      if (!staged) throw Error('Rehearsal stage expired or was already used. Stage again.');
      if (!same(await readConnection(), staged.config)) throw Error('Rehearsal connection changed. Stage again.');
      if (await repository.exportPortable() !== staged.local) throw Error('Local records changed after staging. Stage again.');
      await repository.assertPortableStage(staged.repositoryStage);
      if (staged.direction === 'pull') {
        const latest = remoteResult(await transport.read(staged.remote.gistId), staged.remote.gistId);
        if (latest.version !== staged.remote.version || latest.portable !== staged.remote.portable) {
          throw Error('Mirror changed after staging. Stage a new pull.');
        }
        // This records a mirror observation, not proof that local records were applied.
        // Persist it first so a connection quota/CAS failure cannot follow a local write.
        await saveConnection(staged.config, {kind: 'local-sync-rehearsal', gistId: latest.gistId, version: latest.version, pending: null});
        await repository.commitPortable(staged.repositoryStage);
        return true;
      }
      let config = staged.config, result;
      if (staged.remote) {
        const guard = await repository.portableStageGuard(staged.repositoryStage);
        result = remoteResult(await transport.compareAndSwap(staged.remote.gistId, staged.remote.version, staged.portable, guard), staged.remote.gistId);
      } else {
        if (!config || !config.pending) {
          const next = {kind: 'local-sync-rehearsal', gistId: null, version: null,
            pending: {key: identity(), portable: staged.portable}};
          // Persist identity and exact payload before creation can happen.
          await saveConnection(config, next);
          config = next;
        }
        const guard = await repository.portableStageGuard(staged.repositoryStage);
        result = remoteResult(await transport.create(config.pending.portable, config.pending.key, guard));
      }
      // Require readback before claiming success or recording the remote version.
      const readback = remoteResult(await transport.read(result.gistId), result.gistId);
      if (readback.version !== result.version || readback.portable !== staged.portable || result.portable !== staged.portable) {
        throw Error('Mirror readback did not match. Stage again to recover the saved request.');
      }
      await repository.inspectPortable(readback.portable);
      await saveConnection(config, {kind: 'local-sync-rehearsal', gistId: readback.gistId, version: readback.version, pending: null});
      // External transports cannot atomically couple their write to local storage.
      // Keep the observed identity, but never claim success for a superseded stage.
      try { await repository.assertPortableStage(staged.repositoryStage); }
      catch (error) { throw Error('Push outcome needs review: local records or maintenance changed during the mirror operation. The mirror identity was saved. Stage again. ' + error.message); }
      return true;
    }
    return Object.freeze({
      stagePush: () => serial(() => stage('push')),
      stagePull: () => serial(() => stage('pull')),
      commit: id => serial(() => commit(id)),
      async status() {
        const config = await readConnection();
        return {label, autoSync: false, gistId: config && config.gistId || null,
          version: config && config.version != null ? config.version : null, pendingCreate: !!(config && config.pending)};
      }
    });
  }
  function localTransport(adapter) {
    async function mutate(change, guard) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const previous = await adapter.read();
        const next = copy(previous) || {documents: {}, requests: {}};
        const result = change(next);
        try {
          if (await adapter.compareAndSwap(previous, next, guard) === false) continue;
          return copy(result);
        } catch (error) {
          if (same(previous, await adapter.read())) throw error;
        }
      }
      throw Error('Local mirror is busy in another tab. Stage again.');
    }
    return Object.freeze({
      async read(gistId) {
        const data = await adapter.read();
        const value = data && data.documents && data.documents[gistId];
        if (!value) throw Error('Local rehearsal mirror was not found.');
        return copy(value);
      },
      create(portable, key, guard) {
        return mutate(data => {
          if (Object.hasOwn(data.requests, key)) {
            const value = data.documents[data.requests[key]];
            if (value.portable !== portable) throw Error('Saved creation request payload changed.');
            return value;
          }
          const gistId = 'local-' + identity();
          data.requests[key] = gistId;
          return data.documents[gistId] = {gistId, version: 1, portable};
        }, guard);
      },
      compareAndSwap(gistId, version, portable, guard) {
        return mutate(data => {
          const value = data.documents[gistId];
          if (!value || value.version !== version) throw Error('Mirror version conflict. Stage again to reconcile both devices.');
          return data.documents[gistId] = {gistId, version: version + 1, portable};
        }, guard);
      }
    });
  }
  App.Sync = Object.freeze({create, localTransport});
  let rehearsal;
  function defaultRehearsal() {
    if (!rehearsal) rehearsal = create({repository: App.repository,
      connection: App.repository.slotAdapter('slice4-connection'),
      transport: localTransport(App.repository.slotAdapter('slice4-remote'))});
    return rehearsal;
  }
  App.syncRehearsal = Object.freeze(Object.fromEntries(['stagePush', 'stagePull', 'commit', 'status'].map(name =>
    [name, (...args) => defaultRehearsal()[name](...args)])));
  function unavailable() {
    if (App.showToast) App.showToast(App.Repository.productionMode?.() ? 'Cloud sync is off. Use a private device backup.' : 'Cloud sync is unavailable. Use the staged Local sync rehearsal.', 'warning');
    return Promise.resolve(false);
  }
  App.hasSyncConfig = () => false;
  App.getSyncConfig = () => ({token: '', gistId: ''});
  App.saveToGist = unavailable; App.loadFromGist = unavailable;
  App.startAutoSync = () => {}; App.scheduleSave = () => {};
  App.updateSyncUI = () => {const el = App.$ && App.$('sync-indicator'); if (el) el.textContent = App.Repository.productionMode?.() ? 'Cloud sync off · records stay on this device' : label + ' · manual only';};
})();
