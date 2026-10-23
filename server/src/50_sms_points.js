// ==== MODULE 50_sms_points (split from server/Code.js; load order = file name order) ====


// 🆕 إعدادات نظام رسائل SMS + نقاط الولاء
const AUTOREMOTE_KEY = secret_('AUTOREMOTE_KEY');
const AUTOREMOTE_URL = 'https://autoremotejoaomgcd.appspot.com/sendmessage';
const SMS_LOG_SHEET = 'رسائل SMS';
const POINTS_SHEET = 'نقاط العملاء';
const INVALID_PHONE_SHEET = 'أرقام تحتاج مراجعة';

// ===================================================================
// 🆕 نظام رسائل SMS الترحيبية + نقاط الولاء - يشتغل مع كل فاتورة جديدة
// بيستخدم نفس آلية checkStaffOrders() (كل دقيقة)، ومربوط جوّاها
// ===================================================================

// ✅ يتأكد إن الرقم شكله رقم موبايل مصري صحيح (11 رقم، بادئة 010/011/012/015)
function isValidEgyptianPhone(phone) {
  if (!phone) return false;
  var clean = String(phone).trim();
  return /^01[0125][0-9]{8}$/.test(clean);
}

// ✅ بياخد أول كلمتين بس من اسم العميل
function getFirstTwoWords(name) {
  if (!name) return 'عميلنا العزيز';
  var words = String(name).trim().split(/\s+/);
  return words.slice(0, 2).join(' ');
}

// ✅ يحسب النقاط: 5% من قيمة الفاتورة قبل الخصم، مطروح منها الخصم، بحد أدنى صفر
function calculatePoints(grandtotal, discount) {
  var basePoints = Math.round((grandtotal || 0) * 0.05);
  var finalPoints = basePoints - Math.round(discount || 0);
  return Math.max(0, finalPoints);
}

