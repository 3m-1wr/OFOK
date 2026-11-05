import http from 'node:http';
import { readFileSync, writeFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { join, extname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, hashPassword, verifyPassword, seedIfEmpty, DENTAL_SPECIALTIES } from './db.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = resolve(__dirname, 'public');
const PORT = process.env.PORT || 3000;
const TZ = process.env.TZ_NAME || 'Africa/Cairo';
const TOKEN_DAYS = 7;
const SECURE = process.env.COOKIE_SECURE === '1' ? '; Secure' : ''; // فعّلها لما الموقع يشتغل على HTTPS

// ---------- السر الخاص بالتوكن ----------
let SECRET = process.env.SECRET;
if (!SECRET) {
  const f = join(__dirname, '.secret');
  if (!existsSync(f)) writeFileSync(f, randomBytes(32).toString('hex'), { mode: 0o600 });
  SECRET = readFileSync(f, 'utf8').trim();
}

seedIfEmpty();

// ---------- أدوات ----------
const sign = (payload) => {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
};
const verify = (token) => {
  if (!token || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expected = createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(mac), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
};
const parseCookies = (h = '') =>
  Object.fromEntries(h.split(';').map((c) => c.trim().split('=')).filter((x) => x[0]).map(([k, ...v]) => [k, v.join('=')]));

const nowLocal = () => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: (+p.hour % 24) * 60 + +p.minute };
};
const addDays = (dateStr, n) => {
  const d = new Date(dateStr + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayOfWeek = (dateStr) => new Date(dateStr + 'T00:00:00Z').getUTCDay();
const pad = (n) => String(n).padStart(2, '0');

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg, status = 400) => { throw new HttpError(status, msg); };
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v, fallback) => (Number.isFinite(parseInt(v)) ? parseInt(v) : fallback);
const SLOT_OPTIONS = [15, 20, 30, 45, 60];
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- حد لمحاولات الدخول ----------
const attempts = new Map();
const tooMany = (ip) => {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  attempts.set(ip, list);
  return list.length >= 10;
};

// ---------- منطق الدكاترة والمواعيد ----------
const DOCTOR_SELECT = `
  SELECT d.*, u.name, u.email,
    (SELECT ROUND(AVG(rating),1) FROM reviews r WHERE r.doctor_id = d.id) AS rating,
    (SELECT COUNT(*) FROM reviews r WHERE r.doctor_id = d.id) AS reviews_count
  FROM doctors d JOIN users u ON u.id = d.user_id`;

function slotsFor(doctor, date) {
  const workDays = doctor.work_days.split(',').map(Number);
  if (!workDays.includes(dayOfWeek(date))) return [];
  const taken = new Set(
    db.prepare("SELECT time FROM bookings WHERE doctor_id=? AND date=? AND status!='cancelled'").all(doctor.id, date).map((r) => r.time));
  const now = nowLocal();
  const out = [];
  for (let m = doctor.start_hour * 60; m + doctor.slot_minutes <= doctor.end_hour * 60; m += doctor.slot_minutes) {
    const t = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
    const past = date < now.date || (date === now.date && m <= now.minutes);
    out.push({ time: t, available: !taken.has(t) && !past });
  }
  return out;
}
// ---------- الخدمات ----------
const SERVICE_COLS = 's.id, s.name_ar, s.name_en, s.category_id';
const doctorServices = (doctorId) =>
  db.prepare(`SELECT ${SERVICE_COLS} FROM doctor_services ds JOIN services s ON s.id = ds.service_id
    WHERE ds.doctor_id = ? AND s.active = 1 ORDER BY s.category_id, s.sort, s.id`).all(doctorId);
