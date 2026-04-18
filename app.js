
// ========== GIST SYNC ==========
const SYNC_DELAY=30000;
let syncTimer=null,isDirty=false,syncStatus='saved';

function getSyncConfig(){
return{gistId:localStorage.getItem('tutor-gist-id')||'',pat:localStorage.getItem('tutor-gist-pat')||''}}

function hasSyncConfig(){const{gistId,pat}=getSyncConfig();return gistId&&pat}

async function loadFromGist(){
const{gistId,pat}=getSyncConfig();if(!gistId||!pat)return false;
try{const r=await fetch('https://api.github.com/gists/'+gistId,{headers:{'Authorization':'token '+pat}});
if(!r.ok){console.error('Gist load failed:',r.status);return false}
const g=await r.json();const raw=g.files?.['tutoring-data.json']?.content;
if(!raw)return false;
const d=JSON.parse(raw);
clients=d.clients||[];sessions=d.sessions||[];expenses=d.expenses||[];
settings={...settings,...(d.settings||{})};HOME_ADDRESS=settings.businessAddress;
// Cache locally
cacheToLocal();
return true}catch(e){console.error('Gist load error:',e);return false}}

async function saveToGist(){
const{gistId,pat}=getSyncConfig();if(!gistId||!pat)return;
syncStatus='saving';updateSyncUI();
try{const body=JSON.stringify({clients,sessions,expenses,settings});
const r=await fetch('https://api.github.com/gists/'+gistId,{method:'PATCH',
headers:{'Authorization':'token '+pat,'Content-Type':'application/json'},
body:JSON.stringify({files:{'tutoring-data.json':{content:body}}})});
if(!r.ok){const err=await r.text();console.error('Gist save failed:',r.status,err);syncStatus='error';updateSyncUI();showToast('Sync failed: '+r.status,'error');return}
isDirty=false;syncStatus='saved';updateSyncUI()}
catch(e){console.error('Gist save error:',e);syncStatus='error';updateSyncUI();showToast('Sync error: '+e.message,'error')}}

function scheduleSave(){
isDirty=true;syncStatus='unsaved';updateSyncUI();
clearTimeout(syncTimer);
syncTimer=setTimeout(saveToGist,SYNC_DELAY);
// Also cache locally immediately
cacheToLocal()}

function cacheToLocal(){
try{localStorage.setItem('tutoring-clients',JSON.stringify(clients));
localStorage.setItem('tutoring-sessions',JSON.stringify(sessions));
localStorage.setItem('tutoring-expenses',JSON.stringify(expenses));
localStorage.setItem('tutoring-settings',JSON.stringify(settings))}catch(e){}}

function loadFromLocal(){
try{const g=k=>localStorage.getItem(k);
if(g('tutoring-clients'))clients=JSON.parse(g('tutoring-clients'));
if(g('tutoring-sessions'))sessions=JSON.parse(g('tutoring-sessions'));
if(g('tutoring-expenses'))expenses=JSON.parse(g('tutoring-expenses'));
if(g('tutoring-settings')){settings={...settings,...JSON.parse(g('tutoring-settings'))};HOME_ADDRESS=settings.businessAddress}
return clients.length>0||sessions.length>0}catch(e){return false}}

function updateSyncUI(){
const el=$('sync-status');if(!el)return;
const icons={saved:'✓ Saved',saving:'↻ Saving...',unsaved:'● Unsaved',error:'✕ Sync Error',offline:'◌ Offline'};
el.textContent=icons[syncStatus]||'';
el.className='sync-indicator sync-'+syncStatus}

// Sync on tab close
// Sync on tab close — trigger save if dirty
window.addEventListener('beforeunload',(e)=>{if(isDirty&&hasSyncConfig()){
// Can't use sendBeacon with auth headers — do a sync XHR instead
try{const{gistId,pat}=getSyncConfig();
const xhr=new XMLHttpRequest();xhr.open('PATCH','https://api.github.com/gists/'+gistId,false);
xhr.setRequestHeader('Authorization','token '+pat);
xhr.setRequestHeader('Content-Type','application/json');
xhr.send(JSON.stringify({files:{'tutoring-data.json':{content:JSON.stringify({clients,sessions,expenses,settings})}}}));}catch(e){}}});

