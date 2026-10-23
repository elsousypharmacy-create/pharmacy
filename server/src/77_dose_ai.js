// ==== MODULE 77_dose_ai (split from server/Code.js; load order = file name order) ====


// ===================================================================
// 🤖 الجرعة بالذكاء الاصطناعي — اقتراح بس، والصيدلي بيراجع ويأكد قبل الطباعة
// ===================================================================
/* الموديل والمزوّد بيتظبطوا من لوحة التحكم (⚙️ ← الذكاء الاصطناعي) */

/* قراية JSON من رد الموديل حتى لو فيه غلطات بسيطة (فواصل زيادة، علامات تنصيص عربي) */
function doseJson_(t) {
  var a = String(t).indexOf('{'), b = String(t).lastIndexOf('}');
  if (a === -1 || b === -1) return null;
  var s = String(t).slice(a, b + 1);
  try { return JSON.parse(s); } catch (e) {}
  try {
    var r = s.replace(/[\u201C\u201D\u201E]/g, '"').replace(/,\s*([}\]])/g, '$1').replace(/[\u0000-\u001F]+/g, ' ');
    return JSON.parse(r);
  } catch (e) {}
  return null;
}
function aiDose(payload) {
  try {
    var p = JSON.parse(payload || '{}');
    var cfg = aiCfg_();
    if (!cfg.key) return { ok: false, error: 'مفتاح الذكاء الاصطناعي مش متحط — الجرعات هتتكتب يدوي' };
    var items = (p.items || []).slice(0, 12);
    if (!items.length) return { ok: true, items: [] };
    /* الأصناف اللي واضح من اسمها إنها مش أدوية بنرد عليها من غير موديل */
    var ndIdx = {};
    items.forEach(function (it, i) { if (nonDrugByName_(it.name)) ndIdx[i + 1] = 1; });
    if (Object.keys(ndIdx).length === items.length)
      return { ok: true, model: 'code', items: items.map(function (it, i) { return { n: i + 1, nondrug: true, label: '' }; }), interactions: '' };
    var who = 'Age: ' + p.age + ' years' + (p.weight ? ', weight: ' + p.weight + ' kg' : '') +
      ', pregnancy/breastfeeding: ' + ({ none: 'no', pregnant: 'PREGNANT', breast: 'BREASTFEEDING' }[p.preg] || 'unknown');
    var list = items.map(function (it, i) {
      return (i + 1) + '. ' + it.name + (it.active ? '  [active ingredient from pharmacy database: ' + it.active + ']' : '') + (it.qty > 1 ? '  x' + it.qty : '');
    }).join('\n');
    var prompt =
      'You are a clinical pharmacist assistant at a community pharmacy in Egypt. A pharmacist will REVIEW every suggestion before printing; your job is an accurate draft.\n' +
      'Patient: ' + who + '\n\nInvoice items (Egyptian trade names):\n' + list + '\n\n' +
      'For EACH item:\n' +
      '- Identify active ingredient(s), strength and dosage form. If a database active ingredient is given, use it. Otherwise only identify it if you are CERTAIN of this exact Egyptian product; NEVER guess from name similarity. If not certain: known=false and label="".\n' +
      '- If it is not a medicine (cosmetic, supply, device, food): nondrug=true, label="".\n' +
      '- Give the standard dose for this patient per BNF/BNFc-style references. Children: weight-based, and convert to mL for liquids using the product strength; put the math in "calc" (e.g. "45mg/kg/day ÷2 × 16kg = 360mg = 4 mL").\n' +
      '- Cap at the maximum dose; if below the minimum licensed age or contraindicated for this patient (incl. pregnancy/breastfeeding), leave label="" and explain in "warn".\n' +
      '- Chronic prescription medicines (antihypertensives, antidiabetics, etc.): label "حسب الروشتة" plus the usual frequency if standard.\n' +
      '- label = the sticker text in short Egyptian Arabic, max 60 characters, e.g. "4 مل كل 12 ساعة بعد الأكل لمدة 7 أيام" or "قرص كل 8 ساعات عند اللزوم".\n' +
      '- warn = short Arabic warning for the pharmacist only (empty if none).\n' +
      '- confidence = high | medium | low.\n' +
      'Also check interactions or therapeutic duplication BETWEEN the items; put a short Arabic note in "interactions" (empty if none).\n\n' +
      'Reply with JSON only:\n{"items":[{"n":1,"active":"","label":"","calc":"","warn":"","confidence":"high","known":true,"nondrug":false}],"interactions":""}';
    /* سلسلة احتياطي: الموديل المختار → محاولة تانية بعد ثانيتين → Gemini Flash → Flash-Lite */
    AI_LAST_ERR = '';
    var used = cfg.provider + ' · ' + cfg.dose;
    var t = aiCall_(cfg.provider, cfg.key, cfg.dose, prompt, 2500, 'dose');
    if (!t) { Utilities.sleep(2000); t = aiCall_(cfg.provider, cfg.key, cfg.dose, prompt, 2500, 'dose'); }
    var gk = aiKey_('GEMINI_API_KEY') || GEMINI_API_KEY;
    if (!t && !(cfg.provider === 'gemini' && cfg.dose === AI_DEFAULTS.gemini.dose)) { used = 'gemini · ' + AI_DEFAULTS.gemini.dose; t = aiCall_('gemini', gk, AI_DEFAULTS.gemini.dose, prompt, 2500, 'dose'); }
    if (!t) { used = 'gemini · ' + GEMINI_MODEL; t = aiCall_('gemini', gk, GEMINI_MODEL, prompt, 2500, 'dose'); }
    if (!t) return { ok: false, error: 'الذكاء الاصطناعي مردش' + (AI_LAST_ERR ? ' — ' + AI_LAST_ERR : '') };
    var out = doseJson_(t);
    if (!out) {   /* الرد مش JSON سليم → محاولة تانية بنفس الموديل */
      var t2 = aiCall_(used.split(' · ')[0], used.indexOf('gemini') === 0 ? gk : cfg.key, used.split(' · ')[1], prompt, 2500, 'dose');
      out = t2 ? doseJson_(t2) : null;
    }
    if (!out) return { ok: false, error: 'رد الذكاء الاصطناعي اتلخبط — دوس "أعد التوليد"' };
    var outItems = (out.items || []).map(function (x) { if (ndIdx[x.n]) { x.nondrug = true; x.label = ''; } return x; });
    return { ok: true, model: used, items: outItems, interactions: out.interactions || '' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
