// One-time splitter: server/Code.js (single file) -> server/src/NN_name.js + server/files.json
// usage: node tools/split-once.js <orig Code.js> <acorn path>
const fs = require('fs'), path = require('path');
const [,, orig, acornPath] = process.argv;
const acorn = require(acornPath);
const src = fs.readFileSync(orig, 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 'latest', locations: true });
// [first statement line, module]; a statement goes to the last range starting at or before it
const R = [
 [1,'00_config'],[27,'10_staff_stats'],[1213,'20_bot_config'],[1251,'21_messaging'],[1723,'22_handoff'],
 [1794,'30_stock'],[2199,'23_ai'],[2632,'24_bot_features'],[2918,'25_bot_history_ui'],[3357,'26_bot_local_classify'],
 [3479,'27_bot_brain'],[3918,'28_bot_handler'],[4434,'29_telegram_webhook'],[4594,'15_tests_misc'],
 [4682,'40_customers_dashboard'],[5108,'95_server_update'],[5188,'41_bot_chat_admin'],[5405,'05_routing'],
 [5675,'60_debts_reminders'],[5760,'61_finance'],[6340,'62_kpi'],[6619,'50_sms_points'],[6990,'70_inventory_aging'],
 [7439,'71_agents'],[7943,'80_cache_home'],[8150,'81_connecteam'],[8515,'82_snapshot_staffhub'],[8899,'72_scan'],
 [9023,'73_doctors'],[9333,'74_orders'],[9637,'75_count_shortage'],[10722,'63_expenses'],[11366,'76_labels'],[11524,'77_dose_ai']];
const OVR = { AUTOREMOTE_KEY:'50_sms_points', AUTOREMOTE_URL:'50_sms_points', SMS_LOG_SHEET:'50_sms_points', POINTS_SHEET:'50_sms_points',
  INVALID_PHONE_SHEET:'50_sms_points', getCountAccuracy:'75_count_shortage' };
function names(s){ if(s.type==='FunctionDeclaration') return [s.id.name];
  if(s.type==='VariableDeclaration') return s.declarations.map(d=>d.id.name); return []; }
const mods = {}; let prev = 0;
ast.body.forEach((s,i)=>{
  let end = s.end; if (i===ast.body.length-1) end = src.length;
  const text = src.slice(prev, end); prev = s.end;
  const ln = s.loc.start.line; let m = R[0][1]; for (const [l,mm] of R) if (l<=ln) m = mm;
  const nm = names(s); for (const n of nm) if (OVR[n]) m = OVR[n];
  (mods[m] = mods[m] || []).push(text);
});
const files = Object.keys(mods).sort();
fs.mkdirSync('server/src', {recursive:true});
for (const f of files) fs.writeFileSync(path.join('server/src', f + '.js'), '// ==== MODULE ' + f + ' (split from server/Code.js; load order = file name order) ====\n' + mods[f].join(''));
fs.writeFileSync('server/files.json', JSON.stringify(files.map(f=>'src/'+f+'.js'), null, 2) + '\n');
console.log(files.length, 'modules');