const $=id=>document.getElementById(id);
function setCurrentMonthFilter(){const n=new Date(),f=new Date(n.getFullYear(),n.getMonth(),1),l=new Date(n.getFullYear(),n.getMonth()+1,0);sessionFilters.dateStart=f.toISOString().split('T')[0];sessionFilters.dateEnd=l.toISOString().split('T')[0];$('filter-date-start').value=sessionFilters.dateStart;$('filter-date-end').value=sessionFilters.dateEnd}
let clients=[],sessions=[],expenses=[],editingId=null,selectedSessions=[],editMode=false;
let sessionFilters={dateStart:null,dateEnd:null,client:null,payment:null,status:null};
let settings={googleMapsApiKey:'',businessAddress:'33 Bible Street, Cos Cob, CT 06807'};
const IRS_MILEAGE_RATE=0.725;
let HOME_ADDRESS="33 Bible Street, Cos Cob, CT 06807";
async function init(){
await loadData();
setCurrentMonthFilter();
renderClients();renderSessions();renderExpenses();renderReports();updateCounts();
$('session-date').valueAsDate=new Date();
$('expense-date').valueAsDate=new Date();
$('sessions-list-view').style.display='block';
setupKeyboardShortcuts();
document.addEventListener('click',e=>{if(!e.target.closest('.search-wrap'))$('search-results').classList.remove('active')});
checkAutoBackup();
autoCompletePastSessions();
// Migrate: ensure all clients with companySplit have splitHistory
clients.forEach(c=>{if(c.companySplit>0&&(!c.splitHistory||!c.splitHistory.length)){
c.splitHistory=[{rate:c.companySplit,date:'2026-01-01'}]}});
}
function autoCompletePastSessions(){const today=new Date().toISOString().split('T')[0];
let count=0;sessions.forEach(s=>{if(s.status==='scheduled'&&s.date<today){s.status='completed';count++}});
if(count>0){saveData();showToast(count+' past scheduled session'+(count>1?'s':'')+' auto-marked completed','info')}}
async function loadData(){
// Try Gist first, fall back to localStorage cache
if(hasSyncConfig()){
const ok=await loadFromGist();
if(ok){showToast('Data synced from cloud','success');return}
showToast('Cloud unavailable — using local cache','warning')}
loadFromLocal()}
function saveData(){
cacheToLocal();
updateCounts();
if(hasSyncConfig())scheduleSave()}
function saveAndRender(...tabs){
saveData();
const all=new Set(tabs);
if(all.has('clients'))renderClients();
if(all.has('sessions'))renderSessions();
if(all.has('expenses'))renderExpenses();
if(all.has('reports'))renderReports()}
function updateCounts(){$('client-count').textContent=clients.length;$('session-count').textContent=sessions.length;$('expense-count').textContent=expenses.length}
function showToast(msg,type='info'){const c=$('toast-container'),t=document.createElement('div');t.className='toast '+type;const i={success:'✅',error:'❌',warning:'⚠️',info:'ℹ️'};t.innerHTML=`<span>${i[type]||''}</span> ${msg}`;c.appendChild(t);setTimeout(()=>{t.style.opacity='0';setTimeout(()=>t.remove(),300)},3500)}
function setupKeyboardShortcuts(){document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();$('global-search').focus()}if((e.ctrlKey||e.metaKey)&&e.key==='n'&&!e.target.closest('.modal-overlay')){e.preventDefault();const a=document.querySelector('.tab-content.active')?.id;if(a==='clients-tab')openClientForm();else if(a==='sessions-tab')openSessionForm();else if(a==='expenses-tab')openExpenseForm()}if(e.key==='Escape'){document.querySelectorAll('.modal-overlay.active').forEach(m=>m.classList.remove('active'));$('search-results').classList.remove('active')}})}
function performGlobalSearch(q){const r=$('search-results');if(!q||q.length<2){r.classList.remove('active');return}const ql=q.toLowerCase();let res=[];
clients.forEach(c=>{if([c.name,c.address,c.school,c.parentName,c.subjects,c.notes].filter(Boolean).join(' ').toLowerCase().includes(ql))res.push({type:'client',name:c.name,det:`$${c.hourlyRate}/hr • ${c.address||''}`,act:()=>switchTab('clients')})});
sessions.forEach(s=>{const n=getClientNames(s);if([n,s.date,s.notes,s.status].filter(Boolean).join(' ').toLowerCase().includes(ql))res.push({type:'session',name:`${n} - ${formatDate(s.date)}`,det:`$${s.amount} • ${s.status||'completed'}`,act:()=>{switchTab('sessions');openSessionForm(s.id)}})});
expenses.forEach(e=>{if([e.description,e.category].filter(Boolean).join(' ').toLowerCase().includes(ql))res.push({type:'expense',name:e.description,det:`$${e.amount.toFixed(2)} • ${e.category}`,act:()=>switchTab('expenses')})});
if(!res.length)r.innerHTML='<div class="sr-item" style="color:var(--text-3);text-align:center">No results found</div>';
else{r.innerHTML=res.slice(0,12).map((x,i)=>`<div class="sr-item" onclick="window._searchActs[${i}]()"><span class="sr-type ${x.type}">${x.type}</span><strong style="color:var(--text-1)">${x.name}</strong><div style="font-size:11px;color:var(--text-3);margin-top:2px">${x.det}</div></div>`).join('');window._searchActs=res.slice(0,12).map(x=>x.act)}r.classList.add('active')}
function checkAutoBackup(){const l=localStorage.getItem('tutoring-last-backup'),n=Date.now();if(!l||(n-parseInt(l))>14*864e5){const b=document.createElement('div');b.className='backup-banner';b.innerHTML='<h4>🔔 Backup Reminder</h4><p>It\'s been 2+ weeks since your last backup.</p><div class="backup-banner-actions"><button onclick="performAutoBackup()" class="backup-btn backup-btn-yes">✅ Backup Now</button><button onclick="this.closest(\'div\').remove();localStorage.setItem(\'tutoring-last-backup\',Date.now().toString())" class="backup-btn backup-btn-no">✕ Dismiss</button></div>';document.body.appendChild(b);window._bkBanner=b}}
function performAutoBackup(){downloadJSON({version:'2.0',date:new Date().toISOString(),data:{clients,sessions,expenses,settings}},`tutoring-auto-backup-${new Date().toISOString().split('T')[0]}.json`);if(window._bkBanner){window._bkBanner.innerHTML='<h4>✅ Backup Complete!</h4><p>Check your Downloads folder.</p>';setTimeout(()=>window._bkBanner.remove(),2500)}showToast('Backup downloaded!','success')}
function switchTab(t){document.querySelectorAll('.tab-content').forEach(el=>el.classList.remove('active'));document.querySelectorAll('.tab-nav button').forEach(b=>b.classList.remove('active'));document.getElementById(t+'-tab').classList.add('active');document.querySelector(`[data-tab="${t}"]`).classList.add('active');if(t==='reports')renderReports();else if(t==='tax-summary')renderTaxSummary();else if(t==='sessions'){setCurrentMonthFilter();renderSessions()}}
function closeModal(id){document.getElementById(id).classList.remove('active');editingId=null}
function formatDate(ds){if(!ds)return'';const[y,m,d]=ds.split('-');return new Date(parseInt(y),parseInt(m)-1,parseInt(d)).toLocaleDateString('en-US',{weekday:'short',month:'numeric',day:'numeric',year:'numeric'})}
function getMonthYear(ds){if(!ds)return'';const[y,m]=ds.split('-');return new Date(parseInt(y),parseInt(m)-1,1).toLocaleDateString('en-US',{month:'short',year:'numeric'})}
function getClientNames(s){const ids=cids(s);const cls=ids.map(id=>clients.find(c=>c.id===id)).filter(c=>c);if(!cls.length)return'Unknown';if(cls.length===1)return cls[0].name;const lns=cls.map(c=>getLastName(c));if(lns.every(l=>l===lns[0]))return cls.map(c=>c.name.trim().split(' ')[0]).join(', ')+' '+lns[0];return cls.map(c=>c.name).join(', ')}
function cids(s){return s.clientIds||[s.clientId]}
function getLastName(c){const p=(typeof c==='string'?c:c.name).trim().split(' ');return p.length>1?p[p.length-1]:p[0]}

function getCompanySplit(s){const ids=cids(s);if(!ids.length)return 0;
const cl=clients.find(c=>c.id===ids[0]);if(!cl)return 0;
const rate=getSplitRate(cl,s.date);
return rate>0?s.amount*(rate/100):0}

