// أدوات مشتركة بين كل الصفحات
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'حصل خطأ، حاول تاني');
    err.status = res.status;
    throw err;
  }
  return data;
}

export function toast(msg) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2800);
}

export function stars(rating) {
  if (rating == null) return '<span class="muted">جديد</span>';
  const full = Math.round(rating);
  return `<span class="stars" aria-label="${esc(rating)} من 5">${'★'.repeat(full)}<span class="dim">${'★'.repeat(5 - full)}</span></span> <b>${esc(rating)}</b>`;
}

export const initial = (name) => esc((name || '?').replace(/^د\.\s*/, '').trim().charAt(0));
export const money = (n) => Number(n || 0).toLocaleString('en-US');

export const STATUS = {
  confirmed: ['مؤكد', 'ok'],
  completed: ['تم الكشف', ''],
  cancelled: ['ملغي', 'off'],
};
export const statusChip = (s) => `<span class="chip ${STATUS[s]?.[1] || ''}">${STATUS[s]?.[0] || esc(s)}</span>`;

// التاريخ بتوقيت القاهرة
const TZ = 'Africa/Cairo';
export const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
export const addDays = (d, n) => {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
export const dayName = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('ar-EG', { weekday: 'long', timeZone: 'UTC' });
export const dayShort = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', timeZone: 'UTC' });
export const dayLong = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
export const dow = (d) => new Date(d + 'T00:00:00Z').getUTCDay();
export const fmtTime = (t) => {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'ص' : 'م'}`;
};

// الصفحة الرئيسية لكل دور
export const homeFor = (role) => ({ patient: '/doctors.html', doctor: '/dashboard.html', admin: '/admin.html' }[role] || '/');

// شريط التنقل (بالشعار)
const NAV = {
  patient: [['/doctors.html', 'الدكاترة'], ['/services.html', 'الخدمات'], ['/my-bookings.html', 'حجوزاتي'], ['/contact.html', 'تواصل معنا']],
  doctor: [['/dashboard.html', 'لوحة الدكتور']],
  admin: [['/admin.html', 'لوحة الإدارة']],
};
export async function renderNav() {
  const holder = $('#nav');
  let user = null;
  try { user = (await api('/api/me')).user; } catch { /* ignore */ }
  const here = location.pathname === '/' ? '/index.html' : location.pathname;
  const links = !user ? '' : NAV[user.role].map(([href, t]) =>
    `<a href="${href}" class="${href === here || (href === '/doctors.html' && here === '/doctor.html') ? 'active' : ''}">${t}</a>`).join('')
    + `<span class="who">${esc(user.name)}</span><button class="linklike" id="logout">خروج</button>`;
  holder.innerHTML = `<div class="container">
    <a class="brand" href="${user ? homeFor(user.role) : '/'}"><img src="/logo-mark.png" alt=""><span><b>OFOK</b><small>عيادات الأسنان</small></span></a>
    <nav class="links">${links}</nav></div>`;
  $('#logout')?.addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); location.href = '/'; });
  return user;
}

// أيقونات التواصل
export const ICONS = {
  facebook: '<span aria-hidden="true">f</span>',
  linkedin: '<span aria-hidden="true">in</span>',
  instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1" fill="currentColor" stroke="none"/></svg>',
};
export const SOCIAL_NAMES = { facebook: 'فيسبوك', instagram: 'إنستجرام', linkedin: 'لينكد إن' };
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');

// الفوتر بروابط التواصل
export async function renderFooter() {
  const f = $('#footer');
  if (!f) return;
  let st = {};
  try { st = await api('/api/settings'); } catch { /* ignore */ }
  const links = ['facebook', 'instagram', 'linkedin'].filter((k) => safeUrl(st[k]))
    .map((k) => `<a href="${esc(safeUrl(st[k]))}" target="_blank" rel="noopener noreferrer" aria-label="${SOCIAL_NAMES[k]}">${ICONS[k]}</a>`).join('');
  f.className = 'site';
  f.innerHTML = `<div class="container"><span>© OFOK لطب الأسنان</span><div class="soc">${links}</div></div>`;
}

// أيقونات الأقسام (بالترتيب)
export const CAT_ICONS = ['🦷', '🔬', '🩺', '🔩', '🧱', '📐', '🌿', '👑', '✨', '🧒', '📷', '🚑'];

// يحمي الصفحة: لازم تسجيل دخول بالدور المطلوب، وإلا يحوّل المستخدم
export async function requireRole(role) {
  const user = await renderNav();
  if (!user) location.replace('/');
  else if (user.role !== role) location.replace(homeFor(user.role));
  else return user;
  await new Promise(() => {}); // نوقف باقي السكربت لحد ما التحويل يتم
}
