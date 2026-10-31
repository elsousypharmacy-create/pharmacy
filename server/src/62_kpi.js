// ==== MODULE 62_kpi (split from server/Code.js; load order = file name order) ====


// ═══════════════════════════════════════════════════════════════════
// 🆕 حساب مباشر ودقيق من ملفات المبيعات الخام
//
// ⚠️ التعديل (أغسطس 2026): النسخة القديمة كانت بتفهم 'month' و'lastMonth'
// بس. أي فترة تانية (اليوم / أمس / الأسبوع / فترة مخصصة) كانت بتتعامل
// معاملة "الشهر ده" في صمت — فصفحة المبيعات كان عنوانها يقول "اليوم"
// والأرقام تحته بتاعة الشهر كله.
// دلوقتي بتستخدم resolveRange_ زي باقي الصفحات بالظبط.
//
// ملحوظة: النهاردة مستبعد من القراءة المباشرة عمدًا — لأن إعادة تحليل
// فاتورة اليوم بره التريجر الحي بتأثر على تتبّع "العميل الجديد"
// (knownCustomers). رقم النهاردة بياخده من Daily_Mini_Statics بدل كده.
// ═══════════════════════════════════════════════════════════════════
function getMonthTotalsFromRaw(params) {
  try {
    var folder   = DriveApp.getFolderById(SALES_FOLDER);
    var tz       = 'Africa/Cairo';
    var now      = new Date();
    var todayStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');

    var R     = resolveRange_(params);
    var from  = R.from;
    var to    = R.to;
    var label = R.label;

    var includeToday = (from <= todayStr && to >= todayStr);
    var rawTo        = includeToday
      ? Utilities.formatDate(new Date(now.getTime() - 86400000), tz, 'yyyy-MM-dd')
      : to;

    var invoices = 0, sales = 0, discount = 0, profit = 0;
    var returnsCount = 0, returnsValue = 0;
    var seen = {};   // بنمنع عدّ نفس الفاتورة مرتين
    var daysWithData = 0;   // 🆕 عشان نحسب المتوسط اليومي

    if (rawTo >= from) {
      var fromD    = new Date(from  + 'T00:00:00');
      var toD      = new Date(rawTo + 'T00:00:00');
      var dayCount = Math.round((toD - fromD) / 86400000) + 1;

      // سقف أمان: أطول فترة نقراها من الملفات الخام سنة واحدة.
      // من غيره، لو حد طلب "كل الوقت" السكربت بيضرب سقف الوقت.
      if (dayCount > 366) {
        fromD    = new Date(toD.getTime() - 365 * 86400000);
        dayCount = 366;
        label    = label + ' (آخر سنة)';
      }

      for (var i = 0; i < dayCount; i++) {
        var d       = new Date(fromD.getTime() + i * 86400000);
        var dateStr = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
        if (dateStr === todayStr) continue;   // أمان إضافي

        var salesContent = '';
        var salesFiles = folder.getFilesByName('sales' + dateStr + '.txt');
        if (salesFiles.hasNext()) {
          salesContent = salesFiles.next().getBlob().getDataAsString('UTF-8');
        }

        var returnsContent = '';
        var returnFiles = folder.getFilesByName('Returnsales' + dateStr + '.txt');
        if (returnFiles.hasNext()) {
          returnsContent = returnFiles.next().getBlob().getDataAsString('UTF-8');
        }

        if (!salesContent && !returnsContent) continue;
        daysWithData++;

        var stats = parseStaffStats(salesContent + '\n' + returnsContent, dateStr);
        Object.keys(stats).forEach(function (emp) {
          var st = stats[emp];
          st.invoices.forEach(function (id) { seen[dateStr + '_' + id] = 1; });
          sales        += st.sales;
          discount     += st.discount;
          profit       += st.profit;
          returnsCount += st.returns.size;
          returnsValue += st.returns_value;
        });
      }
    }
    invoices = Object.keys(seen).length;

    var todayCounted = false;
    if (includeToday) {
      var t = getSystemDailyTotals();
      if (t && t.ok) {
        sales    += t.sales_today;
        profit   += t.profit_today;
        discount += t.discount_today;
        todayCounted = true;

        /* 🔧 إصلاح: كنا بناخد مبيعات النهاردة من غير عدد فواتيره،
           فمتوسط الفاتورة كان بيطلع منفوخ — وفي فلتر "اليوم" بيطلع
           صفر تمامًا لأن الملفات الخام مبتتقراش أصلاً.
           عدد فواتير النهاردة بنجيبه من شيت "الموظفين" — بيتحدّث
           كل دقيقة من التريجر الحي، فهو أدق مصدر متاح. */
        var todayInv = 0;
        try {
          var sh = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName('الموظفين');
          if (sh && sh.getLastRow() > 1) {
            var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
            var best = {};
            rows.forEach(function (rr) {
              var rd = rr[0] instanceof Date
                ? Utilities.formatDate(rr[0], tz, 'yyyy-MM-dd')
                : String(rr[0]).substring(0, 10);
              if (rd !== todayStr || !rr[1]) return;
              var emp = normalizeEmpId(rr[1]);
              var n = parseInt(rr[2]) || 0;
              if (!best[emp] || n > best[emp]) best[emp] = n;   // نتفادى الصفوف المكررة
            });
            Object.keys(best).forEach(function (e) { todayInv += best[e]; });
          }
        } catch (e) {}

        if (todayInv > 0) { invoices += todayInv; daysWithData++; }
      }
    }

    return {
      ok: true,
      label: label,
      from: from,
      to: to,
      invoices_total:      invoices,
      sales_total:         Math.round(sales),
      discount_total:      Math.round(discount),
      profit_total:        Math.round(profit),
      returns_total:       returnsCount,
      returns_value_total: Math.round(returnsValue),

      /* 🆕 المتوسطات — كانت ناقصة تمامًا */
      days_with_data:      daysWithData,
      avg_invoice:         invoices > 0 ? Math.round(sales / invoices) : 0,
      avg_daily_sales:     daysWithData > 0 ? Math.round(sales / daysWithData) : 0,
      avg_daily_profit:    daysWithData > 0 ? Math.round(profit / daysWithData) : 0,
      avg_daily_invoices:  daysWithData > 0 ? Math.round(invoices / daysWithData) : 0,
      net_sales:           Math.round(sales - returnsValue),
      avg_daily_net:       daysWithData > 0 ? Math.round((sales - returnsValue) / daysWithData) : 0,

      today_included:      todayCounted
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}


// ═══════════════════════════════════════════════════════════════════
// 📅 تفسير الفترة — مصدر واحد لكل الصفحات
// المشكلة اللي كانت: كل دالة بتفسّر الفترة بنفسها، وأي قيمة متعرفهاش
// (زي "yesterday") كانت بترجع "كل الوقت" في صمت — فالأرقام تطلع غلط
// من غير أي رسالة خطأ.
// ═══════════════════════════════════════════════════════════════════
function resolveRange_(params) {
  params = params || {};
  var tz = 'Africa/Cairo', now = new Date();
  var today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var f = function (d) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); };

  if (params.from && params.to) {
    return { from: params.from, to: params.to, label: params.from + ' → ' + params.to };
  }
  var r = params.range || 'month';
  if (r === 'today')      return { from: today, to: today, label: 'اليوم' };
  if (r === 'yesterday') {
    var y = f(new Date(now.getTime() - 86400000));
    return { from: y, to: y, label: 'أمس' };
  }
  if (r === 'week')       return { from: f(new Date(now.getTime() - 6 * 86400000)), to: today, label: 'آخر أسبوع' };
  if (r === 'lastMonth') {
    var Y = now.getFullYear(), M = now.getMonth();
    return { from: f(new Date(Y, M - 1, 1)), to: f(new Date(Y, M, 0)), label: 'الشهر اللي فات' };
  }
  if (r === 'all')        return { from: '2000-01-01', to: today, label: 'كل الوقت' };
  return { from: f(new Date(now.getFullYear(), now.getMonth(), 1)), to: today, label: 'هذا الشهر' };
}

