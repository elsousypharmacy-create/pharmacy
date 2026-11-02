const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const source=html.slice(html.indexOf('var HOME_MR ='),html.indexOf('function heroSelect('));
let count=0;function test(name,fn){fn();console.log('OK',name);count++;}
class Store{constructor(){this.map=new Map()}getItem(k){return this.map.get(k)||null}setItem(k,v){this.map.set(k,String(v))}removeItem(k){this.map.delete(k)}key(i){return [...this.map.keys()][i]}get length(){return this.map.size}}
function setup(storage=new Store()){
 let auth=true,calls=0;
 const c={Date,Promise,Math,Number,Array,JSON,localStorage:storage,sessionStorage:new Store(),storedPin:()=>auth?'fixture-pin':'',cairoNow:()=>({date:'2026-11-02'}),isoAdd:(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10),esc:v=>String(v).replaceAll('<','&lt;'),num:v=>String(v),ltr:v=>String(v),cacheKey:(a,p)=>'c:'+a+':'+JSON.stringify(p),document:{getElementById:()=>null},goalOf:()=>10000,logErr:()=>{},HOME_MONTH:null,openMenu:()=>{}};
 c.cacheSet=(a,p,d)=>{if(c.storedPin())storage.setItem(c.cacheKey(a,p),JSON.stringify({t:Date.now(),d}))};
 c.api=(a,p)=>{calls++;return Promise.resolve(pl(p.month));};
 vm.createContext(c);vm.runInContext(source,c);return {c,storage,calls:()=>calls,auth:v=>auth=v};
}
function pl(month='2026-11'){return {ok:true,month,financial_schema:'finance-review-v1',exp_last_entry:'2026-11-02',exp_stale_days:0,pending_expenses:16000,days:[{date:month+'-01',expenses:32500,pending_expenses:16000,net:null},{date:month+'-02',expenses:16,pending_expenses:0,net:100}]};}
(async()=>{
 let f=setup(),c=f.c;
 test('synthetic ledger remainder is not counted as detailed expense',()=>{const t=c.homeExpenseTotals(pl(),'2026-11-01','2026-11-01');assert.equal(t.itemized,16500);assert.equal(t.pending,16000);assert.equal(t.total,32500)});
 test('other dates do not inherit the month-wide remainder',()=>assert.equal(c.homeExpenseTotals(pl(),'2026-11-02','2026-11-02').itemized,16));
 test('source failure is unavailable, not a zero expense',()=>assert.equal(c.homePeriodExpenses({...pl(),expense_source_error:true},'2026-11-01','2026-11-02'),null));
 test('zero is retained when source confirms no expense',()=>{const p=pl();p.days[1].expenses=0;assert.equal(c.homePeriodExpenses(p,'2026-11-02','2026-11-02'),0)});
 test('old schema cannot allocate a month remainder to an arbitrary date',()=>{const p=pl();delete p.days[0].pending_expenses;assert.equal(c.homePeriodExpenses(p,'2026-11-01','2026-11-01'),null)});
 test('period menu exists before any data loads',()=>assert(c.homePeriodTabs().includes('aria-label="تحديد مدة التقرير"')));
 test('invalid, reversed, future and overlong periods rejected',()=>{for(const [a,b] of [['2026-11-31','2026-11-31'],['2026-11-02','2026-11-01'],['2026-11-01','2026-11-03'],['2025-01-01','2026-11-02']])assert.equal(c.validHomePeriod(a,b),false)});
 test('cross-year custom dates preserve exact bounds',()=>{c.HOME_MR={key:'custom',from:'2025-12-31',to:'2026-01-01'};const r=c.homeRange();assert.equal(r.from,'2025-12-31');assert.equal(r.to,'2026-01-01');assert.deepEqual(Array.from(c.homeRangeMonths(r)),['2025-12','2026-01']);});
 test('custom goal uses actual inclusive day count',()=>{const r={key:'custom',from:'2025-12-31',to:'2026-01-01',month:'2025-12'};const s=c.monthSlide({r,m:{net_sales:0},pl:{}});assert(s.includes('20000'));assert(s.includes('فترة مخصصة'));});
 f=setup();c=f.c;let [one,two]=await Promise.all([c.homeProfitLoss('2026-11'),c.homeProfitLoss('2026-11')]);
 test('daily and month requests share one in-flight load',()=>{assert.equal(f.calls(),1);assert.equal(one,two);});
 let reopened=setup(f.storage);
 test('reopening restores expense data immediately',()=>assert.equal(reopened.c.homeReadPL('2026-11').data.days[0].expenses,32500));
 await reopened.c.homeProfitLoss('2026-11');test('fresh persistent cache skips repeat API load',()=>assert.equal(reopened.calls(),0));
 reopened.auth(false);test('local expense data requires saved owner access',()=>assert.equal(reopened.c.homeReadPL('2026-11'),null));
 f=setup();c=f.c;const saved=pl();c.HOME_PL_CACHE['2026-11']={at:Date.now()-600000,data:saved};c.api=()=>Promise.reject(Error('offline'));await assert.rejects(c.homeProfitLoss('2026-11'));
 test('failed refresh keeps the last result for display',()=>assert.equal(c.homeReadPL('2026-11').data,saved));
 f=setup();c=f.c;const combined=await c.homeRangePL({from:'2026-10-01',to:'2026-11-02'});
 test('custom periods merge all month expense sources',()=>{assert.equal(combined.days.length,4);assert.equal(c.homeExpenseTotals(combined,'2026-10-01','2026-11-02').itemized,33032);});
 console.log(count,'expense/period checks passed');
})().catch(e=>{console.error(e);process.exitCode=1});
