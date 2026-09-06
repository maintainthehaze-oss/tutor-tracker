(function () {
  'use strict';
  const key = id => {
    if ((typeof id !== 'string' && typeof id !== 'number') || id === '' ||
        (typeof id === 'number' && !Number.isFinite(id))) throw new Error('Invalid record identity');
    return String(id);
  };
  function isProtectedRecord(id, archiveManifest, finalizedRegistry) {
    const k = key(id);
    return Object.hasOwn(archiveManifest || {}, k) || Object.hasOwn(finalizedRegistry || {}, k);
  }
  window.App.recordPolicy = Object.freeze({ key, isProtectedRecord });
})();
