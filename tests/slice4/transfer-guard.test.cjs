const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../../protected');
const ui=fs.readFileSync(path.join(root,'js/ui.js'),'utf8'),sync=fs.readFileSync(path.join(root,'js/sync.js'),'utf8');
function check(ui,sync){
  const errors=[];
  for(const name of ['exportPortable','stagePortable','commitPortable'])if(!ui.includes('App.repository.'+name+'('))errors.push(name);
  if(!sync.includes('repository.commitPortable(')||!sync.includes('repository.assertPortableStage('))errors.push('sync boundary');
  if(/indexedDBAdapter|\b(localStorage|sessionStorage|indexedDB)\b|\bfetch\s*\(/.test(sync))errors.push('sync bypass/network');
  if(/indexedDBAdapter|\.compareAndSwap\s*\(/.test(ui))errors.push('UI bypass');
  return errors;
}
test('portable UI and sync use staged repository boundary',()=>assert.deepEqual(check(ui,sync),[]));
test('injected restore/remote writer bypasses fail transfer guard',()=>{
  assert(check(ui.replace('App.repository.stagePortable(', 'other.stagePortable('),sync).length);
  assert(check(ui+'\nApp.Repository.indexedDBAdapter().compareAndSwap(null,{});',sync).length);
  assert(check(ui,sync+'\nfetch("https://example.test",{method:"POST"});').length);
});
// Owner ruling 2026-09-10: desktop browser only, no offline cache. protected/sw.js is a self-destruct
// kill switch and nothing may register a worker again. (Replaces the 2026-09-06 offline-cache test.)
test('no service worker: sw.js only tears itself down and no page script registers one',()=>{
  const source=fs.readFileSync(path.join(root,'sw.js'),'utf8'),events=[];
  vm.runInNewContext(source,{self:{addEventListener:name=>events.push(name),skipWaiting(){}}});
  assert.deepEqual(events.sort(),['activate','install']);
  assert.doesNotMatch(source,/caches\.open|\.addAll\(|\.put\(|respondWith|importScripts/);
  for(const needle of ['caches.delete','registration.unregister'])assert(source.includes(needle),needle);
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.doesNotMatch(html,/rel="manifest"|serviceWorker/);
  assert.equal(fs.existsSync(path.join(root,'manifest.json')),false);
  const scripts=[...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m=>m[1].split('?')[0]).filter(src=>!src.startsWith('vendor/'));
  assert(scripts.includes('js/upgrade-shim.js'));
  for(const src of scripts)assert.doesNotMatch(fs.readFileSync(path.join(root,src),'utf8'),/serviceWorker\s*\.\s*register|\.register\s*\(/,src);
});