const servicesByDoctor = () => {
  const map = new Map();
  for (const r of db.prepare(`SELECT ds.doctor_id, ${SERVICE_COLS} FROM doctor_services ds JOIN services s ON s.id = ds.service_id
      WHERE s.active = 1 ORDER BY s.category_id, s.sort, s.id`).all()) {
    const { doctor_id, ...svc } = r;
    if (!map.has(doctor_id)) map.set(doctor_id, []);
    map.get(doctor_id).push(svc);
  }
  return map;
};
const catalog = (all) => {
  const cats = db.prepare('SELECT * FROM service_categories ORDER BY sort, id').all();
  const svcs = db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM doctor_services ds WHERE ds.service_id = s.id) AS doctors
    FROM services s ${all ? '' : 'WHERE s.active = 1'} ORDER BY s.sort, s.id`).all();
  return cats.map((c) => ({ ...c, services: svcs.filter((x) => x.category_id === c.id) })).filter((c) => all || c.services.length);
};
const validServiceIds = (arr) => {
  if (!Array.isArray(arr)) return [];
  const ok = new Set(db.prepare('SELECT id FROM services').all().map((r) => r.id));
  return [...new Set(arr.map(Number).filter((n) => ok.has(n)))];
};
const setDoctorServices = (doctorId, ids) => {
  db.prepare('DELETE FROM doctor_services WHERE doctor_id=?').run(doctorId);
  const add = db.prepare('INSERT INTO doctor_services (doctor_id, service_id) VALUES (?,?)');
  ids.forEach((i) => add.run(doctorId, i));
};
const clampHours = (start, end, dStart = 10, dEnd = 18) => {
  const sh = Math.min(23, Math.max(0, num(start, dStart)));
  return [sh, Math.min(24, Math.max(sh + 1, num(end, dEnd)))];
};
const parseDays = (v, fallback) => {
  const days = Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))] : null;
  return days && days.length ? days.sort().join(',') : fallback;
};
const validUrl = (u) => /^https?:\/\/[^\s]+$/i.test(u) && u.length <= 300;

const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && !isNaN(new Date(d + 'T00:00:00Z'));

// ---------- الراوتر ----------
const routes = [];
const route = (method, path, role, handler) => {
  const keys = [];
  const rx = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, rx, keys, role, handler });
};

// --- حسابات: التسجيل الذاتي للمرضى فقط ---
route('POST', '/api/register', null, ({ body, setSession }) => {
  const name = str(body.name, 80), email = str(body.email, 120).toLowerCase(), phone = str(body.phone, 20);
  const password = typeof body.password === 'string' ? body.password : '';
  if (name.length < 2) bad('الاسم مطلوب');
  if (!EMAIL_RX.test(email)) bad('البريد الإلكتروني غير صحيح');
  if (password.length < 6) bad('كلمة المرور لازم تكون 6 حروف على الأقل');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) bad('البريد ده مسجل قبل كده', 409);
  const uid = Number(db.prepare('INSERT INTO users (name,email,phone,password,role) VALUES (?,?,?,?,?)')
    .run(name, email, phone, hashPassword(password), 'patient').lastInsertRowid);
  setSession(uid);
  return { id: uid, name, role: 'patient' };
});

route('POST', '/api/login', null, ({ body, ip, setSession }) => {
  if (tooMany(ip)) bad('محاولات كتير، جرب بعد شوية', 429);
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(str(body.email, 120).toLowerCase());
  if (!u || !verifyPassword(String(body.password || ''), u.password)) {
    attempts.get(ip)?.push(Date.now()) ?? attempts.set(ip, [Date.now()]);
    bad('البريد أو كلمة المرور غلط', 401);
  }
  setSession(u.id);
  return { id: u.id, name: u.name, role: u.role };
});
route('POST', '/api/logout', null, ({ clearSession }) => { clearSession(); return { ok: true }; });
route('GET', '/api/me', null, ({ user }) => ({ user: user ? { id: user.id, name: user.name, email: user.email, role: user.role } : null }));

// --- دكاترة الأسنان (للمرضى) ---
route('GET', '/api/doctors', 'any', ({ query }) => {
  const q = str(query.get('q')).toLowerCase(), specialty = str(query.get('specialty')), serviceId = Number(query.get('service')) || 0;
  const bySvc = servicesByDoctor();
  let list = db.prepare(DOCTOR_SELECT).all().map(({ email, ...d }) => ({ ...d, services: bySvc.get(d.id) || [] }));
  if (serviceId) list = list.filter((d) => d.services.some((s) => s.id === serviceId));
  if (specialty) list = list.filter((d) => d.specialty === specialty);
  if (q) list = list.filter((d) => [d.name, d.specialty, d.clinic_name, d.address, ...d.services.map((s) => s.name_ar + ' ' + s.name_en)].join(' ').toLowerCase().includes(q));
  list.sort((a, b) => (b.rating || 0) - (a.rating || 0) || b.reviews_count - a.reviews_count);
  return list;
});
route('GET', '/api/specialties', 'any', () => {
  const used = new Set(db.prepare('SELECT DISTINCT specialty FROM doctors').all().map((r) => r.specialty));
  return DENTAL_SPECIALTIES.filter((s) => used.has(s));
});
route('GET', '/api/services', 'any', () => catalog(false));
route('GET', '/api/settings', 'any', () => Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value])));
route('GET', '/api/doctors/:id', 'any', ({ params }) => {
  const row = db.prepare(DOCTOR_SELECT + ' WHERE d.id=?').get(params.id);
  if (!row) bad('الدكتور غير موجود', 404);
  const { email, ...d } = row;
  d.services = doctorServices(d.id);
  d.reviews = db.prepare(`SELECT r.rating, r.comment, r.created_at, u.name AS patient_name
    FROM reviews r JOIN users u ON u.id=r.patient_id WHERE r.doctor_id=? ORDER BY r.id DESC LIMIT 50`).all(d.id);
  return d;
});
route('GET', '/api/doctors/:id/slots', 'any', ({ params, query }) => {
  const d = db.prepare('SELECT * FROM doctors WHERE id=?').get(params.id);
  if (!d) bad('الدكتور غير موجود', 404);
  const date = query.get('date');
  if (!validDate(date)) bad('تاريخ غير صحيح');
  return { date, slots: slotsFor(d, date) };
});

// --- حجوزات المريض ---
route('POST', '/api/bookings', 'patient', ({ body, user }) => {
  const d = db.prepare('SELECT * FROM doctors WHERE id=?').get(Number(body.doctor_id));
  if (!d) bad('الدكتور غير موجود', 404);
  const date = body.date, time = body.time;
  if (!validDate(date)) bad('تاريخ غير صحيح');
  if (date > addDays(nowLocal().date, 30)) bad('الحجز متاح لـ 30 يوم قدام بس');
  const offered = doctorServices(d.id);
  let serviceId = null;
  if (offered.length) {
    serviceId = Number(body.service_id);
    if (!offered.some((s) => s.id === serviceId)) bad('اختار الخدمة المطلوبة من خدمات الدكتور');
  }
  const slot = slotsFor(d, date).find((s) => s.time === time);
  if (!slot || !slot.available) bad('الميعاد ده مش متاح', 409);
  try {
    const id = db.prepare('INSERT INTO bookings (doctor_id,patient_id,date,time,fee,service_id) VALUES (?,?,?,?,?,?)').run(d.id, user.id, date, time, d.fee, serviceId).lastInsertRowid;
    return { id: Number(id), date, time, status: 'confirmed' };
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) bad('حد حجز الميعاد ده لسه قبل شوية، اختار ميعاد تاني', 409);
    throw e;
  }
});
route('GET', '/api/my/bookings', 'patient', ({ user }) =>
  db.prepare(`SELECT b.*, u.name AS doctor_name, d.specialty, d.clinic_name, d.address,
      r.rating AS my_rating, r.comment AS my_comment, sv.name_ar AS service_name
    FROM bookings b JOIN doctors d ON d.id=b.doctor_id JOIN users u ON u.id=d.user_id
    LEFT JOIN reviews r ON r.booking_id=b.id LEFT JOIN services sv ON sv.id=b.service_id
    WHERE b.patient_id=? ORDER BY b.date DESC, b.time DESC`).all(user.id));
route('POST', '/api/bookings/:id/cancel', 'patient', ({ params, user }) => {
  const b = db.prepare('SELECT * FROM bookings WHERE id=? AND patient_id=?').get(params.id, user.id);
  if (!b) bad('الحجز غير موجود', 404);
  if (b.status !== 'confirmed') bad('الحجز ده مينفعش يتلغي');
  db.prepare("UPDATE bookings SET status='cancelled' WHERE id=?").run(b.id);
  return { ok: true };
});
route('POST', '/api/bookings/:id/review', 'patient', ({ params, body, user }) => {
  const b = db.prepare('SELECT * FROM bookings WHERE id=? AND patient_id=?').get(params.id, user.id);
  if (!b) bad('الحجز غير موجود', 404);
  if (b.status !== 'completed') bad('تقدر تقيّم بعد ما الدكتور يأكد إن الكشف تم');
  const rating = parseInt(body.rating);
  if (!(rating >= 1 && rating <= 5)) bad('التقييم من 1 لـ 5');
  if (db.prepare('SELECT 1 FROM reviews WHERE booking_id=?').get(b.id)) bad('قيّمت الحجز ده قبل كده', 409);
  db.prepare('INSERT INTO reviews (booking_id,doctor_id,patient_id,rating,comment) VALUES (?,?,?,?,?)')
    .run(b.id, b.doctor_id, user.id, rating, str(body.comment, 500));
  return { ok: true };
});

// --- لوحة الدكتور ---
const myDoctor = (user) => db.prepare('SELECT * FROM doctors WHERE user_id=?').get(user.id);
route('GET', '/api/doctor/me', 'doctor', ({ user }) => db.prepare(DOCTOR_SELECT + ' WHERE d.user_id=?').get(user.id));
// الدكتور بيختار الخدمات اللي بيقدمها (باقي إعدادات العيادة من لوحة الأدمن)
route('GET', '/api/doctor/services', 'doctor', ({ user }) => ({
  catalog: catalog(false),
  selected: db.prepare('SELECT service_id FROM doctor_services WHERE doctor_id=?').all(myDoctor(user).id).map((r) => r.service_id),
}));
route('PUT', '/api/doctor/services', 'doctor', ({ body, user }) => {
  const d = myDoctor(user);
  const active = new Set(db.prepare('SELECT id FROM services WHERE active=1').all().map((r) => r.id));
  const ids = validServiceIds(body.service_ids).filter((i) => active.has(i));
  db.exec('BEGIN');
  try { setDoctorServices(d.id, ids); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { ok: true, count: ids.length };
});
route('GET', '/api/doctor/bookings', 'doctor', ({ user, query }) => {
  const d = myDoctor(user);
  const from = validDate(query.get('from')) ? query.get('from') : '0000-00-00';
  return db.prepare(`SELECT b.id, b.date, b.time, b.status, b.fee, u.name AS patient_name, u.phone AS patient_phone, sv.name_ar AS service_name
    FROM bookings b JOIN users u ON u.id=b.patient_id LEFT JOIN services sv ON sv.id=b.service_id
    WHERE b.doctor_id=? AND b.date>=? ORDER BY b.date, b.time`).all(d.id, from);
});
route('POST', '/api/doctor/bookings/:id/status', 'doctor', ({ params, body, user }) => {
  const d = myDoctor(user);
  const b = db.prepare('SELECT * FROM bookings WHERE id=? AND doctor_id=?').get(params.id, d.id);
  if (!b) bad('الحجز غير موجود', 404);
  if (!['completed', 'cancelled'].includes(body.status)) bad('حالة غير صحيحة');
  if (b.status !== 'confirmed') bad('الحجز ده اتقفل قبل كده');
  db.prepare('UPDATE bookings SET status=? WHERE id=?').run(body.status, b.id);
  return { ok: true };
});
route('GET', '/api/doctor/reviews', 'doctor', ({ user }) => {
  const d = myDoctor(user);
  const reviews = db.prepare(`SELECT r.rating, r.comment, r.created_at, u.name AS patient_name
    FROM reviews r JOIN users u ON u.id=r.patient_id WHERE r.doctor_id=? ORDER BY r.id DESC`).all(d.id);
  const avg = reviews.length ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10 : null;
  return { average: avg, count: reviews.length, reviews };
});

// --- الأدمن ---
const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

route('GET', '/api/admin/overview', 'admin', ({ query }) => {
  const period = ['30', '90'].includes(query.get('period')) ? Number(query.get('period')) : 0; // 0 = الكل
  const today = nowLocal().date;
  const from = period ? addDays(today, -period) : '0000-00-00';

  const perDoctor = db.prepare(`
    SELECT d.id, u.name, d.specialty, d.clinic_name, d.fee,
      COALESCE(SUM(CASE WHEN b.status='completed' THEN 1 END), 0) AS completed,
      COALESCE(SUM(CASE WHEN b.status='cancelled' THEN 1 END), 0) AS cancelled,
      COALESCE(SUM(CASE WHEN b.status='confirmed' THEN 1 END), 0) AS upcoming,
      COALESCE(SUM(CASE WHEN b.status='completed' THEN b.fee END), 0) AS revenue,
      AVG(r.rating) AS rating, COUNT(r.id) AS reviews_count
    FROM doctors d JOIN users u ON u.id = d.user_id
    LEFT JOIN bookings b ON b.doctor_id = d.id AND b.date >= ?
    LEFT JOIN reviews r ON r.booking_id = b.id
    GROUP BY d.id`).all(from).map((d) => ({ ...d, rating: round1(d.rating) }));

  const sum = (k) => perDoctor.reduce((s, d) => s + d[k], 0);
  const completed = sum('completed'), cancelled = sum('cancelled'), revenue = sum('revenue');
  const rated = perDoctor.reduce((s, d) => s + (d.rating ?? 0) * d.reviews_count, 0);
  const reviewsTotal = sum('reviews_count');

  const MIN_REVIEWS = 3;
  const topRated = perDoctor.filter((d) => d.reviews_count >= MIN_REVIEWS)
    .sort((a, b) => b.rating - a.rating || b.reviews_count - a.reviews_count).slice(0, 5);
  const topRevenue = [...perDoctor].sort((a, b) => b.revenue - a.revenue).slice(0, 5);

  const topServices = db.prepare(`SELECT sv.id, sv.name_ar, sc.name_ar AS category, COUNT(*) AS bookings,
      COALESCE(SUM(CASE WHEN b.status='completed' THEN b.fee END), 0) AS revenue
    FROM bookings b JOIN services sv ON sv.id = b.service_id JOIN service_categories sc ON sc.id = sv.category_id
    WHERE b.date >= ? AND b.status != 'cancelled' GROUP BY sv.id ORDER BY bookings DESC, revenue DESC LIMIT 6`).all(from);

  // اتجاه الإيراد: آخر 6 شهور
  const months = [];
  const [y, m] = today.split('-').map(Number);
  for (let i = 5; i >= 0; i--) { const dt = new Date(Date.UTC(y, m - 1 - i, 1)); months.push(dt.toISOString().slice(0, 7)); }
  const byMonth = Object.fromEntries(db.prepare(`SELECT substr(date,1,7) AS m, SUM(fee) AS revenue, COUNT(*) AS visits
    FROM bookings WHERE status='completed' AND date >= ? GROUP BY m`).all(months[0] + '-01').map((r) => [r.m, r]));
  const trend = months.map((mo) => ({ month: mo, revenue: byMonth[mo]?.revenue || 0, visits: byMonth[mo]?.visits || 0 }));

  return {
    period,
    min_reviews: MIN_REVIEWS,
    kpis: {
      revenue, completed, cancelled,
      avg_ticket: completed ? Math.round(revenue / completed) : 0,
      avg_rating: reviewsTotal ? round1(rated / reviewsTotal) : null,
      reviews_total: reviewsTotal,
      cancel_rate: completed + cancelled ? Math.round((cancelled / (completed + cancelled)) * 100) : 0,
      doctors: perDoctor.length,
      patients: db.prepare("SELECT COUNT(*) c FROM users WHERE role='patient'").get().c,
    },
    top_rated: topRated,
    top_revenue: topRevenue,
    top_services: topServices,
    doctors: perDoctor,
    trend,
  };
});

route('GET', '/api/admin/doctors', 'admin', () => {
  const bySvc = servicesByDoctor();
  return db.prepare(DOCTOR_SELECT).all().map((d) => {
    const st = db.prepare(`SELECT COUNT(*) AS completed, COALESCE(SUM(fee),0) AS revenue FROM bookings WHERE doctor_id=? AND status='completed'`).get(d.id);
    const phone = db.prepare('SELECT phone FROM users WHERE id=?').get(d.user_id)?.phone || '';
    return { ...d, ...st, phone, service_ids: (bySvc.get(d.id) || []).map((x) => x.id) };
  });
});

route('GET', '/api/admin/specialties', 'admin', () => DENTAL_SPECIALTIES);

// بيانات العيادة المشتركة بين الإضافة والتعديل
function clinicFields(body, cur = {}) {
  const [sh, eh] = clampHours(body.start_hour, body.end_hour, cur.start_hour, cur.end_hour);
  const specialty = str(body.specialty ?? cur.specialty, 60);
  if (!DENTAL_SPECIALTIES.includes(specialty)) bad('اختار تخصص أسنان من القائمة');
  return {
    specialty, sh, eh,
    bio: str(body.bio ?? cur.bio ?? '', 500), clinic: str(body.clinic_name ?? cur.clinic_name ?? '', 80), address: str(body.address ?? cur.address ?? '', 200),
    fee: Math.max(0, num(body.fee, cur.fee ?? 0)),
    slot: SLOT_OPTIONS.includes(+body.slot_minutes) ? +body.slot_minutes : (cur.slot_minutes ?? 30),
    days: parseDays(body.work_days, cur.work_days ?? '0,1,2,3,4,6'),
  };
}

route('POST', '/api/admin/doctors', 'admin', ({ body }) => {
  const name = str(body.name, 80), email = str(body.email, 120).toLowerCase(), phone = str(body.phone, 20);
  const password = typeof body.password === 'string' ? body.password : '';
  if (name.length < 2) bad('اسم الدكتور مطلوب');
  if (!EMAIL_RX.test(email)) bad('البريد الإلكتروني غير صحيح');
  if (password.length < 6) bad('كلمة المرور لازم تكون 6 حروف على الأقل');
  const f = clinicFields(body);
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) bad('البريد ده مسجل قبل كده', 409);
  db.exec('BEGIN');
  try {
    const uid = Number(db.prepare('INSERT INTO users (name,email,phone,password,role) VALUES (?,?,?,?,?)')
      .run(name, email, phone, hashPassword(password), 'doctor').lastInsertRowid);
    const did = Number(db.prepare(`INSERT INTO doctors (user_id,specialty,bio,clinic_name,address,fee,start_hour,end_hour,slot_minutes,work_days)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(uid, f.specialty, f.bio, f.clinic, f.address, f.fee, f.sh, f.eh, f.slot, f.days).lastInsertRowid);
    setDoctorServices(did, validServiceIds(body.service_ids));
    db.exec('COMMIT');
    return { id: did };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
});

