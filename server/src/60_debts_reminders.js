// ==== MODULE 60_debts_reminders (split from server/Code.js; load order = file name order) ====


// ===================================================================
// 💳 تذكير العملاء المتأخرين في السداد — يدوي أو أسبوعي تلقائي
// ===================================================================
var DEBT_REMINDER_LOG_SHEET = 'رسائل تذكير الديون';
var DEBT_OVERDUE_DAYS = 30;
var DEBT_REMINDER_MIN_INTERVAL_DAYS = 7; // متبعتش لنفس العميل أكتر من مرة كل 7 أيام

function getDebtReminderLogSheet_() {
  var ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
  var sheet = ss.getSheetByName(DEBT_REMINDER_LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(DEBT_REMINDER_LOG_SHEET);
    sheet.appendRow(['التاريخ', 'رقم التليفون', 'اسم العميل', 'المبلغ', 'الحالة', 'الوقت']);
    sheet.getRange('B:B').setNumberFormat('@');
  }
  return sheet;
}

function debtReminderMessage_(name, amount) {
  return 'صيدلية السوسي: يا ' + name + '، تذكير بسيط إن عليك حساب متبقي ' + Math.round(amount) + ' جنيه — تقدر تسدده وقت راحتك. 01143404023';
}

// إرسال يدوي لعميل واحد (بيتنادى من زرار "بعت تذكير" في الداشبورد)
function sendDebtReminderSMS_(phone, name, amount) {
  try {
    var canon = canonicalEgyptPhone_(String(phone || ''));
    if (!isValidEgyptianPhone(canon)) return { ok: false, error: 'رقم غير صحيح' };
    var msg = debtReminderMessage_(name, amount);
    var result = sendSMSViaAutoRemote(canon, msg);
    var today = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');
    var now = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss');
    getDebtReminderLogSheet_().appendRow([today, asSheetText_(canon), name || '', Math.round(amount), result.ok ? 'تم الإرسال للموبايل' : 'فشل', now]);
    return { ok: result.ok };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* من زرار الصيانة. مش بيتفعّل لوحده عشان بيبعت SMS للعملاء. */
function setupDebtReminderTrigger() {
  return ensureTriggers_({ which: 'sendWeeklyDebtReminders' });
}

// بتشتغل أوتوماتيك أسبوعيًا — بتبعت لكل عميل متأخر أكتر من 30 يوم ومبعتلوش خلال آخر 7 أيام
function sendWeeklyDebtReminders() {
  try {
    var data = getDebtsData();
    if (!data.ok || !data.debtors || !data.debtors.length) return;

    var logSheet = getDebtReminderLogSheet_();
    var logData = logSheet.getLastRow() > 1 ? logSheet.getRange(2, 1, logSheet.getLastRow() - 1, 6).getValues() : [];
    var lastSentByPhone = {};
    logData.forEach(function(r) {
      var ph = canonicalEgyptPhone_(String(r[1]));
      var when = new Date(r[5]);
      if (!lastSentByPhone[ph] || when > lastSentByPhone[ph]) lastSentByPhone[ph] = when;
    });

    var now = new Date();
    var sentCount = 0;

    data.debtors.forEach(function(c) {
      if (!c.phone || c.net <= 0) return;
      var lastActivity = new Date(c.lastActivity);
      var daysSince = Math.floor((now - lastActivity) / 86400000);
      if (daysSince < DEBT_OVERDUE_DAYS) return;

      var canon = canonicalEgyptPhone_(c.phone);
      var lastSent = lastSentByPhone[canon];
      if (lastSent) {
        var daysSinceSent = Math.floor((now - lastSent) / 86400000);
        if (daysSinceSent < DEBT_REMINDER_MIN_INTERVAL_DAYS) return;
      }

      sendDebtReminderSMS_(c.phone, c.name, c.net);
      sentCount++;
      Utilities.sleep(3000); // فاصل بسيط بين كل رسالة عشان الشبكة متحظرش الرقم
    });

    if (sentCount > 0) {
      sendTelegramStaff('✅ اتبعت ' + sentCount + ' رسالة تذكير ديون تلقائي', STAFF_GROUP);
    }
  } catch (e) {
    Logger.log('خطأ sendWeeklyDebtReminders: ' + e.message);
  }
}