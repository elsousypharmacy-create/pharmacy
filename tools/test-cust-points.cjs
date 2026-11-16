// custPoints_: points balance matched by normalised phone (sheet may hold 1001112222, 01001112222 or +201001112222).
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const rows=[['2026-11-01','101','01001112222','x',100,5,7],['2026-11-02','102',1001112222,'x',50,0,3],['2026-11-03','103','+201001112222','x',10,0,'متجاهلة'],['2026-11-04','104','01223334444','x',10,0,9],['2026-11-05','105','201001112222','x',10,0,2]];
const sheet={getLastRow:()=>rows.length+1,getRange:(r,c,n,m)=>({getValues:()=>rows.slice(r-2,r-2+n).map(x=>x.slice(0,m))})};
const sb={console,Logger:{log(){}},PropertiesService:{getScriptProperties:()=>({getProperty:()=>null,setProperty(){}})},CacheService:{getScriptCache:()=>({get:()=>null,put(){}})},
  SpreadsheetApp:{openById:()=>({getSheetByName:()=>sheet})},Utilities:{formatDate:()=>'x'}};
vm.createContext(sb);vm.runInContext(fs.readFileSync('server/Code.js','utf8'),sb);
let r=sb.custPoints_('+201001112222');
assert.equal(r.ok,true);assert.equal(r.total_points,12);assert.equal(r.history.length,4);   // 7 + 3 + 0 (ignored) + 2; the other customer is not counted
assert.equal(sb.custPoints_('01223334444').total_points,9);
assert.equal(sb.custPoints_('01999999999').total_points,0);
assert.equal(sb.custPoints_('abc').ok,false);
console.log('PASS cust points');
