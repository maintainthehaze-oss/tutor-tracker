const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../protected');
const vendor=path.join(root,'vendor/reporting');
const manifest=JSON.parse(fs.readFileSync(path.join(vendor,'manifest.json'),'utf8'));
test('reporting distributions and licenses match recorded package hashes',()=>{
  assert.equal(manifest.packages.length,3);
  for(const pkg of manifest.packages){
    assert(pkg.metadataUrl.startsWith('https://registry.npmjs.org/'));
    assert(pkg.tarballIntegrity.startsWith('sha512-'));
    assert.equal(pkg.files.length,2);
    for(const entry of pkg.files){
      const bytes=fs.readFileSync(path.join(vendor,entry.file));
      assert.equal(bytes.length,entry.bytes);
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),entry.sha256);
    }
  }
});
test('reporting libraries load locally in dependency order before application code',()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const scripts=[...html.matchAll(/<script\b([^>]*)src="([^"]+)"([^>]*)>/g)];
  const sequence=manifest.packages.map(pkg=>'vendor/reporting/'+pkg.files.find(f=>f.file.endsWith('.js')).file);
  let previous=-1;
  for(const src of [...sequence,'js/app-core.js','js/report-model.js','js/reports.js']){
    const index=scripts.findIndex(m=>m[2]===src);
    assert(index>previous,src);assert(/\bdefer\b/.test(scripts[index][1]+scripts[index][3]),src);previous=index;
  }
  assert(!scripts.some(m=>/^https?:/.test(m[2])));
});