// ✅ يقرا ملف مبيعات يوم معين، ويرجع كل فاتورة (unique) مرة واحدة بس
function getUniqueSaleInvoices(dateStr) {
  var folder = DriveApp.getFolderById(SALES_FOLDER);
  var content = '';
  var files = folder.getFilesByName('sales' + dateStr + '.txt');
  if (files.hasNext()) content = files.next().getBlob().getDataAsString('UTF-8');
  if (!content) return {};

  var regex = /VALUES\s*\(((?:&#\d+;|[^;])+)\)/g;
  var match;
  var invoices = {};

  while ((match = regex.exec(content)) !== null) {
    var tuples = extractTuples('(' + match[1] + ')');
    for (var t = 0; t < tuples.length; t++) {
      try {
        var vals = parseValues(tuples[t]);
        if (!vals || vals.length < 50) continue;

        var invoiceid = vals[1];
        var invtype = vals[2] ? vals[2].trim() : '';
        if (invtype !== 'sale') continue;
        if (invoices[invoiceid]) continue;

        var discount = parseFloat(vals[27]) || 0;
        var netpaid = parseFloat(vals[35]) || 0;
        var paid2 = parseFloat(vals[39]) || 0;
        var realPaid = netpaid + paid2;
        var grandtotal = parseFloat(vals[40]) || 0;
        var customername = vals[44] ? vals[44].trim() : '';
        var customerphone = vals[45] ? vals[45].trim() : '';

        invoices[invoiceid] = {
          invoiceid: invoiceid,
          customername: customername,
          customerphone: customerphone,
          discount: discount,
          grandtotal: grandtotal,
          realPaid: Math.round(realPaid)
        };
      } catch (e) { continue; }
    }
  }
  return invoices;
}

// ✅ يبني نص رسالة SMS العميل (مختصرة، رسالة واحدة)
function buildCustomerSMSMessage(firstName, amount) {
  return 'أهلاً يا ' + firstName + ' فاتورتك ' + amount + ' جنيه توصيلك مجانًا دايمًا - صيدلية السوسي';
}

// ✅ يبعت SMS فعلي عن طريق AutoRemote (تنسيق =:= المتفق عليه مع Tasker)
function sendSMSViaAutoRemote(phone, message) {
  try {
    var payload = phone + '=:=' + message;  // 🔧 فاصل خاص بينا — Tasker هو اللي بيقسّمه (مش AutoRemote)
    var url = AUTOREMOTE_URL + '?key=' + encodeURIComponent(AUTOREMOTE_KEY) + '&message=' + encodeURIComponent(payload);
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var code = res.getResponseCode();
    var body = res.getContentText();
    // 🔍 تسجيل تشخيصي: بيوضّح هل AutoRemote استقبل الطلب ولا لأ
    try {
      logAgentDebug_('📤 إرسال SMS', 'لـ=' + phone + ' | كود_الرد=' + code + ' | رد_AutoRemote=' + String(body).substring(0, 200));
    } catch (e2) {}
    return { ok: code === 200, code: code, response: body };
  } catch (e) {
    try { logAgentDebug_('📤 فشل إرسال SMS', 'لـ=' + phone + ' | خطأ=' + e.message); } catch (e2) {}
    return { ok: false, code: 0, response: e.message };
  }
}

// ✅ يجيب كل رقم فاتورة اتعالجت بالفعل - عشان مانعالجش نفس الفاتورة مرتين
function getAlreadyProcessedInvoiceIds() {
  var ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
  var sheet = ss.getSheetByName(SMS_LOG_SHEET);
  var ids = new Set();
  if (!sheet || sheet.getLastRow() <= 1) return ids;
  var data = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues();
  data.forEach(function(r) { if (r[0]) ids.add(String(r[0])); });
  return ids;
}

function getSMSLogSheet_() {
  var ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
  var sheet = ss.getSheetByName(SMS_LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(SMS_LOG_SHEET);
    sheet.appendRow(['التاريخ', 'رقم الفاتورة', 'اسم العميل', 'رقم التليفون', 'المبلغ', 'نص الرسالة', 'الحالة', 'وقت المحاولة']);
    sheet.getRange('D:D').setNumberFormat('@'); // 🔧 يمنع اختفاء الصفر الأول من رقم التليفون
  }
  return sheet;
}

function logSMSAttempt(row) {
  getSMSLogSheet_().appendRow(row);
}

function logInvalidPhone(row) {
  var ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
  var sheet = ss.getSheetByName(INVALID_PHONE_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(INVALID_PHONE_SHEET);
    sheet.appendRow(['التاريخ', 'رقم الفاتورة', 'اسم العميل', 'الرقم المسجل', 'المبلغ']);
    sheet.getRange('D:D').setNumberFormat('@');
  }
  sheet.appendRow(row);
}

function logPoints(row) {
  var ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
  var sheet = ss.getSheetByName(POINTS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(POINTS_SHEET);
    sheet.appendRow(['التاريخ', 'رقم الفاتورة', 'رقم التليفون', 'اسم العميل', 'قيمة الفاتورة', 'الخصم', 'النقاط المكتسبة']);
    sheet.getRange('C:C').setNumberFormat('@');
  }
  sheet.appendRow(row);
}

// ✅ الدالة الرئيسية: بتتنفذ كل دقيقة (مربوطة جوّا checkStaffOrders)
function processCustomerSMS() {
  try {
    var today = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');
    var now = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss');
    var invoices = getUniqueSaleInvoices(today);
    var alreadyProcessed = getAlreadyProcessedInvoiceIds();

    Object.keys(invoices).forEach(function(invoiceid) {
      if (alreadyProcessed.has(String(invoiceid))) return;

      var inv = invoices[invoiceid];
      inv.customerphone = canonicalEgyptPhone_(inv.customerphone); // 🔧 يرجّع الصفر الأول لو ضايع من نظام البيع
      var phoneValid = isValidEgyptianPhone(inv.customerphone);

      if (!phoneValid) {
        if (inv.customerphone && inv.customerphone.trim() !== '') {
          logInvalidPhone([today, invoiceid, inv.customername, inv.customerphone, inv.realPaid]);
        }
        return;
      }

      var points = calculatePoints(inv.grandtotal, inv.discount);
      logPoints([today, invoiceid, inv.customerphone, inv.customername, inv.realPaid, inv.discount, points]);

      var firstName = getFirstTwoWords(inv.customername);
      var message = buildCustomerSMSMessage(firstName, inv.realPaid);

      var result = sendSMSViaAutoRemote(inv.customerphone, message);
      logSMSAttempt([
        today, invoiceid, inv.customername, inv.customerphone,
        inv.realPaid, message, result.ok ? 'تم الإرسال للموبايل' : 'فشل', now
      ]);

      // 🆕 مندوبين: لو العميل ده معلّق تحت مندوب واشترى ≥ الحد الأدنى، فعّل الإحالة
      activateAgentReferralIfPending_(inv.customerphone, invoiceid, inv.realPaid);
    });

    fxClearCache_('fx_sms_30'); // فيه رسايل جديدة → نفضّي الكاش عشان الداشبورد يشوفها فورًا
  } catch (e) {
    Logger.log('خطأ processCustomerSMS: ' + e.message);
  }
}

// ✅ إعادة إرسال رسالة فشلت (بتستخدم نفس البيانات المخزنة في السجل)
function retryFailedSMS(invoiceid) {
  var sheet = getSMSLogSheet_();
  if (sheet.getLastRow() <= 1) return;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][1]) !== String(invoiceid)) continue;
    var phone = canonicalEgyptPhone_(String(data[i][3]));
    var message = data[i][5];
    var result = sendSMSViaAutoRemote(phone, message);
    var now = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss');
    sheet.getRange(i + 2, 7).setValue(result.ok ? 'تم الإرسال للموبايل' : 'فشل');
    sheet.getRange(i + 2, 8).setValue(now);
    fxClearCache_('fx_sms_30');
    return;
  }
}

