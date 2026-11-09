const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(process.argv[2]||'nova-monitor.html','utf8'),d=JSON.parse(fs.readFileSync(process.argv[3]||'nova-status.json','utf8'));
const js=html.match(/<script>([\s\S]*?)<\/script>/)[1];new vm.Script(js);
const ctx={URL,Date};vm.createContext(ctx);vm.runInContext(js.slice(js.indexOf('function safeUrl'),js.indexOf('function link'))+js.slice(js.indexOf('function accepted'),js.indexOf('function bar')),ctx);
const t={status:'verified',weight:1,evidence:[{url:'https://github.com/owner/repo/commit/123'}],verifiedAt:'2026-11-09T12:00:00Z',verification:{reviewer:'ChatGPT',result:'pass'}};
assert.equal(ctx.score([]).percent,null);assert.equal(ctx.score([{weight:2,tasks:[{status:'queued'}]}]).percent,0);assert.equal(ctx.score([{weight:2,tasks:[t]}]).percent,100);
for(const bad of [{...t,evidence:[]},{...t,verifiedAt:null},{...t,verification:{reviewer:'Claude',result:'fail'}},{...t,status:'done'},{...t,evidence:[{url:'javascript:alert(1)'}]}])assert.equal(ctx.accepted(bad),false);
assert.equal(ctx.score([{weight:1,tasks:[t]},{weight:3,tasks:[{status:'queued'}]}]).percent,25);
const ids=d.roadmap.flatMap(p=>p.tasks.map(t=>t.id));assert.equal(ids.length,new Set(ids).size);assert.equal(ids.length,85);assert.equal(d.roadmap.length,17);
const seen=new Set();for(const p of d.roadmap){assert(p.weight>0);for(const dep of p.dependencies)assert(seen.has(dep),dep);seen.add(p.id);for(const t of p.tasks){assert(t.acceptance.length>50);assert(t.owner&&t.reviewer);}}
assert.equal(ctx.score(d.roadmap).verified,0);assert.equal(ctx.score(d.roadmap).review,10);
console.log('PASS: roadmap schema, 85 unique tasks, dependency order, JS syntax, unknown/0/100/weighted/incomplete-evidence cases');
