/* 🔐 المفاتيح السرية بتتخزن في إعدادات السيرفر (Script Properties) مش في الكود،
   عشان الكود نفسه يقدر يتحط على GitHub من غير ما المفاتيح تبان. */
function secret_(k, seed) {
  var P = PropertiesService.getScriptProperties(), v = P.getProperty(k);
  if (!v && seed) { P.setProperty(k, seed); v = seed; }
  return v || '';
}
const BOT_TOKEN = secret_('BOT_TOKEN');
const PERSONAL_CHAT = '7156262113';
const SALES_FOLDER = '12vpMybIXTdtT1w1t63vY1oV7zOx1QWtO';
const STAFF_SHEET_ID = '11O_CkemBGq3WEsQ2eGVW9ASJ0iNn3UPfHpmj4YMOcCM';
const DAILY_STATS_SHEET_ID = '1KPu__lb0qDwuousQ8p0KuwathpP0WrqC';
const DEBITS_SHEET_ID = '1-EuevxMKYZ-dHiSLXyyh-lOO0PYbONpV';
const EXPENSES_SHEET_ID = '1Kek53URtAMoAAMxoE9cRaE7ATilbSEVc0QCyHrfHsE4';

const CRM_SHEET_ID = '11z60j-FjbWB2WsfhNZj6cpPlUodwwV_3x3928P8xK0Q';
const INVOICES_SHEET_ID = '1-OSQs3f6Nt7mctV7Yjd-cPpC7A-TdZRiONlzD8DhBC4';
const CARE_GROUP = '';
const FOLLOWUP_MAX_ATTEMPTS = 3;

const CONNECTEAM_API_KEY = secret_('CONNECTEAM_API_KEY');
const CONNECTEAM_TIME_CLOCK_ID = '4828050';
const CONNECTEAM_USER_MAP = {};
const STAFF_GROUP = '-5150806315';

// 🆕 إعدادات نظام رسائل SMS + نقاط الولاء
const AUTOREMOTE_KEY = secret_('AUTOREMOTE_KEY');
const AUTOREMOTE_URL = 'https://autoremotejoaomgcd.appspot.com/sendmessage';
const SMS_LOG_SHEET = 'رسائل SMS';
const POINTS_SHEET = 'نقاط العملاء';
const INVALID_PHONE_SHEET = 'أرقام تحتاج مراجعة';

const EMPLOYEES = {
  '1': 'الدكتور',
  '2': 'دكتور عبدالسلام',
  '3': 'دكتورة ولاء',
  '4': 'استاذ حمادة',
  '5': 'استاذ ايمن'
};

const TARGETS = {
  registration: 75,
  avg_invoice: 150,
  discount_pct: 10,
  max_returns: 3
};

const SEP = '━━━━━━━━━━━━━━';
const SEP2 = '─────────────';
var _lastMaxInvoiceIdParsed = 0;

function importHistoricalData() {
  const ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
  let sheet = ss.getSheetByName('الموظفين');
  if (!sheet) {
    sheet = ss.insertSheet('الموظفين');
  } else {
    sheet.clear();
  }

  sheet.appendRow([
    'التاريخ', 'الموظف', 'فواتير', 'مبيعات', 'مرتجعات', 'قيمة المرتجعات',
    'صافي', 'خصم', 'عملاء مسجلين', 'غير مسجلين', 'نسبة التسجيل',
    'عملاء جدد', 'متكررين', 'متوسط الفاتورة'
  ]);

  Logger.log('تنبيه: importHistoricalData بتاعتك الأصلية فيها البيانات التاريخية (نوفمبر-يونيو) — الصقها هنا زي ما هي لو عايز تعيد الاستيراد.');
}

function parseValues(str) {
  const vals = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      vals.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  vals.push(current.trim());
  return vals;
}

function logNewCustomers(stats, today) {
  const ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
  let sheet = ss.getSheetByName('سجل العملاء الجدد');
  if (!sheet) {
    sheet = ss.insertSheet('سجل العملاء الجدد');
    sheet.appendRow(['التاريخ', 'الموظف', 'اسم العميل', 'رقم التليفون']);
  }

  const existing = new Set();
  if (sheet.getLastRow() > 1) {
    const existingData = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
    existingData.forEach(function(r) {
      const rDate = r[0] instanceof Date ? Utilities.formatDate(r[0], 'Africa/Cairo', 'yyyy-MM-dd') : String(r[0]).substring(0,10);
      existing.add(rDate + '_' + r[3]);
    });
  }

  const rows = [];
  for (let emp in stats) {
    const s = stats[emp];
    if (!s.new_customers || s.new_customers.size === 0) continue;
    for (let phone of s.new_customers) {
      const dedupKey = today + '_' + phone;
      if (existing.has(dedupKey)) continue;
      existing.add(dedupKey);
      const name = (s.phoneNames && s.phoneNames[phone]) ? s.phoneNames[phone] : 'غير معروف';
      rows.push([today, emp, name, phone]);
    }
  }
  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
  }
}

function getMonthDebtsSummary(monthKey) {
  try {
    if (!monthKey) monthKey = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM');
    const y = parseInt(monthKey.split('-')[0]), m = parseInt(monthKey.split('-')[1]);
    const lastDay = new Date(y, m, 0).getDate();
    const today = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');
    const folder = DriveApp.getFolderById(SALES_FOLDER);

    let totalNewDebt = 0, totalCollected = 0, daysWithData = 0;
    const daily = [];

    for (let day = 1; day <= lastDay; day++) {
      const dateStr = monthKey + '-' + String(day).padStart(2, '0');
      if (dateStr > today) break;

      const files = folder.getFilesByName('debits' + dateStr + '.txt');
      if (!files.hasNext()) continue;
      const content = files.next().getBlob().getDataAsString('UTF-8');
      if (!content) continue;

      let dayDebt = 0, dayPaid = 0;
      const regex = /VALUES\s*\(((?:&#\d+;|[^;])+)\)/g;
      let match;
      while ((match = regex.exec(content)) !== null) {
        const tuples = extractTuples('(' + match[1] + ')');
        for (let t = 0; t < tuples.length; t++) {
          try {
            const vals = parseValues(tuples[t]);
            if (!vals || vals.length < 11) continue;
            dayDebt += parseFloat(vals[8]) || 0;
          } catch(e) { continue; }
        }
      }
      const checkpointRegex = /[^\n(]{2,40}\s*\([0-9+]{5,}\)\s*[\r\n]+\s*إجمالى الديون قبل\s*([\d.]+)\s*[\r\n]+\s*إجمالى الديون بعد\s*([\d.]+)/g;
      let cpMatch;
      while ((cpMatch = checkpointRegex.exec(content)) !== null) {
        const before = parseFloat(cpMatch[1]) || 0;
        const after = parseFloat(cpMatch[2]) || 0;
        if (before > after) dayPaid += (before - after);
      }
      totalNewDebt += dayDebt;
      totalCollected += dayPaid;
      daysWithData++;
      daily.push({ date: dateStr, new_debt: Math.round(dayDebt), collected: Math.round(dayPaid) });
    }

    return {
      ok: true, month: monthKey,
      total_new_debt: Math.round(totalNewDebt),
      total_collected: Math.round(totalCollected),
      deficit: Math.round(totalNewDebt - totalCollected),
      days_with_data: daysWithData,
      daily: daily
    };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

function getDayCollections(dateStr) {
  try {
    if (!dateStr) return { ok: false, error: 'التاريخ مطلوب' };
    const folder = DriveApp.getFolderById(SALES_FOLDER);
    let content = '';
    const files = folder.getFilesByName('debits' + dateStr + '.txt');
    if (files.hasNext()) content = files.next().getBlob().getDataAsString('UTF-8');
    if (!content) return { ok: true, date: dateStr, collections: [], total: 0 };

    const checkpointRegex = /([^\n(]{2,40})\s*\(([0-9+]{5,})\)\s*[\r\n]+\s*إجمالى الديون قبل\s*([\d.]+)\s*[\r\n]+\s*إجمالى الديون بعد\s*([\d.]+)/g;
    let cpMatch;
    const collections = [];
    let total = 0;
    while ((cpMatch = checkpointRegex.exec(content)) !== null) {
      const custname = cpMatch[1].trim();
      const phone = cpMatch[2].trim();
      const before = parseFloat(cpMatch[3]) || 0;
      const after = parseFloat(cpMatch[4]) || 0;
      const paid = before - after;
      if (paid > 0) {
        collections.push({ custname: custname, phone: phone, amount: paid, before: before, after: after });
        total += paid;
      }
    }
    collections.sort(function(a,b){ return b.amount - a.amount; });

    return { ok: true, date: dateStr, collections: collections, total: total };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

function getDayDebits(dateStr) {
  try {
    if (!dateStr) return { ok: false, error: 'التاريخ مطلوب' };
    const folder = DriveApp.getFolderById(SALES_FOLDER);
    let content = '';
    const files = folder.getFilesByName('debits' + dateStr + '.txt');
    if (files.hasNext()) content = files.next().getBlob().getDataAsString('UTF-8');
    if (!content) return { ok: true, date: dateStr, employees: {} };

    const regex = /VALUES\s*\(((?:&#\d+;|[^;])+)\)/g;
    let match;
    const debitsByEmployee = {};

    while ((match = regex.exec(content)) !== null) {
      const tuples = extractTuples('(' + match[1] + ')');
      for (let t = 0; t < tuples.length; t++) {
        try {
          const vals = parseValues(tuples[t]);
          if (!vals || vals.length < 9) continue;
          const userid = vals[7] ? vals[7].trim() : '';
          const custname = vals[3] ? vals[3].trim() : 'عميل';
          const phone = vals[4] ? vals[4].trim() : '';
          const amount = parseFloat(vals[8]) || 0;
          const time = vals[5] || '';

          const emp = resolveEmpName(normalizeEmpId(userid));
          if (!debitsByEmployee[emp]) debitsByEmployee[emp] = [];
          debitsByEmployee[emp].push({ custname: custname, phone: phone, amount: amount, time: time });
        } catch(e) { continue; }
      }
    }

    return { ok: true, date: dateStr, employees: debitsByEmployee };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

// 🆕 كل موظف طلّع دين بكام خلال فترة معيّنة (مش تحصيل، طلوع دين جديد بس)
function getDebtsByEmployee(params) {
  try {
    const folder = DriveApp.getFolderById(SALES_FOLDER);
    const R = resolveRange_(params);
    const from = R.from, to = R.to, label = R.label;

    const fromD = new Date(from + 'T00:00:00');
    const toD = new Date(to + 'T23:59:59');
    const byEmployee = {}; // emp -> { total, count }
    const dayCount = Math.round((toD - fromD) / 86400000) + 1;

    for (let i = 0; i < dayCount; i++) {
      const d = new Date(fromD.getTime() + i * 86400000);
      const dateStr = Utilities.formatDate(d, 'Africa/Cairo', 'yyyy-MM-dd');
      const files = folder.getFilesByName('debits' + dateStr + '.txt');
      if (!files.hasNext()) continue;
      const content = files.next().getBlob().getDataAsString('UTF-8');
      if (!content) continue;

      const regex = /VALUES\s*\(((?:&#\d+;|[^;])+)\)/g;
      let match;
      while ((match = regex.exec(content)) !== null) {
        const tuples = extractTuples('(' + match[1] + ')');
        for (let t = 0; t < tuples.length; t++) {
          try {
            const vals = parseValues(tuples[t]);
            if (!vals || vals.length < 9) continue;
            const userid = vals[7] ? vals[7].trim() : '';
            const amount = parseFloat(vals[8]) || 0;
            const emp = resolveEmpName(normalizeEmpId(userid));
            if (!byEmployee[emp]) byEmployee[emp] = { total: 0, count: 0 };
            byEmployee[emp].total += amount;
            byEmployee[emp].count++;
          } catch (e) { continue; }
        }
      }
    }

    const list = Object.keys(byEmployee).map(function(emp) {
      return { employee: emp, total: Math.round(byEmployee[emp].total), count: byEmployee[emp].count };
    }).sort(function(a, b) { return b.total - a.total; });

    return { ok: true, label: label, from: from, to: to, employees: list };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function getDayInvoices(dateStr) {
  try {
    if (!dateStr) return { ok: false, error: 'التاريخ مطلوب' };
    const folder = DriveApp.getFolderById(SALES_FOLDER);
    let salesContent = '';
    const salesFiles = folder.getFilesByName('sales' + dateStr + '.txt');
    if (salesFiles.hasNext()) salesContent = salesFiles.next().getBlob().getDataAsString('UTF-8');
    if (!salesContent) return { ok: true, date: dateStr, employees: {} };

    const regex = /VALUES\s*\(((?:&#\d+;|[^;])+)\)/g;
    let match;
    const invoices = {};

    while ((match = regex.exec(salesContent)) !== null) {
      const tuples = extractTuples('(' + match[1] + ')');
      for (let t = 0; t < tuples.length; t++) {
        try {
          const vals = parseValues(tuples[t]);
          if (!vals || vals.length < 50) continue;
          const invoiceid = vals[1];
          const invtype = vals[2] ? vals[2].trim() : '';
          if (invtype !== 'sale') continue;
          const userid = vals[26].trim();
          const phone = vals[45] ? vals[45].trim() : '';
          const custname = vals[44] ? vals[44].trim() : '';
          const netpaid = parseFloat(vals[35]) || 0;
          const paid2 = parseFloat(vals[39]) || 0;
          const realPaid = netpaid + paid2;
          const discount = parseFloat(vals[27]) || 0;

          /* Pharmaclick بيكتب "/" كده &#47; — بنرجّعها لشكلها */
          const itemName = (vals[6] ? vals[6].trim() : (vals[5] ? vals[5].trim() : 'صنف غير معروف'))
            .replace(/&#(\d+);/g, function (m, c) { return String.fromCharCode(+c); });
          const itemQty = parseFloat(vals[7]) || 0;
          const itemPrice = parseFloat(vals[8]) || 0;

          if (!invoices[invoiceid]) {
            invoices[invoiceid] = {
              invoiceid: invoiceid, employee: userid,
              custname: custname || 'عميل نقدي', phone: phone,
              total: realPaid, discount: discount, itemCount: 0,
              items: []
            };
          }
          invoices[invoiceid].itemCount++;
          invoices[invoiceid].items.push({ name: itemName, qty: itemQty, price: itemPrice });
        } catch(e) { continue; }
      }
    }

    const byEmployee = {};
    Object.keys(invoices).forEach(function(id) {
      const inv = invoices[id];
      const emp = resolveEmpName(normalizeEmpId(inv.employee));
      if (!byEmployee[emp]) byEmployee[emp] = [];
      byEmployee[emp].push(inv);
    });

    Object.keys(byEmployee).forEach(function(emp) {
      byEmployee[emp].sort(function(a,b){ return parseInt(b.invoiceid) - parseInt(a.invoiceid); });
    });

    return { ok: true, date: dateStr, employees: byEmployee };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}


function checkStaffOrders() {
  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(10000)) {
      Logger.log('checkStaffOrders: تشغيلة تانية شغالة دلوقتي — استنينا الدور الجاي');
      return;
    }
  } catch(e) {
    return;
  }

  try {
    const props = PropertiesService.getScriptProperties();
    props.setProperty('lastLiveRunAt', Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss'));
    const folder = DriveApp.getFolderById(SALES_FOLDER);
    const today = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');

    let salesContent = '';
    const salesFiles = folder.getFilesByName('sales' + today + '.txt');
    if (salesFiles.hasNext()) {
      salesContent = salesFiles.next().getBlob().getDataAsString('UTF-8');
    }

    let returnsContent = '';
    const returnFiles = folder.getFilesByName('Returnsales' + today + '.txt');
    if (returnFiles.hasNext()) {
      returnsContent = returnFiles.next().getBlob().getDataAsString('UTF-8');
    }

    if (!salesContent && !returnsContent) return;

    const stats = parseStaffStats(salesContent + '\n' + returnsContent, today);
    saveStaffStats(stats, today);
    logNewCustomers(stats, today);
    processCustomerSMS(); // 🆕 يبعت SMS + يحسب نقاط الولاء لكل فاتورة جديدة
  } catch(e) {
    Logger.log('خطأ checkStaffOrders: ' + e.message);
  } finally {
    lock.releaseLock();
  }
}

function extractTuples(valuesBlock) {
  const tuples = [];
  let depth = 0;
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < valuesBlock.length; i++) {
    const c = valuesBlock[i];
    if (c === '"') { inQuotes = !inQuotes; current += c; continue; }
    if (!inQuotes && c === '(') { depth++; if (depth === 1) { current = ''; continue; } }
    if (!inQuotes && c === ')') {
      depth--;
      if (depth === 0) { tuples.push(current); continue; }
    }
    if (depth >= 1) current += c;
  }
  return tuples;
}

function parseStaffStats(content, today, minInvoiceId) {
  minInvoiceId = minInvoiceId || 0;
  const stats = {};
  const regex = /VALUES\s*\(((?:&#\d+;|[^;])+)\)/g;
  let match;
  const seen = new Set();
  let maxInvoiceId = minInvoiceId;

  while ((match = regex.exec(content)) !== null) {
    const tuples = extractTuples('(' + match[1] + ')');
    for (let t = 0; t < tuples.length; t++) {
    try {
      const vals = parseValues(tuples[t]);
      if (!vals || vals.length < 50) continue;

      const invoiceid = vals[1];
      const invoiceNum = parseInt(invoiceid) || 0;
      if (invoiceNum > maxInvoiceId) maxInvoiceId = invoiceNum;
      if (invoiceNum <= minInvoiceId) continue;

      const invtype = vals[2];
      const userid = vals[26].trim();
      const phone = vals[45] ? vals[45].trim() : '';
      const custname = vals[44] ? vals[44].trim() : '';
      const grandtotal = parseFloat(vals[40]) || 0;
      const netpaid = parseFloat(vals[35]) || 0;
      const paid2 = parseFloat(vals[39]) || 0;
      const realPaid = netpaid + paid2;
      const discount = parseFloat(vals[27]) || 0;
      const itemProfit = vals.length > 54 ? (parseFloat(vals[54]) || 0) : 0;

      const cleanType = invtype.trim();
      if (cleanType !== 'sale' && cleanType !== 'return') continue;

      const empKey = userid;

      if (!stats[empKey]) {
        stats[empKey] = {
          invoices: new Set(), sales: 0, discount: 0, profit: 0,
          phones: new Set(), no_phone: 0,
          returns: new Set(), returns_value: 0,
          new_customers: new Set(), repeat_customers: new Set()
        };
      }

      if (cleanType === 'sale') {
        stats[empKey].profit += itemProfit;
      } else if (cleanType === 'return') {
        stats[empKey].profit -= itemProfit;
      }

      const key = invoiceid + '_' + cleanType;
      if (seen.has(key)) continue;
      seen.add(key);

      const s = stats[empKey];
      if (cleanType === 'sale') {
        s.invoices.add(invoiceid);
        s.sales += realPaid;
        s.discount += discount;
        if (phone && phone.length > 3) {
          s.phones.add(phone);
          if (!s.phoneNames) s.phoneNames = {};
          if (custname) s.phoneNames[phone] = custname;
        } else {
          s.no_phone++;
        }
      } else if (cleanType === 'return') {
        s.returns.add(invoiceid);
        s.returns_value += realPaid;
      }
    } catch(e) {
      continue;
    }
    }
  }

  const props = PropertiesService.getScriptProperties();
  const knownCustomers = JSON.parse(props.getProperty('knownCustomers') || '{}');

  for (let emp in stats) {
    const s = stats[emp];
    for (let phone of s.phones) {
      if (knownCustomers[phone]) {
        s.repeat_customers.add(phone);
      } else {
        s.new_customers.add(phone);
        knownCustomers[phone] = today;
      }
    }
  }

  props.setProperty('knownCustomers', JSON.stringify(knownCustomers));
  _lastMaxInvoiceIdParsed = maxInvoiceId;
  return stats;
}

function saveStaffStatsIncremental(stats, today) {
  const ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
  let sheet = ss.getSheetByName('الموظفين');
  if (!sheet) {
    sheet = ss.insertSheet('الموظفين');
    sheet.appendRow([
      'التاريخ', 'الموظف', 'فواتير', 'مبيعات', 'مرتجعات', 'قيمة المرتجعات',
      'صافي', 'خصم', 'عملاء مسجلين', 'غير مسجلين', 'نسبة التسجيل',
      'عملاء جدد', 'متكررين', 'متوسط الفاتورة', 'الربح الصافي'
    ]);
  } else if (sheet.getRange(1, 15).getValue() !== 'الربح الصافي') {
    sheet.getRange(1, 15).setValue('الربح الصافي');
  }

  const data = sheet.getDataRange().getValues();

  for (let emp in stats) {
    const s = stats[emp];
    if (s.invoices.size === 0 && s.returns.size === 0) continue;

    const dInvoices = s.invoices.size;
    const dSales = Math.round(s.sales);
    const dReturns = s.returns.size;
    const dReturnsVal = Math.round(s.returns_value);
    const dDiscount = Math.round(s.discount);
    const dProfit = Math.round(s.profit || 0);
    const dRegistered = s.phones.size;
    const dNotReg = s.no_phone;
    const dNewC = s.new_customers.size;
    const dRepeatC = s.repeat_customers.size;

    let rowIndex = -1;
    for (let i = 1; i < data.length; i++) {
      const rowDate = data[i][0] instanceof Date ?
        Utilities.formatDate(data[i][0], 'Africa/Cairo', 'yyyy-MM-dd') :
        String(data[i][0]).substring(0, 10);
      if (rowDate === today && data[i][1] === emp) { rowIndex = i + 1; break; }
    }

    if (rowIndex === -1) {
      const total_cust0 = dRegistered + dNotReg;
      const reg_pct0 = total_cust0 > 0 ? Math.round(dRegistered / total_cust0 * 100) : 0;
      const avg_inv0 = dInvoices > 0 ? Math.round(dSales / dInvoices) : 0;
      const net0 = dSales - dReturnsVal;
      sheet.appendRow([today, emp, dInvoices, dSales, dReturns, dReturnsVal, net0, dDiscount,
        dRegistered, dNotReg, reg_pct0, dNewC, dRepeatC, avg_inv0, dProfit]);
      continue;
    }

    const old = sheet.getRange(rowIndex, 3, 1, 13).getValues()[0];
    const newInvoices = (old[0] || 0) + dInvoices;
    const newSales = (old[1] || 0) + dSales;
    const newReturns = (old[2] || 0) + dReturns;
    const newReturnsVal = (old[3] || 0) + dReturnsVal;
    const newDiscount = (old[5] || 0) + dDiscount;
    const newRegistered = (old[6] || 0) + dRegistered;
    const newNotReg = (old[7] || 0) + dNotReg;
    const newNewC = (old[9] || 0) + dNewC;
    const newRepeatC = (old[10] || 0) + dRepeatC;
    const newProfit = (old[12] || 0) + dProfit;

    const newTotalCust = newRegistered + newNotReg;
    const newRegPct = newTotalCust > 0 ? Math.round(newRegistered / newTotalCust * 100) : 0;
    const newAvgInv = newInvoices > 0 ? Math.round(newSales / newInvoices) : 0;
    const newNet = newSales - newReturnsVal;

    sheet.getRange(rowIndex, 3, 1, 13).setValues([[
      newInvoices, newSales, newReturns, newReturnsVal, newNet, newDiscount,
      newRegistered, newNotReg, newRegPct, newNewC, newRepeatC, newAvgInv, newProfit
    ]]);
  }
}

function saveStaffStats(stats, today) {
  const ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
  let sheet = ss.getSheetByName('الموظفين');
  if (!sheet) {
    sheet = ss.insertSheet('الموظفين');
    sheet.appendRow([
      'التاريخ', 'الموظف', 'فواتير', 'مبيعات', 'مرتجعات', 'قيمة المرتجعات',
      'صافي', 'خصم', 'عملاء مسجلين', 'غير مسجلين', 'نسبة التسجيل',
      'عملاء جدد', 'متكررين', 'متوسط الفاتورة', 'الربح الصافي'
    ]);
  } else if (sheet.getRange(1, 15).getValue() !== 'الربح الصافي') {
    sheet.getRange(1, 15).setValue('الربح الصافي');
  }

  const data = sheet.getDataRange().getValues();

  for (let emp in stats) {
    const s = stats[emp];
    if (s.invoices.size === 0) continue;
    const invoices = s.invoices.size;
    const sales = Math.round(s.sales);
    const returns = s.returns.size;
    const returns_val = Math.round(s.returns_value);
    const net = sales - returns_val;
    const discount = Math.round(s.discount);
    const profit = Math.round(s.profit || 0);
    const registered = s.phones.size;
    const not_reg = s.no_phone;
    const total_cust = registered + not_reg;
    const reg_pct = total_cust > 0 ? Math.round(registered / total_cust * 100) : 0;
    const new_c = s.new_customers.size;
    const repeat_c = s.repeat_customers.size;
    const avg_inv = invoices > 0 ? Math.round(sales / invoices) : 0;

    let found = false;
    for (let i = 1; i < data.length; i++) {
      const rowDate = data[i][0] instanceof Date ?
        Utilities.formatDate(data[i][0], 'Africa/Cairo', 'yyyy-MM-dd') :
        String(data[i][0]).substring(0, 10);
      if (rowDate === today && data[i][1] === emp) {
        sheet.getRange(i + 1, 3, 1, 12).setValues([[
          invoices, sales, returns, returns_val, net, discount,
          registered, not_reg, reg_pct, new_c, repeat_c, avg_inv
        ]]);
        sheet.getRange(i + 1, 15).setValue(profit);
        found = true;
        break;
      }
    }

    if (!found) {
      sheet.appendRow([
        today, emp, invoices, sales, returns, returns_val, net, discount,
        registered, not_reg, reg_pct, new_c, repeat_c, avg_inv, profit
      ]);
    }
  }
}

function wipeAndRebuildStaffSheet() {
  const ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
  const sheet = ss.getSheetByName('الموظفين');
  if (sheet && sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  }
  const logSheet = ss.getSheetByName('سجل العملاء الجدد');
  if (logSheet && logSheet.getLastRow() > 1) {
    logSheet.getRange(2, 1, logSheet.getLastRow() - 1, logSheet.getLastColumn()).clearContent();
  }
  PropertiesService.getScriptProperties().deleteProperty('rebuildCursor');
  Logger.log('🧹 اتمسح الشيت بالكامل. دلوقتي شغّل rebuildAllStaffData (وكرر Run لحد "خلصنا كل الأيام")');
}

function stopAutoRebuild() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'rebuildAllStaffData') ScriptApp.deleteTrigger(t);
  });
  Logger.log('🛑 اتوقف التريجر التلقائي');
}

function pauseLiveTrigger() {
  var count = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'checkStaffOrders') { ScriptApp.deleteTrigger(t); count++; }
  });
  Logger.log('⏸️ اتوقف التريجر الحي (checkStaffOrders) — عدد التريجرز اللي اتشالت: ' + count);
}

function resumeLiveTrigger() {
  var exists = ScriptApp.getProjectTriggers().some(function(t) {
    return t.getHandlerFunction() === 'checkStaffOrders';
  });
  if (!exists) {
    ScriptApp.newTrigger('checkStaffOrders').timeBased().everyMinutes(1).create();
    Logger.log('▶️ رجع التريجر الحي يشتغل تاني كل دقيقة');
  } else {
    Logger.log('التريجر الحي شغال أصلاً');
  }
}

function fixEverythingAuto() {
  pauseLiveTrigger();
  wipeAndRebuildStaffSheet();
  startAutoRebuild();
  Logger.log('🚀 بدأ الإصلاح التلقائي — سيبها وهتخلص لوحدها وتبعتلك رسالة تليجرام لما تكمل');
}

function startAutoRebuild() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'rebuildAllStaffData') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('rebuildAllStaffData').timeBased().everyMinutes(1).create();
  Logger.log('🚀 التريجر التلقائي اتظبط — هيشتغل لوحده كل دقيقة لحد ما يخلص');
}

function rebuildAllStaffData() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    Logger.log('⏳ في عملية تانية شغالة دلوقتي — استنى شوية وحاول تاني');
    return;
  }

  try {
    const props = PropertiesService.getScriptProperties();
    const totalDaysBack = 260;
    const batchSize = 8;

    let cursor = parseInt(props.getProperty('rebuildCursor') || '0');

    if (cursor === 0) {
      resetKnownCustomers();
    }

    const remaining = totalDaysBack - cursor;
    if (remaining <= 0) {
      Logger.log('🎉 خلصنا كل الأيام بالفعل! مفيش حاجة تانية تتعالج.');
      return;
    }

    const thisBatch = Math.min(batchSize, remaining);
    const folder = DriveApp.getFolderById(SALES_FOLDER);
    const now = new Date();
    let fixed = 0;

    const dayStrings = [];
    for (let i = cursor; i < cursor + thisBatch; i++) {
      const daysAgo = totalDaysBack - i - 1;
      const d = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
      dayStrings.push(Utilities.formatDate(d, 'Africa/Cairo', 'yyyy-MM-dd'));
    }

    dayStrings.forEach(function(dateStr) {
      let salesContent = '';
      const salesFiles = folder.getFilesByName('sales' + dateStr + '.txt');
      if (salesFiles.hasNext()) salesContent = salesFiles.next().getBlob().getDataAsString('UTF-8');

      let returnsContent = '';
      const returnFiles = folder.getFilesByName('Returnsales' + dateStr + '.txt');
      if (returnFiles.hasNext()) returnsContent = returnFiles.next().getBlob().getDataAsString('UTF-8');

      if (!salesContent && !returnsContent) return;

      const stats = parseStaffStats(salesContent + '\n' + returnsContent, dateStr);
      saveStaffStats(stats, dateStr);
      logNewCustomers(stats, dateStr);
      fixed++;
    });

    const newCursor = cursor + thisBatch;
    props.setProperty('rebuildCursor', String(newCursor));

    Logger.log('✅ اتعالج ' + fixed + ' يوم فيهم بيانات (من ' + thisBatch + ' يوم في الدفعة دي)');
    Logger.log('التقدم: ' + newCursor + ' / ' + totalDaysBack + ' يوم');

    if (newCursor >= totalDaysBack) {
      Logger.log('🎉 خلصنا كل الأيام! البيانات كلها اتصححت.');
      props.deleteProperty('rebuildCursor');
      ScriptApp.getProjectTriggers().forEach(function(t) {
        if (t.getHandlerFunction() === 'rebuildAllStaffData') ScriptApp.deleteTrigger(t);
      });
      var liveOn = ScriptApp.getProjectTriggers().some(function(t){ return t.getHandlerFunction() === 'checkStaffOrders'; });
      if (!liveOn) ScriptApp.newTrigger('checkStaffOrders').timeBased().everyMinutes(1).create();
      sendTelegramStaff('🎉 اكتمل إعادة بناء بيانات الموظفين تلقائياً', PERSONAL_CHAT);
    } else {
      Logger.log('⏳ لسه فيه دفعات — دوس Run تاني على rebuildAllStaffData عشان يكمل');
    }
  } finally {
    lock.releaseLock();
  }
}

function renameEmployeeInHistory(oldName, newName) {
  var ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
  var totalChanged = 0;

  var staffSheet = ss.getSheetByName('الموظفين');
  if (staffSheet && staffSheet.getLastRow() > 1) {
    var data = staffSheet.getRange(2, 2, staffSheet.getLastRow()-1, 1).getValues();
    for (var i = 0; i < data.length; i++) {
      if (data[i][0] === oldName) {
        staffSheet.getRange(i+2, 2).setValue(newName);
        totalChanged++;
      }
    }
  }

  var logSheet = ss.getSheetByName('سجل العملاء الجدد');
  if (logSheet && logSheet.getLastRow() > 1) {
    var data2 = logSheet.getRange(2, 2, logSheet.getLastRow()-1, 1).getValues();
    for (var j = 0; j < data2.length; j++) {
      if (data2[j][0] === oldName) {
        logSheet.getRange(j+2, 2).setValue(newName);
        totalChanged++;
      }
    }
  }

  Logger.log('✅ اتغيّر ' + totalChanged + ' صف من "' + oldName + '" لـ "' + newName + '"');
}

function migrateAllEmployeeNamesToIds() {
  var oldNames = {
    '1': 'الدكتور',
    '2': 'دكتور عبدالسلام',
    '3': 'دكتورة ولاء',
    '4': 'دكتور مصطفى الصعيدي',
    '5': 'استاذ ايمن'
  };
  for (var id in oldNames) {
    renameEmployeeInHistory(oldNames[id], id);
  }
  Logger.log('🎉 خلص الترحيل — كل السجل القديم بقى بأرقام الموظفين');
  deduplicateStaffSheet();
}

function deduplicateStaffSheet() {
  var ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
  var sheet = ss.getSheetByName('الموظفين');
  if (!sheet || sheet.getLastRow() <= 1) return { before: 0, after: 0 };
  var lastCol = 15;
  var data = sheet.getRange(2, 1, sheet.getLastRow()-1, lastCol).getValues();

  var merged = {};
  var order = [];

  data.forEach(function(row) {
    var rDate = row[0] instanceof Date ? Utilities.formatDate(row[0], 'Africa/Cairo', 'yyyy-MM-dd') : String(row[0]).substring(0, 10);
    var emp = normalizeEmpId(row[1]);
    row[1] = emp;
    var key = rDate + '_' + emp;
    var invoices = parseFloat(row[2]) || 0;

    if (!merged[key]) {
      var copy = row.slice();
      copy[0] = rDate;
      merged[key] = copy;
      order.push(key);
    } else {
      var existingInvoices = parseFloat(merged[key][2]) || 0;
      if (invoices > existingInvoices) {
        var copy2 = row.slice();
        copy2[0] = rDate;
        merged[key] = copy2;
      }
    }
  });

  sheet.getRange(2, 1, sheet.getLastRow()-1, lastCol).clearContent();
  var outRows = order.map(function(k){ return merged[k]; });
  if (outRows.length > 0) {
    sheet.getRange(2, 1, outRows.length, lastCol).setValues(outRows);
  }
  Logger.log('✅ دمج الصفوف المكررة: من ' + data.length + ' صف لـ ' + outRows.length + ' صف');
  return { before: data.length, after: outRows.length };
}

// ✅ يرجّع حالة الصيانة عشان لوحة التحكم تعرض علامة صح حقيقية بدل تخمين
function getMaintenanceStatus() {
  var props = PropertiesService.getScriptProperties();
  var cursor = parseInt(props.getProperty('rebuildCursor') || '0');
  var rebuildRunning = ScriptApp.getProjectTriggers().some(function(t){ return t.getHandlerFunction() === 'rebuildAllStaffData'; });
  var liveOn = ScriptApp.getProjectTriggers().some(function(t){ return t.getHandlerFunction() === 'checkStaffOrders'; });
  var lastLiveRunAt = props.getProperty('lastLiveRunAt') || '';
  return {
    ok: true,
    cursor: cursor,
    total: 260,
    rebuildRunning: rebuildRunning,
    liveTriggerOn: liveOn,
    lastLiveRunAt: lastLiveRunAt,
    rebuildDone: !rebuildRunning && cursor === 0 // اتصفرت لما تخلص
  };
}



function resetRebuildProgress() {
  PropertiesService.getScriptProperties().deleteProperty('rebuildCursor');
  Logger.log('اتصفر عداد التقدم — rebuildAllStaffData هيبدأ من الأول تاني لو شغلتها');
}

function reprocessRecentDays(daysBack) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    Logger.log('⏳ في عملية تانية شغالة دلوقتي — استنى شوية وحاول تاني');
    return;
  }
  try {
    daysBack = daysBack || 14;
    const folder = DriveApp.getFolderById(SALES_FOLDER);
    const now = new Date();
    let fixed = 0;

    const dayStrings = [];
    for (let i = daysBack - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      dayStrings.push(Utilities.formatDate(d, 'Africa/Cairo', 'yyyy-MM-dd'));
    }

    dayStrings.forEach(function(dateStr) {
      let salesContent = '';
      const salesFiles = folder.getFilesByName('sales' + dateStr + '.txt');
      if (salesFiles.hasNext()) {
        salesContent = salesFiles.next().getBlob().getDataAsString('UTF-8');
      }

      let returnsContent = '';
      const returnFiles = folder.getFilesByName('Returnsales' + dateStr + '.txt');
      if (returnFiles.hasNext()) {
        returnsContent = returnFiles.next().getBlob().getDataAsString('UTF-8');
      }

      if (!salesContent && !returnsContent) return;

      const stats = parseStaffStats(salesContent + '\n' + returnsContent, dateStr);
      saveStaffStats(stats, dateStr);
      logNewCustomers(stats, dateStr);
      fixed++;
      Logger.log('تم تصحيح يوم: ' + dateStr);
    });

    Logger.log('تم تصحيح ' + fixed + ' يوم بإجمالي (من الأقدم للأحدث)');
    sendTelegramStaff('✅ تم تصحيح بيانات آخر ' + fixed + ' يوم', PERSONAL_CHAT);
  } finally {
    lock.releaseLock();
  }
}

function resetKnownCustomers() {
  PropertiesService.getScriptProperties().deleteProperty('knownCustomers');
  Logger.log('تم تصفير سجل العملاء المعروفين — دلوقتي شغّل reprocessRecentDays');
}

function resetStaffInvoiceWatermark(dateStr) {
  PropertiesService.getScriptProperties().deleteProperty('lastStaffInv_' + dateStr);
  Logger.log('تم تصفير عداد يوم ' + dateStr + ' — شغّل reprocessRecentDays دلوقتي');
}

function buildEmployeeMsg(emp, data) {
  const invoices = data[2];
  const sales = data[3];
  const returns = data[4];
  const returns_val = data[5];
  const net = data[6];
  const discount = data[7];
  const registered = data[8];
  const not_reg = data[9];
  const reg_pct = data[10];
  const new_c = data[11];
  const repeat_c = data[12];
  const avg_inv = data[13];
  const total_cust = registered + not_reg;
  const disc_pct = sales > 0 ? (discount / sales * 100).toFixed(1) : 0;
  const needed = Math.max(0, Math.round((TARGETS.registration / 100 * total_cust) - registered));

  let msg = `\n👤 ${emp}\n`;
  msg += `📦 فواتير: ${invoices} | ↩️ مرتجعات: ${returns}\n`;
  msg += `💰 مبيعات: ${sales.toLocaleString()} جنيه\n`;
  if (returns > 0) msg += `↩️ قيمة المرتجع: ${returns_val.toLocaleString()} جنيه\n`;
  msg += `✅ صافي: ${net.toLocaleString()} جنيه\n`;

  msg += `🧾 متوسط الفاتورة: ${avg_inv} جنيه`;
  if (avg_inv < TARGETS.avg_invoice) {
    msg += ` ❌\n`;
    msg += `    ↳ 🎯 الهدف: ${TARGETS.avg_invoice} جنيه للفاتورة الواحدة\n`;
    msg += `    ↳ 💡 اسأل العميل:\n`;
    msg += `       "محتاج حاجة تانية؟"\n`;
    msg += `       أو اقترح مكمل للدواء\n`;
  } else {
    msg += ` ✅\n`;
  }

  msg += `✂️ خصم: ${discount.toLocaleString()} جنيه (${disc_pct}%)`;
  if (parseFloat(disc_pct) > TARGETS.discount_pct) {
    msg += ` ❌\n`;
    msg += `    ↳ 🎯 الحد الأقصى: ${TARGETS.discount_pct}%\n`;
    msg += `    ↳ 💡 اعرض البديل الأرخص الأول\n`;
    msg += `       قبل ما تدي خصم\n`;
  } else {
    msg += ` ✅\n`;
  }

  if (returns > TARGETS.max_returns) {
    msg += `⚠️ مرتجعات كتير!\n`;
    msg += `    ↳ 💡 تأكد من صلاحية الأدوية\n`;
    msg += `       قبل ما تديها للعميل\n`;
  }

  msg += SEP2 + '\n';
  msg += `عملاء:\n`;
  msg += `🆕 جدد: ${new_c} | 🔄 متكررين: ${repeat_c} | ❓ غير مسجل: ${not_reg}\n`;
  msg += `📋 تسجيل: ${registered}/${total_cust} (${reg_pct}%)`;

  if (reg_pct >= TARGETS.registration) {
    msg += ` ✅\n`;
    msg += `    ↳ 🎉 تجاوزت الهدف كملي كده\n`;
  } else {
    msg += ` ❌\n`;
    msg += `    ↳ 🎯 الهدف بكره: سجل ${needed} عملاء أكتر\n`;
    msg += `    ↳ 💡 قول للعميل:\n`;
    msg += `       "ممكن رقمك عشان نبعتلك\n`;
    msg += `        العروض والمنتجات الجديدة؟"\n`;
    msg += `    ↳ ⏰ أفضل وقت: لما بتدي الدواء\n`;
    msg += `       مش بعد ما يدفع\n`;
  }

  return msg;
}

var _oldNameToId = {'الدكتور':'1','دكتور عبدالسلام':'2','دكتورة ولاء':'3','دكتور مصطفى الصعيدي':'4','استاذ حمادة':'4','دكتور حماده':'4','استاذ ايمن':'5'};
function normalizeEmpId(val) { var s = String(val).trim(); return _oldNameToId[s] || s; }

function resolveEmpName(val) {
  return EMPLOYEES[val] || val;
}

function getReportForDate(targetDate, label, chatId) {
  const ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
  const sheet = ss.getSheetByName('الموظفين');
  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  const rows = [];

  for (let i = 1; i < data.length; i++) {
    const rowDate = data[i][0] instanceof Date ?
      Utilities.formatDate(data[i][0], 'Africa/Cairo', 'yyyy-MM-dd') :
      String(data[i][0]).substring(0, 10);
    if (rowDate === targetDate && data[i][2] > 0) {
      rows.push(data[i]);
    }
  }

  if (rows.length === 0) {
    sendTelegramStaff('⚠️ مفيش بيانات لـ ' + label, chatId);
    return;
  }

  rows.sort((a, b) => b[6] - a[6]);

  let msg = `📊 ${label}\n${SEP}`;
  for (const row of rows) {
    msg += buildEmployeeMsg(resolveEmpName(row[1]), row);
    msg += '\n' + SEP;
  }
  msg += `\n🏆 الأفضل: ${resolveEmpName(rows[0][1])}`;
  sendTelegramStaff(msg, chatId);
}

function getReportForRange(fromDate, toDate, label, chatId) {
  const ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
  const sheet = ss.getSheetByName('الموظفين');
  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  const monthly = {};

  for (let i = 1; i < data.length; i++) {
    const rowDate = data[i][0] instanceof Date ?
      Utilities.formatDate(data[i][0], 'Africa/Cairo', 'yyyy-MM-dd') :
      String(data[i][0]).substring(0, 10);

    if (rowDate < fromDate || rowDate > toDate) continue;
    if (!data[i][2] || data[i][2] === 0) continue;

    const emp = normalizeEmpId(data[i][1]);
    if (!monthly[emp]) {
      monthly[emp] = [0, resolveEmpName(emp), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    }

    monthly[emp][2] += parseInt(data[i][2]) || 0;
    monthly[emp][3] += parseInt(data[i][3]) || 0;
    monthly[emp][4] += parseInt(data[i][4]) || 0;
    monthly[emp][5] += parseInt(data[i][5]) || 0;
    monthly[emp][6] += parseInt(data[i][6]) || 0;
    monthly[emp][7] += parseInt(data[i][7]) || 0;
    monthly[emp][8] += parseInt(data[i][8]) || 0;
    monthly[emp][9] += parseInt(data[i][9]) || 0;
    monthly[emp][11] += parseInt(data[i][11]) || 0;
    monthly[emp][12] += parseInt(data[i][12]) || 0;
  }

  for (let emp in monthly) {
    const m = monthly[emp];
    const total_cust = m[8] + m[9];
    m[10] = total_cust > 0 ? Math.round(m[8] / total_cust * 100) : 0;
    m[13] = m[2] > 0 ? Math.round(m[3] / m[2]) : 0;
  }

  const sorted = Object.values(monthly).filter(m => m[2] > 0).sort((a, b) => b[6] - a[6]);

  if (sorted.length === 0) {
    sendTelegramStaff('⚠️ مفيش بيانات لـ ' + label, chatId);
    return;
  }

  let msg = `📊 ${label}\n${SEP}`;
  for (const row of sorted) {
    msg += buildEmployeeMsg(row[1], row);
    msg += '\n' + SEP;
  }
  msg += `\n🏆 الأفضل: ${sorted[0][1]}`;
  sendTelegramStaff(msg, chatId);
}

function sendDailyStaffReport(period) {
  try {
    const now = new Date();
    const today = Utilities.formatDate(now, 'Africa/Cairo', 'yyyy-MM-dd');
    const dateStr = Utilities.formatDate(now, 'Africa/Cairo', 'dd/MM/yyyy');
    const label = period === 'midday' ? `نص اليوم - ${dateStr}` : `ملخص اليوم - ${dateStr}`;

    const folder = DriveApp.getFolderById(SALES_FOLDER);
    let salesContent = '';
    const salesFiles = folder.getFilesByName('sales' + today + '.txt');
    if (salesFiles.hasNext()) salesContent = salesFiles.next().getBlob().getDataAsString('UTF-8');

    let returnsContent = '';
    const returnFiles = folder.getFilesByName('Returnsales' + today + '.txt');
    if (returnFiles.hasNext()) returnsContent = returnFiles.next().getBlob().getDataAsString('UTF-8');

    if (!salesContent && !returnsContent) return;
    const stats = parseStaffStats(salesContent + '\n' + returnsContent, today);
    saveStaffStats(stats, today);
    logNewCustomers(stats, today);

    getReportForDate(today, label, STAFF_GROUP);

    if (period === 'night') {
      const monthLabel = `الشهر حتى ${dateStr}`;
      const firstOfMonth = today.substring(0, 7) + '-01';
      getReportForRange(firstOfMonth, today, monthLabel, STAFF_GROUP);
    }
  } catch(e) {
    Logger.log('خطأ sendDailyStaffReport: ' + e.message);
  }
}

const SHORTAGE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyKMrAmkZ9Ipjgy59Kak2nUT0YsW0xfTWVjypo8J1Izaiof-qky7p2-Ebugx--HWjGK8A/exec';

function sendOrderSuggestion(chatId) {
  try {
    const res = UrlFetchApp.fetch(SHORTAGE_SCRIPT_URL + '?action=getShortages&days=7', { muteHttpExceptions: true });
    const d = JSON.parse(res.getContentText());
    if (!d || d.error) {
      sendTelegramStaff('⚠️ مقدرتش أجيب النواقص دلوقتي: ' + (d && d.msg ? d.msg : 'خطأ غير معروف'), chatId);
      return;
    }

    const bySupplier = {};
    ['zero', 'low'].forEach(function(section) {
      const data = d[section];
      if (!data || !data.categories) return;
      Object.keys(data.categories).forEach(function(cat) {
        const companies = data.categories[cat];
        Object.keys(companies).forEach(function(comp) {
          if (!bySupplier[comp]) bySupplier[comp] = [];
          companies[comp].forEach(function(item) {
            bySupplier[comp].push({ name: item.name, urgent: section === 'zero' });
          });
        });
      });
    });

    const suppliers = Object.keys(bySupplier);
    if (!suppliers.length) {
      sendTelegramStaff('🎉 مفيش نواقص دلوقتي — كل حاجة متوفرة!', chatId);
      return;
    }

    let msg = '📦 قائمة الطلبيات المقترحة (من النواقص)\n' + SEP + '\n';
    suppliers.forEach(function(comp) {
      msg += '\n🚚 ' + comp + ':\n';
      bySupplier[comp].forEach(function(item) {
        msg += (item.urgent ? '🔴 ' : '🟡 ') + item.name + '\n';
      });
    });
    msg += '\n' + SEP + '\n🔴 خلص خالص · 🟡 قرب يخلص\n\nراجعها وأكّدها بنفسك على أومت أو المورد المباشر.';

    sendTelegramStaff(msg, chatId);
  } catch(e) {
    sendTelegramStaff('⚠️ خطأ في تجهيز القائمة: ' + e.message, chatId);
  }
}

// ===================================================================
// 🤖 مساعد صيدلية السوسي — نسخة معاد بناؤها
//
// المبدأ الأساسي: الأسعار والتوافر بتتكتب من الكود حرفيًا من شيت المخزون.
// المودل بيصيغ الكلام بس، ولو حاول يذكر أي رقم مش موجود في المخزون
// بنرمي رده ونستخدم الرد المبني من البيانات. يعني مستحيل يخترع سعر.
// ===================================================================

const GEMINI_API_KEY = secret_('GEMINI_API_KEY');
const GEMINI_MODEL = 'gemini-3.5-flash-lite';  // الأسرع — الرد لازم يكون فوري
const STOCK_SHEET_ID = '1eOfouCRHpTpXNFSNS3nuz_3Vwj9siDiz0w6mY-zgEmo';

const PHARMACY_NAME = 'صيدلية السوسي';

// ---- إعدادات السياسة (غيّرها زي ما تحب) ----
const ALLOW_AUTO_ALTERNATIVES = false;  // false = البوت ميعرضش بديل من نفسه، يحوّلك
const MIN_EXPIRY_DAYS_TO_OFFER = 60;    // ميعرضش صنف صلاحيته أقل من كده
const LOW_STOCK_THRESHOLD = 1;          // أقل من علبة = "كمية قليلة"
const MAX_RESULTS_TO_SHOW = 4;          // أقصى عدد أصناف في الرد الواحد
const MIN_MATCH_SCORE = 60;             // أقل درجة تطابق نقبلها (أقل من كده = مش متوفر)
const MESSAGE_DEBOUNCE_MS = 2500;       // بيستنى ثانيتين ونص يجمّع الرسايل السريعة ورا بعض ("٣٢" ثم "لا") ويرد عليهم مرة واحدة
const STOCK_CACHE_MINUTES = 10;         // كام دقيقة نحتفظ بنسخة المخزون في الذاكرة

// ---- أسماء الشيتات الجديدة ----
const ORDERS_SHEET = 'طلبات العملاء';
const UNAVAILABLE_SHEET = 'طلبات غير متوفرة';
const QUOTES_LOG_SHEET = 'سجل أسعار البوت';

// ---- كلمات بتوقف البوت وتحوّل للدكتور فورًا ----
const ESCALATE_KEYWORDS = [
  'حامل','حمل','مرضعة','مرضع','رضاعة','رضيع','مولود','شهور','سنة ونص',
  'ضغط','سكري','سكر','قلب','كلى','كبد','صرع','غدة',
  'مضاد حيوي','مضاد حيوى','حقن','امبول','أمبول','روشتة','روشته','وصفة',
  'جرعة','جرعه','كام مرة','اخده ازاي','آخده','يضر','تفاعل','بديل ل'
];

// ===================================================================
// 1) استقبال رسايل تليجرام — Webhook أو Polling
// ===================================================================

// بيتنادى من doPost لما تليجرام يبعت update (الوضع السريع)

/* ═══════════════════ 🟢 واتساب (WhatsApp Cloud API) ═══════════════════
   نفس البوت بالظبط: رسالة الواتساب بتتحوّل لشكل رسالة تليجرام وتدخل نفس المعالج،
   وأي رد رايح لشات بيبدأ بـ wa_ بيتبعت على الواتساب بدل تليجرام.
   الإعدادات في Script Properties: WA_TOKEN (التوكن — محدش يشوفه) · WA_PHONE_ID (اختياري). */
var WA_API = 'https://graph.facebook.com/v21.0/';
function waPhoneId_() { return aiKey_('WA_PHONE_ID') || '1321594684378624'; }
function waToken_() { return aiKey_('WA_TOKEN'); }
function isWa_(id) { return String(id || '').indexOf('wa_') === 0; }
/* ميتا بتشيل from (رقم الموبايل) لأصحاب اليوزرنيم وبتبعت from_user_id (BSUID زي US.1349...) بدله.
   معرّف العميل = الرقم لو موجود، وإلا الـ BSUID. */
function waSenderId_(m) { return String((m && (m.from || m.from_user_id)) || '').trim(); }
function waIsPhoneId_(id) { return /^\d{6,20}$/.test(String(id || '')); }
/* رقم → to ، BSUID → recipient */
function waTarget_(chatId) {
  var id = String(chatId).slice(3);
  return waIsPhoneId_(id) ? { to: id } : { recipient_type: 'individual', recipient: id };
}
function waChatLabel_(chatId) {
  var id = String(chatId).slice(3);
  return waIsPhoneId_(id) ? '+' + id : 'يوزرنيم واتساب (من غير رقم)';
}
function waVerifyToken_() {
  var P = PropertiesService.getScriptProperties(), v = P.getProperty('WA_VERIFY');
  if (!v) { v = 'elsousy2026wa'; P.setProperty('WA_VERIFY', v); }
  return v;
}
function waInfo() {   /* للوحة: الحالة + اللي تحطه في Meta */
  return { ok: true, hasToken: !!waToken_(), phoneId: waPhoneId_(), verifyToken: waVerifyToken_(),
           callbackUrl: WEB_APP_URL, relayUrl: aiKey_('TG_RELAY_URL') || '',
           lastIn: aiKey_('WA_LAST_IN') || '', lastErr: aiKey_('WA_LAST_ERR') || '' };
}
/* حفظ التوكن من اللوحة (بالرقم السري) — التوكن بيتكتب بس، عمره ما بيرجع للوحة */
function setWaConfig(d) {
  var P = PropertiesService.getScriptProperties();
  var tok = String(d.token || '').trim(), pid = String(d.phoneId || '').trim();
  if (tok) { if (!/^EAA[\w-]{20,}$/.test(tok)) return { ok: false, error: 'التوكن شكله غلط — لازم يبدأ بـ EAA' }; P.setProperty('WA_TOKEN', tok); }
  if (pid) { if (!/^\d{8,20}$/.test(pid)) return { ok: false, error: 'Phone number ID أرقام بس' }; P.setProperty('WA_PHONE_ID', pid); }
  P.deleteProperty('WA_LAST_ERR');
  return { ok: true };
}
/* ربط حساب الواتساب (WABA) بالتطبيق عشان ميتا تبعت الرسايل للويبهوك + فحص */
function waSubscribe() {
  var tok = waToken_(); if (!tok) return { ok: false, error: 'التوكن مش متحط' };
  var waba = aiKey_('WA_WABA_ID') || '1121417500291242', H = { Authorization: 'Bearer ' + tok };
  var r = UrlFetchApp.fetch(WA_API + waba + '/subscribed_apps', { method: 'post', headers: H, muteHttpExceptions: true });
  var g = UrlFetchApp.fetch(WA_API + waba + '/subscribed_apps', { headers: H, muteHttpExceptions: true });
  var ok = r.getResponseCode() === 200, list = [];
  try { list = (JSON.parse(g.getContentText()).data || []).map(function (a) { return (a.whatsapp_business_api_data && a.whatsapp_business_api_data.name) || a.name || '?'; }); } catch (e) {}
  return { ok: ok, apps: list, error: ok ? '' : r.getContentText().slice(0, 300) };
}
function waCall_(path, body) {
  var tok = waToken_();
  if (!tok) return { ok: false, description: 'WA_TOKEN مش متحط في إعدادات السيرفر' };
  try {
    var r = UrlFetchApp.fetch(WA_API + path, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + tok }, payload: JSON.stringify(body) });
    var d = {}; try { d = JSON.parse(r.getContentText()); } catch (e) {}
    if (r.getResponseCode() !== 200) {
      var why = (d.error && (d.error.error_user_msg || d.error.message)) || ('HTTP ' + r.getResponseCode());
      if (d.error && d.error.code === 131047) why = 'فات أكتر من 24 ساعة على آخر رسالة من العميل — واتساب مش بيسمح برسالة عادية';
      PropertiesService.getScriptProperties().setProperty('WA_LAST_ERR', Utilities.formatDate(new Date(), 'Africa/Cairo', 'MM-dd HH:mm') + ' ' + why);
      return { ok: false, description: why };
    }
    var mid = (d.messages && d.messages[0] && d.messages[0].id) || '';
    /* رسالة البوت من الـ API — لو ميتا رجّعتها إيكو منسجّلهاش تاني كأنها رد الصيدلي */
    if (mid && body && body.type) { try { CacheService.getScriptCache().put('wamout_' + mid, '1', 21600); } catch (eO) {} }
    return { ok: true, result: { message_id: mid } };
  } catch (e) { return { ok: false, description: e.message }; }
}
/* بيبعت نص (ومعاه أزرار تليجرام بعد تحويلها لأزرار واتساب) */
function waSend_(chatId, text, markup) {
  var tgt = waTarget_(chatId), body = String(text == null ? '' : text).slice(0, 4000), btns = [], extra = '';
  if (markup && markup.inline_keyboard) markup.inline_keyboard.forEach(function (row) { row.forEach(function (b) {
    if (b.callback_data) btns.push({ id: b.callback_data, title: b.text });
    else if (b.url) extra += '\n' + b.text + ': ' + b.url;
  }); });
  if (markup && markup.keyboard) markup.keyboard.forEach(function (row) { row.forEach(function (b) {
    var tx = typeof b === 'string' ? b : b.text;
    if (b.request_location) extra += '\n📍 لإرسال موقعك: دوس 📎 ← الموقع (Location)';
    else if (!b.request_contact && tx) btns.push({ id: 'kb:' + tx, title: tx });
  }); });
  body = (body + extra).trim() || '.';
  var clean = function (s, n) { return String(s).replace(/\s+/g, ' ').trim().slice(0, n); };
  var mk = function (o) { o.messaging_product = 'whatsapp'; Object.keys(tgt).forEach(function (k) { o[k] = tgt[k]; }); return o; };
  if (btns.length && btns.length <= 3)
    return waCall_(waPhoneId_() + '/messages', mk({ type: 'interactive',
      interactive: { type: 'button', body: { text: body.slice(0, 1024) },
        action: { buttons: btns.map(function (b) { return { type: 'reply', reply: { id: String(b.id).slice(0, 256), title: clean(b.title, 20) } }; }) } } }));
  if (btns.length)
    return waCall_(waPhoneId_() + '/messages', mk({ type: 'interactive',
      interactive: { type: 'list', body: { text: body.slice(0, 1024) },
        action: { button: 'اختار من هنا', sections: [{ title: 'الاختيارات', rows: btns.slice(0, 10).map(function (b) { return { id: String(b.id).slice(0, 200), title: clean(b.title, 24) }; }) }] } } }));
  return waCall_(waPhoneId_() + '/messages', mk({ type: 'text', text: { body: body, preview_url: true } }));
}
/* "بيكتب..." + علامة القراية على آخر رسالة من العميل */
function waTyping_(chatId) {
  var mid = CacheService.getScriptCache().get('walast_' + chatId);
  if (mid) waCall_(waPhoneId_() + '/messages', { messaging_product: 'whatsapp', status: 'read', message_id: mid, typing_indicator: { type: 'text' } });
}
/* تحميل صورة/فويس من واتساب */
function waMediaBlob_(mediaId) {
  var tok = waToken_(); if (!tok) return null;
  try {
    var m = JSON.parse(UrlFetchApp.fetch(WA_API + mediaId, { headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true }).getContentText());
    if (!m.url) return null;
    return UrlFetchApp.fetch(m.url, { headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true }).getBlob();
  } catch (e) { Logger.log('waMedia: ' + e.message); return null; }
}
/* ملف من تليجرام أو واتساب (file_id بيبدأ بـ wa: لو واتساب) */
function tgFileBlob_(fileId) {
  if (String(fileId).indexOf('wa:') === 0) return waMediaBlob_(String(fileId).slice(3));
  var f = tgApi_('getFile', { file_id: fileId });
  if (!f || !f.ok || !f.result || !f.result.file_path) return null;
  return UrlFetchApp.fetch('https://api.telegram.org/file/bot' + BOT_TOKEN + '/' + f.result.file_path, { muteHttpExceptions: true }).getBlob();
}
/* صورة العميل من واتساب → تتبعتلك على تليجرام (بدل forwardMessage) */
function waForwardToStaff_(chatId, n) {
  var mid = CacheService.getScriptCache().get('wamid_' + chatId + '_' + n); if (!mid) return { ok: false };
  var blob = waMediaBlob_(mid); if (!blob) return { ok: false };
  try {
    UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendPhoto', { method: 'post', muteHttpExceptions: true,
      payload: { chat_id: String(PERSONAL_CHAT), caption: '🟢 صورة من واتساب — ' + (getKnownCustomerName_(chatId) || waChatLabel_(chatId)) + '\n[#c' + chatId + ']', photo: blob.setName('p.jpg') } });
  } catch (e) {}
  return { ok: true };
}
function waSeq_(chatId) {   /* رقم مسلسل لكل رسالة (الألبومات محتاجة أرقام متتالية) */
  var c = CacheService.getScriptCache(), k = 'waseq_' + chatId, n = (parseInt(c.get(k), 10) || 1000) + 1;
  c.put(k, String(n), 21600); return n;
}

function handleWhatsAppWebhook_(data) {
  (data.entry || []).forEach(function (en) { (en.changes || []).forEach(function (ch) {
    var v = ch.value || {};
    /* رد الصيدلي من تطبيق واتساب (تعايش). statuses و message_echoes (رسايل البوت من الـ API) مش هنا — منقراهمش ومش بنرد عليهم. */
    if (ch.field === 'smb_message_echoes') {
      (v.message_echoes || []).forEach(function (m) { try { waEcho_(m); } catch (e) { Logger.log('خطأ إيكو واتساب: ' + e.message); } });
      return;
    }
    var names = {};
    (v.contacts || []).forEach(function (c) {
      var nm = c.profile && (c.profile.name || c.profile.username);
      if (c.wa_id) names[c.wa_id] = nm;
      if (c.user_id) names[c.user_id] = nm;
    });
    (v.messages || []).forEach(function (m) { try { waOne_(m, names[waSenderId_(m)] || names[m.from_user_id] || ''); } catch (e) { Logger.log('خطأ واتساب: ' + e.message); } });
  }); });
}
/* معرّف العميل في الإيكو = to (من غير +) عشان يطابق شات wa_ بتاع رسايله الواردة */
function waEchoPeer_(raw) {
  var id = String(raw || '').trim();
  if (id.charAt(0) === '+') id = id.slice(1);
  var digits = id.replace(/[\s\-]/g, '');
  return /^\d{6,20}$/.test(digits) ? digits : id;
}
function waEchoCap_(obj) {
  var c = obj && obj.caption ? String(obj.caption).trim() : '';
  return c ? ' ' + c : '';
}
/* نص الإيكو للسجل: النص نفسه، وغير النص اختصار قصير. التعديل بيتردّ على الرسالة الجديدة. */
function waEchoBody_(m) {
  if (!m) return '';
  if (m.type === 'edit') return waEchoBody_(m.edit && m.edit.message);
  if (m.type === 'revoke') return '[اتمسحت]';
  if (m.type === 'text') return String((m.text && m.text.body) || '').trim();
  if (m.type === 'button') return String((m.button && m.button.text) || '').trim() || '[زرار]';
  if (m.type === 'image') return '[صورة]' + waEchoCap_(m.image);
  if (m.type === 'video') return '[فيديو]' + waEchoCap_(m.video);
  if (m.type === 'audio' || m.type === 'voice') return '[صوت]';
  if (m.type === 'document') return '[ملف]' + waEchoCap_(m.document);
  if (m.type === 'sticker') return '[ملصق]';
  if (m.type === 'location') return '[موقع]';
  if (m.type === 'contacts') return '[جهة اتصال]';
  if (m.type === 'interactive') return '[رسالة]';
  if (m.type === 'reaction' || m.type === 'unsupported' || m.type === 'system') return '';
  return '[رسالة]';
}
/* إيكو تطبيق الواتساب: نسجّله على شات العميل بدور الصيدلي، والبوت ميردّش. */
function waEcho_(m) {
  if (!m) return;
  var cache = CacheService.getScriptCache(), id = String(m.id || '');
  if (id && (cache.get('wamout_' + id) || cache.get('wam_' + id))) return;
  var orig = (m.edit && m.edit.original_message_id) || (m.revoke && m.revoke.original_message_id) || '';
  if (orig && cache.get('wamout_' + orig)) return;       /* تعديل/مسح لرسالة البوت نفسه */
  if (id) cache.put('wam_' + id, '1', 21600);
  var peer = waEchoPeer_(m.to), body = waEchoBody_(m);
  if (!peer || !body) return;
  var chatId = 'wa_' + peer, rows = [['pharm', body]];
  if (holdEcho_(chatId)) rows.push(['sys', '🤫 الصيدلي رد من الواتساب — البوت ساكت ٣٠ دقيقة']);
  logChatRows_(chatId, rows);
}
function waOne_(m, pname) {
  var cache = CacheService.getScriptCache();
  if (cache.get('wam_' + m.id)) return;                    /* ميتا بتعيد نفس الرسالة أحيانًا */
  if (m.id && cache.get('wamout_' + m.id)) return;         /* رسالة البوت من الـ API — مش عميل ومش هنرد عليها */
  cache.put('wam_' + m.id, '1', 21600);
  var sid = waSenderId_(m), P = PropertiesService.getScriptProperties();
  if (!sid) {   /* مفيش رقم ولا BSUID — منحفظ الشكل عشان نشخّصه، ومنعملش شات اسمه wa_undefined */
    P.setProperty('WA_LAST_ERR', Utilities.formatDate(new Date(), 'Africa/Cairo', 'MM-dd HH:mm') + ' رسالة من غير from/from_user_id: ' + JSON.stringify(m).slice(0, 300));
    return;
  }
  var chatId = 'wa_' + sid;
  P.setProperty('WA_LAST_IN', Utilities.formatDate(new Date(), 'Africa/Cairo', 'MM-dd HH:mm') + ' ' + m.type);
  cache.put('walast_' + chatId, m.id, 86400);
  /* رقم العميل معروف ومتأكد منه من واتساب نفسه — مفيش "سجّل رقمك".
     لو العميل بيوزرنيم ومفيش رقم (BSUID بس) بنسيب البوت يطلب الرقم بالطريقة العادية. */
  if (waIsPhoneId_(sid) && !P.getProperty('vphone_' + chatId)) {
    var vp = canonicalEgyptPhone_('+' + sid) || ('+' + sid);
    P.setProperty('vphone_' + chatId, vp); saveCustomerPhone_(chatId, vp);
  }
  var lock = LockService.getScriptLock(); try { lock.waitLock(5000); } catch (e) {}
  var n = waSeq_(chatId);
  try { lock.releaseLock(); } catch (e) {}
  var msg = { message_id: n, chat: { id: chatId, type: 'private' }, from: { id: chatId, first_name: pname || '' } };
  if (m.type === 'text') msg.text = m.text.body;
  else if (m.type === 'button') msg.text = m.button.text;
  else if (m.type === 'interactive') {
    var r = m.interactive.button_reply || m.interactive.list_reply || {};
    if (String(r.id).indexOf('kb:') === 0) msg.text = String(r.id).slice(3);
    else { handleCallback_({ id: 'wa', data: r.id, from: { id: chatId }, message: { chat: { id: chatId }, message_id: n } }); return; }
  }
  else if (m.type === 'image' || (m.type === 'document' && /^image\//.test(m.document.mime_type || ''))) {
    var md = m.image || m.document;
    cache.put('wamid_' + chatId + '_' + n, md.id, 21600);
    msg.photo = [{ file_id: 'wa:' + md.id }];
    if (md.caption) msg.caption = md.caption;
    /* الصور اللي بتيجي ورا بعض في أقل من 20 ثانية = ألبوم واحد */
    var gk = 'wagrp_' + chatId, g = cache.get(gk) || (chatId + '_' + n);
    cache.put(gk, g, 20); msg.media_group_id = g;
  }
  else if (m.type === 'audio') msg.voice = { file_id: 'wa:' + m.audio.id, mime_type: m.audio.mime_type || 'audio/ogg', duration: 0 };
  else if (m.type === 'location') msg.location = { latitude: m.location.latitude, longitude: m.location.longitude };
  else if (m.type === 'reaction' || m.type === 'unsupported') return;
  else {
    waSend_(chatId, 'وصلنا 🌿 للأسف مش بنقدر نفتح النوع ده من الملفات — ممكن حضرتك تكتب طلبك أو تبعت صورة؟');
    return;
  }
  handleCustomerMessage(chatId, msg);
}

function handleTelegramWebhook_(update) {
  try {
    // 🧹 تنظيف تلقائي مرة واحدة بعد كل نسخة جديدة:
    // بيفضّي أي رسايل قديمة متراكمة عند تليجرام عشان البوت ميردش على كلام قديم
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('queueCleared') !== 'yes') {
      props.setProperty('queueCleared', 'yes');
      try {
        if (WEB_APP_URL && WEB_APP_URL.indexOf('/exec') !== -1) {
          UrlFetchApp.fetch(
            'https://api.telegram.org/bot' + BOT_TOKEN +
            '/setWebhook?drop_pending_updates=true&url=' + encodeURIComponent(tgHookUrl_()),
            { muteHttpExceptions: true });
        }
      } catch (e) {}
      return; // الرسالة دي من الطابور القديم — بنسيبها
    }

    routeTelegramUpdate_(update);
  } catch (e) {
    Logger.log('خطأ handleTelegramWebhook_: ' + e.message);
  }
}

// الوضع القديم (تريجر كل دقيقة) — بيفضل شغال كخطة احتياطية
function checkStaffMessages() {
  try {
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('telegramWebhookOn') === 'yes') return; // الويبهوك شغال، مش محتاجين polling

    const lastUpdateId = parseInt(props.getProperty('lastStaffUpdateId') || '0');
    const url = 'https://api.telegram.org/bot' + BOT_TOKEN + '/getUpdates?offset=' + (lastUpdateId + 1) + '&timeout=0';
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const data = JSON.parse(response.getContentText());
    if (!data.ok || !data.result || data.result.length === 0) return;

    for (let update of data.result) {
      props.setProperty('lastStaffUpdateId', String(update.update_id));
      routeTelegramUpdate_(update);
    }
  } catch (e) {
    Logger.log('خطأ checkStaffMessages: ' + e.message);
  }
}

// بيوزّع أي update على المكان الصح
function routeTelegramUpdate_(update) {
  if (update && update.callback_query) {
    var cdk = 'tgu_' + update.update_id, cc = CacheService.getScriptCache();
    if (cc.get(cdk)) return;
    cc.put(cdk, '1', 3600);
    var cqc = update.callback_query.message && update.callback_query.message.chat;
    if (cqc && cqc.type === 'private') handleCallback_(update.callback_query);
    return;
  }
  if (!update || !update.message) return;

  // منع معالجة نفس الرسالة مرتين
  const cache = CacheService.getScriptCache();
  const dedupKey = 'tgu_' + update.update_id;
  if (cache.get(dedupKey)) return;
  cache.put(dedupKey, '1', 3600);

  const msg = update.message;
  const chatId = String(msg.chat.id);
  const text = (msg.text || '').trim();

  // (أ) رد الدكتور على سؤال عميل — يتبعت للعميل باسم الصيدلية
  if (msg.reply_to_message && chatId === String(PERSONAL_CHAT)) {
    if (relayDoctorReply_(msg)) return;
  }

  // (ب) أوامر الموظفين (نفس القديم بالظبط)
  if (handleStaffCommand_(chatId, text)) return;

  // (ج) رسالة عميل عادية
  if (msg.chat && msg.chat.type === 'private' && chatId !== String(PERSONAL_CHAT)) {
    handleCustomerMessage(chatId, msg);
  }
}

// أوامر الموظفين — اترجعت زي ما هي
function handleStaffCommand_(chatId, text) {
  const props = PropertiesService.getScriptProperties();

  if (text === 'موظفين') {
    sendTelegramStaff(
      '📊 تقرير الموظفين\n' + SEP + '\nاختار الفترة:\n\n' +
      '0️⃣ اليوم\n1️⃣ أمس\n2️⃣ هذا الأسبوع\n3️⃣ هذا الشهر\n4️⃣ فترة محددة',
      chatId
    );
    props.setProperty('waitingStaffReport_' + chatId, 'period');
    return true;
  }

  if (text === 'النواقص' || text === 'طلبيات') {
    sendTelegramStaff('⏳ جاري تجهيز قائمة الطلبيات من النواقص...', chatId);
    sendOrderSuggestion(chatId);
    return true;
  }

  const waiting = props.getProperty('waitingStaffReport_' + chatId);

  if (waiting === 'period') {
    const now = new Date();
    const today = Utilities.formatDate(now, 'Africa/Cairo', 'yyyy-MM-dd');
    const dateStr = Utilities.formatDate(now, 'Africa/Cairo', 'dd/MM/yyyy');

    if (text === '0') {
      props.deleteProperty('waitingStaffReport_' + chatId);
      sendTelegramStaff('⏳ جاري تجهيز التقرير...', chatId);
      getReportForDate(today, 'اليوم - ' + dateStr, chatId);
    } else if (text === '1') {
      props.deleteProperty('waitingStaffReport_' + chatId);
      sendTelegramStaff('⏳ جاري تجهيز التقرير...', chatId);
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const yDate = Utilities.formatDate(yesterday, 'Africa/Cairo', 'yyyy-MM-dd');
      const yDateStr = Utilities.formatDate(yesterday, 'Africa/Cairo', 'dd/MM/yyyy');
      getReportForDate(yDate, 'أمس - ' + yDateStr, chatId);
    } else if (text === '2') {
      props.deleteProperty('waitingStaffReport_' + chatId);
      sendTelegramStaff('⏳ جاري تجهيز التقرير...', chatId);
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const wDate = Utilities.formatDate(weekAgo, 'Africa/Cairo', 'yyyy-MM-dd');
      getReportForRange(wDate, today, 'الأسبوع حتى ' + dateStr, chatId);
    } else if (text === '3') {
      props.deleteProperty('waitingStaffReport_' + chatId);
      sendTelegramStaff('⏳ جاري تجهيز التقرير...', chatId);
      const firstOfMonth = today.substring(0, 7) + '-01';
      getReportForRange(firstOfMonth, today, 'الشهر حتى ' + dateStr, chatId);
    } else if (text === '4') {
      props.setProperty('waitingStaffReport_' + chatId, 'custom_date');
      sendTelegramStaff('ابعت الفترة بالشكل ده:\n01/06/2026 - 27/06/2026', chatId);
    }
    return true;
  }

  if (waiting === 'custom_date') {
    props.deleteProperty('waitingStaffReport_' + chatId);
    try {
      const parts = text.split('-').map(function(p){ return p.trim(); });
      const fromParts = parts[0].split('/');
      const toParts = parts[1].split('/');
      const fromDate = fromParts[2] + '-' + fromParts[1] + '-' + fromParts[0];
      const toDate = toParts[2] + '-' + toParts[1] + '-' + toParts[0];
      sendTelegramStaff('⏳ جاري تجهيز التقرير...', chatId);
      getReportForRange(fromDate, toDate, parts[0] + ' - ' + parts[1], chatId);
    } catch (e) {
      sendTelegramStaff('⚠️ صيغة غلط - ابعت كده:\n01/06/2026 - 27/06/2026', chatId);
    }
    return true;
  }

  return false;
}

// ===================================================================
// 2) تحويل السؤال للدكتور والرد عليه
// ===================================================================

// بيبعتلك السؤال ومعاه علامة مخفية فيها رقم شات العميل
function escalateToDoctor_(customerChatId, customerText, reason) {
  const name = getKnownCustomerName_(customerChatId);
  const who = name ? (name + ' ') : '';
  const vph = getVerifiedPhone_(customerChatId);
  const txt = '⚕️ سؤال محتاج ردك\n' + SEP + '\n' +
    who + (vph ? '📱 ' + vph + ' ' : '') + '(chat: ' + customerChatId + ')\n' +
    'السبب: ' + reason + '\n\n' +
    '"' + String(customerText || '').slice(0, 2500) + '"\n\n' +
    '↩️ اعمل Reply على الرسالة دي وأنا هوصّل ردك للعميل.\n' +
    '[#c' + customerChatId + ']';
  var PR = PropertiesService.getScriptProperties();
  try {   /* لو فيه تنبيه لنفس العميل لسه من غير رد (آخر 15 دقيقة): بنضيف الرسالة الجديدة عليه بدل تنبيه جديد */
    var st = JSON.parse(PR.getProperty('escmid_' + customerChatId) || 'null');
    var urgent = /🚨|صورة|روشتة/.test(String(reason));
    if (st && st.mid && !urgent && PR.getProperty('escp_' + customerChatId) && (Date.now() - st.at) < 15 * 60000) {
      var nt = st.txt + '\n➕ ' + Utilities.formatDate(new Date(), 'Africa/Cairo', 'HH:mm') + ' — "' + String(customerText || '').slice(0, 300) + '"  (' + reason + ')';
      if (nt.length < 3800) {
        var er = tgApi_('editMessageText', { chat_id: PERSONAL_CHAT, message_id: st.mid, text: nt, reply_markup: holdKb_(customerChatId, holdOn_(customerChatId)) });
        if (er && er.ok) {
          st.txt = nt; PR.setProperty('escmid_' + customerChatId, JSON.stringify(st));
          logChatRows_(customerChatId, [['sys', '⚕️ اتضاف لنفس التنبيه — ' + reason]]);
          return;
        }
      }
    }
  } catch (eM) {}
  const r = tgApi_('sendMessage', { chat_id: PERSONAL_CHAT, text: txt, reply_markup: holdKb_(customerChatId, holdOn_(customerChatId)) });
  try { if (r && r.ok && r.result) PR.setProperty('escmid_' + customerChatId, JSON.stringify({ mid: r.result.message_id, at: Date.now(), txt: txt })); } catch (eS) {}
  try {   /* 🔴 محتاج رد — بيظهر في صفحة المحادثات لحد ما ترد */
    PropertiesService.getScriptProperties().setProperty('escp_' + customerChatId, Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm'));
    logChatRows_(customerChatId, [['sys', '⚕️ اتحوّل للصيدلي — ' + reason]]);
  } catch (eL) {}
  if (!r || !r.ok) sendTelegramStaff(txt, PERSONAL_CHAT);
}

// لما تعمل Reply، بناخد ردك ونبعته للعميل باسم الصيدلية
function relayDoctorReply_(msg) {
  try {
    const original = msg.reply_to_message.text || '';
    const m = original.match(/\[#c(-?\d+|wa_[\w.]+)\]/);
    if (!m) return false;

    const customerChatId = m[1];
    const doctorText = (msg.text || '').trim();
    if (!doctorText) return false;

    sendTelegramStaff('👨‍⚕️ رد الدكتور:\n\n' + doctorText, customerChatId);
    saveConversationTurn(customerChatId, '[سؤال محوّل للدكتور]', doctorText, 'pharm');
    PropertiesService.getScriptProperties().deleteProperty('escp_' + customerChatId);
    PropertiesService.getScriptProperties().deleteProperty('escmid_' + customerChatId);
    sendTelegramStaff('✅ اتبعت للعميل.', PERSONAL_CHAT);
    return true;
  } catch (e) {
    Logger.log('خطأ relayDoctorReply_: ' + e.message);
    return false;
  }
}

// ===================================================================
// 3) البحث في المخزون — تطبيع عربي قوي + ترتيب بالأولوية
// ===================================================================

// بيوحّد شكل الكلمة: الهمزات، الألف، التاء المربوطة، الياء، التطويل، وأل التعريف
function normalizeArabic(s) {
  var t = String(s || '')
    .replace(/&#\d+;/g, ' ')
    .replace(/[\u0640]/g, '')                 // التطويل ـــ
    .replace(/[\u064B-\u0652]/g, '')          // التشكيل
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ء/g, '')
    .replace(/ة/g, 'ه')
    .replace(/[^\u0621-\u064Aa-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().toLowerCase();
  return t;
}

// بيشيل "ال" التعريف ويوحّد الألف الزيادة (بنادول = بانادول)
function stockKey_(s) {
  return normalizeArabic(s)
    .split(' ')
    .map(function(w){ return w.length > 3 && w.indexOf('ال') === 0 ? w.substring(2) : w; })
    .join(' ')
    .replace(/ا/g, '');   // بنشيل الألف خالص من مفتاح المقارنة
}

// كلمات منتشرة مش بتفيد في البحث
var STOP_WORDS_ = ['عندك','عندكم','عايز','عاوز','محتاج','ممكن','فيه','في','هل','لو','سمحت','من','فضلك','سعر','كام','بكام','علبه','علبة','شريط','برشام','دوا','دواء','صنف','طيب','طب','وفيه','وعندكم','موجود','متوفر','لسه','حضرتك','برضو','كمان'];

// كلمات كلام عادي مش أسماء أصناف ("اعرض" اتطابقت مع صنف "صن سويت عرض" لأن stockKey_ بيشيل الألف).
// بتتشال من البحث ومن استخراج اسم الصنف — بتتقارن بعد توحيد الألف زي بالظبط مفتاح المخزون.
var GENERIC_QUERY_WORDS_ = ['عرض','اعرض','اعرضلي','اعرضها','عروض','غالي','غاليه','رخيص','ارخص','اقتصادي','اقتصاديه','بديل','البديل','بدايل','حاجه','حاجة','زيه','زيها','زي','تاني','ايه','لا','تمام','ماشي','اه','ايوه','اوكي','شكرا','خلاص','معلش','قصدي','دا','ده','دي'];
// كلمات منتجات من حرفين (بتتشال عادةً لأن الكلمات القصيرة ملهاش لازمة) — "في رز طيب؟" كانت بترجع بحث فاضي وتاخد اللي قبلها
var SHORT_PRODUCT_WORDS_ = ['رز','بن','خل'];
// "هيكل" الكلمة من غير حروف العلة: سيرلاك = سيريلاك ، برفلجان = بيرفالجان (الألف بتتشال من stockKey_ قبل كده)
function skel_(w) { return String(w).replace(/[يو]/g, ''); }
var GENERIC_KEYS_ = null;
function isGenericWord_(w) {
  if (!GENERIC_KEYS_) {
    GENERIC_KEYS_ = {};
    GENERIC_QUERY_WORDS_.forEach(function (g) { GENERIC_KEYS_[stockKey_(g)] = true; });
  }
  return GENERIC_KEYS_[w] === true || GENERIC_KEYS_[stockKey_(w)] === true;
}

// بيقرا أعمدة المخزون المطلوبة بس (أسرع)، بالاسم مش بالرقم
function readStockRowsFresh_() {
  const ss = SpreadsheetApp.openById(STOCK_SHEET_ID);
  const sheet = ss.getSheets()[0];
  if (!sheet || sheet.getLastRow() <= 1) return [];

  const lastCol = sheet.getLastColumn();
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const idx = {};
  header.forEach(function(h, i) { idx[String(h || '').trim().toLowerCase()] = i; });

  const need = ['nameen','namear','price','stock','expire','units','activecomponent'];
  for (var i = 0; i < need.length; i++) {
    if (idx[need[i]] === undefined) {
      Logger.log('عمود ناقص في شيت المخزون: ' + need[i]);
      return [];
    }
  }

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
  const today = new Date();
  const out = [];

  for (var r = 0; r < data.length; r++) {
    const row = data[r];
    const stock = parseFloat(row[idx['stock']]) || 0;
    if (stock <= 0) continue;

    const nameAr = invCleanName_(row[idx['namear']]);
    const nameEn = invCleanName_(row[idx['nameen']]);
    const name = nameAr || nameEn;
    if (!name) continue;

    var daysToExpire = null;
    const expD = invParseDate_(row[idx['expire']], 'Africa/Cairo');
    if (expD) daysToExpire = Math.floor((expD - today) / 86400000);

    out.push({
      name: name,
      price: parseFloat(row[idx['price']]) || 0,
      stock: stock,
      units: parseFloat(row[idx['units']]) || 0,
      daysToExpire: daysToExpire,
      key: stockKey_(name + ' ' + nameEn),
      activeKey: stockKey_(row[idx['activecomponent']])
    });
  }
  return out;
}

// بنحتفظ بنسخة من المخزون في الذاكرة عشان منقراش الشيت مع كل رسالة.
// الشيت كبير (آلاف الصفوف) فقراءته كل مرة كانت بتاخد ثواني.
function readStockRows_() {
  try {
    const cache = CacheService.getScriptCache();
    const meta = cache.get('stk_meta');
    if (meta) {
      const n = parseInt(meta);
      const keys = [];
      for (var i = 0; i < n; i++) keys.push('stk_' + i);
      const parts = cache.getAll(keys);
      var joined = '';
      var ok = true;
      for (var j = 0; j < n; j++) {
        if (parts['stk_' + j] === undefined) { ok = false; break; }
        joined += parts['stk_' + j];
      }
      if (ok && joined) return JSON.parse(joined);
    }
  } catch (e) { /* الكاش وقع، هنقرا من الشيت عادي */ }

  const rows = readStockRowsFresh_();
  try {
    const json = JSON.stringify(rows);
    const CHUNK = 90000;
    const n = Math.ceil(json.length / CHUNK);
    const obj = {};
    for (var k = 0; k < n; k++) obj['stk_' + k] = json.substring(k * CHUNK, (k + 1) * CHUNK);
    const cache = CacheService.getScriptCache();
    cache.putAll(obj, STOCK_CACHE_MINUTES * 60);
    cache.put('stk_meta', String(n), STOCK_CACHE_MINUTES * 60);
  } catch (e) { /* عادي */ }
  return rows;
}

// لو حبيت تجبر تحديث المخزون فورًا بعد ما يتغير
function clearStockCache() {
  const cache = CacheService.getScriptCache();
  const meta = cache.get('stk_meta');
  if (meta) {
    const keys = ['stk_meta'];
    for (var i = 0; i < parseInt(meta); i++) keys.push('stk_' + i);
    cache.removeAll(keys);
  }
  Logger.log('✅ اتمسحت نسخة المخزون المحفوظة');
}

// البحث الأساسي — بيرجع نتايج مرتبة بالأهمية
// الفكرة: بنقارن كل كلمة في سؤال العميل بكل كلمة في اسم الصنف،
// وبندي درجة أعلى للتطابق الكامل. كده "بنادول" بتوصل لـ"بانادول"
// من غير ما تجيب "باندولين" (حفاضات) معاها.
function searchStock(query) {
  try {
    const rows = readStockRows_();
    if (!rows.length) return [];

    const qKey = stockKey_(query);
    if (!qKey) return [];

    const qWords = qKey.split(' ').filter(function(w) {
      return w.length >= 2 && STOP_WORDS_.indexOf(w) === -1 && !isGenericWord_(w);
    });
    if (!qWords.length) return [];

    const qSk = qWords.map(skel_);
    const scored = [];
    for (var i = 0; i < rows.length; i++) {
      const it = rows[i];
      const toks = it.key.split(' ').filter(function(t){ return t; });
      var score = 0, hit = 0;

      if (qKey.length >= 3 ? it.key.indexOf(qKey) !== -1 : toks.indexOf(qKey) !== -1) score += 60;   // العبارة كلها موجودة

      for (var w = 0; w < qWords.length; w++) {
        const qw = qWords[w];
        var best = 0;
        for (var t = 0; t < toks.length; t++) {
          const tok = toks[t];
          if (tok === qw) best = Math.max(best, 40);                                   // تطابق تام
          else if (qw.length >= 3 && tok.indexOf(qw) === 0) best = Math.max(best, Math.round(40 * qw.length / tok.length)); // بداية الكلمة
          else if (qw.length >= 3 && tok.indexOf(qw) !== -1) best = Math.max(best, Math.round(28 * qw.length / tok.length));
        }
        if (best === 0 && qSk[w].length >= 3) {   // اختلاف إملاء بسيط (سيرلاك/سيريلاك): بنقارن من غير ي و و
          for (var t2 = 0; t2 < toks.length; t2++) {
            const ts = skel_(toks[t2]);
            if (ts === qSk[w]) best = Math.max(best, 34);
            else if (qSk[w].length >= 4 && ts.indexOf(qSk[w]) === 0) best = Math.max(best, Math.round(30 * qSk[w].length / ts.length));
          }
        }
        if (best === 0 && it.activeKey && it.activeKey.indexOf(qw) !== -1) best = 12;   // المادة الفعالة
        if (best > 0) hit++;
        score += best;
      }
      if (!hit) continue;

      if (hit === qWords.length) score += 25;
      if (it.stock >= 1) score += 8;
      if (it.daysToExpire !== null && it.daysToExpire < MIN_EXPIRY_DAYS_TO_OFFER) score -= 60;

      scored.push({ item: it, score: score, hit: hit });
    }
    if (!scored.length) return [];

    // لو فيه نتايج طابقت كل الكلمات، منعرضش غيرها
    const full = scored.filter(function(x){ return x.hit === qWords.length; });
    const pool = full.length ? full : scored;

    pool.sort(function(a, b) { return b.score - a.score; });

    // درجة ضعيفة = مفيش تطابق حقيقي، أحسن نقول "مش متوفر" من إننا نجيب كلام غلط
    if (pool[0].score < MIN_MATCH_SCORE) return [];

    const cutoff = pool[0].score * 0.6;
    return pool.filter(function(x){ return x.score >= cutoff; })
               .slice(0, 8)
               .map(function(x){ return x.item; });
  } catch (e) {
    Logger.log('خطأ searchStock: ' + e.message);
    return [];
  }
}

// ===================================================================
// 4) بناء الرد من البيانات — الأسعار من هنا بس
// ===================================================================

function formatItemLine_(it) {
  var line = '• ' + it.name + ' — ' + Math.round(it.price) + ' جنيه';
  if (it.stock < LOW_STOCK_THRESHOLD) line += ' (كمية محدودة)';
  return line;
}

// بيرجع {text, prices[]} — prices هي الأرقام المسموح للمودل يذكرها
function buildProductAnswer_(results, askedFor) {
  const offerable = results.filter(function(it) {
    return it.daysToExpire === null || it.daysToExpire >= MIN_EXPIRY_DAYS_TO_OFFER;
  });

  if (!offerable.length) {
    return {
      available: false,
      text: 'للأسف "' + askedFor + '" مش متوفر عندنا دلوقتي. تحب الدكتور يشوفلك حل مناسب؟',
      prices: []
    };
  }

  const show = offerable.slice(0, MAX_RESULTS_TO_SHOW);
  const prices = show.map(function(it){ return Math.round(it.price); });

  var text;
  if (show.length === 1) {
    const it = show[0];
    text = 'متوفر عندنا ✅\n' + formatItemLine_(it);
    if (it.units > 1) text += '\nالعلبة ' + it.units + ' ' + (it.units > 10 ? 'حبة' : 'وحدة');
  } else {
    text = 'عندنا الأنواع دي متوفرة دلوقتي:\n' + show.map(formatItemLine_).join('\n') +
           '\n\nتحب أجهزلك أنهي واحد فيهم؟';
  }
  return { available: true, text: text, prices: prices, items: show };
}

// ===================================================================
// 5) جيميني — مع حارس يمنع اختراع الأرقام
// ===================================================================

/* ═══ اختيار موديل الذكاء الاصطناعي ═══
   بيتظبط من لوحة التحكم (⚙️ ← الذكاء الاصطناعي) — مش محتاج تفتح الكود.
   المفاتيح بتتحفظ في Script properties على السيرفر، ومش بتظهر في أي صفحة.
   لو الموديل المختار فشل أو مفتاحه مش موجود → البوت بيرجع لـ Gemini تلقائيًا. */
const AI_PROVIDER = 'claude';   // الافتراضي لو لسه متظبطش من اللوحة
var AI_KEYS = { claude: 'CLAUDE_API_KEY', grok: 'GROK_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY' };
var AI_DEFAULTS = {
  claude: { bot: 'claude-haiku-5-5', dose: 'claude-sonnet-5-5' },
  grok:   { bot: 'grok-4',           dose: 'grok-4' },
  openai: { bot: 'gpt-4.1-mini',     dose: 'gpt-4.1' },
  gemini: { bot: 'gemini-3.5-flash',  dose: 'gemini-3.5-flash' }   /* أقوى موديل مجاني — لو مش متاح بيرجع لـ flash-lite لوحده */
};

function aiKey_(name) {
  try { return PropertiesService.getScriptProperties().getProperty(name) || ''; } catch (e) { return ''; }
}
function aiCfg_() {
  var P = PropertiesService.getScriptProperties();
  var pr = P.getProperty('AI_PROVIDER') || AI_PROVIDER;
  if (!AI_DEFAULTS[pr]) pr = 'claude';
  var key = aiKey_(AI_KEYS[pr]) || (pr === 'gemini' ? GEMINI_API_KEY : '');
  return { provider: pr, key: key,
           bot: P.getProperty('AI_BOT_MODEL') || AI_DEFAULTS[pr].bot,
           dose: P.getProperty('AI_DOSE_MODEL') || AI_DEFAULTS[pr].dose };
}

/* ═══ عدّاد استهلاك الذكاء الاصطناعي ═══
   بيتسجل لكل نداء: عدد التوكنز (داخل/خارج) حسب النوع (بوت/جرعات/اختبار) والموديل، لكل شهر ولكل يوم.
   التكلفة تقديرية من أسعار Anthropic الرسمية (دولار لكل مليون توكن). باقي المزودين بنعرض التوكنز بس. */
var AI_PRICES = { 'claude-haiku-5-5': [0.10, 0.50], 'claude-sonnet-5-5': [2, 10], 'claude-opus-5-5': [4, 20],
                  'claude-haiku-4-5': [1, 5] };
function aiCost_(model, tin, tout) {
  var p = AI_PRICES[model]; if (!p) return null;
  return (tin * p[0] + tout * p[1]) / 1e6;
}
function aiTrack_(kind, model, tin, tout) {
  if (!tin && !tout) return;
  var lock = LockService.getScriptLock();
  try { if (!lock.tryLock(3000)) return; } catch (e) { return; }
  try {
    var P = PropertiesService.getScriptProperties(), now = new Date();
    var mk = 'AI_USE_' + Utilities.formatDate(now, 'Africa/Cairo', 'yyyy-MM');
    var day = Utilities.formatDate(now, 'Africa/Cairo', 'yyyy-MM-dd');
    var u = {}; try { u = JSON.parse(P.getProperty(mk) || '{}'); } catch (e) {}
    var c = aiCost_(model, tin, tout);
    function add(o) { o.calls = (o.calls || 0) + 1; o.in = (o.in || 0) + tin; o.out = (o.out || 0) + tout;
                      if (c !== null) o.cost = Math.round(((o.cost || 0) + c) * 1e6) / 1e6; else o.unpriced = true; }
    add(u.total = u.total || {});
    u.kinds = u.kinds || {}; add(u.kinds[kind] = u.kinds[kind] || {});
    u.models = u.models || {}; add(u.models[model] = u.models[model] || {});
    u.days = u.days || {}; add(u.days[day] = u.days[day] || {});
    var ks = Object.keys(u.days).sort(); while (ks.length > 35) delete u.days[ks.shift()];
    P.setProperty(mk, JSON.stringify(u));
  } catch (e) {} finally { try { lock.releaseLock(); } catch (e2) {} }
}
function getAiUsage() {
  var P = PropertiesService.getScriptProperties(), now = new Date();
  var mk = Utilities.formatDate(now, 'Africa/Cairo', 'yyyy-MM');
  var prev = Utilities.formatDate(new Date(now.getFullYear(), now.getMonth() - 1, 15), 'Africa/Cairo', 'yyyy-MM');
  var day = Utilities.formatDate(now, 'Africa/Cairo', 'yyyy-MM-dd');
  function rd(k) { try { return JSON.parse(P.getProperty('AI_USE_' + k) || '{}'); } catch (e) { return {}; } }
  var cur = rd(mk), last = rd(prev);
  return { ok: true, month: mk, today: (cur.days || {})[day] || {}, current: cur, lastMonth: { month: prev, total: last.total || {} },
           provider: aiCfg_().provider, budget: parseFloat(P.getProperty('AI_BUDGET') || '0') || 0 };
}

/* نداء واحد لأي مزوّد — بيرجع النص أو null */
/* لو فيه حد أقصى شهري واتعدّى → نوقف الموديل المدفوع (البوت بيكمّل على Gemini الاحتياطي) */
function aiOverBudget_() {
  try {
    var P = PropertiesService.getScriptProperties(), b = parseFloat(P.getProperty('AI_BUDGET') || '0');
    if (!b) return false;
    var u = JSON.parse(P.getProperty('AI_USE_' + Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM')) || '{}');
    return ((u.total && u.total.cost) || 0) >= b;
  } catch (e) { return false; }
}
var AI_LAST_ERR = '';
function aiCall_(provider, key, model, prompt, maxTokens, kind) {
  if (!key) return null;
  if (provider !== 'gemini' && aiOverBudget_()) { Logger.log('الحد الأقصى الشهري للذكاء الاصطناعي اتعدّى'); return null; }
  try {
    var res, d;
    if (provider === 'claude') {
      res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        payload: JSON.stringify({ model: model, max_tokens: maxTokens || 600, messages: [{ role: 'user', content: prompt }] }) });
      if (res.getResponseCode() !== 200) { AI_LAST_ERR = 'Claude ' + res.getResponseCode(); Logger.log('Claude ' + res.getResponseCode() + ': ' + res.getContentText().substring(0, 300)); return null; }
      d = JSON.parse(res.getContentText());
      if (d.usage) aiTrack_(kind || 'bot', model, d.usage.input_tokens || 0, d.usage.output_tokens || 0);
      return (d.content || []).filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join('') || null;
    }
    if (provider === 'grok' || provider === 'openai') {
      var url = provider === 'grok' ? 'https://api.x.ai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
      res = UrlFetchApp.fetch(url, {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { Authorization: 'Bearer ' + key },
        payload: JSON.stringify({ model: model, messages: [{ role: 'user', content: prompt }] }) });
      if (res.getResponseCode() !== 200) { AI_LAST_ERR = provider + ' ' + res.getResponseCode(); Logger.log(provider + ' ' + res.getResponseCode() + ': ' + res.getContentText().substring(0, 300)); return null; }
      d = JSON.parse(res.getContentText());
      if (d.usage) aiTrack_(kind || 'bot', model, d.usage.prompt_tokens || 0, d.usage.completion_tokens || 0);
      return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || null;
    }
    if (provider === 'gemini') {
      res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { 'x-goog-api-key': key },
        payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }],
          generationConfig: kind === 'dose' ? { temperature: 0.2, responseMimeType: 'application/json' } : { temperature: 0.4 } }) });
      if (res.getResponseCode() !== 200) {
        AI_LAST_ERR = 'Gemini ' + res.getResponseCode() + (res.getResponseCode() === 429 ? ' (وصل للحد المجاني في الدقيقة)' : '');
        Logger.log('Gemini ' + res.getResponseCode() + ': ' + res.getContentText().substring(0, 300)); return null;
      }
      d = JSON.parse(res.getContentText());
      if (d.usageMetadata) aiTrack_(kind || 'bot', model, d.usageMetadata.promptTokenCount || 0,
                                    (d.usageMetadata.candidatesTokenCount || 0) + (d.usageMetadata.thoughtsTokenCount || 0));
      var c0 = d.candidates && d.candidates[0], parts = c0 && c0.content && c0.content.parts;
      var txt = (parts || []).filter(function (x) { return x.text && !x.thought; }).map(function (x) { return x.text; }).join('');
      if (!txt) { AI_LAST_ERR = 'Gemini رجّع رد فاضي (' + ((c0 && c0.finishReason) || (d.promptFeedback && d.promptFeedback.blockReason) || '?') + ')'; Logger.log(AI_LAST_ERR); }
      return txt || null;
    }
  } catch (e) { AI_LAST_ERR = provider + ': ' + e.message; Logger.log('خطأ aiCall_ ' + provider + ': ' + e.message); }
  return null;
}

/* نقطة الدخول الوحيدة للبوت — كل البوت بينادي دي */
function callGemini(prompt, isRetry) {
  var c = aiCfg_();
  var out = aiCall_(c.provider, c.key, c.bot, prompt, 700);
  if (!out && c.provider !== 'gemini') {   /* المدفوع مش متاح (مفيش مفتاح/رصيد) → Gemini المجاني الأقوى */
    var gk = aiKey_('GEMINI_API_KEY') || GEMINI_API_KEY;
    out = aiCall_('gemini', gk, AI_DEFAULTS.gemini.bot, prompt, 700);
  }
  return out || callGeminiRaw_(prompt);   /* آخر احتياطي: flash-lite */
}

/* اختبار من لوحة التحكم */
function aiTest(q) {
  var c = aiCfg_(), t0 = Date.now(), who = c.provider + ' · ' + c.bot;
  var prompt = 'انت مساعد صيدلية مصرية. رد بجملة قصيرة بالعامية على العميل: ' + (q || 'عندكم بنادول؟');
  var r = aiCall_(c.provider, c.key, c.bot, prompt, 200, 'test');
  if (!r) { who = 'gemini (احتياطي)'; r = callGeminiRaw_(prompt); }
  return { ok: !!r, provider: who, hasKey: !!c.key, ms: Date.now() - t0, reply: r || 'مفيش رد' };
}

/* الإعدادات من اللوحة — محمية برقم سري (أول مرة بيتحفظ الرقم اللي تكتبه) */
function getAiConfig() {
  var c = aiCfg_(), keys = {};
  Object.keys(AI_KEYS).forEach(function (p) { var k = aiKey_(AI_KEYS[p]); keys[p] = k ? '••••' + k.slice(-4) : ''; });
  return { ok: true, provider: c.provider, bot: c.bot, dose: c.dose, keys: keys, defaults: AI_DEFAULTS,
           pinSet: !!aiKey_('ADMIN_PIN') };
}
/* التحقق من الرقم السري — مع تأخير بعد محاولات غلط كتير */
function adminPinOk_(pin) {
  var P = PropertiesService.getScriptProperties(), saved = P.getProperty('ADMIN_PIN');
  if (!saved) return false;
  if (String(pin || '') === saved) { P.deleteProperty('ADMIN_PIN_BAD'); return true; }
  var bad = parseInt(P.getProperty('ADMIN_PIN_BAD') || '0', 10) + 1;
  P.setProperty('ADMIN_PIN_BAD', String(bad));
  if (bad >= 10) Utilities.sleep(3000);
  return false;
}
function setAiConfig(d) {
  var P = PropertiesService.getScriptProperties();
  var pin = String(d.pin || '').trim(), saved = P.getProperty('ADMIN_PIN');
  if (!saved) {
    if (!/^\d{4,8}$/.test(pin)) return { ok: false, error: 'اختار رقم سري من 4 لـ 8 أرقام' };
    P.setProperty('ADMIN_PIN', pin);
  } else if (pin !== saved) {
    var bad = parseInt(P.getProperty('ADMIN_PIN_BAD') || '0', 10) + 1;
    P.setProperty('ADMIN_PIN_BAD', String(bad));
    if (bad >= 10) Utilities.sleep(3000);
    return { ok: false, error: 'الرقم السري غلط' };
  }
  P.deleteProperty('ADMIN_PIN_BAD');
  if (d.provider && AI_DEFAULTS[d.provider]) P.setProperty('AI_PROVIDER', d.provider);
  if (d.key && AI_KEYS[d.provider]) P.setProperty(AI_KEYS[d.provider], String(d.key).trim());
  if (d.budget !== undefined && d.budget !== '') P.setProperty('AI_BUDGET', String(parseFloat(d.budget) || 0));
  if (d.bot !== undefined) { if (String(d.bot).trim()) P.setProperty('AI_BOT_MODEL', String(d.bot).trim()); else P.deleteProperty('AI_BOT_MODEL'); }
  if (d.dose !== undefined) { if (String(d.dose).trim()) P.setProperty('AI_DOSE_MODEL', String(d.dose).trim()); else P.deleteProperty('AI_DOSE_MODEL'); }
  return getAiConfig();
}

function callGeminiRaw_(prompt, isRetry) {
  try {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent';
    const payload = { contents: [{ parts: [{ text: prompt }] }] };
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': GEMINI_API_KEY },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    const body = res.getContentText();
    if (code !== 200) {
      Logger.log('Gemini HTTP ' + code + ': ' + body.substring(0, 300));
      // منعملش إعادة محاولة بطيئة — أحسن نرد بسرعة من الكود
      return null;
    }
    const data = JSON.parse(body);
    if (!data.candidates || !data.candidates.length) return null;
    const parts = data.candidates[0].content && data.candidates[0].content.parts;
    if (!parts || !parts.length) return null;
    return parts[0].text;
  } catch (e) {
    Logger.log('خطأ callGemini: ' + e.message);
    return null;
  }
}

// الحارس: أي رقم في رد المودل مش في القايمة المسموحة = الرد مرفوض
/* ٠١٢٣ → 0123 عشان الحارس والموديل يفهموا الأرقام العربي */
function toAsciiDigits_(s) {
  return String(s || '').replace(/[\u0660-\u0669]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })
                        .replace(/[\u06F0-\u06F9]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); });
}
function replyHasInventedNumbers_(text, allowedNumbers) {
  const nums = toAsciiDigits_(text).match(/\d+(?:[.,]\d+)?/g);
  if (!nums) return false;
  for (var i = 0; i < nums.length; i++) {
    const n = Math.round(parseFloat(String(nums[i]).replace(',', '')));
    if (isNaN(n)) continue;
    if (n <= 12) continue;                          // أرقام صغيرة (عدد أنواع، ساعات) مقبولة
    if (allowedNumbers.indexOf(n) === -1) return true;
  }
  return false;
}
/* حارس العقل الجديد: بيراجع الأسعار بس (الرقم اللي جنبه "جنيه") وأرقام التليفونات.
   أرقام الجرعات والمواعيد ("كل 8 ساعات"، "3 مرات") مسموحة — دي كانت سبب رفض ردود الجرعات. */
function brainPriceGuard_(reply, allowed, phones) {
  var t = toAsciiDigits_(reply), m;
  var rx = /(\d+(?:[.,]\d+)?)\s*(?:جنيه|جنية|جنيهات|ج\.م|ج(?![؀-ۿ]))/g;
  while ((m = rx.exec(t))) {
    var n = Math.round(parseFloat(String(m[1]).replace(',', '.')));
    if (!isNaN(n) && allowed.indexOf(n) === -1) return 'سعر ' + n;
  }
  var rx2 = /(?:بسعر|السعر|سعره|سعرها|بـ)\s*:?\s*(\d+(?:[.,]\d+)?)/g;
  while ((m = rx2.exec(t))) {
    var n2 = Math.round(parseFloat(String(m[1]).replace(',', '.')));
    if (!isNaN(n2) && allowed.indexOf(n2) === -1) return 'سعر ' + n2;
  }
  var longs = t.match(/\d{7,}/g) || [], ok = (phones || []).map(function (p) { return String(p).replace(/\D/g, '').replace(/^(20|0)+/, ''); });
  for (var i = 0; i < longs.length; i++) {
    var L = longs[i].replace(/^(20|0)+/, '');
    if (!ok.some(function (p) { return p && (p === L || p.indexOf(L) !== -1 || L.indexOf(p) !== -1); })) return 'رقم ' + longs[i];
  }
  return '';
}

/* ممنوع البوت ينادي العميل باسم مش متسجل ("تمام يا آية") أو "يا فندم/يا غالي" —
   أي "يا + كلمة" بتتشال إلا لو الكلمة من الاسم المسجل أو اسم العميل قاله بنفسه. */
function allowedNames_(chatId, history) {
  var ok = {};
  String(honorName_(getKnownCustomerName_(chatId)) || '').split(/\s+/).forEach(function (w) { if (w) ok[normalizeArabic(w)] = 1; });
  (history || []).forEach(function (h) {
    if (h.role !== 'user') return;
    var m = normalizeArabic(h.text).match(/(?:اسمي|انا اسمي|معاك)\s+([^\s]+)/);
    if (m && ['ايه', 'اي', 'اية', 'مين', 'ايش'].indexOf(m[1]) === -1) ok[m[1]] = 1;
  });
  ['رب', 'ريت', 'سلام', 'جماعه'].forEach(function (w) { ok[w] = 1; });
  return ok;
}
function stripVocatives_(text, ok) {
  return String(text || '').replace(/\s*[،,]?\s*يا\s+([^\s،,.!؟?🌸🙏✅]+)/g, function (all, w) {
    return ok[normalizeArabic(w)] ? all : '';
  }).replace(/^\s*[،,]\s*/, '').replace(/\s+([،,.!؟?])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim();
}

/* ذاكرة أسئلة الأمان (السن/حمل/أمراض/أدوية تانية) — 24 ساعة، عشان البوت ميسألش نفس الأسئلة تاني */
function safetyGet_(chatId) {
  try { return JSON.parse(CacheService.getScriptCache().get('safe_' + chatId) || 'null'); } catch (e) { return null; }
}
function safetyCapture_(chatId, text, history) {
  var lastBot = '';
  for (var i = (history || []).length - 1; i >= 0; i--) if (history[i].role === 'bot') { lastBot = history[i].text; break; }
  if (!/حمل|رضاع|امراض مزمن|أمراض مزمن|ادويه تاني|أدوية تاني|أدوية تانية|السن|سن حضرتك|كام سنة/.test(lastBot)) return;
  var n = normalizeArabic(text), s = safetyGet_(chatId) || {};
  var age = toAsciiDigits_(text).match(/\b(\d{1,3})\b/);
  if (age && +age[1] > 0 && +age[1] < 110 && (n.split(' ').length <= 4 || /سن|سنه|سنين|عمري/.test(n))) s.age = +age[1];
  var neg = /(^|\s)(لا|لاء|لأ|لا ابدا|مفيش|ولا حاجه|كله تمام|كله سليم|كلو تمام|سليم|تمام|الحمد لله|no)(\s|$)/.test(n);
  var sick = /(ضغط|سكر|قلب|كلي|كبد|قرحه|معده|ربو|حساسيه من)/.test(n) && !/(مفيش|لا |ولا)/.test(n);
  if (sick) { s.note = text; s.clear = false; }
  else if (neg) s.clear = true;
  s.t = Date.now();
  CacheService.getScriptCache().put('safe_' + chatId, JSON.stringify(s), 86400);
}

/* آخر أصناف اتعرضت على العميل بأسعارها — عشان ملخص الأوردر يحسب الإجمالي صح */
function quotedAdd_(chatId, items) {
  var c = CacheService.getScriptCache(), q = [];
  try { q = JSON.parse(c.get('quoted_' + chatId) || '[]'); } catch (e) {}
  (items || []).forEach(function (it) {
    q = q.filter(function (x) { return x.name !== it.name; });
    q.push({ name: it.name, price: Math.round(it.price) });
  });
  c.put('quoted_' + chatId, JSON.stringify(q.slice(-40)), 21600);
}
function quotedFind_(chatId, name) {
  var q = []; try { q = JSON.parse(CacheService.getScriptCache().get('quoted_' + chatId) || '[]'); } catch (e) {}
  var n = normalizeArabic(name).toLowerCase();
  for (var i = q.length - 1; i >= 0; i--) if (normalizeArabic(q[i].name).toLowerCase() === n) return q[i];
  for (var j = q.length - 1; j >= 0; j--) {
    var qn = normalizeArabic(q[j].name).toLowerCase();
    if (qn.indexOf(n) !== -1 || n.indexOf(qn) !== -1) return q[j];
  }
  return null;
}

/* إعدادات البوت من اللوحة: رسوم التوصيل، المواعيد، أقصى مسافة، قفل اللوحة */
function botSettings_() {
  var P = PropertiesService.getScriptProperties();
  var km = P.getProperty('BOT_MAX_KM');
  return { fee: P.getProperty('BOT_DELIVERY_FEE') || '', hours: P.getProperty('BOT_HOURS') || '',
           maxKm: km === null ? 10 : (parseFloat(km) || 0), lock: P.getProperty('DASH_LOCK') === '1' };
}
function getBotSettings() { var s = botSettings_(); s.ok = true; s.pinSet = !!aiKey_('ADMIN_PIN'); return s; }
function setBotSettings(d) {
  if (!aiKey_('ADMIN_PIN')) return { ok: false, error: 'اختار رقم سري الأول من إعدادات الذكاء الاصطناعي' };
  if (!adminPinOk_(d.pin)) return { ok: false, pinError: true, error: 'الرقم السري غلط' };
  var P = PropertiesService.getScriptProperties();
  if (d.fee !== undefined) { var f = String(d.fee).trim(); if (f) P.setProperty('BOT_DELIVERY_FEE', String(parseFloat(f) || 0)); else P.deleteProperty('BOT_DELIVERY_FEE'); }
  if (d.hours !== undefined) { var h = String(d.hours).trim(); if (h) P.setProperty('BOT_HOURS', h.slice(0, 120)); else P.deleteProperty('BOT_HOURS'); }
  if (d.maxKm !== undefined && String(d.maxKm).trim() !== '') P.setProperty('BOT_MAX_KM', String(parseFloat(d.maxKm) || 0));
  if (d.lock !== undefined) P.setProperty('DASH_LOCK', String(d.lock) === '1' ? '1' : '0');
  return getBotSettings();
}

/* مكان الصيدلية = متوسط (وسيط) مواقع عملاء الدليفري — من غير ما نحتاج نكتب إحداثيات */
function pharmacyCenter_() {
  var c = CacheService.getScriptCache(), hit = c.get('phcenter');
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var P = PropertiesService.getScriptProperties();
  var pl = parseFloat(P.getProperty('PHARMACY_LAT')), pg = parseFloat(P.getProperty('PHARMACY_LNG'));
  var out = null;
  if (!isNaN(pl) && !isNaN(pg)) out = { lat: pl, lng: pg };
  else {
    try {
      var sh = SpreadsheetApp.openById(DELIVERY_SHEET_ID).getSheetByName('العملاء');
      var v = sh.getDataRange().getValues(), h = v[0].map(function (x) { return String(x).trim(); });
      var iLa = h.indexOf('خط العرض'), iLo = h.indexOf('خط الطول'), las = [], los = [];
      for (var i = 1; i < v.length; i++) {
        var a = parseFloat(v[i][iLa]), b = parseFloat(v[i][iLo]);
        if (!isNaN(a) && !isNaN(b) && a > 20 && a < 33 && b > 24 && b < 37) { las.push(a); los.push(b); }
      }
      if (las.length >= 5) {
        las.sort(); los.sort();
        out = { lat: las[Math.floor(las.length / 2)], lng: los[Math.floor(los.length / 2)] };
      }
    } catch (e) {}
  }
  if (out) c.put('phcenter', JSON.stringify(out), 21600);
  return out;
}
function distKm_(a1, o1, a2, o2) {
  var R = 6371, r = Math.PI / 180, da = (a2 - a1) * r, dobj = (o2 - o1) * r;
  var x = Math.sin(da / 2) * Math.sin(da / 2) + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(dobj / 2) * Math.sin(dobj / 2);
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/* 🎤 الرسايل الصوتية → كلام مكتوب (Gemini المجاني) */
function transcribeVoice_(fileId, mime) {
  try {
    var blob = tgFileBlob_(fileId);
    if (!blob) return '';
    var b64 = Utilities.base64Encode(blob.getBytes());
    var key = aiKey_('GEMINI_API_KEY') || GEMINI_API_KEY;
    var prompt = 'اكتب الكلام اللي في التسجيل الصوتي ده بالظبط زي ما اتقال (عامية مصرية)، من غير أي إضافة أو شرح. ' +
                 'أسماء الأدوية اكتبها زي ما اتنطقت. لو مفيش كلام مفهوم رجّع كلمة NONE بس.';
    var models = [AI_DEFAULTS.gemini.bot, GEMINI_MODEL];
    for (var i = 0; i < models.length; i++) {
      var res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + models[i] + ':generateContent', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': key },
        payload: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: mime || 'audio/ogg', data: b64 } }, { text: prompt }] }],
                                  generationConfig: { temperature: 0 } }) });
      if (res.getResponseCode() !== 200) { Logger.log('voice ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200)); continue; }
      var d = JSON.parse(res.getContentText());
      if (d.usageMetadata) aiTrack_('voice', models[i], d.usageMetadata.promptTokenCount || 0, d.usageMetadata.candidatesTokenCount || 0);
      var p = d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts;
      var t = String((p && p[0] && p[0].text) || '').trim();
      if (t && !/^NONE\.?$/i.test(t)) return t.slice(0, 600);
      return '';
    }
  } catch (e) { Logger.log('خطأ transcribeVoice_: ' + e.message); }
  return '';
}

/* 📷 قراية صورة العميل (علبة دوا أو روشتة) بـ Gemini المجاني */
var PHOTO_CTX = null;   /* بيتملى أثناء الرد على صورة — العقل بيدوّر بالأسماء اللي فيها */
function readPhoto_(fileIds) {
  try {
    fileIds = [].concat(fileIds).slice(0, 6);
    var imgs = [];
    fileIds.forEach(function (fid) {
      var blob = tgFileBlob_(fid);
      if (!blob) return;
      imgs.push({ inline_data: { mime_type: 'image/jpeg', data: Utilities.base64Encode(blob.getBytes()) } });
    });
    if (!imgs.length) return null;
    var key = aiKey_('GEMINI_API_KEY') || GEMINI_API_KEY;
    var prompt = 'You are a pharmacist assistant in Egypt. Look at this photo from a customer.\n' +
      'kind: "prescription" if it is a doctor prescription (printed or handwritten); "box" if it shows medicine/cosmetic package(s); otherwise "other".\n' +
      'items: EVERY product you can read. For a prescription go line by line: EXACTLY ONE item per prescribed line (drops, capsules, creams, washes…). ' +
      'If a line has a brand name plus a description/ingredient (e.g. "Sansovit — vitamin D drops"), that is ONE product: name = the brand only, and the description goes in "use". ' +
      'Never split one line into two items, and ignore dosing instructions lines. ' +
      'Each as {"name":"trade name in English as printed","strength":"","form":"tablet/syrup/cream/...","use":"purpose in a few English words (e.g. oily skin facial wash, post-laser moisturizer, vitamin D drops)","sure":true}. ' +
      'For handwriting: "sure":true ONLY if every letter of the name is clearly legible; otherwise "sure":false (better unsure than a wrong confident name).\n' +
      'rx: true if the package says prescription only or it is a chronic/prescription drug (antidiabetic, antihypertensive, antibiotic...).\n' +
      'label: usage/storage notes PRINTED on the box only, TRANSLATED to simple Egyptian Arabic (never English), e.g. "Do not crush, cut or chew" → "يتبلع صحيح من غير كسر أو مضغ". Never invent a dose. Empty if none.\n' +
      'handwritten: true if it is a prescription written by hand (even partly), false if fully printed/typed.\n' +
      'Reply JSON only: {"kind":"box","handwritten":false,"items":[{"name":"","strength":"","form":"","use":"","sure":true}],"rx":false,"label":""}';
    function req(model, img) {
      return { url: 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
        method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': key },
        payload: JSON.stringify({ contents: [{ parts: [img, { text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } }) };
    }
    function parse(res, model) {
      if (res.getResponseCode() !== 200) { Logger.log('photo ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200)); return null; }
      var d = JSON.parse(res.getContentText());
      if (d.usageMetadata) aiTrack_('photo', model, d.usageMetadata.promptTokenCount || 0, d.usageMetadata.candidatesTokenCount || 0);
      var p = d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts;
      return doseJson_((p || []).filter(function (x) { return x.text && !x.thought; }).map(function (x) { return x.text; }).join(''));
    }
    /* ⚡ كل صورة لوحدها بس كلهم في نفس الوقت (أدق من صورة واحدة فيها الكل، ومن غير وقت زيادة) */
    /* 👁️ الصور على Gemini 3.8 Flash (أدق في خط الإيد — مجاني 20 طلب/يوم)؛ لو خلص أو مش متاح → 3.5 Flash → Flash-Lite */
    var M1 = aiKey_('PHOTO_MODEL') || 'gemini-3.8-flash', backups = [AI_DEFAULTS.gemini.bot, GEMINI_MODEL].filter(function (m, i, a) { return m && m !== M1 && a.indexOf(m) === i; });
    var outs = UrlFetchApp.fetchAll(imgs.map(function (im) { return req(M1, im); })).map(function (r) { return parse(r, M1); });
    outs = outs.map(function (o, i) {
      for (var b = 0; !o && b < backups.length; b++) o = parse(UrlFetchApp.fetchAll([req(backups[b], imgs[i])])[0], backups[b]);
      return o;
    });
    var good = outs.filter(Boolean);
    if (!good.length) return null;
    var seenN = {}, items = [];
    good.forEach(function (o) { (o.items || []).forEach(function (it) {
      var k = String(it.name || '').toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, '');
      it.fromBox = o.kind === 'box';   /* اسم مطبوع على علبة (مش خط إيد) */
      it.hand = o.kind === 'prescription';   /* من الروشتة (غالبًا خط إيد) */
      if (k && !seenN[k]) { seenN[k] = 1; items.push(it); }
    }); });
    var kinds = good.map(function (o) { return o.kind; });
    return { kind: kinds.indexOf('prescription') !== -1 ? 'prescription' : (kinds.indexOf('box') !== -1 ? 'box' : 'other'),
             handwritten: good.some(function (o) { return o.kind === 'prescription' && o.handwritten !== false; }),
             items: items, rx: good.some(function (o) { return o.rx; }),
             label: (good.filter(function (o) { return o.label; })[0] || {}).label || '' };
  } catch (e) { Logger.log('خطأ readPhoto_: ' + e.message); }
  return null;
}

/* 🤫 الصيدلي ماسك المحادثة — البوت يسكت وكل رسايل العميل توصلك (ساعتين أو لحد ما ترجّعه) */
function holdOn_(cid) { return !!CacheService.getScriptCache().get('hold_' + cid); }
function holdSet_(cid, on) {
  var c = CacheService.getScriptCache();
  if (on) c.put('hold_' + cid, '1', 7200); else c.remove('hold_' + cid);
}
/* رد من تطبيق الواتساب: نفس الإمساك ٣٠ دقيقة. '1' = إمساك يدوي ساعتين — منقصرهوش. بيرجّع true لو الإمساك ابتدا دلوقتي. */
function holdEcho_(cid) {
  var c = CacheService.getScriptCache(), cur = c.get('hold_' + cid);
  if (cur === '1') return false;
  c.put('hold_' + cid, 'e', 1800);
  return !cur;
}
function holdKb_(cid, on) {
  return { inline_keyboard: [[ on ? { text: '▶️ رجّع البوت يرد', callback_data: 'h_off_' + cid }
                                  : { text: '🤫 أنا هرد (البوت يسكت)', callback_data: 'h_on_' + cid } ]] };
}

/* 🧾 ملخص الأوردر قبل التسجيل — العميل يأكد بزرار */
function sendOrderSummary_(chatId, order) {
  var s = botSettings_(), lines = [], total = 0, unpriced = false;
  (order.lines || []).forEach(function (l) {
    var q = Math.max(1, parseInt(l.q, 10) || 1), it = quotedFind_(chatId, l.name || '');
    if (it) { lines.push('• ' + it.name + ' × ' + q + ' = ' + (it.price * q) + ' جنيه'); total += it.price * q; }
    else if (l.name) { lines.push('• ' + l.name + ' × ' + q + ' (السعر يتأكد)'); unpriced = true; }
  });
  if (!lines.length) { lines.push('• ' + String(order.items || '—')); unpriced = true; }
  var fee = parseFloat(s.fee) || 0;
  var txt = '🧾 ملخص طلب حضرتك:\n' + lines.join('\n') + '\n' +
    (total ? '\nإجمالي الأصناف: ' + total + ' جنيه' + (unpriced ? ' + الأصناف اللي سعرها هيتأكد' : '') : '') +
    (fee ? '\n🛵 التوصيل: ' + fee + ' جنيه' : '\n🛵 رسوم التوصيل: هتتأكد مع حضرتك') +
    (total && fee ? '\nالإجمالي: ' + (total + fee) + ' جنيه' : '') +
    '\n📍 العنوان: ' + String(order.address || '').replace(/\s*—\s*https?:\S+/, '') +
    '\n📱 الموبايل: ' + (order.phone || '—') + '\n\nنأكد الطلب؟';
  CacheService.getScriptCache().put('pord_' + chatId, JSON.stringify({
    items: lines.join('\n') + (total ? '\nإجمالي الأصناف: ' + total + ' جنيه' : '') + (fee ? '\nالتوصيل: ' + fee + ' جنيه' : ''),
    phone: order.phone, address: order.address }), 7200);
  tgApi_('sendMessage', { chat_id: chatId, text: txt,
    reply_markup: { inline_keyboard: [[{ text: '✅ تأكيد الطلب', callback_data: 'o_ok' }, { text: '✏️ تعديل', callback_data: 'o_edit' }]] } });
  return txt;
}

// ===================================================================
// 6) الذاكرة والتعرّف على العميل
// ===================================================================

function getConversationHistory(chatId) {
  try {
    const raw = CacheService.getScriptCache().get('convo_' + chatId);
    if (raw) return JSON.parse(raw);
    const raw2 = PropertiesService.getScriptProperties().getProperty('convo_' + chatId);
    return raw2 ? JSON.parse(raw2) : [];
  } catch (e) { return []; }
}

/* ═══ 💬 سجل محادثات البوت — شيت دائم بتقراه صفحة المحادثات في اللوحة ═══ */
var CHAT_LOG_SHEET = 'محادثات البوت';
function chatLogSheet_() {
  var ss = SpreadsheetApp.openById(STAFF_SHEET_ID), sh = ss.getSheetByName(CHAT_LOG_SHEET);
  if (!sh) { sh = ss.insertSheet(CHAT_LOG_SHEET); sh.appendRow(['الوقت', 'chat', 'الاسم', 'الموبايل', 'من', 'الرسالة']); sh.setFrozenRows(1); }
  return sh;
}
function chatWho_(chatId) {
  var c = CacheService.getScriptCache(), k = 'who_' + chatId, v = c.get(k);
  if (v) { try { return JSON.parse(v); } catch (e) {} }
  var w = { n: '', p: '' };
  try { w.n = getKnownCustomerName_(chatId) || ''; } catch (e) {}
  try { w.p = getVerifiedPhone_(chatId) || getCustomerPhone_(chatId) || ''; } catch (e) {}
  c.put(k, JSON.stringify(w), 3600);
  return w;
}
/* role: user = العميل · bot = البوت · pharm = الصيدلي · sys = ملاحظة (تحويل/مسك) */
function logChatRows_(chatId, rows) {
  try {
    if (!rows.length || String(chatId) === String(PERSONAL_CHAT)) return;
    var w = chatWho_(chatId), now = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss');
    var sh = chatLogSheet_(), vals = rows.filter(function (r) { return r[1]; }).map(function (r) {
      return [now, String(chatId), w.n, w.p ? "'" + w.p : '', r[0], String(r[1]).slice(0, 4000)];
    });
    if (vals.length) sh.getRange(sh.getLastRow() + 1, 1, vals.length, 6).setValues(vals);
  } catch (e) { Logger.log('خطأ سجل المحادثات: ' + e.message); }
}

function saveConversationTurn(chatId, userText, botText, botRole) {
  var skipUser = /^\[(سؤال محوّل للدكتور|مستني تأكيد الطلب)\]/.test(String(userText || ''));
  var skipBot = /^\[الصيدلي بيرد بنفسه\]/.test(String(botText || ''));
  logChatRows_(chatId, (skipUser ? [] : [['user', userText]]).concat(skipBot ? [] : [[botRole || 'bot', botText]]));
  try {
    const history = getConversationHistory(chatId);
    history.push({ role: 'user', text: userText });
    history.push({ role: 'bot', text: botText });
    const trimmed = history.slice(-10);
    const json = JSON.stringify(trimmed);
    CacheService.getScriptCache().put('convo_' + chatId, json, 21600);
    PropertiesService.getScriptProperties().setProperty('convo_' + chatId, json);
  } catch (e) { Logger.log('خطأ saveConversationTurn: ' + e.message); }
}

function formatHistory(history) {
  if (!history.length) return '';
  return 'المحادثة اللي فاتت مع نفس العميل:\n' +
    history.map(function(h) { return (h.role === 'user' ? 'العميل: ' : 'الصيدلية: ') + h.text; }).join('\n') +
    '\n\n';
}

// ربط رقم التليفون بالشات لما العميل يبعته
function saveCustomerPhone_(chatId, phone) {
  PropertiesService.getScriptProperties().setProperty('phone_' + chatId, phone);
}
function getCustomerPhone_(chatId) {
  return getVerifiedPhone_(chatId) || PropertiesService.getScriptProperties().getProperty('phone_' + chatId) || '';
}
/* الرقم المؤكد: جه من زرار "شارك رقمي" في تيليجرام — ده بس اللي بنعرف بيه العميل */
function getVerifiedPhone_(chatId) {
  return PropertiesService.getScriptProperties().getProperty('vphone_' + chatId) || '';
}
function sendTelegramMarkup_(chatId, text, markup) {
  try {
    text = varyEmoji_(chatId, text);
    if (isWa_(chatId)) { waSend_(String(chatId), text, markup); return; }
    UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ chat_id: chatId, text: text, reply_markup: markup }) });
  } catch (e) {}
}
/* مرة كل 24 ساعة لو العميل لسه ما شاركش رقمه */
function maybeAskPhone_(chatId) {
  if (getVerifiedPhone_(chatId)) return;
  var c = CacheService.getScriptCache();
  if (c.get('askph_' + chatId)) return;
  c.put('askph_' + chatId, '1', 21600);
  var P = PropertiesService.getScriptProperties(), k = 'askph_day_' + chatId;
  var today = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');
  if (P.getProperty(k) === today) return;
  P.setProperty(k, today);
  sendTelegramMarkup_(chatId, '📱 سجّل رقم حضرتك بضغطة واحدة عشان نتعرّف على حضرتك ونخدمك أسرع.', KB_SHARE);
}
/* تنويع الإيموجي عشان الملل: أي إيموجي "ودود" في رسالة للعميل بيتبدّل بواحد تاني من القايمة،
   ومش بيتكرر نفس اللي اتبعت في الرسالة اللي قبلها لنفس العميل. ✅ 📍 🛵 🧾 📱 ثابتين لأن ليهم معنى. */
var EMO_POOL_ = ['🌸', '🌿', '✨', '💙', '🤍', '😊', '🌷', '☀️', '💐', '🙏'];
function varyEmoji_(chatId, text) {
  if (!text || String(chatId) === String(PERSONAL_CHAT)) return text;
  var c = CacheService.getScriptCache(), k = 'emo_' + chatId, recent = (c.get(k) || '').split('|').filter(Boolean);
  var rx = new RegExp(EMO_POOL_.map(function (e) { return e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|'), 'g');
  var out = String(text).replace(rx, function () {
    var pick = EMO_POOL_.filter(function (e) { return recent.indexOf(e) === -1; });
    if (!pick.length) pick = EMO_POOL_.slice();
    var e = pick[Math.floor(Math.random() * pick.length)];
    recent.push(e); if (recent.length > 4) recent.shift();
    return e;
  });
  c.put(k, recent.join('|'), 21600);
  return out;
}
function tgApi_(method, payload) {
  try {
    if (method === 'sendMessage' && payload && payload.text) payload.text = varyEmoji_(payload.chat_id, payload.text);
    /* 🟢 واتساب */
    if (payload && method === 'forwardMessage' && isWa_(payload.from_chat_id)) return waForwardToStaff_(String(payload.from_chat_id), payload.message_id);
    if (payload && method === 'answerCallbackQuery' && payload.callback_query_id === 'wa') return { ok: true };
    if (payload && isWa_(payload.chat_id)) {
      if (method === 'sendMessage') return waSend_(String(payload.chat_id), payload.text, payload.reply_markup);
      if (method === 'sendChatAction') { waTyping_(String(payload.chat_id)); return { ok: true }; }
      return { ok: true };
    }
    var r = UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/' + method, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify(payload) });
    return JSON.parse(r.getContentText());
  } catch (e) { return null; }
}
var KB_SHARE = { keyboard: [[{ text: '📱 سجّل رقمي', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true };
var KB_MENU = { inline_keyboard: [
  [{ text: '🔍 أسأل عن دوا وسعره', callback_data: 'm_ask' }, { text: '🛵 أطلب توصيل', callback_data: 'm_del' }],
  [{ text: '👨‍⚕️ أكلم الصيدلي', callback_data: 'm_doc' }, { text: '📱 سجّل رقمي', callback_data: 'm_reg' }]] };

/* "دكتور احمد" → دكتور احمد · "اسلام شكري الفقي" → اسلام  (من غير أستاذ/ة اللي شكلها مش احترافي) */
function honorName_(nm) {
  var w = String(nm || '').replace(/[|.…]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '';
  var titles = ['دكتور','دكتوره','دكتورة','د','الدكتور','الحاج','الحاجه','الحاجة','حاج','حاجه','مهندس','مهندسه','م','استاذ','أستاذ','استاذه','أستاذة','ام','أم','ابو','أبو','المعلم'];
  return titles.indexOf(w[0]) !== -1 && w[1] ? w[0] + ' ' + w[1] : w[0];
}

/* رسالة الترحيب — ثابتة ومنظمة، مش من الموديل */
function sendWelcome_(chatId, prefix) {
  var first = honorName_(getKnownCustomerName_(chatId));
  var t = (prefix ? prefix + '\n\n' : '') + (first
    ? 'أهلًا بحضرتك يا ' + first + '، نوّرت ' + PHARMACY_NAME + ' 🌸\nنقدر نساعد حضرتك في إيه النهارده؟'
    : 'أهلًا بحضرتك في ' + PHARMACY_NAME + ' 🌸\nنقدر نساعد حضرتك في:');
  var kb = JSON.parse(JSON.stringify(KB_MENU));
  if (getVerifiedPhone_(chatId)) kb.inline_keyboard[1].pop();   /* مسجل خلاص — نشيل زرار التسجيل */
  tgApi_('sendMessage', { chat_id: chatId, text: t, reply_markup: kb });
}

/* عملاء سيستم الدليفري (شيت "الدليفري" ← العملاء) — قراية بس، مش بنعدّل فيه */
var DELIVERY_SHEET_ID = '1165euofZ-LqZPOLTrQfxwc9sw29oplJ5kYdmTSsG1sg';
function deliveryCustomer_(phone) {
  var canon = canonicalEgyptPhone_(phone); if (!canon) return null;
  var ck = 'dcust_' + canon, c = CacheService.getScriptCache(), hit = c.get(ck);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var out = null;
  try {
    var sh = SpreadsheetApp.openById(DELIVERY_SHEET_ID).getSheetByName('العملاء');
    if (sh && sh.getLastRow() > 1) {
      var v = sh.getDataRange().getValues(), h = v[0].map(function (x) { return String(x).trim(); });
      var iN = h.indexOf('الاسم'), iP = h.indexOf('التليفون'), iLa = h.indexOf('خط العرض'), iLo = h.indexOf('خط الطول');
      for (var i = v.length - 1; i >= 1; i--) {
        if (canonicalEgyptPhone_(v[i][iP]) !== canon) continue;
        var la = parseFloat(v[i][iLa]), lo = parseFloat(v[i][iLo]);
        if (isNaN(la) || isNaN(lo)) continue;
        out = { name: String(v[i][iN] || ''), lat: la, lng: lo };
        break;
      }
    }
  } catch (e) {}
  if (out) out.place = placeName_(out.lat, out.lng);
  c.put(ck, JSON.stringify(out), 21600);
  return out;
}
/* إحداثيات → "شارع ...، المنطقة" (خدمة جوجل جوه Apps Script) */
function placeName_(lat, lng) {
  try {
    var r = Maps.newGeocoder().setLanguage('ar').reverseGeocode(lat, lng);
    if (r && r.results && r.results.length) {
      var a = r.results[0].formatted_address || '';
      return a.replace(/،?\s*(مصر|Egypt)\s*$/, '').replace(/\d{4,}/g, '').replace(/^\S+\+\S+\s*،?\s*/, '').trim();
    }
  } catch (e) {}
  return '';
}
function mapsLink_(lat, lng) { return 'https://maps.google.com/?q=' + lat + ',' + lng; }

/* حالة التوصيل للعميل (العنوان اللي أكده) */
function delFlow_(chatId, v) {
  var c = CacheService.getScriptCache();
  if (v === undefined) { try { return JSON.parse(c.get('dflow_' + chatId) || 'null'); } catch (e) { return null; } }
  if (v === null) c.remove('dflow_' + chatId); else c.put('dflow_' + chatId, JSON.stringify(v), 7200);
}

/* زرار "أطلب توصيل" */
function startDelivery_(chatId) {
  if (!getVerifiedPhone_(chatId)) {
    tgApi_('sendMessage', { chat_id: chatId, reply_markup: KB_SHARE,
      text: 'تمام 🛵 عشان نسجّل الطلب باسم حضرتك ونوصّله صح، دوس على زرار "📱 سجّل رقمي" تحت، وبعدها نكمّل على طول.' });
    delFlow_(chatId, { step: 'needPhone' });
    return;
  }
  var dc = deliveryCustomer_(getVerifiedPhone_(chatId));
  if (dc) {
    tgApi_('sendLocation', { chat_id: chatId, latitude: dc.lat, longitude: dc.lng });
    tgApi_('sendMessage', { chat_id: chatId,
      text: 'نوصّلها لحضرتك على عنوانك المسجل عندنا' + (dc.place ? ':\n📍 ' + dc.place : ' (الموقع اللي فوق)') + '؟',
      reply_markup: { inline_keyboard: [[{ text: '✅ أيوه، نفس العنوان', callback_data: 'd_yes' }, { text: '📍 عنوان تاني', callback_data: 'd_new' }]] } });
    delFlow_(chatId, { step: 'confirm', lat: dc.lat, lng: dc.lng, place: dc.place || '' });
  } else {
    askNewAddress_(chatId);
  }
}
function askNewAddress_(chatId) {
  tgApi_('sendMessage', { chat_id: chatId,
    text: 'ممكن حضرتك تبعت موقعك بزرار "📍 ابعت موقعي" تحت، أو تكتب العنوان بالتفصيل (المنطقة، الشارع، علامة مميزة).',
    reply_markup: { keyboard: [[{ text: '📍 ابعت موقعي', request_location: true }]], resize_keyboard: true, one_time_keyboard: true } });
  delFlow_(chatId, { step: 'address' });
}
function addressConfirmed_(chatId, addr) {
  delFlow_(chatId, { step: 'items', address: addr });
  var shown = String(addr || '').replace(/\s*—?\s*https?:\S+/, '').trim();
  tgApi_('sendMessage', { chat_id: chatId, reply_markup: { remove_keyboard: true },
    text: 'تمام، اتسجل العنوان ✅' + (shown ? '\n📍 ' + shown : '') +
          '\nاكتب لحضرتك الأصناف المطلوبة (أو ابعت صورة الروشتة) وأجهزلك الطلب.' });
}

/* الأزرار اللي جوه الرسايل */
function handleCallback_(cq) {
  var chatId = String(cq.message && cq.message.chat && cq.message.chat.id || cq.from.id), d = cq.data || '';
  tgApi_('answerCallbackQuery', { callback_query_id: cq.id });
  /* أزرار الصيدلي: يمسك المحادثة / يرجّع البوت */
  var hm = d.match(/^h_(on|off)_(-?\d+|wa_[\w.]+)$/);
  if (hm) {
    if (chatId !== String(PERSONAL_CHAT)) return;
    var on = hm[1] === 'on';
    holdSet_(hm[2], on);
    try { tgApi_('editMessageReplyMarkup', { chat_id: chatId, message_id: cq.message.message_id, reply_markup: holdKb_(hm[2], on) }); } catch (e) {}
    sendTelegramStaff(on ? '🤫 البوت ساكت مع العميل ده لمدة ساعتين — أي رسالة منه هتوصلك هنا، اعمل Reply وردّ.'
                         : '▶️ البوت رجع يرد على العميل ده.', PERSONAL_CHAT);
    return;
  }
  try { tgApi_('editMessageReplyMarkup', { chat_id: chatId, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } }); } catch (e) {}
  if (d === 'o_ok' || d === 'o_edit') {
    var cch = CacheService.getScriptCache(), po = null;
    try { po = JSON.parse(cch.get('pord_' + chatId) || 'null'); } catch (e) {}
    cch.remove('pord_' + chatId);
    if (d === 'o_edit') {
      var re = 'تمام 🌸 اكتب لحضرتك التعديل (تزوّد أو تشيل صنف أو تغيّر الكمية أو العنوان) وأبعتلك الملخص تاني.';
      tgApi_('sendMessage', { chat_id: chatId, text: re }); saveConversationTurn(chatId, '[ضغط تعديل الطلب]', re); return;
    }
    if (!po) { tgApi_('sendMessage', { chat_id: chatId, text: 'الملخص ده قديم 🙏 اكتب لحضرتك الطلب تاني وأبعتلك ملخص جديد.' }); return; }
    var ok = saveOrder_(chatId, po.items, po.phone, po.address);
    var rr = ok ? '✅ تمام، الطلب اتسجل ووصل للصيدلية. هنتواصل مع حضرتك نأكد ميعاد التوصيل 🛵 شكرًا لحضرتك 🌸'
                : 'حصلت مشكلة وإحنا بنسجل الطلب 🙏 الصيدلي هيتواصل مع حضرتك حالًا.';
    if (!ok) escalateToDoctor_(chatId, po.items, 'فشل تسجيل الأوردر');
    delFlow_(chatId, null);
    tgApi_('sendMessage', { chat_id: chatId, text: rr }); saveConversationTurn(chatId, '[أكد الطلب]', rr);
    return;
  }
  if (d === 'm_ask') tgApi_('sendMessage', { chat_id: chatId, text: 'اكتب لحضرتك اسم الدوا، وأقولك متوفر ولا لأ وسعره 🔍' });
  else if (d === 'm_del') startDelivery_(chatId);
  else if (d === 'm_doc') {
    escalateToDoctor_(chatId, '[العميل طلب يكلم الصيدلي]', 'طلب التواصل مع الصيدلي');
    tgApi_('sendMessage', { chat_id: chatId, text: 'تمام، بلّغت الصيدلي 👨‍⚕️ اكتب لحضرتك سؤالك هنا وهيرد على حضرتك في أقرب وقت.' });
  }
  else if (d === 'm_reg') tgApi_('sendMessage', { chat_id: chatId, reply_markup: KB_SHARE, text: 'دوس على زرار "📱 سجّل رقمي" تحت، والتسجيل بيتم بضغطة واحدة 🌸' });
  else if (d === 'd_yes') {
    var f = delFlow_(chatId) || {};
    addressConfirmed_(chatId, (f.place ? f.place + ' — ' : '') + mapsLink_(f.lat, f.lng));
  }
  else if (d === 'd_new') askNewAddress_(chatId);
}

/* آخر عنوان اتسجل للعميل في طلبات البوت */
function lastAddress_(phone) {
  var canon = canonicalEgyptPhone_(phone); if (!canon) return '';
  try {
    var sh = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(ORDERS_SHEET);
    if (!sh || sh.getLastRow() <= 1) return '';
    var v = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getDisplayValues();
    for (var i = v.length - 1; i >= 0; i--) if (canonicalEgyptPhone_(v[i][4]) === canon && v[i][5]) return v[i][5];
  } catch (e) {}
  return '';
}

// بيدوّر على اسم العميل في الـ CRM لو رقمه معروف
function getKnownCustomerName_(chatId) {
  try {
    const phone = canonicalEgyptPhone_(getVerifiedPhone_(chatId));
    if (!phone) return '';
    const cached = CacheService.getScriptCache().get('cname_' + phone);
    if (cached) return cached;

    const ss = SpreadsheetApp.openById(CRM_SHEET_ID);
    const sheet = ss.getSheetByName('Customers');
    if (!sheet || sheet.getLastRow() <= 1) return '';
    const map = getHeaderMap(sheet);
    if (map['phone'] === undefined || map['name'] === undefined) return '';
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
    for (var i = 0; i < data.length; i++) {
      if (canonicalEgyptPhone_(data[i][map['phone']]) === phone) {   /* الشيت بيشيل الصفر الأولاني — بنوحّد الشكل */
        const nm = String(data[i][map['name']] || '');
        CacheService.getScriptCache().put('cname_' + phone, nm, 3600);
        return nm;
      }
    }
    return '';
  } catch (e) { return ''; }
}

// بيلقط رقم موبايل مصري من أي رسالة
function extractPhone_(text) {
  const m = String(text || '').replace(/[^\d]/g, ' ').match(/01[0125]\d{8}/);
  return m ? m[0] : '';
}

// ===================================================================
// 7) التسجيل في الشيتات
// ===================================================================

function getOrCreateSheet_(name, headers) {
  const ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  }
  return sheet;
}

// كل صنف طلبه عميل ومكانش موجود — أهم مصدر لقرارات الشراء
function logUnavailableRequest_(chatId, query) {
  try {
    const sheet = getOrCreateSheet_(UNAVAILABLE_SHEET,
      ['التاريخ', 'الوقت', 'الصنف المطلوب', 'رقم الشات', 'تليفون العميل']);
    const now = new Date();
    sheet.appendRow([
      Utilities.formatDate(now, 'Africa/Cairo', 'yyyy-MM-dd'),
      Utilities.formatDate(now, 'Africa/Cairo', 'HH:mm'),
      query, chatId, getCustomerPhone_(chatId)
    ]);
  } catch (e) { Logger.log('خطأ logUnavailableRequest_: ' + e.message); }
}

// كل سعر البوت قاله لعميل — عشان لو حصلت مشكلة تعرف قال إيه
function logQuote_(chatId, items) {
  try {
    if (!items || !items.length) return;
    const sheet = getOrCreateSheet_(QUOTES_LOG_SHEET,
      ['التاريخ', 'الوقت', 'رقم الشات', 'الصنف', 'السعر المعروض', 'الرصيد وقتها']);
    const now = new Date();
    const d = Utilities.formatDate(now, 'Africa/Cairo', 'yyyy-MM-dd');
    const t = Utilities.formatDate(now, 'Africa/Cairo', 'HH:mm');
    const rows = items.map(function(it) {
      return [d, t, chatId, it.name, Math.round(it.price), it.stock];
    });
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
  } catch (e) { Logger.log('خطأ logQuote_: ' + e.message); }
}

// تسجيل أوردر حقيقي + إشعار ليك
function saveOrder_(chatId, itemsText, phone, address) {
  try {
    const sheet = getOrCreateSheet_(ORDERS_SHEET,
      ['التاريخ', 'الوقت', 'رقم الشات', 'اسم العميل', 'تليفون', 'العنوان', 'الطلب', 'الحالة']);
    const now = new Date();
    const name = getKnownCustomerName_(chatId) || '';
    sheet.appendRow([
      Utilities.formatDate(now, 'Africa/Cairo', 'yyyy-MM-dd'),
      Utilities.formatDate(now, 'Africa/Cairo', 'HH:mm'),
      chatId, name, phone, address, itemsText, 'جديد'
    ]);
    sendTelegramStaff(
      '🛵 أوردر جديد من الشات\n' + SEP + '\n' +
      (name ? 'العميل: ' + name + '\n' : '') +
      'تليفون: ' + (phone || '—') + '\n' +
      'العنوان: ' + (address || '—') + '\n' +
      'الطلب: ' + itemsText + '\n\n' +
      '(chat: ' + chatId + ')',
      PERSONAL_CHAT
    );
    return true;
  } catch (e) {
    Logger.log('خطأ saveOrder_: ' + e.message);
    return false;
  }
}

// ===================================================================
// 7.5) الفهم المحلي — من غير أي نداء لجيميني
// الفكرة: أغلب رسايل العملاء بسيطة (تحية، اسم صنف، سعر).
// دي بنفهمها ونرد عليها فورًا من الكود، فالرد بيبقى في أقل من ثانية
// وبيفضل شغال حتى لو جيميني واقع تمامًا.
// ===================================================================

var GREETING_WORDS_ = ['سلام','السلام','عليكم','اهلا','أهلا','هلا','مرحبا','صباح','مساء','ازيك','ازيكم','هاي','هلو','عامل ايه'];
var THANKS_WORDS_   = ['شكرا','شكراً','متشكر','تسلم','ربنا يخليك','جزاك','مرسي','ميرسي'];
var BYE_WORDS_      = ['سلام عليكم','مع السلامه','مع السلامة','باي','تصبح'];
var ORDER_WORDS_    = ['توصيل','دليفري','توصلي','توصل','اطلب','أطلب','اوردر','أوردر','ابعتلي','ابعتهولي','وصلي','العنوان','عنواني'];
var POINTS_WORDS_   = ['نقاط','نقاطي','رصيدي','رصيد النقاط'];
var PRICE_WORDS_    = ['سعر','بكام','كام','ثمن','تمن'];
var AVAIL_WORDS_    = ['موجود','متوفر','متوفره','عندك','عندكم','فيه','في'];

function hasAnyWord_(nText, list) {
  for (var i = 0; i < list.length; i++) {
    if (nText.indexOf(normalizeArabic(list[i])) !== -1) return true;
  }
  return false;
}

// بيشيل كلمات السؤال ويسيب اسم الصنف المحتمل
function extractProductLocally_(text) {
  var n = normalizeArabic(text);
  var drop = [].concat(PRICE_WORDS_, AVAIL_WORDS_, GREETING_WORDS_, ORDER_WORDS_, STOP_WORDS_,
    ['عايز','عاوز','محتاج','ممكن','لو','سمحت','من','فضلك','هل','ياريت','يا','ريت','لي','ليا','واحد','واحده','برجاء','ازاي','ايه','دي','ده',
     'ينفع','ازود','ازيد','اضيف','كمان','برضو','برضه','تاني','عندي','معايا','بس','كده','كدا','حاجه','حاجة','نوع','انا','انت']);
  var words = n.split(' ').filter(function(w) {
    if (w.length < 3 && SHORT_PRODUCT_WORDS_.indexOf(w) === -1) return false;
    for (var i = 0; i < drop.length; i++) {
      if (w === normalizeArabic(drop[i])) return false;
    }
    if (isGenericWord_(w)) return false;
    return true;
  });
  return words.join(' ').trim();
}

// بيرجع رد جاهز لو الرسالة بسيطة، أو null لو محتاجة الذكاء الاصطناعي
function tryLocalReply_(chatId, text, history) {
  const n = normalizeArabic(text);
  const nm = getKnownCustomerName_(chatId);
  const isFirst = !history || history.length === 0;

  // (1) تحية
  if (hasAnyWord_(n, GREETING_WORDS_) && n.split(' ').length <= 4) {
    if (isFirst) {
      return 'وعليكم السلام ورحمة الله 🌸 أهلاً بيك في ' + PHARMACY_NAME +
             (nm ? ' يا ' + nm : '') + '\nتؤمرنا بإيه النهاردة؟';
    }
    return 'أهلاً بيك 🌸 تحت أمرك، محتاج إيه؟';
  }

  // (2) شكر
  if (hasAnyWord_(n, THANKS_WORDS_) && n.split(' ').length <= 5) {
    return 'العفو يا فندم 🌸 تحت أمرك في أي وقت.';
  }

  // (3) نقاط
  if (hasAnyWord_(n, POINTS_WORDS_)) {
    const ph = getCustomerPhone_(chatId);
    if (!ph) return 'ابعتلي رقم موبايلك وأقولك رصيد نقاطك على طول 🌸';
    const pts = getCustomerPointsData(ph);
    return (pts && pts.ok)
      ? 'رصيد نقاطك دلوقتي: ' + pts.total_points + ' نقطة 🌸'
      : 'معلش مقدرتش أوصل لرصيد النقاط دلوقتي، هراجعه وأرد عليك.';
  }

  // (4) سؤال عن صنف — أهم حالة، وبتتحل محليًا بالكامل
  const product = extractProductLocally_(text);
  if (product && product.length >= 3) {
    const results = searchStock(product);
    if (results.length) {
      const answer = buildProductAnswer_(results, product);
      logQuote_(chatId, answer.items || []);
      return answer.text;
    }
    // لقينا اسم صنف بس مش موجود — بس بنتأكد إنه فعلاً سؤال عن صنف
    if (hasAnyWord_(n, PRICE_WORDS_) || hasAnyWord_(n, AVAIL_WORDS_)) {
      logUnavailableRequest_(chatId, product);
      return 'للأسف "' + product + '" مش متوفر عندنا دلوقتي 🙏\n' +
             'ممكن نوفّره لحضرتك، ولو مستعجل الدكتور يعرض عليك بديل مناسب. تحب أنهي؟';
    }
  }

  return null; // مش عارفين — نسيبها للذكاء الاصطناعي
}

// ===================================================================
// 8) التصنيف — call واحد بس
// ===================================================================

function classifyCustomerMessage(text, history) {
  const prompt = formatHistory(history) +
    'انت بتصنّف رسايل عملاء صيدلية. صنّف الرسالة الجديدة لواحدة بالظبط:\n' +
    '"PRODUCT" = بيسأل عن توفر أو سعر صنف، أو بيحدد نوع من أنواع اتعرضت عليه،.\n' +
    '"ORDER" = عايز يطلب/يوصّل، أو بيبعت عنوان أو رقم تليفون عشان أوردر.\n' +
    '"MEDICAL" = سؤال عن جرعة، تفاعل دوائي، تشخيص، أو وصف عرض أو حالة (عندي برد، جلدي مقشر، صداع…) بيطلب علاج ليها.\n' +
    '"POINTS" = بيسأل عن نقاطه أو رصيده.\n' +
    '"OTHER" = سلام، شكر، مواعيد، عنوان الصيدلية، أي حاجة تانية.\n\n' +
    'لو PRODUCT: استخرج اسم الصنف بس (من الرسالة الجديدة أو من المحادثة اللي فاتت لو بيكمل كلام).\n' +
    'متضفش "ال" التعريف على اسم الصنف.\n' +
    'رد بـ JSON بس من غير أي نص زيادة:\n' +
    '{"type":"...","product":"..."}\n\n' +
    'الرسالة الجديدة: "' + text + '"';

  const raw = callGemini(prompt);
  if (!raw) return { type: 'FAILED', product: '' };
  try {
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return { type: parsed.type || 'OTHER', product: (parsed.product || '').trim() };
  } catch (e) {
    return { type: 'OTHER', product: '' };
  }
}


// ===================================================================
// 🧠 العقل الجديد: محادثة طبيعية بنداء واحد للموديل
// الكود بيدوّر في المخزون الأول ويدّي الموديل الأصناف المطابقة بأسعارها،
// والموديل بيرد بكلام طبيعي من القايمة دي بس. لو ذكر رقم مش في القايمة
// → الرد بيترمي ونرجع للنظام القديم. يعني الأسعار برضه مستحيل تتخترع.
// ===================================================================
const SMART_BRAIN = true;                     // false = يرجع للنظام القديم
const PHARMACY_PHONE = '01143404023';
const HARD_ESCALATE = ['حامل','مرضعة','مرضع','رضاعة','رضيع'];

function brainCandidates_(text, history, extra) {
  var seen = {}, out = [];
  function addQ(q, mustHave) {
    q = String(q || '').trim(); if (q.length < 3 && SHORT_PRODUCT_WORDS_.indexOf(q) === -1) return;
    searchStock(q).forEach(function (it) {
      /* صنف من صورة: لازم اسم الماركة نفسه يبقى في اسم الصنف — مش مجرد نفس التركيز أو المادة الفعالة */
      if (mustHave && String(it.key || stockKey_(it.name)).indexOf(mustHave) === -1) return;
      var k = it.name + '|' + it.price;
      if (seen[k] || out.length >= 14) return;
      if (it.daysToExpire !== null && it.daysToExpire < MIN_EXPIRY_DAYS_TO_OFFER) return;
      seen[k] = 1; out.push(it);
    });
  }
  if (extra) addQ(extra);
  if (PHOTO_CTX && PHOTO_CTX.items) PHOTO_CTX.items.forEach(function (it) {
    var n = String(it.name || '').trim(); if (!n) return;
    /* فلتر الماركة للعلب بس: اسم مطبوع واضح. خط إيد الروشتة غالبًا اسم علمي (فيتامين د، ال-كارنيتين) وأي ماركة تنفع */
    var brand = it.fromBox ? ((stockKey_(n) || '').split(' ').filter(function (w) { return w.length >= 3; })[0] || '') : '';
    addQ(n + (it.strength ? ' ' + it.strength : ''), brand); addQ(n, brand); if (brand) addQ(brand, brand);
  });
  /* في الصور: أسماء الصورة اتدوّر عليها فوق بفلتر الماركة — منكررش البحث بيها من غير فلتر */
  if (PHOTO_CTX) text = String(text).replace(/\n?\[العميل بعت صورة[\s\S]*$/, '');
  var prod = extractProductLocally_(text);
  addQ(prod);
  prod.split(' ').forEach(function (w) { if (w.length >= 4) addQ(w); });
  /* لو بيكمّل كلام ("التاني"، "الكبير") ندوّر باللي اتقال قبل كده */
  if (out.length < 3 && history && history.length) {
    for (var i = history.length - 1; i >= 0 && i >= history.length - 4; i--) {
      if (history[i].role === 'user') addQ(extractProductLocally_(history[i].text));
    }
  }
  return out;
}

function brainPrompt_(chatId, text, history, items, noSearch) {
  var nm = getKnownCustomerName_(chatId), vph = getVerifiedPhone_(chatId), ph = getCustomerPhone_(chatId);
  var addr = vph ? lastAddress_(vph) : '';
  var dflow = delFlow_(chatId);
  var bs = botSettings_(), sf = safetyGet_(chatId);
  /* بنشيل من ردود البوت القديمة أي "يا + اسم غلط" عشان الموديل ميقلّدهاش */
  var okN = allowedNames_(chatId, history);
  history = (history || []).map(function (h) { return h.role === 'bot' ? { role: 'bot', text: stripVocatives_(h.text, okN) } : h; });
  var safetyLine = '';
  if (sf && (sf.age || sf.clear || sf.note)) {
    safetyLine = 'معلومات الأمان اللي العميل قالها النهارده: ' +
      (sf.age ? 'السن ' + sf.age + ' سنة. ' : '') +
      (sf.clear ? 'مفيش حمل ولا رضاعة ولا أمراض مزمنة ولا أدوية تانية. ' : '') +
      (sf.note ? 'قال: "' + sf.note + '" (فيه مرض مزمن → حوّل للدكتور). ' : '') +
      (sf.age && sf.clear ? '→ متسألش الأسئلة دي تاني (والجرعات والترشيح للدكتور برضه).\n'
                          : '→ اسأل بس عن اللي ناقص.\n');
  }
  var stock = items.length ? items.map(function (it, i) {
    return (i + 1) + ') ' + it.name + ' | السعر: ' + Math.round(it.price) + ' جنيه' +
      (it.units > 1 ? ' | العلبة ' + it.units : '') +
      (it.stock < LOW_STOCK_THRESHOLD ? ' | كمية محدودة' : '') +
      (it.activeKey ? ' | المادة الفعالة: ' + it.activeKey : '');
  }).join('\n') : '(مفيش أصناف مطابقة للكلام ده في المخزون)';
  return 'انت صيدلي شاب ودود في ' + PHARMACY_NAME + ' (محلة كيل، مصر)، بترد على العملاء على الشات بالعامية المصرية.\n\n' +
    'الأسلوب:\n' +
    '- راقي ومحترم وودود، زي موظف خدمة عملاء في صيدلية محترمة. مختصر: من سطر لـ 4 سطور.\n' +
    '- خاطب العميل بـ "حضرتك". ممنوع "يا فندم" والكلام الشعبي زي "يا غالي" و"يا باشا" و"يا معلم" و"يا حبيبي".\n' +
    '- ممنوع "أهلًا بحضرتك" أو أي ترحيب في نص المحادثة — حتى لو العميل سأل عن حاجة جديدة. الترحيب اتعمل خلاص، ادخل في الموضوع على طول.\n' +
    '- ممنوع تخمّن أو تفترض اسم العميل. استخدم بس "اسم العميل (مؤكد)" لو موجود، أو اسم قاله صراحة ("اسمي محمد"). "اسمي ايه" معناها بيسأل عن اسمه، مش إن اسمه آية.\n' +
    '- ممنوع تكتب "يا" + أي اسم مش هو "اسم العميل (مؤكد)". ومتفترضش إن العميل راجل أو ست: استخدم صيغة محايدة مع "حضرتك" (زي "حضرتك بتاخد أدوية تانية؟").\n' +
    '- لو اسمه معروف ناديه باسمه الأول (أو اللقب + الاسم لو مكتوب زي دكتور/الحاج) أحيانًا، مش في كل رسالة. ممنوع تكتب "أستاذ/ة".\n' +
    '- "ألف سلامة" تتقال بس لو العميل قال صراحة إنه (أو حد معاه) تعبان، ومرة واحدة بس في المحادثة — لو اتقالت قبل كده في ردودك متقولهاش تاني.\n' +
    '- التنسيق: لو بتذكر أكتر من صنف، اكتب جملة قصيرة، وبعدين كل صنف في سطر لوحده بالشكل ده:\n' +
    '  ✅ الاسم — السعر جنيه   (للمتوفر)\n  ❌ الاسم — مش متوفر   (بس كده، من غير شرح ومن غير بديل)\n' +
    '  وجملة "الصيدلي هيتواصل/هيراجع" تتقال مرة واحدة بس في الآخر، مش جنب كل صنف.\n' +
    '  وبعدهم سطر "الإجمالي: … جنيه" لو فيه أكتر من صنف متوفر، وفي الآخر سؤال قصير. ممنوع تحط الأصناف في جملة طويلة واحدة. القايمة دي مش محسوبة في حد الـ4 سطور.\n' +
    '- نوّع جملك ومتكررش نفس الجملة. إيموجي واحد خفيف بالكتير في الرسالة (زي 🌿 ✨ 💙 😊 🌷)، ونوّع بينهم ومتكررش نفس اللي في رسالتك اللي فاتت.\n' +
    '- اسأل سؤال يكمّل الكلام لما يكون مفيد، واعرض التوصيل لما يناسب ("تحب حضرتك نوصلهولك؟").\n\n' +
    'القواعد (لازم):\n' +
    '1. التوافر والأسعار من "المخزون المتاح" تحت بس. السعر يتكتب زي ما هو بالظبط. ممنوع تخترع صنف أو سعر.\n' +
    '1-أ. لو اسم الدوا اللي العميل كتبه مش معروف أو شكله غلطة كتابة لاسم معروف (زي "بدوفين" ممكن تكون "بروفين"، "كتافلام" ممكن "كتافاست"): ' +
    'متقولش متوفر ولا مش متوفر — اسأله الأول بجملة قصيرة: "تقصد حضرتك بروفين؟" (اقترح أقرب اسم أو اتنين بالكتير). ' +
    'ولو كان بيقول إنه بياخده ومعاه دوا تاني من نفس العيلة (زي بروفين + فولتارين، الاتنين مسكنات NSAIDs) نبّه إنهم مايتاخدوش مع بعض وescalate=true.\n' +
    '2. صنف مش متوفر: ممنوع تقترح أي بديل من نفسك (لا من المخزون ولا من دماغك). قول إنه مش متوفر حاليًا وإننا ممكن نوفّره لحضرتك، ' +
    'ولو مستعجل الدكتور يعرض عليه بديل مناسب — واسأله: "تحب نوفّره لحضرتك، ولا مستعجل والدكتور يعرض عليك بديل؟" (escalate=false). ' +
    'لو اختار "نوفّره": escalate=true و reason="طلب توفير: اسم الصنف" وقوله هنبلّغ حضرتك أول ما يوصل. ' +
    'لو اختار "بديل/مستعجل": escalate=true و reason="عايز بديل: اسم الصنف" وقوله الدكتور هيكلّمه هنا حالًا. ' +
    'واكتب "الدكتور" مش "الصيدلي" ولا "الدكتور الصيدلي". ' +
    'متقولش للعميل إن عندك قواعد أو ممنوعات (زي "ممنوع نقترح بدائل") — قول ببساطة إن الدكتور هو اللي هيختار له البديل المناسب.\n' +
    '2-ب. ممنوع تقول "راجعنا المخزون" أو "اتأكدنا" أو "مراجعتنا أكدت". متأكدش ولا تنفي توافر صنف مش ظاهر في "المخزون المتاح" قدامك. ' +
    'لو العميل سأل "متأكد؟" أو "موجود؟" عن صنف: لو هو في القايمة قول المتوفر بسعره، ولو مش فيها قول إنك مش لاقيه في المخزون المتاح قدامك حاليًا وإن الدكتور هيتأكد منه (escalate=true و reason="تأكيد توافر: اسم الصنف").\n' +
    '3. 🚫 البوت مش بيعالج ولا بيشخّص ولا بيرشّح دوا لأي حالة. شغله معلومات بس (توافر، سعر، معلومة عامة)، وأي علاج أو ترشيح أو جرعة هي شغل الدكتور:\n' +
    '   أ) اسم صنف محدد (حتى لو متكتب بغلطة بسيطة): قول متوفر ولا لأ وسعره زي ما هو. وده الوحيد اللي تعرضه بالسعر. ولو سأل "ده بيستخدم لإيه؟" أو "مادته الفعالة؟" أو "أشكاله؟": جاوب معلومة عامة قصيرة من النشرة (الاستخدام الأساسي، المادة الفعالة، الأشكال) من غير ما تقوله ياخده لحالته هو.\n' +
    '   ب) لو سأل عن صنف ليه أنواع كتير من غير ما يحدد (زي "عندك بنادول؟"): قول إنه متوفر بأنواعه واسأله يحدد النوع أو الشكل اللي يقصده. متسألوش بيشتكي من إيه ومتختارش له.\n' +
    '   ج) لو وصف عرض أو حالة أو مرض ومحدّدش اسم صنف (زي "عندي كحة"، "جلدي مقشر"، "عندي جفاف"، "صداع"): ممنوع ترشّح أو تعرض أي دوا أو منتج أو سعر، وممنوع تشخّص أو تقول خطوات علاج أو طرق منزلية. ' +
    'قايمة المخزون تحت ممكن تكون مطابقة غلط لكلماته (زي "مقشر" مع أداة تقشير) — متعرضهاش ومتذكرش أسماءها. اديله معلومة عامة قصيرة عن الحالة لو مفيدة (إيه هي بشكل عام، ومتى يروح لدكتور فورًا)، وقوله إن الدكتور هيرشحله المناسب لحالته هنا في أقرب وقت. ' +
    'escalate=true و reason="وصف حالة: ...".\n' +
    '   د) "ايه الفرق بين X و Y؟": اشرح الفرق العام بينهم باختصار كمعلومة (نص سطر لكل صنف)، من غير ما تقوله ياخد أنهي واحد. ولو عايز اختيار لحالته: الدكتور هو اللي يرشّح.\n' +
    '   هـ) الأطفال: نفس القواعد. معلومات عامة بس، وأي علاج أو دوا لطفل → escalate=true من غير ما تعرض أصناف.\n' +
    '4. الجرعات: ممنوع تقول جرعة أو عدد مرات أو مدة استخدام أو أقصى عدد في اليوم لأي دوا ولأي عميل، حتى لو من غير روشتة — الجرعة بتتحدد حسب حالة الشخص. ' +
    'لو سأل: قوله بلطف إن الجرعة بتتحدد حسب حالته والدكتور هيحددها له، و escalate=true. وكمان أي سؤال عن تداخل بين أدوية، أو حمل/رضاعة، أو أمراض مزمنة، أو دوا روشتة (مضاد حيوي، ضغط، سكر، قلب، أعصاب، كورتيزون، هرمونات…)، أو أعراض خطيرة → escalate=true.\n' +
    '   "باخد/بستعمل/باخد علاج اسمه X" معناها إنه بياخد X فعلًا — ده دوا تاني للأمان، مش طلب شرا: متقولش X متوفر أو مش متوفر. أي سؤال عن إنه ياخده مع حاجة تانية → escalate=true.\n' +
    '   لما تحوّل: قول بلطف وبكلامك إن الدكتور هيكلمه هنا في أقرب وقت، ومتكررش نفس الجملة. كل رسالة تتقيّم لوحدها: متحولش لو الرسالة الجديدة سؤال معلومات عادي (توافر/سعر/استخدام عام).\n' +
    '5-أ. order.lines لازم تضم كل الأصناف اللي العميل وافق عليها في المحادثة كلها (حتى لو وافق بكلمة زي "آه/اه/اخ/تمام/ماشي")، مش آخر صنف بس. ' +
    'ولو العميل قال "على العنوان المسجل" اكتب في address نفس الجملة دي بالظبط والسيستم هيجيب العنوان.\n' +
    '5. التوصيل متاح. متطلبش عنوان إلا لو العميل طلب توصيل فعلًا. لو عايز يطلب: اتأكد من الأصناف والكميات، واطلب الموبايل والعنوان بالتفصيل لو ناقصين. ' +
    'لما يبقى عندك الأصناف + الموبايل + العنوان: املا order (وفي order.lines اكتب اسم كل صنف بالظبط زي ما هو مكتوب في المخزون والكمية)، ' +
    'وفي reply قول جملة قصيرة بس إنك هتبعتله ملخص الطلب يأكده — متقولش إن الأوردر اتسجل.\n' +
    '   ' + (bs.fee ? 'رسوم التوصيل: ' + bs.fee + ' جنيه.' : 'رسوم التوصيل: متقولش رقم — قول إن الصيدلية هتأكدها.') +
    (bs.hours ? ' مواعيد العمل: ' + bs.hours + '.' : ' مواعيد العمل: لو اتسأل قول إن الصيدلي هيأكدها، ومتخترعش مواعيد.') + '\n' +
    (noSearch ? '6. ممنوع تطلب بحث تاني — رد على العميل دلوقتي من القايمة اللي قدامك.\n'
              : '6. أسماء المخزون غالبًا بالإنجليزي. لو سأل عن صنف ومش لاقيه في القايمة: رجّع search باسمه التجاري بالإنجليزي (مثلًا فولتارين → VOLTAREN) وسيب reply فاضي.\n') +
    '8. 🚨 الطوارئ: لو فيه حالة خطيرة دلوقتي (حد — خصوصًا طفل — بلع جاز/بنزين/كلور/مبيد/منظفات أو أدوية بكمية كبيرة، صعوبة تنفس، تشنجات، إغماء، نزيف شديد، ألم صدر شديد، حساسية بتورّم الوش أو الزور):\n' +
    '   emergency=true و escalate=true، و reply من غير أي إيموجي ومن غير ترحيب: الإسعاف الأولي الصح في سطرين (مثلًا للجاز: متخلّيهوش يرجّع، ومتدّيهوش أكل ولا شرب)، ' +
    'وبعدين "اتصل بالإسعاف 123 أو روح أقرب مستشفى فورًا"، وسطر بالعلامات اللي تستعجل (كحة مستمرة، صعوبة نفس، زُرقة، نعاس أو تشنج). ممنوع تعرض منتجات أو أسعار في الرسالة دي.\n' +
    '7. متقولش إنك بوت أو ذكاء اصطناعي إلا لو سألك مباشرة. ممنوع تدّي بيانات عن عملاء تانيين أو فواتير. رقم الصيدلية لو اتطلب: ' + PHARMACY_PHONE + '.\n\n' +
    (nm ? 'اسم العميل (مؤكد): ' + nm + '\n' : '') +
    (vph ? 'موبايل العميل (مؤكد من تيليجرام): ' + vph + '\n' : (ph ? 'موبايل كتبه العميل للتوصيل (غير مؤكد — متكشفش بيه أي بيانات): ' + ph + '\n' : 'العميل لسه ما شاركش رقمه — لو سأل عن بياناته أو طلباته قوله يدوس زرار "شارك رقمي 📱".\n')) +
    (addr ? 'آخر عنوان توصيل مسجل له: ' + addr + ' (اسأله يأكده قبل ما تستخدمه)\n' : '') +
    (dflow && dflow.address ? 'عنوان التوصيل اللي العميل أكده دلوقتي: ' + dflow.address + ' — استخدمه في order.address ومتسألش عن العنوان تاني.\n' : '') +
    safetyLine +
    photoLine_(chatId) +
    '\nالمخزون المتاح (مطابق لكلام العميل):\n' + stock + '\n\n' +
    formatHistory(history || []) +
    'رسالة العميل الجديدة: "' + text + '"\n\n' +
    'رد بـ JSON بس من غير أي كلام قبله أو بعده:\n' +
    '{"reply":"ردك للعميل","search":"","escalate":false,"emergency":false,"reason":"","order":null}\n' +
    'وorder لما يكتمل يبقى: {"items":"الأصناف والكميات","lines":[{"name":"اسم الصنف زي المخزون","q":1}],"phone":"...","address":"..."}';
}

/* 📷 سطر الصورة في البرومبت: الصورة اللي لسه واصلة، أو آخر صورة بعتها العميل (6 ساعات) */
function photoLine_(chatId) {
  var P = PHOTO_CTX, fresh = !!P;
  if (!P) { try { P = JSON.parse(CacheService.getScriptCache().get('lastphoto_' + chatId) || 'null'); } catch (e) { P = null; } }
  if (!P || !P.items || !P.items.length) return '';
  var isRx = P.kind === 'prescription';
  var names = P.items.map(function (it) { return it.name + (it.strength ? ' ' + it.strength : '') + (it.use ? ' [استخدامه: ' + it.use + ']' : '') + (it.hand ? ' {من الروشتة}' : '') + (it.sure === false ? ' (مش واضح)' : ''); }).join('، ');
  var s = (fresh ? 'العميل بعت دلوقتي صورة ' : 'آخر صورة بعتها العميل من شوية كانت ') + (isRx ? 'روشتة' : 'علبة/منتج') + ' مكتوب فيها: ' + names + '.\n' +
    (fresh ? '' : '→ لو العميل قال "الصورة" أو "الورقة" أو "اسمه ايه" أو "الدوا ده" يبقى قصده على الصورة دي — قوله الاسم المكتوب فيها على طول ومتطلبش يبعتها تاني.\n') +
    '→ قاعدة الماركة (مهمة جدًا): ✅ تتكتب بس لو اسم الصنف في المخزون هو نفس الاسم التجاري اللي في الصورة. ' +
    'نفس المادة الفعالة باسم تاني = منتج تاني (مثال: Xigduo XR ≠ داباليكس اكسار) → اكتب ❌ للأصلي، ' +
    'وممنوع تقدّم البديل كأنه هو نفس المنتج.\n';
  if (isRx) s += '→ دي روشتة' + ((P.n || 1) > 1 ? ' — وكل الأصناف اللي في الصور (حتى العلب) تعتبر من الروشتة' : '') + ': قوله المتوفر منها بالسعر والإجمالي، والمش متوفر يتكتب ❌ بس. ' +
    'قاعدة المش متوفر: البوت ممنوع يقترح أي بديل خالص. قول إنه مش متوفر حاليًا، وإننا ممكن نوفّره لحضرتك، ولو مستعجل الدكتور يعرض عليه بديل مناسب — واسأله يختار (مرة واحدة في الآخر لكل المش متوفر). متقولش جرعات.\n' +
    '→ أي صنف مكتوب جنبه (مش واضح): اكتبه في سطر لوحده بالشكل ده: ❓ الاسم — مش واضح في الروشتة (الدكتور هيأكده). متقولش عليه متوفر ولا مش متوفر.\n' +
    '→ أي صنف متوفر ومكتوب جنبه {من الروشتة}: اكتب بعد سعره "(هيتأكد مع الدكتور)" — لأن قراية خط الإيد ممكن تغلط.\n' +
    '→ اختم دايمًا بسؤال يقفل الطلب لو فيه حاجة متوفرة، زي: "تحب حضرتك نجهّز المتوفر ونوصّله؟"\n';
  else if (P.rx) s += '→ ده دوا بروشتة: متقولش جرعة. قول التوافر والسعر' + (P.label && fresh ? '، والمكتوب على العلبة (بالعربي بس): "' + P.label + '"' : '') +
    '. لو مش متوفر: قاعدة المش متوفر: البوت ممنوع يقترح أي بديل خالص. قول إنه مش متوفر حاليًا، وإننا ممكن نوفّره لحضرتك، ولو مستعجل الدكتور يعرض عليه بديل مناسب — واسأله يختار. ' +
    'والجرعة حسب الدكتور المعالج والدكتور هيأكدها (escalate=true لو سأل عن الاستعمال). ولو متوفر اختم بسؤال: "تحب حضرتك نجهّزه أو نوصّله؟"\n';
  else if (fresh) s += '→ رد على سؤاله عن الأصناف دي (التوافر والسعر، ومعلومة عامة عن استخدامه لو سأل — من غير جرعات: الجرعة والترشيح للدكتور). ' +
    'قاعدة المش متوفر: البوت ممنوع يقترح أي بديل خالص. قول إنه مش متوفر حاليًا، وإننا ممكن نوفّره لحضرتك، ولو مستعجل الدكتور يعرض عليه بديل مناسب — واسأله يختار.\n';
  return s;
}

function brainParse_(raw) {
  if (!raw) return null;
  try {
    var t = String(raw).replace(/```json|```/g, '').trim();
    var a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a === -1 || b === -1) return null;
    return JSON.parse(t.slice(a, b + 1));
  } catch (e) { return null; }
}

/* بيرجع true لو رد وخلص، false لو لازم النظام القديم يكمّل */
function smartCustomerReply_(chatId, text, history) {
  if (!SMART_BRAIN) return false;
  try {
    var items = brainCandidates_(text, history, '');
    var res = brainParse_(callGemini(brainPrompt_(chatId, text, history, items)));
    if (!res) res = brainParse_(callGemini(brainPrompt_(chatId, text, history, items)));   /* محاولة تانية لو الرد مش JSON */
    if (res && res.search && !res.reply) {
      items = brainCandidates_(text, history, res.search);
      res = brainParse_(callGemini(brainPrompt_(chatId, text, history, items, true)));
    }
    if (!res || !res.reply) { Logger.log('العقل مردش رد صالح'); return false; }

    var reply = stripVocatives_(String(res.reply).trim(), allowedNames_(chatId, history));
    if (!reply) return false;

    /* الأسعار المسموحة: المخزون اللي قدامه + اللي اتعرض قبل كده + رسوم التوصيل */
    var allowed = items.map(function (it) { return Math.round(it.price); });
    items.forEach(function (it) {
      if (it.units) allowed.push(Math.round(it.units));
      (String(it.name).match(/\d+(?:\.\d+)?/g) || []).forEach(function (n) { allowed.push(Math.round(parseFloat(n))); });
    });
    try { JSON.parse(CacheService.getScriptCache().get('quoted_' + chatId) || '[]').forEach(function (q) { allowed.push(q.price); }); } catch (e) {}
    (history || []).forEach(function (h) {
      (toAsciiDigits_(h.text).match(/\d+(?:\.\d+)?/g) || []).forEach(function (n) { allowed.push(Math.round(parseFloat(n))); });
    });
    (toAsciiDigits_(text).match(/\d+(?:\.\d+)?/g) || []).forEach(function (n) { allowed.push(Math.round(parseFloat(n))); });
    var bs = botSettings_();
    if (bs.fee) allowed.push(Math.round(parseFloat(bs.fee)));
    /* الإجمالي: أي مجموع لأسعار الأصناف اللي قدامه (+ التوصيل) مسموح */
    var ps = items.slice(0, 12).map(function (it) { return Math.round(it.price); }), sums = [0];
    ps.forEach(function (pr) { sums = sums.concat(sums.map(function (s) { return s + pr; })); });
    var feeN = bs.fee ? Math.round(parseFloat(bs.fee)) || 0 : 0;
    sums.forEach(function (s) { if (s) { allowed.push(s); if (feeN) allowed.push(s + feeN); } });
    var phones = [getCustomerPhone_(chatId), extractPhone_(text), PHARMACY_PHONE];
    (history || []).forEach(function (h) { if (h.role === 'user') phones.push(extractPhone_(toAsciiDigits_(h.text))); });
    var bad = brainPriceGuard_(reply, allowed, phones.filter(Boolean));
    if (bad) {
      Logger.log('العقل كتب ' + bad + ' مش من المخزون — الرد اترفض: ' + reply);
      return false;
    }

    /* 🚨 طوارئ: رد من غير إيموجي + تنبيه عاجل ليك */
    if (res.emergency) {
      reply = reply.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').replace(/[ \t]+\n/g, '\n').trim();
      sendTelegramStaff(reply, chatId);
      saveConversationTurn(chatId, text, reply);
      escalateToDoctor_(chatId, text, '🚨🚨 طوارئ — كلّم العميل فورًا' + (res.reason ? ' (' + res.reason + ')' : ''));
      return true;
    }

    var dfo = delFlow_(chatId);
    /* وصف حالة/عرض: الأصناف اللي لقيناها مطابقة غلط لكلام العميل ومتعرضتش — منسجلهاش كأسعار اتعرضت */
    var symptomOnly = !!res.escalate && /^وصف حالة/.test(String(res.reason || '')) && !/[✅❌]/.test(reply);
    if (items.length && !symptomOnly) quotedAdd_(chatId, items);
    if (res.escalate) escalateToDoctor_(chatId, text, res.reason || 'الموديل طلب مراجعة الدكتور');
    if (!items.length && /مش متوفر|مش موجود|غير متوفر/.test(reply)) logUnavailableRequest_(chatId, extractProductLocally_(text) || text);
    if (items.length && !symptomOnly) logQuote_(chatId, items.slice(0, MAX_RESULTS_TO_SHOW));

    if (res.order) {
      res.order.address = res.order.address || (dfo && dfo.address) || '';
      res.order.phone = res.order.phone || getCustomerPhone_(chatId);
      /* "على العنوان المسجل" → نحط العنوان الحقيقي، ولو مفيش عنوان متسجل نسأله بدل ما نكتب كلمة "المسجل" في الطلب */
      if (/مسجل|متسجل|كتسجل|نفس العنوان|العنوان القديم|زي المر[ةه]/.test(String(res.order.address))) {
        var vphO = getVerifiedPhone_(chatId), realA = (dfo && dfo.address) || (vphO ? lastAddress_(vphO) : '');
        if (realA) res.order.address = realA;
        else {
          res.order.address = '';
          reply = 'مش لاقي عنوان متسجل لحضرتك عندنا 🙏 ممكن تكتب العنوان بالتفصيل (المنطقة والشارع وعلامة مميزة) أو تبعت اللوكيشن 📍؟';
        }
      }
    }
    /* 📷 رد صورة فيه حاجة متوفرة ومفيهوش سؤال → نقفله بسؤال الطلب */
    if (PHOTO_CTX && reply.indexOf('✅') !== -1 && !/[؟?]\s*\S{0,3}\s*$/.test(reply))
      reply += '\n\nتحب حضرتك نجهّز المتوفر ونوصّله؟';
    sendTelegram_(chatId, reply);
    saveConversationTurn(chatId, text, reply);

    if (res.order && res.order.address && res.order.phone && (res.order.items || (res.order.lines || []).length)) {
      saveCustomerPhone_(chatId, String(res.order.phone));
      var sum = sendOrderSummary_(chatId, res.order);
      saveConversationTurn(chatId, '[مستني تأكيد الطلب]', sum);
    } else if (res.order && !res.order.phone && !getVerifiedPhone_(chatId)) {
      tgApi_('sendMessage', { chat_id: chatId, reply_markup: KB_SHARE, text: 'عشان نكمّل الطلب، دوس على زرار "📱 سجّل رقمي" تحت 🌸' });
    } else {
      try { maybeAskPhone_(chatId); } catch (e) {}
    }
    return true;
  } catch (e) {
    Logger.log('خطأ smartCustomerReply_: ' + e.message);
    return false;
  }
}

// ===================================================================
// 9) المعالج الرئيسي لرسالة العميل
// ===================================================================

function handleCustomerMessage(chatId, message) {
  const cache = CacheService.getScriptCache();

  try {
    // 📱 العميل شارك رقمه بالزرار — نتأكد إنه رقمه هو مش رقم حد تاني
    if (message.contact) {
      var ct = message.contact;
      if (ct.user_id && message.from && String(ct.user_id) === String(message.from.id)) {
        var vp = canonicalEgyptPhone_(ct.phone_number);
        PropertiesService.getScriptProperties().setProperty('vphone_' + chatId, vp);
        saveCustomerPhone_(chatId, vp);
        CacheService.getScriptCache().remove('cname_' + vp);
        var pf = delFlow_(chatId);
        if (pf && pf.step === 'needPhone') {
          sendTelegramMarkup_(chatId, 'شكرًا لحضرتك، اتسجل رقم حضرتك ✅', { remove_keyboard: true });
          startDelivery_(chatId);
        } else sendWelcome_(chatId, '✅ شكرًا لحضرتك، اتسجل رقم حضرتك.');
      } else {
        sendTelegramMarkup_(chatId, 'معلش، محتاجين رقم حضرتك أنت، دوس على زرار "📱 سجّل رقمي" 🙏',
          KB_SHARE);
      }
      return;
    }

    // 📍 العميل بعت موقعه
    if (message.location) {
      var lf = delFlow_(chatId);
      var la = message.location.latitude, lo = message.location.longitude;
      var pn = placeName_(la, lo);
      if (holdOn_(chatId)) {
        tgApi_('sendMessage', { chat_id: PERSONAL_CHAT, text: '📍 العميل بعت موقعه: ' + (pn || '') + '\n' + mapsLink_(la, lo) + '\n[#c' + chatId + ']' });
        return;
      }
      /* بعيد عن منطقة التوصيل؟ */
      var bsl = botSettings_(), cen = bsl.maxKm > 0 ? pharmacyCenter_() : null;
      if (cen) {
        var km = distKm_(cen.lat, cen.lng, la, lo);
        if (km > bsl.maxKm) {
          tgApi_('sendMessage', { chat_id: chatId,
            text: '📍 الموقع ده' + (pn ? ' (' + pn + ')' : '') + ' بعيد عن منطقة التوصيل بتاعتنا (حوالي ' + Math.round(km) + ' كم من الصيدلية) 🙏\n' +
                  'ممكن حضرتك تبعت عنوان تاني جوه المنطقة، أو تكتب سؤالك والصيدلي يتواصل مع حضرتك.',
            reply_markup: { keyboard: [[{ text: '📍 ابعت موقعي', request_location: true }]], resize_keyboard: true, one_time_keyboard: true } });
          delFlow_(chatId, { step: 'address' });
          return;
        }
      }
      if (lf && (lf.step === 'address' || lf.step === 'confirm')) addressConfirmed_(chatId, (pn ? pn + ' — ' : '') + mapsLink_(la, lo));
      else tgApi_('sendMessage', { chat_id: chatId, text: 'وصلنا موقع حضرتك ✅ تحب نوصّلك طلب؟', reply_markup: { inline_keyboard: [[{ text: '🛵 أيوه، أطلب توصيل', callback_data: 'm_del' }]] } });
      if (!(lf && (lf.step === 'address' || lf.step === 'confirm'))) delFlow_(chatId, { step: 'confirm', lat: la, lng: lo, place: pn });
      return;
    }

    // صور: بتتحول للدكتور
    if (message.photo) {
      /* الصورة نفسها بتتبعتلك (قبل كده كانت بتوصلك رسالة بس من غير الصورة) */
      tgApi_('forwardMessage', { chat_id: PERSONAL_CHAT, from_chat_id: chatId, message_id: message.message_id });
      var pfids = [message.photo[message.photo.length - 1].file_id];
      /* 🖼️ ألبوم (كذا صورة مع بعض): كل صورة بتوصل لوحدها — بنستنى ثواني ونجمّعهم،
         وأصغر رسالة في الألبوم هي اللي ترد مرة واحدة على الكل */
      if (message.media_group_id) {
        var MC = CacheService.getScriptCache(), gk = 'mg_' + message.media_group_id + '_', mid = message.message_id;
        MC.put(gk + mid, pfids[0], 600);
        if (message.caption) MC.put(gk + 'cap', String(message.caption), 600);
        Utilities.sleep(4000);
        var keys = []; for (var q = mid - 10; q <= mid + 10; q++) keys.push(gk + q);
        var got = MC.getAll(keys), ids = Object.keys(got).map(function (k) { return +k.slice(gk.length); }).sort(function (a, b) { return a - b; });
        if (ids.length && ids[0] !== mid) return;               /* صورة تانية في نفس الألبوم هترد */
        pfids = ids.map(function (n) { return got[gk + n]; });
        if (!message.caption) message.caption = MC.get(gk + 'cap') || '';
      }
      if (holdOn_(chatId)) { escalateToDoctor_(chatId, '[' + (pfids.length > 1 ? pfids.length + ' صور' : 'صورة') + ']' + (message.caption ? ' ' + message.caption : ''), 'صورة'); return; }
      /* 📷 البوت يقرا الصورة: علبة دوا → يرد بالتوافر والسعر · روشتة → المتوفر والإجمالي + تتبعتلك تراجعها */
      sendTelegram_(chatId, pfids.length > 1 ? 'استلمنا الصور (' + pfids.length + ') 🌿 ثواني وبنشوفها لحضرتك' : 'استلمنا الصورة 🌿 ثواني وبنشوفها لحضرتك');
      sendTypingAction_(chatId);
      var seen = readPhoto_(pfids);
      /* ✍️ روشتة مكتوبة بخط الإيد → الصيدلي بس اللي يقراها ويرد (البوت ميخمّنش أسماء) */
      if (seen && seen.kind === 'prescription' && seen.handwritten) {
        var guess = (seen.items || []).map(function (it) { return it.name + (it.strength ? ' ' + it.strength : '') + (it.sure === false ? ' (؟)' : ''); }).join('، ');
        escalateToDoctor_(chatId, '[روشتة بخط الإيد — ' + (pfids.length > 1 ? pfids.length + ' صور فوق' : 'الصورة فوق') + ']' +
          (guess ? '\nقراية تقريبية من البوت (للمساعدة بس): ' + guess : '') + (message.caption ? '\nالعميل كتب: ' + message.caption : ''), '✍️ روشتة بخط الإيد — اقراها ورد على العميل');
        var rr = 'استلمنا الروشتة 🌿 الصيدلي هيقراها بنفسه ويرد على حضرتك هنا بالمتوفر والأسعار في أقرب وقت.';
        sendTelegram_(chatId, rr);
        saveConversationTurn(chatId, '[روشتة بخط الإيد' + (message.caption ? ': ' + message.caption : '') + ']', rr);
        return;
      }
      if (seen && (seen.kind === 'box' || seen.kind === 'prescription') && seen.items && seen.items.length) {
        var pnames = seen.items.map(function (it) { return it.name + (it.strength ? ' ' + it.strength : '') + (it.use ? ' (' + it.use + ')' : ''); }).join('، ');
        var ptxt = toAsciiDigits_(String(message.caption || '').trim()) || (seen.kind === 'prescription' ? 'عايز الروشتة دي' : 'عندكم الدوا ده؟');
        if (seen.kind === 'prescription')
          escalateToDoctor_(chatId, '[روشتة — الصورة فوق] قريت منها: ' + pnames + (message.caption ? '\nالعميل كتب: ' + message.caption : ''), 'روشتة — راجعها');
        PHOTO_CTX = seen;
        try { CacheService.getScriptCache().put('lastphoto_' + chatId, JSON.stringify({ kind: seen.kind, items: seen.items, rx: !!seen.rx, n: pfids.length }), 21600); } catch (eP) {}
        var okp = false;
        try { okp = smartCustomerReply_(chatId, ptxt + '\n[العميل بعت صورة ' + (seen.kind === 'prescription' ? 'روشتة' : 'منتج') + ' مكتوب فيها: ' + pnames + ']', getConversationHistory(chatId)); } catch (e) {}
        PHOTO_CTX = null;
        if (okp) return;
      }
      escalateToDoctor_(chatId, '[صورة/روشتة — الصورة فوق الرسالة دي]' + (message.caption ? ' ' + message.caption : ''), 'صورة/روشتة');
      const r = 'استلمنا الصورة 🙏 الصيدلي هيراجعها ويرد على حضرتك هنا في أقرب وقت.';
      sendTelegram_(chatId, r);
      saveConversationTurn(chatId, '[صورة]', r);
      return;
    }

    /* 🎤 فويس → كلام مكتوب، وبعدها يتعامل كأنه رسالة عادية */
    var fromVoice = false;
    if ((message.voice || message.audio) && !message.text) {
      var va = message.voice || message.audio;
      if ((va.duration || 0) > 180) {
        sendTelegram_(chatId, 'الرسالة الصوتية طويلة شوية 🙏 ممكن حضرتك تبعتها في رسايل أقصر (أقل من 3 دقايق) أو تكتبها.');
        return;
      }
      sendTypingAction_(chatId);
      var heard = transcribeVoice_(va.file_id, va.mime_type || 'audio/ogg');
      if (!heard) {
        if (holdOn_(chatId)) tgApi_('forwardMessage', { chat_id: PERSONAL_CHAT, from_chat_id: chatId, message_id: message.message_id });
        else sendTelegram_(chatId, 'معلش الصوت مش واضح عندي 🙏 ممكن حضرتك تعيده أو تكتب طلبك؟');
        return;
      }
      message = { text: heard, from: message.from, chat: message.chat, message_id: message.message_id };
      fromVoice = true;
    }

    var text = toAsciiDigits_((message.text || '').trim());
    if (!text) return;

    /* 🤫 الصيدلي ماسك المحادثة → الرسالة توصله والبوت ميردش */
    if (holdOn_(chatId)) {
      tgApi_('sendMessage', { chat_id: PERSONAL_CHAT, reply_markup: holdKb_(chatId, true),
        text: '💬 ' + (getKnownCustomerName_(chatId) || 'العميل') + (fromVoice ? ' (فويس)' : '') + ':\n"' + text.slice(0, 2500) + '"\n\n↩️ اعمل Reply عشان ترد.\n[#c' + chatId + ']' });
      saveConversationTurn(chatId, text, '[الصيدلي بيرد بنفسه]');
      try { PropertiesService.getScriptProperties().setProperty('escp_' + chatId, Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm')); } catch (eH) {}
      return;
    }

    if (text === '/start' || text === '/menu') { sendWelcome_(chatId); return; }

    /* أول رسالة أو تحية قصيرة → الترحيب المنظم بالأزرار */
    var nT0 = normalizeArabic(text);
    /* تحية بس (مفيش سؤال معاها) — "السلام عليكم عندكم بنادول" مش هتدخل هنا */
    if (hasAnyWord_(nT0, GREETING_WORDS_) && nT0.split(' ').length <= 4 && !extractProductLocally_(text)) {
      saveConversationTurn(chatId, text, '[رسالة الترحيب]');
      sendWelcome_(chatId); return;
    }

    /* أسئلة الهوية ("اسمي ايه" / "انا مين" / "متسجل عندك") — بالكود مش بالموديل عشان ميخمّنش اسم */
    /* بنشيل علامات الاستفهام والحروف الفردية الزيادة ("اسمي ايه ز") */
    var nId = (' ' + normalizeArabic(text).replace(/[؟?!.،,]+/g, ' ') + ' ').replace(/\s\S(?=\s)/g, ' ').replace(/\s+/g, ' ').trim();
    if (/(اسمي (ايه|اي|اية)( |$)|(^| )انا مين|عارف(ني| انا مين| اسمي)|متسجل (عندك|عندكم|باسم|بايه)|انا متسجل)/.test(nId)) {
      var idName = getKnownCustomerName_(chatId);
      if (getVerifiedPhone_(chatId)) {
        tgApi_('sendMessage', { chat_id: chatId, text: idName
          ? 'حضرتك متسجل عندنا باسم: ' + idName + ' ✅'
          : 'رقم حضرتك متسجل عندنا ✅ بس الاسم لسه مش متسجل في السيستم. ممكن حضرتك تقولنا الاسم هنا 🌸' });
      } else {
        tgApi_('sendMessage', { chat_id: chatId, reply_markup: KB_SHARE,
          text: 'عشان نعرف بيانات حضرتك المسجلة، دوس على زرار "📱 سجّل رقمي" تحت بضغطة واحدة 🌸' });
      }
      saveConversationTurn(chatId, text, '[سؤال عن الهوية]');
      return;
    }

    /* العنوان المكتوب لما بنستنى عنوان */
    var df0 = delFlow_(chatId);
    if (df0 && df0.step === 'address' && text.length >= 8 && !extractPhone_(text)) { addressConfirmed_(chatId, text); return; }

    /* كتب رقمه بإيده بس → منطلبش عنوان؛ التعرّف بالزرار */
    var onlyPhone = extractPhone_(text);
    if (onlyPhone && text.replace(/[\s+\-]/g, '').replace(/^(\+?2)?/, '').length <= 13 && !getVerifiedPhone_(chatId)) {
      saveCustomerPhone_(chatId, onlyPhone);
      tgApi_('sendMessage', { chat_id: chatId, reply_markup: KB_SHARE,
        text: 'شكرًا لحضرتك 🌸 لحماية بيانات حضرتك، التعرّف على الحساب بيتم بزرار "📱 سجّل رقمي" بضغطة واحدة.' });
      saveConversationTurn(chatId, text, '[طلبنا التسجيل بالزرار]');
      return;
    }

    // تجميع الرسايل السريعة (متعطّل افتراضيًا عشان السرعة)
    if (MESSAGE_DEBOUNCE_MS > 0) {
      const stamp = String(new Date().getTime()) + Math.random();
      var pend = []; try { pend = JSON.parse(cache.get('pend_' + chatId) || '[]'); } catch (e) {}
      pend.push(text);
      cache.put('pend_' + chatId, JSON.stringify(pend.slice(-6)), 120);
      cache.put('last_msg_' + chatId, stamp, 120);
      Utilities.sleep(MESSAGE_DEBOUNCE_MS);
      if (cache.get('last_msg_' + chatId) !== stamp) return;   /* جت رسالة أحدث — هي اللي هترد على الكل */
      try { pend = JSON.parse(cache.get('pend_' + chatId) || '[]'); } catch (e) { pend = [text]; }
      cache.remove('pend_' + chatId);
      if (pend.length > 1) text = pend.join('\n');
    }

    sendTypingAction_(chatId);

    const phone = extractPhone_(text);
    if (phone) saveCustomerPhone_(chatId, phone);

    const history = getConversationHistory(chatId);
    const nText = normalizeArabic(text);

    // --- 🧠 العقل الجديد: خط أحمر صغير، والباقي الموديل بيفهمه من السياق ---
    if (SMART_BRAIN) {
      for (var hk = 0; hk < HARD_ESCALATE.length; hk++) {
        if (nText.indexOf(normalizeArabic(HARD_ESCALATE[hk])) !== -1) {
          escalateToDoctor_(chatId, text, 'كلمة تستدعي مراجعة: ' + HARD_ESCALATE[hk]);
          const rhs = ['ألف سلامة على حضرتك 🌸 في الحالة دي لازم الصيدلي يراجع بنفسه، بلّغته برسالة حضرتك وهيرد هنا في أقرب وقت.',
                       'عشان سلامة حضرتك وسلامة البيبي، الصيدلي هو اللي هيرد على حضرتك بنفسه 🙏 وصّلتله السؤال دلوقتي.',
                       'حاضر، دي محتاجة رأي الصيدلي شخصيًا. وصّلتله سؤال حضرتك وهيرد هنا قريب جدًا 🌸'];
          const rh = rhs[Math.floor(Math.random() * rhs.length)];
          sendTelegram_(chatId, rh);
          saveConversationTurn(chatId, text, rh);
          return;
        }
      }
      try { safetyCapture_(chatId, text, history); } catch (e) {}
      if (smartCustomerReply_(chatId, text, history)) return;

      /* العقل مقدرش يرد: منرجعش للنظام القديم (كان بيدوّر على جملة العميل كأنها اسم دوا ويقول "مش متوفر").
         لو الكلام اسم صنف موجود → نرد بالسعر من المخزون؛ غير كده → رد مهذب وبلاغ للصيدلي. */
      var fbProd = extractProductLocally_(text), fbRes = fbProd && fbProd.length >= 3 ? searchStock(fbProd) : [];
      if (fbRes.length) {
        var fbAns = buildProductAnswer_(fbRes, fbProd);
        logQuote_(chatId, fbAns.items || []); quotedAdd_(chatId, fbAns.items || []);
        sendTelegram_(chatId, fbAns.text); saveConversationTurn(chatId, text, fbAns.text);
        return;
      }
      escalateToDoctor_(chatId, text, 'البوت مقدرش يرد — يفضّل ترد بنفسك');
      var fbs = ['ثواني وأرجع لحضرتك بالرد 🙏', 'وصلت رسالة حضرتك، الصيدلي هيرد على حضرتك هنا في أقرب وقت 🌸',
                 'تمام، بنراجع طلب حضرتك وهنرد هنا حالًا 🙏'];
      var fb = fbs[Math.floor(Math.random() * fbs.length)];
      sendTelegram_(chatId, fb); saveConversationTurn(chatId, text, fb);
      return;
    }

    // --- خط أحمر: كلمات بتحوّل للدكتور فورًا ---
    for (var k = 0; k < ESCALATE_KEYWORDS.length; k++) {
      if (nText.indexOf(normalizeArabic(ESCALATE_KEYWORDS[k])) !== -1) {
        escalateToDoctor_(chatId, text, 'كلمة تستدعي مراجعة: ' + ESCALATE_KEYWORDS[k]);
        const r = 'سؤالك ده محتاج رأي الدكتور شخصيًا 🙏 حوّلته له دلوقتي وهيرد عليك بنفسه هنا.';
        sendTelegram_(chatId, r);
        saveConversationTurn(chatId, text, r);
        return;
      }
    }

    // --- نية طلب/توصيل ---
    if (hasAnyWord_(nText, ORDER_WORDS_) || phone) {
      handleOrderIntent_(chatId, text, history);
      return;
    }

    // --- ⚡ الرد المحلي السريع: تحية / صنف / سعر / نقاط ---
    const quick = tryLocalReply_(chatId, text, history);
    if (quick) {
      sendTelegram_(chatId, quick);
      saveConversationTurn(chatId, text, quick);
      return;
    }

    // --- مفهمناش محليًا: نجرب الذكاء الاصطناعي ---
    const cls = classifyCustomerMessage(text, history);

    if (cls.type === 'MEDICAL') {
      escalateToDoctor_(chatId, text, 'سؤال طبي');
      const r = 'سؤالك محتاج رأي الدكتور 🙏 حوّلته له وهيرد عليك بنفسه هنا.';
      sendTelegram_(chatId, r);
      saveConversationTurn(chatId, text, r);
      return;
    }

    if (cls.type === 'PRODUCT' && cls.product) {
      handleProductQuery_(chatId, text, cls.product, history);
      return;
    }

    if (cls.type === 'ORDER') {
      handleOrderIntent_(chatId, text, history);
      return;
    }

    // --- كلام عام: نحاول نصيغ رد، ولو فشل منسيبش العميل ---
    const nm = getKnownCustomerName_(chatId);
    var reply = null;

    if (cls.type !== 'FAILED') {
      const genPrompt = formatHistory(history) +
        'انت مساعد ' + PHARMACY_NAME + '، بترد بالعامية المصرية بشكل ودود ومختصر (سطرين بالكتير).\n' +
        'قواعد مهمة:\n' +
        '- متذكرش أي أسعار ولا أسماء أصناف ولا تقول إن حاجة متوفرة أو مش متوفرة.\n' +
        '- متقولش إنك سجلت أو عملت أوردر أو هتطلع عنوان من السيستم.\n' +
        '- متكررش "تحت أمرك" لو قلتها قبل كده.\n' +
        (nm ? '- اسم العميل: ' + nm + '\n' : '') +
        '\nالرسالة: "' + text + '"';
      reply = callGemini(genPrompt);
      if (reply && replyHasInventedNumbers_(reply, [])) reply = null;
    }

    if (!reply) {
      // جيميني واقع — نرد رد محترم ونحوّل، مش نقول "ضغط على النظام"
      reply = 'تحت أمرك يا فندم 🌸 قولي اسم الصنف اللي محتاجه وأقولك متوفر ولا لأ وبكام.';
      escalateToDoctor_(chatId, text, 'الذكاء الاصطناعي مردش — يفضّل ترد بنفسك');
    }

    sendTelegram_(chatId, reply);
    saveConversationTurn(chatId, text, reply);

  } catch (e) {
    Logger.log('خطأ handleCustomerMessage: ' + e.message);
    try {
      escalateToDoctor_(chatId, (message.text || '[رسالة]'), 'خطأ تقني: ' + e.message);
      sendTelegram_(chatId, 'ثانية واحدة يا فندم 🙏 الدكتور هيرد عليك حالًا.');
    } catch (e2) {}
  }
}

// --- سؤال عن صنف ---
function handleProductQuery_(chatId, text, product, history) {
  const results = searchStock(product);

  if (!results.length) {
    logUnavailableRequest_(chatId, product);
    var msg;
    if (ALLOW_AUTO_ALTERNATIVES) {
      msg = 'للأسف "' + product + '" مش متوفر عندنا دلوقتي.';
    } else {
      msg = 'للأسف "' + product + '" مش متوفر عندنا دلوقتي 🙏\n' +
            'ممكن نوفّره لحضرتك، ولو مستعجل الدكتور يعرض عليك بديل مناسب. تحب أنهي؟';
    }
    sendTelegram_(chatId, msg);
    saveConversationTurn(chatId, text, msg);
    return;
  }

  const answer = buildProductAnswer_(results, product);
  logQuote_(chatId, answer.items || []);

  // نخلي المودل يصيغ جملة تقديم بس — من غير أي أرقام
  const nm = getKnownCustomerName_(chatId);
  const wrapPrompt = formatHistory(history) +
    'انت مساعد ' + PHARMACY_NAME + '. اكتب جملة واحدة قصيرة جدًا بالعامية المصرية تقدّم بيها النتيجة دي للعميل.\n' +
    'ممنوع تمامًا: تكتب أي رقم، أو أي سعر، أو أي اسم صنف، أو تزود معلومة من عندك.\n' +
    'جملة ترحيبية/تمهيدية بس، وبعدها هنلزق النتيجة تحتها.\n' +
    (nm ? 'اسم العميل: ' + nm + '\n' : '') +
    'العميل سأل عن: "' + product + '"\n' +
    'النتيجة: ' + (answer.available ? 'متوفر' : 'مش متوفر');

  var intro = callGemini(wrapPrompt);
  if (!intro || replyHasInventedNumbers_(intro, []) || intro.length > 120) intro = '';

  const finalReply = (intro ? intro.trim() + '\n\n' : '') + answer.text;
  sendTelegram_(chatId, finalReply);
  saveConversationTurn(chatId, text, finalReply);
}

// --- نية الطلب/التوصيل ---
function handleOrderIntent_(chatId, text, history) {
  const phone = getCustomerPhone_(chatId) || extractPhone_(text);
  if (phone) saveCustomerPhone_(chatId, phone);

  // بنجمع آخر صنف اتكلمنا عليه من الذاكرة
  var lastItems = '';
  for (var i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'bot' && history[i].text.indexOf('•') !== -1) {
      lastItems = history[i].text;
      break;
    }
  }

  // العنوان: أي كلام غير الرقم
  const addressGuess = text.replace(/01[0125]\d{8}/g, '').trim();
  const looksLikeAddress = addressGuess.length >= 8;

  if (!phone) {
    const r = 'تمام يا فندم، التوصيل متاح 🛵\nابعتلي رقم موبايلك والعنوان بالتفصيل وأجهزلك الأوردر علطول.';
    sendTelegram_(chatId, r);
    saveConversationTurn(chatId, text, r);
    return;
  }

  if (!looksLikeAddress) {
    const r = 'تمام، سجلت الرقم ✅\nباقي العنوان بالتفصيل (المنطقة والشارع وعلامة مميزة) وأبعتلك الدليفري.';
    sendTelegram_(chatId, r);
    saveConversationTurn(chatId, text, r);
    return;
  }

  const ok = saveOrder_(chatId, lastItems || text, phone, addressGuess);
  const r = ok
    ? 'تمام يا فندم ✅ الأوردر اتسجل ووصل للصيدلية، والدليفري هيتواصل معاك يأكد التفاصيل والإجمالي.'
    : 'حصلت مشكلة وأنا بسجل الأوردر 🙏 الدكتور هيتواصل معاك حالًا.';
  if (!ok) escalateToDoctor_(chatId, text, 'فشل تسجيل الأوردر');
  sendTelegram_(chatId, r);
  saveConversationTurn(chatId, text, r);
}

// ===================================================================
// 10) إرسال تليجرام
// ===================================================================

/* تليجرام سقفه 4096 حرف للرسالة — الأطول بتتقسّم هنا تلقائي على حدود الأسطر،
   فأي رسالة طويلة (نواقص، تقارير) توصل كاملة بدل ما تترفض. */
function sendTelegramStaff(message, chatId) {
  if (isWa_(chatId)) { waSend_(String(chatId), message); return; }
  const url = 'https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage';
  var text = String(message == null ? '' : message), MAX = 3800, parts = [];
  if (text.length <= MAX) {
    parts = [text];
  } else {
    var cur = '';
    text.split('\n').forEach(function (line) {
      while (line.length > MAX) {                     // سطر واحد أطول من الحد
        if (cur) { parts.push(cur); cur = ''; }
        parts.push(line.substring(0, MAX)); line = line.substring(MAX);
      }
      if ((cur + line).length + 1 > MAX) { parts.push(cur); cur = ''; }
      cur += line + '\n';
    });
    if (cur) parts.push(cur);
  }
  parts.forEach(function (p, i) {
    UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ chat_id: chatId,
        text: p + (parts.length > 1 ? '\n(' + (i + 1) + '/' + parts.length + ')' : '') }),
      muteHttpExceptions: true
    });
    if (i < parts.length - 1) Utilities.sleep(400);
  });
}

function sendTelegram_(chatId, message) {
  sendTelegramStaff(varyEmoji_(chatId, message), chatId);
}

// مؤشر "بيكتب دلوقتي..."
function sendTypingAction_(chatId) {
  if (isWa_(chatId)) { try { waTyping_(String(chatId)); } catch (e) {} return; }
  try {
    UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendChatAction', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ chat_id: chatId, action: 'typing' }),
      muteHttpExceptions: true
    });
  } catch (e) {}
}

// ===================================================================
// 11) إعداد الويبهوك (الرد في ثانية بدل دقيقة)
// ===================================================================

// ⚠️ حط هنا لينك الـ Web App بتاعك — لازم ينتهي بـ /exec مش /dev
// تجيبه منين: Deploy > New deployment > Web app
//   Execute as: Me   |   Who has access: Anyone
// وبعد ما يطلعلك اللينك، انسخه وحطه هنا بين علامتي التنصيص.
/* لينك الوسيط (Cloudflare Worker) لو متسجل — بيرد على تليجرام فورًا ويوصّل الرسالة هنا.
   من غيره تليجرام بيستلم 302 من جوجل ويفتكرها فشل ويعيد ويأخّر الرسايل. */
function tgHookUrl_() {
  var r = '';
  try { r = PropertiesService.getScriptProperties().getProperty('TG_RELAY_URL') || ''; } catch (e) {}
  return r || WEB_APP_URL;
}
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbyETI5UTPwpMFOu-aWoKKHqyppa7ctTVJjckmbTxegDq7E3R3p6aEBzqt275HNL8SBfWg/exec';

// شغّلها مرة واحدة بعد ما تحط اللينك فوق
/* حالة البوت من لوحة التحكم */
function botStatus() {
  try {
    var r = JSON.parse(UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/getWebhookInfo',
      { muteHttpExceptions: true }).getContentText()).result || {};
    var props = PropertiesService.getScriptProperties();
    return { ok: true, url: r.url || '', viaRelay: !!props.getProperty('TG_RELAY_URL') && r.url === props.getProperty('TG_RELAY_URL'),
             pending: r.pending_update_count || 0, lastError: r.last_error_message || '',
             lastErrorAt: r.last_error_date ? Utilities.formatDate(new Date(r.last_error_date * 1000), 'Africa/Cairo', 'yyyy-MM-dd HH:mm') : '',
             polling: !r.url, provider: aiCfg_().provider, hasKey: !!aiCfg_().key };
  } catch (e) { return { ok: false, error: e.message }; }
}
/* بيسجّل لينك الوسيط ويحوّل تليجرام عليه */
function botSetRelay(url) {
  url = String(url || '').trim();
  if (!/^https:\/\/[^\s]+$/.test(url)) return { ok: false, error: 'اللينك لازم يبدأ بـ https://' };
  var props = PropertiesService.getScriptProperties();
  var res = JSON.parse(UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN +
    '/setWebhook?drop_pending_updates=true&url=' + encodeURIComponent(url), { muteHttpExceptions: true }).getContentText());
  if (res.ok) { props.setProperty('TG_RELAY_URL', url); props.setProperty('telegramWebhookOn', 'yes'); props.setProperty('queueCleared', 'yes'); }
  return { ok: !!res.ok, error: res.ok ? '' : (res.description || 'فشل') };
}

function setTelegramWebhook() {
  var url = WEB_APP_URL;

  if (!url || url.indexOf('ضع_لينك') !== -1) {
    Logger.log('❌ لسه محطتش اللينك في WEB_APP_URL فوق');
    Logger.log('   روح Deploy > New deployment > Web app، وانسخ اللينك وحطه هناك');
    return;
  }
  if (url.indexOf('/dev') !== -1) {
    Logger.log('❌ ده لينك تطوير (/dev) — تليجرام مش هيقدر يدخله وهيرجع 401');
    Logger.log('   لازم اللينك اللي بينتهي بـ /exec من Manage deployments');
    return;
  }
  if (url.indexOf('/exec') === -1) {
    Logger.log('❌ اللينك لازم ينتهي بـ /exec');
    return;
  }

  // drop_pending_updates=true → بيفضّي أي رسايل قديمة متراكمة في الطابور
  PropertiesService.getScriptProperties().deleteProperty('queueCleared');

  const res = UrlFetchApp.fetch(
    'https://api.telegram.org/bot' + BOT_TOKEN + '/setWebhook?drop_pending_updates=true&url=' + encodeURIComponent(url),
    { muteHttpExceptions: true }
  );
  Logger.log(res.getContentText());

  const ok = JSON.parse(res.getContentText()).ok;
  if (ok) {
    PropertiesService.getScriptProperties().setProperty('telegramWebhookOn', 'yes');
    Logger.log('✅ الويبهوك اتفعّل — استنى دقيقة وشغّل checkWebhook للتأكد');
  }
}

// 🧹 بيفضّي الرسايل القديمة المتراكمة من غير ما يلمس أي إعداد تاني
// شغّلها لو حسيت إن البوت بيرد على رسايل قديمة أو بيتأخر بشكل غريب
function clearPendingQueue() {
  const before = JSON.parse(UrlFetchApp.fetch(
    'https://api.telegram.org/bot' + BOT_TOKEN + '/getWebhookInfo',
    { muteHttpExceptions: true }).getContentText());
  const n = (before.result && before.result.pending_update_count) || 0;
  Logger.log('رسايل متراكمة في الطابور: ' + n);

  if (!WEB_APP_URL || WEB_APP_URL.indexOf('/exec') === -1) {
    Logger.log('❌ WEB_APP_URL مش مظبوط');
    return;
  }

  UrlFetchApp.fetch(
    'https://api.telegram.org/bot' + BOT_TOKEN +
    '/setWebhook?drop_pending_updates=true&url=' + encodeURIComponent(tgHookUrl_()),
    { muteHttpExceptions: true });

  Logger.log('✅ الطابور اتفضّى — ابعت رسالة جديدة دلوقتي وشوف بترد في كام ثانية');
}

function deleteTelegramWebhook() {
  const url = 'https://api.telegram.org/bot' + BOT_TOKEN + '/deleteWebhook';
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  Logger.log(res.getContentText());
  PropertiesService.getScriptProperties().deleteProperty('telegramWebhookOn');
  Logger.log('🛑 الويبهوك اتقفل — رجعنا للـ polling كل دقيقة');
}

// ===================================================================
// 12) اختبارات — شغّلهم من المحرر قبل ما تعتمد على البوت
// ===================================================================

// 🧪 اختبار (1): بيجرب الردود جوه المحرر — من غير تليجرام ولا ويبهوك ولا Deploy
function testBotNow() {
  const samples = ['اهلا', 'بنادول', 'سعر كاتافلام كام', 'شكرا', 'نقاطي كام'];
  samples.forEach(function(t) {
    Logger.log('────────────────');
    Logger.log('👤 العميل: ' + t);
    var reply;
    try {
      reply = tryLocalReply_(String(PERSONAL_CHAT), t, []);
    } catch (e) {
      reply = '❌ خطأ: ' + e.message;
    }
    Logger.log('🤖 البوت: ' + (reply || '(الرد ده محتاج الذكاء الاصطناعي)'));
  });
  Logger.log('────────────────');
  Logger.log('لو شفت ردود صح فوق ← الكود تمام، المشكلة في التوصيل.');
}

// 🧪 اختبار (2): بيبعتلك رسالة فعلية على تليجرام
function testSendToMe() {
  try {
    sendTelegramStaff('🧪 رسالة اختبار من الاسكربت — لو وصلتك يبقى الإرسال شغال', PERSONAL_CHAT);
    Logger.log('✅ اتبعتت — شوف تليجرام');
  } catch (e) {
    Logger.log('❌ فشل الإرسال: ' + e.message);
  }
}

function testGemini() {
  const result = callGemini('قول مرحبا بجملة قصيرة');
  Logger.log(result ? ('✅ جيميني شغال: ' + result) : '❌ جيميني مش شغال — راجع المفتاح في الـ Logs');
}

function testStockSearch() {
  const tests = ['بنادول', 'بانادول اكسترا', 'كاتافلام', 'البنادول', 'باراسيتامول'];
  tests.forEach(function(q) {
    const r = searchStock(q);
    Logger.log('🔎 "' + q + '" → ' + r.length + ' نتيجة');
    r.slice(0, 3).forEach(function(it) {
      Logger.log('    ' + it.name + ' | ' + it.price + ' ج | رصيد ' + it.stock);
    });
  });
}

function setupStaffTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    const name = t.getHandlerFunction();
    if (['checkStaffOrders', 'checkStaffMessages', 'sendMiddayReport', 'sendNightReport'].includes(name)) {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('checkStaffOrders').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('checkStaffMessages').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('sendNightReport').timeBased().atHour(0).everyDays(1).create();
}

function sendNightReport() {
  try { deduplicateStaffSheet(); } catch(e) { Logger.log('خطأ في التنظيف التلقائي: ' + e.message); }
  const yesterday = new Date(new Date().getTime() - 24 * 60 * 60 * 1000);
  const yDate = Utilities.formatDate(yesterday, 'Africa/Cairo', 'yyyy-MM-dd');
  const yDateStr = Utilities.formatDate(yesterday, 'Africa/Cairo', 'dd/MM/yyyy');
  getReportForDate(yDate, 'ملخص اليوم - ' + yDateStr, STAFF_GROUP);
  const firstOfMonth = yDate.substring(0, 7) + '-01';
  getReportForRange(firstOfMonth, yDate, 'الشهر حتى ' + yDateStr, STAFF_GROUP);
}

var CARE_WEIGHTS = {
  new_customers: 0.35,
  registration: 0.30,
  repeat: 0.20,
  low_returns: 0.15
};

function getConnecteamTimeClocks() {
  const url = 'https://api.connecteam.com/time-clock/v1/time-clocks';
  const res = UrlFetchApp.fetch(url, {
    headers: { 'X-API-KEY': CONNECTEAM_API_KEY },
    muteHttpExceptions: true
  });
  Logger.log(res.getContentText());
}

function connecteamReady_() {
  if (!CONNECTEAM_API_KEY || CONNECTEAM_API_KEY.indexOf('ضع_') === 0) return 'لسه محطتش مفتاح Connecteam API';
  if (!CONNECTEAM_TIME_CLOCK_ID || CONNECTEAM_TIME_CLOCK_ID.indexOf('ضع_') === 0) return 'لسه محطتش Time Clock ID';
  return null;
}

// 🩺 تشخيص شهري — يوم بيوم — بيوريك مبيعات وفواتير كل يوم لوحده في الـ Logs
function diagnoseLastMonthDays() {
  const folder = DriveApp.getFolderById(SALES_FOLDER);
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const first = new Date(y, m - 1, 1), last = new Date(y, m, 0);
  const dayCount = Math.round((last - first) / 86400000) + 1;

  let grandSales = 0, grandReturns = 0, grandInvoices = 0;
  Logger.log('📅 تشخيص ' + Utilities.formatDate(first, 'Africa/Cairo', 'yyyy-MM-dd') + ' → ' + Utilities.formatDate(last, 'Africa/Cairo', 'yyyy-MM-dd'));
  Logger.log('═══════════════════════════════');

  for (let i = 0; i < dayCount; i++) {
    const d = new Date(first.getTime() + i * 86400000);
    const dateStr = Utilities.formatDate(d, 'Africa/Cairo', 'yyyy-MM-dd');

    const salesFiles = folder.getFilesByName('sales' + dateStr + '.txt');
    const hasSales = salesFiles.hasNext();
    const salesContent = hasSales ? salesFiles.next().getBlob().getDataAsString('UTF-8') : '';

    const returnFiles = folder.getFilesByName('Returnsales' + dateStr + '.txt');
    const hasReturns = returnFiles.hasNext();
    const returnsContent = hasReturns ? returnFiles.next().getBlob().getDataAsString('UTF-8') : '';

    if (!hasSales && !hasReturns) {
      Logger.log(dateStr + ' | ⚠️ الملفين مفقودين خالص');
      continue;
    }

    const stats = parseStaffStats(salesContent + '\n' + returnsContent, dateStr);
    let daySales = 0, dayReturns = 0, dayInvoices = 0;
    Object.keys(stats).forEach(function(emp) {
      daySales += stats[emp].sales;
      dayReturns += stats[emp].returns_value;
      dayInvoices += stats[emp].invoices.size;
    });

    grandSales += daySales; grandReturns += dayReturns; grandInvoices += dayInvoices;
    Logger.log(dateStr + ' | فواتير: ' + dayInvoices + ' | مبيعات: ' + Math.round(daySales) +
      ' | مرتجع: ' + Math.round(dayReturns) +
      (hasSales ? '' : ' | ⚠️ sales مفقود') + (hasReturns ? '' : ''));
  }

  Logger.log('═══════════════════════════════');
  Logger.log('📊 الإجمالي: فواتير ' + grandInvoices + ' | مبيعات (قبل المرتجع) ' + Math.round(grandSales) +
    ' | مرتجع ' + Math.round(grandReturns) + ' | صافي ' + Math.round(grandSales - grandReturns));
}

function getHeaderMap(sheet) {
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var map = {};
  header.forEach(function(h, i) { if (h) map[String(h).trim()] = i; });
  return map;
}

function isTruthy(v) {
  return v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1';
}

function getCustomers() {
  var ss = SpreadsheetApp.openById(CRM_SHEET_ID);
  var sheet = ss.getSheetByName('Customers');
  if (!sheet || sheet.getLastRow() <= 1) return [];
  var map = getHeaderMap(sheet);
  var lastCol = sheet.getLastColumn();
  var data = sheet.getRange(2, 1, sheet.getLastRow()-1, lastCol).getValues();

  function g(r, key, def) { return (map[key] !== undefined && r[map[key]] !== '') ? r[map[key]] : def; }

  return data.filter(function(r){ return map['phone'] !== undefined && r[map['phone']]; }).map(function(r){
    return {
      phone: String(g(r,'phone','')),
      name: g(r,'name',''),
      cls: g(r,'cls',''),
      monthly_visits: g(r,'monthly_visits',0),
      monthly_spend: g(r,'monthly_spend',0),
      days_since: g(r,'days_since',null),   /* null = مفيش بيانات، مش "النهاردة" */
      alert_days: g(r,'alert_days',30),
      incentive: g(r,'incentive',0),
      status: g(r,'status',''),
      customer_type: g(r,'customer_type','عرضي'),
      follow_up_count: g(r,'follow_attempts',0),
      last_contact_date: g(r,'contact_marked_at',''),
      is_blocked: isTruthy(g(r,'blocked',false))
    };
  });
}

/* ملف العميل: آخر مشتريات (من فواتير البيع) + الدين الحالي. بيمشي من الأحدث للأقدم ويقف بعد 5 فواتير. */
function getCustomerProfile(phone) {
  try {
    var canon = canonicalEgyptPhone_(phone);
    if (!canon) return { ok: false, error: 'رقم غير صالح' };
    var ck = 'fx_cprof_' + canon;
    var hit = fxCacheGet_(ck);
    if (hit) return hit;

    var folder = DriveApp.getFolderById(SALES_FOLDER);
    var tz = 'Africa/Cairo', today = new Date(), t0 = Date.now();
    var purchases = [], scanned = 0, MAXDAYS = 90;

    for (var i = 0; i < MAXDAYS && purchases.length < 5; i++) {
      if (Date.now() - t0 > 24000) break;   /* حماية من مهلة السكربت */
      var dateStr = Utilities.formatDate(new Date(today.getTime() - i * 86400000), tz, 'yyyy-MM-dd');
      var files = folder.getFilesByName('sales' + dateStr + '.txt');
      if (!files.hasNext()) continue;
      var content = files.next().getBlob().getDataAsString('UTF-8');
      scanned++;
      if (!content || content.indexOf(canon.substring(1)) === -1) continue;   /* فلتر سريع */

      var inv = {}, rx = /VALUES\s*\(((?:&#\d+;|[^;])+)\)/g, m;
      while ((m = rx.exec(content)) !== null) {
        var tuples = extractTuples('(' + m[1] + ')');
        for (var t = 0; t < tuples.length; t++) {
          try {
            var v = parseValues(tuples[t]);
            if (!v || v.length < 50) continue;
            if ((v[2] ? v[2].trim() : '') !== 'sale') continue;
            if (canonicalEgyptPhone_(v[45]) !== canon) continue;
            var id = v[1];
            if (!inv[id]) inv[id] = { date: dateStr, invoice: id, items: [], total: 0 };
            inv[id].items.push({ name: (v[6] ? v[6].trim() : (v[5] ? v[5].trim() : '؟')),
                                 qty: parseFloat(v[7]) || 0 });
            inv[id].total = (parseFloat(v[35]) || 0) + (parseFloat(v[39]) || 0);
          } catch (e) { continue; }
        }
      }
      Object.keys(inv).sort(function (a, b) { return parseInt(b) - parseInt(a); })
        .forEach(function (id) { if (purchases.length < 5) purchases.push(inv[id]); });
    }

    var debt = null;
    try {
      var d = getDebtsSnap();
      (d && d.debtors || []).forEach(function (c) {
        if (canonicalEgyptPhone_(c.phone) === canon) debt = { net: c.net, daysSincePaid: c.daysSincePaid };
      });
    } catch (e2) {}

    var out = { ok: true, phone: canon, purchases: purchases, debt: debt,
                scannedDays: scanned, partial: (Date.now() - t0 > 24000) };
    fxCachePut_(ck, out, 1800);
    return out;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ═══ زيارات العملاء لفترة ═══
   كل يوم فات بيتحسب مرة واحدة ويتحفظ في شيت "زيارات يومية" (التاريخ | JSON {رقم:[فواتير, إنفاق]}).
   الزيارة = يوم فيه فاتورة بيع على رقم العميل. النهاردة بيتحسب لحظي ومش بيتحفظ. */
var VISITS_SHEET = 'زيارات يومية';

function visitDay_(folder, dateStr) {
  var files = folder.getFilesByName('sales' + dateStr + '.txt');
  if (!files.hasNext()) return {};
  var content = files.next().getBlob().getDataAsString('UTF-8');
  if (!content) return {};
  var inv = {}, rx = /VALUES\s*\(((?:&#\d+;|[^;])+)\)/g, m;
  while ((m = rx.exec(content)) !== null) {
    var tuples = extractTuples('(' + m[1] + ')');
    for (var t = 0; t < tuples.length; t++) {
      try {
        var v = parseValues(tuples[t]);
        if (!v || v.length < 50) continue;
        if ((v[2] ? v[2].trim() : '') !== 'sale') continue;
        var ph = canonicalEgyptPhone_(v[45]);
        if (!ph || ph.length < 10) continue;
        inv[v[1]] = { p: ph, s: (parseFloat(v[35]) || 0) + (parseFloat(v[39]) || 0) };
      } catch (e) { continue; }
    }
  }
  var out = {};
  Object.keys(inv).forEach(function (id) {
    var x = inv[id];
    if (!out[x.p]) out[x.p] = [0, 0];
    out[x.p][0]++; out[x.p][1] = Math.round((out[x.p][1] + x.s) * 100) / 100;
  });
  return out;
}

function getCustomerVisits(days) {
  try {
    days = parseInt(days, 10);
    if ([30, 60, 90, 180, 365].indexOf(days) === -1) days = 30;
    var ck = 'fx_cvis_' + days, hit = fxCacheGet_(ck);
    if (hit) return hit;

    var tz = 'Africa/Cairo', t0 = Date.now(), now = new Date();
    var today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    var folder = DriveApp.getFolderById(SALES_FOLDER);
    var sh = getOrCreateSheet_(VISITS_SHEET, ['التاريخ', 'زيارات']);
    sh.getRange('A:A').setNumberFormat('@');
    var stored = {};
    if (sh.getLastRow() > 1) {
      sh.getRange(2, 1, sh.getLastRow() - 1, 2).getDisplayValues().forEach(function (r) {
        try { stored[String(r[0]).substring(0, 10)] = JSON.parse(r[1] || '{}'); } catch (e) {}
      });
    }

    var agg = {}, missing = 0, add = [], from = '';
    function addDay(d, map) {
      Object.keys(map).forEach(function (ph) {
        var a = agg[ph] || (agg[ph] = { v: 0, n: 0, s: 0, l: '' });
        a.v++; a.n += map[ph][0]; a.s += map[ph][1];
        if (d > a.l) a.l = d;
      });
    }
    for (var i = days - 1; i >= 0; i--) {
      var d = Utilities.formatDate(new Date(now.getTime() - i * 86400000), tz, 'yyyy-MM-dd');
      if (!from) from = d;
      if (d === today) { try { addDay(d, visitDay_(folder, d)); } catch (e) {} continue; }
      if (stored[d]) { addDay(d, stored[d]); continue; }
      if (Date.now() - t0 > 22000) { missing++; continue; }   /* الباقي في النداء الجاي */
      var map = {};
      try { map = visitDay_(folder, d); } catch (e) {}
      add.push([d, JSON.stringify(map)]);
      addDay(d, map);
    }
    if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, 2).setValues(add);

    Object.keys(agg).forEach(function (k) { agg[k].s = Math.round(agg[k].s); });
    var out = { ok: true, days: days, from: from, to: today, missingDays: missing, customers: agg };
    if (!missing) fxCachePut_(ck, out, 1800);
    return out;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function getHistory(phone) {
  var ss = SpreadsheetApp.openById(CRM_SHEET_ID);
  var sheet = ss.getSheetByName('History');
  if (!sheet || sheet.getLastRow() <= 1) return [];
  var data = sheet.getRange(2, 1, sheet.getLastRow()-1, 7).getValues();
  return data
    .filter(function(r){return String(r[1]) === String(phone);})
    .map(function(r){return {timestamp:r[0],phone:r[1],name:r[2],type:r[3],text:r[4],result:r[5],note:r[6]};})
    .reverse().slice(0,20);
}

function saveHistory(data) {
  var ss = SpreadsheetApp.openById(CRM_SHEET_ID);
  ss.getSheetByName('History').appendRow([
    new Date().toISOString(), data.phone, data.name, data.type, data.text, data.result, data.note||''
  ]);
  registerFollowUpContact(ss, data.phone, data.result);
}

function registerFollowUpContact(ss, phone, result) {
  var custSheet = ss.getSheetByName('Customers');
  if (!custSheet || custSheet.getLastRow() <= 1) return;
  var map = getHeaderMap(custSheet);
  var lastCol = custSheet.getLastColumn();
  var data = custSheet.getRange(2, 1, custSheet.getLastRow()-1, lastCol).getValues();

  for (var i = 0; i < data.length; i++) {
    if (map['phone'] === undefined || String(data[i][map['phone']]) !== String(phone)) continue;
    var rowIndex = i + 2;
    var status = map['status'] !== undefined ? data[i][map['status']] : '';
    var isBlocked = map['blocked'] !== undefined ? isTruthy(data[i][map['blocked']]) : false;
    if (isBlocked) return;

    if (result === 'bought') {
      if (map['status'] !== undefined) custSheet.getRange(rowIndex, map['status']+1).setValue('نشط');
      if (map['follow_attempts'] !== undefined) custSheet.getRange(rowIndex, map['follow_attempts']+1).setValue(0);
      if (map['contact_marked_at'] !== undefined) custSheet.getRange(rowIndex, map['contact_marked_at']+1).setValue('');
      if (map['follow_deadline'] !== undefined) custSheet.getRange(rowIndex, map['follow_deadline']+1).setValue('');
      return;
    }
    if (status === 'تنبيه' && map['status'] !== undefined) {
      custSheet.getRange(rowIndex, map['status']+1).setValue('تمت المتابعة - في الانتظار');
    }
    if (map['contact_marked_at'] !== undefined) {
      custSheet.getRange(rowIndex, map['contact_marked_at']+1).setValue(new Date().toISOString());
    }
    if (map['follow_attempts'] !== undefined) {
      var cur = parseInt(data[i][map['follow_attempts']]) || 0;
      custSheet.getRange(rowIndex, map['follow_attempts']+1).setValue(cur + 1);
    }
    return;
  }
}

function getBlockedCustomers() {
  var ss = SpreadsheetApp.openById(CRM_SHEET_ID);
  var sheet = ss.getSheetByName('Customers');
  if (!sheet || sheet.getLastRow() <= 1) return [];
  var map = getHeaderMap(sheet);
  var lastCol = sheet.getLastColumn();
  var data = sheet.getRange(2, 1, sheet.getLastRow()-1, lastCol).getValues();
  if (map['blocked'] === undefined) return [];
  return data.filter(function(r){ return isTruthy(r[map['blocked']]); }).map(function(r){
    return {
      phone: String(r[map['phone']]),
      name: r[map['name']],
      cls: r[map['cls']],
      blocked_reason: map['blocked_reason'] !== undefined ? (r[map['blocked_reason']] || '') : ''
    };
  });
}

function setCustomerBlocked(phone, blocked) {
  var ss = SpreadsheetApp.openById(CRM_SHEET_ID);
  var custSheet = ss.getSheetByName('Customers');
  if (!custSheet || custSheet.getLastRow() <= 1) return;
  var map = getHeaderMap(custSheet);
  var lastCol = custSheet.getLastColumn();
  var data = custSheet.getRange(2, 1, custSheet.getLastRow()-1, lastCol).getValues();

  for (var i = 0; i < data.length; i++) {
    if (map['phone'] === undefined || String(data[i][map['phone']]) !== String(phone)) continue;
    var rowIndex = i + 2;
    if (map['blocked'] !== undefined) custSheet.getRange(rowIndex, map['blocked']+1).setValue(blocked);
    if (map['status'] !== undefined) {
      custSheet.getRange(rowIndex, map['status']+1).setValue(blocked ? 'محظور' : 'نشط');
    }
    if (!blocked) {
      if (map['follow_attempts'] !== undefined) custSheet.getRange(rowIndex, map['follow_attempts']+1).setValue(0);
      if (map['contact_marked_at'] !== undefined) custSheet.getRange(rowIndex, map['contact_marked_at']+1).setValue('');
    }
    return;
  }
}

function getDashboard(params) {
  var ss = SpreadsheetApp.openById(CRM_SHEET_ID);
  var custSheet = ss.getSheetByName('Customers');
  var rawSheet = ss.getSheetByName('RawSales');
  var histSheet = ss.getSheetByName('History');

  var fromStr = params.from || Utilities.formatDate(new Date(0), 'Africa/Cairo', 'yyyy-MM-dd');
  var toStr = params.to || Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');
  var from = new Date(fromStr + 'T00:00:00');
  var to = new Date(toStr + 'T23:59:59');

  var rawData = (rawSheet && rawSheet.getLastRow() > 1) ? rawSheet.getRange(2, 1, rawSheet.getLastRow()-1, 6).getValues() : [];
  var customerDates = {};
  rawData.forEach(function(r) {
    var ts = r[0], phone = String(r[1]);
    if (!ts || !phone) return;
    var d = new Date(ts);
    if (isNaN(d.getTime())) return;
    if (!customerDates[phone]) customerDates[phone] = [];
    customerDates[phone].push(d);
  });

  var custMap = custSheet ? getHeaderMap(custSheet) : {};
  var custLastCol = custSheet ? custSheet.getLastColumn() : 0;
  var custData = (custSheet && custSheet.getLastRow() > 1) ? custSheet.getRange(2, 1, custSheet.getLastRow()-1, custLastCol).getValues() : [];
  var newCustomers = 0, purchasing = 0, returnCustomers = 0, lossCustomers = 0;
  var openAlerts = 0, pendingFollowups = 0, failedFollowups = 0, blockedCount = 0;

  custData.forEach(function(r) {
    var phone = String(r[custMap['phone']]);
    var status = r[custMap['status']];
    var alertDays = r[custMap['alert_days']] || 30;
    var followUpCount = r[custMap['follow_attempts']] || 0;
    var isBlocked = custMap['blocked'] !== undefined ? isTruthy(r[custMap['blocked']]) : false;
    var dates = customerDates[phone] || [];
    var inPeriod = dates.filter(function(d){ return d >= from && d <= to; });
    var beforePeriod = dates.filter(function(d){ return d < from; });

    if (inPeriod.length > 0) purchasing++;

    var firstEver = dates.length ? new Date(Math.min.apply(null, dates)) : null;
    if (firstEver && firstEver >= from && firstEver <= to) newCustomers++;

    if (beforePeriod.length > 0 && inPeriod.length > 0) {
      var lastBefore = new Date(Math.max.apply(null, beforePeriod));
      if ((from - lastBefore) / 86400000 > alertDays) returnCustomers++;
    }
    if (beforePeriod.length > 0 && inPeriod.length === 0) {
      var lastAny = new Date(Math.max.apply(null, dates));
      if ((to - lastAny) / 86400000 > alertDays) lossCustomers++;
    }

    if (isBlocked) { blockedCount++; if (followUpCount >= FOLLOWUP_MAX_ATTEMPTS) failedFollowups++; }
    else if (status === 'تنبيه') openAlerts++;
    else if (status === 'تمت المتابعة - في الانتظار') pendingFollowups++;
  });

  var totalActive = custData.length;
  var returnRate = totalActive > 0 ? Math.round(returnCustomers / totalActive * 100) : 0;
  var lossRate = totalActive > 0 ? Math.round(lossCustomers / totalActive * 100) : 0;

  var histData = (histSheet && histSheet.getLastRow() > 1) ? histSheet.getRange(2, 1, histSheet.getLastRow()-1, 7).getValues() : [];
  var commTotal = 0, byType = { wa: 0, call: 0, sms: 0, note: 0 }, bought = 0, responded = 0;
  histData.forEach(function(r) {
    var ts = r[0];
    var d = ts ? new Date(ts) : null;
    if (!d || isNaN(d.getTime()) || d < from || d > to) return;
    commTotal++;
    var type = r[3];
    if (byType[type] !== undefined) byType[type]++;
    var result = r[5];
    if (result === 'bought') { bought++; responded++; }
    else if (result === 'answered' || result === 'later') responded++;
  });
  var responseRate = commTotal > 0 ? Math.round(responded / commTotal * 100) : 0;

  return {
    open_alerts: openAlerts,
    pending_followups: pendingFollowups,
    failed_followups: failedFollowups,
    blocked_count: blockedCount,
    range: { from: fromStr, to: toStr },
    new_customers: newCustomers,
    return_rate: returnRate,
    returning_customers: returnCustomers,
    purchasing_customers_in_range: purchasing,
    loss_rate: lossRate,
    lost_customers: lossCustomers,
    comm: {
      total: commTotal,
      by_type: byType,
      bought: bought,
      response_rate: responseRate
    }
  };
}

/* ═══ 🔄 تحديث السيرفر من زرار في اللوحة ═══
   Claude بيرفع الكود الجديد على Drive بتاعك (ملف خاص — مش على GitHub عشان فيه مفاتيح البوت)،
   والزرار ده بيقراه ويحطه مكان الكود الحالي ويعمل New version على نفس الرابط.
   محتاج مرة واحدة: تشغيل Google Apps Script API من script.google.com/home/usersettings */
var SERVER_SRC_URL = 'https://raw.githubusercontent.com/elsousypharmacy-create/pharmacy/main/server/Code.js';
function serverSrc_() {
  var r = UrlFetchApp.fetch(SERVER_SRC_URL + '?t=' + Date.now(), { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) return null;
  var src = r.getContentText('UTF-8');
  var sig = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, src, Utilities.Charset.UTF_8));
  return { src: src, sig: sig };
}
function serverUpdateInfo() {
  var s = serverSrc_(), P = PropertiesService.getScriptProperties();
  return { ok: true, available: !!s, newer: !!s && P.getProperty('SERVER_SRC_SIG') !== s.sig,
           lastUpdate: P.getProperty('SERVER_UPDATED_AT') || '', autoOn: autoUpdateOn_() };
}
/* 🔁 التحديث التلقائي: كل 15 دقيقة يشوف GitHub — لو فيه نسخة جديدة يركّبها ويبعتلك على تيليجرام */
function autoUpdateOn_() {
  return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'autoServerUpdate'; });
}
function setAutoUpdate(on) {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'autoServerUpdate') ScriptApp.deleteTrigger(t); });
  if (on) ScriptApp.newTrigger('autoServerUpdate').timeBased().everyMinutes(15).create();
  return { ok: true, autoOn: !!on };
}
function autoServerUpdate() {
  var s = serverSrc_(), P = PropertiesService.getScriptProperties();
  if (!s || P.getProperty('SERVER_SRC_SIG') === s.sig) return;
  if (P.getProperty('SERVER_FAILED_SIG') === s.sig) return;          /* النسخة دي فشلت قبل كده — منحاولش كل ربع ساعة */
  var r = serverUpdate();
  if (r && r.ok) {
    P.deleteProperty('SERVER_FAILED_SIG');
    sendTelegramStaff('🔄 السيرفر اتحدّث تلقائي — نسخة ' + r.version + ' (' + r.at + ')', PERSONAL_CHAT);
  } else {
    P.setProperty('SERVER_FAILED_SIG', s.sig);
    sendTelegramStaff('⚠️ التحديث التلقائي للسيرفر فشل:\n' + ((r && r.error) || 'سبب مش معروف') + '\nالنسخة الحالية شغالة عادي.', PERSONAL_CHAT);
  }
}
function serverUpdate() {
  var s = serverSrc_();
  if (!s) return { ok: false, error: 'مقدرتش أوصل للكود الجديد على GitHub' };
  var src = s.src;
  /* فحص أمان: الكود لازم يكون كامل قبل ما نحطه */
  if (src.length < 100000 || src.indexOf('function doGet(') === -1 || src.indexOf('function doPost(') === -1 || src.indexOf('function serverUpdate(') === -1)
    return { ok: false, error: 'الكود على GitHub ناقص أو مش سليم — مش هحدّث' };
  /* المفاتيح لازم تكون متخزنة قبل ما نحط نسخة من غير مفاتيح */
  var P0 = PropertiesService.getScriptProperties();
  if (!P0.getProperty('BOT_TOKEN') || !P0.getProperty('GEMINI_API_KEY')) return { ok: false, error: 'المفاتيح مش متخزنة — مش هحدّث' };
  var token = ScriptApp.getOAuthToken(), id = ScriptApp.getScriptId(), H = { Authorization: 'Bearer ' + token };
  var api = 'https://script.googleapis.com/v1/projects/' + id;
  var r = UrlFetchApp.fetch(api + '/content', { headers: H, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) {
    var msg = r.getContentText();
    var em = ''; try { em = JSON.parse(msg).error.message; } catch (e) { em = msg; }
    return { ok: false, error: (/insufficient|scope/i.test(em) ? 'الصلاحيات الجديدة لسه متوافقش عليها — اعمل New version ووافق. ' : '') +
      'Apps Script API ' + r.getResponseCode() + ': ' + String(em).slice(0, 300) };
  }
  var content = JSON.parse(r.getContentText()), done = false;
  (content.files || []).forEach(function (file) {
    if (!done && file.type === 'SERVER_JS' && String(file.source || '').indexOf('function doGet(') !== -1) { file.source = src; done = true; }
  });
  if (!done) return { ok: false, error: 'مش لاقي ملف الكود الأساسي في المشروع' };
  r = UrlFetchApp.fetch(api + '/content', { method: 'put', contentType: 'application/json', headers: H, muteHttpExceptions: true,
    payload: JSON.stringify({ files: content.files }) });
  if (r.getResponseCode() !== 200) return { ok: false, error: 'حفظ الكود: ' + r.getContentText().slice(0, 200) };
  var stamp = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm');
  r = UrlFetchApp.fetch(api + '/versions', { method: 'post', contentType: 'application/json', headers: H, muteHttpExceptions: true,
    payload: JSON.stringify({ description: 'تحديث من اللوحة ' + stamp }) });
  if (r.getResponseCode() !== 200) return { ok: false, error: 'New version: ' + r.getContentText().slice(0, 200) };
  var ver = JSON.parse(r.getContentText()).versionNumber;
  var depId = (WEB_APP_URL.match(/\/s\/([^/]+)\/exec/) || [])[1];
  r = UrlFetchApp.fetch(api + '/deployments/' + depId, { method: 'put', contentType: 'application/json', headers: H, muteHttpExceptions: true,
    payload: JSON.stringify({ deploymentConfig: { scriptId: id, versionNumber: ver, manifestFileName: 'appsscript', description: 'تحديث من اللوحة ' + stamp } }) });
  if (r.getResponseCode() !== 200) return { ok: false, error: 'Deploy: ' + r.getContentText().slice(0, 200), version: ver };
  var P = PropertiesService.getScriptProperties();
  P.setProperty('SERVER_SRC_SIG', s.sig);
  P.setProperty('SERVER_UPDATED_AT', stamp);
  return { ok: true, version: ver, at: stamp };
}

/* 💬 صفحة المحادثات */
function chatLogRows_(maxRows) {
  var sh = chatLogSheet_(), n = sh.getLastRow() - 1;
  if (n < 1) return [];
  var take = Math.min(n, maxRows || 6000);
  return sh.getRange(sh.getLastRow() - take + 1, 1, take, 6).getDisplayValues();
}
function getBotChats() {
  var rows = chatLogRows_(6000), by = {}, P = PropertiesService.getScriptProperties().getProperties();
  rows.forEach(function (r) {
    var id = r[1]; if (!id) return;
    var c = by[id] || (by[id] = { id: id, name: '', phone: '', count: 0, last: '', lastText: '', lastRole: '' });
    if (r[2]) c.name = r[2]; if (r[3]) c.phone = r[3];
    c.count++;
    if (r[0] >= c.last) { c.last = r[0]; c.lastText = String(r[5]).slice(0, 120); c.lastRole = r[4]; }
  });
  var list = Object.keys(by).map(function (id) {
    var c = by[id]; c.pending = P['escp_' + id] || ''; c.hold = holdOn_(id); return c;
  });
  list.sort(function (a, b) { return (b.pending ? 1 : 0) - (a.pending ? 1 : 0) || (a.last < b.last ? 1 : -1); });
  return { ok: true, chats: list.slice(0, 300) };
}
function getBotChat(id) {
  id = String(id || '');
  var msgs = chatLogRows_(8000).filter(function (r) { return r[1] === id; }).slice(-300)
    .map(function (r) { return { t: r[0], role: r[4], text: r[5] }; });
  var w = chatWho_(id);
  return { ok: true, id: id, name: w.n, phone: w.p, hold: holdOn_(id),
           pending: PropertiesService.getScriptProperties().getProperty('escp_' + id) || '', msgs: msgs };
}
function botReply(id, text) {
  id = String(id || ''); text = String(text || '').trim();
  if (!id || !text) return { ok: false, error: 'الرسالة فاضية' };
  var r = tgApi_('sendMessage', { chat_id: id, text: '👨‍⚕️ رد الصيدلي:\n\n' + text });
  if (!r || !r.ok) return { ok: false, error: 'تيليجرام رفض الرسالة' + (r && r.description ? ': ' + r.description : '') };
  saveConversationTurn(id, '[سؤال محوّل للدكتور]', text, 'pharm');
  PropertiesService.getScriptProperties().deleteProperty('escp_' + id);
  PropertiesService.getScriptProperties().deleteProperty('escmid_' + id);
  return { ok: true };
}
function botHold(id, on) {
  holdSet_(String(id), !!on);
  logChatRows_(id, [['sys', on ? '🤫 الصيدلي مسك المحادثة — البوت ساكت' : '▶️ البوت رجع يرد']]);
  return { ok: true, hold: !!on };
}
function botDone(id) {
  PropertiesService.getScriptProperties().deleteProperty('escp_' + String(id));
  PropertiesService.getScriptProperties().deleteProperty('escmid_' + String(id));
  return { ok: true };
}

/* 🔒 قفل اللوحة (بيتفعّل من الإعدادات): بيانات المبيعات والعملاء والديون محتاجة الرقم السري.
   الصفحات التانية (الملصقات، الجرد، الدكاترة، الطلبيات) والـ SMS والتليجرام مش بتتأثر. */
var LOCKED_GET = { getHomeBundle: 1, getSMSLogFast: 1, getSMSLog: 1, getCustomers: 1, getHistory: 1, getCustomerProfile: 1,
  getCustomerVisits: 1, getAiConfig: 1, getAiUsage: 1, botStatus: 1, getBlocked: 1, getDashboard: 1, getStaffKPI: 1,
  getNewCustomersDetail: 1, getSystemDailyTotals: 1, getDebtsData: 1, getDebtsByEmployee: 1, getMonthTotalsRaw: 1,
  sendDebtReminder: 1, getExpensesData: 1, getProfitLoss: 1, getNetWorth: 1, getConnecteamHours: 1, getDayInvoices: 1,
  getDayDebits: 1, getDayCollections: 1, getMonthDebtsSummary: 1, getCustomerPoints: 1, getInventoryAging: 1, getAgents: 1,
  sendCoupon: 1, getStaffHub: 1, getExpiryByMonth: 1, getAttendanceLive: 1, getAttendanceHistory: 1, getAttendanceLiveV2: 1,
  getAttendanceHistoryV2: 1, diagnoseAll: 1, getBotSettings: 1, maintenanceStatus: 1, maintenanceStop: 1,
  maintenanceResumeLive: 1, maintenanceDedup: 1, maintenanceStartRebuild: 1, backfillExpenses: 1, getExpReviews: 1 };
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
                        purgeTrashedBackups: 1, aiDose: 1, serverUpdate: 1, setAutoUpdate: 1,
                        getBotChats: 1, getBotChat: 1, botReply: 1, botHold: 1, botDone: 1, waInfo: 1, waSubscribe: 1 };
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
  if (action === 'getBotChats') return jsonResponseStaff(getBotChats());
  if (action === 'waInfo') return jsonResponseStaff(waInfo());
  if (action === 'waSubscribe') return jsonResponseStaff(waSubscribe());
  if (action === 'getBotChat') return jsonResponseStaff(getBotChat(e.parameter.id));
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

// شغّلها مرة واحدة عشان تفعّل الإرسال التلقائي الأسبوعي
function setupDebtReminderTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'sendWeeklyDebtReminders') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendWeeklyDebtReminders').timeBased().onWeekDay(ScriptApp.WeekDay.SATURDAY).atHour(11).create();
  Logger.log('✅ التذكير الأسبوعي اتفعّل — هيبعت كل سبت الساعة 11 ص');
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

/* 🔁 طلبات Drive أحيانًا بترجع "خطأ في الخدمة" — نستنى ونعيد بدل ما الحساب كله يقع */
function driveRetry_(fn) {
  for (var i = 0; i < 3; i++) {
    try { return fn(); }
    catch (e) { if (i === 2) throw e; Utilities.sleep(1500 * (i + 1)); }
  }
}

function getDebtsData() {
  try {
    var folder = DriveApp.getFolderById(SALES_FOLDER);
    var tz = 'Africa/Cairo';
    var today = new Date();
    var daysBack = 365;

    /* ═══════════════════════════════════════════════════════════════
       ⚠️ ليه الطريقة دي بالذات؟
       جربنا على البيانات الحقيقية ولقينا إن جمع الديون يوم بيوم
       مستحيل يظبط، لأن فيه أحداث بتغيّر رصيد العميل ومش بتتسجل في
       ملف الديون أصلاً (مرتجعات / تعديلات يدوية على الفواتير).
       مثال حقيقي — طارق بلتاجى 1 أغسطس:
           238.84 + 367 = 605.84  ✓
           605.84 + 522 = 1127.84  ← بس النظام كتب 866.85
           فرق 260.99 حصل من غير أي سطر.

       الحل: كل سطر في الملف بيحمل previousbalance — ده رصيد العميل
       من وجهة نظر النظام نفسه. فلو أخدنا آخر حدث بس لكل عميل:
           رصيده = previousbalance + debit
       الرقم ده بيبلع تلقائيًا أي حاجة فاتت قبله. الطريقة بتصحح نفسها.
       ═══════════════════════════════════════════════════════════════ */

    var latest = {};   // رقم كانوني -> آخر حالة معروفة للعميل

    function remember(phoneRaw, name, balance, when) {
      var canon = canonicalEgyptPhone_(phoneRaw);
      if (!canon) canon = String(phoneRaw || '').trim();   // معرّف داخلي زي "200"
      if (!canon) return;
      var cur = latest[canon];
      if (cur && cur.when > when) return;                  // عندنا أحدث منه
      latest[canon] = {
        phone: canon,
        name: (name && String(name).trim()) ? String(name).trim() : (cur ? cur.name : 'عميل'),
        balance: balance,
        when: when
      };
    }

    var totalNewDebt = 0, totalCollected = 0;

    /* ⚡ قايمة ملفات الديون كلها في طلب واحد بدل 365 طلب (Drive كان بيرفض من كترهم) */
    var idx = {};
    driveRetry_(function () {
      idx = {};
      var it = folder.searchFiles("title contains 'debits' and trashed = false");
      while (it.hasNext()) { var f = it.next(), n = f.getName(); if (!idx[n]) idx[n] = f; }
    });
    /* ملفات الأيام القديمة مش بتتغير — بنحفظها في الكاش 6 ساعات عشان منقراش 365 ملف كل ساعة */
    var cache = CacheService.getScriptCache();
    var recent = Utilities.formatDate(new Date(today.getTime() - 2 * 86400000), tz, 'yyyy-MM-dd');

    for (var i = daysBack - 1; i >= 0; i--) {
      var d = new Date(today.getTime() - i * 86400000);
      var dateStr = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
      var fname = 'debits' + dateStr + '.txt', file = idx[fname];
      if (!file) continue;
      var ck = 'dbt_' + dateStr, content = dateStr < recent ? cache.get(ck) : null;
      if (content === null) {
        content = driveRetry_(function () { return file.getBlob().getDataAsString('UTF-8'); });
        if (dateStr < recent && content && content.length < 90000) { try { cache.put(ck, content, 21600); } catch (eC) {} }
      }
      if (!content) continue;

      var events = [];   // بنجمع كل الأحداث بترتيب ظهورها في الملف

      /* (أ) سطور الدين — بتدينا previousbalance + debit */
      var rx = /VALUES\s*\(((?:&#\d+;|[^;])+)\)/g, m;
      while ((m = rx.exec(content)) !== null) {
        var tuples = extractTuples('(' + m[1] + ')');
        for (var t = 0; t < tuples.length; t++) {
          try {
            var v = parseValues(tuples[t]);
            if (!v || v.length < 16) continue;
            var name  = v[3] ? v[3].trim() : '';
            var phone = v[4] ? v[4].trim() : '';
            if (!phone) continue;
            var when  = (v[5] && String(v[5]).trim()) ? String(v[5]).trim() : (dateStr + ' 00:00:00');
            var debit = parseFloat(v[8]) || 0;
            var prev  = parseFloat(v[15]) || 0;
            totalNewDebt += debit;
            events.push({ pos: m.index + t, phone: phone, name: name,
                          balance: prev + debit, when: when });
          } catch (e) { continue; }
        }
      }

      /* (ب) سطور السداد — "إجمالى الديون بعد" هو الرصيد النهائي
         🔧 شلنا شرط الـ5 خانات: فيه عملاء رقمهم معرّف داخلي قصير
            زي "الحاجة رزقة محمد (200)" و"ام علي صاحب المكان (178)".
            الشرط القديم كان بيتجاهل سدادهم فدينهم ميتصفرش أبدًا. */
      var cpRx = /([^\n(]{2,40})\s*\(([0-9+]{2,})\)\s*[\r\n]+\s*إجمالى الديون قبل\s*([\d.]+)\s*[\r\n]+\s*إجمالى الديون بعد\s*([\d.]+)/g;
      var cp;
      while ((cp = cpRx.exec(content)) !== null) {
        var before = parseFloat(cp[3]) || 0;
        var after  = parseFloat(cp[4]) || 0;
        if (before > after) totalCollected += (before - after);
        events.push({ pos: cp.index, phone: cp[2].trim(), name: cp[1].trim(),
                      balance: after, when: dateStr + ' 23:59:59' });
      }

      /* بنطبّقهم بترتيب ظهورهم في الملف — الأخير هو الصح */
      events.sort(function (a, b) { return a.pos - b.pos; });
      events.forEach(function (ev) { remember(ev.phone, ev.name, ev.balance, ev.when); });
    }

    /* ---- بناء القايمة ---- */
    var list = [], totalNet = 0;
    Object.keys(latest).forEach(function (k) {
      var c = latest[k];
      if (c.balance <= 0.5) return;              // مسدّد (بنتسامح مع كسور القرش)
      var daysSince = Math.floor((today - new Date(c.when.replace(' ', 'T'))) / 86400000);
      list.push({
        name: c.name, phone: c.phone,
        net: Math.round(c.balance * 100) / 100,
        lastActivity: c.when,
        daysSincePaid: isNaN(daysSince) ? null : daysSince,
        status: 'دين غير مسدد'
      });
      totalNet += c.balance;
    });
    list.sort(function (a, b) { return b.net - a.net; });

    /* ---- 🎯 الرقم الرسمي من نظام البيع ---- */
    var official = null, gap = null, gapPct = null;
    try {
      var sys = getSystemDailyTotals();
      if (sys && sys.ok && sys.total_debt) {
        official = Math.round(sys.total_debt);
        gap = Math.round(totalNet) - official;
        gapPct = official ? Math.abs(gap / official * 100) : null;
      }
    } catch (e) {}

    return {
      ok: true,
      debtors: list,
      count: list.length,

      /* الرقم اللي المفروض يتعرض في الكارت الكبير — رسمي ولحظي */
      total_official: official,
      /* مجموع التفاصيل اللي قدرنا نوصلها من الملفات */
      total_detail: Math.round(totalNet),
      /* الفرق بينهم — لو كبير يبقى فيه عملاء آخر حركة ليهم أقدم من سنة */
      reconcile_gap: gap,
      reconcile_pct: gapPct === null ? null : Math.round(gapPct * 10) / 10,
      reconcile_ok: (gapPct === null) ? null : (gapPct <= 5),

      /* حركة السنة (للعرض بس — مش رصيد) */
      period_new_debt: Math.round(totalNewDebt),
      period_collected: Math.round(totalCollected),

      /* أسماء قديمة عشان أي كود تاني يفضل شغال */
      total_net: official !== null ? official : Math.round(totalNet),
      total_owed: Math.round(totalNewDebt),
      total_paid: Math.round(totalCollected),

      source_updated: 'الإجمالي من نظام البيع · التفاصيل من ملفات آخر ' + daysBack + ' يوم'
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}


function getNewCustomersDetail(params) {
  var ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
  var sheet = ss.getSheetByName('سجل العملاء الجدد');
  if (!sheet || sheet.getLastRow() <= 1) return { customers: [] };

  var R = resolveRange_(params);
  var cutoff = R.from, end = R.to;

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
  var out = [];
  data.forEach(function(r) {
    var rDate = r[0] instanceof Date ? Utilities.formatDate(r[0], 'Africa/Cairo', 'yyyy-MM-dd') : String(r[0]).substring(0,10);
    if (rDate < cutoff || rDate > end) return;
    var empName = resolveEmpName(r[1]);
    if (params.employee && empName !== params.employee) return;
    out.push({ date: rDate, employee: empName, name: r[2], phone: String(r[3]) });
  });
  out.sort(function(a,b){ return b.date.localeCompare(a.date); });
  return { customers: out };
}

function getProfitLossData(params) {
  try {
    const now = new Date();
    const monthKey = params.month || Utilities.formatDate(now, 'Africa/Cairo', 'yyyy-MM');
    const cutoff = monthKey + '-01';
    const y = parseInt(monthKey.split('-')[0]), m = parseInt(monthKey.split('-')[1]);
    const lastDayOfMonth = new Date(y, m, 0).getDate();
    let end = monthKey + '-' + String(lastDayOfMonth).padStart(2, '0');
    const today = Utilities.formatDate(now, 'Africa/Cairo', 'yyyy-MM-dd');
    if (end > today) end = today;

    const dailySales = {}, dailyProfit = {};
    const staffSheet = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName('الموظفين');
    if (staffSheet && staffSheet.getLastRow() > 1) {
      const sdata = staffSheet.getRange(2, 1, staffSheet.getLastRow()-1, 15).getValues();
      const bestRow = {};
      sdata.forEach(function(r) {
        if (!r[1] || !r[2]) return;
        const rDate = r[0] instanceof Date ? Utilities.formatDate(r[0], 'Africa/Cairo', 'yyyy-MM-dd') : String(r[0]).substring(0, 10);
        if (rDate < cutoff || rDate > end) return;
        const dk = rDate + '_' + normalizeEmpId(r[1]);
        if (!bestRow[dk] || (parseInt(r[2])||0) > (parseInt(bestRow[dk][2])||0)) bestRow[dk] = r;
      });
      Object.keys(bestRow).forEach(function(dk) {
        const r = bestRow[dk];
        const rDate = r[0] instanceof Date ? Utilities.formatDate(r[0], 'Africa/Cairo', 'yyyy-MM-dd') : String(r[0]).substring(0, 10);
        dailySales[rDate] = (dailySales[rDate] || 0) + (parseInt(r[3]) || 0);
        dailyProfit[rDate] = (dailyProfit[rDate] || 0) + (parseInt(r[14]) || 0);
      });
    }

    /* المصروفات من نفس المصدر الموحّد (ملف Drive + الأرشيف).
       قبل كده كانت بتقرا Monthly_Expenses لوحده — وده فيه يناير بس. */
    const dailyExpenses = {};
    let expStale = null, expLast = '';
    try {
      const all = allExpenses_();
      expStale = all.staleDays;
      expLast = all.latestEntry;
      all.items.forEach(function (e) {
        if (e.date < cutoff || e.date > end) return;
        /* المشتريات مش مصروف تشغيلي — دي بضاعة بتتحول لمخزون */
        if (String(e.category).indexOf('مشتروات') !== -1) return;
        if (String(e.category).indexOf('ايراد') === 0) return;   /* إيراد مش مصروف */
        dailyExpenses[e.date] = (dailyExpenses[e.date] || 0) + e.amount;
      });
    } catch(e) {}

    const props = PropertiesService.getScriptProperties();
    const monthlySalaries = parseFloat(props.getProperty('monthlySalaries_' + monthKey) || '0');
    const dailySalary = monthlySalaries / lastDayOfMonth;

    const allDates = {};
    Object.keys(dailySales).forEach(function(d){ allDates[d] = 1; });
    Object.keys(dailyExpenses).forEach(function(d){ allDates[d] = 1; });

    const days = Object.keys(allDates).sort().map(function(d) {
      const sales = dailySales[d] || 0, profit = dailyProfit[d] || 0, exp = dailyExpenses[d] || 0;
      const net = Math.round(profit - exp - dailySalary);
      return { date: d, sales: sales, profit: profit, expenses: Math.round(exp), salary_share: Math.round(dailySalary), net: net };
    });

    let totalSales = 0, totalProfit = 0, totalExpenses = 0;
    days.forEach(function(d) { totalSales += d.sales; totalProfit += d.profit; totalExpenses += d.expenses; });
    const totalSalariesSoFar = Math.round(dailySalary * days.length);
    const netProfit = Math.round(totalProfit - totalExpenses - totalSalariesSoFar);

    return {
      ok: true, month: monthKey,
      /* تنبيه لو المصروفات باتت — الصافي بيبقى منفوخ من غيرها */
      exp_last_entry: expLast,
      exp_stale_days: expStale,
      exp_stale: (expStale !== null && expStale > 2),
      total_sales: totalSales, total_profit: totalProfit, total_expenses: totalExpenses,
      monthly_salaries: monthlySalaries, daily_salary: Math.round(dailySalary),
      total_salaries_so_far: totalSalariesSoFar,
      net_profit: netProfit,
      days: days
    };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

function setMonthlySalaries(month, amount) {
  PropertiesService.getScriptProperties().setProperty('monthlySalaries_' + month, String(parseFloat(amount) || 0));
}

const NETWORTH_STARTING_DATE = '2026-07-01';
const NETWORTH_STARTING_CASH = 4490;
const NETWORTH_STARTING_INVENTORY = 258887.70;

function getNetWorthData() {
  try {
    const startingTotal = NETWORTH_STARTING_CASH + NETWORTH_STARTING_INVENTORY;
    const now = new Date();
    const today = Utilities.formatDate(now, 'Africa/Cairo', 'yyyy-MM-dd');

    let totalProfit = 0;
    const staffSheet = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName('الموظفين');
    if (staffSheet && staffSheet.getLastRow() > 1) {
      const sdata = staffSheet.getRange(2, 1, staffSheet.getLastRow()-1, 15).getValues();
      const bestRow = {};
      sdata.forEach(function(r) {
        if (!r[1] || !r[2]) return;
        const rDate = r[0] instanceof Date ? Utilities.formatDate(r[0], 'Africa/Cairo', 'yyyy-MM-dd') : String(r[0]).substring(0, 10);
        if (rDate < NETWORTH_STARTING_DATE || rDate > today) return;
        const dk = rDate + '_' + normalizeEmpId(r[1]);
        if (!bestRow[dk] || (parseInt(r[2])||0) > (parseInt(bestRow[dk][2])||0)) bestRow[dk] = r;
      });
      Object.keys(bestRow).forEach(function(dk) {
        totalProfit += (parseInt(bestRow[dk][14]) || 0);
      });
    }

    let totalRealExpenses = 0, totalPurchases = 0;
    try {
      allExpenses_().items.forEach(function (e) {
        if (e.date < NETWORTH_STARTING_DATE || e.date > today) return;
        if (String(e.category).indexOf('ايراد') === 0) return;
        if (String(e.category).indexOf('مشتروات') !== -1) totalPurchases += e.amount;
        else totalRealExpenses += e.amount;
      });
    } catch(e) {}

    const props = PropertiesService.getScriptProperties();
    let totalSalaries = 0;
    let cursor = new Date(NETWORTH_STARTING_DATE + 'T00:00:00');
    const endD = new Date(today + 'T00:00:00');
    while (cursor <= endD) {
      const mKey = Utilities.formatDate(cursor, 'Africa/Cairo', 'yyyy-MM');
      const monthlySalaries = parseFloat(props.getProperty('monthlySalaries_' + mKey) || '0');
      const lastDay = new Date(cursor.getFullYear(), cursor.getMonth()+1, 0).getDate();
      const dailySalary = monthlySalaries / lastDay;
      const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth(), lastDay);
      const rangeStart = monthStart < new Date(NETWORTH_STARTING_DATE + 'T00:00:00') ? new Date(NETWORTH_STARTING_DATE + 'T00:00:00') : monthStart;
      const rangeEnd = monthEnd > endD ? endD : monthEnd;
      const daysInRange = Math.floor((rangeEnd - rangeStart) / 86400000) + 1;
      totalSalaries += dailySalary * Math.max(0, daysInRange);
      cursor = new Date(cursor.getFullYear(), cursor.getMonth()+1, 1);
    }
    totalSalaries = Math.round(totalSalaries);

    let currentInventoryActual = 0;
    try {
      const dss = SpreadsheetApp.openById(DAILY_STATS_SHEET_ID);
      const dsheet = dss.getSheets()[0];
      const ddata = dsheet.getDataRange().getValues();
      const map = {};
      ddata.forEach(function(r){ if (r[0]) map[String(r[0]).trim()] = r[1]; });
      currentInventoryActual = parseFloat(map['اجمالى المخزون تكلفة']) || 0;
    } catch(e) {}

    const estimatedTotal = Math.round(startingTotal + totalProfit - totalRealExpenses - totalSalaries);

    return {
      ok: true,
      starting_date: NETWORTH_STARTING_DATE,
      starting_cash: NETWORTH_STARTING_CASH,
      starting_inventory: NETWORTH_STARTING_INVENTORY,
      starting_total: Math.round(startingTotal),
      total_profit_since_start: totalProfit,
      total_real_expenses_since_start: Math.round(totalRealExpenses),
      total_purchases_since_start: Math.round(totalPurchases),
      total_salaries_since_start: totalSalaries,
      current_inventory_actual: currentInventoryActual,
      estimated_total_now: estimatedTotal,
      change_since_start: estimatedTotal - Math.round(startingTotal)
    };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

/* فحص النسخة الاحتياطية: بيفك آخر pharmaclick_backup ويدوّر على جدول المصروفات.
   الهدف نعرف شكل الجدول عشان نقرا المصروفات منه بدل التصدير اليومي اللي واقف. */
/* فحص النسخة الاحتياطية — بيقرأ النسخة الكاملة (مش _temp) ويعدّ المصروفات شهر بشهر،
   ويبص على جداول الخزنة والتقفيل عشان نعرف المصروفات متسجلة فين بالظبط. */
function sqlTuples_(block) {
  var out = [], depth = 0, cur = '', q = false;
  for (var i = 0; i < block.length; i++) {
    var c = block[i];
    if (q) {
      cur += c;
      if (c === '\\') { cur += block[++i] || ''; continue; }
      if (c === "'") { if (block[i + 1] === "'") { cur += block[++i]; continue; } q = false; }
      continue;
    }
    if (c === "'") { q = true; cur += c; continue; }
    if (c === '(') { depth++; if (depth === 1) { cur = ''; continue; } }
    if (c === ')') { depth--; if (depth === 0) { out.push(cur); continue; } }
    if (depth >= 1) cur += c;
  }
  return out;
}
function sqlVals_(t) {
  var vals = [], cur = '', q = false, wasQ = false;
  for (var i = 0; i < t.length; i++) {
    var c = t[i];
    if (q) {
      if (c === '\\') { cur += t[++i] || ''; continue; }
      if (c === "'") { if (t[i + 1] === "'") { cur += "'"; i++; continue; } q = false; continue; }
      cur += c; continue;
    }
    if (c === "'") { q = true; wasQ = true; continue; }
    if (c === ',') { vals.push(wasQ ? cur : (cur.trim() === 'NULL' ? null : cur.trim())); cur = ''; wasQ = false; continue; }
    cur += c;
  }
  vals.push(wasQ ? cur : (cur.trim() === 'NULL' ? null : cur.trim()));
  return vals;
}
function sqlTableRows_(txt, table) {
  var rx = new RegExp('(?:INSERT|REPLACE)(?:\\s+IGNORE)?\\s+INTO\\s+[`"]?' + table + '[`"]?\\s*(?:\\([^)]*\\)\\s*)?VALUES', 'gi'), m, rows = [], stmts = 0;
  while ((m = rx.exec(txt))) {
    stmts++;
    var start = m.index + m[0].length, end = txt.indexOf(');\n', start);
    if (end === -1) end = txt.indexOf(');', start);
    if (end === -1) break;
    sqlTuples_(txt.substring(start, end + 1)).forEach(function (t) { rows.push(t); });
    rx.lastIndex = end;
  }
  return { stmts: stmts, rows: rows };
}
function sqlColumns_(txt, table) {
  var ct = new RegExp('CREATE TABLE\\s+(?:IF NOT EXISTS\\s+)?[`"]?' + table + '[`"]?\\s*\\(([\\s\\S]*?)\\)\\s*(?:ENGINE|;)', 'i').exec(txt);
  return ct ? (ct[1].match(/^\s*[`"](\w+)[`"]/gm) || []).map(function (c) { return c.replace(/[\s`"]/g, ''); }) : [];
}
function backupProbe() {
  try {
    var it = DriveApp.searchFiles("title contains 'pharmaclick_backup_9882' and trashed = false"), full = null, temp = null;
    while (it.hasNext()) {
      var f = it.next(), isTemp = /_temp\.zip$/i.test(f.getName());
      if (isTemp) { if (!temp || f.getLastUpdated() > temp.getLastUpdated()) temp = f; }
      else if (!full || f.getLastUpdated() > full.getLastUpdated()) full = f;
    }
    var pick = full || temp;
    if (!pick) return { ok: false, error: 'مفيش نسخة احتياطية' };
    var blob = pick.getBlob(); blob.setContentType('application/zip');
    var entries = Utilities.unzip(blob), out = { ok: true, file: pick.getName(), fileDate: pick.getLastUpdated(), tables: {} };
    var watch = ['expenses', 'expensecategories', 'safebankmovements', 'cashwaydetails', 'cashway', 'dailyclose', 'shiftclose', 'printset', 'doselabelstyles'];   /* آخر اتنين: مقاس ملصقات Pharmaclick */
    entries.forEach(function (e) {
      if (!/\.sql$/i.test(e.getName())) return;
      var txt = e.getDataAsString('UTF-8');
      out.sqlSize = txt.length;
      var cnt = 0, p = -1; while ((p = txt.indexOf('INSERT', p + 1)) !== -1) cnt++;
      out.insertWordsInFile = cnt;
      var fe = txt.search(/INTO\s+[`"]?expenses[`"]?\s/i);
      out.firstExpensesInsert = fe === -1 ? null : txt.substr(Math.max(0, fe - 30), 400);
      watch.forEach(function (t) {
        var cols = sqlColumns_(txt, t), r = sqlTableRows_(txt, t), info = { columns: cols.length, statements: r.stmts, rows: r.rows.length };
        var iTime = cols.indexOf('time'), iVal = cols.indexOf('value'), iDel = cols.indexOf('deleted');
        var parsed = r.rows.map(function (x) { try { return sqlVals_(x); } catch (z) { return null; } }).filter(Boolean);
        if (iTime === -1) iTime = cols.indexOf('date');
        if (iTime !== -1) {
          var months = {};
          parsed.forEach(function (v) {
            var mk = String(v[iTime] || '').slice(0, 7); if (!/^\d{4}-\d{2}$/.test(mk)) return;
            var o = months[mk] = months[mk] || { n: 0, sum: 0, deleted: 0 };
            o.n++; if (iVal !== -1) o.sum = Math.round((o.sum + (parseFloat(v[iVal]) || 0)) * 100) / 100;
            if (iDel !== -1 && String(v[iDel]) === '1') o.deleted++;
          });
          var ks = Object.keys(months).sort().slice(-4), mm = {};
          ks.forEach(function (k) { mm[k] = months[k]; });
          info.lastMonths = mm;
        }
        info.last = parsed.slice(-3).map(function (v) {
          var o = {}; cols.forEach(function (c, i) { if (v[i] !== null && v[i] !== '' && v[i] !== '0') o[c] = String(v[i]).slice(0, 60); }); return o;
        });
        out.tables[t] = info;
      });
    });
    return out;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* تنظيف النسخ الاحتياطية لـ Pharmaclick:
   آخر 7 أيام: الكل · لحد 60 يوم: نسخة لكل يوم · الأقدم: نسخة لكل شهر.
   apply=false → حساب بس. apply=true → نقل لسلة المهملات (بيرجع خلال 30 يوم). */
/* قايمة ملفات من Drive API مباشرة: طلب واحد لكل 1000 ملف. (DriveApp كان بيسأل عن اسم/حجم/تاريخ كل ملف لوحده، فالـ25 ثانية كانت بتخلص في القراية
   وبينقل 6 ملفات بس في المرة.) */
function driveListFiles_(q, fields) {
  var tok = ScriptApp.getOAuthToken(), out = [], page = '';
  do {
    var r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files?pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true' +
      '&fields=' + encodeURIComponent('nextPageToken,files(' + fields + ')') + '&q=' + encodeURIComponent(q) +
      (page ? '&pageToken=' + encodeURIComponent(page) : ''), { headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) throw new Error('Drive list ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
    var d = JSON.parse(r.getContentText());
    (d.files || []).forEach(function (x) { out.push(x); });
    page = d.nextPageToken || '';
  } while (page);
  return out;
}
/* طلبات Drive API متوازية (30 في المرة). اللي بيفشل (rate limit مثلًا) بيفضل "فاضل" وبيتعاد في التشغيلة الجاية */
function driveBatch_(ids, t0, budgetMs, make) {
  var tok = ScriptApp.getOAuthToken(), done = 0, okIds = [];
  for (var i = 0; i < ids.length; i += 30) {
    if (Date.now() - t0 > budgetMs) break;
    var chunk = ids.slice(i, i + 30), slow = false;
    var rs = UrlFetchApp.fetchAll(chunk.map(function (id) {
      var q = make(id); q.headers = { Authorization: 'Bearer ' + tok }; q.muteHttpExceptions = true; return q;
    }));
    rs.forEach(function (r, k) {
      var c = r.getResponseCode();
      if (c === 200 || c === 204) { done++; okIds.push(chunk[k]); }
      else if (c === 403 || c === 429) slow = true;
    });
    Utilities.sleep(slow ? 2000 : 250);
  }
  return { done: done, ids: okIds };
}
function cleanBackups(apply, budgetMs) {
  var t0 = Date.now(), tz = 'Africa/Cairo';
  var raw = driveListFiles_("name contains 'pharmaclick_backup_' and trashed = false", 'id,name,createdTime,size');
  var files = [];
  raw.forEach(function (f) {
    var n = f.name || '';
    var m = n.match(/_(\d{2})-(\d{2})-(\d{4})(?:_(\d{2})-(\d{2}))?(_temp)?\.zip$/);
    if (!m) return;
    files.push({ id: f.id, name: n, day: m[3] + '-' + m[2] + '-' + m[1], temp: !!m[6],
                 at: Date.parse(f.createdTime) || 0, size: parseInt(f.size, 10) || 0 });
  });
  var today = new Date(Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd') + 'T00:00:00');
  /* الأحدث الأول — أول واحد في كل مجموعة هو اللي بيتساب */
  files.sort(function (a, b) {
    if (a.temp !== b.temp) return a.temp ? 1 : -1;   /* النسخة اليومية الكاملة أولى من temp */
    return b.at - a.at;
  });
  var keepKey = {}, keep = [], del = [];
  files.forEach(function (x) {
    var age = Math.floor((today - new Date(x.day + 'T00:00:00')) / 86400000);
    var key = age <= 7 ? ('N|' + x.name) : (age <= 60 ? ('D|' + x.day) : ('M|' + x.day.slice(0, 7)));
    if (keepKey[key]) del.push(x); else { keepKey[key] = 1; keep.push(x); }
  });
  var mb = function (arr) { return Math.round(arr.reduce(function (s, x) { return s + x.size; }, 0) / 1048576); };
  var out = { ok: true, total: files.length, keep: keep.length, remove: del.length,
              keepMB: mb(keep), freeMB: mb(del), trashed: 0, remaining: 0 };
  if (apply) {
    var r = driveBatch_(del.map(function (x) { return x.id; }), t0, budgetMs || 25000, function (id) {
      return { url: 'https://www.googleapis.com/drive/v3/files/' + id + '?supportsAllDrives=true', method: 'patch',
               contentType: 'application/json', payload: '{"trashed":true}' };
    });
    out.trashed = r.done;
    out.remaining = del.length - r.done;
  }
  return out;
}
function cleanBackupsDaily() { return cleanBackups(true, 240000); }
/* مسح نهائي للنسخ الاحتياطية (zip) اللي في سلة المهملات بس — مش بيلمس أي حاجة تانية في السلة */
function purgeTrashedBackups() {
  var t0 = Date.now();
  var raw = driveListFiles_("name contains 'pharmaclick_backup_' and trashed = true", 'id,name,size').filter(function (f) { return /\.zip$/i.test(f.name || ''); });
  var size = {}; raw.forEach(function (f) { size[f.id] = parseInt(f.size, 10) || 0; });
  var r = driveBatch_(raw.map(function (f) { return f.id; }), t0, 25000, function (id) {
    return { url: 'https://www.googleapis.com/drive/v3/files/' + id + '?supportsAllDrives=true', method: 'delete' };
  });
  var freed = 0; r.ids.forEach(function (id) { freed += size[id] || 0; });
  return { ok: true, deleted: r.done, remaining: raw.length - r.done, freedMB: Math.round(freed / 1048576) };
}
function cleanBackupsAuto() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'cleanBackupsDaily') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('cleanBackupsDaily').timeBased().everyDays(1).atHour(5).create();
  return { ok: true };
}

function jsonResponseStaff(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

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

    if (!dailyTotals[rowDate]) dailyTotals[rowDate] = { date: rowDate, sales:0, new_c:0, registered:0, total_cust:0 };
    dailyTotals[rowDate].sales      += parseInt(data[i][3]) || 0;
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

function setupCouponExpiryTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'checkExpiredCoupons') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkExpiredCoupons').timeBased().atHour(9).everyDays(1).create();
  Logger.log('✅ فحص انتهاء الكوبونات هيشتغل يوميًا الساعة 9 ص');
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

// ═══════════════════════════════════════════════════════════════════
// ⚡ قسم السرعة والإصلاحات — أغسطس 2026
//
// ١) كاش مقسّم: الكاش القديم كان بيتخزن بس لو الحجم أقل من 95KB،
//    وسجل الرسايل عدّى الرقم ده من شهور، يعني الكاش كان واقف
//    والسيرفر بيقرا 3 شيتات كاملة في كل فتحة.
// ٢) نداء واحد للصفحة الرئيسية بدل 6 (Apps Script بينفّذ طلبات
//    نفس المستخدم واحد ورا التاني، فالستة كانوا بيقفوا في طابور).
// ٣) سجل الرسايل بقى آخر 30 يوم بس بدل من أول يوم.
// ٤) Connecteam: الرد بيجي ملفوف جوه { data: {...} } والكود القديم
//    مكانش بيفكّه، فكان بيرجّع قايمة فاضية دايمًا من غير رسالة خطأ.
// ═══════════════════════════════════════════════════════════════════

// ── كاش مقسّم: بيشتغل مهما كبرت البيانات ──
function fxCacheGet_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var meta = cache.get(key + '_meta');
    if (!meta) return null;
    var count = parseInt(meta, 10);
    var wanted = [];
    for (var i = 0; i < count; i++) wanted.push(key + '_' + i);
    var parts = cache.getAll(wanted);
    var joined = '';
    for (var j = 0; j < count; j++) {
      if (parts[key + '_' + j] === undefined) return null; // جزء ضايع → نحسبها من الأول
      joined += parts[key + '_' + j];
    }
    return joined ? JSON.parse(joined) : null;
  } catch (err) {
    return null;
  }
}

function fxCachePut_(key, value, seconds) {
  try {
    var json = JSON.stringify(value);
    var CHUNK = 90000;
    var count = Math.ceil(json.length / CHUNK);
    if (count > 40) return; // كبير أوي — منخزنش
    var obj = {};
    for (var i = 0; i < count; i++) obj[key + '_' + i] = json.substring(i * CHUNK, (i + 1) * CHUNK);
    var cache = CacheService.getScriptCache();
    cache.putAll(obj, seconds);
    cache.put(key + '_meta', String(count), seconds);
  } catch (err) { /* الكاش مش ضروري */ }
}

function fxClearCache_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var meta = cache.get(key + '_meta');
    if (!meta) return;
    var keys = [key + '_meta'];
    for (var i = 0; i < parseInt(meta, 10); i++) keys.push(key + '_' + i);
    cache.removeAll(keys);
  } catch (err) {}
}

// شغّلها لو عايز تجبر تحديث فوري بعد ما تغيّر حاجة في الشيتات
/* 🆕 بيتنادى من زرار "حدّث دلوقتي" في الداشبورد.
   بيفضّي كاش الأرقام الحية بس — مش بيلمس اللقطة (المخزون/المندوبين)
   عشان الصفحة تفضل سريعة. */
function refreshLiveNumbers() {
  ['fx_home_bundle', 'fx_sms_30'].forEach(fxClearCache_);
  ['today', 'yesterday', 'week', 'month'].forEach(function (r) {
    ['kpi', 'mtr', 'exp'].forEach(function (n) {
      fxClearCache_('fx_c_' + n + '_' + JSON.stringify({ action: 'x', range: r }));
      fxClearCache_('fx_c_' + n + '_' + JSON.stringify({ range: r }));
    });
    fxClearCache_('fx_hub_' + r);
  });
  return { ok: true, at: Utilities.formatDate(new Date(), 'Africa/Cairo', 'HH:mm:ss') };
}

function clearAllFixesCache() {
  ['fx_sms_30', 'fx_home_bundle', 'fx_debts', 'fx_inv_aging', 'ct_users'].forEach(fxClearCache_);
  Logger.log('✅ اتمسح الكاش — أول فتحة جاية هتقرا من الشيتات من جديد');
}


// ═══════════════════════════════════════════════════════════════════
// ١) سجل الرسايل — آخر 30 يوم بس، وبيقرا من آخر الشيت للأول
// ═══════════════════════════════════════════════════════════════════
function getSMSLogFast(params) {
  var days = parseInt((params && params.days) || '30', 10);
  if (isNaN(days) || days < 1) days = 30;
  if (days > 365) days = 365;

  var cacheKey = 'fx_sms_' + days;
  var cached = fxCacheGet_(cacheKey);
  if (cached) { cached.cached = true; return cached; }

  try {
    var tz = 'Africa/Cairo';
    var cutoff = Utilities.formatDate(new Date(Date.now() - days * 86400000), tz, 'yyyy-MM-dd');
    var messages = [];

    function asDate_(v) {
      return (v instanceof Date)
        ? Utilities.formatDate(v, tz, 'yyyy-MM-dd')
        : String(v || '').substring(0, 10);
    }

    // بنقرا من آخر الشيت للأول ونقف أول ما نخرج من المدة — أسرع بكتير
    /* ⚠️ إصلاح: النسخة القديمة كانت بتوقف أول ما تلاقي سطر أقدم من
       المدة — وده بيفترض إن الشيت مرتب بالتاريخ، وهو مش مرتب:
         • تلات شيتات بتتكتب بالتوازي (فواتير + كوبونات + ديون)
         • retrySMS بتعدّل سطور قديمة وترجّعها لآخر الشيت
         • السطر اللي تاريخه فاضي كان بيوقف القراءة فورًا ('' < cutoff)
       النتيجة كانت رسايل بتختفي من السجل من غير ما حد يعرف.

       دلوقتي بنقرا آخر 3000 سطر كاملين وبنفلتر بالتاريخ — من غير
       وقوف مبكر. الشيت مبيوصلش الحجم ده بسرعة، والقراءة دفعة واحدة
       أسرع من دفعات متتالية. */
    function tailRows_(sheet, cols) {
      if (!sheet || sheet.getLastRow() <= 1) return [];
      var last = sheet.getLastRow();
      var MAX = 3000;
      var start = Math.max(2, last - MAX + 1);
      var rows = sheet.getRange(start, 1, last - start + 1, cols).getValues();
      var out = [];
      for (var i = rows.length - 1; i >= 0; i--) {
        var d = asDate_(rows[i][0]);
        if (!d) continue;               /* تاريخ فاضي = نتخطاه مش نوقف */
        if (d < cutoff) continue;       /* بره المدة = نتخطاه مش نوقف */
        out.push(rows[i]);
      }
      return out;
    }

    // (أ) رسايل الفواتير
    tailRows_(getSMSLogSheet_(), 8).forEach(function (r) {
      messages.push({
        type: 'invoice', date: asDate_(r[0]), invoiceid: String(r[1]),
        customername: r[2], phone: String(r[3]), amount: r[4],
        message: r[5], status: r[6], attemptTime: r[7]
      });
    });

    // (ب) رسايل الكوبونات
    tailRows_(getCouponLogSheet_(), 6).forEach(function (r) {
      messages.push({
        type: 'coupon', date: asDate_(r[0]), invoiceid: '',
        customername: r[2], phone: String(r[1]), amount: '',
        message: r[3], status: r[4], attemptTime: r[5]
      });
    });

    // (ج) رسايل تذكير الديون
    tailRows_(getDebtReminderLogSheet_(), 6).forEach(function (r) {
      messages.push({
        type: 'debt', date: asDate_(r[0]), invoiceid: '',
        customername: r[2], phone: String(r[1]), amount: r[3],
        message: 'تذكير سداد: ' + r[3] + ' جنيه', status: r[4], attemptTime: r[5]
      });
    });

    // 🔧 الترتيب بالتاريخ الحقيقي مش بالنص — الصفوف متخزنة بصيغتين مختلفتين
    function ms_(v) {
      if (v instanceof Date) return v.getTime();
      var s = String(v || '').trim();
      if (!s) return 0;
      var t = new Date(s.replace(' ', 'T')).getTime();
      if (!isNaN(t)) return t;
      t = new Date(s).getTime();
      return isNaN(t) ? 0 : t;
    }
    messages.sort(function (a, b) { return ms_(b.attemptTime) - ms_(a.attemptTime); });

    var result = { ok: true, days: days, count: messages.length, messages: messages };
    fxCachePut_(cacheKey, result, 120); // دقيقتين
    return result;
  } catch (err) {
    return { ok: false, error: err.message };
  }
}


// ═══════════════════════════════════════════════════════════════════
// ٢) الصفحة الرئيسية — نداء واحد بدل ٦
// ═══════════════════════════════════════════════════════════════════
function getHomeBundle() {
  var cached = fxCacheGet_('fx_home_bundle');
  if (cached) { cached.cached = true; return cached; }

  function safe_(label, fn) {
    try { return fn(); }
    catch (err) { return { ok: false, error: label + ': ' + err.message }; }
  }

  var out = {
    ok: true,
    daily:       safe_('daily',       function () { return getSystemDailyTotals(); }),
    maintenance: safe_('maintenance', function () { return getMaintenanceStatus(); }),
    attendance:  safe_('attendance',  function () { return getAttendanceLiveV2(); }),
    expiry:      safe_('expiry',      function () { return getExpiryByMonth(); }),
    agents:      safe_('agents',      function () { return getAgentsData(); }),
    debts:       safe_('debts',       function () { return fxDebtsCached_(); }),
    generated:   Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss')
  };

  fxCachePut_('fx_home_bundle', out, 60); // 🔧 كانت ٣ دقايق — قصّرناها عشان رقم النهاردة يوصل بسرعة
  return out;
}

// الديون بتقرا سنة من ملفات Drive — أتقل حاجة في السيستم
function fxDebtsCached_() {
  var cached = fxCacheGet_('fx_debts');
  if (cached) return cached;
  var d = getDebtsData();
  if (d && d.ok) fxCachePut_('fx_debts', d, 600); // ١٠ دقايق
  return d;
}


// ═══════════════════════════════════════════════════════════════════
// ٣) بصمة Connecteam — النسخة المصلّحة
// ═══════════════════════════════════════════════════════════════════

// بيدوّر على مفتاح جوه أي عمق، مهما كان شكل التغليف
function ctFind_(obj, key, depth) {
  depth = depth || 0;
  if (!obj || typeof obj !== 'object' || depth > 6) return null;
  if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  for (var k in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
    var found = ctFind_(obj[k], key, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

function ctCall_(url) {
  // لو Connecteam حظرنا مؤقتًا، مش بنكمّل نداءات — بنستنى المهلة تخلص
  try {
    var until = PropertiesService.getScriptProperties().getProperty('ctBlockedUntil');
    if (until && Date.now() < parseInt(until, 10)) {
      return { ok: false, code: 429,
               error: 'الحضور مؤقتًا مش متاح — Connecteam حاظرنا لكتر الطلبات. هيرجع خلال دقايق.' };
    }
  } catch (e) {}

  var res = UrlFetchApp.fetch(url, {
    headers: { 'X-API-KEY': CONNECTEAM_API_KEY, 'accept': 'application/json' },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var body = res.getContentText();

  if (code === 429) {
    // نوقف كل النداءات ٥ دقايق بدل ما نزوّد الحظر
    try {
      PropertiesService.getScriptProperties()
        .setProperty('ctBlockedUntil', String(Date.now() + 300000));
    } catch (e) {}
    return { ok: false, code: 429,
             error: 'الحضور مؤقتًا مش متاح — Connecteam حاظرنا لكتر الطلبات. هيرجع خلال دقايق.' };
  }
  if (code !== 200) {
    return { ok: false, code: code, error: 'Connecteam رجّع كود ' + code };
  }
  try { return { ok: true, code: code, json: JSON.parse(body) }; }
  catch (err) { return { ok: false, code: code, error: 'الرد مش JSON صالح' }; }
}

// أسماء الموظفين من Connecteam نفسه (كاش ٦ ساعات)
function ctUserMap_() {
  var cached = fxCacheGet_('ct_users');
  if (cached) return cached;

  var map = {};
  try {
    var offset = 0;
    for (var page = 0; page < 10; page++) {
      var r = ctCall_('https://api.connecteam.com/users/v1/users?limit=200&offset=' + offset);
      if (!r.ok) break;
      var users = ctFind_(r.json, 'users');
      if (!users || !users.length) break;
      users.forEach(function (u) {
        var id = String(u.userId || u.id || '');
        if (!id) return;
        var nm = [u.firstName, u.lastName].filter(function (x) { return x; }).join(' ').trim();
        map[id] = nm || u.fullName || u.name || ('موظف ' + id);
      });
      if (users.length < 200) break;
      offset += 200;
    }
  } catch (err) {}

  // أي اسم مكتوب يدوي في CONNECTEAM_USER_MAP بيغلب اللي جاي من الـAPI
  try { for (var k in CONNECTEAM_USER_MAP) map[k] = CONNECTEAM_USER_MAP[k]; } catch (err) {}

  if (Object.keys(map).length) fxCachePut_('ct_users', map, 21600);
  return map;
}

function ctName_(userId, map) {
  var id = String(userId || '');
  return (map && map[id]) ? map[id] : ('موظف ' + id);
}

// بيجيب الشيفتات الخام — بيفكّ التغليف وبيمشي على الصفحات
function ctGetShifts_(from, to) {
  var err = connecteamReady_();
  if (err) return { ok: false, error: err };

  var ck = 'ct_sh_' + from + '_' + to;
  var hit = fxCacheGet_(ck);
  if (hit) return hit;

  var all = [], offset = 0, lastError = '';
  for (var page = 0; page < 20; page++) {
    var url = 'https://api.connecteam.com/time-clock/v1/time-clocks/' + CONNECTEAM_TIME_CLOCK_ID +
      '/time-activities?startDate=' + from + '&endDate=' + to + '&limit=200&offset=' + offset;
    var r = ctCall_(url);
    if (!r.ok) { lastError = r.error; break; }

    var arr = ctFind_(r.json, 'timeActivitiesByUsers') || ctFind_(r.json, 'timeActivities');
    if (!arr || !arr.length) break;

    all = all.concat(arr);
    if (arr.length < 200) break;
    offset += 200;
  }

  if (!all.length && lastError) return { ok: false, error: lastError };
  var out = { ok: true, shifts: all };
  fxCachePut_(ck, out, 600);   // ١٠ دقايق — يمنع تكرار النداء على نفس الفترة
  return out;
}

// النسخة القديمة — سايبينها عشان أي كود تاني بينده عليها
function getConnecteamShifts_(from, to) {
  var r = ctGetShifts_(from, to);
  return r.ok ? r.shifts : [];
}

function ctShiftsOf_(entry) {
  var s = entry.shifts || entry.timeActivities || entry.activities || [];
  return (s && s.length !== undefined) ? s : [];
}

function ctTs_(point) {
  if (!point) return null;
  if (typeof point === 'number') return point;
  if (point.timestamp) return point.timestamp;
  if (point.time) return point.time;
  return null;
}

function getConnecteamHours(from, to) {
  try {
    var r = ctGetShifts_(from, to);
    if (!r.ok) return { ok: false, error: r.error };

    var map = ctUserMap_();
    var hoursByEmployee = {};

    r.shifts.forEach(function (entry) {
      var nm = ctName_(entry.userId, map);
      ctShiftsOf_(entry).forEach(function (sh) {
        var a = ctTs_(sh.start), b = ctTs_(sh.end);
        if (!a || !b) return; // شيفت لسه مفتوح، منحسبوش
        hoursByEmployee[nm] = (hoursByEmployee[nm] || 0) + ((b - a) / 3600);
      });
    });

    return { ok: true, hours: hoursByEmployee };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// مين موجود دلوقتي (شيفت مفتوح: فيه بداية ومفيش نهاية)
function getAttendanceLiveV2() {
  try {
    var today = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');
    var r = ctGetShifts_(today, today);
    if (!r.ok) return { ok: false, error: r.error };

    var map = ctUserMap_();
    var now = Math.floor(Date.now() / 1000);
    var live = [];

    r.shifts.forEach(function (entry) {
      var nm = ctName_(entry.userId, map);
      ctShiftsOf_(entry).forEach(function (sh) {
        var a = ctTs_(sh.start);
        if (!a || ctTs_(sh.end)) return;
        live.push({ name: nm, checkInTimestamp: a, elapsedMinutes: Math.round((now - a) / 60) });
      });
    });

    return { ok: true, live: live, count: live.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// سجل الحضور يوم بيوم
function getAttendanceHistoryV2(params) {
  try {
    params = params || {};
    var now = new Date(), tz = 'Africa/Cairo';
    var from, to, label;

    if (params.from && params.to) {
      from = params.from; to = params.to; label = params.from + ' → ' + params.to;
    } else if (params.range === 'today') {
      from = Utilities.formatDate(now, tz, 'yyyy-MM-dd'); to = from; label = 'اليوم';
    } else if (params.range === 'week') {
      from = Utilities.formatDate(new Date(now.getTime() - 7 * 86400000), tz, 'yyyy-MM-dd');
      to = Utilities.formatDate(now, tz, 'yyyy-MM-dd'); label = 'آخر أسبوع';
    } else if (params.range === 'lastMonth') {
      var y = now.getFullYear(), m = now.getMonth();
      from = Utilities.formatDate(new Date(y, m - 1, 1), tz, 'yyyy-MM-dd');
      to = Utilities.formatDate(new Date(y, m, 0), tz, 'yyyy-MM-dd'); label = 'الشهر اللي فات';
    } else {
      from = Utilities.formatDate(new Date(now.getFullYear(), now.getMonth(), 1), tz, 'yyyy-MM-dd');
      to = Utilities.formatDate(now, tz, 'yyyy-MM-dd'); label = 'الشهر ده';
    }

    var r = ctGetShifts_(from, to);
    if (!r.ok) return { ok: false, error: r.error };

    var map = ctUserMap_();
    var rows = [];

    r.shifts.forEach(function (entry) {
      var nm = ctName_(entry.userId, map);
      ctShiftsOf_(entry).forEach(function (sh) {
        var a = ctTs_(sh.start);
        if (!a) return;
        var b = ctTs_(sh.end);
        var startD = new Date(a * 1000);
        var endD = b ? new Date(b * 1000) : null;
        rows.push({
          date: Utilities.formatDate(startD, tz, 'yyyy-MM-dd'),
          name: nm,
          checkIn: Utilities.formatDate(startD, tz, 'hh:mm a'),
          checkOut: endD ? Utilities.formatDate(endD, tz, 'hh:mm a') : 'مفتوح',
          durationMin: endD ? Math.round((b - a) / 60) : null
        });
      });
    });

    rows.sort(function (x, y) { return x.date.localeCompare(y.date) || x.name.localeCompare(y.name); });
    return { ok: true, label: label, from: from, to: to, rows: rows };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// الأسماء القديمة — سايبينها عشان أي كود قديم يفضل شغال
function getAttendanceLiveStatus() { return getAttendanceLiveV2(); }
function getAttendanceHistoryData(params) { return getAttendanceHistoryV2(params); }


// ═══════════════════════════════════════════════════════════════════
// ٤) الفحص الشامل — بيتنادى من زرار "ابدأ الفحص" في صفحة الصيانة
// ═══════════════════════════════════════════════════════════════════
function diagnoseAll() {
  var out = { ok: true, checks: [] };

  function add(name, ok, detail) {
    out.checks.push({ name: name, ok: !!ok, detail: String(detail || '') });
  }

  // ---- Connecteam ----
  var ready = null;
  try { ready = connecteamReady_(); } catch (err) { ready = err.message; }
  if (ready) {
    add('مفاتيح Connecteam', false, ready);
  } else {
    add('مفاتيح Connecteam', true, 'موجودة');

    var u = ctCall_('https://api.connecteam.com/users/v1/users?limit=5&offset=0');
    if (!u.ok) {
      add('الاتصال بـ Connecteam', false, u.error);
    } else {
      add('الاتصال بـ Connecteam', true, 'كود 200');
      var users = ctFind_(u.json, 'users');
      add('أسماء الموظفين', !!(users && users.length),
        (users && users.length) ? (users.length + ' موظف')
          : ('مفيش مفتاح users — المفاتيح الموجودة: ' + Object.keys(u.json).join(', ')));
    }

    var today = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');
    var monthAgo = Utilities.formatDate(new Date(Date.now() - 30 * 86400000), 'Africa/Cairo', 'yyyy-MM-dd');
    var t = ctCall_('https://api.connecteam.com/time-clock/v1/time-clocks/' + CONNECTEAM_TIME_CLOCK_ID +
      '/time-activities?startDate=' + monthAgo + '&endDate=' + today + '&limit=5&offset=0');
    if (!t.ok) {
      add('قراءة البصمات', false, t.error);
    } else {
      var arr = ctFind_(t.json, 'timeActivitiesByUsers') || ctFind_(t.json, 'timeActivities');
      add('قراءة البصمات', !!arr,
        arr ? ('بصمات لـ ' + arr.length + ' موظف خلال ٣٠ يوم')
            : ('مفيش مفتاح بصمات. المفاتيح: ' + Object.keys(t.json).join(', ') +
               ' | الرد: ' + JSON.stringify(t.json).substring(0, 300)));
      var h = getAttendanceHistoryV2({ range: 'month' });
      add('سجل الحضور النهائي', h.ok && h.rows.length > 0,
        h.ok ? (h.rows.length + ' سطر') : h.error);
    }
  }

  // ---- الشيتات ----
  [['شيت الموظفين', STAFF_SHEET_ID], ['شيت العملاء', CRM_SHEET_ID], ['شيت المخزون', STOCK_SHEET_ID]]
    .forEach(function (pair) {
      try {
        add(pair[0], true, SpreadsheetApp.openById(pair[1]).getName());
      } catch (err) {
        add(pair[0], false, err.message);
      }
    });

  // ---- مجلد المبيعات ----
  try {
    add('مجلد ملفات المبيعات', true, DriveApp.getFolderById(SALES_FOLDER).getName());
  } catch (err) {
    add('مجلد ملفات المبيعات', false, err.message);
  }

  // ---- سرعة الرسايل ----
  try {
    var t0 = new Date().getTime();
    var sms = getSMSLogFast({ days: 30 });
    add('سجل الرسايل (٣٠ يوم)', sms.ok,
      sms.ok ? (sms.count + ' رسالة في ' + (new Date().getTime() - t0) + ' مللي ثانية' +
                (sms.cached ? ' — من الكاش' : '')) : sms.error);
  } catch (err) {
    add('سجل الرسايل', false, err.message);
  }

  // ---- التريجرات ----
  try {
    var liveOn = ScriptApp.getProjectTriggers().some(function (tr) {
      return tr.getHandlerFunction() === 'checkStaffOrders';
    });
    add('تريجر الفواتير الحي', liveOn, liveOn ? 'شغال كل دقيقة' : 'واقف — دوس "شغّل التريجر الحي"');
  } catch (err) {
    add('تريجر الفواتير الحي', false, err.message);
  }

  out.failed = out.checks.filter(function (c) { return !c.ok; }).length;
  return out;
}

// نفس الفحص بس بيطبع في الـLogs — لو حبيت تشغّله من المحرر
function diagnoseAllToLog() {
  var r = diagnoseAll();
  Logger.log('════ فحص شامل — ' + r.failed + ' مشكلة ════');
  r.checks.forEach(function (c) {
    Logger.log((c.ok ? '✅ ' : '❌ ') + c.name + ' — ' + c.detail);
  });
}

// النسخة القديمة من تشخيص Connecteam — بتطبع الرد الخام كامل
function diagnoseConnecteam() {
  var today = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');
  var monthAgo = Utilities.formatDate(new Date(Date.now() - 30 * 86400000), 'Africa/Cairo', 'yyyy-MM-dd');
  var r = ctCall_('https://api.connecteam.com/time-clock/v1/time-clocks/' + CONNECTEAM_TIME_CLOCK_ID +
    '/time-activities?startDate=' + monthAgo + '&endDate=' + today + '&limit=5&offset=0');
  Logger.log('كود الرد: ' + r.code);
  Logger.log('الرد كامل: ' + (r.ok ? JSON.stringify(r.json).substring(0, 3000) : r.error));
}


// ═══════════════════════════════════════════════════════════════════
// 📸 نظام اللقطة (Snapshot) — السبب الحقيقي في السرعة
//
// المشكلة: الداشبورد كان بيحسب كل حاجة وقت ما تفتحه.
//   الديون = قراءة ملفات سنة كاملة من Drive
//   المخزون = مسح شيت STOCK كامل
// والكاش بيخلص كل شوية، فأول واحد يفتح بعده بيدفع التمن كامل.
//
// الحل: تريجر بيشتغل لوحده كل ساعة، بيحسب الحاجات التقيلة دي
// ويحفظ النتيجة في ملفات JSON صغيرة على Drive. الداشبورد بيقرا
// الملف الجاهز بس — فبيفتح في ثانية، دايمًا.
//
// اللي بيفضل لحظي (مش من اللقطة):
//   • مبيعات وربح ودين النهاردة (من Daily_Mini_Statics)
//   • مين موجود دلوقتي (من Connecteam مباشرة)
//   • رسايل العملاء
// ═══════════════════════════════════════════════════════════════════

var SNAPSHOT_SHEET = 'اللقطة';
var SNAP_CHUNK = 45000;   // أقصى حجم للخلية الواحدة في جوجل شيتس ~50 ألف حرف

/* ═══════════════════════════════════════════════════════════════════
   ⚠️ ليه شيت مش Drive؟
   النسخة القديمة كانت بتحفظ اللقطة كملف JSON على Drive عن طريق
   DriveApp.Folder.createFile — ودي محتاجة تصريح الكتابة على Drive
   كامل (auth/drive). التصريح ده مكانش موجود، فالكتابة كانت بترفض
   واللقطة تفضل "لسه متبنيتش" مهما اشتغل التريجر.

   الشيتات السكربت بيكتب فيها أصلاً من غير أي تصريح جديد (شيت
   الموظفين، رسايل SMS، المندوبين...). فحوّلنا اللقطة تتخزن هناك.

   البيانات بتتقسّم على خلايا لأن الخلية الواحدة سقفها ~50 ألف حرف.
   ═══════════════════════════════════════════════════════════════════ */

function snapSheet_() {
  var ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
  var sh = ss.getSheetByName(SNAPSHOT_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SNAPSHOT_SHEET);
    sh.appendRow(['الاسم', 'وقت البناء', 'عدد الأجزاء', 'البيانات']);
    sh.hideSheet();          // مش محتاج تشوفه، ده تخزين داخلي
  }
  return sh;
}

function snapSave_(name, data) {
  var payload = JSON.stringify({
    builtAt: Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss'),
    data: data
  });

  var parts = [];
  for (var i = 0; i < payload.length; i += SNAP_CHUNK) {
    parts.push(payload.substring(i, i + SNAP_CHUNK));
  }
  /* الصف الواحد بياخد 100 عمود بالكتير = ~4.5 مليون حرف.
     لو عدّينا كده يبقى فيه حاجة غلط في البيانات نفسها. */
  if (parts.length > 100) {
    throw new Error('اللقطة كبيرة أوي: ' + Math.round(payload.length / 1024) + ' ك.ب');
  }

  var sh = snapSheet_();
  var last = sh.getLastRow();
  var row = -1;
  if (last > 1) {
    var names = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var r = 0; r < names.length; r++) {
      if (String(names[r][0]) === name) { row = r + 2; break; }
    }
  }
  if (row === -1) row = last + 1;

  /* بنفضّي الصف القديم الأول — لو اللقطة الجديدة أقصر من القديمة،
     الأجزاء الزيادة كانت هتفضل وتلخبط القراءة. */
  sh.getRange(row, 1, 1, sh.getMaxColumns()).clearContent();

  var out = [name,
             Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss'),
             parts.length].concat(parts);
  sh.getRange(row, 1, 1, out.length).setValues([out]);

  return Math.round(payload.length / 1024);   // الحجم بالكيلوبايت
}

function snapLoad_(name) {
  try {
    var cached = fxCacheGet_('snap_' + name);
    if (cached) return cached;

    var sh = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(SNAPSHOT_SHEET);
    if (!sh || sh.getLastRow() <= 1) return null;

    var last = sh.getLastRow();
    var names = sh.getRange(2, 1, last - 1, 1).getValues();
    var row = -1;
    for (var r = 0; r < names.length; r++) {
      if (String(names[r][0]) === name) { row = r + 2; break; }
    }
    if (row === -1) return null;

    var n = parseInt(sh.getRange(row, 3).getValue(), 10);
    if (!n || n < 1) return null;

    var cells = sh.getRange(row, 4, 1, n).getValues()[0];
    var joined = cells.join('');
    if (!joined) return null;

    var parsed = JSON.parse(joined);
    if (!parsed || !parsed.data) return null;

    parsed.data.snapshot_at = parsed.builtAt;
    fxCachePut_('snap_' + name, parsed.data, 900);   // ربع ساعة في الذاكرة كمان
    return parsed.data;
  } catch (e) {
    Logger.log('خطأ snapLoad_ (' + name + '): ' + e.message);
    return null;
  }
}

// ── الدالة اللي التريجر بينده عليها كل ساعة ──
function buildSnapshot() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    Logger.log('⏳ فيه بناء لقطة شغال دلوقتي — سيبناه يكمّل');
    return;
  }

  try {
    var t0 = new Date().getTime();
    var done = [], failed = [];

    /* سجل المصروفات اليومي + أرشفة الملف الحي — كل ساعة مع اللقطة. كل واحدة
       لوحدها عشان فشل واحدة ميوقفش اللقطة. */
    try { recordDailyStats_(); } catch (eS) { Logger.log('خطأ recordDailyStats_: ' + eS.message); }
    try { logShortageSnapshot_(); } catch (eSh) { Logger.log('خطأ سجل النواقص: ' + eSh.message); }
    try {
      var fx = readExpenseFile_();
      if (fx.ok) archiveExpenses_(parseExpenseRows_(fx.rows));
    } catch (eA) { Logger.log('خطأ أرشفة المصروفات: ' + eA.message); }

    /* كل واحدة لوحدها: بنحسب، وبنكتب، وبنسجّل السبب لو وقعت.
       الحساب والكتابة اتنين منفصلين — فشل الكتابة كان بيتخبّى قبل كده. */
    function build(label, key, calc) {
      try {
        var r = calc();
        if (!r || r.ok === false) {
          failed.push(label + ': الحساب رجع ' + ((r && r.error) || 'فاضي'));
          return;
        }
        var kb = snapSave_(key, r);
        done.push(label + ' (' + kb + 'ك.ب)');
      } catch (e) {
        failed.push(label + ': ' + e.message);
      }
    }

    build('الديون',    'debts',     function () { return getDebtsData(); });
    build('المخزون',   'inventory', function () { return getInventoryAging_uncached(); });
    build('المندوبين', 'agents',    function () { return getAgentsData(); });

    // نفضّي الكاش عشان أول فتحة جاية تقرا اللقطة الجديدة
    ['snap_debts', 'snap_inventory', 'snap_agents', 'fx_home_bundle', 'fx_inv_aging', 'fx_debts']
      .forEach(fxClearCache_);

    var secs = Math.round((new Date().getTime() - t0) / 1000);
    var props = PropertiesService.getScriptProperties();
    props.setProperty('lastSnapshotAt',
      Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss') + ' (' + secs + ' ثانية)');
    /* السبب بيتحفظ عشان يظهر في الداشبورد — مش في اللوج بس */
    props.setProperty('lastSnapshotResult',
      (failed.length ? '❌ ' + failed.join(' | ') : '✅ ' + done.join('، ')));

    Logger.log('📸 اللقطة: ' + secs + ' ثانية — نجح: ' + (done.join('، ') || 'ولا حاجة') +
               (failed.length ? ' | فشل: ' + failed.join(' | ') : ''));
    if (failed.length) {
      sendTelegramStaff('⚠️ اللقطة فشلت\n' + SEP + '\n' + failed.join('\n'), PERSONAL_CHAT);
    }
  } finally {
    lock.releaseLock();
  }
}

// ── تشغيل التحديث التلقائي كل ساعة (بيتنادى من زرار في الداشبورد) ──
function setupSnapshotTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'buildSnapshot') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('buildSnapshot').timeBased().everyHours(1).create();
  Logger.log('✅ التحديث التلقائي اشتغل — هيبني لقطة جديدة كل ساعة');
  return { ok: true };
}

function snapshotStatus() {
  var props = PropertiesService.getScriptProperties();
  var on = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'buildSnapshot';
  });
  var names = ['debts', 'inventory', 'agents'];
  var files = names.map(function (n) {
    var s = snapLoad_(n);
    return { name: n, ready: !!s, builtAt: s ? (s.snapshot_at || '') : '' };
  });
  return {
    ok: true,
    triggerOn: on,
    lastRun: props.getProperty('lastSnapshotAt') || '',
    lastResult: props.getProperty('lastSnapshotResult') || '',
    files: files
  };
}

// ── نسخ تقرا اللقطة الأول، ولو مش موجودة بتحسب عادي ──
function getDebtsSnap() {
  var s = snapLoad_('debts');
  if (s) return s;
  return fxDebtsCached_();
}

function getInventorySnap() {
  var s = snapLoad_('inventory');
  if (s) return s;
  return getInventoryAging();
}

function getAgentsSnap() {
  var s = snapLoad_('agents');
  if (s) return s;
  return getAgentsData();
}

function getExpiryByMonthSnap() {
  var inv = getInventorySnap();
  if (!inv || !inv.ok) return { ok: false, error: (inv && inv.error) || 'تعذّر تحليل المخزون' };
  return {
    ok: true,
    generated_date: inv.generated_date,
    snapshot_at: inv.snapshot_at || '',
    expired: inv.expiry_by_month.expired,
    months: inv.expiry_by_month.months
  };
}

// ── الحزمة السريعة للصفحة الرئيسية: لحظي + لقطة ──
function getHomeBundleFast() {
  function safe_(label, fn) {
    try { return fn(); }
    catch (err) { return { ok: false, error: label + ': ' + err.message }; }
  }

  return {
    ok: true,
    // لحظي
    daily:       safe_('daily',       function () { return getSystemDailyTotals(); }),
    attendance:  safe_('attendance',  function () { return getAttendanceLiveV2(); }),
    maintenance: safe_('maintenance', function () { return getMaintenanceStatus(); }),
    // من اللقطة
    expiry:      safe_('expiry',      function () { return getExpiryByMonthSnap(); }),
    agents:      safe_('agents',      function () { return getAgentsSnap(); }),
    debts:       safe_('debts',       function () { return getDebtsSnap(); }),
    generated:   Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss')
  };
}


// ═══════════════════════════════════════════════════════════════════
// 👥 حزمة الموظفين — نداء واحد بدل تلاتة
//
// المشكلة: صفحة الموظفين كانت بتبعت 3 طلبات (حضور مباشر + سجل + أداء)،
// واتنين منهم بيكلموا Connecteam. وApps Script بينفّذ طلبات نفس المستخدم
// واحد ورا التاني، فالمجموع كان بيوصل لدقيقة.
//
// الحل: قراءة واحدة من Connecteam بتغطي الفترة كلها، و"مين موجود دلوقتي"
// بيتحسب من نفس البيانات (الشيفتات المفتوحة النهاردة) بدل نداء تاني.
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// ⚡ كاش عام للنداءات التقيلة اللي مش في اللقطة
// السبب: getMonthTotalsRaw بيقرا شهر كامل من الملفات، وgetProfitLoss
// وgetExpensesData بيقروا شيتات كاملة. من غير كاش، كل فتحة صفحة
// بتعيد الشغل من الأول.
// ═══════════════════════════════════════════════════════════════════
/* 🆕 مدة الكاش بتتحدد حسب الفترة نفسها.
   المشكلة اللي كانت: كل الفترات كانت بكاش 10 دقايق — يعني "اليوم"
   (بيتغير مع كل فاتورة) بياخد نفس معاملة "الشهر اللي فات"
   (بيانات مقفولة مش هتتغير). فلو بعت فاتورة دلوقتي كنت تستنى
   10 دقايق زيادة على تأخير نظام البيع نفسه. */
function cacheTTL_(params) {
  var r = (params && params.range) || 'month';
  if (params && params.from && params.to) return 1800;  // فترة مخصصة = تاريخ ثابت
  if (r === 'today')      return 45;      // أقل حاجة — البيانات حية
  if (r === 'yesterday')  return 900;     // خلصت، بس ممكن مرتجع متأخر
  if (r === 'week')       return 300;
  if (r === 'month')      return 300;     // فيه النهاردة جواه
  if (r === 'lastMonth')  return 3600;    // مقفول خلاص
  return 600;
}

function cachedCall_(name, params, fn, seconds) {
  var key = 'fx_c_' + name + '_' + JSON.stringify(params || {});
  var hit = fxCacheGet_(key);
  if (hit) { hit.cached = true; return hit; }
  var out = fn();
  if (out && out.ok !== false) fxCachePut_(key, out, seconds || 300);
  return out;
}

function getStaffHub(params) {
  try {
    params = params || {};
    var tz = 'Africa/Cairo';
    var now = new Date();
    var today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');

    // مفتاح كاش حسب الفترة المطلوبة
    var ck = 'fx_hub_' + (params.from ? (params.from + '_' + params.to) : (params.range || 'month'));
    var cached = fxCacheGet_(ck);
    if (cached) { cached.cached = true; return cached; }

    // (١) الأداء من شيت الموظفين
    var kpi = {};
    try { kpi = getStaffKPIData(params); } catch (e) { kpi = { employees: [], error: e.message }; }

    // (٢) الفترة المطلوبة للحضور — نفس التفسير بالظبط
    var R = resolveRange_(params);
    var from = R.from, to = R.to, label = R.label;

    // لو الفترة مش شاملة النهاردة، بنمدّها عشان نعرف مين موجود دلوقتي
    var ctTo = (to < today) ? today : to;

    // (٣) قراءة واحدة من Connecteam
    var rows = [], live = [], ctError = null;
    var r = ctGetShifts_(from, ctTo);
    if (!r.ok) {
      ctError = r.error;
    } else {
      var map = ctUserMap_();
      var nowSec = Math.floor(Date.now() / 1000);

      r.shifts.forEach(function (entry) {
        var nm = ctName_(entry.userId, map);
        ctShiftsOf_(entry).forEach(function (sh) {
          var a = ctTs_(sh.start);
          if (!a) return;
          var b = ctTs_(sh.end);
          var startD = new Date(a * 1000);
          var dateStr = Utilities.formatDate(startD, tz, 'yyyy-MM-dd');

          // شيفت مفتوح النهاردة = الراجل موجود دلوقتي
          if (!b && dateStr === today) {
            live.push({ name: nm, checkInTimestamp: a,
                        elapsedMinutes: Math.round((nowSec - a) / 60) });
          }

          // السجل: بس الأيام اللي جوه الفترة المطلوبة
          if (dateStr < from || dateStr > to) return;
          var endD = b ? new Date(b * 1000) : null;
          rows.push({
            date: dateStr,
            name: nm,
            checkIn: Utilities.formatDate(startD, tz, 'hh:mm a'),
            checkOut: endD ? Utilities.formatDate(endD, tz, 'hh:mm a') : 'مفتوح',
            durationMin: endD ? Math.round((b - a) / 60) : null
          });
        });
      });
      rows.sort(function (x, y) { return x.date.localeCompare(y.date) || x.name.localeCompare(y.name); });
    }

    var out = {
      ok: true,
      label: label, from: from, to: to,
      employees: kpi.employees || [],
      daily: kpi.daily || [],
      targets: kpi.targets || TARGETS,
      live: live,
      liveCount: live.length,
      rows: rows,
      attendanceError: ctError
    };

    fxCachePut_(ck, out, 120);   // دقيقتين
    return out;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════
// 📷 الجرد بالكاميرا — نسخة "هاند هيلد"
//
// إزاي اشتغلت الفكرة (اتأكدنا منها من ملصقات حقيقية):
//   • كل علبة عليها ملصق فيه باركود Code128-C = 8 أرقام
//   • الـ8 أرقام دي = عمود "code" في شيت المخزون (مش gtin)
//   • ⚠️ الملصق مفيهوش تاريخ صلاحية — علبتين بصلاحيتين مختلفتين
//     بيلبسوا نفس الملصق بالظبط. فالماسحة بتعرف الصنف مش الدفعة.
//
// عشان كده: الموظف يعدّي بسرعة، والشاشة توقف بس لو الصنف له أكتر
// من صلاحية مسجلة — ساعتها يوزّع الكمية بنفسه.
//
// 🔒 الجرد بيطلع تقرير بس — مبيكتبش أي حاجة في المخزون.
// ═══════════════════════════════════════════════════════════════════

var COUNT_SESSIONS_SHEET = 'جلسات الجرد';
var COUNT_LINES_SHEET    = 'سطور الجرد';

/* خريطة {كود الصيدلية: الصنف} — الأساس اللي الماسحة بتشتغل عليه.
   كاش نص ساعة: المخزون مبيتغيرش بالسرعة دي والجرد بياخد ساعات. */
function scanIndex_() {
  var hit = fxCacheGet_('fx_scan_index');
  if (hit) return hit;

  var sh = SpreadsheetApp.openById(STOCK_SHEET_ID).getSheets()[0];
  if (!sh || sh.getLastRow() <= 1) return {};
  var lastCol = sh.getLastColumn();
  var hdr = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  var ix = {};
  hdr.forEach(function (h, i) { ix[String(h || '').trim().toLowerCase()] = i; });
  if (ix['code'] === undefined) return {};
  var hasUnits = ix['units'] !== undefined;

  /* getDisplayValues مش getValues — عشان الأكواد متتحولش لأرقام
     وتتكسر بفواصل الآلاف زي ما حصل مع gtin. */
  var d = sh.getRange(2, 1, sh.getLastRow() - 1, lastCol).getDisplayValues();
  var map = {};

  d.forEach(function (r) {
    var code = String(r[ix['code']] || '').replace(/[^\d]/g, '');
    if (!code) return;

    var stock = parseFloat(String(r[ix['stock']]).replace(/,/g, '')) || 0;
    var price = parseFloat(String(r[ix['price']]).replace(/,/g, '')) || 0;

    /* الدفعات: multistock و multiexpire قوايم متوازية مفصولة بفاصلة */
    var batches = [];
    var mEx = String(r[ix['multiexpire']] || '').trim();
    var mSt = String(r[ix['multistock']]  || '').trim();
    if (mEx) {
      var ex = mEx.split(','), st = mSt ? mSt.split(',') : [];
      for (var i = 0; i < ex.length; i++) {
        var e = String(ex[i]).trim();
        if (!e || e === '0') continue;
        batches.push({ expire: e.substring(0, 10),
                       stock: parseFloat(String(st[i] || '').trim()) || 0 });
      }
    }
    if (!batches.length) {
      var one = String(r[ix['expire']] || '').trim().substring(0, 10);
      batches.push({ expire: (one && one !== '0') ? one : '', stock: stock });
    }

    /* عدد الأجزاء في العلبة (شرايط/أكياس/أمبولات).
       الرصيد متخزن بالعلبة، فـ0.9 في صنف units=10 معناها 9 أكياس.
       الموظف بيعدّ بالجزء والنظام بيحوّل — أنضف من إنه يكتب كسور. */
    var units = hasUnits
      ? (parseFloat(String(r[ix['units']] || '').replace(/,/g, '')) || 1) : 1;
    if (units < 1) units = 1;

    map[code] = {
      code: code,
      name: invCleanName_(r[ix['namear']]) || invCleanName_(r[ix['nameen']]) || 'صنف',
      price: price,
      stock: stock,
      units: units,
      cat: String(r[ix['category']] || '').trim(),
      batches: batches,
      multi: batches.length > 1        // ← ده اللي بيخلي الشاشة توقف
    };
  });

  fxCachePut_('fx_scan_index', map, 1800);
  return map;
}

function refreshScanIndex() {
  fxClearCache_('fx_scan_index');
  var m = scanIndex_();
  var n = Object.keys(m).length, multi = 0;
  Object.keys(m).forEach(function (k) { if (m[k].multi) multi++; });
  Logger.log('✅ اتحدّثت: ' + n + ' صنف · ' + multi + ' منهم بأكتر من صلاحية');
  return { ok: true, items: n, multi: multi };
}

/* بحث بالكود — بيتنادى مع كل مسحة */
function scanLookup(code) {
  try {
    var c = String(code || '').replace(/[^\d]/g, '');
    if (!c) return { ok: false, error: 'كود فاضي' };
    var m = scanIndex_();
    var it = m[c];
    if (!it) {
      /* أحيانًا الماسحة بتزود صفر في الأول أو تشيله */
      it = m[c.replace(/^0+/, '')] || m['0' + c];
    }
    if (!it) return { ok: true, found: false, code: c };
    return { ok: true, found: true, item: it };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* بحث بالاسم — للأصناف اللي ملصقها ضايع أو مقروش */
function scanSearch(q) {
  try {
    var needle = normalizeArabic(q || '');
    if (needle.length < 2) return { ok: true, results: [] };
    var m = scanIndex_(), out = [];
    Object.keys(m).forEach(function (k) {
      if (out.length >= 25) return;
      if (normalizeArabic(m[k].name).indexOf(needle) !== -1) out.push(m[k]);
    });
    return { ok: true, results: out };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════
// 🩺 بحث الدكاترة في المخزون — صفحة doctors.html
//
// • كل دكتور له كود خاص في شيت "الدكاترة" (كود | الاسم | التخصص | فعّال | آخر دخول).
//   إضافة دكتور = سطر جديد. إيقافه = اكتب "لا" في عمود فعّال.
// • بيرجّع بس: الاسم · المادة الفعالة · التصنيف · السعر · الحالة. مفيش تكلفة ولا كميات.
// • بحث تقريبي: لو في غلطة إملائية بيدوّر على أقرب أسماء.
// • الدكتور يقدر يجمّع أصناف في قائمة ويبعتها → شيت "طلبات الدكاترة" + تليجرام.
// • أي بحث مفيهوش صنف متوفر بيتسجل في شيت "بحث الدكاترة".
// ═══════════════════════════════════════════════════════════════════
var DOCTORS_SHEET = 'الدكاترة';
var DOCTOR_LOG_SHEET = 'بحث الدكاترة';
var DOCTOR_ORDERS_SHEET = 'طلبات الدكاترة';

function doctorNorm_(s) {
  return normalizeArabic(String(s || '')).toLowerCase().replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim();
}

/* بيرجّع {name, spec, row} للدكتور أو null. الكاش 5 دقايق. */
function doctorAuth_(key, touch) {
  var k = String(key || '').trim().toUpperCase();
  if (!k) return null;
  var cache = CacheService.getScriptCache();
  var map = null;
  try { var raw = cache.get('doc_map'); if (raw) map = JSON.parse(raw); } catch (e) {}
  if (!map) {
    map = {};
    var sh = getOrCreateSheet_(DOCTORS_SHEET, ['الكود', 'الاسم', 'التخصص', 'فعّال', 'آخر دخول']);
    var d = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 4).getDisplayValues() : [];
    d.forEach(function (r, i) {
      var c = String(r[0] || '').trim();
      if (!c || /^(لا|no|n|0|false)$/i.test(String(r[3] || '').trim())) return;
      map[c.toUpperCase()] = { name: String(r[1] || '').trim() || 'دكتور', spec: String(r[2] || '').trim(), row: i + 2 };
    });
    cache.put('doc_map', JSON.stringify(map), 300);
  }
  var doc = map[k];
  if (!doc) return null;
  if (touch) {
    try {
      getOrCreateSheet_(DOCTORS_SHEET, []).getRange(doc.row, 5)
        .setValue(Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm'));
    } catch (e) {}
  }
  return doc;
}

function doctorGate_(key, touch) {
  var cache = CacheService.getScriptCache();
  var fails = parseInt(cache.get('doc_fail') || '0', 10);
  if (fails >= 40) return { err: { ok: false, error: 'locked', msg: 'محاولات كتير — جرّب بعد شوية' } };
  var doc = doctorAuth_(key, touch);
  if (!doc) {
    cache.put('doc_fail', String(fails + 1), 600);
    return { err: { ok: false, error: 'bad_code', msg: 'الكود غلط' } };
  }
  return { doc: doc };
}

function doctorIndex_() {
  var hit = fxCacheGet_('fx_doc_index');
  if (hit) return hit;
  var sh = SpreadsheetApp.openById(STOCK_SHEET_ID).getSheets()[0];
  if (!sh || sh.getLastRow() <= 1) return [];
  var lastCol = sh.getLastColumn();
  var hdr = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  var ix = {};
  hdr.forEach(function (h, i) { ix[String(h || '').trim().toLowerCase()] = i; });
  var d = sh.getRange(2, 1, sh.getLastRow() - 1, lastCol).getDisplayValues();
  var out = [];
  d.forEach(function (r) {
    var name = invCleanName_(r[ix['namear']]) || invCleanName_(r[ix['nameen']]);
    if (!name) return;
    var en = invCleanName_(r[ix['nameen']]) || '';
    var active = String(r[ix['activecomponent']] || '').trim();
    var stock = parseFloat(String(r[ix['stock']]).replace(/,/g, '')) || 0;
    var price = parseFloat(String(r[ix['price']]).replace(/,/g, '')) || 0;
    out.push({
      n: name, e: en, a: active, c: String(r[ix['category']] || '').trim(),
      p: price, s: stock,
      h: doctorNorm_(name + ' ' + en + ' ' + active),
      k: doctorNorm_(active).replace(/[^a-z؀-ۿ+ ]/g, '').trim()
    });
  });
  fxCachePut_('fx_doc_index', out, 1800);
  return out;
}

function doctorStatus_(stock) {
  if (stock <= 0) return 'out';
  if (stock < 2) return 'low';
  return 'ok';
}

/* مسافة التعديل بين كلمتين (بتقف بدري لو عدّت الحد) */
function doctorLev_(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  var prev = [], cur = [], i, j;
  for (j = 0; j <= b.length; j++) prev[j] = j;
  for (i = 1; i <= a.length; i++) {
    cur = [i];
    var rowMin = i;
    for (j = 1; j <= b.length; j++) {
      var c = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/* درجة التقارب لصنف: مجموع أصغر مسافة لكل كلمة بحث. null = بعيد */
function doctorFuzzyScore_(it, toks) {
  var words = it.h.split(' '), total = 0;
  for (var t = 0; t < toks.length; t++) {
    var tk = toks[t], allow = tk.length >= 7 ? 2 : (tk.length >= 4 ? 1 : 0), best = 99;
    if (it.h.indexOf(tk) !== -1) { best = 0; }
    else if (allow) {
      for (var w = 0; w < words.length && best > 0; w++) {
        var wd = words[w];
        if (!wd) continue;
        best = Math.min(best, doctorLev_(tk, wd, allow), doctorLev_(tk, wd.substring(0, tk.length), allow));
      }
    }
    if (best > allow) return null;
    total += best;
  }
  return total;
}

function doctorSearch(q, key) {
  try {
    var g = doctorGate_(key, q === '__check');
    if (g.err) return g.err;
    if (q === '__check') return { ok: true, results: [], doctor: g.doc.name, spec: g.doc.spec };
    var needle = doctorNorm_(q);
    if (needle.length < 2) return { ok: true, results: [] };
    var toks = needle.split(' ').filter(Boolean);
    var idx = doctorIndex_();
    var exact = idx.filter(function (it) {
      return toks.every(function (t) { return it.h.indexOf(t) !== -1; });
    });
    var sorter = function (a, b) {
      var sa = a.s > 0 ? 0 : 1, sb = b.s > 0 ? 0 : 1;
      return sa - sb || (a.n < b.n ? -1 : 1);
    };
    exact.sort(sorter);
    var hits = exact, fuzzy = false;
    if (exact.length < 5) {
      var seen = {}, extra = [];
      exact.forEach(function (it) { seen[it.n + '|' + it.p] = 1; });
      idx.forEach(function (it) {
        if (seen[it.n + '|' + it.p]) return;
        var sc = doctorFuzzyScore_(it, toks);
        if (sc !== null) extra.push({ it: it, sc: sc });
      });
      extra.sort(function (a, b) { return a.sc - b.sc || sorter(a.it, b.it); });
      if (extra.length) {
        fuzzy = !exact.length;
        hits = exact.concat(extra.slice(0, 15).map(function (x) { return x.it; }));
      }
    }
    var total = hits.length;
    hits = hits.slice(0, 40);
    var results = hits.map(function (it) {
      var st = doctorStatus_(it.s), alts = [];
      if (st === 'out' && it.k) {
        for (var i = 0; i < idx.length && alts.length < 3; i++) {
          var o = idx[i];
          if (o !== it && o.s > 0 && o.k === it.k) alts.push({ n: o.n, p: o.p, st: doctorStatus_(o.s) });
        }
      }
      return { n: it.n, e: it.e, a: it.a, c: it.c, p: it.p, st: st, alts: alts };
    });
    var anyAvail = results.some(function (r) { return r.st !== 'out'; });
    if (!anyAvail) {
      try {
        var lg = getOrCreateSheet_(DOCTOR_LOG_SHEET, ['التاريخ', 'الدكتور', 'البحث', 'النتيجة']);
        lg.appendRow([Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm'), g.doc.name,
                      String(q).substring(0, 80), total ? 'غير متوفر' : 'مش في المخزون']);
      } catch (e2) {}
    }
    return { ok: true, results: results, total: total, fuzzy: fuzzy };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* الدكتور بيبعت قائمة أصناف للصيدلية. items = JSON [{n, q}] */
function doctorOrder(itemsJson, note, key) {
  try {
    var g = doctorGate_(key, false);
    if (g.err) return g.err;
    var items = JSON.parse(itemsJson || '[]');
    if (!Array.isArray(items) || !items.length) return { ok: false, msg: 'القائمة فاضية' };
    items = items.slice(0, 30).map(function (x) {
      return { n: String(x.n || '').substring(0, 80), q: Math.max(1, Math.min(99, parseInt(x.q, 10) || 1)) };
    });
    var cache = CacheService.getScriptCache();
    var ck = 'doc_ord_' + g.doc.row;
    var cnt = parseInt(cache.get(ck) || '0', 10);
    if (cnt >= 10) return { ok: false, msg: 'وصلت الحد المسموح، كلّم الصيدلية' };
    cache.put(ck, String(cnt + 1), 3600);

    var text = items.map(function (x) { return x.n + ' × ' + x.q; }).join('\n');
    var nt = String(note || '').substring(0, 300);
    var stamp = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm');
    getOrCreateSheet_(DOCTOR_ORDERS_SHEET, ['التاريخ', 'الدكتور', 'الأصناف', 'ملاحظة', 'الحالة'])
      .appendRow([stamp, g.doc.name, text, nt, 'جديد']);
    try {
      /* حالة كل صنف دلوقتي في المخزون عشان الفريق يعرف يجهّز إيه */
      var st = {};
      try { doctorIndex_().forEach(function (it) { st[it.n] = it.s; }); } catch (e4) {}
      var lines = items.map(function (x) {
        var sv = st[x.n];
        var mark = sv === undefined ? '' : (sv > 0 ? '✅ ' : '❌ ');
        return mark + x.n + ' × ' + x.q;
      }).join('\n');
      var msg = '🩺 طلب جديد من د. ' + g.doc.name + (g.doc.spec ? ' (' + g.doc.spec + ')' : '') +
        '\n' + lines + (nt ? '\n📝 ' + nt : '') + '\n\n✅ متوفر · ❌ غير متوفر';
      sendTelegramStaff(msg, STAFF_GROUP);
      sendTelegramStaff(msg, PERSONAL_CHAT);
    } catch (e3) {}
    return { ok: true };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
}


/* ===== إدارة الدكاترة من الداشبورد (تبويب "دكاترة") ===== */
function doctorGenCode_() {
  var ch = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', c = 'D';
  for (var i = 0; i < 5; i++) c += ch.charAt(Math.floor(Math.random() * ch.length));
  return c;
}

function doctorAdmin(p) {
  try {
    var op = String(p.op || 'list');
    var sh = getOrCreateSheet_(DOCTORS_SHEET, ['الكود', 'الاسم', 'التخصص', 'فعّال', 'آخر دخول']);
    var cache = CacheService.getScriptCache();
    var rowNo = parseInt(p.row, 10) || 0;

    if (op === 'add') {
      var name = String(p.name || '').trim();
      if (!name) return { ok: false, msg: 'اكتب اسم الدكتور' };
      var code = String(p.code || '').trim().toUpperCase().replace(/\s+/g, '');
      var used = sh.getLastRow() > 1
        ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues().map(function (r) { return String(r[0]).trim().toUpperCase(); })
        : [];
      if (!code) { do { code = doctorGenCode_(); } while (used.indexOf(code) !== -1); }
      else if (used.indexOf(code) !== -1) return { ok: false, msg: 'الكود ده مستخدم، اختار غيره' };
      sh.appendRow([code, name, String(p.spec || '').trim(), 'نعم', '']);
      cache.remove('doc_map');
      return { ok: true, code: code };
    }
    if (op === 'toggle') {
      if (rowNo < 2 || rowNo > sh.getLastRow()) return { ok: false, msg: 'سطر غلط' };
      var cur = String(sh.getRange(rowNo, 4).getDisplayValue()).trim();
      var off = /^(لا|no|n|0|false)$/i.test(cur);
      sh.getRange(rowNo, 4).setValue(off ? 'نعم' : 'لا');
      cache.remove('doc_map');
      return { ok: true, active: off };
    }
    if (op === 'done') {
      var osh = getOrCreateSheet_(DOCTOR_ORDERS_SHEET, ['التاريخ', 'الدكتور', 'الأصناف', 'ملاحظة', 'الحالة']);
      if (rowNo < 2 || rowNo > osh.getLastRow()) return { ok: false, msg: 'سطر غلط' };
      osh.getRange(rowNo, 5).setValue('تم');
      return { ok: true };
    }

    /* list */
    var docs = [];
    if (sh.getLastRow() > 1) {
      sh.getRange(2, 1, sh.getLastRow() - 1, 5).getDisplayValues().forEach(function (r, i) {
        if (!String(r[0]).trim()) return;
        docs.push({ row: i + 2, code: String(r[0]).trim(), name: r[1], spec: r[2],
                    active: !/^(لا|no|n|0|false)$/i.test(String(r[3]).trim()), last: r[4] });
      });
    }
    var orders = [];
    var osh2 = getOrCreateSheet_(DOCTOR_ORDERS_SHEET, ['التاريخ', 'الدكتور', 'الأصناف', 'ملاحظة', 'الحالة']);
    var on = osh2.getLastRow() - 1;
    if (on > 0) {
      var from = Math.max(2, osh2.getLastRow() - 39);
      osh2.getRange(from, 1, osh2.getLastRow() - from + 1, 5).getDisplayValues().forEach(function (r, i) {
        orders.push({ row: from + i, at: r[0], doctor: r[1], items: r[2], note: r[3], status: r[4] });
      });
      orders.reverse();
    }
    var misses = [];
    var lsh = getOrCreateSheet_(DOCTOR_LOG_SHEET, ['التاريخ', 'الدكتور', 'البحث', 'النتيجة']);
    if (lsh.getLastRow() > 1) {
      var lf = Math.max(2, lsh.getLastRow() - 299), agg = {};
      lsh.getRange(lf, 1, lsh.getLastRow() - lf + 1, 4).getDisplayValues().forEach(function (r) {
        var k = doctorNorm_(r[2]); if (!k) return;
        var o = agg[k] || (agg[k] = { q: r[2], n: 0, last: '', result: r[3], doctors: {} });
        o.n++; o.last = r[0]; o.result = r[3]; if (r[1]) o.doctors[r[1]] = 1;
      });
      misses = Object.keys(agg).map(function (k) {
        var o = agg[k]; return { q: o.q, n: o.n, last: o.last, result: o.result, doctors: Object.keys(o.doctors).length };
      }).sort(function (a, b) { return b.n - a.n; }).slice(0, 20);
    }
    return { ok: true, doctors: docs, orders: orders, misses: misses };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════
// 🛒 صفحة طلب النواقص لوحدها — orders.html (من غير كود دخول)
//
// صفحة منفصلة للموظف بتعرض النواقص مجمّعة بالشركة وبس: من غير أي حاجة
// من الداشبورد (مبيعات، ديون، مصروفات). مفيش أسعار ولا تكلفة.
// ═══════════════════════════════════════════════════════════════════
/* متوسط بيع الصنف اليومي (بالعلبة) من ملفات المبيعات آخر 30 يوم.
   كل سطر في الملف = صنف في فاتورة: qty بالعلبة (0.33 = 1 من 3 أمبولات). المرتجع بيتخصم.
   بيرجّع {byCode, byDrug, byName, days} — الكاش 6 ساعات. */
function salesVelocity_() {
  var hit = fxCacheGet_('fx_sales_vel2');
  if (hit) return hit;
  var byCode = {}, byDrug = {}, byName = {}, daysWith = 0, rev = 0;
  var folder = DriveApp.getFolderById(SALES_FOLDER), now = new Date();
  for (var back = 0; back < 30; back++) {
    var ds = Utilities.formatDate(new Date(now.getTime() - back * 86400000), 'Africa/Cairo', 'yyyy-MM-dd');
    var files = folder.getFilesByName('sales' + ds + '.txt');
    if (!files.hasNext()) continue;
    var content = files.next().getBlob().getDataAsString('UTF-8');
    if (!content) continue;
    daysWith++;
    var re = /VALUES\s*\(((?:&#\d+;|[^;])+)\)/g, m;
    while ((m = re.exec(content)) !== null) {
      var tuples = extractTuples('(' + m[1] + ')');
      for (var t = 0; t < tuples.length; t++) {
        try {
          var v = parseValues(tuples[t]);
          if (!v || v.length < 54) continue;
          var type = String(v[2]).trim();
          if (type !== 'sale' && type !== 'return') continue;
          var q = parseFloat(v[7]) || 0; if (type === 'return') q = -q;
          rev += (parseFloat(v[52]) || 0) * (type === 'return' ? -1 : 1);
          var code = String(v[16] || '').replace(/[^\d]/g, ''), drug = String(v[4] || '').trim();
          var nm = doctorNorm_(v[6] || v[5]);
          if (code) byCode[code] = (byCode[code] || 0) + q;
          if (drug) byDrug[drug] = (byDrug[drug] || 0) + q;
          if (nm) byName[nm] = (byName[nm] || 0) + q;
        } catch (e) {}
      }
    }
  }
  var out = { byCode: byCode, byDrug: byDrug, byName: byName, days: daysWith, rev: rev };
  fxCachePut_('fx_sales_vel2', out, 21600);
  return out;
}

/* نسبة (سعر الصيدلي ÷ سعر الجمهور) لكل فئة من أصناف المخزون اللي فيها رصيد —
   بنستخدمها تقدير لو الصنف الناقص مفيهوش سعر صيدلي صريح. */
function ordersRatios_() {
  var hit = fxCacheGet_('fx_ord_ratios');
  if (hit) return hit;
  var out = { cat: {}, all: 0.8 };
  try {
    var sh = SpreadsheetApp.openById(STOCK_SHEET_ID).getSheets()[0];
    var lastCol = sh.getLastColumn(), n = sh.getLastRow() - 1;
    if (n < 1) return out;
    var hdr = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0], ix = {};
    hdr.forEach(function (h, i) { ix[String(h || '').trim().toLowerCase()] = i; });
    if (ix['totnetcoast'] === undefined || ix['totprice'] === undefined) return out;
    var d = sh.getRange(2, 1, n, lastCol).getValues(), agg = {}, tc = 0, tp = 0;
    d.forEach(function (r) {
      var st = parseFloat(r[ix['stock']]) || 0, c = parseFloat(r[ix['totnetcoast']]) || 0, p = parseFloat(r[ix['totprice']]) || 0;
      if (st <= 0 || c <= 0 || p <= 0) return;
      var cat = String(r[ix['category']] || '').trim() || 'أخرى';
      var a = agg[cat] || (agg[cat] = { c: 0, p: 0 });
      a.c += c; a.p += p; tc += c; tp += p;
    });
    Object.keys(agg).forEach(function (k) { if (agg[k].p > 0) out.cat[k] = agg[k].c / agg[k].p; });
    if (tp > 0) out.all = tc / tp;
  } catch (e) {}
  fxCachePut_('fx_ord_ratios', out, 1800);
  return out;
}

function ordersPage(code, days) {
  try {
    var dd = [3, 7, 14, 30].indexOf(parseInt(days, 10)) !== -1 ? parseInt(days, 10) : 7;
    var key = 'fx_ord_page_v4_' + dd;
    var hit = fxCacheGet_(key);
    if (hit) return hit;

    var res = UrlFetchApp.fetch(SHORTAGE_SCRIPT_URL + '?action=getShortages&days=' + dd, { muteHttpExceptions: true });
    var d = JSON.parse(res.getContentText());
    if (!d || d.error) return { ok: false, msg: 'مقدرتش أجيب النواقص دلوقتي' };

    /* أسعار من المخزون كاحتياطي: بالكود الأول وبعدين بالاسم */
    var byCode = {}, byName = {};
    try { byCode = scanIndex_() || {}; } catch (e1) { byCode = {}; }
    var stByName = {};
    try { doctorIndex_().forEach(function (it) { if (!byName[it.h]) { byName[it.h] = it.p; stByName[it.h] = it.s; } }); } catch (e2) {}
    var ratios = ordersRatios_() || { cat: {}, all: 0.8 };
    if (!ratios.cat) ratios.cat = {};
    var vel = { byCode: {}, byDrug: {}, byName: {}, days: 0 };
    try {
      var vv = salesVelocity_();
      if (vv && typeof vv === 'object') {
        vel = { byCode: vv.byCode || {}, byDrug: vv.byDrug || {}, byName: vv.byName || {},
                days: vv.days || 0, rev: vv.rev || 0 };
      }
    } catch (e3) { vel = { byCode: {}, byDrug: {}, byName: {}, days: 0, rev: 0 }; }
    var openMs = {};   // مفتاح الصنف → أول ما ظهر ناقص (من سجل النواقص)
    try {
      var esh = getOrCreateSheet_(SHORT_EP_SHEET, SHORT_EP_HEAD), en = esh.getLastRow() - 1;
      if (en > 0) esh.getRange(2, 1, en, SHORT_EP_HEAD.length).getValues().forEach(function (r) {
        if (r[7] === 'قائم') openMs[String(r[0])] = Number(r[11]);
      });
    } catch (e4) {}
    var nowMs = new Date().getTime();

    function num_(v) { var x = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(x) ? x : null; }
    /* بندوّر في حقول الصنف على السعر/التكلفة/الخصم بأسمائها مهما اتكتبت */
    function pick_(it, re, notRe) {
      var ks = Object.keys(it);
      for (var i = 0; i < ks.length; i++) {
        if (re.test(ks[i]) && !(notRe && notRe.test(ks[i]))) { var v = num_(it[ks[i]]); if (v !== null && v > 0) return v; }
      }
      return null;
    }

    var out = { ok: true, days: dd, at: Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm'),
                sourceFields: null, estimated: 0, total: 0, salesDays: vel.days, revPerDay: vel.days > 0 ? Math.round(vel.rev / vel.days) : 0 };
    ['zero', 'low'].forEach(function (sec) {
      var by = {}, data = d[sec];
      if (data && data.categories) {
        Object.keys(data.categories).forEach(function (cat) {
          var comps = data.categories[cat];
          Object.keys(comps).forEach(function (co) {
            (by[co] = by[co] || []);
            comps[co].forEach(function (it) {
              if (!out.sourceFields) out.sourceFields = Object.keys(it);
              var q = Math.ceil(Number(it.shortage) - 1e-9);
              if (!isFinite(q) || q < 1) q = 1;

              var pub = pick_(it, /price|سعر|retail|sell|public|جمهور/i, /after|cost|coast|net|buy|purchase|disc/i);
              if (pub === null) {
                var sc = byCode[String(it.code || '').replace(/[^\d]/g, '')];
                pub = sc ? sc.price : (byName[doctorNorm_(it.name)] || null);
              }
              /* الرصيد الحالي: من الصنف نفسه لو موجود، وإلا من المخزون بالكود ثم بالاسم */
              var stk = null;
              var ks_ = Object.keys(it);
              for (var z = 0; z < ks_.length && stk === null; z++) {
                if (/stock|رصيد|qty|balance/i.test(ks_[z]) && !/max|min|need|short/i.test(ks_[z])) stk = num_(it[ks_[z]]);
              }
              if (stk === null) {
                var sc2 = byCode[String(it.code || '').replace(/[^\d]/g, '')];
                stk = sc2 ? sc2.stock : (stByName[doctorNorm_(it.name)] !== undefined ? stByName[doctorNorm_(it.name)] : null);
              }
              var cost = pick_(it, /cost|coast|net|after|buy|purchase|صيدلي|تكلف/i, /total|tot_|sum/i), est = false;
              if (cost === null && pub) {
                var disc = pick_(it, /disc|خصم|margin|ربح/i);
                if (disc !== null && disc < 100) cost = pub * (1 - disc / 100);
                else { cost = pub * (ratios.cat[cat] || ratios.all); est = true; }
              }
              /* متوسط البيع اليومي (علبة/يوم) → إيراد معرّض للضياع كل يوم نقص */
              var sold = null, dcode = String(it.code || '').replace(/[^\d]/g, '');
              if (dcode && vel.byCode[dcode] !== undefined) sold = vel.byCode[dcode];
              else if (dcode && vel.byDrug[dcode] !== undefined) sold = vel.byDrug[dcode];
              else if (vel.byName[doctorNorm_(it.name)] !== undefined) sold = vel.byName[doctorNorm_(it.name)];
              var perDay = (sold !== null && vel.days > 0) ? Math.max(0, sold) / vel.days : null;
              var fk = String(it.code || it.name || '').trim();
              var hrs = openMs[fk] ? Math.round((nowMs - openMs[fk]) / 360000) / 10 : null;
              out.total++; if (est) out.estimated++;
              by[co].push({ n: String(it.name || ''), q: q, c: cat, s: stk === null ? null : Math.round(stk * 100) / 100,
                            p: pub === null ? null : Math.round(pub * 100) / 100,
                            k: cost === null ? null : Math.round(cost * 100) / 100, e: est ? 1 : 0,
                            u: perDay === null ? null : Math.round(perDay * 100) / 100,
                            v: (perDay !== null && pub) ? Math.round(perDay * pub * 10) / 10 : null, h: hrs });
            });
          });
        });
      }
      out[sec] = Object.keys(by).map(function (co) { return { co: co, items: by[co] }; })
        .sort(function (a, b) { return b.items.length - a.items.length; });
    });
    fxCachePut_(key, out, 300);
    return out;
  } catch (e) {
    return { ok: false, msg: e.message + ' @ ' + String(e.stack || '').split('\n').slice(0, 2).join(' | ') };
  }
}

// ═══════════════════════════════════════════════════════════════════
// 📈 كفاءة الطلبيات — سجل النواقص
//
// النظام مبيحتفظش بتاريخ النواقص، فبنسجّله إحنا: كل ساعتين-تلاتة (مع لقطة
// الساعة) بناخد صورة من قايمة النواقص، وكل صنف بيتسجّل له "فترة نقص":
// أول ما ظهر → أول ما اختفى (اتطلب أو اتوفّر). من الفترات دي بنقيس:
//   • متوسط مدة بقاء الصنف ناقص
//   • الأصناف ناقصة من أكتر من 3 أيام (لسه مطلبتش)
//   • الأصناف اللي بتخلص بتكرار (حد الطلب واطي)
//   • عدد الناقص يوميًا (اتجاه)
// ⚠️ الأرقام بتبدأ تبقى مفهومة بعد 3-7 أيام من أول تسجيل.
// ═══════════════════════════════════════════════════════════════════
var SHORT_EP_SHEET = 'سجل النواقص';
var SHORT_DAILY_SHEET = 'سجل النواقص اليومي';
var SHORT_EP_HEAD = ['المفتاح', 'الصنف', 'القسم', 'الشركة', 'النوع', 'أول ظهور', 'آخر ظهور', 'الحالة',
                     'انتهى', 'المدة (ساعات)', 'أقصى كمية', 'أول ظهور ms', 'انتهى ms', 'بداية الصفر ms'];

function shortFmt_(ms) { return Utilities.formatDate(new Date(ms), 'Africa/Cairo', 'yyyy-MM-dd HH:mm'); }

/* بيتأكد إن الشيت فيه كل الأعمدة (لو اتعمل بنسخة أقدم) */
function shortEpSheet_() {
  var sh = getOrCreateSheet_(SHORT_EP_SHEET, SHORT_EP_HEAD);
  if (sh.getMaxColumns() < SHORT_EP_HEAD.length) sh.insertColumnsAfter(sh.getMaxColumns(), SHORT_EP_HEAD.length - sh.getMaxColumns());
  if (String(sh.getRange(1, SHORT_EP_HEAD.length).getDisplayValue()) !== SHORT_EP_HEAD[SHORT_EP_HEAD.length - 1])
    sh.getRange(1, 1, 1, SHORT_EP_HEAD.length).setValues([SHORT_EP_HEAD]);
  return sh;
}

function logShortageSnapshot_(force) {
  var cache = CacheService.getScriptCache();
  if (!force && cache.get('short_log_t')) return { ok: true, skipped: true };

  var res = UrlFetchApp.fetch(SHORTAGE_SCRIPT_URL + '?action=getShortages&days=7', { muteHttpExceptions: true });
  var d = JSON.parse(res.getContentText());
  if (!d || d.error) return { ok: false, msg: 'مقدرتش أجيب النواقص' };

  var cur = {}, nZero = 0, nLow = 0;
  ['zero', 'low'].forEach(function (sec) {
    var data = d[sec];
    if (!data || !data.categories) return;
    Object.keys(data.categories).forEach(function (cat) {
      var comps = data.categories[cat];
      Object.keys(comps).forEach(function (co) {
        comps[co].forEach(function (it) {
          var k = String(it.code || it.name || '').trim();
          if (!k) return;
          var q = Math.ceil(Number(it.shortage) - 1e-9); if (!isFinite(q) || q < 1) q = 1;
          if (cur[k]) { if (sec === 'zero') cur[k].sec = 'zero'; cur[k].q = Math.max(cur[k].q, q); return; }
          cur[k] = { k: k, name: String(it.name || ''), cat: cat, co: co, sec: sec, q: q };
          if (sec === 'zero') nZero++; else nLow++;
        });
      });
    });
  });

  var sh = shortEpSheet_();
  var n = sh.getLastRow() - 1;
  var rows = n > 0 ? sh.getRange(2, 1, n, SHORT_EP_HEAD.length).getValues() : [];
  var now = new Date().getTime(), nowS = shortFmt_(now);
  var openCount = 0, seen = {};
  rows.forEach(function (r) { if (r[7] === 'قائم') openCount++; });

  /* حماية: قايمة فاضية فجأة مع نواقص كتير مفتوحة = غالبًا عطل مش حقيقة */
  var closeAllowed = !(Object.keys(cur).length === 0 && openCount > 5);

  rows.forEach(function (r) {
    if (r[7] !== 'قائم') return;
    var k = String(r[0]);
    if (cur[k]) {
      seen[k] = true;
      r[6] = nowS;
      if (cur[k].sec === 'zero') { r[4] = 'خلص خالص'; if (!Number(r[13])) r[13] = now; }
      r[10] = Math.max(Number(r[10]) || 0, cur[k].q);
    } else if (closeAllowed) {
      r[7] = 'انتهى'; r[8] = nowS; r[12] = now;
      r[9] = Math.round((now - Number(r[11])) / 360000) / 10;
    }
  });
  Object.keys(cur).forEach(function (k) {
    if (seen[k]) return;
    var c = cur[k];
    rows.push([k, c.name, c.cat, c.co, c.sec === 'zero' ? 'خلص خالص' : 'قرب يخلص', nowS, nowS, 'قائم', '', '', c.q, now, '',
               c.sec === 'zero' ? now : '']);
  });
  /* نشيل الفترات المنتهية الأقدم من 180 يوم */
  var cutoff = now - 180 * 86400000;
  rows = rows.filter(function (r) { return r[7] === 'قائم' || (Number(r[12]) || now) >= cutoff; });
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, SHORT_EP_HEAD.length).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, SHORT_EP_HEAD.length).setValues(rows);

  /* العدد اليومي: صف لكل يوم بيتحدّث بآخر لقطة */
  var dsh = getOrCreateSheet_(SHORT_DAILY_SHEET, ['التاريخ', 'خلص خالص', 'قرب يخلص']);
  var today = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');
  var last = dsh.getLastRow();
  if (last > 1 && String(dsh.getRange(last, 1).getDisplayValue()).trim() === today) {
    dsh.getRange(last, 2, 1, 2).setValues([[nZero, nLow]]);
  } else dsh.appendRow([today, nZero, nLow]);

  cache.put('short_log_t', '1', 10200);   // ~2.8 ساعة
  try { salesVelocity_(); } catch (eV) { Logger.log('خطأ سرعة البيع: ' + eV.message); }   // يسخّن الكاش
  return { ok: true, zero: nZero, low: nLow, open: Object.keys(cur).length, closed: closeAllowed };
}

/* سرعة بيع كل صنف من ملفات المبيعات (آخر 28 يوم). بنستخدمها نقدّر المبيعات
   اللي ضاعت وقت ما الصنف كان خالص. الكاش 5.8 ساعة. */
function salesVelocity_() {
  var hit = fxCacheGet_('fx_sales_vel');
  if (hit) return hit;
  var DAYS = 28, folder = DriveApp.getFolderById(SALES_FOLDER), tz = 'Africa/Cairo', now = new Date();
  var items = {}, filesRead = 0;
  for (var i = 0; i < DAYS; i++) {
    var ds = Utilities.formatDate(new Date(now.getTime() - i * 86400000), tz, 'yyyy-MM-dd');
    var it = folder.getFilesByName('sales' + ds + '.txt');
    if (!it.hasNext()) continue;
    var content = it.next().getBlob().getDataAsString('UTF-8');
    if (!content) continue;
    filesRead++;
    var rx = /VALUES\s*\(((?:&#\d+;|[^;])+)\)/g, m;
    while ((m = rx.exec(content)) !== null) {
      var tuples = extractTuples('(' + m[1] + ')');
      for (var t = 0; t < tuples.length; t++) {
        try {
          var v = parseValues(tuples[t]);
          if (!v || v.length < 50) continue;
          if ((v[2] ? v[2].trim() : '') !== 'sale') continue;
          var nm = doctorNorm_(v[6] || v[5] || '');
          var q = parseFloat(v[7]) || 0, p = parseFloat(v[8]) || 0;
          if (!nm || q <= 0) continue;
          var o = items[nm] || (items[nm] = { q: 0, r: 0 });
          o.q += q; o.r += q * p;
          var alt = doctorNorm_(v[5] || '');
          if (alt && alt !== nm && !items[alt]) items[alt] = o;   // نفس الكائن تحت اسم تاني
        } catch (e) { continue; }
      }
    }
  }
  var out = { days: DAYS, files: filesRead, items: items };
  /* الكاش بيتخزن كنص — الكائنات المشتركة بتتفصل، فبنخزّن كل اسم بقيمته */
  var flat = {};
  Object.keys(items).forEach(function (k) { flat[k] = [Math.round(items[k].q * 100) / 100, Math.round(items[k].r)]; });
  out = { days: DAYS, files: filesRead, items: flat };
  fxCachePut_('fx_sales_vel', out, 20800);
  return out;
}

/* بيدوّر على الصنف في سرعة البيع: بالاسم بالظبط، وبعدين كل كلمات الاسم موجودة */
function velLookup_(vel, name) {
  var nm = doctorNorm_(name);
  if (!nm) return null;
  if (vel.items[nm]) return vel.items[nm];
  var toks = nm.split(' ').filter(function (t) { return t.length >= 2; });
  if (!toks.length) return null;
  var best = null;
  Object.keys(vel.items).forEach(function (k) {
    if (toks.every(function (t) { return k.indexOf(t) !== -1; })) {
      if (!best || vel.items[k][0] > best[0]) best = vel.items[k];
    }
  });
  return best;
}

function orderEfficiency(days) {
  try {
    var dd = Math.max(3, Math.min(90, parseInt(days, 10) || 7));
    var now = new Date().getTime(), from = now - dd * 86400000;
    var sh = shortEpSheet_();
    var n = sh.getLastRow() - 1;
    var rows = n > 0 ? sh.getRange(2, 1, n, SHORT_EP_HEAD.length).getValues() : [];
    var firstMs = null;
    rows.forEach(function (r) { var f = Number(r[11]); if (f && (firstMs === null || f < firstMs)) firstMs = f; });

    var inP = rows.filter(function (r) { return r[7] === 'قائم' || (Number(r[12]) || 0) >= from; });
    var closed = inP.filter(function (r) { return r[7] === 'انتهى'; });
    var hrs = closed.map(function (r) { return Number(r[9]) || 0; }).sort(function (a, b) { return a - b; });
    var avg = hrs.length ? hrs.reduce(function (a, b) { return a + b; }, 0) / hrs.length : null;
    var med = hrs.length ? hrs[Math.floor(hrs.length / 2)] : null;

    var open = rows.filter(function (r) { return r[7] === 'قائم'; }).map(function (r) {
      return { name: r[1], co: r[3], type: r[4], hours: Math.round((now - Number(r[11])) / 360000) / 10, q: r[10] };
    }).sort(function (a, b) { return b.hours - a.hours; });
    var stale = open.filter(function (o) { return o.hours > 72; });

    var rep = {};
    inP.forEach(function (r) {
      var k = String(r[0]); var o = rep[k] || (rep[k] = { name: r[1], co: r[3], n: 0 });
      o.n++;
    });
    var repeat = Object.keys(rep).map(function (k) { return rep[k]; })
      .filter(function (o) { return o.n >= 2; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 10);

    var dsh = getOrCreateSheet_(SHORT_DAILY_SHEET, ['التاريخ', 'خلص خالص', 'قرب يخلص']);
    var dn = dsh.getLastRow() - 1, series = [];
    if (dn > 0) {
      series = dsh.getRange(Math.max(2, dsh.getLastRow() - dd + 1), 1, Math.min(dn, dd), 3).getDisplayValues()
        .map(function (r) { return { date: r[0], zero: Number(r[1]) || 0, low: Number(r[2]) || 0 }; });
    }
    var trend = null;
    if (series.length >= 4) {
      var h = Math.floor(series.length / 2);
      var a1 = series.slice(0, h).reduce(function (a, x) { return a + x.zero; }, 0) / h;
      var a2 = series.slice(h).reduce(function (a, x) { return a + x.zero; }, 0) / (series.length - h);
      trend = Math.round((a2 - a1) * 10) / 10;   // موجب = النواقص بتزيد
    }
    /* المبيعات الضايعة: أيام ما كان الصنف خالص (جوه الفترة) × متوسط بيعه اليومي × سعر البيع */
    var lost = { value: 0, units: 0, items: [], zeroEpisodes: 0, matched: 0, velFiles: 0 };
    try {
      var vel = salesVelocity_(); lost.velFiles = vel.files;
      var agg = {};
      inP.forEach(function (r) {
        var z = Number(r[13]); if (!z) return;
        lost.zeroEpisodes++;
        var end = r[7] === 'قائم' ? now : (Number(r[12]) || now);
        var daysOut = (end - Math.max(z, from)) / 86400000;
        if (daysOut <= 0) return;
        var v = velLookup_(vel, r[1]);
        if (!v) return;
        lost.matched++;
        var perDay = v[0] / vel.days, price = v[0] > 0 ? v[1] / v[0] : 0;
        var units = perDay * daysOut, value = units * price;
        var key = String(r[0]);
        var a = agg[key] || (agg[key] = { name: r[1], co: r[3], daysOut: 0, perDay: perDay, units: 0, value: 0 });
        a.daysOut += daysOut; a.units += units; a.value += value;
        lost.value += value; lost.units += units;
      });
      lost.items = Object.keys(agg).map(function (k) { var a = agg[k];
        return { name: a.name, co: a.co, daysOut: Math.round(a.daysOut * 10) / 10, perDay: Math.round(a.perDay * 10) / 10,
                 units: Math.round(a.units), value: Math.round(a.value) }; })
        .sort(function (a, b) { return b.value - a.value; }).slice(0, 10);
      lost.value = Math.round(lost.value); lost.units = Math.round(lost.units);
    } catch (eL) { lost.error = eL.message; }
    var collectedDays = firstMs ? Math.floor((now - firstMs) / 86400000) : 0;
    return { ok: true, days: dd, collectedDays: collectedDays, since: firstMs ? shortFmt_(firstMs) : '',
             episodes: inP.length, closed: closed.length, avgHours: avg === null ? null : Math.round(avg * 10) / 10,
             medHours: med, openNow: open.length, stale: stale.length, oldest: open.slice(0, 10),
             repeat: repeat, series: series, trend: trend, lost: lost };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
}

/* حفظ الجرد. بيتبعت دفعة واحدة من الموبايل لما الموظف يدوس "خلّصت".
   بيتخزن محليًا على الموبايل قبل كده، فقطع النت مبيضيعش الشغل. */
function saveCountSession(payload) {
  try {
    var data = (typeof payload === 'string') ? JSON.parse(payload) : payload;
    var lines = data.lines || [];
    if (!lines.length) return { ok: false, error: 'الجرد فاضي' };

    var now = new Date();
    var stamp = Utilities.formatDate(now, 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss');
    var id = data.sessionId || ('J' + now.getTime());
    var who = String(data.by || '').trim();
    var title = String(data.title || 'جرد').trim();

    var idx = scanIndex_();
    var rows = [], diffCount = 0, diffValue = 0, counted = 0;

    lines.forEach(function (L) {
      var code = String(L.code || '').replace(/[^\d]/g, '');
      var it = idx[code] || null;
      var expire = String(L.expire || '').trim();
      var qty = parseFloat(L.qty) || 0;
      counted += qty;

      /* رصيد السيستم للدفعة دي تحديدًا — مش الصنف كله.
         لو الموبايل بعت الرصيد اللي كان قدامه وقت العدّ (من لقطة المخزون)
         بنستخدمه هو — لأن الرصيد وقت الحفظ ممكن يكون اتغيّر بالبيع
         وساعتها الفرق بيبقى وهمي. */
      var sys = 0;
      var hasClientSys = (L.sys !== undefined && L.sys !== null && L.sys !== '' &&
                          isFinite(parseFloat(L.sys)) && String(L.snapAt || '') !== '');
      if (hasClientSys) {
        sys = parseFloat(L.sys);
      } else if (it) {
        if (expire) {
          it.batches.forEach(function (b) { if (b.expire === expire) sys += b.stock; });
        } else {
          sys = it.stock;
        }
      }
      var diff = qty - sys;
      var price = it ? it.price : 0;
      if (Math.abs(diff) > 0.001) { diffCount++; diffValue += diff * price; }

      rows.push([
        stamp, id, title, who,
        code, it ? it.name : '⚠️ صنف مش معروف',
        expire || '—',
        sys, qty, diff,
        Math.round(diff * price * 100) / 100,
        it ? it.cat : '',
        L.isNewBatch ? 'صلاحية زيادة' : '',
        String(L.snapAt || '')          /* وقت لقطة الأرصدة اللي اتقارن بيها */
      ]);
    });

    var lsh = getOrCreateSheet_(COUNT_LINES_SHEET, [
      'الوقت','رقم الجلسة','العنوان','الموظف','الكود','الصنف',
      'الصلاحية','رصيد السيستم','العد الفعلي','الفرق','قيمة الفرق','الفئة','ملاحظة'
    ]);
    if (String(lsh.getRange(1, 14).getValue() || '') !== 'وقت اللقطة') lsh.getRange(1, 14).setValue('وقت اللقطة');
    lsh.getRange(lsh.getLastRow() + 1, 1, rows.length, 14).setValues(rows);

    var ssh = getOrCreateSheet_(COUNT_SESSIONS_SHEET, [
      'الوقت','رقم الجلسة','العنوان','الموظف','عدد السطور','إجمالي العلب','سطور فيها فرق','قيمة الفروقات'
    ]);
    ssh.appendRow([stamp, id, title, who, rows.length, counted, diffCount,
                   Math.round(diffValue * 100) / 100]);

    sendTelegramStaff(
      '📋 جرد جديد اتسجّل\n' + SEP + '\n' +
      'العنوان: ' + title + '\n' + (who ? ('الموظف: ' + who + '\n') : '') +
      'أصناف: ' + rows.length + ' · علب: ' + Math.round(counted) + '\n' +
      'فيها فرق: ' + diffCount + ' صنف\n' +
      'قيمة الفروقات: ' + Math.round(diffValue) + ' جنيه',
      PERSONAL_CHAT
    );

    removeOpenCount_(id);   // اتقفل خلاص، يتشال من الشغالة

    return { ok: true, sessionId: id, lines: rows.length,
             diffCount: diffCount, diffValue: Math.round(diffValue) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* تقرير جلسة — الفروقات مرتبة بالأغلى */
function getCountReport(sessionId) {
  try {
    var sh = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(COUNT_LINES_SHEET);
    if (!sh || sh.getLastRow() <= 1) return { ok: true, lines: [] };
    var d = sh.getRange(2, 1, sh.getLastRow() - 1, 13).getValues();
    var out = [];
    d.forEach(function (r) {
      if (sessionId && String(r[1]) !== String(sessionId)) return;
      out.push({
        code: String(r[4]), name: r[5], expire: r[6],
        sys: parseFloat(r[7]) || 0, counted: parseFloat(r[8]) || 0,
        diff: parseFloat(r[9]) || 0, diffValue: parseFloat(r[10]) || 0,
        cat: r[11], note: r[12]
      });
    });
    out.sort(function (a, b) { return Math.abs(b.diffValue) - Math.abs(a.diffValue); });
    return { ok: true, sessionId: sessionId || 'الكل', lines: out };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function getCountSessions() {
  try {
    var sh = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(COUNT_SESSIONS_SHEET);
    if (!sh || sh.getLastRow() <= 1) return { ok: true, sessions: [] };
    var d = sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues();
    var out = d.map(function (r) {
      return { at: r[0], id: String(r[1]), title: r[2], by: r[3],
               lines: r[4], units: r[5], diffCount: r[6], diffValue: r[7] };
    }).reverse();
    return { ok: true, sessions: out };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* 🩺 فحص جاهزية الجرد — شغّلها قبل ما تبدأ */
function diagnoseScanReady() {
  var m = scanIndex_();
  var codes = Object.keys(m);
  var inStock = 0, multi = 0, noExp = 0, batches = 0, bad = 0;

  /* ⚠️ النسبة بتتحسب على الأصناف اللي فيها رصيد بس.
     الأصناف الصفر معندهاش دفعات أصلاً، فلو حسبناها كانت هتنزّل
     النسبة كذب وتخلينا نبني تصميم غلط.

     ملحوظة: الأصناف الصفر بتفضل موجودة في خريطة المسح عن قصد —
     لو الموظف لقى على الرف صنف السيستم شايفه صفر، لازم الماسحة
     تعرفه وتسجّل "السيستم 0 · عدّيت 2". دي من أهم نتائج الجرد. */
  codes.forEach(function (k) {
    var it = m[k];
    if (!/^\d{6,14}$/.test(k)) bad++;
    if (it.stock <= 0) return;
    inStock++;
    if (it.multi) { multi++; batches += it.batches.length; }
    if (!it.batches[0].expire) noExp++;
  });
  var pct = inStock ? Math.round(multi / inStock * 100) : 0;
  Logger.log('════ جاهزية الجرد ════');
  Logger.log('إجمالي الأصناف       : ' + codes.length);
  Logger.log('فيها رصيد            : ' + inStock + '  ← الأساس اللي بنحسب عليه');
  Logger.log('أكواد شكلها غلط      : ' + bad);
  Logger.log('بأكتر من صلاحية      : ' + multi + ' (' + pct + '% من اللي فيها رصيد · ' + batches + ' دفعة)');
  Logger.log('من غير صلاحية مسجلة  : ' + noExp);
  Logger.log('');
  Logger.log('👉 "بأكتر من صلاحية" = الأصناف اللي الشاشة هتوقف عندها.');
  var ex = codes.filter(function (k) { return m[k].multi && m[k].stock > 0; }).slice(0, 5);
  ex.forEach(function (k) {
    Logger.log('  ' + k + ' ' + m[k].name + ' → ' +
      m[k].batches.map(function (b) { return b.expire + '×' + b.stock; }).join('  '));
  });
  return { ok: true, total: codes.length, inStock: inStock,
           multi: multi, multiPct: pct, batches: batches, noExp: noExp, bad: bad };
}

/* 🩺 قياس زمن بناء اللقطة — بيقيس كل جزء لوحده.
   سبب وجودها: buildSnapshot بتحسب التلاتة في نداء واحد، وسقف
   Apps Script 6 دقايق. لو المجموع قرب من السقف، اللقطة بتتقطع
   وتفضل "لسه متبنيتش" من غير أي رسالة خطأ. */
function timeSnapshot() {
  var out = { ok: true, parts: [], total: 0, limit: 360 };
  function step(name, fn) {
    var t0 = Date.now(), r = null, err = '';
    try { r = fn(); } catch (e) { err = e.message; }
    var secs = Math.round((Date.now() - t0) / 1000);
    out.total += secs;
    out.parts.push({
      name: name, secs: secs,
      ok: !err && r && r.ok !== false,
      detail: err ? err : (r && r.ok !== false ? 'تمام' : 'رجع فاضي')
    });
    return r;
  }

  var d = step('الديون',    function () { return getDebtsData(); });
  if (d && d.ok) out.parts[0].detail = d.count + ' مدين';

  var i = step('المخزون',   function () { return getInventoryAging_uncached(); });
  if (i && i.ok) out.parts[1].detail = i.sku_in_stock + ' صنف فيه رصيد';

  var a = step('المندوبين', function () { return getAgentsData(); });
  if (a && a.ok) out.parts[2].detail = a.agents.length + ' مندوب';

  out.tooSlow = out.total > 300;
  out.willFail = out.total > 360;
  return out;
}

/* 🧪 اختبار سريع للتخزين الجديد — بيكتب ويقرا حاجة صغيرة.
   لو نجحت، يبقى اللقطة الحقيقية هتنجح أكيد. شغّلها قبل buildSnapshot
   عشان توفّر دقيقتين انتظار لو فيه مشكلة. */
function testSnapStorage() {
  try {
    var probe = { ok: true, hello: 'اختبار', when: new Date().toISOString(), pad: '' };
    for (var i = 0; i < 60; i++) probe.pad += 'ابجدهوز';   // نجرب التقسيم كمان
    var kb = snapSave_('__test__', probe);
    var back = snapLoad_('__test__');
    fxClearCache_('snap___test__');
    if (back && back.hello === 'اختبار') {
      Logger.log('✅ التخزين شغال — كتبنا وقرينا ' + kb + ' ك.ب بنجاح');
      Logger.log('   دلوقتي شغّل buildSnapshot عادي.');
      return { ok: true, kb: kb };
    }
    Logger.log('❌ اتكتب بس القراءة رجعت غلط');
    return { ok: false };
  } catch (e) {
    Logger.log('❌ فشل: ' + e.message);
    return { ok: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════
// 📋 الجرود الشغالة — محفوظة على السيرفر مش على موبايل الموظف
//
// المشكلة اللي بتحلها: النسخة الأولى كانت بتحفظ الجرد في
// localStorage. يعني الجرد حبيس الموبايل اللي بدأه — مفيش زميل
// يكمّله، ولو الموبايل ضاع الشغل يضيع، وإنت من بعيد مش شايف
// إن فيه جرد شغال أصلاً.
//
// دلوقتي بيتحفظ كل 10 مسحات في شيت، وأي موبايل يفتح scan.html
// يلاقي الجرود الشغالة كلها ويكمّل في أي واحد.
// ═══════════════════════════════════════════════════════════════════

var COUNT_OPEN_SHEET = 'جرود شغالة';

function openCountSheet_() {
  var sh = getOrCreateSheet_(COUNT_OPEN_SHEET,
    ['رقم الجلسة', 'العنوان', 'الموظف', 'بدأ', 'آخر تحديث', 'عدد السطور', 'البيانات', 'ms']);
  if (sh.getRange(1, 8).getValue() !== 'ms') sh.getRange(1, 8).setValue('ms');
  return sh;
}

/* حفظ تلقائي أثناء الجرد. بيستبدل صف الجلسة أو يضيفه. */
/* ═══════════════════════════════════════════════════════════════
   حفظ تلقائي أثناء الجرد — بالدمج مش بالاستبدال.

   ⚠️ العطل اللي بيحله: كل موبايل كان بيرفع نسخته كاملة، فلو
   موظفين شغالين على نفس الجرد كان الأخير بيمسح شغل الأول:
       9:10 ولاء رفعت 45 سطر
       9:12 حمادة رفع 35 (نسخته القديمة) ← الـ10 بتوع ولاء ضاعوا

   دلوقتي الموبايل بيبعت اللي عنده، والسيرفر بيدمجه في الموجود.
   آخر تعديل بالوقت هو اللي يكسب لنفس المفتاح.
   القفل ضروري: موظفين ممكن يرفعوا في نفس اللحظة.
   ═══════════════════════════════════════════════════════════════ */
function saveOpenCount(data) {
  var lock = LockService.getScriptLock();
  try { if (!lock.tryLock(20000)) return { ok: false, error: 'مشغول — جرب تاني' }; }
  catch (e) { return { ok: false, error: 'مشغول' }; }

  try {
    var d = (typeof data === 'string') ? JSON.parse(data) : data;
    if (!d.sessionId) return { ok: false, error: 'رقم الجلسة ناقص' };

    var sh = openCountSheet_();
    var now = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss');
    var last = sh.getLastRow(), row = -1, started = now, existing = [];

    if (last > 1) {
      var ids = sh.getRange(2, 1, last - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]) === String(d.sessionId)) { row = i + 2; break; }
      }
    }
    if (row !== -1) {
      started = sh.getRange(row, 4).getValue() || now;
      try { existing = JSON.parse(sh.getRange(row, 7).getValue() || '[]'); } catch (e2) {}
    }

    /* الدمج: مفتاح = كود|صلاحية. الأحدث بالوقت يكسب. */
    var map = {};
    existing.forEach(function (L) {
      if (L && L.code) map[L.code + '|' + (L.expire || '')] = L;
    });
    (d.lines || []).forEach(function (L) {
      if (!L || !L.code) return;
      var k = L.code + '|' + (L.expire || '');
      var prev = map[k];
      /* السطر عندنا أحدث؟ يبقى موظف تاني عدّله بعد ما الموبايل ده
         نزّل نسخته — نسيبه */
      if (prev && (+prev.at || 0) > (+L.at || 0)) return;
      if ((+L.qty || 0) <= 0) delete map[k];
      else map[k] = L;
    });

    var merged = Object.keys(map).map(function (k) { return map[k]; });
    merged.sort(function (a, b) { return (+a.at || 0) - (+b.at || 0); });

    var json = JSON.stringify(merged);
    if (json.length > 45000) {
      merged = merged.slice(-320);          /* سقف الخلية ~50 ألف حرف */
      json = JSON.stringify(merged);
    }

    var out = [d.sessionId, d.title || 'جرد', d.by || '', started, now,
               merged.length, json, Date.now()];
    if (row === -1) sh.appendRow(out);
    else sh.getRange(row, 1, 1, 8).setValues([out]);

    /* بنرجّع المدموج عشان الموبايل يشوف شغل زمايله */
    return { ok: true, at: now, lines: merged, count: merged.length };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    try { lock.releaseLock(); } catch (e3) {}
  }
}

/* قايمة الجرود الشغالة + آخر 5 أصناف لكل موظف.
   الـ5 دول هما اللي بيقولوا للموظف "كنت واقف فين" لما يرجع تاني يوم —
   الأرقام المجمّعة لوحدها مبتفكّرش بمكان على الرف. */
function listOpenCounts(params) {
  try {
    var sh = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(COUNT_OPEN_SHEET);
    if (!sh || sh.getLastRow() <= 1) return { ok: true, open: [], total: scanTotalItems_() };

    var who = (params && params.by) ? String(params.by).trim() : '';
    var d = sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues();

    var out = d.filter(function (r) { return r[0]; }).map(function (r) {
      var lines = [];
      try { lines = JSON.parse(r[6] || '[]'); } catch (e) {}

      /* آخر 5 — بترتيب الإضافة، الأحدث الأول */
      var recent = lines.slice(-5).reverse().map(function (L) {
        return { name: L.name || '', qty: L.qty, expire: L.expire || '', at: L.at || '' };
      });

      /* عدد الأصناف الفريدة — مش عدد السطور.
         الصنف بصلاحيتين بياخد سطرين بس هو صنف واحد. */
      var uniq = {};
      lines.forEach(function (L) { if (L.code) uniq[L.code] = 1; });

      /* لو الموظف معروف، نطلّع آخر 5 بتاعته هو تحديدًا */
      var mine = null;
      if (who) {
        var his = lines.filter(function (L) { return String(L.who || '') === who; });
        if (his.length) mine = his.slice(-5).reverse().map(function (L) {
          return { name: L.name || '', qty: L.qty, expire: L.expire || '', at: L.at || '' };
        });
      }

      return { id: String(r[0]), title: r[1], by: r[2],
               started: String(r[3]), updated: String(r[4]),
               updatedMs: (parseFloat(r[7]) || 0),
               lines: Object.keys(uniq).length,   /* أصناف مش سطور */
               rows: r[5],
               recent: recent, mine: mine };
    });

    out.sort(function (a, b) { return String(b.updated).localeCompare(String(a.updated)); });
    return { ok: true, open: out, total: scanTotalItems_() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* عدد الأصناف اللي فيها رصيد — المقام بتاع نسبة التقدّم.
   من غيره "47 صنف" رقم ملوش معنى. */
function scanTotalItems_() {
  try {
    var hit = fxCacheGet_('fx_scan_total');
    if (hit) return hit.n;
    var m = scanIndex_(), c = 0;
    Object.keys(m).forEach(function (k) { if (m[k].stock > 0) c++; });
    fxCachePut_('fx_scan_total', { n: c }, 1800);
    return c;
  } catch (e) { return 0; }
}

/* فتح جرد شغال للتكملة */
function loadOpenCount(sessionId) {
  try {
    var sh = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(COUNT_OPEN_SHEET);
    if (!sh || sh.getLastRow() <= 1) return { ok: false, error: 'مش موجود' };
    var d = sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues();
    for (var i = 0; i < d.length; i++) {
      if (String(d[i][0]) !== String(sessionId)) continue;
      var lines = [];
      try { lines = JSON.parse(d[i][6] || '[]'); } catch (e) {}
      return { ok: true, sessionId: String(d[i][0]), title: d[i][1],
               by: d[i][2], lines: lines };
    }
    return { ok: false, error: 'مش موجود' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function removeOpenCount_(sessionId) {
  try {
    var sh = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(COUNT_OPEN_SHEET);
    if (!sh || sh.getLastRow() <= 1) return;
    var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    for (var i = ids.length - 1; i >= 0; i--) {
      if (String(ids[i][0]) === String(sessionId)) { sh.deleteRow(i + 2); return; }
    }
  } catch (e) {}
}

// ═══════════════════════════════════════════════════════════════════
// 🔁 الفحص الدوري — إيه اللي بقاله كتير من غير جرد
//
// الفكرة: الجرد الجزئي المتكرر أنفع من الشامل النادر. الموظف يجرد
// 50 صنف في اليوم من القايمة دي، فالمشكلة تتكشف وهي صغيرة.
//
// الترتيب بالخطورة = القيمة × مدة الإهمال، مش بالمدة لوحدها —
// صنف بـ2400 جنيه معدّاش عليه 6 شهور أخطر بكتير من صنف بـ20 جنيه.
// ═══════════════════════════════════════════════════════════════════

function getCountDue(params) {
  try {
    var limit = parseInt((params && params.limit) || '60', 10);
    if (isNaN(limit) || limit < 1) limit = 60;

    /* آخر جرد لكل صنف — من سجل سطور الجرد */
    var lastSeen = {};
    var sh = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(COUNT_LINES_SHEET);
    if (sh && sh.getLastRow() > 1) {
      var d = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
      d.forEach(function (r) {
        var code = String(r[4] || '').replace(/[^\d]/g, '');
        if (!code) return;
        var when = (r[0] instanceof Date)
          ? Utilities.formatDate(r[0], 'Africa/Cairo', 'yyyy-MM-dd')
          : String(r[0]).substring(0, 10);
        if (!lastSeen[code] || when > lastSeen[code]) lastSeen[code] = when;
      });
    }

    var idx = scanIndex_();
    var today = new Date();
    var todayStr = Utilities.formatDate(today, 'Africa/Cairo', 'yyyy-MM-dd');
    var out = [], neverCount = 0, totalValue = 0;

    Object.keys(idx).forEach(function (code) {
      var it = idx[code];
      if (it.stock <= 0) return;                 // الصفر ملوش لازمة نجرده

      var value = it.stock * it.price;
      var seen = lastSeen[code] || '';
      var days;
      if (seen) {
        days = Math.floor((new Date(todayStr) - new Date(seen)) / 86400000);
      } else {
        days = 999;                              // عمره ما اتجرد
        neverCount++;
      }

      /* الخطورة = القيمة × الأيام. بنقسّم على 365 عشان الرقم يفضل
         في حجم معقول ويبقى معناه "قيمة معرّضة لسنة". */
      var risk = value * (days / 365);
      totalValue += value;

      out.push({
        code: code, name: it.name, cat: it.cat,
        stock: Math.round(it.stock * 100) / 100,
        value: Math.round(value),
        lastCount: seen, days: days === 999 ? null : days,
        risk: Math.round(risk)
      });
    });

    out.sort(function (a, b) { return b.risk - a.risk; });

    return {
      ok: true,
      total: out.length,
      never_counted: neverCount,
      total_value: Math.round(totalValue),
      items: out.slice(0, limit)
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* أسماء الموظفين لشاشة الجرد — الموظف بيختار من قايمة بدل ما يكتب.
   الكتابة اليدوية كانت بتنتج "أحمد" و"احمد" و"احمد " كأنهم تلاتة. */
function getScanStaff() {
  try {
    var out = [];
    Object.keys(EMPLOYEES).forEach(function (k) {
      out.push({ id: k, name: EMPLOYEES[k] });
    });
    return { ok: true, staff: out };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════
// 🔧 أمر تصحيح الأرصدة — ناتج الجرد بيتحوّل لليستة تنفيذية للمدير
//
// المدير مش محتاج تحليل، محتاج يعرف بالظبط إيه اللي يكتبه في نظام
// البيع. عشان كده الكود بييجي الأول (بيدوّر بيه مباشرة مش بالاسم)،
// والصلاحيات الجديدة في قسم منفصل لأنها إدخال دفعة مش تصحيح رصيد.
// ═══════════════════════════════════════════════════════════════════

function getFixOrder(sessionId) {
  try {
    var rep = getCountReport(sessionId);
    if (!rep || !rep.ok) return { ok: false, error: (rep && rep.error) || 'مفيش بيانات' };

    var idx = scanIndex_();
    var fixes = [], newBatches = [], netValue = 0;

    (rep.lines || []).forEach(function (L) {
      if (Math.abs(L.diff) <= 0.001) return;      // مطابق، مش محتاج حاجة
      var it = idx[L.code] || null;
      var row = {
        code: L.code, name: L.name,
        expire: (L.expire && L.expire !== '—') ? L.expire : '',
        sys: L.sys, counted: L.counted, diff: L.diff,
        value: L.diffValue,
        units: it ? (it.units || 1) : 1
      };
      netValue += (L.diffValue || 0);

      /* الصلاحية اللي الموظف لقاها ومش في السيستم = إدخال دفعة جديدة،
         مش تعديل رصيد. المدير بيعملها بخطوة مختلفة تمامًا. */
      if (String(L.note || '').indexOf('صلاحية زيادة') !== -1) newBatches.push(row);
      else fixes.push(row);
    });

    fixes.sort(function (a, b) { return Math.abs(b.value) - Math.abs(a.value); });
    newBatches.sort(function (a, b) { return Math.abs(b.value) - Math.abs(a.value); });

    var head = getCountSessions();
    var meta = { title: '', by: '', at: '' };
    if (head && head.ok) {
      var m = (head.sessions || []).filter(function (x) { return String(x.id) === String(sessionId); })[0];
      if (m) meta = { title: m.title, by: m.by, at: String(m.at) };
    }

    return {
      ok: true, sessionId: sessionId, meta: meta,
      fixes: fixes, newBatches: newBatches,
      count: fixes.length + newBatches.length,
      netValue: Math.round(netValue),
      text: buildFixText_(meta, fixes, newBatches, netValue)
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* نص جاهز للنسخ — مصمّم يتقرا على الموبايل من غير جدول */
function buildFixText_(meta, fixes, newB, netValue) {
  var L = [];
  L.push('🔧 تصحيح أرصدة');
  L.push(meta.title || 'جرد');
  if (meta.by) L.push('جرد بواسطة: ' + meta.by);
  L.push(SEP);

  if (fixes.length) {
    L.push('');
    L.push('📝 تعديل رصيد (' + fixes.length + ')');
    fixes.forEach(function (r) {
      L.push('');
      L.push('• ' + r.name);
      L.push('  كود: ' + r.code);
      if (r.expire) L.push('  صلاحية: ' + r.expire);
      L.push('  السيستم ' + r.sys + ' ← الصح ' + r.counted +
             '  (' + (r.diff > 0 ? '+' : '') + r.diff + ')');
    });
  }

  if (newB.length) {
    L.push('');
    L.push(SEP);
    L.push('🆕 صلاحيات مش مسجلة (' + newB.length + ')');
    L.push('دي دفعات موجودة على الرف ومش في السيستم — تتدخل كدفعة جديدة');
    newB.forEach(function (r) {
      L.push('');
      L.push('• ' + r.name);
      L.push('  كود: ' + r.code);
      L.push('  صلاحية: ' + (r.expire || '؟'));
      L.push('  الكمية: ' + r.counted);
    });
  }

  L.push('');
  L.push(SEP);
  L.push('صافي فرق القيمة: ' + Math.round(netValue) + ' جنيه');
  return L.join('\n');
}

/* بعت الأمر على جروب الموظفين. الرسايل الطويلة بتتقسّم —
   تليجرام سقفه 4096 حرف وبيرفض اللي أطول من غير رسالة واضحة. */
function sendFixOrder(sessionId) {
  try {
    var f = getFixOrder(sessionId);
    if (!f.ok) return f;
    if (!f.count) return { ok: false, error: 'مفيش فروقات — الجرد كله مطابق' };

    var t = f.text, max = 3800;
    if (t.length <= max) {
      sendTelegramStaff(t, STAFF_GROUP);
    } else {
      var parts = [], cur = '';
      t.split('\n').forEach(function (line) {
        if ((cur + line).length > max) { parts.push(cur); cur = ''; }
        cur += line + '\n';
      });
      if (cur) parts.push(cur);
      parts.forEach(function (p, i) {
        sendTelegramStaff(p + (parts.length > 1 ? ('\n(' + (i+1) + '/' + parts.length + ')') : ''),
                          STAFF_GROUP);
        Utilities.sleep(400);
      });
    }
    return { ok: true, sent: f.count, parts: Math.ceil(t.length / max) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* 🗑️ مسح جرد — الجلسة وكل سطورها.
   ⚠️ مالوش رجعة، عشان كده بينادى من doPost بس (مش من رابط)
   ولازم يتبعت معاه confirm:'DELETE' — عشان نقرة غلط متمسحش شغل يوم. */
function deleteCountSession(data) {
  try {
    var id = String((data && data.sessionId) || '').trim();
    if (!id) return { ok: false, error: 'رقم الجلسة ناقص' };
    if (String(data.confirm || '') !== 'DELETE') {
      return { ok: false, error: 'التأكيد ناقص' };
    }

    var ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
    var removed = 0, title = '';

    /* السطور — بنمشي من تحت لفوق عشان حذف صف ميزحلقش اللي بعده */
    var ls = ss.getSheetByName(COUNT_LINES_SHEET);
    if (ls && ls.getLastRow() > 1) {
      var lr = ls.getRange(2, 2, ls.getLastRow() - 1, 1).getValues();
      for (var i = lr.length - 1; i >= 0; i--) {
        if (String(lr[i][0]) === id) { ls.deleteRow(i + 2); removed++; }
      }
    }

    /* رأس الجلسة */
    var hs = ss.getSheetByName(COUNT_SESSIONS_SHEET);
    if (hs && hs.getLastRow() > 1) {
      var hr = hs.getRange(2, 1, hs.getLastRow() - 1, 3).getValues();
      for (var j = hr.length - 1; j >= 0; j--) {
        if (String(hr[j][1]) === id) { title = hr[j][2]; hs.deleteRow(j + 2); }
      }
    }

    /* الجرد الشغال — ده اللي كان بيفضل موجود لأن المسح كان
       بيشوف المقفولة بس */
    var wasOpen = false;
    var os = ss.getSheetByName(COUNT_OPEN_SHEET);
    if (os && os.getLastRow() > 1) {
      var or_ = os.getRange(2, 1, os.getLastRow() - 1, 2).getValues();
      for (var z = or_.length - 1; z >= 0; z--) {
        if (String(or_[z][0]) === id) {
          if (!title) title = or_[z][1];
          os.deleteRow(z + 2); wasOpen = true;
        }
      }
    }

    if (!removed && !title && !wasOpen) return { ok: false, error: 'الجرد ده مش موجود' };

    sendTelegramStaff('🗑️ اتمسح جرد: ' + (title || id) +
      ' (' + removed + ' سطر)', PERSONAL_CHAT);
    return { ok: true, removed: removed, title: title };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════
// ⚡ فهرس المسح — ينزل على الموبايل مرة واحدة في أول الجرد
//
// المشكلة: كنا بنعمل نداء شبكة لكل مسحة. على النت المصري ده
// 0.5–2 ثانية × 2,309 صنف = ~40 دقيقة انتظار صافي.
//
// الحل: الفهرس كله (~400 ك.ب) ينزل مرة واحدة، وبعدها كل مسحة
// بتلاقي الصنف فورًا من غير نت.
//
// التنازل: الأرصدة ممكن تبقى قديمة بساعة. بس ده مش عيب —
// وقت اللقطة بيتسجل مع كل سطر، فالتقرير بيقول "السيستم كان 2
// الساعة 9:15" وإنت تقدر تراجع الحركة بينها وبين وقت العدّ.
// ═══════════════════════════════════════════════════════════════════

function getScanBundle() {
  try {
    var m = scanIndex_();
    var at = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss');
    var ms = Date.now();

    /* مصفوفات مش كائنات — بتوفّر ~40% من الحجم على النت */
    var items = [];
    Object.keys(m).forEach(function (code) {
      var it = m[code];
      items.push([
        code,
        it.name,
        it.units || 1,
        it.multi ? 1 : 0,
        (it.batches || []).map(function (b) { return [b.expire || '', b.stock || 0]; })
      ]);
    });

    return { ok: true, at: at, ms: ms, count: items.length, items: items };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════
// 👥 اللي شغال دلوقتي + جرد كل موظف خلال فترة
//
// ⚠️ المقياس هنا "صنف" مش "علبة" عن قصد.
// لو قسنا بالعلبة، الموظف هيدوّر على الرفوف اللي فيها كميات كبيرة
// (علبة فيها 20 = 20 دوسة) ويسيب الرفوف الصعبة اللي فيها أصناف
// متفرقة وصلاحيات متعددة — وهي بالظبط اللي بتخبّي المشاكل.
// "الأصناف اللي فيها فرق" أهم رقم: اللي بيلاقي فروقات بيبص فعلاً.
// ═══════════════════════════════════════════════════════════════════

function getCountActivity(params) {
  try {
    var R = resolveRange_(params);
    var byWho = {}, live = [];

    function touch(who) {
      if (!byWho[who]) byWho[who] = { who: who, items: {}, units: 0, gaps: 0, days: {}, last: 0 };
      return byWho[who];
    }

    /* (١) الجرود المقفولة — من سطور الجرد */
    var ls = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(COUNT_LINES_SHEET);
    if (ls && ls.getLastRow() > 1) {
      var d = ls.getRange(2, 1, ls.getLastRow() - 1, 10).getValues();
      d.forEach(function (r) {
        var day = (r[0] instanceof Date)
          ? Utilities.formatDate(r[0], 'Africa/Cairo', 'yyyy-MM-dd')
          : String(r[0]).substring(0, 10);
        if (day < R.from || day > R.to) return;
        var who = String(r[3] || '').trim() || 'مش معروف';
        var a = touch(who);
        a.items[String(r[4])] = 1;
        a.units += (parseFloat(r[8]) || 0);
        if (Math.abs(parseFloat(r[9]) || 0) > 0.001) a.gaps++;
        a.days[day] = 1;
      });
    }

    /* (٢) الجرود الشغالة — لسه متسجلتش في السطور */
    var os = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(COUNT_OPEN_SHEET);
    if (os && os.getLastRow() > 1) {
      var o = os.getRange(2, 1, os.getLastRow() - 1, 8).getValues();
      o.forEach(function (r) {
        var lines = [];
        try { lines = JSON.parse(r[6] || '[]'); } catch (e) {}
        var perWho = {};

        lines.forEach(function (L) {
          if (!L || !L.code) return;
          var when = +L.at || 0;
          var day = when ? Utilities.formatDate(new Date(when), 'Africa/Cairo', 'yyyy-MM-dd')
                         : String(r[4]).substring(0, 10);
          if (day < R.from || day > R.to) return;

          var who = String(L.who || r[2] || '').trim() || 'مش معروف';
          var a = touch(who);
          a.items[L.code] = 1;
          a.units += (+L.qty || 0);
          if (Math.abs((+L.qty || 0) - (+L.sys || 0)) > 0.001) a.gaps++;
          a.days[day] = 1;
          if (when > a.last) a.last = when;

          if (!perWho[who]) perWho[who] = { items: {}, units: 0, last: 0 };
          perWho[who].items[L.code] = 1;
          perWho[who].units += (+L.qty || 0);
          if (when > perWho[who].last) perWho[who].last = when;
        });

        /* مين شغال دلوقتي — آخر مسحة خلال ساعتين */
        var cutoff = Date.now() - 2 * 3600 * 1000;
        Object.keys(perWho).forEach(function (w) {
          if (perWho[w].last < cutoff) return;
          live.push({
            who: w, session: String(r[0]), title: r[1],
            items: Object.keys(perWho[w].items).length,
            units: Math.round(perWho[w].units * 100) / 100,
            lastMs: perWho[w].last
          });
        });
      });
    }

    var total = scanTotalItems_();
    var staff = Object.keys(byWho).map(function (w) {
      var a = byWho[w];
      var items = Object.keys(a.items).length;
      return {
        who: w, items: items,
        units: Math.round(a.units * 100) / 100,
        gaps: a.gaps,
        days: Object.keys(a.days).length,
        coverage: total ? Math.round(items / total * 1000) / 10 : 0,
        lastMs: a.last
      };
    });
    /* الترتيب بالتغطية مش بالكمية — عشان مفيش مكسب من مطاردة العلب */
    staff.sort(function (a, b) { return b.items - a.items; });

    live.sort(function (a, b) { return b.lastMs - a.lastMs; });

    return { ok: true, label: R.label, from: R.from, to: R.to,
             total: total, staff: staff, live: live };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════
// 💸 المصروفات — قراءة مباشرة من ملفات Drive
//
// ⚠️ ليه اتغيّرت:
// السلسلة القديمة كانت 3 خطوات: نظام البيع → xlsx على Drive →
// شيت جوجل → الداشبورد. الخطوة الوسطانية (التحويل للشيت) وقفت
// يوم 2 أغسطس من غير ما حد يلاحظ، فالداشبورد فضل يعرض بيانات
// عمرها 9 أيام وكأنها صح.
//
// دلوقتي بنقرا الـxlsx من Drive مباشرة — نفس اللي بنعمله مع ملفات
// المبيعات الخام من شهور. خطوة أقل = نقطة فشل أقل.
//
// ⚠️ تصحيح: Expenses_*.xlsx مش تراكمي. كل نسخة فيها الحركات من آخر
// تقفيل بس (يومين-تلاتة)، واللي اتقفل بيختفي من النسخة الجاية. ولما
// التصدير بيقف أو بيطلع متقطع، الأيام اللي بينهم مالهاش نسخة خالص.
// عشان كده: (١) كل ما نقرا الملف نحفظ حركاته في أرشيف دائم بالتسلسل،
// (٢) وبنسجّل إجمالي المصروفات المتنوعة اليومي من Daily_Mini_Statics
//     (بيتحدّث لحظي) ونكمّل بيه أي يوم ناقص.
// ═══════════════════════════════════════════════════════════════════

var EXPORT_FOLDER = '1Vq85t_jS3sS4s0JHjP5uo3nHZxOAltpb';

/* بيلاقي أحدث ملف مصروفات وبيحوّله لصفوف */
/* تحويل ملف xlsx واحد لصفوف — Drive REST مباشرة (من غير تفعيل خدمة متقدمة) */
function xlsxToRows_(file) {
  var res = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + file.getId() +
    '/copy?fields=id&supportsAllDrives=true',
    { method: 'post', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      payload: JSON.stringify({ name: '__tmp_exp_' + Date.now(), mimeType: MimeType.GOOGLE_SHEETS }),
      muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    var why = ''; try { why = JSON.parse(res.getContentText()).error.message; } catch (e) { why = res.getContentText().slice(0, 150); }
    return { ok: false, error: 'تحويل الملف فشل: ' + res.getResponseCode() + (why ? ' — ' + why : '') };
  }
  var tmpId = JSON.parse(res.getContentText()).id, rows = [];
  try {
    var sh = SpreadsheetApp.openById(tmpId).getSheets()[0];
    if (sh.getLastRow() > 1) rows = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
  } finally {
    try { DriveApp.getFileById(tmpId).setTrashed(true); } catch (e) {}
  }
  return { ok: true, rows: rows };
}

/* بيلاقي أحدث ملف مصروفات وبيحوّله لصفوف */
function readExpenseFile_() {
  try {
    var folder = DriveApp.getFolderById(EXPORT_FOLDER);
    var files = folder.getFilesByName('Expenses_9882-3C97_1.xlsx');
    var newest = null;
    while (files.hasNext()) {
      var f = files.next();
      if (!newest || f.getLastUpdated() > newest.getLastUpdated()) newest = f;
    }
    if (!newest) return { ok: false, error: 'ملف المصروفات مش موجود' };
    var r = xlsxToRows_(newest);
    if (!r.ok) return r;
    return { ok: true, rows: r.rows,
             at: Utilities.formatDate(newest.getLastUpdated(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss') };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* بيحوّل صفوف الملف لسطور مصروفات موحّدة */
function parseExpenseRows_(rows) {
  if (!rows || rows.length < 2) return [];
  var hdr = rows[0].map(function (h) { return String(h || '').trim(); });
  var ix = {};
  hdr.forEach(function (h, i) { ix[h] = i; });

  /* الأعمدة بالاسم مش بالرقم — النظام بيغيّر الترتيب أحيانًا */
  var cType = (ix['النوع']   !== undefined) ? ix['النوع']   : 3;
  var cVal  = (ix['القيمة']  !== undefined) ? ix['القيمة']  : 4;
  var cTime = (ix['الوقـت']  !== undefined) ? ix['الوقـت']  : 5;
  var cName = (ix['المصروفات']!== undefined) ? ix['المصروفات']: 1;
  var cDet  = (ix['التفاصيل'] !== undefined) ? ix['التفاصيل'] : 2;
  var cId   = (ix['التسلسل']  !== undefined) ? ix['التسلسل']  : 0;
  var cComp = (ix['الشركة']    !== undefined) ? ix['الشركة']    : -1;
  var cStaff= (ix['اسم الموظف']!== undefined) ? ix['اسم الموظف']: -1;

  var out = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];

    /* ⚠️ إصلاح الزحلقة:
       لما خانة "التفاصيل" تبقى فاضية، بعض المصادر بتسقطها خالص
       بدل ما تسيبها فاضية — فكل الأعمدة بتتزحلق مكان لورا.
       مثال حقيقي (مصروفات متنوعة):
         الصح:   2929 | صور فوتير | (فاضي) | مصروفات متنوعة | 20 | 2026-08-01
         المكسور: 2929 | صور فوتير | مصروفات متنوعة | 20 | 2026-08-01
       فالوقت كان بيتقرا "20" بدل التاريخ، والسطر يتفلتر ويختفي.

       الحل: بندوّر على التاريخ في الصف كله بدل ما نثق في رقم العمود. */
    var shift = 0;
    var tsRaw = String(r[cTime] || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}/.test(tsRaw)) {
      for (var k = 0; k < r.length; k++) {
        if (/^\d{4}-\d{2}-\d{2}[ T]/.test(String(r[k] || '').trim())) {
          shift = k - cTime;   /* بكام خانة اتزحلق الصف */
          break;
        }
      }
    }
    function col(base) {
      var v = r[base + shift];
      return (v === undefined || v === null) ? '' : String(v).trim();
    }

    var cat = col(cType);
    if (!cat) continue;
    var ts = col(cTime).substring(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ts)) continue;
    out.push({
      id: String(r[cId] || ''),           /* التسلسل قبل الزحلقة دايمًا */
      category: cat,
      amount: parseFloat(col(cVal).replace(/,/g, '')) || 0,
      date: ts,
      time: col(cTime).substring(11, 16),
      name: col(cName),
      detail: shift ? '' : col(cDet),     /* الزحلقة معناها التفاصيل فاضية */
      company: (cComp !== -1) ? col(cComp) : '',
      staff: (cStaff !== -1) ? col(cStaff) : '',
      /* الإيراد مش مصروف — بيتفلتر في الحسابات وبيتعرض لوحده */
      isIncome: cat.indexOf('ايراد') === 0
    });
  }
  return out;
}

/* أرشيف الشيت — للشهور القديمة اللي مش في الملف الحالي */
function readExpenseSheet_() {
  var out = [];
  try {
    var ss = SpreadsheetApp.openById(EXPENSES_SHEET_ID);
    ['Daily_Expenses', 'Monthly_Expenses'].forEach(function (name) {
      var sh = ss.getSheetByName(name);
      if (!sh || sh.getLastRow() <= 1) return;
      var rows = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
      out = out.concat(parseExpenseRows_(rows));
    });
  } catch (e) {}
  return out;
}

/* المصدر الموحّد: الملف الحي + الأرشيف، من غير تكرار */
var EXP_LEDGER_SHEET  = 'سجل يومي للمصروفات';
var EXP_ARCHIVE_SHEET = 'أرشيف المصروفات';

/* نوع الحركة: المتنوعة (الوحيدة اللي بنكمّلها من السجل) أو المشتروات */
function expKind_(cat) {
  cat = String(cat || '');
  if (cat.indexOf('متنوعة') !== -1) return 'misc';
  if (cat.indexOf('مشتروات') !== -1) return 'purch';
  return '';
}

/* "09/10/2026 - 11:45 PM" → "2026-10-09". لو مش مفهوم بنرجّع فاضي ومبنخمّنش */
function statsDay_(s) {
  var m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return '';
  return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
}

/* حفظ دائم لحركات الملف بالتسلسل. الملف بيشيل اللي اتقفل، فلو متحفظش هنا بيضيع. */
function archiveExpenses_(items) {
  if (!items || !items.length) return 0;
  var sh = getOrCreateSheet_(EXP_ARCHIVE_SHEET,
    ['التسلسل', 'النوع', 'القيمة', 'التاريخ', 'الوقت', 'المصروف', 'التفاصيل', 'الشركة', 'الموظف', 'إيراد', 'أُضيف']);
  sh.getRange('A:A').setNumberFormat('@');
  sh.getRange('D:D').setNumberFormat('@');
  var seen = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues().forEach(function (r) { seen[String(r[0])] = 1; });
  }
  var now = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss'), rows = [];
  items.forEach(function (e) {
    if (!e.id || seen[e.id]) return;
    seen[e.id] = 1;
    rows.push([e.id, e.category, e.amount, e.date, e.time || '', e.name || '', e.detail || '',
               e.company || '', e.staff || '', e.isIncome ? 1 : 0, now]);
  });
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, 11).setValues(rows);
  return rows.length;
}

function readExpenseArchive_() {
  var out = [];
  try {
    var sh = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(EXP_ARCHIVE_SHEET);
    if (!sh || sh.getLastRow() <= 1) return out;
    sh.getRange(2, 1, sh.getLastRow() - 1, 10).getDisplayValues().forEach(function (r) {
      out.push({ id: String(r[0]), category: r[1],
                 amount: parseFloat(String(r[2]).replace(/,/g, '')) || 0,
                 date: String(r[3]).substring(0, 10), time: r[4], name: r[5], detail: r[6],
                 company: r[7], staff: r[8], isIncome: String(r[9]) === '1' });
    });
  } catch (e) {}
  return out;
}

/* السجل اليومي: كل ساعة بنكتب إجمالي النهاردة وإمبارح من Daily_Mini_Statics.
   "اليوم" هنا هو يوم الإحصائية نفسها (مش يوم السكربت) — لو الجهاز اتأخر في
   التحديث مبنسجّلش بيانات يوم على يوم تاني. */
function recordDailyStats_() {
  var t = getSystemDailyTotals();
  if (!t || !t.ok) return { ok: false, error: 'الإحصائيات مش متاحة' };
  var day = statsDay_(t.updated_at);
  if (!day) return { ok: false, error: 'مقدرتش أفهم تاريخ الإحصائية: ' + t.updated_at };
  var prev = Utilities.formatDate(new Date(new Date(day + 'T12:00:00').getTime() - 86400000), 'Africa/Cairo', 'yyyy-MM-dd');

  var sh = getOrCreateSheet_(EXP_LEDGER_SHEET, ['التاريخ', 'مصروفات متنوعة', 'مشتروات الشركات', 'آخر تحديث', 'مصدر']);
  sh.getRange('A:A').setNumberFormat('@');
  var rowOf = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues().forEach(function (r, i) { rowOf[String(r[0]).substring(0, 10)] = i + 2; });
  }
  var now = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss'), written = 0;
  function upsert(d, misc, purch, src) {
    var vals = [[d, misc, purch, now, src]];
    if (rowOf[d]) sh.getRange(rowOf[d], 1, 1, 5).setValues(vals);
    else { sh.getRange(sh.getLastRow() + 1, 1, 1, 5).setValues(vals); rowOf[d] = sh.getLastRow(); }
    written++;
  }
  upsert(prev, t.misc_yesterday || 0, t.purch_yesterday || 0, 'أمس');
  upsert(day,  t.misc_today || 0,     t.purch_today || 0,     'النهاردة');
  fxClearCache_('fx_exp_all');
  return { ok: true, day: day, written: written, misc_today: t.misc_today, misc_yesterday: t.misc_yesterday };
}

function readLedger_() {
  var out = [];
  try {
    var sh = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(EXP_LEDGER_SHEET);
    if (!sh || sh.getLastRow() <= 1) return out;
    sh.getRange(2, 1, sh.getLastRow() - 1, 3).getDisplayValues().forEach(function (r) {
      var day = String(r[0] || '').substring(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
      out.push({ day: day, misc: parseFloat(String(r[1]).replace(/,/g, '')) || 0,
                 purch: parseFloat(String(r[2]).replace(/,/g, '')) || 0 });
    });
  } catch (e) {}
  return out;
}

/* بيكمّل المتنوعة بالفرق عن إجمالي النظام اليومي.
   ⚠️ المتنوعة بس — المشتريات مبنكمّلهاش لأني مش متأكد إن تعريف "مشتروات
   الشركات" في إحصائيات النظام نفس اللي في ملف المصروفات، ولو اختلف هنضيف
   فروق وهمية. المتنوعة هي اللي بتدخل في حساب الربح الصافي. */
function applyLedger_(items, ledger) {
  var sums = {};
  items.forEach(function (e) {
    if (e.isIncome) return;
    if (expKind_(e.category) !== 'misc') return;
    sums[e.date] = (sums[e.date] || 0) + e.amount;
  });
  var extra = [];
  ledger.forEach(function (L) {
    var have = sums[L.day] || 0;
    var diff = Math.round((L.misc - have) * 100) / 100;
    if (diff > 0.5) {
      extra.push({ id: 'L-' + L.day + '-misc', category: 'مصروفات متنوعة', amount: diff,
                   date: L.day, time: '',
                   name: have > 0 ? 'فرق غير مفصّل (إجمالي اليوم من النظام)' : 'إجمالي اليوم من النظام',
                   detail: '', company: '', staff: '', isIncome: false, fromLedger: true });
    }
  });
  return items.concat(extra);
}

/* ملفات التصدير بفترة يدوية "Expenses From ..." — بتتحوّل مرة لكل نسخة وتتحفظ في الأرشيف */
function ingestPeriodExpenseFiles_() {
  var props = PropertiesService.getScriptProperties(), added = 0, items = [];
  var done = {};
  try { done = JSON.parse(props.getProperty('exp_period_done') || '{}'); } catch (e) {}
  var it = DriveApp.searchFiles("title contains 'Expenses From' and trashed = false");
  var n = 0;
  while (it.hasNext() && n < 10) {
    var f = it.next(); n++;
    if (!/\.xlsx$/i.test(f.getName())) continue;
    var sig = String(f.getLastUpdated().getTime());
    if (done[f.getId()] === sig) continue;
    var r = xlsxToRows_(f);
    if (!r.ok) continue;
    items = items.concat(parseExpenseRows_(r.rows));
    done[f.getId()] = sig;
  }
  if (items.length) added = archiveExpenses_(items);
  props.setProperty('exp_period_done', JSON.stringify(done));
  return added;
}

/* ملفات "Company Paid Expenses" الشهرية: بتسد فجوة المشتروات بعد آخر مشتروات مفصّلة حقيقية */
function readCompanyPaid_() {
  var out = [];
  try {
    var cache = fxCacheGet_('fx_cpaid');
    if (cache) return cache;
    var it = DriveApp.searchFiles("title contains 'Company Paid Expenses' and trashed = false");
    var files = [];
    while (it.hasNext()) files.push(it.next());
    files.sort(function (a, b) { return b.getLastUpdated() - a.getLastUpdated(); });
    files.slice(0, 2).forEach(function (f) {
      var r = xlsxToRows_(f);
      if (!r.ok) return;
      r.rows.slice(1).forEach(function (row) {
        var cname = String(row[2] || '').trim();
        var det = String(row[5] || '');
        var re = /invoice:(\d+)\s+paid:([\d.]+)\s+at:(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/g, m;
        while ((m = re.exec(det))) {
          if (m[1] === '0') continue;   /* دفعات من غير فاتورة مش مشتروات */
          out.push({ id: 'CP-' + m[1] + '-' + m[3] + m[4] + '-' + m[2], category: 'مصروفات مشتروات شركات',
                     amount: parseFloat(m[2]) || 0, date: m[3], time: m[4],
                     name: (cname || 'الصيدلية') + ',' + m[1], detail: '', company: cname, staff: '',
                     isIncome: false, fromCompanyPaid: true });
        }
      });
    });
    fxCachePut_('fx_cpaid', out, 1800);
  } catch (e) {}
  return out;
}

/* ═══ المصروفات من النسخة الاحتياطية لـ Pharmaclick ═══
   الإكسبورت وقف من 4 أكتوبر، لكن الباك أب (كل 3–4 ساعات) فيه جدول expenses كامل.
   التسلسل في الباك أب = نفس "التسلسل" في الإكسبورت القديم، فمفيش تكرار في الأرشيف.
   out = مصروفات متنوعة · pay = مشتروات شركات · salary = مرتبات · debits = ايراد مديونيات */
var EXP_TYPE_CAT_ = { out: 'مصروفات متنوعة', pay: 'مصروفات مشتروات شركات', salary: 'مصروفات مرتبات', debits: 'ايراد مديونيات' };
function syncExpensesFromBackup_(force) {
  var P = PropertiesService.getScriptProperties();
  var it = DriveApp.searchFiles("title contains 'pharmaclick_backup_9882' and trashed = false"), newest = null;
  while (it.hasNext()) { var f = it.next(); if (!newest || f.getLastUpdated() > newest.getLastUpdated()) newest = f; }
  if (!newest) return { ok: false, error: 'مفيش نسخة احتياطية' };
  var sig = newest.getId() + '|' + newest.getLastUpdated().getTime();
  if (!force && P.getProperty('exp_bk_sig') === sig) return { ok: true, skipped: true, file: newest.getName() };
  var blob = newest.getBlob(); blob.setContentType('application/zip');
  var sql = '';
  Utilities.unzip(blob).forEach(function (e) { if (!sql && /\.sql$/i.test(e.getName())) sql = e.getDataAsString('UTF-8'); });
  if (!sql) return { ok: false, error: 'ملف SQL مش موجود في النسخة' };

  function table(name) {
    var cols = sqlColumns_(sql, name), rows = sqlTableRows_(sql, name).rows;
    return rows.map(function (x) { var v = sqlVals_(x), o = {}; cols.forEach(function (c, i) { o[c] = v[i]; }); return o; });
  }
  var users = {}, comps = {};
  table('users').forEach(function (u) { users[u.id] = u.name || ''; });
  table('companies').forEach(function (c) { comps[c.id] = c.namear || c.name || ''; });
  var exp = table('expenses');
  sql = null;   /* نفضّي الذاكرة */

  var items = [];
  exp.forEach(function (r) {
    if (String(r.deleted) === '1') return;
    var cat = EXP_TYPE_CAT_[r.type]; if (!cat) return;
    var ts = String(r.time || '');
    if (!/^\d{4}-\d{2}-\d{2}/.test(ts)) return;
    items.push({ id: String(r.id), category: cat, amount: parseFloat(r.value) || 0,
                 date: ts.slice(0, 10), time: ts.slice(11, 16),
                 name: String(r.title || '').replace(/,\d+,دفع مباشر$/, ''), detail: String(r.details || '').trim(),
                 company: (+r.companyid > 3 ? comps[r.companyid] || '' : ''), staff: users[r.userid] || '',
                 isIncome: r.type === 'debits' });
  });
  var added = archiveExpenses_(items);
  P.setProperty('exp_bk_sig', sig);
  P.setProperty('exp_bk_last', JSON.stringify({ at: Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm'),
    file: newest.getName(), rows: items.length, added: added }));
  fxClearCache_('fx_exp_all');
  return { ok: true, file: newest.getName(), rows: items.length, added: added,
           lastDate: items.reduce(function (m, x) { return x.date > m ? x.date : m; }, '') };
}
function syncExpensesFromBackup() { return syncExpensesFromBackup_(false); }   /* للتريجر */
function ensureExpenseBackupTrigger_() {
  var P = PropertiesService.getScriptProperties();
  if (P.getProperty('exp_bk_trigger') === '1') return false;
  var has = ScriptApp.getProjectTriggers().some(function (tr) { return tr.getHandlerFunction() === 'syncExpensesFromBackup'; });
  if (!has) ScriptApp.newTrigger('syncExpensesFromBackup').timeBased().everyHours(2).create();
  P.setProperty('exp_bk_trigger', '1');
  return true;
}

/* المصدر الموحّد: الملف الحي + الأرشيف الدائم + الشيتات القديمة + السجل اليومي */
function allExpenses_() {
  var hit = fxCacheGet_('fx_exp_all');
  if (hit) return hit;
  /* أول مرة: نركّب التحديث التلقائي كل ساعتين ونسحب من الباك أب على طول */
  try { if (ensureExpenseBackupTrigger_()) syncExpensesFromBackup_(true); } catch (e) { Logger.log('exp backup: ' + e.message); }

  var file = readExpenseFile_();
  var live = (file.ok) ? parseExpenseRows_(file.rows) : [];
  try { if (live.length) archiveExpenses_(live); } catch (e) {}
  try { ingestPeriodExpenseFiles_(); } catch (e) {}

  var seen = {}, merged = [];
  live.concat(readExpenseArchive_()).concat(readExpenseSheet_()).forEach(function (e) {
    var k = e.id ? ('#' + e.id) : (e.date + '|' + e.category + '|' + e.amount + '|' + e.name);
    if (seen[k]) return;
    seen[k] = 1; merged.push(e);
  });

  /* آخر حركة مفصّلة حقيقية — قبل ما السجل يضيف صفوفه التكميلية */
  merged.sort(function (a, b) { return b.date.localeCompare(a.date); });
  var latestItem = merged.length ? merged[0].date : '';

  /* سد فجوة المشتروات من ملف المدفوعات للشركات (بعد آخر مشتروات حقيقية فقط) */
  var lastPurch = '';
  merged.forEach(function (e) { if (!e.isIncome && expKind_(e.category) === 'purch' && e.date > lastPurch) lastPurch = e.date; });
  var cp = readCompanyPaid_().filter(function (e) { return e.date > lastPurch; });
  merged = merged.concat(cp);

  var ledger = readLedger_();
  merged = applyLedger_(merged, ledger);
  merged.sort(function (a, b) { return b.date.localeCompare(a.date); });

  /* "واقفة" = مفيش أي إشارة حياة: لا حركة مفصّلة ولا سجل يومي حديث.
     قبل كده كانت بتبص على آخر حركة بس، فيوم من غير مصروفات كان بيبان كأن
     التصدير واقف. */
  var latestLedger = ledger.reduce(function (m, L) { return L.day > m ? L.day : m; }, '');
  var latest = (latestLedger > latestItem) ? latestLedger : latestItem;

  var out = {
    ok: true, items: merged,
    fileAt: file.ok ? file.at : '',
    fileError: file.ok ? '' : file.error,
    latestEntry: latest,
    latestItemized: latestItem,
    itemizedStaleDays: latestItem
      ? Math.floor((new Date(Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd'))
                    - new Date(latestItem)) / 86400000)
      : null,
    companyPaidFrom: lastPurch,
    companyPaidRows: cp.length,
    ledgerDays: ledger.length,
    staleDays: latest
      ? Math.floor((new Date(Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd'))
                    - new Date(latest)) / 86400000)
      : null
  };
  fxCachePut_('fx_exp_all', out, 600);
  return out;
}

/* مرة واحدة: بيقرا كل النسخ القديمة من ملف المصروفات على Drive ويحفظ حركاتها
   في الأرشيف. بيجيب كل اللي لسه ظاهر في أي نسخة — اللي اتقفل ومفيش نسخة
   فيه مش ممكن يتجاب. */
function backfillExpenseArchive() {
  var lock = LockService.getScriptLock();
  try { if (!lock.tryLock(30000)) return { ok: false, error: 'مشغول — جرب كمان شوية' }; }
  catch (e) { return { ok: false, error: 'مشغول' }; }
  try {
    var folder = DriveApp.getFolderById(EXPORT_FOLDER);
    var it = folder.getFilesByName('Expenses_9882-3C97_1.xlsx'), list = [];
    while (it.hasNext()) list.push(it.next());
    list.sort(function (a, b) { return a.getLastUpdated() - b.getLastUpdated(); });

    var read = 0, added = 0, errors = [];
    list.forEach(function (f) {
      try {
        var r = xlsxToRows_(f);
        if (!r.ok) { errors.push(r.error); return; }
        read++;
        added += archiveExpenses_(parseExpenseRows_(r.rows));
      } catch (e2) { errors.push(e2.message); }
    });
    var bk = null;
    try { ensureExpenseBackupTrigger_(); bk = syncExpensesFromBackup_(true); } catch (eb) { bk = { ok: false, error: eb.message }; }
    fxClearCache_('fx_exp_all');
    return { ok: true, versions: list.length, read: read, added: added + ((bk && bk.added) || 0), errors: errors.slice(0, 3), backup: bk };
  } catch (e3) {
    return { ok: false, error: e3.message };
  } finally {
    try { lock.releaseLock(); } catch (e4) {}
  }
}

/* مراجعة المصروفات (صفحة expenses.html): الموظف المسؤول بيعلّم كل حركة "تمام" أو "محتاجة توضيح" بملاحظة */
var EXP_REVIEW_SHEET = 'مراجعة المصروفات';
function getExpReviews() {
  var out = {};
  try {
    var sh = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(EXP_REVIEW_SHEET);
    if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 5).getDisplayValues().forEach(function (r) {
      if (r[0]) out[r[0]] = { status: r[1], note: r[2], by: r[3], at: r[4] };
    });
  } catch (e) {}
  return { ok: true, reviews: out };
}
function expReview(d) {
  var id = String(d.id || '').trim();
  if (!id) return { ok: false, error: 'رقم الحركة ناقص' };
  var status = d.status === 'ask' ? 'ask' : (d.status === 'ok' ? 'ok' : '');
  var sh = getOrCreateSheet_(EXP_REVIEW_SHEET, ['الحركة', 'الحالة', 'ملاحظة', 'راجعها', 'الوقت']);
  sh.getRange('A:A').setNumberFormat('@');
  var row = [[id, status, String(d.note || '').slice(0, 300), String(d.by || '').slice(0, 40),
              Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm')]];
  var n = sh.getLastRow(), at = 0;
  if (n > 1) { var ids = sh.getRange(2, 1, n - 1, 1).getDisplayValues(); for (var i = 0; i < ids.length; i++) if (ids[i][0] === id) { at = i + 2; break; } }
  if (at) sh.getRange(at, 1, 1, 5).setValues(row); else sh.getRange(n + 1, 1, 1, 5).setValues(row);
  return { ok: true };
}

function getExpensesData(params) {
  try {
    var all = allExpenses_();
    var R = resolveRange_(params);

    /* 🔧 إصلاح: "ايراد مديونيات" كان بيتجمع في إجمالي المصروفات.
       ده فلوس داخلة مش خارجة — الإجمالي كان منفوخ بقيمتها. */
    var byCat = {}, items = [], total = 0, count = 0, income = 0, incomeCount = 0;
    var ledgerTotal = 0, ledgerCount = 0;   /* اللي اتكمّل من إجمالي النظام اليومي */

    all.items.forEach(function (e) {
      if (e.date < R.from || e.date > R.to) return;

      var row = {
        id: e.id, category: e.category, amount: e.amount,
        date: e.date, time: e.time || '',
        company: e.company || '', staff: e.staff || '',
        name: e.name || '', detail: e.detail || '',
        isIncome: !!e.isIncome, fromLedger: !!e.fromLedger,
        desc: [e.name, e.detail].filter(function (x) { return x; }).join(' — ') || '—'
      };
      items.push(row);
      if (e.fromLedger && !e.isIncome) { ledgerTotal += e.amount; ledgerCount++; }

      if (e.isIncome) { income += e.amount; incomeCount++; return; }

      if (!byCat[e.category]) byCat[e.category] = { total: 0, count: 0 };
      byCat[e.category].total += e.amount;
      byCat[e.category].count++;
      total += e.amount; count++;
    });

    var list = Object.keys(byCat).map(function (k) {
      return { category: k, total: byCat[k].total, count: byCat[k].count };
    }).sort(function (a, b) { return b.total - a.total; });

    return {
      ok: true, label: R.label, total: total, count: count,
      income: income, income_count: incomeCount,
      ledger_total: Math.round(ledgerTotal * 100) / 100, ledger_count: ledgerCount,
      byCategory: list, items: items,
      /* التنبيه: لو آخر مصروف بقاله كتير يبقى التصدير واقف */
      lastEntry: all.latestEntry,
      staleDays: all.staleDays,
      itemizedStaleDays: all.itemizedStaleDays,
      companyPaidRows: all.companyPaidRows,
      stale: (all.staleDays !== null && all.staleDays > 2),
      sourceAt: all.fileAt,
      sourceError: all.fileError
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════
// 🎯 دقة المخزون — من نتايج الجرد
//
// الفكرة: الجرد بيقارن اللي على الرف بالسيستم. كل سطر إما مطابق أو
// فيه فرق. الدقة = المطابق ÷ المتجرّد.
//
// ⚠️ حدود الرقم ده لازم تتعرف:
//   • هو دقة "اللي اتجرد" بس مش المخزون كله — لو اتجرد 10% من الأصناف
//     فالرقم عينة منهم، ولازم يتقري مع نسبة التغطية.
//   • الرصيد المقارَن بيه هو رصيد لقطة وقت العدّ (لو الموبايل بعته)،
//     وإلا رصيد وقت الحفظ — وده ممكن يتأثر بحركة بيع/استلام بينهم.
//     snapShare بيقولك كام % من السطور مقارنة بلقطة حقيقية.
//   • "صلاحية زيادة" (دفعة على الرف مش في السيستم) محسوبة غلط مش مطابقة.
// ═══════════════════════════════════════════════════════════════════
function getCountAccuracy(params) {
  try {
    var P = params || {};
    var R = resolveRange_({ range: P.range || 'all', from: P.from, to: P.to });
    var sh = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(COUNT_LINES_SHEET);
    var totalItems = scanTotalItems_();
    if (!sh || sh.getLastRow() <= 1) {
      return { ok: true, label: R.label, sessions: [], last: null, overall: null,
               byCategory: [], coverage: { counted: 0, total: totalItems, pct: 0 }, snapShare: 0 };
    }

    var d = sh.getRange(2, 1, sh.getLastRow() - 1, 14).getValues();
    var idx = scanIndex_();
    var tz = 'Africa/Cairo';
    var S = {}, order = [], cat = {}, uniq = {};
    var all = { lines: 0, matched: 0, newBatch: 0, absVal: 0, baseVal: 0, withSnap: 0 };

    function bump(o, matched, isNew, absVal, baseVal) {
      o.lines++; if (matched) o.matched++; if (isNew) o.newBatch++;
      o.absVal += absVal; o.baseVal += baseVal;
    }
    function acc(o) {
      return {
        lines: o.lines, matched: o.matched, newBatch: o.newBatch,
        accuracy: o.lines ? Math.round(o.matched / o.lines * 1000) / 10 : null,
        valueAccuracy: o.baseVal > 0 ? Math.round((1 - o.absVal / o.baseVal) * 1000) / 10 : null,
        gapValue: Math.round(o.absVal)
      };
    }

    d.forEach(function (r) {
      var sid = String(r[1] || ''); if (!sid) return;
      var day = (r[0] instanceof Date) ? Utilities.formatDate(r[0], tz, 'yyyy-MM-dd')
                                        : String(r[0] || '').substring(0, 10);
      if (day < R.from || day > R.to) return;

      var code = String(r[4] || '').replace(/[^\d]/g, '');
      var sys = parseFloat(r[7]) || 0, cnt = parseFloat(r[8]) || 0, diff = parseFloat(r[9]) || 0;
      var price = idx[code] ? idx[code].price : 0;
      var absVal = Math.abs(diff) * price, baseVal = Math.max(sys, cnt) * price;
      var isNew = String(r[12] || '').indexOf('صلاحية زيادة') !== -1;
      var matched = !isNew && Math.abs(diff) <= 0.001;
      var cname = String(r[11] || '').trim() || 'غير مصنّف';

      if (!S[sid]) {
        S[sid] = { id: sid, title: r[2], at: String(r[0] instanceof Date
                    ? Utilities.formatDate(r[0], tz, 'yyyy-MM-dd HH:mm:ss') : r[0]),
                   lines: 0, matched: 0, newBatch: 0, absVal: 0, baseVal: 0 };
        order.push(sid);
      }
      bump(S[sid], matched, isNew, absVal, baseVal);
      bump(all, matched, isNew, absVal, baseVal);
      if (String(r[13] || '') !== '') all.withSnap++;

      if (!cat[cname]) cat[cname] = { lines: 0, matched: 0, newBatch: 0, absVal: 0, baseVal: 0 };
      bump(cat[cname], matched, isNew, absVal, baseVal);

      if (code && idx[code] && idx[code].stock > 0) uniq[code] = 1;
    });

    var sessions = order.map(function (id) {
      var o = acc(S[id]); o.id = id; o.title = S[id].title; o.at = S[id].at; return o;
    }).sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });

    var byCategory = Object.keys(cat).map(function (k) {
      var o = acc(cat[k]); o.category = k; return o;
    }).sort(function (a, b) { return b.gapValue - a.gapValue; });   /* الأكبر خطأ بالفلوس فوق */

    var counted = Object.keys(uniq).length;
    return {
      ok: true, label: R.label,
      sessions: sessions,
      last: sessions.length ? sessions[0] : null,
      overall: acc(all),
      byCategory: byCategory,
      coverage: { counted: counted, total: totalItems,
                  pct: totalItems ? Math.round(counted / totalItems * 1000) / 10 : 0 },
      snapShare: all.lines ? Math.round(all.withSnap / all.lines * 100) : 0
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}


// ===================================================================
// 🏷️ ملصقات الأدوية
// الصفحة labels.html بتسأل كل 20 ثانية عن الفواتير الجديدة، الصيدلي يكتب
// العمر/الوزن ويأكد → تتطبع الملصقات. التعليمات اللي الصيدلي بيكتبها بتتحفظ
// وتتعرض اقتراح المرة الجاية لنفس الصنف ونفس الفئة (طفل/كبير).
// الجرعة الأوتوماتيك بتيجي من شيت "Sheet api" لما يبقى فيه تاب "الجرعات".
// ===================================================================

var LABELS_SHEET_API_ID = '1-4GK4K_cCP1p0qZ2KoB0yOWV0-WpNJYPvpaoMw7ypuI';
var LABELS_INSTR_SHEET  = 'تعليمات الملصقات';
var LABELS_LOG_SHEET    = 'سجل الملصقات';
var LABELS_NONDRUG_SHEET = 'أصناف مش أدوية';

/* الأصناف اللي اتأكد إنها مش أدوية (الـ AI قال كده والصيدلي ساب علامتها مشالة) */
function labelsNonDrug_() {
  var hit = fxCacheGet_('fx_lbl_nd');
  if (hit) return hit;
  var m = {};
  try {
    var sh = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(LABELS_NONDRUG_SHEET);
    if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues().forEach(function (r) { if (r[0]) m[r[0]] = 1; });
  } catch (e) {}
  fxCachePut_('fx_lbl_nd', m, 600);
  return m;
}

/* أصناف واضح من اسمها إنها مش أدوية (حفاضات، شامبو، فوط…) — من غير ما نستنى الذكاء الاصطناعي */
var NONDRUG_RX_ = new RegExp('(حفاض|بامبرز|PAMPERS|MOLFIX|DIAPER|شامبو|SHAMPOO|بلسم|CONDITIONER|صابون|SOAP|' +
  'فوط|PADS|ALWAYS|مناديل|WIPES|TISSUE|معجون اسنان|معجون أسنان|TOOTHPASTE|فرشا|TOOTHBRUSH|سرنج|SYRINGE|' +
  'قطن|COTTON|شاش|GAUZE|بلاستر|PLASTER|جوانتي|GLOVE|كمام|FACE MASK|ترمومتر|THERMOMETER|ببرون|سكات|PACIFIER|' +
  'عازل|CONDOM|DUREX|مزيل عرق|DEODORANT|بارفان|PERFUME|برفان|صبغ|HAIR COLOR|ريموفر|REMOVER|مرطب شفايف|LIP BALM|' +
  'شنطه|شنطة|جل شعر|HAIR GEL|زيت شعر|HAIR OIL|سيروم شعر|بودره اطفال|بودرة أطفال|BABY POWDER)', 'i');
function nonDrugByName_(name) { return NONDRUG_RX_.test(String(name || '')); }

function labelsKey_(name) {
  return String(name || '').toUpperCase().replace(/[^A-Z0-9؀-ۿ]+/g, ' ').trim();
}

/* التعليمات المحفوظة: key|band → {text, n} */
function labelsInstrMap_() {
  var hit = fxCacheGet_('fx_lbl_instr');
  if (hit) return hit;
  var map = {};
  try {
    var sh = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(LABELS_INSTR_SHEET);
    if (sh && sh.getLastRow() > 1) {
      sh.getRange(2, 1, sh.getLastRow() - 1, 4).getDisplayValues().forEach(function (r) {
        map[r[0] + '|' + r[1]] = { text: r[2], n: parseInt(r[3], 10) || 1 };
      });
    }
  } catch (e) {}
  fxCachePut_('fx_lbl_instr', map, 600);
  return map;
}

/* المادة الفعالة من قاعدة الأدوية (بالاسم الإنجليزي) */
function labelsDrugDb_() {
  var hit = fxCacheGet_('fx_lbl_db');
  if (hit) return hit;
  var db = {};
  try {
    var ss = SpreadsheetApp.openById(LABELS_SHEET_API_ID);
    var sh = ss.getSheetByName('قاعدة الأدوية');
    if (sh && sh.getLastRow() > 1) {
      var v = sh.getDataRange().getDisplayValues(), h = v[0].map(function (x) { return String(x).trim().toLowerCase(); });
      var cn = h.indexOf('nameen'), ca = h.indexOf('active_ingredient_en');
      for (var i = 1; i < v.length; i++) if (v[i][cn]) db[labelsKey_(v[i][cn])] = { active: v[i][ca] || '' };
    }
  } catch (e) {}
  fxCachePut_('fx_lbl_db', db, 1800);
  return db;
}

function labelsDone_() {
  var done = {};
  try {
    var sh = SpreadsheetApp.openById(STAFF_SHEET_ID).getSheetByName(LABELS_LOG_SHEET);
    if (sh && sh.getLastRow() > 1) {
      var n = Math.min(sh.getLastRow() - 1, 400);
      sh.getRange(sh.getLastRow() - n + 1, 1, n, 1).getDisplayValues().forEach(function (r) { done[String(r[0])] = 1; });
    }
  } catch (e) {}
  return done;
}

/* الفواتير الجديدة النهارده — since = آخر رقم فاتورة الصفحة شافته */
function labelsFeed(since) {
  try {
    var today = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');
    var d = getDayInvoices(today);
    if (!d || !d.ok) return { ok: false, error: (d && d.error) || 'مفيش فواتير' };
    var all = [];
    Object.keys(d.employees || {}).forEach(function (emp) {
      (d.employees[emp] || []).forEach(function (inv) { inv.employee = emp; all.push(inv); });
    });
    all.sort(function (a, b) { return parseInt(b.invoiceid, 10) - parseInt(a.invoiceid, 10); });
    var maxId = all.length ? parseInt(all[0].invoiceid, 10) : 0;
    since = parseInt(since, 10) || 0;

    var instr = labelsInstrMap_(), db = labelsDrugDb_(), done = labelsDone_(), nd = labelsNonDrug_();
    var list = all.slice(0, 40).map(function (inv) {
      var seen = {};
      var items = (inv.items || []).filter(function (it) {
        var k = labelsKey_(it.name); if (seen[k]) return false; seen[k] = 1; return true;
      }).map(function (it) {
        var k = labelsKey_(it.name);
        return { name: it.name, qty: it.qty, key: k, nondrug: !!nd[k] || nonDrugByName_(it.name),
                 active: (db[k] && db[k].active) || '',
                 adult: (instr[k + '|adult'] || {}).text || '',
                 child: (instr[k + '|child'] || {}).text || '' };
      });
      return { id: String(inv.invoiceid), cust: inv.custname || '', phone: inv.phone || '',
               employee: inv.employee || '', total: inv.total || 0, items: items,
               isNew: parseInt(inv.invoiceid, 10) > since, done: !!done[String(inv.invoiceid)],
               hasDrug: items.some(function (x) { return !x.nondrug; }) };
    });
    return { ok: true, maxId: maxId, invoices: list };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* حفظ التعليمات + تسجيل إن الفاتورة اتطبعت/اتخطت */
function labelsSave(payload) {
  try {
    var p = JSON.parse(payload || '{}');
    var ss = SpreadsheetApp.openById(STAFF_SHEET_ID);
    var log = getOrCreateSheet_(LABELS_LOG_SHEET, ['الفاتورة', 'الوقت', 'الحالة', 'العمر', 'الوزن', 'حمل/رضاعة', 'الملصقات']);
    log.appendRow([String(p.id || ''), Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd HH:mm'),
                   p.skip ? 'اتخطت' : 'اتطبعت', p.age || '', p.weight || '', p.preg || '',
                   (p.items || []).map(function (x) { return x.name + ': ' + x.text; }).join(' | ')]);

    if (p.nondrug && p.nondrug.length) {
      var nsh = getOrCreateSheet_(LABELS_NONDRUG_SHEET, ['الصنف', 'أُضيف']);
      var have = labelsNonDrug_(), today = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');
      p.nondrug.forEach(function (n) { var k = labelsKey_(n); if (k && !have[k]) { nsh.appendRow([k, today]); have[k] = 1; } });
      fxClearCache_('fx_lbl_nd');
    }
    if (!p.skip && p.items && p.items.length) {
      var band = p.band === 'child' ? 'child' : 'adult';
      var sh = getOrCreateSheet_(LABELS_INSTR_SHEET, ['الصنف', 'الفئة', 'التعليمات', 'مرات', 'آخر تعديل']);
      var rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 4).getDisplayValues() : [];
      var rowOf = {};
      rows.forEach(function (r, i) { rowOf[r[0] + '|' + r[1]] = { row: i + 2, n: parseInt(r[3], 10) || 0 }; });
      var now = Utilities.formatDate(new Date(), 'Africa/Cairo', 'yyyy-MM-dd');
      p.items.forEach(function (it) {
        var k = labelsKey_(it.name), t = String(it.text || '').trim();
        if (!k || !t) return;
        var ex = rowOf[k + '|' + band];
        if (ex) sh.getRange(ex.row, 3, 1, 3).setValues([[t, ex.n + 1, now]]);
        else { sh.appendRow([k, band, t, 1, now]); rowOf[k + '|' + band] = { row: sh.getLastRow(), n: 1 }; }
      });
      fxClearCache_('fx_lbl_instr');
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

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
