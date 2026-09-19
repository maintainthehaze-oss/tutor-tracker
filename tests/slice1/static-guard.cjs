'use strict';
// AST regression guard, not a JavaScript sandbox. Frozen views and repository
// validation remain the runtime boundary. No network or package installation.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function parser() {
  try { return require('acorn'); } catch (_) { /* use Node's bundled parser */ }
  const source = process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'];
  if (!source) throw Error('Acorn unavailable: static guard cannot run');
  const context = { exports: {}, module: { exports: {} } };
  context.module.exports = context.exports;
  vm.runInNewContext(source, context, { filename: 'node-bundled-acorn.js' });
  return context.exports;
}
const acorn = parser();
const STATE = 1, DATA = 2, COPY = 4, STORAGE = 8, APP = 16, OBJECT_WRITER = 32;
const protectedKeys = new Set(['clients', 'sessions', 'expenses', 'settings', 'receipts', 'taxPayments', 'historical', 'archive']);
const uiKeys = new Set(['activeTab', 'editMode', 'selectedSessions', 'confirmCallback', 'incomeChart', 'yoyChart', 'syncTimer', 'syncDebounceTimer']);
const mutators = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin', 'set', 'add', 'delete', 'clear']);
const storageWriters = new Set(['setItem', 'removeItem', 'clear', 'open', 'deleteDatabase', 'transaction', 'put', 'add', 'delete', 'createObjectStore', 'deleteObjectStore']);
// Per-device UI preferences (owner ruling 2026-09-10: split visibility; 2026-09-19: backup bookkeeping).
// They hold no client, session or money records. ONLY localStorage.setItem/removeItem whose key is one of
// these string literals (inline, or a `const` bound to the literal) is exempt; every record key such as
// 'tutoring-sessions' is still refused, and so is any key the guard cannot resolve statically.
const uiPreferenceKeys = new Set(['tutoring-show-split', 'tutoring-backup-meta', 'tutoring-backup-snooze']);
const key = n => n && (n.computed ? (n.property.type === 'Literal' ? String(n.property.value) : null) : n.property.name);
const children = n => Object.entries(n).filter(([k]) => !['loc', 'start', 'end'].includes(k)).flatMap(([,v]) => Array.isArray(v) ? v.filter(x => x && typeof x.type === 'string') : v && typeof v.type === 'string' ? [v] : []);