function getSplitRate(client,date){
const hist=client.splitHistory;
if(!hist||!hist.length)return client.companySplit||0;
// Find the most recent entry on or before the session date
const applicable=hist.filter(h=>h.date<=date).sort((a,b)=>b.date.localeCompare(a.date));
return applicable.length>0?applicable[0].rate:(client.companySplit||0)}
async function recalculateAllMileage(){const dates=new Set(sessions.filter(s=>s.type==='in-person').map(s=>s.date));
showToast(`Recalculating mileage for ${dates.size} day(s)...`,'info');
for(const date of dates){await recalcDayMileage(date)}
saveAndRender('sessions','reports');showToast(`Recalculated mileage for ${dates.size} day(s)`,'success')}
function enforceDuration(inp){let v=parseFloat(inp.value);if(isNaN(v))return;v=Math.round(v*4)/4;if(v<0.25)v=0.25;if(v>8)v=8;inp.value=v}
function calculateSessionAmount(){const sel=Array.from($('session-client').selectedOptions).filter(o=>o.value);const dur=parseFloat($('session-duration').value)||0;if(sel.length>0&&dur>0){let maxRate=0,maxName='';sel.forEach(o=>{const c=clients.find(c=>c.id===parseInt(o.value));if(c?.hourlyRate>maxRate){maxRate=c.hourlyRate;maxName=c.name}});$('session-amount').value=(dur*maxRate).toFixed(2);$('amount-hint').innerHTML=sel.length>1?`Family: ${maxName}'s rate ($${maxRate}/hr)`:'Auto-calculated'}}
function markAmountCustom(){$('amount-hint').innerHTML='✏️ Custom amount'}
async function calculateMileage(){const date=$('session-date').value;const sel=Array.from($('session-client').selectedOptions).filter(o=>o.value);const type=$('session-type').value;if(type!=='in-person'||!sel.length||!date){$('session-mileage').value='0';return}const mi=$('session-mileage');mi.value='0';mi.placeholder='Calculating...';
try{const cls=sel.map(o=>clients.find(c=>c.id===parseInt(o.value))).filter(c=>c);if(!cls.length){mi.value='0.0';return}const missing=cls.filter(c=>!c.address?.trim());if(missing.length){showToast(`${missing.map(c=>c.name).join(', ')} missing address!`,'warning');mi.value='0.0';return}
const prior=sessions.filter(s=>s.date===date&&s.type==='in-person'&&s.id!==editingId).sort((a,b)=>a.id-b.id);
const prevAddrs=[];const seen=new Set();prior.forEach(s=>{cids(s).forEach(id=>{const c=clients.find(c=>c.id===id);if(c?.address&&!seen.has(c.address)){prevAddrs.push(c.address);seen.add(c.address)}})});
const myAddrs=[];cls.forEach(c=>{if(!seen.has(c.address)){myAddrs.push(c.address);seen.add(c.address)}});
const startPt=prevAddrs.length>0?prevAddrs[prevAddrs.length-1]:HOME_ADDRESS;
let leg=[];leg.push(startPt);myAddrs.forEach(a=>leg.push(a));
if(myAddrs.length===0&&prevAddrs.length>0){mi.value='0.0';mi.placeholder='Same address as prior session';return}
if(myAddrs.length===0){leg=[HOME_ADDRESS,cls[0].address]}
leg.push(HOME_ADDRESS);
let total=0;for(let i=0;i<leg.length-1;i++)total+=await estimateDistance(leg[i],leg[i+1]);mi.value=total.toFixed(1);mi.placeholder=''}catch(e){console.error(e);mi.value='0.0';mi.placeholder=''}}
async function estimateDistance(a1,a2){if(!settings.googleMapsApiKey)return fallbackDist(a1,a2);try{const c1=await geocode(a1),c2=await geocode(a2);if(c1&&c2){const d=await routeDist(c1,c2);if(d)return Math.round(d*10)/10}return fallbackDist(a1,a2)}catch(e){return fallbackDist(a1,a2)}}
async function geocode(addr){if(!settings.googleMapsApiKey)return null;try{const r=await fetch(`https://api.openrouteservice.org/geocode/search?api_key=${settings.googleMapsApiKey}&text=${encodeURIComponent(addr)}&size=1`);if(!r.ok)return null;const d=await r.json();if(d.features?.[0]){const c=d.features[0].geometry.coordinates;return{lon:c[0],lat:c[1]}}return null}catch(e){return null}}
async function routeDist(c1,c2){try{const r=await fetch(`https://api.openrouteservice.org/v2/directions/driving-car?api_key=${settings.googleMapsApiKey}&start=${c1.lon},${c1.lat}&end=${c2.lon},${c2.lat}`);if(!r.ok)return haversine(c1,c2);const d=await r.json();return d.features?.[0]?d.features[0].properties.segments[0].distance*0.000621371:haversine(c1,c2)}catch(e){return haversine(c1,c2)}}
function haversine(c1,c2){const R=3959,dL=(c2.lat-c1.lat)*Math.PI/180,dN=(c2.lon-c1.lon)*Math.PI/180,a=Math.sin(dL/2)**2+Math.cos(c1.lat*Math.PI/180)*Math.cos(c2.lat*Math.PI/180)*Math.sin(dN/2)**2;return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))*1.3}
function fallbackDist(a1,a2){const c1=a1.toLowerCase().split(',')[1]?.trim()||'',c2=a2.toLowerCase().split(',')[1]?.trim()||'';return(c1&&c2&&c1===c2)?3:8}
async function testDistanceCalculation(){if(!clients.length){alert('Add a client first.');return}alert('Testing...');const d=await estimateDistance(HOME_ADDRESS,clients[0].address);alert(`Distance to ${clients[0].name}: ${d} miles`)}
function toggleMileageField(){const t=$('session-type').value;const f=$('mileage-field');const i=$('session-mileage');if(t==='in-person'){f.style.display='block';i.readOnly=true;i.style.background='var(--bg-disabled)';if(!i.value||i.value==='')i.value='0';calculateMileage()}else{f.style.display='none';i.value='0'}}
function openClientForm(id=null){editingId=id;const t=$('client-modal-title');if(id){const c=clients.find(c=>c.id===id);t.textContent='Edit Client';$('client-name').value=c.name;$('client-address').value=c.address;$('client-age').value=c.age||'';$('client-school').value=c.school||'';$('client-rate').value=c.hourlyRate||'';$('client-split').value=c.companySplit||'';$('client-parent-name').value=c.parentName||'';$('client-parent-email').value=c.parentEmail||'';$('client-parent-phone').value=c.parentPhone||'';$('client-subjects').value=c.subjects||'';$('client-goals').value=c.goals||'';$('client-notes-field').value=c.notes||''}else{t.textContent='New Client';$('client-form').reset()}$('client-modal').classList.add('active')}
function saveClient(e){e.preventDefault();const d={id:editingId||Date.now(),name:$('client-name').value.trim(),address:$('client-address').value.trim(),age:$('client-age').value,school:$('client-school').value.trim(),hourlyRate:parseFloat($('client-rate').value),companySplit:parseFloat($('client-split').value)||0,parentName:$('client-parent-name').value.trim(),parentEmail:$('client-parent-email').value.trim(),parentPhone:$('client-parent-phone').value.trim(),subjects:$('client-subjects').value.trim(),goals:$('client-goals').value.trim(),notes:$('client-notes-field').value.trim(),lastContactDate:editingId?(clients.find(c=>c.id===editingId)?.lastContactDate||null):null};if(editingId){
const old=clients.find(c=>c.id===editingId);
const splitChanged=old&&old.companySplit!==d.companySplit;
clients[clients.findIndex(c=>c.id===editingId)]=d;
if(splitChanged){
const today=new Date().toISOString().split('T')[0];
const famMembers=clients.filter(c=>getLastName(c)===getLastName(d));
famMembers.forEach(m=>{
if(!m.splitHistory)m.splitHistory=[];
m.splitHistory.push({rate:d.companySplit,date:today});
m.companySplit=d.companySplit})}}
else{clients.push(d);if(d.companySplit>0){d.splitHistory=[{rate:d.companySplit,date:new Date().toISOString().split('T')[0]}]}}
saveAndRender('clients');closeModal('client-modal');showToast(editingId?'Client updated!':'Client added!','success')}
function deleteClient(id){if(!confirm('Delete this client and their sessions?'))return;clients=clients.filter(c=>c.id!==id);sessions=sessions.filter(s=>!cids(s).includes(id));saveAndRender('clients','sessions');showToast('Client deleted','info')}
function renderClients(){const el=$('clients-list');if(!clients.length){el.innerHTML='<div class="empty-state"><p style="font-size:48px">👥</p><p>No clients yet. Add your first client!</p></div>';return}
const families={};
clients.forEach(c=>{const ln=getLastName(c);if(!families[ln])families[ln]=[];families[ln].push(c)});
const now=new Date(),monthStart=new Date(now.getFullYear(),now.getMonth(),1).toISOString().split('T')[0],monthEnd=new Date(now.getFullYear(),now.getMonth()+1,0).toISOString().split('T')[0];
const sortedFamilies=Object.keys(families).sort((a,b)=>{
const aIds=families[a].map(m=>m.id);const bIds=families[b].map(m=>m.id);
const aCt=sessions.filter(s=>s.date>=monthStart&&s.date<=monthEnd&&cids(s).some(id=>aIds.includes(id))).length;
const bCt=sessions.filter(s=>s.date>=monthStart&&s.date<=monthEnd&&cids(s).some(id=>bIds.includes(id))).length;
return bCt-aCt});
el.innerHTML=sortedFamilies.map(famName=>{
const members=families[famName].sort((a,b)=>a.name.localeCompare(b.name));
const isSolo=members.length===1;
const displayName=isSolo?members[0].name:famName+' Family';
const allIds=members.map(m=>m.id);
const famSessions=sessions.filter(s=>cids(s).some(id=>allIds.includes(id)));
const famCompleted=famSessions.filter(s=>s.status==='completed');
const totalSessions=famCompleted.length;
const totalOwed=famSessions.filter(s=>(s.paymentStatus||'unpaid')!=='paid'&&(s.status==='completed'||s.status==='scheduled')).reduce((sum,s)=>sum+s.amount,0);
const maxRate=Math.max(...members.map(m=>m.hourlyRate||0));
const addr=members[0].address||'';
const parent=members[0].parentName||'';
const parentPhone=members[0].parentPhone||'';
const parentEmail=members[0].parentEmail||'';
const split=members[0].companySplit||0;
return`<div class="family-card" id="fam-${famName}">
<div class="family-header" ${!isSolo?`onclick="toggleFamily('${famName}')"`:''}> 
<div class="family-info">
<div class="family-title">${!isSolo?`<span class="family-arrow">▶</span>`:''}<h3>${displayName}</h3></div>
<div class="family-meta">
${!isSolo?`<span>${members.length} students</span>`:''}
<span><strong>$${maxRate.toFixed(2)}/hr</strong></span>
<span>${totalSessions} sessions</span>
${addr?`<span>📍 ${addr}</span>`:''}
${parent?`<span>👤 ${parent}${parentPhone?' • '+parentPhone:''}</span>`:''}
${split>0?`<span>Split: ${split}%${members[0].splitHistory&&members[0].splitHistory.length>1?' ('+members[0].splitHistory.map(h=>h.rate+'% from '+h.date.slice(5)).join(' → ')+')':''}</span>`:''}

${totalOwed>0?`<span style="color:var(--err);font-weight:700">Owed: $${totalOwed.toFixed(2)}</span>`:''}
</div>
</div>
<div class="family-actions" onclick="event.stopPropagation()">
<button onclick="openFamilySession('${famName}')" title="New Session">⚡</button>
${isSolo?`<button onclick="openClientForm(${members[0].id})" title="Edit">✏️</button><button onclick="deleteClient(${members[0].id})" title="Delete">🗑️</button>`:`<button onclick="openClientForm(null)" title="Add Student">+</button>`}
</div>
</div>
${!isSolo?`<div class="family-children">${members.map(m=>{
const mSessions=sessions.filter(s=>cids(s).includes(m.id)&&s.status==='completed').length;
return`<div class="child-row">
<div class="child-info">
<strong>${m.name.trim().split(' ')[0]}</strong>
${m.age?`<span>Age ${m.age}</span>`:''}
${m.school?`<span>${m.school}</span>`:''}
${m.subjects?`<span>${m.subjects}</span>`:''}
<span>${mSessions} sessions</span>
</div>
<div class="child-actions">
<button onclick="openClientForm(${m.id})" title="Edit">✏️</button>
<button onclick="deleteClient(${m.id})" title="Delete">🗑️</button>
</div>
</div>`}).join('')}</div>`:''}
</div>`}).join('')}
function toggleFamily(famName){document.getElementById('fam-'+famName).classList.toggle('expanded')}
function openFamilySession(famName){
const members=clients.filter(c=>getLastName(c)===famName);
if(!members.length)return;
openSessionForm();
setTimeout(()=>{const sel=$('session-client');
Array.from(sel.options).forEach(o=>{
o.selected=members.some(m=>m.id===parseInt(o.value))});
calculateSessionAmount();calculateMileage()},50)}
async function recalcDayMileage(date){const daySessions=sessions.filter(s=>s.date===date&&s.type==='in-person'&&s.status!=='cancelled'&&s.status!=='no-show').sort((a,b)=>a.id-b.id);
if(!daySessions.length)return;
const seen=new Set();const orderedStops=[];
daySessions.forEach(s=>{const addrs=[];cids(s).forEach(id=>{const cl=clients.find(c=>c.id===id);if(cl?.address?.trim()&&!seen.has(cl.address)){addrs.push(cl.address);seen.add(cl.address)}});orderedStops.push({session:s,addrs})});
let prevEnd=HOME_ADDRESS;
for(let i=0;i<orderedStops.length;i++){const{session:s,addrs}=orderedStops[i];
if(!addrs.length){s.mileage=0;continue}
const isLast=i===orderedStops.length-1;
const leg=[prevEnd,...addrs];if(isLast)leg.push(HOME_ADDRESS);
let legMi=0;for(let j=0;j<leg.length-1;j++){legMi+=await estimateDistance(leg[j],leg[j+1])}
s.mileage=parseFloat(legMi.toFixed(1));prevEnd=addrs[addrs.length-1]}
if(orderedStops.length===1&&orderedStops[0].addrs.length>0){const s=orderedStops[0].session;const leg=[HOME_ADDRESS,...orderedStops[0].addrs,HOME_ADDRESS];let legMi=0;for(let j=0;j<leg.length-1;j++){legMi+=await estimateDistance(leg[j],leg[j+1])}s.mileage=parseFloat(legMi.toFixed(1))}
saveData();renderSessions()}
function openSessionForm(id=null,preDate=null){if(!id&&!clients.length){alert('Add a client first.');return}editingId=id;const t=$('session-modal-title');const sel=$('session-client');const sortedCl=[...clients].sort((a,b)=>{
const aLast=sessions.filter(s=>cids(s).includes(a.id)).sort((x,y)=>y.id-x.id)[0];
const bLast=sessions.filter(s=>cids(s).includes(b.id)).sort((x,y)=>y.id-x.id)[0];
return(bLast?.id||0)-(aLast?.id||0)});
sel.innerHTML='<option value="">Select client</option>'+sortedCl.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
if(id){const s=sessions.find(s=>s.id===id);t.textContent='Edit Session';const sc=cids(s);Array.from(sel.options).forEach(o=>{o.selected=sc.includes(parseInt(o.value))});$('session-date').value=s.date;$('session-type').value=s.type;$('session-duration').value=s.duration;$('session-amount').value=s.amount;$('session-status').value=s.status||'completed';$('session-paid-checkbox').checked=(s.paymentStatus==='paid');$('session-mileage').value=s.mileage||'';$('session-notes').value=s.notes||'';toggleMileageField();if(s.type==='in-person'){$('session-mileage').readOnly=false;$('session-mileage').style.background='var(--bg-input)'}}
else{t.textContent='New Session';$('session-form').reset();$('session-date').value=preDate||new Date().toISOString().split('T')[0];$('session-type').value='in-person';$('session-status').value='completed';$('session-paid-checkbox').checked=false;
const lastSession=sessions.filter(s=>s.status==='completed').sort((a,b)=>b.id-a.id)[0];
if(lastSession){$('session-duration').value=lastSession.duration}else{$('session-duration').value='1'}
toggleMileageField()}$('session-modal').classList.add('active')}
function saveSession(e){e.preventDefault();const sc=Array.from($('session-client').selectedOptions).map(o=>parseInt(o.value));if(!sc.length){alert('Select a client.');return}
const d={id:editingId||Date.now(),clientId:sc.length===1?sc[0]:null,clientIds:sc,date:$('session-date').value,type:$('session-type').value,duration:parseFloat($('session-duration').value),amount:parseFloat($('session-amount').value),status:$('session-status').value,paymentStatus:$('session-paid-checkbox').checked?'paid':'unpaid',mileage:$('session-type').value==='in-person'?parseFloat($('session-mileage').value)||0:0,notes:$('session-notes').value.trim()};
if(d.status==='cancelled'||d.status==='no-show'){d.mileage=0}
if(editingId)sessions[sessions.findIndex(s=>s.id===editingId)]=d;else sessions.push(d);
if(d.type==='in-person')recalcDayMileage(d.date);
sc.forEach(id=>{const c=clients.find(c=>c.id===id);if(c)c.lastContactDate=d.date});
saveAndRender('sessions','reports','clients');closeModal('session-modal');showToast(editingId?'Session updated!':'Session logged!','success')}
function saveAndNew(){const form=$('session-form');if(!form.checkValidity()){form.reportValidity();return}
const fakeEvent={preventDefault:()=>{}};saveSession(fakeEvent);
setTimeout(()=>openSessionForm(null,$('session-date').value),100)}
function duplicateSession(id){const s=sessions.find(x=>x.id===id);if(!s)return;
const d={...s,id:Date.now(),date:new Date().toISOString().split('T')[0],paymentStatus:'unpaid',mileage:0};
sessions.push(d);
saveData();recalcDayMileage(d.date).then(()=>{renderSessions();renderClients()});showToast('Session duplicated to today','success')}
function deleteSession(id){if(!confirm('Delete this session?'))return;sessions=sessions.filter(s=>s.id!==id);saveAndRender('sessions','reports','clients');showToast('Session deleted','info')}
function renderToday(){const today=new Date().toISOString().split('T')[0];
$('today-date').textContent=new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
const todaySessions=sessions.filter(s=>s.date===today).sort((a,b)=>a.id-b.id);
const el=$('today-content');
if(!todaySessions.length){el.innerHTML='<p style="color:var(--text-4)">No sessions scheduled for today.</p>';return}
const totalAmt=todaySessions.filter(s=>s.status==='completed'||s.status==='scheduled').reduce((s,x)=>s+x.amount,0);
const totalMi=todaySessions.reduce((s,x)=>s+(x.mileage||0),0);
const totalHrs=todaySessions.reduce((s,x)=>s+x.duration,0);
el.innerHTML=`<div class="today-stats"><span><strong>${todaySessions.length}</strong> session${todaySessions.length>1?'s':''}</span><span><strong>${totalHrs}</strong>hrs</span><span><strong>$${totalAmt.toFixed(2)}</strong></span><span><strong>${totalMi.toFixed(1)}</strong> mi</span></div>`+
todaySessions.map(s=>{const n=getClientNames(s);const statusIcon=s.status==='completed'?'✅':s.status==='scheduled'?'🕐':s.status==='cancelled'?'❌':'⚠️';
return`<div class="today-row"><span>${statusIcon} <strong>${n}</strong> — ${s.duration}hr, $${s.amount.toFixed(2)}${s.type==='in-person'?' • '+s.mileage+'mi':''}</span><span class="payment-badge ${s.paymentStatus||'unpaid'}" style="font-size:10px">${(s.paymentStatus||'unpaid').charAt(0).toUpperCase()+(s.paymentStatus||'unpaid').slice(1)}</span></div>`}).join('')}
function renderSessions(){const tbody=document.querySelector('#sessions-table tbody');
const fSel=$('filter-client');if(fSel){const cv=fSel.value;const fam={};clients.forEach(c=>{const l=getLastName(c);const k=l+' Family';if(!fam[k])fam[k]=[];fam[k].push(c)});let opts='<option value="">All Clients</option>';Object.keys(fam).sort().forEach(f=>{const m=fam[f];if(m.length>1){opts+=`<optgroup label="${f}">`;m.forEach(c=>{opts+=`<option value="${c.id}" ${cv==c.id?'selected':''}>${c.name}</option>`});opts+='</optgroup>'}else opts+=`<option value="${m[0].id}" ${cv==m[0].id?'selected':''}>${m[0].name}</option>`});fSel.innerHTML=opts}
if(!sessions.length){tbody.innerHTML='<tr><td colspan="11" style="text-align:center;padding:40px"><div class="empty-state"><p style="font-size:48px">📅</p><p>No sessions yet.</p></div></td></tr>';$('bulk-actions-bar').style.display='none';return}
let f=[...sessions];if(sessionFilters.dateStart)f=f.filter(s=>s.date>=sessionFilters.dateStart);if(sessionFilters.dateEnd)f=f.filter(s=>s.date<=sessionFilters.dateEnd);if(sessionFilters.client)f=f.filter(s=>cids(s).includes(parseInt(sessionFilters.client)));if(sessionFilters.payment)f=f.filter(s=>s.paymentStatus===sessionFilters.payment);if(sessionFilters.status)f=f.filter(s=>(s.status||'completed')===sessionFilters.status);
const sorted=f.sort((a,b)=>new Date(b.date)-new Date(a.date));let tR=0,tS=0,tH=0,tM=0,unpaidDone=0,unpaidDoneCt=0,unpaidSched=0,unpaidSchedCt=0;sorted.forEach(s=>{if(s.status==='completed'){tR+=s.amount||0;tH+=s.duration||0;if(s.type==='in-person')tM+=s.mileage||0;tS+=getCompanySplit(s);if(s.paymentStatus!=='paid'){unpaidDone+=s.amount||0;unpaidDoneCt++}}if(s.status==='scheduled'&&s.paymentStatus!=='paid'){unpaidSched+=s.amount||0;unpaidSchedCt++}});
$('sm-count').textContent=sorted.length;$('sm-rev').textContent='$'+tR.toFixed(2);$('sm-split').textContent=tS>0?'-$'+tS.toFixed(2):'$0';$('sm-net').textContent='$'+(tR-tS).toFixed(2);$('sm-hrs').textContent=tH.toFixed(1);$('sm-mi').textContent=tM.toFixed(1);const unpaidDoneNet=unpaidDone-sorted.filter(s=>s.status==='completed'&&s.paymentStatus!=='paid').reduce((a,s)=>a+getCompanySplit(s),0);
$('sm-unpaid-done').textContent='$'+unpaidDoneNet.toFixed(2)+' (gross $'+unpaidDone.toFixed(2)+')';$('sm-unpaid-done-ct').textContent=unpaidDoneCt+' session'+(unpaidDoneCt!==1?'s':'');const unpaidSchedNet=unpaidSched-sorted.filter(s=>s.status==='scheduled'&&s.paymentStatus!=='paid').reduce((a,s)=>a+getCompanySplit(s),0);
$('sm-unpaid-sched').textContent='$'+unpaidSchedNet.toFixed(2)+' (gross $'+unpaidSched.toFixed(2)+')';$('sm-unpaid-sched-ct').textContent=unpaidSchedCt+' session'+(unpaidSchedCt!==1?'s':'');$('sm-unpaid-total').textContent='$'+(unpaidDoneNet+unpaidSchedNet).toFixed(2)+' (gross $'+(unpaidDone+unpaidSched).toFixed(2)+')';
tbody.innerHTML=sorted.map(s=>{const n=getClientNames(s);const multi=cids(s).length>1;const sp=getCompanySplit(s);const sel=selectedSessions.includes(s.id);
if(editMode)return`<tr style="background:${sel?'var(--bg-today)':'transparent'}"><td><input type="checkbox" class="session-checkbox" data-session-id="${s.id}" ${sel?'checked':''} onchange="toggleSessionSelection(${s.id})"></td><td><input type="date" value="${s.date}" onchange="updateSessionField(${s.id},'date',this.value)" class="edit-input edit-input-date"></td><td>${n}${multi?' <span class="fam-badge">FAM</span>':''}</td><td><select onchange="updateSessionField(${s.id},'type',this.value)" class="edit-select"><option value="in-person" ${s.type==='in-person'?'selected':''}>In-Person</option><option value="remote" ${s.type==='remote'?'selected':''}>Remote</option></select></td><td><input type="number" step="0.25" min="0.25" max="8" value="${s.duration}" onchange="enforceDuration(this);updateSessionField(${s.id},'duration',parseFloat(this.value))" class="edit-input edit-input-sm"></td><td><input type="number" step="0.01" value="${s.amount}" onchange="updateSessionField(${s.id},'amount',parseFloat(this.value))" class="edit-input edit-input-md"></td><td style="color:${sp>0?'var(--err)':'var(--text-3)'}">${sp>0?'-$'+sp.toFixed(2):'—'}</td><td><input type="checkbox" ${s.paymentStatus==='paid'?'checked':''} onchange="togglePaid(${s.id},this.checked)" class="paid-check"></td><td><select onchange="updateSessionField(${s.id},'status',this.value)" class="edit-select"><option value="completed" ${(s.status||'completed')==='completed'?'selected':''}>Completed</option><option value="scheduled" ${s.status==='scheduled'?'selected':''}>Scheduled</option><option value="cancelled" ${s.status==='cancelled'?'selected':''}>Cancelled</option><option value="no-show" ${s.status==='no-show'?'selected':''}>No-Show</option></select></td><td>${s.type==='in-person'&&s.status!=='cancelled'&&s.status!=='no-show'?s.mileage+' mi':'—'}</td><td><div class="action-buttons"><button onclick="duplicateSession(${s.id})" title="Duplicate to today">📋</button><button onclick="openSessionForm(${s.id})">✏️</button><button onclick="deleteSession(${s.id})">🗑️</button></div></td></tr>`;
const unpaidCls=(s.paymentStatus||'unpaid')!=='paid'&&s.status==='completed'?' row-unpaid':'';
return`<tr class="${unpaidCls}" style="background:${sel?'var(--bg-today)':''}"><td><input type="checkbox" class="session-checkbox" data-session-id="${s.id}" ${sel?'checked':''} onchange="toggleSessionSelection(${s.id})"></td><td>${formatDate(s.date)}</td><td>${n}${multi?' <span class="fam-badge">FAM</span>':''}</td><td><span class="type-badge ${s.type}">${s.type==='in-person'?'In-Person':'Remote'}</span></td><td>${s.duration}h</td><td>$${s.amount.toFixed(2)}</td><td style="color:${sp>0?'var(--err)':'var(--text-3)'}">${sp>0?'-$'+sp.toFixed(2):'—'}</td><td><span class="status-badge ${s.status||'completed'}">${(s.status||'completed').charAt(0).toUpperCase()+(s.status||'completed').slice(1)}</span></td><td><span class="payment-badge ${s.paymentStatus||'unpaid'}">${(s.paymentStatus||'unpaid').charAt(0).toUpperCase()+(s.paymentStatus||'unpaid').slice(1)}</span></td><td>${s.type==='in-person'&&s.status!=='cancelled'&&s.status!=='no-show'?s.mileage+' mi':'—'}</td><td><div class="action-buttons"><button onclick="duplicateSession(${s.id})" title="Duplicate to today">📋</button><button onclick="openSessionForm(${s.id})">✏️</button><button onclick="deleteSession(${s.id})">🗑️</button></div></td></tr>`}).join('');
updateBulkActionsBar();renderToday();}
function togglePaid(id,checked){const s=sessions.find(s=>s.id===id);if(!s)return;s.paymentStatus=checked?'paid':'unpaid';saveAndRender('sessions','clients','reports')}
function updateSessionField(id,field,val){const s=sessions.find(s=>s.id===id);if(!s)return;
const wasCancelled=s.status==='cancelled'||s.status==='no-show';
s[field]=val;
const isCancelled=s.status==='cancelled'||s.status==='no-show';
if(field==='status'&&isCancelled&&!wasCancelled&&s.mileage>0){
s.mileage=0;recalcDayMileage(s.date);showToast('Mileage zeroed & same-day legs recalculated','info')}
if(field==='status'&&wasCancelled&&!isCancelled){recalcDayMileage(s.date);showToast('Same-day mileage recalculated','info')}
saveAndRender('sessions','clients','reports')}
function applyFilters(){sessionFilters.dateStart=$('filter-date-start').value||null;sessionFilters.dateEnd=$('filter-date-end').value||null;sessionFilters.client=$('filter-client').value||null;sessionFilters.payment=$('filter-payment').value||null;sessionFilters.status=$('filter-status').value||null;renderSessions()}
function clearFilters(){sessionFilters={dateStart:null,dateEnd:null,client:null,payment:null,status:null};['filter-client','filter-payment','filter-status'].forEach(id=>document.getElementById(id).value='');setCurrentMonthFilter();renderSessions()}
function toggleEditMode(){editMode=$('edit-mode-toggle').checked;renderSessions()}
function toggleSessionSelection(id){const i=selectedSessions.indexOf(id);if(i>-1)selectedSessions.splice(i,1);else selectedSessions.push(id);updateBulkActionsBar();const cb=$('select-all-sessions');if(cb){cb.checked=selectedSessions.length===sessions.length&&sessions.length>0;cb.indeterminate=selectedSessions.length>0&&selectedSessions.length<sessions.length}}
function toggleSelectAll(){const cb=$('select-all-sessions');selectedSessions=cb.checked?sessions.map(s=>s.id):[];document.querySelectorAll('.session-checkbox').forEach(c=>c.checked=cb.checked);updateBulkActionsBar()}
function updateBulkActionsBar(){$('selected-count').textContent=selectedSessions.length;$('bulk-actions-bar').style.display=selectedSessions.length>0?'block':'none'}
function clearSelection(){selectedSessions=[];document.querySelectorAll('.session-checkbox').forEach(c=>c.checked=false);$('select-all-sessions').checked=false;updateBulkActionsBar()}
function bulkUpdatePaymentStatus(st){if(!selectedSessions.length)return;if(!confirm(`Mark ${selectedSessions.length} as ${st}?`))return;selectedSessions.forEach(id=>{const s=sessions.find(s=>s.id===id);if(s){s.paymentStatus=st;}});saveAndRender('sessions','clients');showToast(`${selectedSessions.length} sessions → ${st}`,'success');clearSelection()}
function openExpenseForm(id=null){editingId=id;if(id){const e=expenses.find(e=>e.id===id);$('expense-modal-title').textContent='Edit Expense';$('expense-date').value=e.date;$('expense-category').value=e.category;$('expense-description').value=e.description;$('expense-amount').value=e.amount;$('expense-receipt-url').value=e.receiptUrl||''}else{$('expense-modal-title').textContent='New Expense';$('expense-form').reset();$('expense-date').valueAsDate=new Date()}$('expense-modal').classList.add('active')}
function saveExpense(e){e.preventDefault();const d={id:editingId||Date.now(),date:$('expense-date').value,category:$('expense-category').value,description:$('expense-description').value,amount:parseFloat($('expense-amount').value),receiptUrl:$('expense-receipt-url').value.trim()||null};if(editingId)expenses[expenses.findIndex(e=>e.id===editingId)]=d;else expenses.push(d);saveAndRender('expenses','reports');closeModal('expense-modal');showToast(editingId?'Expense updated!':'Expense added!','success')}
function deleteExpense(id){if(!confirm('Delete this expense?'))return;expenses=expenses.filter(e=>e.id!==id);saveAndRender('expenses','reports');showToast('Expense deleted','info')}
function renderExpenses(){const tbody=document.querySelector('#expenses-table tbody');if(!expenses.length){tbody.innerHTML='<tr><td colspan="6" style="text-align:center;padding:40px"><div class="empty-state"><p style="font-size:48px">💰</p><p>No expenses yet.</p></div></td></tr>';return}
tbody.innerHTML=[...expenses].sort((a,b)=>new Date(b.date)-new Date(a.date)).map(e=>{let rcpt='—';if(e.receiptUrl)rcpt=`<a href="${e.receiptUrl}" target="_blank" style="color:var(--accent)">🔗 View</a>`;return`<tr><td>${formatDate(e.date)}</td><td><span class="category-badge">${e.category}</span></td><td>${e.description}</td><td>$${e.amount.toFixed(2)}</td><td>${rcpt}</td><td><div class="action-buttons"><button onclick="openExpenseForm(${e.id})">✏️</button><button onclick="deleteExpense(${e.id})">🗑️</button></div></td></tr>`}).join('')}
function renderReports(){const comp=sessions.filter(s=>s.status==='completed');const tInc=comp.reduce((s,x)=>s+x.amount,0);const tExp=expenses.reduce((s,e)=>s+e.amount,0);const tMi=comp.filter(s=>s.type==='in-person').reduce((s,x)=>s+(x.mileage||0),0);const miDed=tMi*IRS_MILEAGE_RATE;const tDed=miDed+tExp;const tHrs=comp.reduce((s,x)=>s+x.duration,0);const tSplit=comp.reduce((s,x)=>s+getCompanySplit(x),0);const out=sessions.filter(s=>s.paymentStatus==='unpaid'&&s.status==='completed').reduce((s,x)=>s+x.amount,0);
$('report-stats').innerHTML=`<div class="stats-grid"><div class="stat-card income"><div class="stat-icon">💵</div><div class="stat-content"><div class="stat-label">Total Income</div><div class="stat-value">$${tInc.toFixed(2)}</div><div class="stat-breakdown"><span>Split: $${tSplit.toFixed(2)}</span><span>Yours: $${(tInc-tSplit).toFixed(2)}</span></div></div></div><div class="stat-card deductions"><div class="stat-icon">📊</div><div class="stat-content"><div class="stat-label">Deductions</div><div class="stat-value">$${tDed.toFixed(2)}</div><div class="stat-breakdown"><span>Mileage: $${miDed.toFixed(2)}</span><span>Expenses: $${tExp.toFixed(2)}</span></div></div></div><div class="stat-card sessions"><div class="stat-icon">📅</div><div class="stat-content"><div class="stat-label">Sessions</div><div class="stat-value">${comp.length}</div><div class="stat-breakdown"><span>${tHrs.toFixed(1)} hours</span><span>${tMi.toFixed(1)} miles</span></div></div></div><div class="stat-card outstanding"><div class="stat-icon">⚠️</div><div class="stat-content"><div class="stat-label">Outstanding</div><div class="stat-value">$${out.toFixed(2)}</div></div></div></div>`;
const mo={};comp.forEach(s=>{const m=getMonthYear(s.date);if(!mo[m])mo[m]={c:0,i:0,mi:0,e:0,sp:0};mo[m].c++;mo[m].i+=s.amount;if(s.type==='in-person')mo[m].mi+=s.mileage||0;mo[m].sp+=getCompanySplit(s)});expenses.forEach(e=>{const m=getMonthYear(e.date);if(!mo[m])mo[m]={c:0,i:0,mi:0,e:0,sp:0};mo[m].e+=e.amount});
const sm=Object.entries(mo).sort((a,b)=>new Date(b[0])-new Date(a[0]));
$('monthly-breakdown').innerHTML=`<div style="margin-bottom:24px"><h3 style="font-size:18px;font-weight:700;color:var(--text-1);margin-bottom:14px">Monthly Breakdown</h3><div class="sessions-table"><table><thead><tr><th>Month</th><th>Sessions</th><th>Income</th><th>Split</th><th>Expenses</th><th>Mileage</th><th>Deductions</th><th>Net</th></tr></thead><tbody>${sm.map(([m,d])=>`<tr><td>${m}</td><td>${d.c}</td><td>$${d.i.toFixed(2)}</td><td style="color:var(--err)">${d.sp>0?'-$'+d.sp.toFixed(2):'—'}</td><td>$${d.e.toFixed(2)}</td><td>${d.mi.toFixed(1)} mi</td><td>$${((d.mi*IRS_MILEAGE_RATE)+d.e).toFixed(2)}</td><td><strong>$${(d.i-d.sp-((d.mi*IRS_MILEAGE_RATE)+d.e)).toFixed(2)}</strong></td></tr>`).join('')}</tbody></table></div></div>`}
function getTaxData(){const yr=new Date().getFullYear();const ys=sessions.filter(s=>new Date(s.date).getFullYear()===yr&&s.status==='completed');const ye=expenses.filter(e=>new Date(e.date).getFullYear()===yr);const gross=ys.reduce((s,x)=>s+x.amount,0);const tExp=ye.reduce((s,e)=>s+e.amount,0);const tMi=ys.filter(s=>s.type==='in-person').reduce((s,x)=>s+(x.mileage||0),0);const miDed=tMi*IRS_MILEAGE_RATE;const tDed=miDed+tExp;const split=ys.reduce((s,x)=>s+getCompanySplit(x),0);return{yr,ys,ye,gross,tExp,tMi,miDed,tDed,split,net:gross-split-tDed}}
function renderTaxSummary(){const{yr,ys,ye,gross,tExp,tMi,miDed,tDed,split,net}=getTaxData();
const byCat={};ye.forEach(e=>{byCat[e.category]=(byCat[e.category]||0)+e.amount});
const Q={Q1:0,Q2:0,Q3:0,Q4:0};ys.forEach(s=>{const m=new Date(s.date).getMonth();if(m<3)Q.Q1+=s.amount;else if(m<6)Q.Q2+=s.amount;else if(m<9)Q.Q3+=s.amount;else Q.Q4+=s.amount});
$('tax-summary-content').innerHTML=`
<div class="tax-section"><h3>Schedule C - Profit or Loss</h3><p style="margin-bottom:16px;color:var(--text-3)">Sole Proprietorship - ${yr}</p>
<div class="tax-line"><span>Gross Receipts</span><span>$${gross.toFixed(2)}</span></div>
<div class="tax-line" style="padding-left:18px"><span>Less: Company Split</span><span>($${split.toFixed(2)})</span></div>
<div class="tax-line total"><span>Your Gross Income</span><span>$${(gross-split).toFixed(2)}</span></div>
<h4 style="margin-top:28px;margin-bottom:14px;font-size:15px;font-weight:700;color:var(--text-1)">Business Expenses</h4>
${Object.entries(byCat).map(([c,a])=>`<div class="tax-line"><span>${c.charAt(0).toUpperCase()+c.slice(1)}</span><span>$${a.toFixed(2)}</span></div>`).join('')}
<div class="tax-line"><span>Car Expenses (${tMi.toFixed(0)} mi @ $${IRS_MILEAGE_RATE}/mi)</span><span>$${miDed.toFixed(2)}</span></div>
<div class="tax-line total"><span>Total Expenses</span><span>$${tDed.toFixed(2)}</span></div>
<div class="tax-line total" style="background:var(--bg-hover);margin-top:20px"><span><strong>Net Profit</strong></span><span><strong>$${net.toFixed(2)}</strong></span></div></div>
<div class="tax-section"><h3>Quarterly Income</h3><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:14px">${Object.entries(Q).map(([q,a])=>`<div style="text-align:center;padding:14px;background:var(--bg-hover);border-radius:10px"><div style="font-size:13px;color:var(--text-3)">${q}</div><div style="font-size:18px;font-weight:700;color:var(--text-1)">$${a.toFixed(2)}</div></div>`).join('')}</div></div>
<div class="tax-section"><h3>Key Information</h3><div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px"><div><p style="font-size:12px;color:var(--text-3)">Sessions</p><p style="font-size:18px;font-weight:700;color:var(--text-1)">${ys.length}</p></div><div><p style="font-size:12px;color:var(--text-3)">Hours</p><p style="font-size:18px;font-weight:700;color:var(--text-1)">${ys.reduce((s,x)=>s+x.duration,0).toFixed(1)}h</p></div><div><p style="font-size:12px;color:var(--text-3)">Miles</p><p style="font-size:18px;font-weight:700;color:var(--text-1)">${tMi.toFixed(0)}</p></div><div><p style="font-size:12px;color:var(--text-3)">Deduction %</p><p style="font-size:18px;font-weight:700;color:var(--text-1)">${gross>0?((tDed/gross)*100).toFixed(1):0}%</p></div><div><p style="font-size:12px;color:var(--text-3)">Company Split YTD</p><p style="font-size:18px;font-weight:700;color:var(--text-1)">$${split.toFixed(2)}</p></div></div>
<div style="margin-top:20px;padding:18px;background:var(--bg-today);border-radius:10px;border:2px solid var(--accent)"><p style="font-size:11px;color:var(--text-3);margin-bottom:4px">Company Split YTD — for 1096 filing (CT + Federal)</p><p style="font-size:28px;font-weight:800;color:var(--text-1)">$${split.toFixed(2)}</p></div>
<div style="margin-top:20px;padding:14px;background:var(--bg-hover);border-radius:8px;border-left:4px solid var(--err)"><p style="font-size:13px;color:#333;line-height:1.5"><strong>Disclaimer:</strong> For informational purposes only. Consult a tax professional. Self-employment tax (15.3%) may apply.</p></div></div>`}
function printTaxSummary(){window.print()}
async function exportTaxSummary(){try{
if(!window.jspdf){showToast('Loading PDF library...','info');
const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
document.head.appendChild(s);await new Promise((r,j)=>{s.onload=r;s.onerror=j})}
const{jsPDF}=window.jspdf;const doc=new jsPDF();const{yr,ys,gross,tExp,tMi,miDed,split}=getTaxData();
doc.setFontSize(20);doc.text('Year-End Tax Summary',20,20);doc.setFontSize(12);doc.text(`${'Tutoring Business'} - ${yr}`,20,30);
let y=50;doc.text(`Gross Income: $${gross.toFixed(2)}`,20,y);y+=8;doc.text(`Company Split: -$${split.toFixed(2)}`,20,y);y+=8;doc.text(`Your Gross: $${(gross-split).toFixed(2)}`,20,y);y+=12;doc.text(`Expenses: $${tExp.toFixed(2)}`,20,y);y+=8;doc.text(`Mileage (${tMi.toFixed(0)} mi): $${miDed.toFixed(2)}`,20,y);y+=8;doc.text(`Total Deductions: $${(miDed+tExp).toFixed(2)}`,20,y);y+=12;doc.setFontSize(14);doc.text(`Net Profit: $${(gross-split-miDed-tExp).toFixed(2)}`,20,y);y+=16;doc.setFontSize(12);doc.text(`Company Split YTD (for 1096): $${split.toFixed(2)}`,20,y);y+=12;

doc.save(`tax-summary-${yr}.pdf`);showToast('Tax PDF exported!','success')}catch(e){alert('Error generating PDF');console.error(e)}}
function openSettingsModal(){
$('google-maps-api-key').value=settings.googleMapsApiKey||'';
$('business-address').value=settings.businessAddress||'';
const cfg=getSyncConfig();
$('gist-id').value=cfg.gistId;$('gist-pat').value=cfg.pat;
$('settings-modal').classList.add('active')}
async function saveSettings(){
settings.googleMapsApiKey=$('google-maps-api-key').value.trim();
settings.businessAddress=$('business-address').value.trim();
HOME_ADDRESS=settings.businessAddress;
// Save Gist config to localStorage (not to the Gist itself)
localStorage.setItem('tutor-gist-id',$('gist-id').value.trim());
localStorage.setItem('tutor-gist-pat',$('gist-pat').value.trim());
saveData();closeModal('settings-modal');showToast('Settings saved!','success');
if(hasSyncConfig()){showToast('Testing cloud sync...','info');try{await saveToGist();showToast('Cloud sync connected!','success')}catch(e){showToast('Sync failed — check your Gist ID and Token','error')}}}
function downloadJSON(data,filename){const b=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=filename;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(u);localStorage.setItem('tutoring-last-backup',Date.now().toString())}
function backupData(){downloadJSON({version:'2.0',date:new Date().toISOString(),data:{clients,sessions,expenses,settings}},`tutoring-backup-${new Date().toISOString().split('T')[0]}.json`);showToast('Backup downloaded!','success')}
function restoreData(ev){const f=ev.target.files[0];if(!f)return;const r=new FileReader();r.onload=e=>{try{const bk=JSON.parse(e.target.result);const d=bk.data||bk;if(!confirm(`Restore from ${bk.date?new Date(bk.date).toLocaleDateString():'backup'}? This replaces all data.`)){ev.target.value='';return}clients=d.clients||[];sessions=d.sessions||[];expenses=d.expenses||[];settings={...settings,...(d.settings||{})};HOME_ADDRESS=settings.businessAddress;saveData();
renderClients();renderSessions();renderExpenses();renderReports();closeModal('settings-modal');
if(hasSyncConfig()){saveToGist().then(()=>showToast('Restored & synced to cloud!','success'))}else{showToast('Restored!','success')};ev.target.value=''}catch(err){alert('Invalid backup file.');ev.target.value=''}};r.readAsText(f)}
function exportCSV(name,headers,rows){
const esc=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
const csv=[headers.map(esc).join(','),...rows.map(r=>r.map(esc).join(','))].join('\n');
const b=new Blob([csv],{type:'text/csv'});const u=URL.createObjectURL(b);
const a=document.createElement('a');a.href=u;a.download=name.toLowerCase()+'.csv';a.click();URL.revokeObjectURL(u)}
function exportClients(){exportCSV('Clients',['Name','Address','Age','School','Rate','Split','Parent','Email','Phone','Subjects','Goals','Notes'],clients.map(c=>[c.name,c.address,c.age||'',c.school||'',c.hourlyRate,c.companySplit||0,c.parentName||'',c.parentEmail||'',c.parentPhone||'',c.subjects||'',c.goals||'',c.notes||'']))}
function exportSessions(){exportCSV('Sessions',['Date','Client','Type','Duration','Amount','Status','Payment','Mileage','Notes'],sessions.map(s=>[s.date,getClientNames(s),s.type,s.duration,s.amount,s.status||'completed',s.paymentStatus||'unpaid',s.mileage||0,s.notes||'']))}
function exportExpenses(){exportCSV('Expenses',['Date','Category','Description','Amount'],expenses.map(e=>[e.date,e.category,e.description,e.amount]))}
document.addEventListener('DOMContentLoaded',init);
// ========== SERVICE WORKER ==========
if('serviceWorker' in navigator){navigator.serviceWorker.register('sw.js').catch(e=>console.log('SW:',e))}
