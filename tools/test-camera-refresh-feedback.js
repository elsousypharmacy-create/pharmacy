const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync(require('path').join(__dirname,'../index.html'),'utf8');
const source=html.slice(html.indexOf('function homeCamLatest('),html.indexOf('var HOME_APPEARANCE_OPEN'));
function setup(){let pin=true,toasts=[],box={innerHTML:'',insertAdjacentHTML:()=>{}},out={id:'same',generatedAt:'2026-11-02T16:08:00+02:00'};
 const c={storedPin:()=>pin,toast:s=>toasts.push(s),CAMR:{list:[out],at:1},CameraAssessment:{sortReports:r=>r,title:()=>''},camrNotes:()=>0,
  appearanceHomeHtml:()=> 'latest view',homeCameraPlaceholder:()=> 'empty',document:{getElementById:id=>id==='homeAppearance'?box:null},
  setTimeout:()=>1,clearTimeout:()=>{},camrReportsFetch:()=>Promise.resolve({})};vm.createContext(c);vm.runInContext(source,c);
 return {c,toasts,box,logout:()=>pin=false,tick:async()=>{for(let i=0;i<8;i++)await Promise.resolve()}};
}
(async()=>{let f=setup();f.c.homeCamLatest(true);await f.tick();assert(f.toasts[0].includes('لا يوجد تقرير أحدث'));assert.equal(f.box.innerHTML,'latest view');
 f=setup();f.c.camrReportsFetch=()=>{f.c.CAMR.list=[{id:'new',generatedAt:'2026-11-02T18:30:00+02:00'}];return Promise.resolve({})};f.c.homeCamLatest(true);await f.tick();assert(f.toasts[0].includes('الأحدث'));
 f=setup();f.logout();f.c.homeCamLatest(true);assert(f.toasts[0].includes('سجّل الدخول'));
 assert(html.includes('تحديث قائمة التقارير'));console.log('Camera refresh: unchanged/new reports and missing-owner feedback passed');
})().catch(e=>{console.error(e);process.exitCode=1});
