const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync(require('path').join(__dirname,'../index.html'),'utf8');
const source=html.slice(html.indexOf('var HOME_TEAM_PERIOD_SELECTED='),html.indexOf('function staffCardToggle('));
const requests=[],saved=new Map(),box={innerHTML:'',getAttribute:()=> '2026-11-02',insertAdjacentHTML:(p,s)=>box.innerHTML+=s},label={textContent:''};
const c={Promise,Date,Array,JSON,setTimeout,clearTimeout,RANGE:{homeStaff:'month'},CUSTOM:{},storedPin:()=> 'owner',
 document:{getElementById:id=>id==='homeTeamCards'?box:label},cacheGet:(k,p)=>saved.get(JSON.stringify(p)),cacheSet:(k,p,d)=>saved.set(JSON.stringify(p),d),
 rangeParams:()=>c.RANGE.homeStaff==='custom'?c.CUSTOM.homeStaff:{range:c.RANGE.homeStaff},
 staffCardsHtml:(e,l,h)=>String(e[0]?.net ?? 'empty'),api:(a,p)=>new Promise(resolve=>requests.push({a,p,resolve})),
 setRange:(k,v,fn)=>{c.RANGE[k]=v;fn()},validHomePeriod:()=>false,toast:()=>{}};
vm.createContext(c);vm.runInContext(source,c);
const tick=async()=>{for(let i=0;i<10;i++)await Promise.resolve()};
(async()=>{
 c.HOME_TEAM_PERIOD_SELECTED=true;c.loadHomeStaffPeriod();c.RANGE.homeStaff='week';c.loadHomeStaffPeriod();
 assert.equal(requests[0].a,'getStaffHub');assert.equal(requests[0].p.range,'month');
 requests[1].resolve({ok:true,label:'week',employees:[{net:222}],live:[],rows:[]});await tick();assert.equal(box.innerHTML,'222');
 requests[0].resolve({ok:true,label:'month',employees:[{net:111}],live:[],rows:[]});await tick();assert.equal(box.innerHTML,'222','old period must not overwrite new selection');
 assert.equal(label.textContent,'week · بتوقيت مصر');
 c.loadHomeStaffPeriod();assert.equal(requests.length,2,'fresh period cache skips another request');
 c.RANGE.homeStaff='custom';c.CUSTOM.homeStaff={from:'2026-10-30',to:'2026-11-02'};c.loadHomeStaffPeriod();
 assert.equal(requests[2].p.from,'2026-10-30');assert.equal(requests[2].p.to,'2026-11-02');
 requests[2].resolve({ok:true,label:'custom',employees:[{net:333}],live:[],rows:[]});await tick();assert.equal(box.innerHTML,'333');
 c.RANGE.homeStaff='week';c.setHomeStaffRange('custom');assert.equal(c.RANGE.homeStaff,'week','invalid custom dates restore previous selection');
 console.log('Staff period: real period endpoint, custom bounds, stale-response guard, cache reuse and invalid-date recovery passed');
})().catch(e=>{console.error(e);process.exitCode=1});