// ===================================================================
// 🎁 إرسال كوبونات الاسترجاع عبر SMS — نفس مسار AutoRemote/Tasker
// ===================================================================
var COUPON_LOG_SHEET = 'رسائل الكوبونات';

function getCouponLogSheet_() {
  var ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
  var sheet = ss.getSheetByName(COUPON_LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(COUPON_LOG_SHEET);
    sheet.appendRow(['التاريخ', 'رقم التليفون', 'اسم العميل', 'نص الرسالة', 'الحالة', 'الوقت']);
    sheet.getRange('B:B').setNumberFormat('@');
  }
  return sheet;
}

// 🆕 بعد إرسال كوبون: العميل يدخل "متابعة" ومعاه تاريخ صلاحية الكوبون
function markCouponFollowUp_(ss, phone, expiryIso) {
  try {
    var custSheet = ss.getSheetByName('Customers');
    if (!custSheet || custSheet.getLastRow() <= 1) return;
    var map = getHeaderMap(custSheet);
    if (map['phone'] === undefined) return;
    var data = custSheet.getRange(2, 1, custSheet.getLastRow() - 1, custSheet.getLastColumn()).getValues();

    for (var i = 0; i < data.length; i++) {
      if (String(data[i][map['phone']]) !== String(phone)) continue;
      var rowIndex = i + 2;
      var status = map['status'] !== undefined ? data[i][map['status']] : '';
      var isBlocked = map['blocked'] !== undefined ? isTruthy(data[i][map['blocked']]) : false;
      if (isBlocked || status === 'نشط') return;

      if (map['status'] !== undefined) custSheet.getRange(rowIndex, map['status'] + 1).setValue('تمت المتابعة - في الانتظار');
      if (map['contact_marked_at'] !== undefined) custSheet.getRange(rowIndex, map['contact_marked_at'] + 1).setValue(new Date().toISOString());
      if (map['follow_deadline'] !== undefined && expiryIso) custSheet.getRange(rowIndex, map['follow_deadline'] + 1).setValue(expiryIso);
      if (map['follow_attempts'] !== undefined) {
        var cur = parseInt(data[i][map['follow_attempts']]) || 0;
        custSheet.getRange(rowIndex, map['follow_attempts'] + 1).setValue(cur + 1);
      }
      return;
    }
  } catch (e) {
    Logger.log('خطأ markCouponFollowUp_: ' + e.message);
  }
}