function analyzeSource(source, filename = 'injected.js') {
  let ast;
  try { ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script', locations: true }); }
  catch (e) { return [{ file: filename, line: e.loc?.line || 1, message: 'Parse failed: ' + e.message }]; }
  const scopes = new WeakMap(), owners = new WeakMap(), nodes = [], functionNodes = [], exports = new Map();
  const root = { parent: null, bindings: new Map(), fn: null };
  function names(p) {
    if (!p) return [];
    if (p.type === 'Identifier') return [p.name];
    if (p.type === 'RestElement') return names(p.argument);
    if (p.type === 'AssignmentPattern') return names(p.left);
    return children(p).flatMap(names);
  }
  function declare(p, scope, fn) {
    names(p).forEach(name => { if (!scope.bindings.has(name)) scope.bindings.set(name, { bits: 0, fn }); });
  }
  function collect(n, scope, owner) {
    if (n.type === 'FunctionDeclaration') declare(n.id, scope, n);
    if (/Function/.test(n.type) || n.type === 'ArrowFunctionExpression') {
      scope = { parent: scope, bindings: new Map(), fn: n }; owner = n;
      functionNodes.push(n); if (n.id) declare(n.id, scope, n);
      n.params.forEach(p => declare(p, scope));
    } else if (n.type === 'BlockStatement' || n.type === 'CatchClause') {
      scope = { parent: scope, bindings: new Map(), fn: scope.fn };
      if (n.param) declare(n.param, scope);
    }
    scopes.set(n, scope); owners.set(n, owner); nodes.push(n);
    if (n.type === 'VariableDeclaration') n.declarations.forEach(d => { d.constant = n.kind === 'const'; });
    if (n.type === 'VariableDeclarator') {
      declare(n.id, scope, /Function/.test(n.init?.type || '') ? n.init : undefined);
      if (n.constant && n.id.type === 'Identifier' && n.init?.type === 'Literal' && typeof n.init.value === 'string') scope.bindings.get(n.id.name).literal = n.init.value;
    }
    children(n).forEach(c => collect(c, scope, owner));
  }
  collect(ast, root, null);
  function binding(n) { for (let s = scopes.get(n); s; s = s.parent) if (s.bindings.has(n.name)) return s.bindings.get(n.name); return null; }
  function uiPreferenceWrite(call, method) {
    const c = call.callee, keyArg = call.arguments[0];
    if (!['setItem', 'removeItem'].includes(method) || c.computed || c.object.type !== 'Identifier' || c.object.name !== 'localStorage' || binding(c.object) || !keyArg) return false;
    const literal = keyArg.type === 'Literal' ? keyArg.value : keyArg.type === 'Identifier' ? binding(keyArg)?.literal : undefined;
    return typeof literal === 'string' && uiPreferenceKeys.has(literal);
  }
  const returns = new WeakMap();
  function functionFor(n) {
    if (!n) return null;
    if (/Function/.test(n.type) || n.type === 'ArrowFunctionExpression') return n;
    if (n.type === 'Identifier') return binding(n)?.fn;
    if (n.type === 'MemberExpression') return exports.get(key(n));
    return null;
  }
  function bits(n) {
    if (!n) return 0;
    if (n.type === 'Identifier') {
      if (n.name === 'App') return APP;
      if (['localStorage', 'sessionStorage', 'indexedDB'].includes(n.name)) return STORAGE;
      return binding(n)?.bits || 0;
    }
    if (n.type === 'ChainExpression' || n.type === 'AwaitExpression') return bits(n.expression || n.argument);
    if (n.type === 'MemberExpression') {
      const k = key(n), b = bits(n.object);
      if (['Object', 'Reflect'].includes(n.object.name) && ['assign', 'defineProperty', 'defineProperties', 'set', 'deleteProperty', 'setPrototypeOf'].includes(k)) return OBJECT_WRITER;
      if (['localStorage', 'sessionStorage', 'indexedDB'].includes(k)) return STORAGE;
      if (k === 'App' && ['window', 'globalThis'].includes(n.object.name)) return APP;
      if (b & APP) return k === 'state' ? STATE : 0;
      if (b & STATE) return uiKeys.has(k) ? 0 : DATA;
      if (b & STORAGE) return STORAGE;
      if (b & (DATA | COPY)) return DATA;
      return 0;
    }
    if (n.type === 'ConditionalExpression') return bits(n.consequent) | bits(n.alternate);
    if (n.type === 'LogicalExpression') return bits(n.left) | bits(n.right);
    if (n.type === 'AssignmentExpression') return bits(n.right);
    if (n.type === 'SequenceExpression') return bits(n.expressions.at(-1));
    if (n.type === 'ArrayExpression' || n.type === 'ObjectExpression') {
      return children(n).some(c => bits(c.type === 'SpreadElement' ? c.argument : c.type === 'Property' ? c.value : c)) ? COPY : 0;
    }
    if (n.type === 'CallExpression') {
      const f = functionFor(n.callee); if (f) return returns.get(f) || 0;
      if (n.callee.type !== 'MemberExpression') return 0;
      const k = key(n.callee), receiver = bits(n.callee.object);
      if (n.callee.object.type === 'MemberExpression' && key(n.callee.object) === 'repository' && k === 'read') return DATA;
      if (receiver & STORAGE) return STORAGE;
      if (receiver & (DATA | COPY)) {
        if (['find', 'at', 'pop', 'shift'].includes(k)) return DATA;
        if (['filter', 'slice', 'concat', 'toSorted', 'toReversed', 'toSpliced'].includes(k)) return COPY;
        if (k === 'map') return (returns.get(functionFor(n.arguments[0])) || 0) ? COPY : 0;
      }
      if (n.callee.object.name === 'Object' && ['values', 'entries'].includes(k) && bits(n.arguments[0])) return COPY;
      if (n.callee.object.name === 'Object' && k === 'assign') return bits(n.arguments[0]) || (n.arguments.slice(1).some(a => bits(a)) ? COPY : 0);
      return 0;
    }
    return 0;
  }
  let changed;
  function bind(p, value) {
    if (!p) return;
    if (p.type === 'Identifier') { const b = binding(p); if (b && (b.bits | value) !== b.bits) { b.bits |= value; changed = true; } return; }
    if (p.type === 'ObjectPattern') p.properties.forEach(prop => {
      const k = prop.key?.name || prop.key?.value;
      bind(prop.value || prop.argument, value & STATE ? (uiKeys.has(k) ? 0 : DATA) : value & (DATA | COPY) ? DATA : value);
    });
    else children(p).forEach(c => bind(c, value & COPY ? DATA : value));
  }
  // Monotone fixed point handles aliases, callbacks, local function arguments and returns.
  for (let pass = 0; pass < 100; pass++) {
    changed = false;
    for (const n of nodes) {
      if (n.type === 'VariableDeclarator') bind(n.id, bits(n.init));
      if (n.type === 'AssignmentExpression') {
        if (n.left.type === 'Identifier') bind(n.left, bits(n.right));
        if (n.left.type === 'MemberExpression' && bits(n.left.object) & APP && functionFor(n.right)) exports.set(key(n.left), functionFor(n.right));
      }
      if (n.type === 'ForOfStatement') {
        const p = n.left.type === 'VariableDeclaration' ? n.left.declarations[0].id : n.left;
        bind(p, bits(n.right) & (COPY | DATA) ? DATA : 0);
      }
      if (n.type === 'CallExpression') {
        const f = functionFor(n.callee);
        if (f) f.params.forEach((p,i) => bind(p, bits(n.arguments[i])));
        if (n.callee.type === 'MemberExpression' && bits(n.callee.object) & (DATA | COPY)) {
          const cb = functionFor(n.arguments[0]), k = key(n.callee);
          if (cb && ['forEach', 'map', 'filter', 'find', 'some', 'every', 'findIndex', 'sort', 'reduce'].includes(k)) {
            bind(cb.params[k === 'reduce' ? 1 : 0], DATA);
            if (k === 'sort') bind(cb.params[1], DATA);
          }
        }
      }
      if (n.type === 'ReturnStatement' && owners.get(n)) {
        const f = owners.get(n), b = (returns.get(f) || 0) | bits(n.argument);
        if (b !== (returns.get(f) || 0)) { returns.set(f,b); changed = true; }
      }
      if (n.type === 'ArrowFunctionExpression' && n.body.type !== 'BlockStatement') {
        const b = (returns.get(n) || 0) | bits(n.body);
        if (b !== (returns.get(n) || 0)) { returns.set(n,b); changed = true; }
      }
    }
    if (!changed) break;
    if (pass === 99) return [{file:filename,line:1,message:'Alias analysis did not converge'}];
  }
  const errors = [], add = (n,message) => errors.push({file:filename,line:n.loc.start.line,message});
  function target(n) {
    if (n.type === 'MemberExpression') {
      if (bits(n.object) & STORAGE) return 'storage';
      if (bits(n.object) & DATA) return 'record';
      if (bits(n.object) & STATE && !uiKeys.has(key(n))) return 'record';
      if (bits(n.object) & APP && key(n) === 'state') return 'state';
    }
    return null;
  }
  for (const n of nodes) {
    if (n.type === 'AssignmentExpression' || n.type === 'UpdateExpression' || (n.type === 'UnaryExpression' && n.operator === 'delete')) {
      const t = target(n.left || n.argument);
      const bootstrap = t === 'state' && path.basename(filename) === 'app-core.js' && n.type === 'AssignmentExpression' && n.right.type === 'ObjectExpression' && n.right.properties.every(p => !protectedKeys.has(p.key?.name) || p.kind === 'get');
      if (t && !bootstrap) add(n, 'Forbidden '+t+' mutation outside repository');
      if (n.type === 'AssignmentExpression' && ['ObjectPattern', 'ArrayPattern'].includes(n.left.type)) {
        const checkPattern = p => { if (target(p)) add(p, 'Destructuring mutation of protected view'); else children(p).forEach(checkPattern); };
        checkPattern(n.left);
      }
    }
    if (n.type !== 'CallExpression' && n.type !== 'NewExpression') continue;
    if (['eval', 'Function'].includes(n.callee.name)) add(n, 'Dynamic code is outside static guard coverage');
    const callee = n.callee;
    if (callee.type !== 'MemberExpression') {
      if (bits(callee) & STORAGE) add(n, 'Aliased storage call outside repository');
      if (bits(callee) & DATA) add(n, 'Aliased protected-record method call');
      if (bits(callee) & OBJECT_WRITER && bits(n.arguments[0]) & (DATA | STATE | STORAGE)) add(n, 'Aliased Object/Reflect mutation of protected view');
      continue;
    }
    const k = key(callee), b = bits(callee.object);
    if (((b & STORAGE && (storageWriters.has(k) || k === null)) || ['setItem', 'removeItem'].includes(k)) && !uiPreferenceWrite(n, k)) add(n, 'Storage writer outside repository');
    if (b & DATA && (mutators.has(k) || k === null)) add(n, 'Record mutation method outside repository');
    if (['Object', 'Reflect'].includes(callee.object.name) && ['assign', 'defineProperty', 'defineProperties', 'set', 'deleteProperty', 'setPrototypeOf'].includes(k) && bits(n.arguments[0]) & (DATA | STATE | STORAGE)) add(n, 'Object/Reflect mutation of protected view');
    // Array.prototype.push.call(alias, ...) and extracted mutation methods.
    if (['call', 'apply'].includes(k) && callee.object.type === 'MemberExpression' && mutators.has(key(callee.object)) && bits(n.arguments[0]) & DATA) add(n, 'Indirect record mutation method');
    if (['call', 'apply', 'bind'].includes(k) && callee.object.type === 'MemberExpression' && mutators.has(key(callee.object)) && bits(callee.object.object) & DATA) add(n, 'Bound or indirect protected-record mutation');
  }
  return errors;
}

function scanDirectory(directory = path.resolve(__dirname, '../../protected/js')) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'vendor' ? [] : scanDirectory(file);
    return entry.name.endsWith('.js') && entry.name !== 'repository.js' ? analyzeSource(fs.readFileSync(file, 'utf8'), file) : [];
  });
}
module.exports = { analyzeSource, scanDirectory };
if (require.main === module) {
  const errors = scanDirectory(process.argv[2]);
  errors.forEach(e => console.error(`${e.file}:${e.line}: ${e.message}`));
  if (errors.length) process.exitCode = 1;
  else console.log('PASS static AST writer guard');
}
