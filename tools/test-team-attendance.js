const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(require('path').join(__dirname,'../index.html'),'utf8');
const source=html.slice(html.indexOf('var STAFF_ALIASES ='),html.indexOf('function drawStaffHub('));
let resolve,params,pin='owner',box;
const c={Date,Number,Math,Promise,JSON,Array,esc:String,ltr:String,num:String,
 HR:{kpi:{employees:[{name:'احمد شعت'}],label:'أمس'},hist:{range:{from:'2026-11-02',to:'2026-11-02'}},live:{live:[]}},rangeParams:()=>({range:'yesterday'}),cairoNow:()=>({date:'2026-11-03'}),storedPin:()=>pin,
 openMenu:()=>{box={innerHTML:'loading'};},document:{getElementById:id=>id==='sheet'?{classList:{contains:()=>true}}:box},
 api:(action,p)=>{assert.equal(action,'getAttendanceHistory');params=p;return new Promise(r=>resolve=r);},
 row:()=>'',sessionStorage:{getItem:()=>null}};
vm.createContext(c);vm.runInContext(source,c);
assert.equal(c.teamDuration(null),'—');assert.equal(c.teamDuration(125),'2:05');assert.equal(c.teamClockText(null),'—');
assert.equal(c.teamClockText(Date.now()-90*60000),'1:30');assert.equal(c.teamClockText(Math.floor((Date.now()-90*60000)/1000)),'1:30');assert.equal(c.teamClockText(Date.now()+60000),'—');
const button={closest:()=>({querySelector:()=>({textContent:'احمد شعت'})})};
(async()=>{
 c.teamAttendanceOpen(button);assert.equal(params.from,'2026-11-02');assert.equal(params.to,'2026-11-02');
 resolve({ok:true,rows:[{name:'ahmed shaat',date:'2026-11-02',checkIn:'08:00 AM',checkOut:'04:00 PM'},{name:'آخر',date:'2026-11-02',checkIn:'09:00 AM',checkOut:'05:00 PM'},{name:'ahmed shaat',date:'2026-10-31',checkIn:'01:00 AM',checkOut:'02:00 AM'}]});
 for(let i=0;i<8;i++)await Promise.resolve();
 assert(box.innerHTML.includes('08:00 ص'));assert(!box.innerHTML.includes('09:00 ص'));assert(!box.innerHTML.includes('2026-10-31'));
 c.teamAttendanceOpen(button);pin='changed';resolve({ok:true,rows:[]});for(let i=0;i<8;i++)await Promise.resolve();assert.equal(box.innerHTML,'loading','late private response after sign-out must not render');
 console.log('Team attendance: selected period bounds, alias matching, other people/dates excluded, late authorization guard, running/closed/unknown durations passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
