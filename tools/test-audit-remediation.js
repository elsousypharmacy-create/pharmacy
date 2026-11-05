const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
let count=0;const test=(name,fn)=>{fn();count++;console.log('OK',name);};
const RealDate=Date;class FixedDate extends RealDate{constructor(...args){super(...(args.length?args:['2026-11-02T12:00:00Z']));}static now(){return +new FixedDate();}}
const formatDate=(date,tz,pattern)=>pattern==='yyyy-MM'?new RealDate(date).toISOString().slice(0,7):new RealDate(date).toISOString().slice(0,10);

const props={ADMIN_PIN:'1234'};
const P={getProperty:k=>props[k]===undefined?null:props[k],setProperty:(k,v)=>props[k]=v,deleteProperty:k=>delete props[k]};
const routing=vm.createContext({Date:FixedDate,PropertiesService:{getScriptProperties:()=>P},Utilities:{formatDate},SpreadsheetApp:{openById:()=>({getSheetByName:()=>({getLastRow:()=>1})})},STAFF_SHEET_ID:'fixture',ContentService:{createTextOutput:x=>x},maybeEnsureTriggers_:()=>{},jsonResponseStaff:x=>x,adminPinOk_:pin=>pin==='1234'});
vm.runInContext(read('server/src/05_routing.js'),routing);
for(const action of ['snapshotRefresh','snapshotEnable','recordStats','scanRefreshIndex']){
  test(action+' rejects anonymous mutation before dispatch',()=>{let called=false;routing.buildSnapshot=routing.setupSnapshotTrigger=routing.recordDailyStats_=routing.refreshScanIndex=()=>{called=true};const out=routing.doGet({parameter:{action}});assert.equal(out.lockError,true);assert.equal(called,false);});
}
test('protected API accepts JSON POST without query credentials',()=>{routing.cacheTTL_=()=>45;routing.cachedCall_=(n,p,fn)=>({ok:true,hasPin:p.pin==='1234'});const out=routing.doPost({postData:{contents:JSON.stringify({action:'getMonthTotalsRaw',range:'today',pin:'1234'})}});assert.equal(out.ok,true);assert(out.hasPin===true,'response '+JSON.stringify(out));});
test('staff calls and orders key retain their GET semantics over POST transport',()=>{routing.callsSet_=p=>({ok:true,status:p.status});routing.ensureOrdersBotKey_=()=>({ok:true,key:'fixture'});const call=routing.doPost({postData:{contents:JSON.stringify({action:'callsSet',status:'done',pin:'1234'})}});assert.equal(call.status,'done');const key=routing.doPost({postData:{contents:JSON.stringify({action:'ordersBotKey',pin:'1234'})}});assert.equal(key.key,'fixture');});

const auth=vm.createContext({Date:FixedDate,PropertiesService:{getScriptProperties:()=>P},Utilities:{formatDate},console});
vm.runInContext(read('server/src/23_ai.js'),auth);
test('ten bad PIN attempts create a timed lockout',()=>{for(const k of Object.keys(props))if(k!=='ADMIN_PIN')delete props[k];for(let i=0;i<10;i++)assert.equal(auth.adminPinOk_('bad'),false);assert(Number(props.ADMIN_PIN_BAD_UNTIL)>FixedDate.now());assert.equal(auth.adminPinOk_('1234'),false);});
test('PIN lockout expires and valid PIN clears counters',()=>{props.ADMIN_PIN_BAD_UNTIL=String(FixedDate.now()-1);assert.equal(auth.adminPinOk_('1234'),true);assert.equal(props.ADMIN_PIN_BAD,undefined);assert.equal(props.ADMIN_PIN_BAD_UNTIL,undefined);});