function getStaffKPIData(params) {
  var ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
  var sheet = ss.getSheetByName('الموظفين');
  if (!sheet || sheet.getLastRow() <= 1) return { employees: [], label: '', daily: [] };

  var R = resolveRange_(params);
  var cutoff = R.from, end = R.to, label = R.label;

  var rawData = sheet.getDataRange().getValues();
  var emps = {};
  var dailyTotals = {};

  var bestRow = {};
  for (var r = 1; r < rawData.length; r++) {
    var rd = rawData[r][0] instanceof Date
      ? Utilities.formatDate(rawData[r][0], 'Africa/Cairo', 'yyyy-MM-dd')
      : String(rawData[r][0]).substring(0, 10);
    if (rd < cutoff || rd > end) continue;
    if (!rawData[r][2] || rawData[r][2] === 0) continue;
    var dk = rd + '_' + normalizeEmpId(rawData[r][1]);
    if (!bestRow[dk] || (parseInt(rawData[r][2])||0) > (parseInt(bestRow[dk][2])||0)) bestRow[dk] = rawData[r];
  }
  var data = [null].concat(Object.keys(bestRow).map(function(k){ return bestRow[k]; }));

  for (var i = 1; i < data.length; i++) {
    var rowDate = data[i][0] instanceof Date
      ? Utilities.formatDate(data[i][0], 'Africa/Cairo', 'yyyy-MM-dd')
      : String(data[i][0]).substring(0, 10);

    var emp = normalizeEmpId(data[i][1]);
    if (!emps[emp]) {
      emps[emp] = { name: resolveEmpName(emp), invoices:0, sales:0, returns:0, returns_val:0, net:0,
                    discount:0, profit:0, registered:0, not_reg:0, new_c:0, repeat_c:0, days:0 };
    }
    var s = emps[emp];
    s.invoices    += parseInt(data[i][2]) || 0;
    s.sales       += parseInt(data[i][3]) || 0;
    s.returns     += parseInt(data[i][4]) || 0;
    s.returns_val += parseInt(data[i][5]) || 0;
    s.net         += parseInt(data[i][6]) || 0;
    s.discount    += parseInt(data[i][7]) || 0;
    s.profit      += parseInt(data[i][14]) || 0;
    s.registered  += parseInt(data[i][8]) || 0;
    s.not_reg     += parseInt(data[i][9]) || 0;
    s.new_c       += parseInt(data[i][11]) || 0;
    s.repeat_c    += parseInt(data[i][12]) || 0;
    s.days        += 1;

    if (!dailyTotals[rowDate]) dailyTotals[rowDate] = { date: rowDate, sales:0, net:0, invoices:0, profit:0, new_c:0, registered:0, total_cust:0 };
    dailyTotals[rowDate].sales      += parseInt(data[i][3]) || 0;
    dailyTotals[rowDate].net        += parseInt(data[i][6]) || 0;     // بعد المرتجعات
    dailyTotals[rowDate].invoices   += parseInt(data[i][2]) || 0;
    dailyTotals[rowDate].profit     += parseInt(data[i][14]) || 0;
    dailyTotals[rowDate].new_c      += parseInt(data[i][11]) || 0;
    dailyTotals[rowDate].registered += parseInt(data[i][8]) || 0;
    dailyTotals[rowDate].total_cust += (parseInt(data[i][8]) || 0) + (parseInt(data[i][9]) || 0);
  }

  var list = Object.keys(emps).map(function(k){ return emps[k]; }).filter(function(s){ return s.invoices > 0; });
  if (!list.length) return { employees: [], label: label, daily: [] };

  list.forEach(function(s){
    var total_cust = s.registered + s.not_reg;
    s.reg_pct     = total_cust > 0 ? Math.round(s.registered / total_cust * 100) : 0;
    s.avg_inv     = s.invoices > 0 ? Math.round(s.sales / s.invoices) : 0;
    s.disc_pct    = s.sales > 0 ? parseFloat((s.discount / s.sales * 100).toFixed(1)) : 0;
    s.return_pct  = s.invoices > 0 ? parseFloat((s.returns / s.invoices * 100).toFixed(1)) : 0;
    s.total_cust  = total_cust;
  });

  var maxNew    = Math.max.apply(null, list.map(function(s){ return s.new_c; }).concat([1]));
  var maxRepeat = Math.max.apply(null, list.map(function(s){ return s.repeat_c; }).concat([1]));
  var minReturn = Math.min.apply(null, list.map(function(s){ return s.return_pct; }));
  var maxReturn = Math.max.apply(null, list.map(function(s){ return s.return_pct; }).concat([1]));

  list.forEach(function(s){
    var cNew    = maxNew > 0 ? (s.new_c / maxNew) * 100 : 0;
    var cReg    = s.reg_pct;
    var cRepeat = maxRepeat > 0 ? (s.repeat_c / maxRepeat) * 100 : 0;
    var cReturn = maxReturn > minReturn ? (1 - (s.return_pct - minReturn) / (maxReturn - minReturn)) * 100 : 100;

    s.care_new    = Math.round(cNew);
    s.care_reg    = Math.round(cReg);
    s.care_repeat = Math.round(cRepeat);
    s.care_return = Math.round(cReturn);

    s.care_score = Math.round(
      cNew    * CARE_WEIGHTS.new_customers +
      cReg    * CARE_WEIGHTS.registration +
      cRepeat * CARE_WEIGHTS.repeat +
      cReturn * CARE_WEIGHTS.low_returns
    );
  });

  list.sort(function(a,b){ return b.care_score - a.care_score; });

  var daily = Object.keys(dailyTotals).sort().map(function(d){
    var x = dailyTotals[d];
    x.reg_pct = x.total_cust > 0 ? Math.round(x.registered / x.total_cust * 100) : 0;
    return x;
  });

  return {
    label: label,
    weights: CARE_WEIGHTS,
    targets: TARGETS,
    employees: list,
    daily: daily
  };
}