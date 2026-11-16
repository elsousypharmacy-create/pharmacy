import {chromium} from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const data=JSON.parse(fs.readFileSync('nova-status.json','utf8'));
// The Home tile shows the owner of the running task. Derive the expected owner from the same data and
// logic instead of hard-coding a name that changes whenever tasks are reassigned.
const expectedOwner=createRequire(import.meta.url)('../nova-home-progress.js').summarize(data,Date.parse(data.updatedAt)).owner;
/* task owners change whenever work is reassigned: derive the owner under test from the data instead of hard-coding one */
const allTasks=data.roadmap.flatMap(p=>p.tasks),own=allTasks.find(t=>t.id==='FND-03').owner,ownCount=allTasks.filter(t=>t.owner===own).length;
const browser=await chromium.launch();
fs.mkdirSync('reports/nova-monitor',{recursive:true});
try{
 const context=await browser.newContext({viewport:{width:390,height:844}});
 let offline=false,fixture=structuredClone(data);
 await context.route('**/nova-status.json',route=>offline?route.abort():route.fulfill({json:fixture}));
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto('http://127.0.0.1:8768/nova-monitor.html');await page.locator('#roadmap details').first().waitFor({state:'attached'});/* the roadmap redesign renders each phase inside a collapsed <details>: open them all so the items are visible */const openAll=()=>page.evaluate(()=>document.querySelectorAll('#roadmap details').forEach(d=>{d.open=true}));await openAll();await page.locator('#roadmap .item').last().waitFor();
 assert.equal(await page.locator('#roadmap .item').count(),85);assert(await page.locator('[data-task-id="FND-03"]').isVisible());
 assert((await page.locator('[data-task-id="FND-03"]').innerText()).includes(own));
 assert((await page.locator('[data-task-id="FND-03"]').innerText()).includes('قبول: 0%'));
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'phone has no horizontal overflow');
 await page.locator('#agentFilter').selectOption(own);assert.equal(await page.locator('#roadmap .item').count(),ownCount);
 await page.locator('#filter').selectOption('queued');assert.equal(await page.locator('#roadmap .item').count(),data.roadmap.flatMap(p=>p.tasks).filter(t=>t.owner===own&&t.status==='queued').length);
 await page.locator('#agentFilter').selectOption('all');await page.locator('#filter').selectOption('for_review');assert.equal(await page.locator('#roadmap .item').count(),data.roadmap.flatMap(p=>p.tasks).filter(t=>t.status==='for_review').length);
 await page.locator('#search').fill('POS-03');{/* search also matches tasks that mention POS-03 (dependencies, notes): the task itself must be there and the list must be narrowed */const n=await page.locator('#roadmap .item').count();assert(n>=1&&n<allTasks.length,'search narrows the list');assert(await page.locator('[data-task-id="POS-03"]').isVisible());}
 await page.locator('#search').fill('');await page.locator('#filter').selectOption('all');
 await page.screenshot({path:'reports/nova-monitor/phone.png'});
 await page.setViewportSize({width:1280,height:800});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'reports/nova-monitor/tablet.png'});
 const task=fixture.roadmap[0].tasks[0];task.status='verified';task.evidence=[{url:'https://github.com/example/repo/commit/test'}];task.verifiedAt=new Date().toISOString();task.verification={reviewer:'fixture-reviewer',result:'pass'};
 fixture.updatedAt='2020-01-01T00:00:00Z';await page.locator('#reload').click();await page.locator('[data-task-id="FND-01"] .status-verified').waitFor();assert((await page.locator('[data-task-id="FND-01"]').innerText()).includes('قبول: 100%'));assert.equal(await page.locator('#updated').getAttribute('class'),'stale');
 fixture.updatedAt=new Date().toISOString();await page.locator('#reload').click();await page.waitForFunction(()=>!document.getElementById('reload').disabled);assert.equal(await page.locator('#updated').getAttribute('class'),'');
 offline=true;await page.locator('#reload').click();await page.getByText(/تعذر تحميل الخطة/).waitFor();await openAll();assert.equal(await page.locator('#roadmap .item').count(),85,'offline retains last data');offline=false;fixture=data;
 await page.goto('http://127.0.0.1:8768/tools/fixtures/home-viewport.html');await page.locator('iframe').last().waitFor();
 const frames=page.frames().slice(1);assert.equal(frames.length,6);
 for(let i=0;i<frames.length;i++){
  const frame=frames[i];await frame.addScriptTag({path:'nova-home-progress.js'});await frame.locator('[data-nova-percent]').waitFor();await frame.waitForFunction(()=>document.querySelector('[data-nova-percent]').textContent.includes('0%'));
  const result=await frame.evaluate(()=>{const tile=document.querySelector('.home-nova-shortcut'),r=tile.getBoundingClientRect();return {width:innerWidth,height:innerHeight,left:r.left,right:r.right,top:r.top,bottom:r.bottom,scroll:document.documentElement.scrollWidth,text:tile.innerText};});
  assert(result.left>=-1&&result.right<=result.width+1,JSON.stringify(result));assert(result.top>=0&&result.bottom<=result.height,JSON.stringify(result));assert(result.scroll<=result.width+1,JSON.stringify(result));assert(result.text.includes(expectedOwner||'معتمد'),JSON.stringify({expectedOwner,...result}));
  await page.locator('iframe').nth(i).screenshot({path:'reports/nova-monitor/home-'+i+'.png'});
 }
 assert.deepEqual(errors,[]);
 console.log('PASS NOVA monitor: 85 visible titles, agent/state/search, accepted vs review, 0/100, stale/fresh/offline, phone/tablet, six Home viewport tiles');
}finally{await browser.close();}
