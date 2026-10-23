// ==== MODULE 05_routing (split from server/Code.js; load order = file name order) ====


/* 🔒 قفل اللوحة (بيتفعّل من الإعدادات): بيانات المبيعات والعملاء والديون وطلب النواقص محتاجة الرقم السري.
   الصفحات التانية (الملصقات، الجرد، الدكاترة) والـ SMS والتليجرام مش بتتأثر.
   علامة "اتطلب" من بوت الجرد بتعدّي بمفتاح ORDERS_BOT_KEY من جوه markOrdered، مش من هنا. */
var LOCKED_GET = { getHomeBundle: 1, getSMSLogFast: 1, getSMSLog: 1, getCustomers: 1, getHistory: 1, getCustomerProfile: 1,
  getCustomerVisits: 1, getAiConfig: 1, getAiUsage: 1, botStatus: 1, getBlocked: 1, getDashboard: 1, getStaffKPI: 1,
  getNewCustomersDetail: 1, getSystemDailyTotals: 1, getDebtsData: 1, getDebtsByEmployee: 1, getMonthTotalsRaw: 1,
  sendDebtReminder: 1, getExpensesData: 1, getProfitLoss: 1, getNetWorth: 1, getConnecteamHours: 1, getDayInvoices: 1,
  getDayDebits: 1, getDayCollections: 1, getMonthDebtsSummary: 1, getCustomerPoints: 1, getInventoryAging: 1, getAgents: 1,
  sendCoupon: 1, getStaffHub: 1, getExpiryByMonth: 1, getAttendanceLive: 1, getAttendanceHistory: 1, getAttendanceLiveV2: 1,
  getAttendanceHistoryV2: 1, diagnoseAll: 1, getBotSettings: 1, maintenanceStatus: 1, maintenanceStop: 1,
  maintenanceResumeLive: 1, maintenanceDedup: 1, maintenanceStartRebuild: 1, backfillExpenses: 1, getExpReviews: 1,
  ordersPage: 1, orderEfficiency: 1, logShortages: 1 };
var LOCKED_POST = { log: 1, block: 1, unblock: 1, setSalaries: 1, retrySMS: 1, testSMS: 1, dismissSMS: 1, payAgent: 1,
  deleteAgentPending: 1, deleteCount: 1, expReview: 1 };
function dashLocked_(pin) {
  var P = PropertiesService.getScriptProperties();
  if (P.getProperty('DASH_LOCK') !== '1') return false;
  var saved = P.getProperty('ADMIN_PIN');
  return !(saved && String(pin || '') === saved);
}
function lockedResp_() { return jsonResponseStaff({ ok: false, lockError: true, error: 'اللوحة مقفولة — اكتب الرقم السري' }); }

