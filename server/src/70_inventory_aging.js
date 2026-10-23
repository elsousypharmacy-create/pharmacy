// ==== MODULE 70_inventory_aging (split from server/Code.js; load order = file name order) ====


// ===================================================================
// 📦 تحليل المخزون (Inventory Aging) — يقرأ من شيت STOCK LIVE
// ⚠️ الأعمدة بتتقري بالاسم من صف العناوين — مش بأرقام ثابتة.
// ===================================================================
var STOCK_HEADERS = {
  id:             'id',
  nameen:         'nameen',
  namear:         'namear',
  price:          'price',
  stock:          'stock',
  expire:         'expire',
  lastselleddate: 'lastselleddate',
  totnetcoast:    'totnetcoast',   // إجمالي التكلفة الصافية (سعر الصيدلي)
  totprice:       'totprice',      // إجمالي السعر (سعر الجمهور)
  category:       'category',      // الفئة (الأدوية، التجميل...)
  multistock:     'multistock',    // كميات الدفعات مفصولة بفاصلة
  multiexpire:    'multiexpire'    // صلاحيات الدفعات بنفس الترتيب
};

// بيبني خريطة {اسم العمود: رقمه} من صف العناوين
function invBuildColMap_(headerRow) {
  var map = {};
  for (var i = 0; i < headerRow.length; i++) {
    var h = String(headerRow[i] || '').trim().toLowerCase();
    if (h) map[h] = i;
  }
  /* الأعمدة دي لو ناقصة الكود بيشتغل عادي — مش سبب لإيقاف التحليل */
  var OPTIONAL = { multistock: 1, multiexpire: 1 };
  var cols = {}, missing = [];
  Object.keys(STOCK_HEADERS).forEach(function(key) {
    var wanted = STOCK_HEADERS[key].toLowerCase();
    if (map[wanted] === undefined) { if (!OPTIONAL[key]) missing.push(STOCK_HEADERS[key]); }
    else cols[key] = map[wanted];
  });
  return { cols: cols, missing: missing };
}

var INV_TOP_N = 30;
var INV_BUCKET_TOP_N = 15;

// 🔧 بقى بيستخدم الكاش المقسّم — قبل كده كان بيتخزن بس لو أقل من 95KB،
// وبما إن النتيجة أكبر من كده، الكاش كان واقف والمسح بيتكرر كل مرة
function getInventoryAging() {
  var cached = fxCacheGet_('fx_inv_aging');
  if (cached) return cached;

  var result = getInventoryAging_uncached();
  if (result && result.ok) fxCachePut_('fx_inv_aging', result, 600); // 10 دقايق
  return result;
}

