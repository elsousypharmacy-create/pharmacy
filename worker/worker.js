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
const MAX_STALE = { callsGet: 600 };
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
async function gasPost(payload) {
  const r = await fetch(GAS_URL, { method: 'POST', body: JSON.stringify(payload), redirect: 'follow' });
  return await r.text();
}
function hex(buffer) {
  return [...new Uint8Array(buffer)].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function webhookAllowed(request, env, body) {
  let data = {}; try { data = JSON.parse(body); } catch (e) { return false; }
  if (data.object === 'whatsapp_business_account' && env.WA_APP_SECRET) {
    const supplied = request.headers.get('x-hub-signature-256') || '';
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.WA_APP_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const expected = 'sha256=' + hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
    return supplied.length === expected.length && supplied === expected;
  }
  if (data.update_id !== undefined && env.TELEGRAM_WEBHOOK_SECRET)
    return request.headers.get('x-telegram-bot-api-secret-token') === env.TELEGRAM_WEBHOOK_SECRET;
  /* التوافق الحالي يظل قائمًا حتى يضبط المالك سر المزود؛ لا يوجد fallback داخل الكود. */
  return true;
}
function goodBody(t) {
  if (!t || t.length > 1500000) return false;
  try { const j = JSON.parse(t); return !!j && j.ok !== false && !j.lockError && !j.pinError; } catch (e) { return false; }
}
const MEM = new Map();
async function sGet(env, k) {
  const m = MEM.get(k); if (m) return m;
  if (!env.DB) return null;
  try { const r = await env.DB.prepare('SELECT body, at FROM c WHERE k = ?').bind(k).first(); if (r) { const v = { body: r.body, at: r.at, ref: 0 }; MEM.set(k, v); return v; } } catch (e) {}
  return null;
}
async function put(env, k, t, at) {
  const v = { body: t, at: at || Date.now(), ref: 0 };
  MEM.set(k, v);
  if (MEM.size > 300) MEM.delete(MEM.keys().next().value);
  if (env.DB) await env.DB.prepare('INSERT INTO c (k, body, at, ref) VALUES (?, ?, ?, 0) ON CONFLICT(k) DO UPDATE SET body = excluded.body, at = excluded.at, ref = 0')
    .bind(k, t, v.at).run();
}
async function refresh(env, k, qs, now) {
  const m = MEM.get(k);
  if (m) { if (m.ref > now - 20000) return; m.ref = now; }
  if (env.DB) {
    const claim = await env.DB.prepare('UPDATE c SET ref = ? WHERE k = ? AND ref < ?').bind(now, k, now - 20000).run();
    if (!claim.meta || claim.meta.changes !== 1) return;
  }
  try { const t = await gas(qs); if (goodBody(t)) await put(env, k, t); } catch (e) { if (m) m.ref = 0; }
}
async function read(u, env, ctx, action) {
  if(action!=='callsGet' && action!=='callsList' && action!=='getShortages'){
    var pin=u.searchParams.get('pin')||'';
    if(!pin)return out(JSON.stringify({ok:false,lockError:true,error:'سجّل الدخول لعرض البيانات'}));
    var auth=JSON.parse(await gasPost({action:'dashboardAuth',pin:pin}));
    if(!auth.ok)return out(JSON.stringify(auth));
  }
  const qs = gasQs(u);
  const k = await cacheKey(u), now = Date.now();
  const row = await sGet(env, k);
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
async function callsSet(u, env) {
  const p = u.searchParams, key = p.get('key') || '', status = p.get('status') || '';
  if (!/^[0-9a-f]{16,64}$/.test(key) || (status && !CALL_ST[status])) return out(JSON.stringify({ ok: false, error: 'طلب غلط' }));
  const t = await gas(gasQs(u));
  let ok = false; try { ok = JSON.parse(t).ok === true; } catch (e) {}
  if (ok) {
    try {
      const row = await sGet(env, 'action=callsGet');
      if (row) {
        const j = JSON.parse(row.body); j.calls = j.calls || {};
        if (status) j.calls[key] = { status, note: (p.get('note') || '').slice(0, 500), at: Date.now(), by: (p.get('by') || '').trim().slice(0, 40) };
        else delete j.calls[key];
        await put(env, 'action=callsGet', JSON.stringify(j), row.at);
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
      if (u.searchParams.get('hub.mode') === 'subscribe') {
        try { return new Response(await gas(gasQs(u))); }
        catch (e) { return new Response('verification unavailable', { status: 502 }); }
      }
      const action = u.searchParams.get('action');
      if (action === 'ping') return out(JSON.stringify({ ok: true, fast: true, db: !!env.DB, mem: MEM.size, v: 2 }));
      try {
        if (action === 'callsSet') return await callsSet(u, env);
        if (action && TTL[action]) return await read(u, env, ctx, action);
      } catch (e) {
        return out(JSON.stringify({ ok: false, proxyError: true, error: 'السيرفر السريع مش متاح' }), null, 502);
      }
      return new Response('ok');
    }
    if (request.method !== 'POST') return new Response('ok');
    const body = await request.text();
    if (!await webhookAllowed(request, env, body)) return new Response('unauthorized', { status: 401 });
    ctx.waitUntil(fetch(GAS_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body, redirect: 'follow' }));
    return new Response('ok');
  }
};

