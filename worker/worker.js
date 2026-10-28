/* ═══ Cloudflare Worker: صيدلية السوسي ═══
   1) ويبهوك واتساب (زي ما هو بالظبط): GET تأكيد ميتا، POST بيتبعت لـ Apps Script.
   2) طبقة سريعة قدام Apps Script: القراية بتترد من قاعدة D1 في أجزاء من الثانية،
      وبتتحدّث من Google في الخلفية. لو D1 مش مربوطة، بيعدّي الطلب عادي.
   مفيش أي أسرار في الملف ده. */
const GAS_URL = 'https://script.google.com/macros/s/AKfycbyETI5UTPwpMFOu-aWoKKHqyppa7ctTVJjckmbTxegDq7E3R3p6aEBzqt275HNL8SBfWg/exec';

/* القراية المسموحة وعمرها بالثواني (بعده بيترد القديم وبيتحدّث في الخلفية) */
const TTL = {
  callsGet: 8, callsList: 120, callsReport: 60,
  getHomeBundle: 60, getStaffKPI: 60, getSystemDailyTotals: 60, getMonthTotalsRaw: 120,
  getBotChats: 20, getShortages: 120, getStaffHub: 60, getExpensesData: 120, getSMSLogFast: 120,
  getCustomers: 300, getNewCustomersDetail: 300, getHistory: 300, getDebtsData: 300,
  getProfitLoss: 300, getInventoryAging: 600
};
const MAX_STALE = { callsGet: 600 };          /* أقصى عمر للقديم قبل ما نستنى Google */
const MAX_STALE_DEF = 6 * 3600;
const CALL_ST = { done: 1, noanswer: 1, later: 1, wrong: 1, blocked: 1 };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Max-Age': '86400' };

function out(body, extra, status) {
  return new Response(body, { status: status || 200, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, CORS, extra || {}) });
}
async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].slice(0, 12).map(x => x.toString(16).padStart(2, '0')).join('');
}
function gasQs(u) { const p = new URLSearchParams(u.search); p.delete('_ts'); return p.toString(); }
async function cacheKey(u) {
  const p = new URLSearchParams(u.search); p.delete('_ts');
  const pin = p.get('pin'); p.delete('pin'); p.sort();
  return p.toString() + (pin ? '|' + await sha('pin|' + pin) : '');
}
async function gas(qs) {
  const r = await fetch(GAS_URL + '?' + qs, { redirect: 'follow' });
  return await r.text();
}
function goodBody(t) {
  if (!t || t.length > 1500000) return false;
  try { const j = JSON.parse(t); return !!j && j.ok !== false && !j.lockError && !j.pinError; } catch (e) { return false; }
}
async function put(env, k, t) {
  await env.DB.prepare('INSERT INTO c (k, body, at, ref) VALUES (?, ?, ?, 0) ON CONFLICT(k) DO UPDATE SET body = excluded.body, at = excluded.at, ref = 0')
    .bind(k, t, Date.now()).run();
}
async function refresh(env, k, qs, now) {
  /* واحد بس يحدّث في نفس الوقت */
  const claim = await env.DB.prepare('UPDATE c SET ref = ? WHERE k = ? AND ref < ?').bind(now, k, now - 20000).run();
  if (!claim.meta || claim.meta.changes !== 1) return;
  try { const t = await gas(qs); if (goodBody(t)) await put(env, k, t); } catch (e) {}
}

async function read(u, env, ctx, action) {
  const qs = gasQs(u);
  if (!env.DB) return out(await gas(qs), { 'x-cache': 'off' });
  const k = await cacheKey(u), now = Date.now();
  let row = null;
  try { row = await env.DB.prepare('SELECT body, at FROM c WHERE k = ?').bind(k).first(); } catch (e) {}
  if (row) {
    const age = now - row.at;
    if (age < TTL[action] * 1000) return out(row.body, { 'x-cache': 'hit' });
    if (age < (MAX_STALE[action] || MAX_STALE_DEF) * 1000) {
      ctx.waitUntil(refresh(env, k, qs, now));
      const b = row.body.charAt(0) === '{' ? '{"_stale":1,' + row.body.slice(1) : row.body;
      return out(b, { 'x-cache': 'stale' });
    }
  }
  const t = await gas(qs);
  if (goodBody(t)) ctx.waitUntil(put(env, k, t).catch(() => {}));
  return out(t, { 'x-cache': 'miss' });
}

/* حفظ نتيجة مكالمة: بتتكتب في Google، وبعدين النسخة السريعة بتتعدّل فورًا عشان باقي الموظفين يشوفوها */
async function callsSet(u, env) {
  const p = u.searchParams, key = p.get('key') || '', status = p.get('status') || '';
  if (!/^[0-9a-f]{16,64}$/.test(key) || (status && !CALL_ST[status])) return out(JSON.stringify({ ok: false, error: 'طلب غلط' }));
  const t = await gas(gasQs(u));
  let ok = false; try { ok = JSON.parse(t).ok === true; } catch (e) {}
  if (ok && env.DB) {
    try {
      const row = await env.DB.prepare('SELECT body FROM c WHERE k = ?').bind('action=callsGet').first();
      if (row) {
        const j = JSON.parse(row.body); j.calls = j.calls || {};
        if (status) j.calls[key] = { status, note: (p.get('note') || '').slice(0, 500), at: Date.now(), by: (p.get('by') || '').trim().slice(0, 40) };
        else delete j.calls[key];
        await env.DB.prepare('UPDATE c SET body = ? WHERE k = ?').bind(JSON.stringify(j), 'action=callsGet').run();
      }
    } catch (e) {}
  }
  return out(t);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const u = new URL(request.url);
    if (request.method === 'GET') {
      if (u.searchParams.get('hub.verify_token') === 'elsousy2026wa')
        return new Response(u.searchParams.get('hub.challenge') || '');
      const action = u.searchParams.get('action');
      if (action === 'ping') return out(JSON.stringify({ ok: true, fast: true, db: !!env.DB }));
      try {
        if (action === 'callsSet') return await callsSet(u, env);
        if (action && TTL[action]) return await read(u, env, ctx, action);
      } catch (e) {
        return out(JSON.stringify({ ok: false, proxyError: true, error: 'السيرفر السريع مش متاح' }), null, 502);
      }
      return new Response('ok');
    }
    if (request.method !== 'POST') return new Response('ok');
    /* ويبهوك واتساب: زي ما هو */
    const body = await request.text();
    ctx.waitUntil(fetch(GAS_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body, redirect: 'follow' }));
    return new Response('ok');
  }
};