// 🆕 تشغيل يومي — أي عميل "في الانتظار" وخلصت مهلته من غير ما يشتري يرجع للحالة المناسبة
function checkExpiredCoupons() {
  try {
    var ss = SpreadsheetApp.openById(CRM_SHEET_ID);
    var custSheet = ss.getSheetByName('Customers');
    if (!custSheet || custSheet.getLastRow() <= 1) return;
    var map = getHeaderMap(custSheet);
    if (map['status'] === undefined || map['follow_deadline'] === undefined) return;

    var data = custSheet.getRange(2, 1, custSheet.getLastRow() - 1, custSheet.getLastColumn()).getValues();
    var now = new Date();
    var reverted = 0, lost = 0;

    for (var i = 0; i < data.length; i++) {
      var status = data[i][map['status']];
      var expiry = data[i][map['follow_deadline']];
      if (status !== 'تمت المتابعة - في الانتظار' || !expiry) continue;
      var expDate = new Date(expiry);
      if (isNaN(expDate.getTime()) || expDate > now) continue;

      var attempts = map['follow_attempts'] !== undefined ? (parseInt(data[i][map['follow_attempts']]) || 0) : 0;
      var newStatus = attempts >= FOLLOWUP_MAX_ATTEMPTS ? 'محاولات استرجاع فشلت' : 'تنبيه';

      custSheet.getRange(i + 2, map['status'] + 1).setValue(newStatus);
      custSheet.getRange(i + 2, map['follow_deadline'] + 1).setValue('');
      if (newStatus === 'محاولات استرجاع فشلت') lost++; else reverted++;
    }
    if (reverted > 0 || lost > 0) {
      Logger.log('✅ رجّعنا ' + reverted + ' عميل لتنبيه، ونقلنا ' + lost + ' عميل لـ فقد (3 محاولات من غير شراء)');
    }
  } catch (e) {
    Logger.log('خطأ checkExpiredCoupons: ' + e.message);
  }
}

/* من زرار الصيانة. مش بيتفعّل لوحده عشان بيعدّل حالة متابعة العملاء. */
function setupCouponExpiryTrigger() {
  return ensureTriggers_({ which: 'checkExpiredCoupons' });
}

function sendCouponSMS_(phone, name, message, expiryIso) {
  try {
    var canon = canonicalEgyptPhone_(String(phone || ''));
    if (!isValidEgyptianPhone(canon)) return { ok: false, error: 'رقم غير صحيح' };
    if (!message) return { ok: false, error: 'الرسالة فاضية' };

    var result = sendSMSViaAutoRemote(canon, message);
    var today = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');
    var now = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss');
    getCouponLogSheet_().appendRow([today, asSheetText_(canon), name || '', message, result.ok ? 'تم الإرسال للموبايل' : 'فشل', now]);
    fxClearCache_('fx_sms_30');

    if (result.ok) {
      var ss = SpreadsheetApp.openById(CRM_SHEET_ID);
      markCouponFollowUp_(ss, canon, expiryIso);
    }
    return { ok: result.ok, phone: canon };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ✅ تأكيد من تليفون الصيدلية: Tasker بيبعته بعد ما يحاول يبعت SMS فعلي
function recordSmsAck(phone, err) {
  try {
    var canon = canonicalEgyptPhone_(phone);
    if (!canon) return { ok: false, error: 'رقم ناقص' };
    var sheet = getSMSLogSheet_();
    if (sheet.getLastRow() <= 1) return { ok: false, error: 'السجل فاضي' };

    var ok = (String(err || '0').trim() === '0');
    var newStatus = ok ? '✅ اتبعت من التليفون' : '❌ التليفون مبعتهاش';
    var now = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss');

    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();
    for (var i = data.length - 1; i >= 0; i--) {
      if (canonicalEgyptPhone_(data[i][3]) !== canon) continue;
      sheet.getRange(i + 2, 7).setValue(newStatus);
      sheet.getRange(i + 2, 8).setValue(now);
      fxClearCache_('fx_sms_30');
      return { ok: true, phone: canon, status: newStatus };
    }
    return { ok: false, error: 'مفيش سطر للرقم ده' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ✅ رفض رسالة فشلت (تتعلم كـ"متجاهلة نهائيًا" ومتظهرش تاني في قائمة "فشلت")
function dismissFailedSMS(invoiceid) {
  var sheet = getSMSLogSheet_();
  if (sheet.getLastRow() <= 1) return;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][1]) !== String(invoiceid)) continue;
    sheet.getRange(i + 2, 7).setValue('متجاهلة');
    fxClearCache_('fx_sms_30');
    return;
  }
}

// ✅ يرجع رصيد النقاط الكلي لعميل معين (مجموع كل سطوره في شيت النقاط)
function getCustomerPointsData(phone) {
  try {
    var ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
    var sheet = ss.getSheetByName(POINTS_SHEET);
    if (!sheet || sheet.getLastRow() <= 1) return { ok: true, phone: phone, total_points: 0, history: [] };
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
    var total = 0;
    var history = [];
    data.forEach(function(r) {
      if (String(r[2]) !== String(phone)) return;
      total += parseInt(r[6]) || 0;
      history.push({ date: r[0], invoiceid: String(r[1]), amount: r[4], discount: r[5], points: r[6] });
    });
    return { ok: true, phone: phone, total_points: total, history: history.reverse() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}