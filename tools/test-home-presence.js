const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync(require('path').join(__dirname,'../index.html'),'utf8');
const source=html.slice(html.indexOf('var STAFF_ALIASES ='),html.indexOf('function drawStaffHub('));
let next,opened;
const c={Date,Number,Array,Math,JSON,Promise,HOME_FLASH_MODE:true,HOME_PRESENCE_SALES_DAY:'2026-11-03',HOME_PRESENCE_ITEMS:[],
 cairoNow:()=>({date:'2026-11-03'}),esc:s=>String(s).replace(/</g,'&lt;').replace(/"/g,'&quot;'),ltr:String,num:String,RANGE:{},CUR:'sales',
 row:(a,b,v)=>'<div>'+a+b+v+'</div>',document:{getElementById:()=>null},go:(sec,tab)=>next={sec,tab},staffSheet:i=>opened=i,openMenu:()=>{},
 HR:{kpi:{employees:[{name:'احمد شعت',net:0}]},hist:{rows:[]},live:{live:[]}}};
vm.createContext(c);vm.runInContext(source,c);
const live=[{name:'ahmed shaat',checkInTimestamp:Date.parse('2026-11-03T06:00:00Z')/1000}];
const out=c.staffCardsHtml([{name:'احمد شعت',net:0},{name:'غير موجود',net:999}],live,[],'home',false);
assert.equal((out.match(/<article/g)||[]).length,1,'Home has one brief presence card');assert(out.includes('احمد شعت'));assert(!out.includes('غير موجود'));assert(out.includes('<b>0</b>'));assert(!out.includes('بتوقيت مصر'));assert(!out.includes('<details'));
c.homePresenceOpen(0);assert.deepEqual(next,{sec:'team',tab:0});assert.equal(c.RANGE.perf,'today');assert.equal(c.STAFF_PENDING_FOCUS,'احمد شعت');
c.staffFocusPending();assert.equal(opened,undefined,'late response cannot open staff sheet over another section');c.CUR='team';c.staffFocusPending();assert.equal(opened,0);
c.HOME_PRESENCE_SALES_DAY='2026-11-02';assert(!c.homePresenceHtml([{name:'احمد شعت',net:999}],live,false).includes('<b>999</b>'),'yesterday sales must not be shown as today');
assert(c.homePresenceHtml([],live,true).includes('الحضور غير متاح'));
assert(html.includes('document.body.classList.toggle(\'home-flash-mode\''));assert(html.includes('box.innerHTML = homeFlashLayout(html)'));
console.log('Home presence: only present staff, net zero, Cairo time without label, profile navigation, stale-page guard and no yesterday-as-today sales passed');