function doGet(e) {
  /* 🟢 تأكيد ويبهوك واتساب من ميتا */
  if (e.parameter['hub.mode'] === 'subscribe')
    return ContentService.createTextOutput(e.parameter['hub.verify_token'] === waVerifyToken_() ? String(e.parameter['hub.challenge'] || '') : 'bad token');
  try { maybeEnsureTriggers_(); } catch (eT) {}
  var action = e.parameter.action;
  if (LOCKED_GET[action] && dashLocked_(e.parameter.pin)) return lockedResp_();
  if (action === 'getBotSettings') return jsonResponseStaff(getBotSettings());
  if (action === 'getExpReviews') return jsonResponseStaff(getExpReviews());
  if (action === 'serverUpdateInfo') return jsonResponseStaff(serverUpdateInfo());

  // 🆕 الأوامر السريعة الجديدة (نداء واحد للرئيسية، رسايل مقطوعة بمدة، حضور مصلّح، فحص شامل)
  if (action === 'getHomeBundle') return jsonResponseStaff(getHomeBundleFast());
  if (action === 'getSMSLogFast') return jsonResponseStaff(getSMSLogFast(e.parameter));
  if (action === 'getAttendanceLiveV2') return jsonResponseStaff(getAttendanceLiveV2());
  if (action === 'getAttendanceHistoryV2') return jsonResponseStaff(getAttendanceHistoryV2(e.parameter));
  if (action === 'diagnoseAll') return jsonResponseStaff(diagnoseAll());
  if (action === 'refreshNow') return jsonResponseStaff(refreshLiveNumbers());
  // 📷 الجرد بالكاميرا
  if (action === 'scanLookup')       return jsonResponseStaff(scanLookup(e.parameter.code));
  if (action === 'scanSearch')       return jsonResponseStaff(scanSearch(e.parameter.q));
  // 🩺 صفحة الدكاترة (بكود دخول)
  if (action === 'doctorSearch')     return jsonResponseStaff(doctorSearch(e.parameter.q, e.parameter.k));
  if (action === 'doctorOrder')      return jsonResponseStaff(doctorOrder(e.parameter.items, e.parameter.note, e.parameter.k));
  if (action === 'doctorAdmin')      return jsonResponseStaff(doctorAdmin(e.parameter));
  if (action === 'ordersPage')       return jsonResponseStaff(ordersPage(e.parameter.k, e.parameter.days));
  if (action === 'orderEfficiency')  return jsonResponseStaff(orderEfficiency(e.parameter.days));
  if (action === 'logShortages')     return jsonResponseStaff(logShortageSnapshot_(true));
  if (action === 'markOrdered') {
    var viaBot = ordersBotOk_(e.parameter.k || e.parameter.key);
    if (!viaBot && dashLocked_(e.parameter.pin)) return lockedResp_();
    return jsonResponseStaff(markOrdered_(e.parameter, viaBot));
  }
  if (action === 'ordersBotKey') {
    if (!adminPinOk_(e.parameter.pin))
      return jsonResponseStaff({ ok: false, pinError: true, error: aiKey_('ADMIN_PIN') ? 'الرقم السري غلط' : 'اختار رقم سري الأول من إعدادات الذكاء الاصطناعي' });
    return jsonResponseStaff(ensureOrdersBotKey_(e.parameter.regen === '1'));
  }
  if (action === 'scanReady')        return jsonResponseStaff(diagnoseScanReady());
  if (action === 'timeSnapshot')     return jsonResponseStaff(timeSnapshot());
  if (action === 'testSnapStore')    return jsonResponseStaff(testSnapStorage());
  if (action === 'scanRefreshIndex') return jsonResponseStaff(refreshScanIndex());
  if (action === 'countSessions')    return jsonResponseStaff(getCountSessions());
  if (action === 'countReport')      return jsonResponseStaff(getCountReport(e.parameter.session));
  if (action === 'openCounts')       return jsonResponseStaff(listOpenCounts(e.parameter));
  if (action === 'loadCount')        return jsonResponseStaff(loadOpenCount(e.parameter.session));
  if (action === 'countDue')         return jsonResponseStaff(getCountDue(e.parameter));
  if (action === 'countAccuracy')    return jsonResponseStaff(getCountAccuracy(e.parameter));
  if (action === 'backfillExpenses') return jsonResponseStaff(backfillExpenseArchive());
  if (action === 'recordStats')      return jsonResponseStaff(recordDailyStats_());
  if (action === 'fixOrder')         return jsonResponseStaff(getFixOrder(e.parameter.session));
  if (action === 'sendFixOrder')     return jsonResponseStaff(sendFixOrder(e.parameter.session));
  if (action === 'scanStaff')        return jsonResponseStaff(getScanStaff());
  if (action === 'scanBundle')       return jsonResponseStaff(getScanBundle());
  if (action === 'countActivity')    return jsonResponseStaff(getCountActivity(e.parameter));
  if (action === 'getStaffHub') return jsonResponseStaff(getStaffHub(e.parameter));
  if (action === 'snapshotStatus') return jsonResponseStaff(snapshotStatus());
  if (action === 'snapshotRefresh') { buildSnapshot(); return jsonResponseStaff(snapshotStatus()); }
  if (action === 'snapshotEnable') { setupSnapshotTrigger(); buildSnapshot(); return jsonResponseStaff(snapshotStatus()); }

  if (action === 'getCustomers') return jsonResponseStaff(
    cachedCall_('cust', {}, function(){ return { ok: true, list: getCustomers() }; }, 600));
  if (action === 'getHistory') return jsonResponseStaff(getHistory(e.parameter.phone));
  if (action === 'getCustomerProfile') return jsonResponseStaff(getCustomerProfile(e.parameter.phone));
  if (action === 'getCustomerVisits') return jsonResponseStaff(getCustomerVisits(e.parameter.days));
  /* 🔒 أوامر بتكلّف فلوس أو بتغيّر/تمسح حاجة — محتاجة الرقم السري */
  var ADMIN_ACTIONS = { aiTest: 1, botSetRelay: 1, backupProbe: 1, cleanBackups: 1, cleanBackupsAuto: 1,
                        purgeTrashedBackups: 1, aiDose: 1, serverUpdate: 1, setAutoUpdate: 1, ensureTriggers: 1,
                        getBotChats: 1, getBotChat: 1, getChatMedia: 1, botReply: 1, botHold: 1, botDone: 1, waInfo: 1, waSubscribe: 1 };
  if (ADMIN_ACTIONS[action] && !adminPinOk_(e.parameter.pin))
    return jsonResponseStaff({ ok: false, pinError: true, error: aiKey_('ADMIN_PIN') ? 'الرقم السري غلط' : 'اختار رقم سري الأول من إعدادات الذكاء الاصطناعي' });
  if (action === 'aiTest') return jsonResponseStaff(aiTest(e.parameter.q));
  if (action === 'getAiConfig') return jsonResponseStaff(getAiConfig());
  if (action === 'getAiUsage') return jsonResponseStaff(getAiUsage());
  if (action === 'botStatus') return jsonResponseStaff(botStatus());
  if (action === 'botSetRelay') return jsonResponseStaff(botSetRelay(e.parameter.url));
  if (action === 'backupProbe') return jsonResponseStaff(backupProbe());
  if (action === 'serverUpdate') return jsonResponseStaff(serverUpdate());
  if (action === 'setAutoUpdate') return jsonResponseStaff(setAutoUpdate(e.parameter.on === '1'));
  if (action === 'ensureTriggers') return jsonResponseStaff(ensureTriggers_({ which: e.parameter.which || '' }));
  if (action === 'getBotChats') return jsonResponseStaff(getBotChats());
  if (action === 'waInfo') return jsonResponseStaff(waInfo());
  if (action === 'waSubscribe') return jsonResponseStaff(waSubscribe());
  if (action === 'getBotChat') return jsonResponseStaff(getBotChat(e.parameter.id));
  if (action === 'getChatMedia') return jsonResponseStaff(getChatMedia(e.parameter.id, e.parameter.mid));
  if (action === 'botReply') return jsonResponseStaff(botReply(e.parameter.id, e.parameter.text));
  if (action === 'botHold') return jsonResponseStaff(botHold(e.parameter.id, e.parameter.on === '1'));
  if (action === 'botDone') return jsonResponseStaff(botDone(e.parameter.id));
  if (action === 'cleanBackups') return jsonResponseStaff(cleanBackups(e.parameter.apply === '1'));
  if (action === 'cleanBackupsAuto') return jsonResponseStaff(cleanBackupsAuto());
  if (action === 'purgeTrashedBackups') return jsonResponseStaff(purgeTrashedBackups());
  if (action === 'getBlocked') return jsonResponseStaff(getBlockedCustomers());
  if (action === 'getDashboard') return jsonResponseStaff(getDashboard(e.parameter));
  if (action === 'getStaffKPI') return jsonResponseStaff(
    cachedCall_('kpi', e.parameter, function(){ var r = getStaffKPIData(e.parameter); r.ok = true; return r; }, cacheTTL_(e.parameter)));
  if (action === 'getNewCustomersDetail') return jsonResponseStaff(getNewCustomersDetail(e.parameter));
  if (action === 'getSystemDailyTotals') return jsonResponseStaff(getSystemDailyTotals());
  if (action === 'getDebtsData') return jsonResponseStaff(getDebtsSnap());
  if (action === 'getDebtsByEmployee') return jsonResponseStaff(getDebtsByEmployee(e.parameter));
  if (action === 'getMonthTotalsRaw') return jsonResponseStaff(
    cachedCall_('mtr', e.parameter, function(){ return getMonthTotalsFromRaw(e.parameter); }, cacheTTL_(e.parameter)));
  if (action === 'sendDebtReminder') {
    return jsonResponseStaff(sendDebtReminderSMS_(e.parameter.phone, e.parameter.name, e.parameter.amount));
  }
  if (action === 'getExpensesData') return jsonResponseStaff(
    cachedCall_('exp', e.parameter, function(){ return getExpensesData(e.parameter); }, cacheTTL_(e.parameter)));
  if (action === 'getProfitLoss') return jsonResponseStaff(
    cachedCall_('pl', e.parameter, function(){ return getProfitLossData(e.parameter); }, 600));
  if (action === 'getNetWorth') return jsonResponseStaff(getNetWorthData());
  if (action === 'getConnecteamHours') return jsonResponseStaff(getConnecteamHours(e.parameter.from, e.parameter.to));
  if (action === 'getDayInvoices') return jsonResponseStaff(getDayInvoices(e.parameter.date));
  /* ملصقات الأدوية — الكود في آخر الملف */
  if (action === 'labelsFeed') return jsonResponseStaff(labelsFeed(e.parameter.since));
  if (action === 'labelsSave') return jsonResponseStaff(labelsSave(e.parameter.data));
  if (action === 'aiDose') return jsonResponseStaff(aiDose(e.parameter.data));
  if (action === 'getDayDebits') return jsonResponseStaff(getDayDebits(e.parameter.date));
  if (action === 'getDayCollections') return jsonResponseStaff(getDayCollections(e.parameter.date));
  if (action === 'getMonthDebtsSummary') return jsonResponseStaff(getMonthDebtsSummary(e.parameter.month));
  if (action === 'getSMSLog') return jsonResponseStaff(getSMSLogFast(e.parameter)); // بقى بيوجّه للنسخة السريعة
  if (action === 'getCustomerPoints') return jsonResponseStaff(getCustomerPointsData(e.parameter.phone));
  if (action === 'getInventoryAging') return jsonResponseStaff(getInventorySnap());
  if (action === 'getAgents') return jsonResponseStaff(getAgentsSnap());
  if (action === 'maintenanceStatus') return jsonResponseStaff(getMaintenanceStatus());
  if (action === 'maintenanceStop') {
    stopAutoRebuild(); pauseLiveTrigger();
    return jsonResponseStaff({ ok: true, step: 'stop' });
  }
  if (action === 'maintenanceResumeLive') {
    resumeLiveTrigger();
    return jsonResponseStaff({ ok: true, step: 'resumeLive' });
  }
  if (action === 'maintenanceDedup') {
    wipeAndRebuildStaffSheet();
    return jsonResponseStaff({ ok: true, step: 'dedup' });
  }
  if (action === 'maintenanceStartRebuild') {
    resetRebuildProgress(); startAutoRebuild();
    return jsonResponseStaff({ ok: true, step: 'rebuild' });
  }
  if (action === 'sendCoupon') {
    return jsonResponseStaff(sendCouponSMS_(e.parameter.phone, e.parameter.name, e.parameter.message, e.parameter.expiry));
  }
  if (action === 'getAttendanceLive') return jsonResponseStaff(getAttendanceLiveV2());
  if (action === 'getAttendanceHistory') return jsonResponseStaff(getAttendanceHistoryV2(e.parameter));
  if (action === 'getExpiryByMonth') return jsonResponseStaff(getExpiryByMonthSnap());
  return jsonResponseStaff({ status: 'ok', message: 'Staff API شغال' });
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    /* 🟢 واتساب */
    if (data.object === 'whatsapp_business_account') {
      handleWhatsAppWebhook_(data);
      return ContentService.createTextOutput('ok');
    }
    // 🆕 لو دي رسالة جاية من تليجرام (ويبهوك) — نعالجها ونخرج
    if (data.update_id !== undefined) {
      handleTelegramWebhook_(data);
      return ContentService.createTextOutput('ok');
    }

    if (LOCKED_POST[data.action] && dashLocked_(data.pin)) return lockedResp_();
    if (data.action === 'setBotSettings') return jsonResponseStaff(setBotSettings(data));
    if (data.action === 'setWaConfig') return jsonResponseStaff(adminPinOk_(data.pin) ? setWaConfig(data) : { ok: false, pinError: true, error: 'الرقم السري غلط' });
    if (data.action === 'expReview') return jsonResponseStaff(expReview(data));
    if (data.action === 'log') saveHistory(data);
    if (data.action === 'block') setCustomerBlocked(data.phone, true);
    if (data.action === 'unblock') setCustomerBlocked(data.phone, false);
    /* قايمة العملاء متخزنة 10 دقايق — من غير المسح ده الحالة الجديدة متظهرش */
    if (data.action === 'log' || data.action === 'block' || data.action === 'unblock') {
      fxClearCache_('fx_c_cust_{}');
      return jsonResponseStaff({ ok: true });
    }
    if (data.action === 'setAiConfig') return jsonResponseStaff(setAiConfig(data));
    if (data.action === 'setSalaries') setMonthlySalaries(data.month, data.amount);
    if (data.action === 'retrySMS') retryFailedSMS(data.invoiceid);
    if (data.action === 'smsAck') return jsonResponseStaff(recordSmsAck(data.phone, data.err));
    if (data.action === 'testSMS') {
      var __t = sendSMSViaAutoRemote(data.phone, 'رسالة تجريبية من صيدلية السوسي - لو وصلتك يبقى السيستم شغال');
      return jsonResponseStaff({ ok: __t.ok, code: __t.code, response: __t.response });
    }
    if (data.action === 'dismissSMS') dismissFailedSMS(data.invoiceid);
    if (data.action === 'agentReferral') {
      try {
        logAgentDebug_('استقبال POST', JSON.stringify(data));
        var __res = handleAgentReferral(data);
        return jsonResponseStaff(__res);
      } catch (__e) {
        logAgentDebug_('خطأ فادح في doPost', __e.message + ' | ' + (__e.stack || ''));
        return jsonResponseStaff({ ok: false, fatal: true, error: __e.message });
      }
    }
    if (data.action === 'saveOpen') return jsonResponseStaff(saveOpenCount(data));
    if (data.action === 'deleteCount') return jsonResponseStaff(deleteCountSession(data));
    if (data.action === 'saveCount') return jsonResponseStaff(saveCountSession(data));
    if (data.action === 'markOrdered') {
      var viaBotM = ordersBotOk_(data.k || data.key);
      if (!viaBotM && dashLocked_(data.pin)) return lockedResp_();
      return jsonResponseStaff(markOrdered_(data, viaBotM));
    }
    if (data.action === 'payAgent') return jsonResponseStaff(payAgent(data.agentPhone, data.amount));
    if (data.action === 'deleteAgentPending') return jsonResponseStaff(deleteAgentPendingRow(data.agentPhone, data.customerPhone));
    return jsonResponseStaff({status:'ok'});
  } catch(err) {
    return jsonResponseStaff({status:'error', msg:err.toString()});
  }
}

