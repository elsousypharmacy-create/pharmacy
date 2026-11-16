// getCustomerHistoryFast_: per-day invoice index (sheet) so a customer's history does not open 90 sales files each time.
// Run: node tools/test-cust-history-fast.cjs
const _a=require('node:assert/strict'),J=x=>JSON.parse(JSON.stringify(x));const assert={ok:_a.ok,equal:_a.equal,deepEqual:(a,b)=>_a.deepEqual(J(a),J(b))},fs=require('node:fs'),vm=require('node:vm');
const fmt=(d,f)=>{const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit',hour:'numeric',hour12:false}).formatToParts(d).reduce((o,x)=>(o[x.type]=x.value,o),{});return f==='H'?String(parseInt(p.hour,10)%24):`${p.year}-${p.month}-${p.day}`};
const dayStr=(n)=>fmt(new Date(Date.now()-n*86400000),'d');
// sales files: name -> content
const files={};let opened=[],failDay=null;
const line=(inv,name,qty,price,disc,paid,phone)=>{const f=Array(56).fill('0');f[1]=inv;f[2]='sale';f[5]='"'+name+'"';f[6]='"'+name+'"';f[7]=qty;f[8]=price;f[27]=disc;f[35]=paid;f[39]='0';f[45]=phone;return '('+f.join(',')+')'};
const file=(...ls)=>'INSERT INTO t VALUES '+ls.join(',')+';';
const A='01001112222',B='01223334444';
files['sales'+dayStr(1)+'.txt']=file(line(101,'بنادول',2,30,5,55,A),line(101,'فيتامين',1,0,5,55,A),line(102,'شاش',1,10,0,10,B));
files['sales'+dayStr(3)+'.txt']=file(line(90,'كونجستال',1,45.5,0,45.5,'+2'+A));
files['sales'+fmt(new Date(),'d')+'.txt']=file(line(200,'اليوم',1,20,0,20,A));
// in-memory sheet
const sheets={};
const mkSheet=(name)=>{const rows=[];return {name,rows,getLastRow:()=>rows.length,appendRow:(r)=>{rows.push(r.slice())},
  getRange:(r,c,n,m)=>({setNumberFormat(){},getDisplayValues:()=>rows.slice(r-1,r-1+n).map(x=>Array.from({length:m},(_,i)=>String(x[i]==null?'':x[i]))),
    setValues:(vs)=>{vs.forEach((v,i)=>{rows[r-1+i]=v.slice()})},clearContent(){for(let i=r-1;i<r-1+n;i++)rows[i]=[]}})}};
const sb={console,Logger:{log(){}},
  PropertiesService:{getScriptProperties:()=>({getProperty:()=>null,setProperty(){},deleteProperty(){}})},
  CacheService:{getScriptCache:()=>({get:()=>null,put(){},remove(){}})},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
  Utilities:{formatDate:(d,tz,f)=>fmt(d,f),sleep(){}},
  DriveApp:{getFolderById:()=>({getFilesByName:(n)=>{opened.push(n);const m=/sales(\d{4}-\d{2}-\d{2})/.exec(n);if(failDay&&m&&m[1]===failDay)throw new Error('drive down');const c=files[n];let used=false;return {hasNext:()=>c!=null&&!used,next:()=>{used=true;return {getBlob:()=>({getDataAsString:()=>c})}}}}})},
  SpreadsheetApp:{openById:()=>({getSheetByName:(n)=>sheets[n]||null,insertSheet:(n)=>(sheets[n]=mkSheet(n))})}};
vm.createContext(sb);vm.runInContext(fs.readFileSync('server/Code.js','utf8'),sb);
sb.fxCacheGet_=()=>null;sb.fxCachePut_=()=>{};sb.getDebtsSnap=()=>({debtors:[{phone:'+201001112222',net:40,daysSincePaid:3}]});
let r=sb.getCustomerHistoryFast_('+201001112222');
assert.equal(r.ok,true,JSON.stringify(r));
assert.deepEqual(r.purchases.map(p=>p.invoice),['200','101','90']);                 // today (live) first, then newest day, then older; customer B's invoice not included
const p101=r.purchases[1];
assert.deepEqual([p101.date,p101.total,p101.discount],[dayStr(1),55,5]);
assert.deepEqual(p101.items,[{name:'بنادول',qty:2,price:30},{name:'فيتامين',qty:1,price:0}]);
assert.equal(r.purchases[2].total,45.5);                                          // '+2' prefixed phone matched too
assert.deepEqual(r.debt,{net:40,daysSincePaid:3});assert.equal(r.partial,false);assert.equal(r.fast,true);
// second call: past days come from the sheet, only today's file is opened
opened=[];r=sb.getCustomerHistoryFast_('+201001112222');
assert.deepEqual(r.purchases.map(p=>p.invoice),['200','101','90']);
assert.deepEqual(opened,['sales'+fmt(new Date(),'d')+'.txt']);
// customer with no sales
r=sb.getCustomerHistoryFast_('+201555555555');assert.deepEqual([r.ok,r.purchases.length],[true,0]);
// a day that fails to read is retried next time and the answer says it may be partial
delete sheets['فواتير العملاء اليومية'];failDay=dayStr(5);opened=[];
r=sb.getCustomerHistoryFast_('+201001112222');assert.equal(r.partial,true);assert.equal(r.purchases.length,3);
failDay=null;opened=[];r=sb.getCustomerHistoryFast_('+201001112222');assert.equal(r.partial,false);assert.ok(opened.some(n=>n==='sales'+dayStr(5)+'.txt'));
// bad phone
r=sb.getCustomerHistoryFast_('abc');assert.equal(r.ok,false);
// background backfill fills everything without errors
delete sheets['فواتير العملاء اليومية'];opened=[];sb.custFeedBackfill_();assert.ok(opened.length>=85);opened=[];sb.custFeedBackfill_();assert.equal(opened.length,0);
console.log('PASS cust history fast');
