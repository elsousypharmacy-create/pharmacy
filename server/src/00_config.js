// ==== MODULE 00_config (split from server/Code.js; load order = file name order) ====
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