function getSystemDailyTotals() {
  try {
    const ss = SpreadsheetApp.openById(DAILY_STATS_SHEET_ID);
    const sheet = ss.getSheets()[0];
    const data = sheet.getDataRange().getValues();
    const map = {};
    data.forEach(function(r) {
      if (r[0]) map[String(r[0]).trim()] = r[1];
    });

    return {
      ok: true,
      sales_today: parseFloat(map['مبيعات اليوم']) || 0,
      profit_today: parseFloat(map['الربحية اليوم']) || 0,
      discount_today: parseFloat(map['الخصم اليوم']) || 0,
      sales_yesterday: parseFloat(map['المبيعات امس']) || 0,
      profit_yesterday: parseFloat(map['الربحية امس']) || 0,
      discount_yesterday: parseFloat(map['الخصم امس']) || 0,
      total_debt: parseFloat(map['صافي الدين']) || 0,
      debt_today: parseFloat(map['الدين اليوم']) || 0,
      debt_paid_today: parseFloat(map['الدين المسدد اليوم']) || 0,
      debt_yesterday: parseFloat(map['الدين امس']) || 0,
      debt_paid_yesterday: parseFloat(map['الدين المسدد امس']) || 0,
      /* طلبيات في الطريق — عشان متطلبش اللي اتطلب فعلاً */
      misc_today:      parseFloat(map['مصروفات متنوعة اليوم']) || 0,
      misc_yesterday:  parseFloat(map['مصروفات متنوعة امس']) || 0,
      purch_today:     parseFloat(map['مشتروات الشركات اليوم']) || 0,
      purch_yesterday: parseFloat(map['مشتروات الشركات امس']) || 0,
      orders_prep_count:  parseFloat(map['الطلبيات تحت التجهيز']) || 0,
      orders_prep_cost:   parseFloat(map['تكلفة الطلبيات تحت التجهيز']) || 0,
      orders_recv_count:  parseFloat(map['الطلبيات تحت الاستلام']) || 0,
      orders_recv_cost:   parseFloat(map['تكلفة الطلبيات تحت الاستلام']) || 0,
      updated_at: map['الوقـت'] || ''
    };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}