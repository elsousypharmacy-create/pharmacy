// P0 pharmacy#59: PR #58 put an unterminated string into index.html, so the whole app script failed to
// parse and the dashboard showed only its header and tabs. Every page script must parse, and the
// boot guard must stay in place so a future failure is visible instead of a black void.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.join(__dirname, '..');
const pages = fs.readdirSync(root).filter(f => f.endsWith('.html'));
assert(pages.includes('index.html'), 'index.html must exist');
const scriptRe = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
for (const page of pages) {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  let m, count = 0;
  while ((m = scriptRe.exec(html))) {
    count++;
    try { new vm.Script(m[1], { filename: `${page}#script${count}` }); }
    catch (e) { assert.fail(`${page}: inline script ${count} does not parse: ${e.message}`); }
  }
}
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert(index.includes('id="novaBootGuard"'), 'boot guard script is missing from index.html');
assert(/<script>window\.__novaBooted=true;/.test(index), 'the main app script must announce that it started');
// The NOVA shortcut belongs in the page body, never inside a JavaScript string.
assert.strictEqual((index.match(/<a id="novaHomeAccess"/g) || []).length, 1, 'exactly one NOVA shortcut anchor');
const anchorAt = index.indexOf('<a id="novaHomeAccess"');
assert(anchorAt > index.lastIndexOf('</script>'), 'the NOVA shortcut anchor must sit after the last script, in the page body');
console.log('PASS index.html and every page parse; boot guard present; shortcut is in the body');