route('PUT', '/api/admin/doctors/:id', 'admin', ({ params, body }) => {
  const cur = db.prepare('SELECT * FROM doctors WHERE id=?').get(params.id);
  if (!cur) bad('الدكتور غير موجود', 404);
  const f = clinicFields(body, cur);
  const name = str(body.name, 80);
  if (name && name.length < 2) bad('اسم الدكتور مطلوب');
  db.exec('BEGIN');
  try {
    if (name) db.prepare('UPDATE users SET name=? WHERE id=?').run(name, cur.user_id);
    if (typeof body.phone === 'string') db.prepare('UPDATE users SET phone=? WHERE id=?').run(str(body.phone, 20), cur.user_id);
    db.prepare(`UPDATE doctors SET specialty=?, bio=?, clinic_name=?, address=?, fee=?, start_hour=?, end_hour=?, slot_minutes=?, work_days=? WHERE id=?`)
      .run(f.specialty, f.bio, f.clinic, f.address, f.fee, f.sh, f.eh, f.slot, f.days, cur.id);
    if (Array.isArray(body.service_ids)) setDoctorServices(cur.id, validServiceIds(body.service_ids));
    db.exec('COMMIT');
    return { ok: true };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
});

// --- إدارة الخدمات ---
route('GET', '/api/admin/services', 'admin', () => catalog(true));

route('POST', '/api/admin/categories', 'admin', ({ body }) => {
  const ar = str(body.name_ar, 80), en = str(body.name_en, 80);
  if (!ar) bad('اسم القسم بالعربي مطلوب');
  const sort = db.prepare('SELECT COALESCE(MAX(sort),0)+1 AS n FROM service_categories').get().n;
  return { id: Number(db.prepare('INSERT INTO service_categories (name_ar,name_en,sort) VALUES (?,?,?)').run(ar, en, sort).lastInsertRowid) };
});
route('PUT', '/api/admin/categories/:id', 'admin', ({ params, body }) => {
  const c = db.prepare('SELECT * FROM service_categories WHERE id=?').get(params.id);
  if (!c) bad('القسم غير موجود', 404);
  const ar = str(body.name_ar ?? c.name_ar, 80);
  if (!ar) bad('اسم القسم بالعربي مطلوب');
  db.prepare('UPDATE service_categories SET name_ar=?, name_en=? WHERE id=?').run(ar, str(body.name_en ?? c.name_en, 80), c.id);
  return { ok: true };
});
route('DELETE', '/api/admin/categories/:id', 'admin', ({ params }) => {
  if (db.prepare('SELECT 1 FROM services WHERE category_id=?').get(params.id)) bad('امسحي الخدمات اللي جوه القسم الأول', 409);
  db.prepare('DELETE FROM service_categories WHERE id=?').run(params.id);
  return { ok: true };
});

route('POST', '/api/admin/services', 'admin', ({ body }) => {
  const ar = str(body.name_ar, 100), en = str(body.name_en, 100), cid = Number(body.category_id);
  if (!ar) bad('اسم الخدمة بالعربي مطلوب');
  if (!db.prepare('SELECT 1 FROM service_categories WHERE id=?').get(cid)) bad('اختار القسم');
  const sort = db.prepare('SELECT COALESCE(MAX(sort),0)+1 AS n FROM services WHERE category_id=?').get(cid).n;
  return { id: Number(db.prepare('INSERT INTO services (category_id,name_ar,name_en,sort) VALUES (?,?,?,?)').run(cid, ar, en, sort).lastInsertRowid) };
});
route('PUT', '/api/admin/services/:id', 'admin', ({ params, body }) => {
  const sv = db.prepare('SELECT * FROM services WHERE id=?').get(params.id);
  if (!sv) bad('الخدمة غير موجودة', 404);
  const ar = str(body.name_ar ?? sv.name_ar, 100);
  if (!ar) bad('اسم الخدمة بالعربي مطلوب');
  const cid = body.category_id != null ? Number(body.category_id) : sv.category_id;
  if (!db.prepare('SELECT 1 FROM service_categories WHERE id=?').get(cid)) bad('القسم غير موجود');
  db.prepare('UPDATE services SET name_ar=?, name_en=?, category_id=?, active=? WHERE id=?')
    .run(ar, str(body.name_en ?? sv.name_en, 100), cid, body.active == null ? sv.active : (body.active ? 1 : 0), sv.id);
  return { ok: true };
});
route('DELETE', '/api/admin/services/:id', 'admin', ({ params }) => {
  if (db.prepare('SELECT 1 FROM bookings WHERE service_id=?').get(params.id)) bad('الخدمة دي عليها حجوزات، عطّليها بدل ما تمسحيها', 409);
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM doctor_services WHERE service_id=?').run(params.id);
    db.prepare('DELETE FROM services WHERE id=?').run(params.id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { ok: true };
});

// --- روابط التواصل ---
route('PUT', '/api/admin/settings', 'admin', ({ body }) => {
  const up = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  for (const k of ['facebook', 'instagram', 'linkedin']) {
    if (body[k] == null) continue;
    const v = str(body[k], 300);
    if (v && !validUrl(v)) bad('الرابط لازم يبدأ بـ https://');
    up.run(k, v);
  }
  return { ok: true };
});

// ---------- السيرفر ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
};

const readBody = (req) => new Promise((res, rej) => {
  let size = 0; const chunks = [];
  req.on('data', (c) => { size += c.length; if (size > 100_000) { rej(new HttpError(413, 'الطلب كبير')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => { try { res(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch { rej(new HttpError(400, 'JSON غير صحيح')); } });
  req.on('error', rej);
});

const send = (res, status, data, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEC_HEADERS, ...headers });
  res.end(JSON.stringify(data));
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      const cookies = parseCookies(req.headers.cookie);
      const session = verify(cookies.token);
      const user = session ? db.prepare('SELECT * FROM users WHERE id=?').get(session.uid) : null;
      const extra = [];
      const ctx = {
        user, query: url.searchParams, ip: req.socket.remoteAddress,
        setSession: (uid) => extra.push(`token=${sign({ uid, exp: Date.now() + TOKEN_DAYS * 864e5 })}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${TOKEN_DAYS * 86400}${SECURE}`),
        clearSession: () => extra.push(`token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${SECURE}`),
      };
      for (const r of routes) {
        const m = r.method === req.method && url.pathname.match(r.rx);
        if (!m) continue;
        if (r.role) {
          if (!user) bad('لازم تسجل دخول الأول', 401);
          if (r.role !== 'any' && user.role !== r.role) bad('مش مسموحلك بالصفحة دي', 403);
        }
        ctx.params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        ctx.body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
        const data = await r.handler(ctx);
        return send(res, 200, data, extra.length ? { 'Set-Cookie': extra } : {});
      }
      bad('مش موجود', 404);
    }

    // ملفات ثابتة
    if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/index.html';
    const file = resolve(PUBLIC, '.' + normalize(p));
    if (!file.startsWith(PUBLIC + sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('الصفحة غير موجودة');
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', ...SEC_HEADERS });
    createReadStream(file).pipe(res);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error(e);
    send(res, 500, { error: 'حصل خطأ في السيرفر' });
  }
});

server.listen(PORT, () => console.log(`OFOK running on http://localhost:${PORT}`));
