const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const TOK='k'.repeat(48);
function make(props){
  const P=Object.assign({},props),sets=[];
  const sb={console,Logger:{log(){}},
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>k in P?P[k]:null,setProperty:(k,v)=>{sets.push(k);P[k]=String(v);}})},
    CacheService:{getScriptCache:()=>({get:()=>null,put(){},remove(){}})},
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
    ContentService:{createTextOutput:t=>({t,setMimeType(){return {getContent:()=>t};},getContent:()=>t}),MimeType:{JSON:'json'}},
    Utilities:{DigestAlgorithm:{SHA_256:'SHA_256'},Charset:{UTF_8:'UTF_8'},formatDate:()=>'',sleep(){},
      computeDigest:(a,s)=>Array.from(crypto.createHash('sha256').update(s,'utf8').digest()).map(b=>b>127?b-256:b)}};
  vm.createContext(sb);vm.runInContext(fs.readFileSync('server/Code.js','utf8'),sb);
  vm.runInContext("NOVA_WA_BRIDGE_TOKEN_SHA256='"+crypto.createHash('sha256').update(TOK).digest('hex')+"'",sb);
  const call=d=>JSON.parse(sb.doPost({postData:{contents:JSON.stringify(d)}}).getContent());
  return {sb,P,sets,call};
}
const A='novaBridgeConfig';
let t=make({OTHER:'x'});
for(const body of [{action:A,token:'z'.repeat(48)},{action:A,token:'short'},{action:A},{action:A,token:12345}]){
  assert.deepEqual(t.call(body),{ok:false,error:'unauthorized'});}
assert.equal(t.sets.length,0);
let r=t.call({action:A,token:TOK,check:true});
assert.deepEqual(r,{ok:true,applied:false,urlSet:false,tokenSet:false});assert.equal(t.sets.length,0);
r=t.call({action:A,token:TOK});
assert.deepEqual(r,{ok:true,applied:true,urlSet:true,tokenSet:true});
assert.deepEqual(t.sets.sort(),['NOVA_WA_BRIDGE_TOKEN','NOVA_WA_BRIDGE_URL']);
assert.equal(t.P.OTHER,'x');assert.equal(Object.keys(t.P).length,3);
assert.equal(t.P.NOVA_WA_BRIDGE_URL,'https://nova-rx-api-staging.elsousypharmacy.workers.dev/api/v1/webhooks/whatsapp-bridge');
assert.ok(!JSON.stringify(r).includes(TOK));
// URL from request ignored
t=make({});t.call({action:A,token:TOK,url:'https://evil.example'});assert.notEqual(t.P.NOVA_WA_BRIDGE_URL,'https://evil.example');
// bridge works after config
const g=t.call({action:'novaWhatsAppBridge',bridgeToken:TOK,operation:'autoReplyGet'});assert.equal(g.ok,true);
// error path leaks nothing
t=make({});t.sb.Utilities.computeDigest=()=>{throw new Error(TOK);};
r=t.call({action:A,token:TOK});assert.deepEqual(r,{ok:false,error:'config failed'});
console.log('PASS nova bridge config');
