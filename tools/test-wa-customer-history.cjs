// NOVA bridge op customerHistory: token-gated, read-only, phone from the chat id, trimmed output. Run: node tools/test-wa-customer-history.cjs
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const TOK='t'.repeat(40);
const P={NOVA_WA_BRIDGE_TOKEN:TOK},cache={},calls=[];
const sb={console,Logger:{log(){}},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>k in P?P[k]:null,setProperty:(k,v)=>{P[k]=String(v)},deleteProperty:k=>{delete P[k]},getProperties:()=>Object.assign({},P)}),getUserProperties:()=>({getProperty:()=>null,setProperty(){}})},
  CacheService:{getScriptCache:()=>({get:k=>k in cache?cache[k]:null,put:(k,v)=>{cache[k]=String(v)},remove:k=>{delete cache[k]}})},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
  ContentService:{createTextOutput:t=>({t,setMimeType(){return {getContent:()=>t}},getContent:()=>t}),MimeType:{JSON:'json'}},
  Utilities:{formatDate:()=>'x',sleep(){},base64Encode:()=>''},UrlFetchApp:{fetch(){throw new Error('no network in test')}}};
vm.createContext(sb);vm.runInContext(fs.readFileSync('server/Code.js','utf8'),sb);
let mode='ok',ptsMode='ok';const pcalls=[];
sb.custPoints_=(ph)=>{pcalls.push(ph);if(ptsMode==='err')throw new Error('sheet down');return {ok:true,total_points:42,history:[{invoiceid:'1234',points:7},{invoiceid:'999',points:3}]}};
sb.getCustomerHistoryFast_=(ph)=>{calls.push(ph);if(mode==='err')return {ok:false,error:'boom'};return {ok:true,phone:'01001112222',purchases:[{date:'2026-11-10',invoice:'1234',total:150.5,items:[{name:'بنادول',qty:2,price:30,junk:1},{name:'فيتامين',qty:1,price:90.5}],discount:5,secret:'x'}],debt:{net:40,daysSincePaid:3},scannedDays:12,partial:false,extra:'x'}};
const call=d=>JSON.parse(sb.doPost({postData:{contents:JSON.stringify(Object.assign({action:'novaWhatsAppBridge',operation:'customerHistory'},d))}}).getContent());
let r=call({chatId:'wa_201001112222'});assert.deepEqual([r.ok,r.error],[false,'unauthorized']);assert.equal(calls.length,0);
r=call({bridgeToken:'x'.repeat(40),chatId:'wa_201001112222'});assert.equal(r.ok,false);assert.equal(calls.length,0);
r=call({bridgeToken:TOK,chatId:'wa_abc'});assert.equal(r.ok,false);assert.equal(calls.length,0);   // no phone in the id (username chat)
r=call({bridgeToken:TOK,chatId:'bad id'});assert.equal(r.ok,false);assert.equal(calls.length,0);
r=call({bridgeToken:TOK,chatId:'wa_201001112222'});
assert.equal(r.ok,true);assert.deepEqual(calls,['+201001112222']);
assert.deepEqual(r.purchases,[{date:'2026-11-10',invoice:'1234',total:150.5,discount:5,items:[{name:'بنادول',qty:2,price:30},{name:'فيتامين',qty:1,price:90.5}],points:7}]);
assert.deepEqual(r.points,{total:42});assert.deepEqual(pcalls,['01001112222']);
assert.deepEqual(r.debt,{net:40});assert.equal(r.partial,false);assert.equal(r.secret,undefined);assert.equal(r.extra,undefined);
ptsMode='err';mode='ok';r=call({bridgeToken:TOK,chatId:'wa_201001112222'});assert.equal(r.ok,true);assert.equal(r.points,null);assert.equal(r.purchases[0].points,undefined);   // points sheet down: history still answers
mode='err';r=call({bridgeToken:TOK,chatId:'wa_201001112222'});assert.deepEqual([r.ok,r.error],[false,'boom']);
console.log('PASS wa customer history');
