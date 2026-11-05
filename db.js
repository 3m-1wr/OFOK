import { DatabaseSync } from 'node:sqlite';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

export const DENTAL_SPECIALTIES = [
  'تقويم الأسنان',
  'زراعة الأسنان',
  'علاج الجذور والحشو',
  'تجميل الأسنان',
  'جراحة الفم والفكين',
  'أسنان الأطفال',
  'علاج اللثة',
  'تركيبات الأسنان',
];

export const db = new DatabaseSync(process.env.DB_FILE || 'ofok.db');
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('patient','doctor','admin'))
);
CREATE TABLE IF NOT EXISTS doctors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  specialty TEXT NOT NULL,
  bio TEXT DEFAULT '',
  clinic_name TEXT DEFAULT '',
  address TEXT DEFAULT '',
  fee INTEGER DEFAULT 0,
  start_hour INTEGER DEFAULT 10,
  end_hour INTEGER DEFAULT 18,
  slot_minutes INTEGER DEFAULT 30,
  work_days TEXT DEFAULT '0,1,2,3,4,6'
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor_id INTEGER NOT NULL REFERENCES doctors(id),
  patient_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  fee INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','completed','cancelled')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_slot
  ON bookings(doctor_id, date, time) WHERE status != 'cancelled';
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id),
  doctor_id INTEGER NOT NULL REFERENCES doctors(id),
  patient_id INTEGER NOT NULL REFERENCES users(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS service_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES service_categories(id),
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS doctor_services (
  doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id),
  PRIMARY KEY (doctor_id, service_id)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
`);

// ترحيل: عمود الخدمة في الحجوزات (للقواعد القديمة)
if (!db.prepare('PRAGMA table_info(bookings)').all().some((c) => c.name === 'service_id')) {
  db.exec('ALTER TABLE bookings ADD COLUMN service_id INTEGER REFERENCES services(id)');
}

// روابط التواصل الافتراضية (الأدمن بيغيّرها من لوحة الإدارة)
for (const [k, v] of [['facebook', 'https://www.facebook.com/'], ['instagram', 'https://www.instagram.com/'], ['linkedin', 'https://www.linkedin.com/']]) {
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(k, v);
}

export function hashPassword(pw) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(pw, salt, 64).toString('hex');
}
export function verifyPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const a = scryptSync(pw, salt, 64), b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------- كتالوج الخدمات ----------
// [عربي، English، [[عربي، English], ...]]
// الأقسام 6–12 زي ما اتحددت، والأقسام 1–5 اقتراح ممكن يتعدّل من لوحة الإدارة.
export const CATALOG = [
  ['طب الأسنان العام', 'General Dentistry', [
    ['كشف وفحص شامل', 'Comprehensive Check-up'], ['تنظيف الأسنان وإزالة الجير', 'Teeth Cleaning & Scaling'],
    ['خلع الأسنان', 'Simple Tooth Extraction'], ['علاج حساسية الأسنان', 'Tooth Sensitivity Treatment'],
    ['الوقاية والعناية بنظافة الفم', 'Preventive Care & Oral Hygiene'], ['استشارة وخطة علاج', 'Consultation & Treatment Plan']]],
  ['علاج الجذور', 'Endodontics', [
    ['علاج العصب', 'Root Canal Treatment'], ['علاج العصب بالميكروسكوب', 'Microscopic Root Canal'],
    ['إعادة علاج العصب', 'Root Canal Re-treatment'], ['تغطية لب السن', 'Pulp Capping'],
    ['قطع طرف الجذر', 'Apicoectomy'], ['دعامة وبناء السن', 'Post & Core']]],
  ['جراحة الفم والفكين', 'Oral & Maxillofacial Surgery', [
    ['خلع جراحي', 'Surgical Extraction'], ['خلع ضرس العقل', 'Wisdom Tooth Removal'],
    ['جراحة الأسنان المدفونة', 'Impacted Teeth Surgery'], ['إزالة الأكياس', 'Cyst Removal'],
    ['ترقيع العظم', 'Bone Grafting'], ['جراحات الفك', 'Jaw Surgery']]],
  ['زراعة الأسنان', 'Dental Implants', [
    ['زراعة سن واحد', 'Single Tooth Implant'], ['زراعة عدة أسنان', 'Multiple Implants'],
    ['زراعة الفك بالكامل (All-on-4 / All-on-6)', 'Full Arch Implants (All-on-4 / All-on-6)'],
    ['زراعة فورية', 'Immediate Implants'], ['رفع الجيب الأنفي', 'Sinus Lift'], ['صيانة وإصلاح الزرعات', 'Implant Maintenance & Repair']]],
  ['ترميم الأسنان', 'Restorative Dentistry', [
    ['حشو تجميلي', 'Composite Fillings'], ['إنلاي وأونلاي', 'Inlays & Onlays'],
    ['بناء السن المكسور', 'Core Build-up'], ['حشو الجلاس أيونومر', 'Glass Ionomer Fillings'],
    ['دعامات الفايبر', 'Fiber Posts'], ['إصلاح الأسنان المتآكلة', 'Worn Tooth Repair']]],
  ['تقويم الأسنان', 'Orthodontics', [
    ['تقويم معدني', 'Metal Braces'], ['تقويم سيراميك', 'Ceramic Braces'], ['التقويم الشفاف', 'Clear Aligners'],
    ['التقويم اللساني', 'Lingual Braces'], ['المثبتات', 'Retainers'], ['التقويم المبكر', 'Early Orthodontic Treatment']]],
  ['علاج اللثة', 'Periodontics – Gum Treatment', [
    ['علاج أمراض اللثة', 'Gum Disease Treatment'], ['التنظيف العميق', 'Deep Cleaning'],
    ['تقليح الجذور وإزالة الجير', 'Scaling & Root Planing'], ['جراحة اللثة', 'Gum Surgery'],
    ['ترقيع اللثة', 'Gum Grafting'], ['تشكيل اللثة', 'Gum Contouring']]],
  ['التركيبات الصناعية', 'Prosthodontics – Dental Prosthetics', [
    ['التيجان الثابتة', 'Fixed Dental Crowns'], ['الجسور السنية', 'Dental Bridges'],
    ['طقم أسنان كامل', 'Complete Dentures'], ['طقم أسنان جزئي', 'Partial Dentures'],
    ['التيجان المؤقتة', 'Temporary Crowns'], ['تركيبات مثبتة على الزرعات', 'Implant-Supported Prosthetics']]],
  ['تجميل الأسنان', 'Cosmetic Dentistry', [
    ['تبييض الأسنان', 'Teeth Whitening'], ['فينير الأسنان', 'Dental Veneers'], ['فينير إيماكس', 'E-max Veneers'],
    ['تصميم الابتسامة', 'Smile Makeover'], ['الحشو التجميلي (Bonding)', 'Cosmetic Bonding'],
    ['تعديل شكل الأسنان', 'Tooth Reshaping'], ['تجميل اللثة', 'Gum Aesthetics']]],
  ['أسنان الأطفال', 'Pediatric Dentistry', [
    ['كشف أسنان الأطفال', "Children's Dental Check-up"], ['حشو أسنان الأطفال', 'Pediatric Fillings'],
    ['علاج الفلورايد', 'Fluoride Treatment'], ['سد الشقوق (سيلانت)', 'Dental Sealants'],
    ['علاج عصب الأسنان اللبنية (بولبوتومي وبولبكتومي)', 'Pulpotomy & Pulpectomy'], ['تيجان ستانلس ستيل', 'Stainless Steel Crowns'],
    ['حافظات المسافة', 'Space Maintainers']]],
  ['أشعة الأسنان', 'Dental Radiology', [
    ['أشعة محيطية (Periapical)', 'Periapical X-ray'], ['أشعة بايتوينج', 'Bitewing X-ray'],
    ['أشعة بانوراما (OPG)', 'Panoramic X-ray (OPG)'], ['أشعة سيفالومترية', 'Cephalometric X-ray'],
    ['أشعة مقطعية ثلاثية الأبعاد (CBCT)', 'CBCT 3D Scan'], ['أشعة إطباقية', 'Occlusal X-ray']]],
  ['طوارئ الأسنان', 'Dental Emergency', [
    ['استشارة طوارئ أسنان', 'Emergency Dental Consultation'], ['علاج ألم الأسنان الشديد', 'Severe Toothache Treatment'],
    ['علاج السن المكسور', 'Broken Tooth Treatment'], ['إصابات الأسنان', 'Dental Trauma'],
    ['علاج خراج الأسنان', 'Dental Abscess Treatment'], ['خلع طارئ', 'Emergency Tooth Extraction']]],
];

// التخصص الرئيسي للدكتور -> الأقسام اللي بيقدمها افتراضياً (أرقام الأقسام في CATALOG بدءاً من 0)
const SPECIALTY_CATEGORIES = {
  'تقويم الأسنان': [5, 10], 'زراعة الأسنان': [3, 2, 10], 'علاج الجذور والحشو': [1, 4], 'تجميل الأسنان': [8, 6],
  'جراحة الفم والفكين': [2, 11, 10], 'أسنان الأطفال': [9, 0], 'علاج اللثة': [6, 0], 'تركيبات الأسنان': [7, 3],
};

function seedCatalogIfEmpty() {
  if (db.prepare('SELECT COUNT(*) c FROM service_categories').get().c > 0) return;
  const addCat = db.prepare('INSERT INTO service_categories (name_ar,name_en,sort) VALUES (?,?,?)');
  const addSvc = db.prepare('INSERT INTO services (category_id,name_ar,name_en,sort) VALUES (?,?,?,?)');
  db.exec('BEGIN');
  try {
    CATALOG.forEach(([ar, en, items], i) => {
      const cid = Number(addCat.run(ar, en, i).lastInsertRowid);
      items.forEach(([sar, sen], j) => addSvc.run(cid, sar, sen, j));
    });
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// يوزّع خدمات تجريبية على الدكاترة (مرة واحدة لو الجدول فاضي)
function seedDoctorServicesIfEmpty() {
  if (db.prepare('SELECT COUNT(*) c FROM doctor_services').get().c > 0) return false;
  const cats = db.prepare('SELECT id FROM service_categories ORDER BY sort, id').all().map((r) => r.id);
  const svcByCat = (cid) => db.prepare('SELECT id FROM services WHERE category_id=? ORDER BY sort, id').all(cid).map((r) => r.id);
  const add = db.prepare('INSERT OR IGNORE INTO doctor_services (doctor_id, service_id) VALUES (?,?)');
  for (const d of db.prepare('SELECT id, specialty FROM doctors').all()) {
    const idxs = SPECIALTY_CATEGORIES[d.specialty] || [0];
    idxs.forEach((ci, n) => {
      const ids = svcByCat(cats[ci] ?? cats[0]);
      // القسم الثانوي: نص الخدمات بس (الأشعة والطوارئ: خدمتين)
      (n === 0 ? ids : ids.slice(0, 3)).forEach((sid) => add.run(d.id, sid));
    });
  }
  return true;
}

const isoDay = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

// ---- بيانات تجريبية (بتتضاف أول مرة بس لو القاعدة فاضية) ----
export function seedIfEmpty() {
  const fresh = db.prepare('SELECT COUNT(*) c FROM users').get().c === 0;
  seedCatalogIfEmpty();
  if (fresh) seedDemo();
  const assigned = seedDoctorServicesIfEmpty();
  if (fresh && assigned) {
    // نوزّع خدمة على كل حجز تجريبي (من خدمات الدكتور)
    const mine = db.prepare('SELECT service_id FROM doctor_services WHERE doctor_id=? ORDER BY service_id');
    const set = db.prepare('UPDATE bookings SET service_id=? WHERE id=?');
    for (const b of db.prepare('SELECT id, doctor_id FROM bookings').all()) {
      const ids = mine.all(b.doctor_id).map((r) => r.service_id);
      if (ids.length) set.run(ids[(b.id * 7) % ids.length], b.id);
    }
  }
}

function seedDemo() {
  const pw = hashPassword('123456');
  const addUser = db.prepare('INSERT INTO users (name,email,phone,password,role) VALUES (?,?,?,?,?)');
  const addDoc = db.prepare(`INSERT INTO doctors
    (user_id,specialty,bio,clinic_name,address,fee,start_hour,end_hour,slot_minutes) VALUES (?,?,?,?,?,?,?,?,?)`);
  const addBooking = db.prepare('INSERT INTO bookings (doctor_id,patient_id,date,time,fee,status) VALUES (?,?,?,?,?,?)');
  const addReview = db.prepare('INSERT INTO reviews (booking_id,doctor_id,patient_id,rating,comment) VALUES (?,?,?,?,?)');

  // حساب الأدمن: غيّري الإيميل والباسورد قبل الإطلاق عن طريق ADMIN_EMAIL و ADMIN_PASSWORD (أو بعد أول تشغيل)
  addUser.run('مدير OFOK', (process.env.ADMIN_EMAIL || 'admin@demo.com').toLowerCase(), '01000000000', hashPassword(process.env.ADMIN_PASSWORD || '123456'), 'admin');

  const patients = ['مريض تجريبي', 'منى أحمد', 'يوسف طارق', 'ريم علي', 'حسام وائل']
    .map((n, i) => Number(addUser.run(n, i === 0 ? 'patient@demo.com' : `patient${i + 1}@demo.com`, `0101111111${i}`, pw, 'patient').lastInsertRowid));

  // [الاسم، التخصص، نبذة، العيادة، العنوان، السعر، بداية، نهاية، مدة الكشف، عدد الكشوفات، جودة التقييم من 10]
  const docs = [
    ['د. أحمد سمير', 'تقويم الأسنان', 'استشاري تقويم الأسنان بخبرة 15 سنة', 'عيادة OFOK - مدينة نصر', 'مدينة نصر، القاهرة', 300, 12, 20, 30, 22, 9],
    ['د. منى عادل', 'أسنان الأطفال', 'أخصائية طب أسنان الأطفال وعلاج الخوف من الأسنان', 'عيادة OFOK - المعادي', 'المعادي، القاهرة', 250, 10, 18, 20, 18, 10],
    ['د. كريم حسن', 'تجميل الأسنان', 'ابتسامة هوليود، التبييض والفينير', 'عيادة OFOK - الزمالك', 'الزمالك، القاهرة', 500, 14, 22, 30, 14, 8],
    ['د. سارة محمود', 'علاج الجذور والحشو', 'علاج العصب بالميكروسكوب في جلسة واحدة', 'عيادة OFOK - مصر الجديدة', 'مصر الجديدة، القاهرة', 350, 11, 19, 30, 16, 6],
    ['د. محمد فاروق', 'زراعة الأسنان', 'استشاري زراعة الأسنان والتركيبات الثابتة', 'عيادة OFOK - الدقي', 'الدقي، الجيزة', 600, 13, 21, 30, 12, 9],
    ['د. هالة يوسف', 'علاج اللثة', 'أخصائية أمراض اللثة والتنظيف العميق', 'عيادة OFOK - التجمع', 'التجمع الخامس، القاهرة', 300, 10, 20, 30, 10, 7],
    ['د. عمر خالد', 'جراحة الفم والفكين', 'جراحات خلع الأضراس المدفونة والفكين', 'عيادة OFOK - المهندسين', 'المهندسين، الجيزة', 450, 12, 20, 30, 9, 8],
    ['د. نهى إبراهيم', 'تركيبات الأسنان', 'التيجان والجسور والتركيبات المتحركة', 'عيادة OFOK - سموحة', 'سموحة، الإسكندرية', 400, 15, 21, 45, 8, 5],
  ];
  const comments = ['دكتور ممتاز وشرح كل حاجة بالتفصيل', 'الانتظار كان طويل شوية بس الكشف رائع', 'أنصح بيه جداً', 'تعامل محترم ومفيش وجع خالص', 'عيادة نضيفة ومواعيد منتظمة', ''];

  docs.forEach((d, i) => {
    const uid = Number(addUser.run(d[0], `doctor${i + 1}@demo.com`, `0102222222${i}`, pw, 'doctor').lastInsertRowid);
    const did = Number(addDoc.run(uid, d[1], d[2], d[3], d[4], d[5], d[6], d[7], d[8]).lastInsertRowid);
    const n = d[9], good = d[10];
    for (let k = 0; k < n; k++) {
      const date = isoDay(-(3 + Math.floor((k * 150) / n) + (i % 3)));
      const time = `${String(d[6] + (k % 4)).padStart(2, '0')}:00`;
      const pid = patients[(i + k) % patients.length];
      const bid = Number(addBooking.run(did, pid, date, time, d[5], 'completed').lastInsertRowid);
      if (k % 5 !== 4) {
        const rating = (k * 7 + i * 3) % 10 < good ? 5 : ((k + i) % 3 === 0 ? 3 : 4);
        addReview.run(bid, did, pid, rating, comments[(k + i) % comments.length]);
      }
    }
    // حجز قادم + حجز ملغي للتجربة
    addBooking.run(did, patients[i % patients.length], isoDay(1 + (i % 2)), `${String(d[6] + 5).padStart(2, '0')}:00`, d[5], 'confirmed');
    addBooking.run(did, patients[(i + 1) % patients.length], isoDay(-1), `${String(d[6] + 6).padStart(2, '0')}:00`, d[5], 'cancelled');
  });
}
