const assert=require('assert'), fs=require('fs'), vm=require('vm');
const A=require('../camera-assessment.js');
let tests=0;
function test(name,fn){fn();tests++;console.log('OK',name);}
function report(id='report_001',end='2026-11-02T12:00:00+02:00'){
  const finish=Date.parse(end),at=new Date(finish-10*60000).toISOString();
  const frames=A.zones.map((z,i)=>({file:id+'_frame_'+i,ch:z.cameras[0],at}));
  return {id,windowStart:new Date(finish-4*3600000).toISOString(),windowEnd:end,generatedAt:new Date(finish+10*60000).toISOString(),reviewedFrames:frames,assessment:{rubric:A.version,checks:A.zones.map((z,i)=>({id:z.id,assessed:true,evidence:[frames[i].file]})),issues:[]}};
}
function issue(r,overrides={}){return Object.assign({id:'diapers_leaning',zone:'diaper_facing',title:'باكتات مائلة',severity:'moderate',confidence:'high',status:'new',evidence:[r.reviewedFrames[8].file]},overrides);}
test('weights total 100 across 10 stable zones and 6 categories',()=>{assert.equal(A.zones.length,10);assert.equal(A.categories.length,6);assert.equal(A.zones.reduce((s,z)=>s+z.weight,0),100);A.categories.forEach(c=>assert.equal(A.zones.filter(z=>z.category===c.id).reduce((s,z)=>s+z.weight,0),c.weight));});
test('legacy and malformed reports do not receive invented scores',()=>{assert.equal(A.assessment({summary:[]}).score,null);const r=report();r.assessment.checks=[];assert.equal(A.assessment(r).ready,false);});
test('fully evidenced clean observations score 100',()=>{const x=A.assessment(report());assert.equal(x.score,100);assert.equal(x.coverage,100);assert.equal(x.assessedZones,10);});
test('one problem deducts once even if repeated in multiple pictures',()=>{const r=report();r.assessment.issues=[issue(r),issue(r)];const x=A.assessment(r);assert.equal(x.score,97);assert.equal(x.counts.new,1);assert.equal(x.categories.find(c=>c.id==='diapers').points,7);});
test('unknown and stale regions are excluded from denominator',()=>{const r=report();r.assessment.checks[8].assessed=false;const x=A.assessment(r);assert.equal(x.coverage,90);assert.equal(x.score,100);r.reviewedFrames.forEach(f=>f.at='2026-11-02T08:01:00+02:00');assert.equal(A.assessment(r).ready,false);});
test('wrong camera or invented evidence cannot validate a zone',()=>{const r=report();r.reviewedFrames[8].ch=6;assert.equal(A.assessment(r).coverage,90);r.assessment.checks[7].evidence=['unknown_file'];assert.equal(A.assessment(r).coverage,80);});
test('low-confidence issue blocks its zone instead of granting full marks',()=>{const r=report();r.assessment.issues=[issue(r,{confidence:'medium'})];const x=A.assessment(r);assert.equal(x.counts.unverified,1);assert.equal(x.coverage,90);});
test('absent previous issue becomes unverified and cannot be silently resolved',()=>{const p=report();p.assessment.issues=[issue(p)];const r=report('report_002','2026-11-02T18:00:00+02:00');r.assessment.previousReportId=p.id;const x=A.assessment(r,p);assert.equal(x.counts.unverified,1);assert.equal(x.counts.resolved,0);assert.equal(x.coverage,90);assert.equal(x.delta,null);});
test('resolution requires current evidence, linked previous report, same zone and comparison verification',()=>{const p=report();p.assessment.issues=[issue(p)];const r=report('report_002','2026-11-02T18:00:00+02:00');r.assessment.previousReportId=p.id;r.assessment.issues=[issue(r,{status:'resolved'})];assert.equal(A.assessment(r,p).counts.resolved,0);r.assessment.issues[0].comparisonVerified=true;const x=A.assessment(r,p);assert.equal(x.counts.resolved,1);assert.equal(x.delta,3);assert.equal(A.assessment(r).counts.resolved,0);});
test('persistent issue does not accumulate deductions across reports',()=>{const p=report();p.assessment.issues=[issue(p)];const r=report('report_002','2026-11-02T18:00:00+02:00');r.assessment.previousReportId=p.id;r.assessment.issues=[issue(r,{status:'ongoing'})];const x=A.assessment(r,p);assert.equal(x.score,97);assert.equal(x.counts.ongoing,1);assert.equal(x.delta,0);});
test('different evaluated regions cannot produce a numeric improvement',()=>{const p=report();const r=report('report_002');r.assessment.previousReportId=p.id;r.assessment.checks[8].assessed=false;assert.equal(A.assessment(r,p).delta,null);});
test('score remains bounded under many distinct issues',()=>{const r=report();r.assessment.issues=Array.from({length:20},(_,i)=>issue(r,{id:'issue_'+i,severity:'major'}));const x=A.assessment(r);assert.equal(x.score,90);assert.equal(x.categories.find(c=>c.id==='diapers').points,0);});
test('closing window and revisions sort by actual end, not filename or generation time',()=>{const a=report('night','2026-11-03T01:00:00+02:00'),b=report('noon');b.generatedAt='2026-11-04T00:00:00Z';assert.equal(A.sortReports([b,a])[0].id,'night');assert(A.title(a).includes('من'));assert(A.timestamp(a.generatedAt).includes('مصر'));});
test('comparisons remain valid through a resolved-issue report chain',()=>{const a=report('r_00001');a.assessment.issues=[issue(a)];const b=report('r_00002','2026-11-02T18:00:00+02:00');b.assessment.previousReportId=a.id;b.assessment.issues=[issue(b,{status:'resolved',comparisonVerified:true})];const c=report('r_00003','2026-11-03T01:00:00+02:00');c.assessment.previousReportId=b.id;const out=A.assessReports([a,c,b]);assert.equal(out[0].result.delta,0);assert.equal(out[1].result.delta,3);});
test('home renderer escapes stored report content and has a safe legacy state',()=>{
  const html=fs.readFileSync(require('path').join(__dirname,'../index.html'),'utf8');
  const code=html.slice(html.indexOf('function appearanceHomeHtml('),html.indexOf('function camSnapNow('));
  const c=vm.createContext({CameraAssessment:A,esc:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')});vm.runInContext(code,c);
  assert(c.appearanceHomeHtml([]).includes('لسه مفيش تقرير'));
  const r=report();r.range='<img onerror=evil>';r.assessment.issues=[issue(r,{title:'<script>evil()</script>'})];const rendered=c.appearanceHomeHtml([r]);assert(!rendered.includes('<script>'));assert(rendered.includes('&lt;script&gt;'));assert(rendered.includes('97'));
  const legacy=c.appearanceHomeHtml([{id:'legacy',label:'قديم'}]);assert(legacy.includes('مفيش درجة افتراضية'));
});
console.log(tests,'appearance checks passed');
