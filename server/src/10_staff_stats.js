// ==== MODULE 10_staff_stats (split from server/Code.js; load order = file name order) ====


const EMPLOYEES = {
  '1': 'الدكتور',
  '2': 'دكتور عبدالسلام',
  '3': 'دكتورة ولاء',
  '4': 'استاذ حمادة',
  '5': 'أحمد شعت'          // حساب 5 في نظام البيع (كان باسم استاذ ايمن)
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

var _oldNameToId = {'الدكتور':'1','دكتور عبدالسلام':'2','دكتورة ولاء':'3','دكتور مصطفى الصعيدي':'4','استاذ حمادة':'4','دكتور حماده':'4','استاذ ايمن':'5','أحمد شعت':'5'};
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