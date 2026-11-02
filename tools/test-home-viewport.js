const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync(require('path').join(__dirname,'../index.html'),'utf8');
const source=html.slice(html.indexOf('function homeFlashViewportBounds('),html.indexOf('function staffFlashFit('));
const c={Math};vm.createContext(c);vm.runInContext(source,c);
function check(view,header,nav,expected){const r=c.homeFlashViewportBounds(view,header,nav);assert.equal(r.height,expected);assert(r.top>=header.bottom+8);assert(r.top+r.height<=Math.min(view.bottom,nav.top)-8);return r;}
check({top:0,bottom:720},{bottom:72},{top:604},516); // navbar plus 44px safe-area gap
check({top:0,bottom:720},{bottom:72},{top:638},550); // same screen, 10px gap
check({top:0,bottom:600},{bottom:72},{top:484},396);
check({top:40,bottom:640},{bottom:72},{top:700},552); // visible browser viewport ends above navbar
assert.equal(c.homeFlashViewportBounds({top:0,bottom:100},{bottom:90},{top:95}).height,0,'never force a minimum larger than the available area');
console.log('Home viewport: real navbar top, safe-area gap, short screens, shifted visible viewport and no oversized minimum passed');
