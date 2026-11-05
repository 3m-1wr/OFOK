import { $, $$, api, esc, stars, requireRole, toast, money, CAT_ICONS } from './common.js';

await requireRole('admin');

const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const hour = (h) => `${h % 12 || 12}${h < 12 || h === 24 ? 'ص' : 'م'}`;

/* ============ التبويبات ============ */
const loaded = {};
const loaders = { overview: () => loadOverview(), doctors: () => loadDoctors(), services: () => loadServices(), settings: () => loadSettings() };
function showTab(name) {
  $$('#tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  Object.keys(loaders).forEach((s) => ($('#' + s).hidden = s !== name));
  if (name !== 'overview' || !loaded.overview) { loaded[name] = true; loaders[name](); }
  history.replaceState(null, '', '#' + name);
}
$$('#tabs .tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
$$('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

/* ============ نظرة عامة ============ */
let period = 0, sortKey = 'revenue', data = null;
const MEDAL = ['r1', 'r2', 'r3'];
const cancelRate = (d) => (d.completed + d.cancelled ? Math.round((d.cancelled / (d.completed + d.cancelled)) * 100) : 0);

function kpis(k, d) {
  const best = d.top_rated[0], rich = d.top_revenue[0]?.revenue > 0 ? d.top_revenue[0] : null;
  $('#kpis').innerHTML = `
    <div class="card kpi gold"><div class="label">الأعلى تقييماً</div>
      <div class="value" style="font-size:1.35rem">${best ? esc(best.name) : '—'}</div>
      <div class="sub">${best ? `${esc(best.rating)} من 5 · ${best.reviews_count} تقييم` : `محتاج ${d.min_reviews} تقييمات على الأقل`}</div></div>
    <div class="card kpi gold"><div class="label">الأعلى ربحاً</div>
      <div class="value" style="font-size:1.35rem">${rich ? esc(rich.name) : '—'}</div>
      <div class="sub">${rich ? `${money(rich.revenue)} جنيه · ${rich.completed} كشف` : 'لسه مفيش إيراد في الفترة دي'}</div></div>
    <div class="card kpi"><div class="label">إجمالي الإيراد</div>
      <div class="value">${money(k.revenue)} <small>جنيه</small></div><div class="sub">من ${k.completed} كشف مكتمل</div></div>
    <div class="card kpi teal"><div class="label">متوسط قيمة الكشف</div>
      <div class="value">${money(k.avg_ticket)} <small>جنيه</small></div><div class="sub">لكل كشف مكتمل</div></div>
    <div class="card kpi teal"><div class="label">متوسط التقييم</div>
      <div class="value">${k.avg_rating ?? '—'} <small>/ 5</small></div><div class="sub">من ${k.reviews_total} تقييم</div></div>
    <div class="card kpi red"><div class="label">نسبة الإلغاء</div>
      <div class="value">${k.cancel_rate}<small>%</small></div><div class="sub">${k.cancelled} حجز ملغي</div></div>
    <div class="card kpi"><div class="label">الدكاترة / المرضى</div>
      <div class="value">${k.doctors} <small>/ ${k.patients}</small></div><div class="sub">حسابات مسجلة</div></div>`;
}

function rankRow(i, d, valHtml, barPct, gold) {
  return `<div class="rank"><div class="no ${MEDAL[i] || ''}">${i + 1}</div>
    <div class="info"><b>${esc(d.name)}</b><small>${esc(d.specialty)}</small>
      ${barPct != null ? `<div class="track ${gold ? 'gold' : ''}"><i style="width:${barPct}%"></i></div>` : ''}</div>
    <div class="val">${valHtml}</div></div>`;
}

function rankings(d) {
  $('#topRated').innerHTML = d.top_rated.length
    ? d.top_rated.map((x, i) => rankRow(i, x, `${stars(x.rating)}<small>${x.reviews_count} تقييم</small>`, Math.round((x.rating / 5) * 100))).join('')
    : `<div class="empty">لسه مفيش دكتور وصل لـ ${d.min_reviews} تقييمات في الفترة دي.</div>`;
  const max = Math.max(1, ...d.top_revenue.map((x) => x.revenue));
  $('#topRevenue').innerHTML = d.top_revenue.some((x) => x.revenue > 0)
    ? d.top_revenue.map((x, i) => rankRow(i, x, `${money(x.revenue)} جنيه<small>${x.completed} كشف</small>`, Math.round((x.revenue / max) * 100), true)).join('')
    : '<div class="empty">لسه مفيش إيراد في الفترة دي.</div>';
  const mx = Math.max(1, ...d.top_services.map((x) => x.bookings));
  $('#topServices').innerHTML = d.top_services.length
    ? d.top_services.map((x, i) => `<div class="rank"><div class="no ${MEDAL[i] || ''}">${i + 1}</div>
        <div class="info"><b>${esc(x.name_ar)}</b><small>${esc(x.category)}</small><div class="track"><i style="width:${Math.round((x.bookings / mx) * 100)}%"></i></div></div>
        <div class="val">${x.bookings}<small>حجز</small></div></div>`).join('')
    : '<div class="empty">لسه مفيش حجوزات بخدمات في الفترة دي.</div>';
}

// رسم بياني بسيط (SVG) — الأحدث على اليسار لأن الصفحة RTL
function trend(rows) {
  const W = 560, H = 380, padB = 34, padT = 26, bw = 46;
  const max = Math.max(1, ...rows.map((r) => r.revenue));
  const step = W / rows.length;
  const bars = [...rows].reverse().map((r, i) => {
    const h = Math.round(((H - padB - padT) * r.revenue) / max);
    const x = i * step + (step - bw) / 2, y = H - padB - h;
    const label = new Date(r.month + '-01T00:00:00Z').toLocaleDateString('ar-EG', { month: 'long', timeZone: 'UTC' });
    return `<rect class="bar ${i === 0 ? 'last' : ''}" x="${x}" y="${y}" width="${bw}" height="${Math.max(h, 2)}" rx="6"/>
      <text class="val" x="${x + bw / 2}" y="${y - 7}" text-anchor="middle">${money(r.revenue)}</text>
      <text x="${x + bw / 2}" y="${H - 12}" text-anchor="middle">${label}</text>`;
  }).join('');
  $('#trend').innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="الإيراد الشهري لآخر 6 شهور">
    <line x1="0" y1="${H - padB}" x2="${W}" y2="${H - padB}"/>${bars}</svg>`;
}

function table(list) {
  const cols = [['name', 'الدكتور'], ['specialty', 'التخصص'], ['completed', 'الكشوفات'], ['revenue', 'الإيراد (جنيه)'],
    ['rating', 'التقييم'], ['reviews_count', 'عدد التقييمات'], ['cancel', 'نسبة الإلغاء']];
  const val = (d, k) => (k === 'cancel' ? cancelRate(d) : k === 'rating' ? d.rating ?? -1 : d[k]);
  const text = ['name', 'specialty'].includes(sortKey);
  const sorted = [...list].sort((a, b) => (text ? String(val(a, sortKey)).localeCompare(String(val(b, sortKey)), 'ar') : val(b, sortKey) - val(a, sortKey)));
  $('#table').innerHTML = `<thead><tr><th>#</th>${cols.map(([k, t]) =>
    `<th><button class="linklike" data-sort="${k}" style="font-weight:${sortKey === k ? 800 : 700};color:${sortKey === k ? 'var(--brand-dark)' : 'inherit'}" aria-label="ترتيب حسب ${t}">${t}${sortKey === k ? ' ▾' : ''}</button></th>`).join('')}</tr></thead>
    <tbody>${sorted.map((d, i) => `<tr><td>${i + 1}</td><td><b>${esc(d.name)}</b></td><td>${esc(d.specialty)}</td>
      <td>${d.completed}</td><td><b>${money(d.revenue)}</b></td>
      <td>${d.rating != null ? stars(d.rating) : '<span class="muted">—</span>'}</td><td>${d.reviews_count}</td>
      <td>${cancelRate(d)}%</td></tr>`).join('')}</tbody>`;
  $$('[data-sort]').forEach((b) => b.addEventListener('click', () => { sortKey = b.dataset.sort; table(data.doctors); }));
}

async function loadOverview() {
  try { data = await api('/api/admin/overview?period=' + period); }
  catch (e) { $('#err').innerHTML = `<div class="error">${esc(e.message)}</div>`; return; }
  $('#err').innerHTML = '';
  kpis(data.kpis, data); rankings(data); trend(data.trend); table(data.doctors);
  $('#note').textContent = `الإيراد = مجموع سعر الكشف وقت الحجز للكشوفات اللي الدكتور أكّد إنها تمت. الأعلى تقييماً بيحسب الدكاترة اللي ليهم ${data.min_reviews} تقييمات على الأقل عشان التقييم يكون عادل.`;
}
$$('#period button').forEach((b) => b.addEventListener('click', () => {
  period = Number(b.dataset.p);
  $$('#period button').forEach((x) => x.classList.toggle('active', x === b));
  loadOverview();
}));

/* ============ الدكاترة ============ */
let doctors = [], catalog = [], specialties = [];
const dlg = $('#docDialog');
let editing = null; // null = إضافة

async function loadDoctors() {
  [doctors, catalog, specialties] = await Promise.all([api('/api/admin/doctors'), api('/api/admin/services'), specialties.length ? specialties : api('/api/admin/specialties')]);
  $('#d_specialty').innerHTML = specialties.map((s) => `<option>${esc(s)}</option>`).join('');
  $('#d_days').innerHTML = DAYS.map((n, i) => `<label><input type="checkbox" value="${i}"> ${n}</label>`).join('');
  $('#docTable').innerHTML = `<thead><tr><th>الدكتور</th><th>التخصص</th><th>العيادة</th><th>سعر الكشف</th><th>المواعيد</th><th>الخدمات</th><th></th></tr></thead>
    <tbody>${doctors.map((d) => {
      const days = d.work_days.split(',').map((x) => DAYS[+x]).join('، ');
      return `<tr><td><b>${esc(d.name)}</b><br><small class="muted en">${esc(d.email)}</small></td><td>${esc(d.specialty)}</td><td>${esc(d.clinic_name || '—')}</td>
        <td><b>${money(d.fee)}</b> جنيه</td><td>${hour(d.start_hour)} – ${hour(d.end_hour)} · ${d.slot_minutes} د<br><small class="muted">${days}</small></td>
        <td><span class="chip teal">${d.service_ids.length} خدمة</span></td>
        <td><button class="btn secondary small" data-edit="${d.id}">تعديل الإعدادات</button></td></tr>`;
    }).join('')}</tbody>`;
  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => openDoctor(doctors.find((d) => d.id === Number(b.dataset.edit)))));
}

function renderServicePicker(selected) {
  const sel = new Set(selected);
  $('#d_services').innerHTML = catalog.map((c, i) => {
    const items = c.services.filter((s) => s.active || sel.has(s.id));
    if (!items.length) return '';
    return `<details class="svcgroup" ${items.some((s) => sel.has(s.id)) ? 'open' : ''}>
      <summary><span>${CAT_ICONS[i % CAT_ICONS.length]}</span> ${esc(c.name_ar)} <span class="count"></span></summary>
      <div class="checks">${items.map((s) => `<label><input type="checkbox" value="${s.id}" ${sel.has(s.id) ? 'checked' : ''}> ${esc(s.name_ar)}</label>`).join('')}</div></details>`;
  }).join('');
  const refresh = () => $$('#d_services .svcgroup').forEach((g) => {
    const b = $$('input', g); g.querySelector('.count').textContent = `${b.filter((x) => x.checked).length} / ${b.length}`;
  });
  refresh(); $('#d_services').onchange = refresh;
}

function openDoctor(d) {
  editing = d || null;
  $('#docErr').innerHTML = '';
  $('#docTitle').textContent = d ? `إعدادات ${d.name}` : 'إضافة دكتور جديد';
  $('#accountRow').hidden = !!d;
  $('#d_email').required = !d; $('#d_password').required = !d;
  const v = d || { name: '', specialty: specialties[0], fee: 300, clinic_name: '', address: '', start_hour: 10, end_hour: 18, slot_minutes: 30, work_days: '0,1,2,3,4,6', bio: '', service_ids: [] };
  $('#d_name').value = v.name; $('#d_specialty').value = v.specialty; $('#d_fee').value = v.fee;
  $('#d_email').value = ''; $('#d_password').value = ''; $('#d_phone').value = v.phone || '';
  $('#d_clinic').value = v.clinic_name; $('#d_address').value = v.address; $('#d_start').value = v.start_hour; $('#d_end').value = v.end_hour;
  $('#d_slot').value = v.slot_minutes; $('#d_bio').value = v.bio;
  const wd = new Set(v.work_days.split(',').map(Number));
  $$('#d_days input').forEach((c) => { c.checked = wd.has(Number(c.value)); });
  renderServicePicker(v.service_ids);
  dlg.showModal();
}
$('#addDoctor').addEventListener('click', () => openDoctor(null));

$('#docForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#docErr').innerHTML = '';
  const body = {
    name: $('#d_name').value, specialty: $('#d_specialty').value, fee: $('#d_fee').value, phone: $('#d_phone').value,
    clinic_name: $('#d_clinic').value, address: $('#d_address').value, start_hour: $('#d_start').value, end_hour: $('#d_end').value,
    slot_minutes: $('#d_slot').value, bio: $('#d_bio').value,
    work_days: $$('#d_days input:checked').map((c) => Number(c.value)),
    service_ids: $$('#d_services input:checked').map((c) => Number(c.value)),
  };
  if (!body.work_days.length) { $('#docErr').innerHTML = '<div class="error">اختار يوم شغل واحد على الأقل</div>'; return; }
  try {
    if (editing) await api('/api/admin/doctors/' + editing.id, { method: 'PUT', body });
    else await api('/api/admin/doctors', { method: 'POST', body: { ...body, email: $('#d_email').value, password: $('#d_password').value } });
    dlg.close(); toast(editing ? 'تم حفظ الإعدادات ✅' : 'تمت إضافة الدكتور ✅');
    loaded.overview = false; loadDoctors();
  } catch (err) { $('#docErr').innerHTML = `<div class="error" role="alert">${esc(err.message)}</div>`; }
});

/* ============ الخدمات ============ */
const nameDlg = $('#nameDialog');
let nameCtx = null; // { type: 'cat'|'svc', id?, categoryId? }

async function loadServices() {
  catalog = await api('/api/admin/services');
  $('#catList').innerHTML = catalog.map((c, i) => `<section class="card" style="margin-bottom:14px">
    <h2><span>${CAT_ICONS[i % CAT_ICONS.length]} ${esc(c.name_ar)} ${c.name_en ? `<small class="muted en" style="font-weight:400">${esc(c.name_en)}</small>` : ''}
      <span class="chip">${c.services.length}</span></span>
      <span style="display:flex;gap:6px"><button class="btn secondary small" data-addsvc="${c.id}">+ خدمة</button>
      <button class="iconbtn" data-editcat="${c.id}" title="تعديل القسم" aria-label="تعديل القسم">✏️</button>
      <button class="iconbtn del" data-delcat="${c.id}" title="حذف القسم" aria-label="حذف القسم">🗑️</button></span></h2>
    ${c.services.length ? c.services.map((s) => `<div class="svcrow ${s.active ? '' : 'off'}">
      <div class="nm">${esc(s.name_ar)}<small class="en">${esc(s.name_en)}</small></div>
      <span class="chip ${s.doctors ? 'teal' : 'off'}">${s.doctors} دكتور</span>
      <button class="iconbtn" data-toggle="${s.id}" title="${s.active ? 'تعطيل' : 'تفعيل'}" aria-label="${s.active ? 'تعطيل' : 'تفعيل'}">${s.active ? '👁️' : '🚫'}</button>
      <button class="iconbtn" data-editsvc="${s.id}" title="تعديل" aria-label="تعديل">✏️</button>
      <button class="iconbtn del" data-delsvc="${s.id}" title="حذف" aria-label="حذف">🗑️</button></div>`).join('') : '<div class="muted">القسم فاضي.</div>'}
  </section>`).join('');
  const svc = (id) => catalog.flatMap((c) => c.services).find((s) => s.id === Number(id));
  const cat = (id) => catalog.find((c) => c.id === Number(id));
  $$('[data-addsvc]').forEach((b) => b.addEventListener('click', () => openName({ type: 'svc', categoryId: Number(b.dataset.addsvc) })));
  $$('[data-editcat]').forEach((b) => b.addEventListener('click', () => openName({ type: 'cat', id: Number(b.dataset.editcat), cur: cat(b.dataset.editcat) })));
  $$('[data-editsvc]').forEach((b) => b.addEventListener('click', () => { const s = svc(b.dataset.editsvc); openName({ type: 'svc', id: s.id, categoryId: s.category_id, cur: s }); }));
  const act = async (fn, msg) => { try { await fn(); toast(msg); loadServices(); } catch (e) { toast(e.message); } };
  $$('[data-toggle]').forEach((b) => b.addEventListener('click', () => { const s = svc(b.dataset.toggle);
    act(() => api('/api/admin/services/' + s.id, { method: 'PUT', body: { active: !s.active } }), s.active ? 'تم تعطيل الخدمة' : 'تم تفعيل الخدمة'); }));
  $$('[data-delsvc]').forEach((b) => b.addEventListener('click', () => { const s = svc(b.dataset.delsvc);
    if (confirm(`حذف الخدمة "${s.name_ar}"؟`)) act(() => api('/api/admin/services/' + s.id, { method: 'DELETE' }), 'تم حذف الخدمة'); }));
  $$('[data-delcat]').forEach((b) => b.addEventListener('click', () => { const c = cat(b.dataset.delcat);
    if (confirm(`حذف القسم "${c.name_ar}"؟`)) act(() => api('/api/admin/categories/' + c.id, { method: 'DELETE' }), 'تم حذف القسم'); }));
}

function openName(ctx) {
  nameCtx = ctx; $('#nameErr').innerHTML = '';
  const isSvc = ctx.type === 'svc';
  $('#nameTitle').textContent = `${ctx.id ? 'تعديل' : 'إضافة'} ${isSvc ? 'خدمة' : 'قسم'}`;
  $('#catPick').hidden = !isSvc;
  if (isSvc) { $('#n_cat').innerHTML = catalog.map((c) => `<option value="${c.id}">${esc(c.name_ar)}</option>`).join(''); $('#n_cat').value = ctx.categoryId; }
  $('#n_ar').value = ctx.cur?.name_ar || ''; $('#n_en').value = ctx.cur?.name_en || '';
  nameDlg.showModal(); $('#n_ar').focus();
}
$('#addCat').addEventListener('click', () => openName({ type: 'cat' }));
$('#nameForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = { name_ar: $('#n_ar').value, name_en: $('#n_en').value };
  const isSvc = nameCtx.type === 'svc';
  if (isSvc) body.category_id = Number($('#n_cat').value);
  const base = isSvc ? '/api/admin/services' : '/api/admin/categories';
  try {
    await api(nameCtx.id ? `${base}/${nameCtx.id}` : base, { method: nameCtx.id ? 'PUT' : 'POST', body });
    nameDlg.close(); toast('تم الحفظ ✅'); loadServices();
  } catch (err) { $('#nameErr').innerHTML = `<div class="error" role="alert">${esc(err.message)}</div>`; }
});

/* ============ روابط التواصل ============ */
async function loadSettings() {
  const st = await api('/api/settings');
  for (const k of ['facebook', 'instagram', 'linkedin']) $('#st_' + k).value = st[k] || '';
}
$('#setForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/admin/settings', { method: 'PUT', body: Object.fromEntries(['facebook', 'instagram', 'linkedin'].map((k) => [k, $('#st_' + k).value])) });
    toast('تم حفظ الروابط ✅');
  } catch (err) { toast(err.message); }
});

showTab(['overview', 'doctors', 'services', 'settings'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview');
