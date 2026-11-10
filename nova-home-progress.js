(function () {
  'use strict';
  function accepted(t) {
    return t.status === 'verified' && Array.isArray(t.evidence) && t.evidence.some(function(e){try{return new URL(e.url).protocol === 'https:';}catch(x){return false;}}) && Number.isFinite(Date.parse(t.verifiedAt)) && t.verification && t.verification.result === 'pass' && !!t.verification.reviewer;
  }
  function summarize(data, now) {
    var phases = data && Array.isArray(data.roadmap) ? data.roadmap : [], tasks = [], weight = 0, earned = 0;
    phases.forEach(function(p){var rows=p.tasks||[],den=0,num=0;rows.forEach(function(t){var w=Number(t.weight)||1;den+=w;if(accepted(t))num+=w;tasks.push(t);});var w=Number(p.weight)||0;weight+=w;earned+=den?w*num/den:0;});
    var active=tasks.filter(function(t){return t.status==='in_progress';}),review=tasks.filter(function(t){return t.status==='for_review';});
    var running=active.find(function(t){return t.assignment&&t.assignment.state==='running';})||active[0];
    var stamp=Date.parse(data&&data.updatedAt);
    return {percent:weight?Math.round(earned/weight*1000)/10:null,total:tasks.length,verified:tasks.filter(accepted).length,active:active.length,review:review.length,owner:running?running.owner:'',current:running?running.title+' • '+running.owner:review.length?'المهام الجاهزة للمراجعة: '+review.length:'لا توجد مهمة قيد التنفيذ',stale:!Number.isFinite(stamp)||(now||Date.now())-stamp>48*3600e3};
  }
  if (typeof module === 'object' && module.exports) {module.exports={accepted:accepted,summarize:summarize};return;}
  var data=null,offline=false,pending=false,scheduled=false;
  function paint(){
    var s=summarize(data,Date.now());
    document.querySelectorAll('.home-nova-shortcut').forEach(function(tile){
      var small=tile.querySelector('small'),badge=tile.querySelector('[data-nova-percent]');
      var text=data?s.current+(offline?' • آخر بيانات محفوظة':s.stale?' • يحتاج تحديث':''):'عناوين المهام والمسؤولون والحالات';
      if(small&&small.textContent!==text)small.textContent=text;
      if(!badge){badge=document.createElement('span');badge.dataset.novaPercent='';badge.className='home-nova-percent';tile.insertBefore(badge,tile.lastElementChild);}
      var value=s.percent===null?'النسبة غير متاحة':s.percent+'% معتمد'+(s.owner?' • '+s.owner:'');if(badge.textContent!==value)badge.textContent=value;
      var label='NOVA Rx — '+value+' — '+s.current+' — '+s.verified+' من '+s.total+' تم التحقق • '+s.active+' قيد التنفيذ • '+s.review+' للمراجعة'+(offline?' • تعذر التحديث':s.stale?' • البيانات قديمة':'');
      if(tile.getAttribute('aria-label')!==label)tile.setAttribute('aria-label',label);tile.title=label;
    });
  }
  async function refresh(){if(pending||document.hidden)return;pending=true;try{var r=await fetch('./nova-status.json',{cache:'no-store'});if(!r.ok)throw Error('http');var next=await r.json();if(!next||!Array.isArray(next.roadmap))throw Error('schema');data=next;offline=false;}catch(e){offline=true;}finally{pending=false;paint();}}
  function start(){paint();refresh();new MutationObserver(function(){if(scheduled)return;scheduled=true;requestAnimationFrame(function(){scheduled=false;paint();});}).observe(document.body,{childList:true,subtree:true});setInterval(refresh,60000);document.addEventListener('visibilitychange',function(){if(!document.hidden)refresh();});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
