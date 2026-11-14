const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const TOK='t'.repeat(40),URL_='https://nova.example/api/v1/webhooks/whatsapp-bridge';
function make(props){
  const P=Object.assign({},props),cache={},fetches=[],state={throwUrl:false,waSent:0};
  const sb={console,Logger:{log(){}},
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>k in P?P[k]:null,setProperty:(k,v)=>{P[k]=String(v);},deleteProperty:k=>{delete P[k];},getProperties:()=>Object.assign({},P)}),getUserProperties:()=>({getProperty:()=>null,setProperty(){}})},
    CacheService:{getScriptCache:()=>({get:k=>k in cache?cache[k]:null,put:(k,v)=>{cache[k]=String(v);},remove:k=>{delete cache[k];}})},
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
    ContentService:{createTextOutput:t=>({t,setMimeType(){return {getContent:()=>t};},getContent:()=>t}),MimeType:{JSON:'json'}},
    Utilities:{formatDate:()=>'01-01 00:00',sleep(){}},
    UrlFetchApp:{fetch(u,o){
      fetches.push({u,o});
      if(u===URL_&&state.throwUrl)throw new Error('boom');
      if(/graph\.facebook\.com/.test(u)){state.waSent++;return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({messages:[{id:'wamid.OUT'+state.waSent}]})};}
      return {getResponseCode:()=>200,getContentText:()=>'{}'};}}};
  vm.createContext(sb);vm.runInContext(fs.readFileSync('server/Code.js','utf8'),sb);
  // isolate from sheets/AI: stub the downstream handler and wa token/ids
  sb.handled=[];
  sb.handleCustomerMessage=(chatId,msg)=>{ // mirrors real handler: reply only if bot not held
    sb.handled.push(chatId);
    if(!sb.holdOn_(chatId)) sb.waSend_(chatId,'auto reply');
  };
  sb.waToken_=()=>'wa-token';sb.waPhoneId_=()=>'PNID';sb.waTarget_=id=>({to:String(id).replace(/^wa_/,'')});
  sb.saveCustomerPhone_=()=>{};sb.canonicalEgyptPhone_=p=>p;sb.noteBadChatId_=()=>{};sb.badChatId_=()=>false;
  return {sb,P,cache,fetches,state};
}
const hook=(id,over)=>({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'PNID'},contacts:[{wa_id:'201001112222',profile:{name:'Sara'}}],messages:[Object.assign({id,from:'201001112222',timestamp:'1760000000',type:'text',text:{body:'hello'}},over)]}}]}]});
const novaCalls=f=>f.filter(x=>x.u===URL_);
const waCalls=f=>f.filter(x=>/graph\.facebook\.com/.test(x.u));
// (a) unset -> no fetch to NOVA, bot behaves as today
let t=make({});t.sb.doPost({postData:{contents:JSON.stringify(hook('wamid.A1'))}});
assert.equal(novaCalls(t.fetches).length,0);assert.equal(t.sb.handled.length,1);assert.equal(waCalls(t.fetches).length,1);
t=make({NOVA_WA_BRIDGE_URL:URL_,NOVA_WA_BRIDGE_TOKEN:'short'});t.sb.doPost({postData:{contents:JSON.stringify(hook('wamid.A2'))}});assert.equal(novaCalls(t.fetches).length,0);
// (b) correct URL/header/payload; inbound + outbound
t=make({NOVA_WA_BRIDGE_URL:URL_,NOVA_WA_BRIDGE_TOKEN:TOK});t.sb.doPost({postData:{contents:JSON.stringify(hook('wamid.B1'))}});
let nc=novaCalls(t.fetches);assert.equal(nc.length,2);
assert.equal(nc[0].o.method,'post');assert.equal(nc[0].o.headers.Authorization,'Bearer '+TOK);assert.equal(nc[0].o.contentType,'application/json');assert.equal(nc[0].o.muteHttpExceptions,true);
// inbound forward runs AFTER the reply (waOne_) so NOVA latency never delays the customer
assert.equal(JSON.parse(nc[0].o.payload).messages[0].direction,'out');assert.equal(JSON.parse(nc[1].o.payload).messages[0].direction,'in');
let b=JSON.parse(nc[1].o.payload);assert.equal(b.source,'pharmacy-bot');assert.equal(b.v,1);assert.equal(b.messages.length,1);
assert.deepEqual(b.messages[0],{id:'wamid.B1',from:'201001112222',timestamp:'1760000000',type:'text',text:'hello',media_id:null,filename:null,name:'Sara',phone_number_id:'PNID',direction:'in'});
let o=JSON.parse(nc[0].o.payload).messages[0];assert.equal(o.direction,'out');assert.equal(o.text,'auto reply');assert.equal(o.from,'201001112222');assert.equal(o.id,'wamid.OUT1');assert.equal(o.phone_number_id,'PNID');
// media message
t=make({NOVA_WA_BRIDGE_URL:URL_,NOVA_WA_BRIDGE_TOKEN:TOK});t.sb.doPost({postData:{contents:JSON.stringify(hook('wamid.B2',{type:'document',text:undefined,document:{id:'MID1',filename:'rx.pdf',mime_type:'application/pdf',caption:'cap'}}))}});
b=JSON.parse(novaCalls(t.fetches).find(x=>JSON.parse(x.o.payload).messages[0].direction==='in').o.payload).messages[0];assert.equal(b.media_id,'MID1');assert.equal(b.filename,'rx.pdf');assert.equal(b.text,'cap');assert.equal(b.type,'document');
// inbound forward still runs (in a finally) when the handler throws
t=make({NOVA_WA_BRIDGE_URL:URL_,NOVA_WA_BRIDGE_TOKEN:TOK});t.sb.handleCustomerMessage=()=>{throw new Error('boom');};
assert.doesNotThrow(()=>t.sb.doPost({postData:{contents:JSON.stringify(hook('wamid.T1'))}}));
nc=novaCalls(t.fetches);assert.equal(nc.length,1);assert.equal(JSON.parse(nc[0].o.payload).messages[0].direction,'in');
// (c) fetch throwing: no throw, reply still sent
t=make({NOVA_WA_BRIDGE_URL:URL_,NOVA_WA_BRIDGE_TOKEN:TOK});t.state.throwUrl=true;
assert.doesNotThrow(()=>t.sb.doPost({postData:{contents:JSON.stringify(hook('wamid.C1'))}}));
assert.equal(t.sb.handled.length,1);assert.equal(waCalls(t.fetches).length,1);
// (d) dedupe on Meta retry
t=make({NOVA_WA_BRIDGE_URL:URL_,NOVA_WA_BRIDGE_TOKEN:TOK});
t.sb.doPost({postData:{contents:JSON.stringify(hook('wamid.D1'))}});const n1=novaCalls(t.fetches).length;
t.sb.doPost({postData:{contents:JSON.stringify(hook('wamid.D1'))}});assert.equal(novaCalls(t.fetches).length,n1);
// (e) BOT_AUTO_REPLY=0: forwarded, handler still invoked (logging), no auto reply
t=make({NOVA_WA_BRIDGE_URL:URL_,NOVA_WA_BRIDGE_TOKEN:TOK,BOT_AUTO_REPLY:'0'});t.sb.doPost({postData:{contents:JSON.stringify(hook('wamid.E1'))}});
nc=novaCalls(t.fetches);assert.equal(nc.length,1);assert.equal(JSON.parse(nc[0].o.payload).messages[0].direction,'in');
assert.equal(t.sb.handled.length,1);assert.equal(waCalls(t.fetches).length,0);
// manual staff reply still works with switch off
let r=t.sb.waSend_('wa_201001112222','👨‍⚕️ رد الصيدلي:\n\nhi');assert.equal(r.ok,true);assert.equal(waCalls(t.fetches).length,1);
// any other value = on
t=make({BOT_AUTO_REPLY:'1'});t.sb.doPost({postData:{contents:JSON.stringify(hook('wamid.E2'))}});assert.equal(waCalls(t.fetches).length,1);
// (f) autoReply get/set
t=make({NOVA_WA_BRIDGE_TOKEN:TOK});const call=d=>t.sb.doPost({postData:{contents:JSON.stringify(Object.assign({action:'novaWhatsAppBridge'},d))}});
const unwrap=x=>JSON.parse(x.getContent());
let res=unwrap(call({operation:'autoReplyGet'}));assert.equal(res.ok,false);assert.equal(res.error,'unauthorized');
res=unwrap(call({bridgeToken:'x'.repeat(40),operation:'autoReplySet',enabled:false}));assert.equal(res.ok,false);assert.equal(t.P.BOT_AUTO_REPLY,undefined);
res=unwrap(call({bridgeToken:TOK,operation:'autoReplyGet'}));assert.deepEqual(res,{ok:true,autoReply:true});
res=unwrap(call({bridgeToken:TOK,operation:'autoReplySet',enabled:false}));assert.deepEqual(res,{ok:true,autoReply:false});assert.equal(t.P.BOT_AUTO_REPLY,'0');
res=unwrap(call({bridgeToken:TOK,operation:'autoReplyGet'}));assert.deepEqual(res,{ok:true,autoReply:false});
res=unwrap(call({bridgeToken:TOK,operation:'autoReplySet',enabled:true}));assert.deepEqual(res,{ok:true,autoReply:true});
res=unwrap(call({bridgeToken:TOK,operation:'autoReplySet',enabled:'no'}));assert.equal(res.ok,false);
console.log('PASS nova wa forward: unset no-op, payload/auth, fetch failure, dedupe, auto-reply off, autoReply get/set');
