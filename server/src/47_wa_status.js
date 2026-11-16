/* حالة تسليم «failed» من ميتا: الرسالة اتقبلت من الـ API وبعدين ما اتسلّمتش للعميل (سبب شائع: 24 ساعة، أو ملف مرفوض).
   بنبعتها لـ NOVA كملاحظة في المحادثة بالسبب بالعربي. sent / delivered / read مش بنعمل بيهم حاجة. fire-and-forget: عمرها ما بترمي. */
var WA_STATUS_REASONS_ = {
  131047: 'عدّى أكتر من 24 ساعة على آخر رسالة من العميل',
  131026: 'الرقم مش على واتساب أو العميل مش بيستقبل الرسايل',
  131053: 'واتساب رفض الملف (الصيغة أو الحجم)',
  131051: 'نوع الرسالة مش مدعوم عند العميل',
  131049: 'واتساب مش بيوصّل رسالتنا للعميل ده دلوقتي',
  131000: 'خطأ من واتساب',
  131008: 'بيانات الرسالة ناقصة',
  131009: 'بيانات الرسالة غير صالحة',
  131031: 'حساب واتساب الصيدلية متوقف',
  130429: 'رسايل كتير ورا بعض، واتساب وقّفها مؤقتًا',
  131056: 'رسايل كتير لنفس العميل، واتساب وقّفها مؤقتًا'
};
function waStatusNote_(st) {
  var errs = st && Object.prototype.toString.call(st.errors) === '[object Array]' ? st.errors : [];
  var e = errs[0] && typeof errs[0] === 'object' ? errs[0] : {}, code = Number(e.code) || 0;
  var why = WA_STATUS_REASONS_[code] || (e.title || e.message ? novaWaSafeErr_(e.title || e.message) : 'سبب غير معروف');
  return ('⚠️ واتساب ما سلّمش رسالتك للعميل — ' + why + (code ? ' (' + code + ')' : '')).slice(0, 300);
}
function waHandleStatuses_(list) {
  if (Object.prototype.toString.call(list) !== '[object Array]') return;
  list.forEach(function (st) {
    try {
      if (!st || typeof st !== 'object' || st.status !== 'failed' || !st.id) return;
      var to = String(st.recipient_id || '').replace(/\D/g, '');
      if (!to) return; /* مفيش رقم (يوزرنيم بس): مش هنعرف المحادثة */
      novaWaForward_({ id: 'fail_' + st.id, from: to, timestamp: st.timestamp, type: 'status_failed', text: waStatusNote_(st), direction: 'sys' });
    } catch (e) { try { Logger.log('waHandleStatuses_: ' + e.message); } catch (e2) {} }
  });
}
