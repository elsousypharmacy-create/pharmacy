// P0 pharmacy#59 browser check: a healthy index.html shows no boot error; one whose app script fails to
// parse shows a visible, actionable message instead of an empty black page. All network is blocked.
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const fixed = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
// Re-create the exact #58 mistake: an unterminated string inside the PDF export template.
const goodLine = "    '</body></html>');";
assert(fixed.includes(goodLine), 'expected PDF template line not found');
const broken = fixed.replace(goodLine, "    '<a id=\"x\">\n</body></html>');");
const tmp = path.join(root, '__boot-guard-broken.html');
(async () => {
  const browser = await chromium.launch();
  try {
    const open = async (file, ms) => {
      const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
      await ctx.route('**/*', r => (r.request().url().startsWith('file:') ? r.continue() : r.abort()));
      const page = await ctx.newPage(); const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto('file://' + file, { waitUntil: 'load' });
      await page.waitForTimeout(ms);
      const state = await page.evaluate(() => ({
        banner: !!document.getElementById('novaBootError'),
        reload: !!document.querySelector('#novaBootError button'),
        splashShown: (() => { const s = document.getElementById('sSplash'); return !!s && getComputedStyle(s).display !== 'none' && +getComputedStyle(s).opacity > 0.05; })(),
        booted: window.__novaBooted === true,
      }));
      await ctx.close();
      return { state, errors };
    };
    const good = await open(path.join(root, 'index.html'), 5500);
    assert.strictEqual(good.state.booted, true, 'the app script must start on the real index.html');
    assert.strictEqual(good.state.banner, false, 'no boot error on a healthy page');
    assert.deepStrictEqual(good.errors, [], 'no page errors on a healthy page');
    fs.writeFileSync(tmp, broken);
    const bad = await open(tmp, 1500);
    assert.strictEqual(bad.state.booted, false, 'the broken page never starts its app script');
    assert.strictEqual(bad.state.banner, true, 'a broken page must show the boot error');
    assert.strictEqual(bad.state.reload, true, 'the boot error offers a reload button');
    assert.strictEqual(bad.state.splashShown, false, 'the splash must not hide the error');
    console.log('PASS boot guard: healthy page boots without a banner; a script that fails to parse shows a visible reload message');
  } finally {
    await browser.close();
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
})().catch(e => { console.error(e); process.exit(1); });