function getInventoryAging_uncached() {
  try {
    var ss = SpreadsheetApp.openById(STOCK_SHEET_ID);
    var sheet = ss.getSheets()[0];
    if (!sheet || sheet.getLastRow() <= 1) {
      return { ok: false, error: 'شيت المخزون فاضي' };
    }

    var lastCol = sheet.getLastColumn();
    var headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var mapped = invBuildColMap_(headerRow);
    if (mapped.missing.length) {
      return { ok: false, error: 'أعمدة ناقصة في شيت المخزون: ' + mapped.missing.join('، ') };
    }
    var STOCK_COL = mapped.cols;

    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
    var tz = 'Africa/Cairo';
    var todayStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    var today = new Date(todayStr + 'T00:00:00');

    var totalCostAll = 0, totalRetailAll = 0;
    var skuTotal = 0, skuInStock = 0;

    // 📅 جدول الصلاحية الشهري — بنبنيه في نفس المسح، مش مسح منفصل
    var arMonths = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
    var monthBuckets = [];
    for (var mi = 0; mi < 6; mi++) {
      var md = new Date(today.getFullYear(), today.getMonth() + mi, 1);
      monthBuckets.push({
        key: md.getFullYear() + '-' + String(md.getMonth() + 1).padStart(2, '0'),
        label: arMonths[md.getMonth()] + ' ' + md.getFullYear(),
        items: [], count: 0, totalCost: 0
      });
    }
    var monthIndexMap = {};
    monthBuckets.forEach(function(m, idx) { monthIndexMap[m.key] = idx; });
    var expiredMonthBucket = { items: [], count: 0, totalCost: 0 };
    /* اللي بينتهي بعد 6 شهور — كان بيتجاهل تمامًا */
    var laterBucket = { items: [], count: 0, totalCost: 0, label: 'بعد 6 شهور' };

    var aging = {
      never:    { cost: 0, retail: 0, skus: 0 },
      b0_30:    { cost: 0, retail: 0, skus: 0 },
      b31_60:   { cost: 0, retail: 0, skus: 0 },
      b61_90:   { cost: 0, retail: 0, skus: 0 },
      b91_180:  { cost: 0, retail: 0, skus: 0 },
      b181_365: { cost: 0, retail: 0, skus: 0 },
      b365plus: { cost: 0, retail: 0, skus: 0 }
    };
    var expiry = {
      expired: { cost: 0, skus: 0 },
      e0_3:    { cost: 0, skus: 0 },
      e3_6:    { cost: 0, skus: 0 },
      e6_12:   { cost: 0, skus: 0 },
      e12plus: { cost: 0, skus: 0 }
    };

    var agingItems = { never: [], b0_30: [], b31_60: [], b61_90: [], b91_180: [], b181_365: [], b365plus: [] };
    var expiryItems = { expired: [], e0_3: [], e3_6: [], e6_12: [], e12plus: [] };

    var slowList = [];
    var negativeList = [];        // 🆕 أصناف رصيدها سالب
    var negativeQty = 0, negativeCost = 0;
    var nearExpiryList = [];
    var allByCategory = {};
    var slowTotalCost = 0, slowCount = 0;
    /* منفصل عن الراكد — البضاعة الجديدة مش راكدة */
    var neverSoldList = [], neverSoldCost = 0, neverSoldCount = 0;
    var stockPositiveCost = 0;

    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      var cost = parseFloat(row[STOCK_COL.totnetcoast]) || 0;
      var retail = parseFloat(row[STOCK_COL.totprice]) || 0;
      var stock = parseFloat(row[STOCK_COL.stock]) || 0;

      skuTotal++;
      /* ⚠️ الأرصدة السالبة (خطأ جرد) كانت بتُطرح من الإجمالي وتخليه
         أقل من الحقيقة. دلوقتي بتتحسب في قايمتها لوحدها بس. */
      if (cost > 0)   totalCostAll   += cost;
      if (retail > 0) totalRetailAll += retail;

      // 🆕 رصيد سالب = خطأ جرد أو بيع من غير إدخال — لازم يتصلّح
      if (stock < 0) {
        negativeList.push({
          name: invCleanName_(row[STOCK_COL.namear]) || invCleanName_(row[STOCK_COL.nameen]) || 'صنف غير مسمى',
          stock: invRound_(stock, 2),
          cost: invRound_(cost, 2),
          price: parseFloat(row[STOCK_COL.price]) || 0,
          category: (STOCK_COL.category !== undefined
            ? (String(row[STOCK_COL.category] || '').trim() || 'غير مصنّف') : 'غير مصنّف'),
          id: String(row[STOCK_COL.id] || '')
        });
        negativeQty += stock;
        negativeCost += cost;
      }

      if (stock <= 0) continue;
      skuInStock++;
      stockPositiveCost += cost;

      /* توزيع كل المخزون على الفئات — كان موجود للراكد وقرب الصلاحية
         بس، ومش موجود للمخزون كله. ده أهم مكان: بيوريك فلوسك
         موزّعة إزاي على الأدوية والتجميل وأدوات طبية. */
      var catAll = (STOCK_COL.category !== undefined
        ? (String(row[STOCK_COL.category] || '').trim() || 'غير مصنّف') : 'غير مصنّف');
      if (!allByCategory[catAll]) allByCategory[catAll] = { count: 0, cost: 0, retail: 0, units: 0 };
      allByCategory[catAll].count++;
      allByCategory[catAll].cost   += cost;
      allByCategory[catAll].retail += retail;
      allByCategory[catAll].units  += stock;

      var name = invCleanName_(row[STOCK_COL.namear]) || invCleanName_(row[STOCK_COL.nameen]) || 'صنف غير مسمى';

      // ---- Aging حسب آخر بيع ----
      var lastSold = invParseDate_(row[STOCK_COL.lastselleddate], tz);
      var daysSince = lastSold ? Math.floor((today - lastSold) / 86400000) : null;
      var aKey;
      if (daysSince === null)      aKey = 'never';
      else if (daysSince <= 30)    aKey = 'b0_30';
      else if (daysSince <= 60)    aKey = 'b31_60';
      else if (daysSince <= 90)    aKey = 'b61_90';
      else if (daysSince <= 180)   aKey = 'b91_180';
      else if (daysSince <= 365)   aKey = 'b181_365';
      else                         aKey = 'b365plus';

      aging[aKey].cost += cost;
      aging[aKey].retail += retail;
      aging[aKey].skus += 1;
      agingItems[aKey].push({ name: name, stock: invRound_(stock, 2), cost: invRound_(cost, 2), days: daysSince, category: catAll });

      /* ---- الدفعات ----
         ⚠️ الكود القديم كان بياخد عمود expire الرئيسي بس ويتجاهل
         multiexpire. مثال حقيقي: ابيمول ايكسترا عنده علبة 2027-07
         وعلبة 2028-07، والاتنين كانوا بيتحطوا في شريحة 2027 بتكلفة
         كاملة. 353 صنف عندك بأكتر من صلاحية — كلهم كانوا غلط.

         دلوقتي بنبني قايمة الدفعات ونوزّع التكلفة عليها بالنسبة. */
      var batches = [];
      var mEx = (STOCK_COL.multiexpire !== undefined)
        ? String(row[STOCK_COL.multiexpire] || '').trim() : '';
      var mSt = (STOCK_COL.multistock !== undefined)
        ? String(row[STOCK_COL.multistock]  || '').trim() : '';
      if (mEx) {
        var exArr = mEx.split(','), stArr = mSt ? mSt.split(',') : [];
        for (var bi = 0; bi < exArr.length; bi++) {
          var be = String(exArr[bi] || '').trim();
          if (!be || be === '0') continue;
          var bq = parseFloat(String(stArr[bi] || '').trim()) || 0;
          batches.push({ expire: be.substring(0, 10), qty: bq });
        }
      }
      var expDate0 = invParseDate_(row[STOCK_COL.expire], tz);
      var expStr0 = expDate0 ? Utilities.formatDate(expDate0, tz, 'yyyy-MM-dd') : null;
      var daysToExp0 = expDate0 ? Math.floor((expDate0 - today) / 86400000) : null;

      if (!batches.length && expStr0) batches.push({ expire: expStr0, qty: stock });

      /* التكلفة بتتوزع بنسبة كمية كل دفعة */
      var qSum = 0;
      batches.forEach(function (b) { qSum += b.qty; });
      batches.forEach(function (b) {
        var share = (qSum > 0) ? (b.qty / qSum) : (1 / batches.length);
        b.cost = cost * share;
      });

      /* ---- جدول الصلاحية الشهري ----
         بيمشي على كل دفعة لوحدها. قبل كده كان بياخد expire الرئيسي
         بس، فالعلبة اللي صلاحيتها مختلفة كانت بتتحط في الشهر الغلط.
         وكمان: اللي بعد 6 شهور كان بيختفي خالص — دلوقتي له خانة. */
      batches.forEach(function (b) {
        var bd = invParseDate_(b.expire, tz);
        if (!bd) return;
        var item = { name: name, stock: invRound_(b.qty, 2),
                     cost: invRound_(b.cost, 2), expire: b.expire };
        var bKey = bd.getFullYear() + '-' + String(bd.getMonth() + 1).padStart(2, '0');
        if (bd < today) {
          expiredMonthBucket.items.push(item);
          expiredMonthBucket.count++;
          expiredMonthBucket.totalCost += b.cost;
        } else if (monthIndexMap[bKey] !== undefined) {
          var mb = monthBuckets[monthIndexMap[bKey]];
          mb.items.push(item); mb.count++; mb.totalCost += b.cost;
        } else {
          laterBucket.items.push(item);
          laterBucket.count++; laterBucket.totalCost += b.cost;
        }
      });

      /* ---- الأصناف الراكدة ----
         ⚠️ الكود القديم كان بيحسب أي صنف lastselleddate بتاعه فاضي
         كأنه راكد. بس الخانة دي بتبقى فاضية في حالتين مختلفتين:
           • صنف قديم عمره ما اتباع  → راكد فعلاً
           • بضاعة وصلت امبارح       → مش راكدة
         فكل شحنة جديدة كانت بتظهر في "الراكد" من أول يوم وتنفخ الرقم.

         دلوقتي "عمره ما اتباع" تصنيف منفصل، والراكد = اتباع فعلاً
         وعدّى عليه أكتر من 180 يوم. */
      var itemCat2 = (STOCK_COL.category !== undefined
        ? (String(row[STOCK_COL.category] || '').trim() || 'غير مصنّف') : 'غير مصنّف');

      if (daysSince !== null && daysSince > 180) {
        slowTotalCost += cost;
        slowCount++;
        slowList.push({
          name: name, stock: invRound_(stock, 2), cost: invRound_(cost, 2), days: daysSince,
          category: itemCat2, expire: expStr0, days_to_expire: daysToExp0
        });
      } else if (daysSince === null) {
        neverSoldCost += cost;
        neverSoldCount++;
        neverSoldList.push({
          name: name, stock: invRound_(stock, 2), cost: invRound_(cost, 2), days: null,
          category: itemCat2, expire: expStr0, days_to_expire: daysToExp0
        });
      }

      // ---- شرايح الصلاحية ----
      /* الشرايح من الدفعات — كل دفعة بصلاحيتها وتكلفتها هي */
      var itemCat = (STOCK_COL.category !== undefined
        ? (String(row[STOCK_COL.category] || '').trim() || 'غير مصنّف') : 'غير مصنّف');

      batches.forEach(function (b) {
        var bd = invParseDate_(b.expire, tz);
        if (!bd) return;
        var dte = Math.floor((bd - today) / 86400000);
        var eKey;
        if (dte < 0)         eKey = 'expired';
        else if (dte <= 90)  eKey = 'e0_3';
        else if (dte <= 180) eKey = 'e3_6';
        else if (dte <= 365) eKey = 'e6_12';
        else                 eKey = 'e12plus';

        expiry[eKey].cost += b.cost;
        expiry[eKey].skus += 1;

        expiryItems[eKey].push({ name: name, stock: invRound_(b.qty, 2),
          cost: invRound_(b.cost, 2), expire: b.expire, days_to_expire: dte });

        if (dte <= 180) {
          nearExpiryList.push({ name: name, stock: invRound_(b.qty, 2),
            cost: invRound_(b.cost, 2), expire: b.expire,
            days_to_expire: dte, category: itemCat });
        }
      });
    }

    slowList.sort(invByCostDesc_);
    neverSoldList.sort(invByCostDesc_);
    nearExpiryList.sort(invByCostDesc_);
    negativeList.sort(function(a, b){ return a.stock - b.stock; });  // الأكتر سالبية فوق

    monthBuckets.forEach(function(m) {
      m.items.sort(function(a, b) { return new Date(a.expire) - new Date(b.expire); });
      m.totalCost = invRound_(m.totalCost, 2);
    });
    expiredMonthBucket.items.sort(function(a, b) { return new Date(a.expire) - new Date(b.expire); });
    expiredMonthBucket.totalCost = invRound_(expiredMonthBucket.totalCost, 2);
    laterBucket.items.sort(function(a, b) { return new Date(a.expire) - new Date(b.expire); });
    laterBucket.totalCost = invRound_(laterBucket.totalCost, 2);

    var slowByCategory = {};
    slowList.forEach(function(it) {
      var cat = it.category || 'غير مصنّف';
      if (!slowByCategory[cat]) slowByCategory[cat] = { count: 0, cost: 0 };
      slowByCategory[cat].count++;
      slowByCategory[cat].cost += it.cost;
    });
    var allCategorySummary = Object.keys(allByCategory).map(function(cat) {
      var c = allByCategory[cat];
      return { category: cat, count: c.count,
               cost: invRound_(c.cost, 2), retail: invRound_(c.retail, 2),
               units: invRound_(c.units, 2) };
    }).sort(function(a, b) { return b.cost - a.cost; });

    var slowCategorySummary = Object.keys(slowByCategory).map(function(cat) {
      return { category: cat, count: slowByCategory[cat].count, cost: invRound_(slowByCategory[cat].cost, 2) };
    }).sort(function(a, b) { return b.cost - a.cost; });

    var expiryByCategory = {};
    nearExpiryList.forEach(function(it) {
      var cat = it.category || 'غير مصنّف';
      if (!expiryByCategory[cat]) expiryByCategory[cat] = { count: 0, cost: 0 };
      expiryByCategory[cat].count++;
      expiryByCategory[cat].cost += it.cost;
    });
    var expiryCategorySummary = Object.keys(expiryByCategory).map(function(cat) {
      return { category: cat, count: expiryByCategory[cat].count, cost: invRound_(expiryByCategory[cat].cost, 2) };
    }).sort(function(a, b) { return b.cost - a.cost; });

    Object.keys(agingItems).forEach(function(k) { agingItems[k].sort(invByCostDesc_); });
    Object.keys(expiryItems).forEach(function(k) { expiryItems[k].sort(invByCostDesc_); });

    Object.keys(aging).forEach(function(k) {
      aging[k].cost = invRound_(aging[k].cost, 2);
      aging[k].retail = invRound_(aging[k].retail, 2);
    });
    Object.keys(expiry).forEach(function(k) {
      expiry[k].cost = invRound_(expiry[k].cost, 2);
    });

    return {
      ok: true,
      generated_date: todayStr,
      total_cost_value: invRound_(totalCostAll, 2),
      total_retail_value: invRound_(totalRetailAll, 2),
      sku_total: skuTotal,
      sku_in_stock: skuInStock,
      stock_positive_cost_total: invRound_(stockPositiveCost, 2),
      aging: aging,
      expiry: expiry,
      aging_items: agingItems,
      expiry_items: expiryItems,
      slow_dead_total_cost: invRound_(slowTotalCost, 2),
      slow_dead_count: slowCount,
      slow_dead_list: slowList,
      /* 🆕 البضاعة اللي عمرها ما اتباعت — منفصلة عن الراكد */
      never_sold_total_cost: invRound_(neverSoldCost, 2),
      never_sold_count: neverSoldCount,
      never_sold_list: neverSoldList,
      all_category_summary: allCategorySummary,
      slow_category_summary: slowCategorySummary,
      near_expiry_list: nearExpiryList,
      near_expiry_category_summary: expiryCategorySummary,
      negative_list: negativeList,
      negative_count: negativeList.length,
      negative_qty: invRound_(negativeQty, 2),
      negative_cost: invRound_(negativeCost, 2),
      expiry_by_month: { expired: expiredMonthBucket, months: monthBuckets,
                         later: laterBucket }
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ===================================================================
// 📅 قائمة الأصناف قرب الانتهاء — مقسّمة شهر بشهر (6 شهور قدام)
// ===================================================================
function getExpiryByMonth() {
  var inv = getInventoryAging();
  if (!inv || !inv.ok) return { ok: false, error: (inv && inv.error) || 'تعذّر تحليل المخزون' };
  return {
    ok: true,
    generated_date: inv.generated_date,
    expired: inv.expiry_by_month.expired,
    months: inv.expiry_by_month.months
  };
}

function invByCostDesc_(a, b) { return b.cost - a.cost; }

function invRound_(n, digits) {
  var f = Math.pow(10, digits || 0);
  return Math.round((parseFloat(n) || 0) * f) / f;
}

// بينضّف الاسم من رموز HTML اللي بتيجي من النظام (&#43; = + و &#47; = /)
function invCleanName_(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&#43;/g, '+')
    .replace(/&#47;/g, '/')
    .replace(/&amp;/g, '&')
    .trim();
}

// بيقرا التاريخ سواء جه كـ Date أو نص ("2027-03-01" أو "2026-07-01 09:37:20")
function invParseDate_(v, tz) {
  if (!v && v !== 0) return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return new Date(Utilities.formatDate(v, tz, 'yyyy-MM-dd') + 'T00:00:00');
  }
  var s = String(v).trim();
  if (!s || s === '0') return null;
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  var d = new Date(m[1] + '-' + m[2] + '-' + m[3] + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}

// شغّلها مرة من المحرر عشان تتأكد إن كل حاجة تمام قبل ما تعمل Deploy
function testInventoryAging() {
  var r = getInventoryAging();
  if (!r.ok) { Logger.log('❌ خطأ: ' + r.error); return; }
  Logger.log('✅ تمام');
  Logger.log('إجمالي المخزون (سعر الصيدلي): ' + r.total_cost_value);
  Logger.log('إجمالي المخزون (سعر الجمهور): ' + r.total_retail_value);
  Logger.log('أصناف برصيد: ' + r.sku_in_stock + ' من ' + r.sku_total);
  Logger.log('قيمة الراكد: ' + r.slow_dead_total_cost + ' (' + r.slow_dead_count + ' صنف)');
  Logger.log('شرايح الـ Aging: ' + JSON.stringify(r.aging));
  Logger.log('شرايح الصلاحية: ' + JSON.stringify(r.expiry));
}