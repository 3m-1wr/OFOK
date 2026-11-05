import { $, $$, api, esc, stars, requireRole, toast, statusChip, todayStr, dayLong, fmtTime, CAT_ICONS } from './common.js';

await requireRole('doctor');

const today = todayStr();
let all = [];
let filter = 'today';

$$('.tab').forEach((t) => t.addEventListener('click', () => {
  $$('.tab').forEach((x) => { x.classList.toggle('active', x === t); });
  ['bookings', 'reviews', 'services'].forEach((s) => ($('#' + s).hidden = s !== t.dataset.tab));
}));
$$('[data-filter]').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.filter; renderBookings(); }));

function renderStats(rev) {
  const todayN = all.filter((b) => b.date === today && b.status !== 'cancelled').length;
  const upN = all.filter((b) => b.date > today && b.status === 'confirmed').length;
  $('#stats').innerHTML = `
    <div class="card stat"><b>${todayN}</b>حجوزات النهاردة</div>
    <div class="card stat"><b>${upN}</b>حجوزات قادمة</div>
    <div class="card stat"><b>${rev.average ?? '—'}</b>متوسط التقييم</div>
    <div class="card stat"><b>${rev.count}</b>عدد التقييمات</div>`;
}

function renderBookings() {
  $$('[data-filter]').forEach((b) => { b.className = 'btn small ' + (b.dataset.filter === filter ? '' : 'secondary'); });
  const list = all.filter((b) => filter === 'all' || (filter === 'today' ? b.date === today : b.date > today));
  if (!list.length) { $('#bookingsBody').innerHTML = '<div class="card empty">مفيش حجوزات هنا.</div>'; return; }
  $('#bookingsBody').innerHTML = `<div class="tablewrap"><table>
    <thead><tr><th>التاريخ</th><th>الميعاد</th><th>المريض</th><th>الخدمة</th><th>الموبايل</th><th>الحالة</th><th></th></tr></thead>
    <tbody>${list.map((b) => `<tr>
      <td>${dayLong(b.date)}</td><td>${fmtTime(b.time)}</td><td><b>${esc(b.patient_name)}</b></td>
      <td>${b.service_name ? `<span class="chip teal">${esc(b.service_name)}</span>` : '<span class="muted">—</span>'}</td>
      <td dir="ltr" style="text-align:right">${esc(b.patient_phone || '—')}</td><td>${statusChip(b.status)}</td>
      <td style="white-space:nowrap">${b.status === 'confirmed' ? `
        <button class="btn small" data-set="completed" data-id="${b.id}">تم الكشف</button>
        <button class="btn danger small" data-set="cancelled" data-id="${b.id}">إلغاء</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  $$('[data-set]').forEach((btn) => btn.addEventListener('click', async () => {
    if (btn.dataset.set === 'cancelled' && !confirm('إلغاء الحجز ده؟')) return;
    try { await api(`/api/doctor/bookings/${btn.dataset.id}/status`, { method: 'POST', body: { status: btn.dataset.set } }); toast('تم التحديث'); await load(); }
    catch (e) { toast(e.message); }
  }));
}

function renderReviews(rev) {
  $('#reviews').innerHTML = `<div class="card">
    <div style="margin-bottom:8px">المتوسط: ${stars(rev.average)} <span class="muted">(${rev.count} تقييم)</span></div>
    ${rev.reviews.length ? rev.reviews.map((r) => `<div class="review"><div>${stars(r.rating)} <b>${esc(r.patient_name)}</b>
      <span class="muted" style="font-size:.85rem">${esc(r.created_at.slice(0, 10))}</span></div>${r.comment ? `<div>${esc(r.comment)}</div>` : ''}</div>`).join('')
      : '<div class="empty">لسه مفيش تقييمات.</div>'}</div>`;
}

// الخدمات اللي الدكتور بيقدمها (باقي إعدادات العيادة بيظبطها الأدمن)
async function renderServices() {
  const { catalog, selected } = await api('/api/doctor/services');
  const sel = new Set(selected);
  $('#services').innerHTML = `<form class="card" id="svcForm">
    <p class="muted" style="margin-top:0">علّم على الخدمات اللي بتقدمها فعلاً. المرضى هيشوفوك بس في الخدمات دي.
      <br>سعر الكشف ومواعيد العيادة بتتظبط من إدارة OFOK.</p>
    <div class="svcpicker">${catalog.map((c, i) => `<details class="svcgroup" ${c.services.some((s) => sel.has(s.id)) ? 'open' : ''}>
      <summary><span>${CAT_ICONS[i % CAT_ICONS.length]}</span> ${esc(c.name_ar)} <span class="count"></span></summary>
      <div class="checks">${c.services.map((s) => `<label><input type="checkbox" value="${s.id}" ${sel.has(s.id) ? 'checked' : ''}> ${esc(s.name_ar)}</label>`).join('')}</div></details>`).join('')}</div>
    <div style="margin-top:16px;display:flex;align-items:center;gap:14px"><button class="btn">حفظ الخدمات</button><span class="muted" id="svcCount"></span></div></form>`;
  const refresh = () => {
    $$('#svcForm .svcgroup').forEach((g) => {
      const boxes = $$('input', g); g.querySelector('.count').textContent = `${boxes.filter((b) => b.checked).length} / ${boxes.length}`;
    });
    $('#svcCount').textContent = `${$$('#svcForm input:checked').length} خدمة مختارة`;
  };
  refresh();
  $('#svcForm').addEventListener('change', refresh);
  $('#svcForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/doctor/services', { method: 'PUT', body: { service_ids: $$('#svcForm input:checked').map((c) => Number(c.value)) } });
      toast('تم حفظ الخدمات ✅');
    } catch (err) { toast(err.message); }
  });
}

async function load() {
  const [bookings, rev] = await Promise.all([api('/api/doctor/bookings?from=' + today.slice(0, 4) + '-01-01'), api('/api/doctor/reviews')]);
  all = bookings;
  renderStats(rev); renderBookings(); renderReviews(rev);
}

const me = await api('/api/doctor/me');
$('#title').textContent = `أهلاً ${me.name}`;
await Promise.all([load(), renderServices()]);