const finance=vm.createContext({Date:FixedDate,Utilities:{formatDate},PropertiesService:{getScriptProperties:()=>({getProperty:k=>k==='monthlySalaries_2026-11'?'3000':null})},SpreadsheetApp:{openById:()=>({getSheetByName:()=>({getLastRow:()=>1})})},STAFF_SHEET_ID:'fixture'});
vm.runInContext(read('server/src/62_kpi.js'),finance);vm.runInContext(read('server/src/61_finance.js'),finance);
finance.rawDay_=date=>date==='2026-11-01'?{date,has:true,net:1000,profit:300}:{date,has:false};
finance.allExpenses_=()=>({items:[{date:'2026-11-01',category:'مصروفات متنوعة',amount:50}],latestEntry:'2026-11-02',staleDays:0});
test('salary accrues on transaction-free elapsed day',()=>{const x=finance.getProfitLossData({month:'2026-11'});assert.equal(x.days.length,2);assert.equal(x.total_salaries_so_far,200);assert.equal(x.net_profit,50);});

const caching=vm.createContext({Date:FixedDate,Utilities:{formatDate}});vm.runInContext(read('server/src/82_snapshot_staffhub.js'),caching);
test('cache key ignores timestamp and PIN and sorts params',()=>assert.deepEqual(JSON.parse(JSON.stringify(caching.cacheParams_({pin:'secret',_ts:2,range:'today',a:1}))),{a:1,range:'today'}));
test('custom range touching today gets live TTL',()=>{assert.equal(caching.cacheTTL_({from:'2026-11-01',to:'2026-11-02'}),45);assert.equal(caching.cacheTTL_({from:'2026-10-01',to:'2026-10-31'}),1800);});
test('cache reuses responses despite changing timestamp and PIN',()=>{let calls=0,store={};caching.fxCacheGet_=k=>store[k];caching.fxCachePut_=(k,v)=>store[k]=v;const a=caching.cachedCall_('x',{range:'today',_ts:1,pin:'a'},()=>({ok:true,n:++calls}),45);const b=caching.cachedCall_('x',{pin:'b',_ts:2,range:'today'},()=>({ok:true,n:++calls}),45);assert.equal(calls,1);assert.equal(b.cached,true);});

