// Owner commands from the doctor's own WhatsApp number (bottest / botoff / boton), with or without "/", any case,
// trailing punctuation ignored. Same text from any other number stays a normal customer message.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function make(props){
  const P=Object.assign({},props),cache={},fetches=[],tg=[],logs=[];
  const sb={console,Logger:{log(){}},
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>k in P?P[k]:null,setProperty:(k,v)=>{P[k]=String(v);},deleteProperty:k=>{delete P[k];},getProperties:()=>Object.assign({},P)}),getUserProperties:()=>({getProperty:()=>null,setProperty(){}})},
    CacheService:{getScriptCache:()=>({get:k=>k in cache?cache[k]:null,put:(k,v)=>{cache[k]=String(v);},remove:k=>{delete cache[k];}})},
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
    ContentService:{createTextOutput:t=>({t,setMimeType(){return {getContent:()=>t};},getContent:()=>t}),MimeType:{JSON:'json'}},
    Utilities:{formatDate:()=>'01-01 00:00',sleep(){}},
    UrlFetchApp:{fetch(u,o){fetches.push({u,o});
      if(/graph\.facebook\.com/.test(u))return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({messages:[{id:'wamid.OUT'+fetches.length}]})};
      return {getResponseCode:()=>200,getContentText:()=>'{}'};}}};
  vm.createContext(sb);vm.runInContext(fs.readFileSync('server/Code.js','utf8'),sb);
  sb.handled=[];sb.handleCustomerMessage=(chatId,msg)=>{sb.handled.push([chatId,msg.text]);};
  sb.waToken_=()=>'wa-token';sb.waPhoneId_=()=>'PNID';
  sb.saveCustomerPhone_=()=>{};sb.canonicalEgyptPhone_=p=>p;sb.noteBadChatId_=()=>{};sb.badChatId_=()=>false;
  sb.sendTelegramStaff=(m,c)=>{tg.push(m);};sb.logChatRows_=(id,rows)=>{logs.push([id,rows]);};
  return {sb,P,fetches,tg,logs};
}
let n=0;
const OWNER='201120372238',CUST='201001112222';
const hook=(id,from,body)=>({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'PNID'},contacts:[{wa_id:from,profile:{name:'x'}}],messages:[{id,from,timestamp:'1760000000',type:'text',text:{body}}]}}]}]});
const post=(t,from,body)=>t.sb.doPost({postData:{contents:JSON.stringify(hook('wamid.'+(++n),from,body))}});
const wa=t=>t.fetches.filter(x=>/graph\.facebook\.com/.test(x.u)).map(x=>JSON.parse(x.o.payload));
const ok=(name,fn)=>{fn();console.log('  ok',name);};

ok('owner "Bottest off" (no slash, capital B) clears the test numbers and is NOT a customer question',()=>{
  const t=make({});post(t,OWNER,'Bottest off');
  assert.equal(t.P.BOT_TEST,'');assert.deepEqual(t.sb.handled,[]);
  const s=wa(t);assert.equal(s.length,1);assert.equal(s[0].to,OWNER);assert.equal(s[0].type,'text');assert.match(s[0].text.body,/مفيش/);
  assert.equal(t.tg.length,1);assert.match(t.tg[0],/bottest off/);
});
ok('"/bottest off/" with a trailing slash and spaces works the same',()=>{
  const t=make({BOT_TEST:'1120372238'});post(t,OWNER,'  /bottest off/  ');assert.equal(t.P.BOT_TEST,'');assert.deepEqual(t.sb.handled,[]);
});
ok('"bottest 01011112222 01122223333" sets those numbers (last 10 digits)',()=>{
  const t=make({});post(t,OWNER,'bottest 01011112222 01122223333');assert.equal(t.P.BOT_TEST,'1011112222,1122223333');
  assert.match(wa(t)[0].text.body,/1011112222/);
});
ok('"bottest" alone only shows the list, changes nothing',()=>{
  const t=make({BOT_TEST:'1011112222'});post(t,OWNER,'BOTTEST');assert.equal(t.P.BOT_TEST,'1011112222');assert.match(wa(t)[0].text.body,/1011112222/);
});
ok('botoff / BotOn from the owner pause and resume the bot',()=>{
  const t=make({});post(t,OWNER,'botoff');assert.equal(t.P.BOT_PAUSED,'1');post(t,OWNER,'BotOn.');assert.equal(t.P.BOT_PAUSED,'0');assert.deepEqual(t.sb.handled,[]);
});
ok('the owner still gets the confirmation while the bot is paused and he is not a test number',()=>{
  const t=make({BOT_PAUSED:'1',BOT_TEST:''});post(t,OWNER,'bottest off');assert.equal(wa(t).length,1);
});
ok('the same words from a customer are a normal message: nothing changes',()=>{
  const t=make({BOT_TEST:'1120372238'});post(t,CUST,'Bottest off');post(t,CUST,'/botoff');
  assert.equal(t.P.BOT_TEST,'1120372238');assert.equal(t.P.BOT_PAUSED,undefined);
  assert.deepEqual(t.sb.handled.map(x=>x[1]),['Bottest off','/botoff']);
});
ok('a normal message from the owner still goes to the bot',()=>{
  const t=make({});post(t,OWNER,'عندكم بنادول؟');post(t,OWNER,'bottesting something');
  assert.deepEqual(t.sb.handled.map(x=>x[1]),['عندكم بنادول؟','bottesting something']);
});
ok('WA_ADMIN replaces the default owner number',()=>{
  const t=make({WA_ADMIN:'01001112222'});post(t,OWNER,'bottest off');assert.equal(t.sb.handled.length,1);assert.equal(t.P.BOT_TEST,undefined);
  post(t,CUST,'bottest off');assert.equal(t.P.BOT_TEST,'');
});
console.log('PASS wa owner commands');
