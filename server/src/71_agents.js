// ==== MODULE 71_agents (split from server/Code.js; load order = file name order) ====


// ═══════════════════════════════════════════════════════════════════
// 🆕 نظام المندوبين (Agents / Referral System)
// المندوب يبعت SMS يبدأ بكلمة "مندوب" + اسم ورقم العميل.
// Tasker يبعتها كـ POST: {action:"agentReferral", agentPhone, messageText}
// ═══════════════════════════════════════════════════════════════════

var AGENT_KEYWORD          = 'مندوب';   // الكلمة اللي المندوب يبدأ بيها رسالته
var AGENT_MIN_INVOICE      = 100;       // أقل قيمة فاتورة تفعّل الإحالة (جنيه)
var AGENT_DEFAULT_COMMISSION = 15;      // العمولة الافتراضية (بتظهر في الداش بورد بس)
var AGENT_PENDING_SHEET    = 'عملاء معلّقين';
var AGENT_PAYMENTS_SHEET   = 'دفعات المندوبين';

// ===================================================================
// (1) الاستقبال والتسجيل — بتتنادى من doPost لما ييجي action=agentReferral
// ===================================================================
function handleAgentReferral(data) {
  try {
    var agentPhone = canonicalEgyptPhone_(data.agentPhone);
    var rawText    = String(data.messageText || '');
    logAgentDebug_('1-البداية', 'agentPhone_خام=' + data.agentPhone + ' | agentPhone_بعد_التنضيف=' + agentPhone + ' | نص_خام=' + rawText);

    var cleanText = normalizeAgentDigits_(rawText).trim();
    if (cleanText.indexOf(AGENT_KEYWORD) !== 0) {
      logAgentDebug_('2-اتوقف: مفيش كلمة مندوب', 'النص بعد التنضيف=' + cleanText);
      return { ok: false, ignored: true };
    }

    var body = cleanText.substring(AGENT_KEYWORD.length).trim();

    var noSpaces = body.replace(/(\d)\s+(\d)/g, '$1$2').replace(/(\d)\s+(\d)/g, '$1$2');
    var phoneMatch = noSpaces.match(/01[0125]\d{8}/);
    var customerPhone = phoneMatch ? canonicalEgyptPhone_(phoneMatch[0]) : '';

    var customerName = '';
    if (phoneMatch) {
      customerName = noSpaces.replace(phoneMatch[0], ' ').replace(/\s+/g, ' ').trim();
    } else {
      customerName = body.trim();
    }
    if (!customerName) customerName = 'عميل';
    logAgentDebug_('3-بعد الاستخراج', 'رقم_العميل=' + customerPhone + ' | اسم_العميل=' + customerName);

    // (أ) رقم العميل شكله غلط أو مش موجود
    if (!isValidEgyptianPhone(customerPhone)) {
      logAgentDebug_('4-رفض: رقم غلط', 'رقم_العميل=' + customerPhone);
      sendSMSViaAutoRemote(agentPhone,
        'الرقم اللي بعته مش مظبوط، ابعته تاني كده: مندوب اسم العميل 01000000000');
      return { ok: false, reason: 'invalid_phone' };
    }

    // (ب) المندوب بيرشّح نفسه؟ — مرفوض
    if (agentPhone && customerPhone === agentPhone) {
      logAgentDebug_('4-رفض: ترشيح ذاتي', 'agentPhone=' + agentPhone);
      sendSMSViaAutoRemote(agentPhone,
        'مينفعش ترشّح رقمك انت (' + customerPhone + ')، جرّب رقم تاني مش مسجّل');
      return { ok: false, reason: 'self_referral' };
    }

    // (ج) العميل مسجّل عندنا بالفعل؟
    logAgentDebug_('5-قبل فحص العميل المعروف', 'رقم_العميل=' + customerPhone);
    var __isKnown = isAgentCustomerKnown_(customerPhone);
    logAgentDebug_('6-بعد فحص العميل المعروف', 'النتيجة=' + __isKnown);
    if (__isKnown) {
      sendSMSViaAutoRemote(agentPhone,
        'الرقم ' + customerPhone + ' عميل حالي عندنا - جرّب رقم تاني مش مسجّل');
      logAgentDebug_('7-اترفض: معروف بالفعل', 'رقم_العميل=' + customerPhone);
      return { ok: false, reason: 'already_known' };
    }

    // (د) العميل ده متحال قبل كده؟ → أول واحد بس ياخده
    if (isAgentAlreadyPending_(customerPhone)) {
      sendSMSViaAutoRemote(agentPhone,
        'الرقم ' + customerPhone + ' اترشّح قبل كده - جرّب رقم تاني مش مسجّل');
      logAgentDebug_('7-اترفض: متحال قبل كده', 'رقم_العميل=' + customerPhone);
      return { ok: false, reason: 'duplicate_pending' };
    }

    // ---- كله تمام: نسجّل العميل معلّق ----
    var today = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');
    var now   = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss');

    var sheet = getOrCreateSheet_(AGENT_PENDING_SHEET, [
      'التاريخ', 'رقم المندوب', 'اسم العميل', 'رقم العميل', 'الحالة',
      'وقت التسجيل', 'وقت التفعيل', 'رقم الفاتورة', 'قيمة الفاتورة', 'العمولة'
    ]);
    sheet.getRange('D:D').setNumberFormat('@'); // رقم العميل نص
    sheet.getRange('B:B').setNumberFormat('@'); // رقم المندوب نص
    sheet.appendRow([today, agentPhone, customerName, asSheetText_(customerPhone), 'معلّق', now, '', '', '', '']);
    sheet.getRange(sheet.getLastRow(), 2).setValue(asSheetText_(agentPhone));

    // (1) رد فوري للمندوب — من غير أي ذكر لقيمة فلوس
    sendSMSViaAutoRemote(agentPhone,
      'تمام، سجّلنا ' + customerName + ' وهنبلّغك أول ما يعمل أول طلب - صيدلية السوسي');

    // (2) ترحيب للعميل الجديد (لحظة التسجيل)
    sendSMSViaAutoRemote(customerPhone,
      'أهلاً بيك في صيدلية السوسي، توصيل مجاني لحد باب بيتك، اطلب في أي وقت.');

    // (3) تنبيه جروب الموظفين عشان يدخّلوه يدوي على نظام البيع
    sendTelegramStaff(
      '🆕 عميل جديد من مندوب\n' + SEP + '\n' +
      'المندوب: ' + agentPhone + '\n' +
      'اسم العميل: ' + customerName + '\n' +
      'رقم العميل: ' + customerPhone + '\n\n' +
      '👈 من فضلكم سجّلوه على نظام البيع',
      STAFF_GROUP
    );

    logAgentDebug_('8-نجاح: اتسجّل معلّق', 'مندوب=' + agentPhone + ' | عميل=' + customerName + ' | رقم=' + customerPhone);
    return { ok: true, customer: customerName, phone: customerPhone };

  } catch (e) {
    logAgentDebug_('9-كراش داخل الدالة', e.message + ' | ' + (e.stack || ''));
    Logger.log('خطأ handleAgentReferral: ' + e.message);
    return { ok: false, error: e.message };
  }
}