const html=read('index.html'),inline=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).join('\n');
const extract=(name,next)=>inline.slice(inline.indexOf('function '+name+'('),inline.indexOf('function '+next+'('));
const home=vm.createContext({cairoNow:()=>({date:'2026-11-02'}),isFinite});vm.runInContext(extract('homeRefreshValid','pgHome'),home);
const good=[{ok:true},{ok:true},{ok:true,source:'pos-invoices-v1',daily:[{date:'2026-11-02'}],net_sales:100,profit_total:20,avg_invoice:50}];
test('Home refresh accepts complete authoritative snapshot',()=>assert.equal(home.homeRefreshValid(good),true));
test('Home refresh rejects partial or failed financial snapshots',()=>{assert.equal(home.homeRefreshValid([{ok:true},{ok:true},{ok:false}]),false);const missing=JSON.parse(JSON.stringify(good));missing[2].daily=[];assert.equal(home.homeRefreshValid(missing),false);const nan=JSON.parse(JSON.stringify(good));nan[2].net_sales=null;assert.equal(home.homeRefreshValid(nan),false);});
(async()=>{
  let request;const front=vm.createContext({SCRIPT_URL:'https://origin.fixture/',FAST_URL:'',FAST_READ:{},fetch:async(url,options)=>{request={url,options};return {json:async()=>({ok:true})};},URLSearchParams});
  vm.runInContext(extract('api_','post'),front);await front.api_('getProfitLoss',{month:'2026-11',pin:'1234'});
  test('authenticated origin API uses POST and keeps PIN out of URL',()=>{assert.equal(request.url,'https://origin.fixture/');assert.equal(request.options.method,'POST');assert(!request.url.includes('1234'));assert.equal(JSON.parse(request.options.body).pin,'1234');});
  front.fetch=async(url,options)=>{request={url,options};return {json:async()=>({status:'ok'})};};
  await assert.rejects(front.api_('getHomeBundle',{pin:'1234'}),/BACKEND_POST_UNSUPPORTED/);
  test('legacy Apps Script POST acknowledgement rejects instead of freezing dashboard',()=>{assert.equal(request.options.method,'POST');assert(!request.url.includes('1234'));assert.equal(JSON.parse(request.options.body).action,'getHomeBundle');});
  front.fetch=async()=>({json:async()=>({ok:true,status:'ok'})});
  assert.equal((await front.api_('getHomeBundle',{pin:'1234'})).ok,true);
  test('valid read response carrying status remains accepted',()=>{});

  let reads=0,updated=1,text='';const cache={};
  const file={getId:()=> 'sales-file',getLastUpdated:()=>new RealDate(updated*1000),getSize:()=>text.length,getBlob:()=>({getDataAsString:()=>{reads++;return text;}})};
  const raw=vm.createContext({Date:FixedDate,Utilities:{formatDate,DigestAlgorithm:{MD5:'md5'},computeDigest:(alg,s)=>[...String(s)].map(x=>x.charCodeAt(0)&255)},CacheService:{getScriptCache:()=>({get:k=>cache[k],put:(k,v)=>cache[k]=v})},DriveApp:{getFolderById:()=>({getFilesByName:name=>({hasNext:()=>name.startsWith('sales'),next:()=>file})})},SALES_FOLDER:'fixture'});
  vm.runInContext(read('server/src/65_raw_days.js'),raw);
  raw.parseValues=s=>{const a=[];let cur='',q=false;for(const c of s){if(c==='"')q=!q;else if(c===','&&!q){a.push(cur.trim());cur='';}else cur+=c;}a.push(cur.trim());return a;};
  raw.extractTuples=s=>s.slice(1,-1).split('),(');
  const row=(id,phone)=>{const v=Array(55).fill('0');v[0]='"x"';v[1]='"'+id+'"';v[2]='"sale"';v[35]='100';v[45]='"'+phone+'"';v[54]='10';return '('+v.join(',')+')';};
  text='INSERT INTO x VALUES '+row('1','0100 000 0000')+','+row('2','+20 100 000 0000')+';';
  test('visit phones deduplicate local and international formats',()=>{const x=raw.rawDay_('2026-11-01');assert.equal(x.visits,1);assert.equal(x.invoices,2);});
  test('unchanged raw file uses cache',()=>{const n=reads;raw.rawDay_('2026-11-01');assert.equal(reads,n);});
  test('updated historical raw file invalidates cached day',()=>{updated++;text='INSERT INTO x VALUES '+row('1','01000000000')+','+row('3','01000000001')+';';const x=raw.rawDay_('2026-11-01');assert.equal(x.visits,2);assert.equal(x.invoices,2);});

  const workerCode=read('worker/worker.js').replace('export default {','var worker = {');let posts=0;
  const w=vm.createContext({Response,Request,URL,URLSearchParams,TextEncoder,crypto,Date,Map,fetch:async()=>{posts++;return new Response('ok');}});vm.runInContext(workerCode,w);
  let pending;const ctx={waitUntil:p=>pending=p};
  let res=await w.worker.fetch(new Request('https://fixture.test/',{method:'POST',body:JSON.stringify({object:'whatsapp_business_account'})}),{WA_APP_SECRET:'fixture-secret'},ctx);
  test('configured WhatsApp webhook rejects missing signature',()=>{assert.equal(res.status,401);assert.equal(posts,0);});
  const body=JSON.stringify({object:'whatsapp_business_account'}),key=await crypto.subtle.importKey('raw',new TextEncoder().encode('fixture-secret'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig='sha256='+[...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body)))].map(x=>x.toString(16).padStart(2,'0')).join('');
  res=await w.worker.fetch(new Request('https://fixture.test/',{method:'POST',headers:{'x-hub-signature-256':sig},body}),{WA_APP_SECRET:'fixture-secret'},ctx);
  test('valid WhatsApp signature preserves delivery',async()=>{assert.equal(res.status,200);await pending;assert.equal(posts,1);});
  res=await w.worker.fetch(new Request('https://fixture.test/',{method:'POST',body:JSON.stringify({update_id:1})}),{},ctx);
  test('legacy webhook delivery remains compatible until provider secret is configured',async()=>{assert.equal(res.status,200);await pending;assert.equal(posts,2);});
  console.log(count,'audit remediation checks passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
