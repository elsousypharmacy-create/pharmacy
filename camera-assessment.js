/* Shared, deterministic appearance rubric. No API calls or example data. */
(function(root){
  'use strict';
  var VERSION = 'appearance-v1';
  var CATEGORIES = [
    {id:'cleanliness',label:'النظافة: الأرض والأسطح والزجاج',weight:25},
    {id:'counter',label:'ترتيب الكاونتر والمكتب',weight:25},
    {id:'access',label:'خلو المدخل والممرات',weight:20},
    {id:'medicines',label:'رصّ الأدوية · كاميرا 2',weight:10},
    {id:'diapers',label:'رصّ الحفاضات · كاميرا 2',weight:10},
    {id:'condition',label:'حالة المكان والعرض',weight:10}
  ];
  var ZONES = [
    {id:'floor_inside',category:'cleanliness',weight:10,cameras:[3,4]},
    {id:'entrance_clean',category:'cleanliness',weight:8,cameras:[1,4,6]},
    {id:'surfaces',category:'cleanliness',weight:7,cameras:[3,4]},
    {id:'counter_service',category:'counter',weight:15,cameras:[3,4]},
    {id:'desk',category:'counter',weight:10,cameras:[3]},
    {id:'entrance_access',category:'access',weight:10,cameras:[1,4,6]},
    {id:'aisles',category:'access',weight:10,cameras:[2,4]},
    {id:'medicine_facing',category:'medicines',weight:10,cameras:[2]},
    {id:'diaper_facing',category:'diapers',weight:10,cameras:[2]},
    {id:'fixtures_display',category:'condition',weight:10,cameras:[1,2,3,4,6]}
  ];
  var COST = {minor:1,moderate:3,major:5};
  function instant(value){
    if(typeof value!=='string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value))return NaN;
    return Date.parse(value);
  }
  function clock(value){
    var t=instant(value);if(!Number.isFinite(t))return '';
    return new Intl.DateTimeFormat('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(t));
  }
  function timestamp(value){
    var t=instant(value);if(!Number.isFinite(t))return '';
    return new Intl.DateTimeFormat('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(t))+' · توقيت مصر';
  }
  function title(report){
    if(!report)return 'تقارير الكاميرات';
    if(Number.isFinite(instant(report.windowStart)) && Number.isFinite(instant(report.windowEnd)))return 'من '+clock(report.windowStart)+' إلى '+clock(report.windowEnd);
    return String(report.range || report.label || report.time || 'تقرير الكاميرات');
  }
  function orderTime(r){
    var end=instant(r.windowEnd);if(Number.isFinite(end))return end;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(r.date || '') || !/^([01]\d|2[0-3])[0-5]\d$/.test(r.time || ''))return 0;
    // Infer Cairo's offset for historical reports without ISO window timestamps.
    var n=Date.parse(r.date+'T'+r.time.slice(0,2)+':'+r.time.slice(2)+':00Z');
    try {
      var p={};new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(n)).forEach(function(x){p[x.type]=x.value;});
      return n-(Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute)-n);
    } catch(e){return n;}
  }
  function sortReports(reports){
    return (Array.isArray(reports)?reports:[]).filter(function(r){return r && typeof r==='object';}).slice().sort(function(a,b){
      return orderTime(b)-orderTime(a) || (instant(b.generatedAt)||0)-(instant(a.generatedAt)||0);
    });
  }
  function assessment(r,previous,previousResult){
    var a=r && r.assessment, end=instant(r && r.windowEnd), start=instant(r && r.windowStart);
    var empty={ready:false,score:null,coverage:0,assessedZones:0,totalZones:ZONES.length,categories:[],issues:[],counts:{new:0,ongoing:0,resolved:0,unverified:0},delta:null,comparable:false};
    if(!a || a.rubric!==VERSION || !Array.isArray(a.checks) || !Array.isArray(a.issues) || !Number.isFinite(start) || !Number.isFinite(end) || end<=start)return empty;
    var frames={};(Array.isArray(r.reviewedFrames)?r.reviewedFrames:[]).forEach(function(f){
      if(f && /^[\w-]{6,200}$/.test(f.file || '') && Number.isFinite(instant(f.at)))frames[f.file]=f;
    });
    function evidence(ids,zone){
      return (Array.isArray(ids)?ids:[]).filter(function(id){
        var f=frames[id], t=f && instant(f.at);
        return f && zone.cameras.indexOf(Number(f.ch))>=0 && t>=start && t<end && t>=end-90*60000;
      });
    }
    var zones={}, checks={}, prior={}, issues=[], seen={}, penalties={};
    ZONES.forEach(function(z){zones[z.id]=z;});
    a.checks.forEach(function(c){if(c && zones[c.id]){if(Object.prototype.hasOwnProperty.call(checks,c.id))checks[c.id]=null;else checks[c.id]=c;}});
    var pa=previous && previous.assessment;
    var linked=!!(previous && previous.id && a.previousReportId===previous.id && pa && pa.rubric===VERSION && orderTime(previous)<orderTime(r));
    if(linked)(Array.isArray(pa.issues)?pa.issues:[]).forEach(function(i){if(i && i.id && zones[i.zone] && i.status!=='resolved')prior[i.id]=i;});
    a.issues.forEach(function(i){
      if(!i || !/^[\w-]{1,100}$/.test(i.id || '') || !zones[i.zone] || !i.title)return;
      // Duplicate IDs cannot produce multiple deductions or contradictory states.
      if(seen[i.id])return;seen[i.id]=true;
      var z=zones[i.zone], refs=evidence(i.evidence,z), old=prior[i.id];
      var status='unverified';
      if(i.status==='resolved'){
        if(old && old.zone===i.zone && i.confidence==='high' && refs.length && i.comparisonVerified===true)status='resolved';
      } else if(i.status!=='unverified' && i.confidence==='high' && refs.length && COST[i.severity] && (!old || old.zone===i.zone))status=old?'ongoing':'new';
      issues.push({id:i.id,zone:i.zone,title:String(i.title),status:status,severity:i.severity,evidence:refs,frames:refs.map(function(id){return frames[id];}),reason:String(i.reason || '')});
      if(status==='new' || status==='ongoing')penalties[i.zone]=(penalties[i.zone]||0)+COST[i.severity];
    });
    // A missing old problem is unverified, NEVER silently resolved.
    Object.keys(prior).forEach(function(id){if(!seen[id])issues.push({id:id,zone:prior[id].zone,title:String(prior[id].title || 'ملاحظة سابقة'),status:'unverified',evidence:[],frames:[],reason:'لم يُرفق دليل واضح على الحالة الحالية'});});
    var blocked={};issues.forEach(function(i){if(i.status==='unverified')blocked[i.zone]=true;});
    var weight=0, points=0, evaluated=[], categories=CATEGORIES.map(function(cat){return {id:cat.id,label:cat.label,total:cat.weight,max:0,points:0};});
    ZONES.forEach(function(z){
      var c=checks[z.id], valid=!!(c && c.assessed===true && !blocked[z.id] && evidence(c.evidence,z).length);
      if(!valid)return;
      var score=Math.max(0,z.weight-(penalties[z.id]||0));
      evaluated.push(z.id);weight+=z.weight;points+=score;
      var category=categories.filter(function(x){return x.id===z.category;})[0];category.max+=z.weight;category.points+=score;
    });
    var out={ready:weight>0,score:weight?Math.round(points/weight*100):null,coverage:weight,assessedZones:evaluated.length,totalZones:ZONES.length,categories:categories,issues:issues,counts:{new:0,ongoing:0,resolved:0,unverified:0},delta:null,comparable:false,evaluated:evaluated,points:points,max:weight};
    issues.forEach(function(i){out.counts[i.status]++;});
    if(out.ready && linked){
      var oldScore=previousResult || assessment(previous,null);
      out.comparable=oldScore.ready && JSON.stringify(evaluated)===JSON.stringify(oldScore.evaluated);
      if(out.comparable)out.delta=out.score-oldScore.score;
    }
    return out;
  }
  function assessReports(reports){
    var ordered=sortReports(reports), ids=new Map(), results=new Map();
    ordered.forEach(function(r){if(r.id && !ids.has(r.id))ids.set(r.id,r);});
    function evaluate(r){
      if(results.has(r))return results.get(r);
      var prior=r.assessment && ids.get(r.assessment.previousReportId);
      if(!prior || orderTime(prior)>=orderTime(r))prior=null;
      var result=assessment(r,prior,prior?evaluate(prior):null);results.set(r,result);return result;
    }
    return ordered.map(function(r){return {report:r,result:evaluate(r)};});
  }
  var api={version:VERSION,categories:CATEGORIES,zones:ZONES,title:title,clock:clock,timestamp:timestamp,sortReports:sortReports,assessment:assessment,assessReports:assessReports};
  if(typeof module==='object' && module.exports)module.exports=api;
  if(root)root.CameraAssessment=api;
})(typeof window==='object'?window:null);
