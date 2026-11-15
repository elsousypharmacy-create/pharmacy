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
await page.evaluate(() => go('bot', 0)); await page.waitForSelector('.wa-period-more', { timeout: 8000 });
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('  ok', name); };

await t('default: home-style hero (ring, big number, title with the period and date), the three dots in the corner, menu closed', async () => {
  const strip = x => x.replace(/[\u2066-\u2069]/g, '').trim();
  assert.equal(await page.locator('#p-bot .wa-period-cur, #p-bot .period-tabs').count(), 0, 'no pill and no four-tab row');
  assert.equal(await page.locator('#p-bot .wa-hero svg.h-ring').count(), 1);
  assert.match(strip(await page.locator('#p-bot .wa-hero svg.h-ring').innerHTML()), /86%/);
  const title = strip(await page.locator('#p-bot .wa-hero .h-num small').innerText());
  assert.ok(title.startsWith('محادثات اليوم'), title); assert.ok(/نوفمبر|ديسمبر|يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر/.test(title), 'date shown');
  assert.equal(strip(await page.locator('#p-bot .wa-hero .h-num b').innerText()), '7');
  assert.equal(await page.locator('.wa-period-more').innerText(), '⋯');
  assert.equal(await page.locator('#waKpiMenu').isHidden(), true);
  const [hero, dots] = await Promise.all([page.locator('#p-bot .wa-hero').boundingBox(), page.locator('.wa-period-more').boundingBox()]);
  assert.ok(dots.x < hero.x + hero.width / 2 && dots.y < hero.y + 40, 'dots sit in the top corner of the hero (left in RTL)');
  assert.ok(dots.width >= 44 && dots.height >= 44, 'touch size');
});
await t('eight tiles, each metric once, in this order; no repeated total block', async () => {
  const labels = (await page.locator('#p-bot .wa-hero .h-minis .h-mini > small').allInnerTexts()).map(x => x.trim());
  assert.deepEqual(labels, ['رسايل', 'مستنية رد', 'من العملاء', 'ردود الصيدلي', 'ردود البوت', 'أول رد (الوسيط)', 'عملاء جدد', 'عملاء راجعين']);
  assert.equal(await page.locator('#p-bot .wa-msgs').count(), 0);
  const vals = (await page.locator('#p-bot .wa-hero .h-minis .h-mini > b').allInnerTexts()).map(x => x.replace(/[\u2066-\u2069]/g, '').trim());
  assert.deepEqual(vals, ['43', '1', '16', '20', '7', '3m 34s', '4', '2']);
  assert.equal(Number(vals[2]) + Number(vals[3]) + Number(vals[4]), Number(vals[0]), 'parts add up to the total');
  assert.ok((await page.locator('#p-bot .wa-hero .h-minis .h-mini').nth(5).innerText()).includes('المتوسط') && (await page.locator('#p-bot .wa-hero .h-minis .h-mini').nth(5).innerText()).includes('8m 3s'), 'the average is shown under the median');
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
await t('choosing 7 أيام loads that range, the title follows it and the menu closes', async () => {
  await page.locator('.wa-period-more').click(); await page.locator('#waKpiMenu button', { hasText: '7 أيام' }).click();
  await page.waitForFunction(() => document.querySelector('#p-bot .wa-hero .h-num small')?.textContent.includes('7 أيام'));
  assert.equal(ranges.at(-1), '7d'); assert.equal(await page.locator('#waKpiMenu').isHidden(), true);
  assert.ok((await page.locator('#p-bot .wa-hero .h-num small').innerText()).includes('نوفمبر'), 'date range shown in the title for non-today');
});
await t('custom shows the two date fields; going back to اليوم removes them', async () => {
  await page.locator('.wa-period-more').click(); await page.locator('#waKpiMenu button', { hasText: 'فترة' }).click();
  await page.waitForSelector('.m-custom input[type=date]'); assert.equal(await page.locator('.m-custom input[type=date]').count(), 2);
  await page.locator('.wa-period-more').click(); await page.locator('#waKpiMenu button', { hasText: 'اليوم' }).click();
  await page.waitForFunction(() => document.querySelector('#p-bot .wa-hero .h-num small')?.textContent.includes('اليوم'));
  assert.equal(await page.locator('.m-custom').count(), 0); assert.equal(ranges.at(-1), 'today');
});
await t('home: the floating «NOVA Rx» button hides when the in-card NOVA Rx link exists (it duplicated it and covered the last row)', async () => {
  const shown = () => page.evaluate(() => getComputedStyle(document.getElementById('novaHomeAccess')).display);
  await page.evaluate(() => document.body.classList.add('home-flash-mode'));
  assert.equal(await shown(), 'flex', 'without the in-card link the floating button stays (fallback)');
  await page.evaluate(() => { const a = document.createElement('a'); a.className = 'home-nova-shortcut'; a.id = '__probe'; document.body.appendChild(a); });
  assert.equal(await shown(), 'none', 'with the in-card link it is hidden');
  await page.evaluate(() => { document.getElementById('__probe').remove(); document.body.classList.remove('home-flash-mode'); });
});
assert.deepEqual(errs, []);
await b.close(); srv.close(); console.log(`PASS wa period dots: ${n} cases`);
