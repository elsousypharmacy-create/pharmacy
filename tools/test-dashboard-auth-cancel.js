const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const src=html.slice(html.indexOf('function normPin('),html.indexOf('function api_('));
const login=html.slice(html.indexOf('function dashboardLogin('),html.indexOf('function oops('));
const storage=new Map(),timers=[],answers=[];let prompts=0,renders=0;
const c={Promise,String,Object,ADMIN_ACTIONS:{},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},setTimeout:fn=>{timers.push(fn);return timers.length;},prompt:()=>{prompts++;return answers.shift()??null;},CUR:'sales',TAB:0,render:()=>renders++};
vm.createContext(c);vm.runInContext(src+login,c);
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const runTimers=async()=>{while(timers.length){timers.shift()();await flush();}};
(async()=>{
 c.api_=()=>Promise.resolve({lockError:true});answers.push(null);
 const first=c.api('getExpensesData');await flush();await runTimers();await first;
 assert.equal(prompts,1);assert(c.PIN_CANCELLED);
 // Simulate late initial requests, resume and a timer after the shared prompt has expired.
 await Promise.all([c.api('getBalanceSheet'),c.api('getStaffHub'),c.api('getExpensesData')]);await runTimers();
 assert.equal(prompts,1,'cancel must suppress later automatic prompts');
 answers.push('١٢٣٤');c.api_=(a,p)=>Promise.resolve(p?.pin==='1234'?{ok:true}:{lockError:true});
 c.dashboardLogin();c.dashboardLogin();await runTimers();
 assert.equal(prompts,2,'explicit login is shared even when activated twice');assert.equal(storage.get('adminPin'),'1234');assert(renders>0);
 assert.equal((await c.api('getBalanceSheet')).ok,true);assert.equal(prompts,2);
 // A rejected saved PIN still allows an explicit retry; cancellation is not an auth bypass.
 storage.set('adminPin','wrong');answers.push(null);const denied=c.api('getExpensesData');await flush();await runTimers();assert.equal((await denied).lockError,true);assert.equal(storage.has('adminPin'),false);assert.equal(prompts,3);
 console.log('Dashboard auth: cancel suppresses late prompts, explicit retry shares prompt, Arabic digits and rejected PIN remain protected');
})().catch(e=>{console.error(e);process.exitCode=1;});
