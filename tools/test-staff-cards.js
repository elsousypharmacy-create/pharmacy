const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync(require('path').join(__dirname,'../index.html'),'utf8');
const source=html.slice(html.indexOf('var STAFF_ALIASES ='),html.indexOf('function drawStaffHub('));
let saved=null,reply,box={innerHTML:'',getAttribute:()=> '2026-11-02'};
const c={Date,Number,Array,Math,JSON,Promise,esc:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),ltr:String,num:String,
 row:(a,b,v)=>'<div>'+a+b+v+'</div>',cacheGet:()=>saved,cacheSet:(k,p,v)=>saved=v,storedPin:()=> 'owner',
 document:{getElementById:()=>box},api:()=>new Promise(r=>reply=r)};
vm.createContext(c);vm.runInContext(source,c);
const employees=[{name:'احمد شعت',net:0,sales:500,invoices:2,avg_inv:250,profit:10,reg_pct:50,care_score:99},{name:'آخر',net:1000,invoices:1,avg_inv:1000}];
const live=[{name:'ahmed shaat',checkInTimestamp:1793610000}];
let entries=c.staffCardEntries(employees,live,[]);assert.equal(entries.length,2);assert.equal(entries[0].name,'احمد شعت');
let rendered=c.staffCardsHtml(employees,live,[],'team',false);
assert(rendered.includes('موجود الآن'));assert(rendered.includes('صافي المبيعات'));assert(/صافي المبيعات<\/small><b>0<\/b>/.test(rendered));
assert(!rendered.includes('99'));assert(rendered.includes('عينة محدودة'));assert(rendered.includes('الخروج'));assert(!rendered.includes('بتوقيت مصر'));
rendered=c.staffCardsHtml([],[{name:'<No sales>',checkInTimestamp:1793610000}],[],'home',false);assert(rendered.includes('&lt;No sales>'));assert(rendered.includes('—'),'unknown sales remain unavailable');
const rows=[{name:'آخر',date:'2026-11-02',checkIn:'08:00 AM',checkOut:'02:00 PM'},{name:'آخر',date:'2026-11-02',checkIn:'04:00 PM',checkOut:'10:00 PM'}];
rendered=c.staffCardsHtml(employees,[],rows,'team',false);assert(rendered.includes('سجّل خروج'));assert(rendered.includes('دخول 04:00 م'));
c.STAFF_CARD_OPEN['team:اخر']=true;assert(!c.staffCardsHtml(employees,[],rows,'team',false).includes('data-staff-card="team:اخر" open'));assert(c.staffCardsHtml(employees,[],rows,'team',false).includes('+ تفاصيل'));
rendered=c.staffCardsHtml(employees,live,rows,'team',true);assert(rendered.includes('الحضور غير متاح'));assert(!rendered.includes('موجود الآن'));
entries=c.staffCardEntries([{name:'احمد واحد'},{name:'احمد اثنين'}],[{name:'احمد'}],[]);assert.equal(entries.length,3,'ambiguous first name must not be assigned to either colleague');
(async()=>{c.loadHomeTeamCards('2026-11-02',employees,[],false);reply({ok:true,rows:rows.concat({name:'Other day',date:'2026-11-01'})});for(let i=0;i<8;i++)await Promise.resolve();assert.equal(saved.rows.length,2);assert(box.innerHTML.includes('سجّل خروج'));assert(!box.innerHTML.includes('Other day'));
 assert(html.includes('staffCardsHtml(list,live,HR.hist.rows'));assert(html.includes('staffCardsHtml(teamList,live'));
 console.log('Staff cards: zero net, unknown sales, attendance-only staff, aliases, ambiguity, Cairo labels, latest shift, sample threshold, open state and exact-day home history passed');
})().catch(e=>{console.error(e);process.exitCode=1});
