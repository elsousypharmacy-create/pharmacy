const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync(require('path').join(__dirname,'../index.html'),'utf8');
const source=html.slice(html.indexOf('var HOME_MR ='),html.indexOf('function heroSelect('));
const sample={ok:true,lastEntry:'2026-11-02',staleDays:0,sourceError:'',items:[
 {date:'2026-11-02',amount:17,category:'تشغيل',name:'private fixture'},
 {date:'2026-11-02',amount:3,category:'متنوعة',fromLedger:true},
 {date:'2026-11-02',amount:1000,category:'مشتريات'},
 {date:'2026-11-02',amount:50,category:'تحصيل',isIncome:true},
 {date:'2026-11-01',amount:10,category:'رواتب'}]};
const storage=new Map();
function setup(){
 const timers=new Map();let seq=0,calls=[],reply,auth='owner';
 const box={innerHTML:'',getAttribute:()=> '2026-11-02',insertAdjacentHTML:(p,s)=>box.innerHTML+=s};
 const c={Date,Promise,Math,Number,Array,JSON,HOME_MONTH:null,document:{getElementById:id=>id==='homeDayExpenses'?box:null},
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},sessionStorage:{getItem:()=>null},
  storedPin:()=>auth,cairoNow:()=>({date:'2026-11-02'}),isoAdd:()=>'',esc:String,ltr:String,num:String,
  cacheKey:(a,p)=>a+JSON.stringify(p),setTimeout:f=>{timers.set(++seq,f);return seq},clearTimeout:k=>timers.delete(k),
  goalOf:()=>10000,logErr:()=>{},api:(a,p)=>{calls.push({a,p});return new Promise(r=>reply=r)}};
 c.cacheSet=(a,p,d)=>storage.set(c.cacheKey(a,p),JSON.stringify({t:Date.now(),d}));
 vm.createContext(c);vm.runInContext(source,c);
 return {c,box,calls,timers,reply:d=>reply(d),logout:()=>auth='',tick:async()=>{for(let i=0;i<8;i++)await Promise.resolve()}};
}
(async()=>{
 let f=setup(),c=f.c;
 const p=c.homeExpenseMonth('2026-11'),same=c.homeExpenseMonth('2026-11');assert.strictEqual(p,same);
 await f.tick();assert.equal(f.calls.length,1);assert.equal(f.calls[0].a,'getExpensesData');
 assert.equal(f.calls[0].p.from,'2026-11-01');assert.equal(f.calls[0].p.to,'2026-11-02');
 f.reply(sample);const data=await p;
 assert.equal(c.homeExpenseTotals(data,'2026-11-02','2026-11-02').itemized,17);
 assert.equal(c.homeExpenseTotals(data,'2026-11-02','2026-11-02').pending,3);
 assert(!JSON.stringify(data).includes('private fixture'));assert.equal(f.timers.size,0);
 assert(!c.HOME_PL_CACHE['2026-11'],'expense-only response must not replace financial P&L');
 f=setup();c=f.c;c.loadHomeDayExpenses('2026-11-02');assert(f.box.innerHTML.includes('17'));
 await f.tick();assert.equal(f.calls.length,0,'reload uses fresh persisted summary');
 storage.clear();f=setup();c=f.c;f.box.innerHTML=c.homeExpenseHtml(null,'2026-11-02','2026-11-02',true);
 c.loadHomeDayExpenses('2026-11-02');await f.tick();for(const fn of [...f.timers.values()])fn();await f.tick();
 assert(!f.box.innerHTML.includes('جارٍ التحميل'));assert(f.box.innerHTML.includes('إعادة المحاولة'));
 c.loadHomeDayExpenses('2026-11-02');await f.tick();assert.equal(f.calls.length,1,'redraw does not flood retries');
 f.reply(sample);await f.tick();assert.equal(c.homeReadExpense('2026-11').data.days.length,2,'late success is retained');
 c.loadHomeDayExpenses('2026-11-02');await f.tick();assert(f.box.innerHTML.includes('17'));
 c.HOME_EXP_CACHE['2026-11'].at=0;c.homeExpenseMonth('2026-11',true).catch(()=>{});await f.tick();
 f.reply({...sample,sourceError:'unavailable'});await f.tick();assert.equal(c.homeReadExpense('2026-11').data.days.length,2);
 storage.clear();f=setup();c=f.c;const denied=c.homeExpenseMonth('2026-11');await f.tick();f.logout();f.reply(sample);
 await assert.rejects(denied);assert.equal(storage.size,0,'late response after sign-out is never cached');
 assert(html.indexOf('loadHomeDayExpenses(homeDay);\n    loadHomeMore();')>0,'expense fetch starts before optional home widgets');
 console.log('Home expense loading: lean endpoint, sharing, exact amounts, persistence, timeout, retry, late response and sign-out checks passed');
})().catch(e=>{console.error(e);process.exitCode=1});
