// «واتساب فقط»: whatsapp.html → index.html?app=whatsapp is the dashboard's WhatsApp section on its own (no other sections, own manifest),
// and the normal dashboard is untouched. Real page, stubbed API, no network.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const types = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/^\//, '') || 'index.html'); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}/`;
const kpi = { ok: true, preset: 'today', label: 'النهارده', chats: 7, msgs: 43, inMsgs: 16, botMsgs: 7, staffMsgs: 20, waitingOpen: 1, waiting: [], customers: { newC: 4, returning: 2 }, firstResponse: { n: 5, avgText: '8 د 3 ث', medianText: '3 د 34 ث' }, yesterday: {}, media: {}, hours: [], trend: [] };
const b = await chromium.launch({ args: ['--no-sandbox'] });
const open = async () => {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'ar-EG' });
  await ctx.route('**/*', r => {
    const u = r.request().url(); if (u.startsWith(base) || u.startsWith('data:')) return r.continue();
    if (/script\.google|googleusercontent|workers\.dev/.test(u)) { const a = new URL(u).searchParams.get('action'); return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(a === 'getWhatsAppKpis' ? kpi : { ok: true }) }); }
    return r.abort();
  });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('adminPin', '0000'); } catch {} });
  return { ctx, page, errs };
};
const hideSplash = p => p.addStyleTag({ content: '#sSplash{display:none!important}' });
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('  ok', name); };

await t('whatsapp.html redirects to the dashboard in WhatsApp-only mode (own title, own manifest)', async () => {
  const { ctx, page, errs } = await open();
  await page.goto(base + 'whatsapp.html', { waitUntil: 'load' }); await page.waitForURL(/index\.html\?app=whatsapp/, { timeout: 8000 });
  await page.waitForSelector('#p-bot .wa-hero', { timeout: 10000 }); await hideSplash(page);
  assert.equal(await page.title(), 'واتساب الصيدلية');
  assert.equal(await page.locator('link[rel=manifest]').getAttribute('href'), 'manifest-whatsapp.json');
  assert.equal(await page.locator('meta[name=apple-mobile-web-app-title]').getAttribute('content'), 'واتساب الصيدلية');
  assert.equal((await page.locator('.brand h1').innerText()).trim(), 'واتساب الصيدلية');
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('secnav')).display), 'none', 'bottom nav of the other sections is hidden');
  assert.equal(await page.evaluate(() => CUR), 'bot');
  assert.equal(await page.locator('.screen.on').evaluate(e => e.id), 'sc-bot');
  assert.deepEqual((await page.locator('.subtabs button').allInnerTexts()).map(x => x.replace(/\s+/g, ' ').trim()), ['مؤشرات الواتساب', '💬 المحادثات']);
  assert.deepEqual(errs, []); await ctx.close();
});
await t('it cannot leave the WhatsApp section, and it never overwrites the main dashboard\'s «last page»', async () => {
  const { ctx, page, errs } = await open();
  await page.goto(base + 'index.html?app=whatsapp', { waitUntil: 'load' }); await page.waitForSelector('#p-bot .wa-hero', { timeout: 10000 });
  await page.evaluate(() => { go('cust'); go('sales'); go('money', 1); });
  assert.equal(await page.evaluate(() => CUR), 'bot');
  assert.equal(await page.evaluate(() => localStorage.getItem('lastPage')), null);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('lastPage')), null);
  await page.evaluate(() => go('bot', 1)); assert.equal(await page.evaluate(() => localStorage.getItem('waAppTab')), '1');
  await page.evaluate(() => go('bot', 0)); assert.equal(await page.evaluate(() => localStorage.getItem('waAppTab')), '0');
  assert.deepEqual(errs, []); await ctx.close();
});
await t('the normal dashboard is unchanged: bottom nav, own title and manifest, last page remembered', async () => {
  const { ctx, page, errs } = await open();
  await page.goto(base + 'index.html', { waitUntil: 'load' }); await page.waitForTimeout(1200); await hideSplash(page);
  assert.equal(await page.title(), 'صيدلية السوسي');
  assert.equal(await page.locator('link[rel=manifest]').getAttribute('href'), 'manifest-index.json');
  assert.equal(await page.evaluate(() => window.NOVA_APP), undefined);
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.getElementById('secnav')).display), 'none');
  await page.evaluate(() => go('cust')); assert.equal(await page.evaluate(() => CUR), 'cust');
  assert.ok(await page.evaluate(() => localStorage.getItem('lastPage')));
  assert.deepEqual(errs, []); await ctx.close();
});
await t('manifest-whatsapp.json: its own id, start_url inside its scope, icons exist', async () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest-whatsapp.json'), 'utf8')), main = JSON.parse(fs.readFileSync(path.join(root, 'manifest-index.json'), 'utf8'));
  assert.notEqual(m.id, main.id); assert.equal(m.display, 'standalone'); assert.equal(m.dir, 'rtl');
  const start = new URL(m.start_url, 'https://x.test/pharmacy/manifest-whatsapp.json'), scope = new URL(m.scope, 'https://x.test/pharmacy/manifest-whatsapp.json');
  assert.ok(start.pathname.startsWith(scope.pathname)); assert.equal(start.search, '?app=whatsapp');
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(root, i.src)), i.src + ' exists');
});
await b.close(); srv.close(); console.log(`PASS wa app mode: ${n} cases`);
