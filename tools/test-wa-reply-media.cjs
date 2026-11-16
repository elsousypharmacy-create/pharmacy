// NOVA bridge op replyMedia: upload to Meta /media, then send by media id. Mocked fetch, no network. Run: node tools/test-wa-reply-media.cjs
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const TOK='t'.repeat(40),P={NOVA_WA_BRIDGE_TOKEN:TOK,WA_TOKEN:'EAAxxxxxxxxxxxxxxxxxxxxxxxx',WA_PHONE_ID:'999000111'},cache={},fetches=[];
let upMode='ok',sendMode='ok';
const sb={console,Logger:{log(){}},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>k in P?P[k]:null,setProperty:(k,v)=>{P[k]=String(v)},deleteProperty:k=>{delete P[k]},getProperties:()=>Object.assign({},P)}),getUserProperties:()=>({getProperty:()=>null,setProperty(){}})},
  CacheService:{getScriptCache:()=>({get:k=>k in cache?cache[k]:null,put:(k,v)=>{cache[k]=String(v)},remove:k=>{delete cache[k]}})},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
  ContentService:{createTextOutput:t=>({t,setMimeType(){return {getContent:()=>t}},getContent:()=>t}),MimeType:{JSON:'json'}},
  Utilities:{formatDate:()=>'x',sleep(){},base64Decode:s=>Array.from(Buffer.from(s,'base64')),newBlob:(bytes,mime,name)=>({bytes,mime,name})},
  UrlFetchApp:{fetch(u,o){fetches.push({u,o});
    if(/\/media$/.test(u)){return upMode==='ok'?{getResponseCode:()=>200,getContentText:()=>JSON.stringify({id:'MEDIA123'})}:{getResponseCode:()=>400,getContentText:()=>JSON.stringify({error:{message:'bad file'}})}}
    if(/\/messages$/.test(u)){return sendMode==='ok'?{getResponseCode:()=>200,getContentText:()=>JSON.stringify({messages:[{id:'wamid.OUT1'}]})}:{getResponseCode:()=>400,getContentText:()=>JSON.stringify({error:{code:131047,message:'x'}})}}
    return {getResponseCode:()=>200,getContentText:()=>'{}'}}}};
vm.createContext(sb);vm.runInContext(fs.readFileSync('server/Code.js','utf8'),sb);
sb.saveConversationTurn=function(){sb.saved=Array.from(arguments)};sb.clearHandoff_=function(){};
const call=d=>JSON.parse(sb.doPost({postData:{contents:JSON.stringify(Object.assign({action:'novaWhatsAppBridge',operation:'replyMedia',bridgeToken:TOK},d))}}).getContent());
const B64=Buffer.from('fake-jpeg-bytes').toString('base64');
let r=call({bridgeToken:'x'.repeat(40),chatId:'wa_201001112222',kind:'image',mime:'image/jpeg',data:B64});assert.equal(r.ok,false);assert.equal(fetches.length,0);
for(const bad of [{chatId:'wa_user_x'},{kind:'video'},{mime:'image/gif'},{kind:'document',mime:'image/jpeg'},{data:''},{data:'***'},{data:'A'.repeat(7500004)}]){r=call(Object.assign({chatId:'wa_201001112222',kind:'image',mime:'image/jpeg',data:B64},bad));assert.equal(r.ok,false,JSON.stringify(Object.keys(bad)));}
assert.equal(fetches.length,0);
// image with caption
r=call({chatId:'wa_201001112222',kind:'image',mime:'image/jpeg',filename:'p.jpg',data:B64,caption:'  علبة الدوا  '});
assert.deepEqual([r.ok,r.media_id,r.message_id],[true,'MEDIA123','wamid.OUT1']);
assert.match(fetches[0].u,/\/999000111\/media$/);assert.equal(fetches[0].o.payload.type,'image/jpeg');assert.equal(fetches[0].o.payload.file.mime,'image/jpeg');assert.equal(fetches[0].o.payload.file.bytes.length,15);
assert.equal(fetches[0].o.headers.Authorization,'Bearer '+P.WA_TOKEN);
const sent=JSON.parse(fetches[1].o.payload);assert.deepEqual([sent.messaging_product,sent.to,sent.type,sent.image],['whatsapp','201001112222','image',{id:'MEDIA123',caption:'علبة الدوا'}]);
assert.match(sb.saved[2],/^\[صورة\] علبة الدوا/);
// document keeps its filename (sanitised)
r=call({chatId:'wa_201001112222',kind:'document',mime:'application/pdf',filename:'rx/../تحليل.pdf',data:B64});assert.equal(r.ok,true);
const sd=JSON.parse(fetches[3].o.payload);assert.equal(sd.type,'document');assert.equal(sd.document.id,'MEDIA123');assert.ok(!/[\/]/.test(sd.document.filename),sd.document.filename);
// upload refused / send refused (24 h) -> errors, nothing logged as sent
sb.saved=null;upMode='bad';r=call({chatId:'wa_201001112222',kind:'image',mime:'image/png',data:B64});assert.equal(r.ok,false);assert.match(r.error,/رفع الملف فشل/);
upMode='ok';sendMode='bad';r=call({chatId:'wa_201001112222',kind:'image',mime:'image/png',data:B64});assert.equal(r.ok,false);assert.equal(sb.saved,null);
// no WhatsApp token
delete P.WA_TOKEN;r=call({chatId:'wa_201001112222',kind:'image',mime:'image/png',data:B64});assert.equal(r.ok,false);
console.log('PASS wa reply media');
