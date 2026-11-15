// WhatsApp KPIs: one period pill («اليوم») with a «⋯» button that opens 7 days / 30 days / custom. Real page, stubbed API, no network.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const types = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/^\//, '') || 'index.html'); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}/`;
const kpi = (preset, label) => ({ ok: true, preset, label, chats: 7, msgs: 43, inMsgs: 16, botMsgs: 7, staffMsgs: 20, waitingOpen: 1, waiting: [], customers: { newC: 4, returning: 2 }, firstResponse: { n: 5, avgText: '8 د 3 ث', medianText: '3 د 34 ث' }, yesterday: {}, media: {}, hours: [], trend: [] });
const ranges = [];
const b = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'ar-EG' });
await ctx.route('**/*', r => {
  const u = r.request().url(); if (u.startsWith(base) || u.startsWith('data:')) return r.continue();
  if (/script\.google|googleusercontent|workers\.dev/.test(u)) { const p = new URL(u).searchParams, a = p.get('action'); if (a === 'getWhatsAppKpis') { ranges.push(p.get('range')); const rg = p.get('range'); return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(kpi(rg, rg === 'today' ? 'النهارده' : '1–7 نوفمبر')) }); } return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"ok":true}' }); }
  return r.abort();
});
const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('adminPin', '0000'); } catch {} });
await page.goto(base, { waitUntil: 'load' }); await page.waitForTimeout(800);
await page.addStyleTag({ content: '#sSplash{display:none!important}' });
await page.evaluate(() => go('bot', 0)); await page.waitForSelector('.wa-period-cur', { timeout: 8000 });
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('  ok', name); };

await t('default: the pill says اليوم, the three dots are next to it, the menu is closed, the old four-tab row is gone', async () => {
  assert.equal((await page.locator('.wa-period-cur').innerText()).trim(), 'اليوم');
  assert.equal(await page.locator('.wa-period-more').innerText(), '⋯');
  assert.equal(await page.locator('#waKpiMenu').isHidden(), true);
  assert.equal(await page.locator('#p-bot .period-tabs').count(), 0);
  const [a, c] = await Promise.all([page.locator('.wa-period-cur').boundingBox(), page.locator('.wa-period-more').boundingBox()]);
  assert.ok(Math.abs(a.y - c.y) < 4 && Math.abs(a.x - (c.x + c.width)) < 16, 'same row, adjacent');
  assert.ok(c.width >= 44 && c.height >= 44, 'touch size');
});
await t('layout without repetition: no big hero number, four tiles, one messages block (total + its three parts, shown once)', async () => {
  assert.equal(await page.locator('#p-bot .h-main').count(), 0);
  assert.equal(await page.locator('#p-bot .h-minis .h-mini').count(), 4);
  assert.deepEqual((await page.locator('#p-bot .h-minis .h-mini > small').allInnerTexts()).map(x => x.trim()), ['محادثات', 'مستنية رد', 'أول رد', 'جدد / رجوع']);
  assert.equal(await page.locator('#p-bot .wa-msgs').count(), 1);
  assert.equal((await page.locator('#p-bot .wa-msgs-head b').innerText()).replace(/[\u2066-\u2069]/g, '').trim(), '43');
  assert.deepEqual((await page.locator('#p-bot .wa-msgs .period-stats small').allInnerTexts()).map(x => x.trim()), ['من العملاء', 'ردود البوت', 'ردود الصيدلي']);
  const txt = await page.locator('#p-bot .h-hero').innerText();
  assert.equal((txt.match(/رسايل/g) || []).length, 1, 'the word رسايل appears once (as the block title)');
  const tiles = await page.locator('#p-bot .h-minis').boundingBox(), msgs = await page.locator('#p-bot .wa-msgs').boundingBox();
  assert.ok(msgs.y > tiles.y + tiles.height - 2 && msgs.y - (tiles.y + tiles.height) < 30, 'messages block sits right under the tiles');
});
await t('the dots open the other periods and say so for assistive tech', async () => {
  await page.locator('.wa-period-more').click();
  assert.equal(await page.locator('#waKpiMenu').isVisible(), true);
  assert.equal(await page.locator('.wa-period-more').getAttribute('aria-expanded'), 'true');
  assert.deepEqual((await page.locator('#waKpiMenu button').allInnerTexts()).map(x => x.trim()), ['اليوم', '7 أيام', '30 يوم', 'فترة']);
  await page.evaluate(() => drawWaKpis(WA_KPI)); // a data refresh while the menu is open must not close it or lie about its state
  assert.equal(await page.locator('#waKpiMenu').isVisible(), true); assert.equal(await page.locator('.wa-period-more').getAttribute('aria-expanded'), 'true');
  await page.locator('.wa-period-more').click(); assert.equal(await page.locator('#waKpiMenu').isHidden(), true);
  assert.equal(await page.locator('.wa-period-more').getAttribute('aria-expanded'), 'false');
});
await t('choosing 7 أيام loads that range, the pill follows it and the menu closes', async () => {
  await page.locator('.wa-period-more').click(); await page.locator('#waKpiMenu button', { hasText: '7 أيام' }).click();
  await page.waitForFunction(() => document.querySelector('.wa-period-cur')?.textContent.trim() === '7 أيام');
  assert.equal(ranges.at(-1), '7d'); assert.equal(await page.locator('#waKpiMenu').isHidden(), true);
  assert.ok((await page.locator('.h-top').innerText()).includes('نوفمبر'), 'date range shown for non-today');
});
await t('custom shows the two date fields; going back to اليوم removes them', async () => {
  await page.locator('.wa-period-more').click(); await page.locator('#waKpiMenu button', { hasText: 'فترة' }).click();
  await page.waitForSelector('.m-custom input[type=date]'); assert.equal(await page.locator('.m-custom input[type=date]').count(), 2);
  await page.locator('.wa-period-more').click(); await page.locator('#waKpiMenu button', { hasText: 'اليوم' }).click();
  await page.waitForFunction(() => document.querySelector('.wa-period-cur')?.textContent.trim() === 'اليوم');
  assert.equal(await page.locator('.m-custom').count(), 0); assert.equal(ranges.at(-1), 'today');
});
assert.deepEqual(errs, []);
await b.close(); srv.close(); console.log(`PASS wa period dots: ${n} cases`);