// 📋 دالة التسجيل التشخيصي — بتكتب كل خطوة في شيت منفصل
function logAgentDebug_(stage, details) {
  try {
    var sheet = getOrCreateSheet_('سجل تشخيص المندوبين', ['الوقت', 'المرحلة', 'التفاصيل']);
    var now = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss');
    sheet.appendRow([now, stage, String(details || '').substring(0, 500)]);
  } catch (e) {
    // متعملش حاجة — التسجيل نفسه ميوقفش أي حاجة تانية
  }
}

// ===================================================================
// (2) التفعيل — بتتنادى من جوه processCustomerSMS لكل فاتورة
// ===================================================================
function activateAgentReferralIfPending_(customerPhone, invoiceid, invoiceValue) {
  try {
    if (!customerPhone) return;
    var canonPhone = canonicalEgyptPhone_(customerPhone);
    var ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
    var sheet = ss.getSheetByName(AGENT_PENDING_SHEET);
    if (!sheet || sheet.getLastRow() <= 1) return;

    var lastRow = sheet.getLastRow();
    var data = sheet.getRange(2, 1, lastRow - 1, 10).getValues();

    for (var i = 0; i < data.length; i++) {
      var rowPhone  = canonicalEgyptPhone_(data[i][3]);
      var rowStatus = String(data[i][4]);
      if (rowPhone !== canonPhone) continue;
      if (rowStatus !== 'معلّق') return; // موجود بس مفعّل قبل كده — نسيبه

      if (invoiceValue < AGENT_MIN_INVOICE) return;

      var rowIndex   = i + 2;
      var agentPhone = String(data[i][1]);
      var custName   = String(data[i][2]);
      var now = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss');

      sheet.getRange(rowIndex, 5).setValue('مفعّل');
      sheet.getRange(rowIndex, 7).setValue(now);
      sheet.getRange(rowIndex, 8).setValue(String(invoiceid));
      sheet.getRange(rowIndex, 9).setValue(Math.round(invoiceValue));
      sheet.getRange(rowIndex, 10).setValue(AGENT_DEFAULT_COMMISSION);

      sendSMSViaAutoRemote(agentPhone,
        custName + ' عمل أول طلب، تمام اتحسبلك - صيدلية السوسي');

      return; // خلصنا — عميل واحد لكل فاتورة
    }
  } catch (e) {
    Logger.log('خطأ activateAgentReferralIfPending_: ' + e.message);
  }
}

// ===================================================================
// (3) دوال العرض للداش بورد
// ===================================================================
function getAgentsData() {
  try {
    var ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
    var sheet = ss.getSheetByName(AGENT_PENDING_SHEET);
    if (!sheet || sheet.getLastRow() <= 1) return { ok: true, agents: [] };

    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 10).getValues();

    var paid = getAgentPaymentsMap_();
    var nameMap = getCRMPhoneNameMap_();
    var salesNameMap = getSalesPhoneNameMap_();

    var byAgent = {};
    data.forEach(function(r) {
      var agentPhone = canonicalEgyptPhone_(r[1]);
      var custName   = String(r[2]);
      var custPhone  = canonicalEgyptPhone_(r[3]);
      var status     = String(r[4]);
      var regTime    = r[5];
      var actTime    = r[6];
      var commission = parseFloat(r[9]) || 0;

      if (!byAgent[agentPhone]) {
        byAgent[agentPhone] = {
          agentPhone: agentPhone,
          agentName: nameMap[agentPhone] || salesNameMap[agentPhone] || '',
          pending: 0, activated: 0,
          total_due: 0, customers: []
        };
      }
      var a = byAgent[agentPhone];
      if (status === 'معلّق') a.pending++;
      if (status === 'مفعّل') { a.activated++; a.total_due += commission; }
      a.customers.push({
        name: custName, phone: custPhone, status: status,
        regTime: regTime, actTime: actTime, commission: commission
      });
    });

    var agents = Object.keys(byAgent).map(function(ph) {
      var a = byAgent[ph];
      var paidAmount = paid[ph] || 0;
      a.total_paid = paidAmount;
      a.balance = a.total_due - paidAmount;
      return a;
    });

    agents.sort(function(x, y){ return y.balance - x.balance; });

    return { ok: true, agents: agents };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// خريطة {رقم المندوب: إجمالي المدفوع}
function getAgentPaymentsMap_() {
  var map = {};
  try {
    var ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
    var sheet = ss.getSheetByName(AGENT_PAYMENTS_SHEET);
    if (!sheet || sheet.getLastRow() <= 1) return map;
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
    data.forEach(function(r) {
      var ph = canonicalEgyptPhone_(r[1]);
      var amount = parseFloat(r[2]) || 0;
      map[ph] = (map[ph] || 0) + amount;
    });
  } catch (e) {}
  return map;
}

// تسجيل دفعة لمندوب (بتتنادى من doPost: action=payAgent)
function payAgent(agentPhone, amount) {
  try {
    agentPhone = canonicalEgyptPhone_(agentPhone);
    amount = parseFloat(amount) || 0;
    if (!agentPhone || amount <= 0) return { ok: false, error: 'بيانات ناقصة' };

    var sheet = getOrCreateSheet_(AGENT_PAYMENTS_SHEET, ['التاريخ', 'رقم المندوب', 'المبلغ']);
    sheet.getRange('B:B').setNumberFormat('@');
    var today = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');
    sheet.appendRow([today, asSheetText_(agentPhone), amount]);
    fxClearCache_('fx_home_bundle');
    return { ok: true, agentPhone: agentPhone, amount: amount };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// حذف سطر عميل معلّق/مفعّل من شيت المندوبين
function deleteAgentPendingRow(agentPhone, customerPhone) {
  try {
    var agentCanon = canonicalEgyptPhone_(agentPhone);
    var custCanon = canonicalEgyptPhone_(customerPhone);
    var ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
    var sheet = ss.getSheetByName(AGENT_PENDING_SHEET);
    if (!sheet || sheet.getLastRow() <= 1) return { ok: false, error: 'الشيت فاضي' };

    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 10).getValues();
    for (var i = 0; i < data.length; i++) {
      var rowAgent = canonicalEgyptPhone_(data[i][1]);
      var rowCust  = canonicalEgyptPhone_(data[i][3]);
      if (rowAgent === agentCanon && rowCust === custCanon) {
        sheet.deleteRow(i + 2);
        fxClearCache_('fx_home_bundle');
        return { ok: true };
      }
    }
    return { ok: false, error: 'السطر مش موجود' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ===================================================================
// مساعدات نظام المندوبين
// ===================================================================

// بيحوّل الأرقام العربية والفارسية لإنجليزية
function normalizeAgentDigits_(s) {
  return String(s || '')
    .replace(/[٠-٩]/g, function(d){ return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); })
    .replace(/[۰-۹]/g, function(d){ return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d); });
}

// 🔧 بيرجّع الرقم بصيغة مصرية موحّدة: 11 رقم تبدأ بـ 0 (01xxxxxxxxx)
function canonicalEgyptPhone_(raw) {
  var s = normalizeAgentDigits_(String(raw || '')).replace(/[^\d]/g, '');
  if (!s) return '';
  // كود الدولة 20 + رقم مصري → شيل الـ 20 وحط 0
  if (s.indexOf('20') === 0 && (s.length === 12 || s.length === 13)) {
    s = '0' + s.substring(2);
  }
  // الرقم 10 خانات ومش بادئ بصفر → غالباً الصفر ضاع (تخزين كعدد) → رجّعه
  if (s.length === 10 && s.indexOf('0') !== 0) {
    s = '0' + s;
  }
  return s;
}

// بيجهّز القيمة عشان تتخزن في الشيت كنص فعلي
function asSheetText_(v) {
  var s = String(v || '');
  return s ? ("'" + s) : s;
}

// العميل معروف عندنا؟ بنفحص في مصدرين
function isAgentCustomerKnown_(phone) {
  var canon = canonicalEgyptPhone_(phone);
  if (!canon) return false;

  try {
    var props = PropertiesService.getScriptProperties();
    var known = JSON.parse(props.getProperty('knownCustomers') || '{}');
    for (var k in known) {
      if (canonicalEgyptPhone_(k) === canon) return true;
    }
  } catch (e) {}

  try {
    if (getCRMPhoneNameMap_()[canon] !== undefined) return true;
  } catch (e) {}

  return false;
}

// خريطة {رقم كانوني: اسم} من شيت عملاء الـ CRM (كاش 10 دقايق)
function getCRMPhoneNameMap_() {
  try {
    var cache = CacheService.getScriptCache();
    var cached = cache.get('crm_phone_name_map');
    if (cached) return JSON.parse(cached);

    var map = {};
    var ss = SpreadsheetApp.openById(CRM_SHEET_ID);
    var sheet = ss.getSheetByName('Customers');
    if (sheet && sheet.getLastRow() > 1) {
      var mapCols = getHeaderMap(sheet);
      if (mapCols['phone'] !== undefined && mapCols['name'] !== undefined) {
        var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
        data.forEach(function(r) {
          var ph = canonicalEgyptPhone_(r[mapCols['phone']]);
          if (ph) map[ph] = String(r[mapCols['name']] || '');
        });
      }
    }
    cache.put('crm_phone_name_map', JSON.stringify(map), 600);
    return map;
  } catch (e) {
    return {};
  }
}

// خريطة احتياطية {رقم: اسم} من سجل رسايل المبيعات
function getSalesPhoneNameMap_() {
  try {
    var cache = CacheService.getScriptCache();
    var cached = cache.get('sales_phone_name_map');
    if (cached) return JSON.parse(cached);

    var map = {};
    var sheet = getSMSLogSheet_();
    if (sheet.getLastRow() > 1) {
      var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
      data.forEach(function(r) {
        var ph = canonicalEgyptPhone_(r[3]);
        var nm = String(r[2] || '');
        if (ph && nm) map[ph] = nm;
      });
    }
    cache.put('sales_phone_name_map', JSON.stringify(map), 600);
    return map;
  } catch (e) {
    return {};
  }
}

// العميل متحال قبل كده (موجود في شيت المعلّقين)؟
function isAgentAlreadyPending_(phone) {
  try {
    var canon = canonicalEgyptPhone_(phone);
    var ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
    var sheet = ss.getSheetByName(AGENT_PENDING_SHEET);
    if (!sheet || sheet.getLastRow() <= 1) return false;
    var data = sheet.getRange(2, 4, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < data.length; i++) {
      if (canonicalEgyptPhone_(data[i][0]) === canon) return true;
    }
    return false;
  } catch (e) { return false; }
}

// 🧪 اختبار الاستقبال من غير Tasker — شغّلها من المحرر
function testAgentReferral() {
  var fake = {
    action: 'agentReferral',
    agentPhone: '01111111111',
    messageText: 'مندوب أحمد علي ٠١٠٠١٢٣٤٥٦٧'
  };
  var res = handleAgentReferral(fake);
  Logger.log(JSON.stringify(res, null, 2));
}

// 🧪 اختبار كانونيكال الأرقام
function testCanonicalPhone() {
  var tests = [
    ['201010002409', '01010002409'],  // كود دولة + صفر ضايع
    ['1001848071', '01001848071'],    // صفر ضايع بس
    ['01001848071', '01001848071'],   // سليم أصلاً
    ['٠١٠٠١٢٣٤٥٦٧', '01001234567']    // أرقام عربية
  ];
  tests.forEach(function(t) {
    var result = canonicalEgyptPhone_(t[0]);
    Logger.log(t[0] + ' → ' + result + (result === t[1] ? ' ✅' : ' ❌ (متوقع ' + t[1] + ')'));
  });
}

// ═══════════════════════════════════════════════════════════════════
// 🛠️ أدوات تشخيص وصيانة نظام المندوبين
// ═══════════════════════════════════════════════════════════════════

// 🧹 يمسح السجل التشخيصي القديم (يسيب صف العناوين بس)
function clearAgentDebugLog() {
  try {
    var ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
    var sheet = ss.getSheetByName('سجل تشخيص المندوبين');
    if (!sheet) { Logger.log('السجل مش موجود'); return; }
    var last = sheet.getLastRow();
    if (last > 1) sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).clearContent();
    Logger.log('✅ اتمسح السجل التشخيصي — جاهز للتجارب الجديدة');
  } catch (e) {
    Logger.log('خطأ: ' + e.message);
  }
}

// 🧪 اختبار مباشر لإرسال SMS — بيجرّب AutoRemote لوحده
function testDirectSMS() {
  var testPhone = '01120372238';  // ← غيّره لرقمك لو حبيت
  var testMsg = 'اختبار مباشر من السيستم - صيدلية السوسي';

  Logger.log('جاري الإرسال لـ: ' + testPhone);
  var result = sendSMSViaAutoRemote(testPhone, testMsg);
  Logger.log('كود الرد: ' + result.code);
  Logger.log('رد AutoRemote: ' + result.response);
  Logger.log('نجح؟ ' + (result.ok ? 'أيوه ✅' : 'لأ ❌'));

  if (result.ok) {
    Logger.log('');
    Logger.log('👉 لو الكود 200 و OK لكن الرسالة مجتلكش على الموبايل،');
    Logger.log('   يبقى AutoRemote استقبل الأمر لكن Tasker مش بينفّذه.');
    Logger.log('   الحل: راجع مهمة Tasker (فعل Send SMS + متغيّرات %arpar1 و %arpar2)');
  }
}

// 📊 يعرض آخر 20 سطر من السجل التشخيصي في اللوج
function showLastDebugLines() {
  try {
    var ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
    var sheet = ss.getSheetByName('سجل تشخيص المندوبين');
    if (!sheet || sheet.getLastRow() <= 1) { Logger.log('السجل فاضي'); return; }
    var last = sheet.getLastRow();
    var start = Math.max(2, last - 19);
    var rows = sheet.getRange(start, 1, last - start + 1, 3).getValues();
    Logger.log('═══ آخر ' + rows.length + ' سطر ═══');
    rows.forEach(function(r) {
      Logger.log(r[0] + ' | ' + r[1] + ' | ' + r[2]);
    });
  } catch (e) {
    Logger.log('خطأ: ' + e.message);
  }
}

// 🔄 يعيد إرسال آخر رد فشل
function retryLastAgentReply(phone, message) {
  phone = phone || '01120372238';
  message = message || 'تجربة إعادة إرسال - صيدلية السوسي';
  var r = sendSMSViaAutoRemote(phone, message);
  Logger.log('النتيجة: كود=' + r.code + ' | رد=' + r.response);
}