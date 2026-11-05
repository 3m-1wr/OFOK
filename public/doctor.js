import { $, $$, api, esc, stars, initial, requireRole, toast, todayStr, addDays, dayName, dayShort, dayLong, dow, fmtTime, money, renderFooter } from './common.js';

await requireRole('patient');
renderFooter();
const params = new URLSearchParams(location.search);
const page = $('#page');

let doc;
try { doc = await api('/api/doctors/' + encodeURIComponent(params.get('id'))); }
catch (e) { page.innerHTML = `<div class="card empty" style="grid-column:1/-1">${esc(e.message)}</div>`; throw e; }

document.title = `${doc.name} - OFOK`;
const workDays = doc.work_days.split(',').map(Number);
const today = todayStr();
const dates = Array.from({ length: 14 }, (_, i) => addDays(today, i));
let selDate = dates.find((d) => workDays.includes(dow(d))) || dates[0];
let selTime = null;
const wanted = Number(params.get('service'));
let selService = doc.services.some((s) => s.id === wanted) ? wanted : (doc.services.length === 1 ? doc.services[0].id : null);
const needsService = doc.services.length > 0;

page.innerHTML = `
  <section>
    <div class="card doc">
      <div class="avatar lg" aria-hidden="true">${initial(doc.name)}</div>
      <div class="docinfo">
        <h1>${esc(doc.name)}</h1>
        <div class="muted">${esc(doc.specialty)}</div>
        <div style="margin:4px 0">${stars(doc.rating)} <span class="muted">(${doc.reviews_count} تقييم)</span></div>
        ${doc.bio ? `<p class="bio">${esc(doc.bio)}</p>` : ''}
        <div class="actions"><span class="chip warn">الكشف ${money(doc.fee)} جنيه</span></div>
      </div>
    </div>
    ${needsService ? `<div class="card" style="margin-top:16px"><h2 style="font-size:1.05rem;margin-bottom:12px">الخدمات المتاحة</h2>
      <div class="tags">${doc.services.map((s) => `<span class="tag">${esc(s.name_ar)}</span>`).join('')}</div></div>` : ''}
    <div class="card reviews-card" style="margin-top:16px">
      <h2 style="margin-bottom:6px;font-size:1.05rem">آراء المرضى</h2>
      <div class="reviews-list">${doc.reviews.length ? doc.reviews.map((r) => `
        <div class="review"><div>${stars(r.rating)} <b>${esc(r.patient_name)}</b></div>
        ${r.comment ? `<div>${esc(r.comment)}</div>` : ''}</div>`).join('') : '<div class="muted">لسه مفيش تقييمات.</div>'}</div>
    </div>
  </section>
  <aside class="card book" style="position:sticky;top:84px">
    <h2>احجز ميعاد</h2>
    ${needsService ? `<div class="step"><b>1</b> اختار الخدمة</div><div class="pills" id="pills" role="radiogroup" aria-label="الخدمة"></div>` : ''}
    <div class="step"><b>${needsService ? 2 : 1}</b> اختار اليوم</div>
    <div class="days" id="days" role="group" aria-label="اختار اليوم"></div>
    <div class="step"><b>${needsService ? 3 : 2}</b> اختار الميعاد</div>
    <div id="slots" class="slots" aria-live="polite"></div>
    <div id="summary" class="summary empty-sum"></div>
    <button class="btn block" id="bookBtn" disabled>أكّد الحجز</button>
  </aside>`;

const svcName = () => doc.services.find((s) => s.id === selService)?.name_ar;

function renderPills() {
  if (!needsService) return;
  $('#pills').innerHTML = doc.services.map((s) =>
    `<button type="button" role="radio" aria-checked="${s.id === selService}" class="pill ${s.id === selService ? 'active' : ''}" data-id="${s.id}">${esc(s.name_ar)}</button>`).join('');
  $$('.pill').forEach((b) => b.addEventListener('click', () => { selService = Number(b.dataset.id); renderPills(); updateSummary(); }));
}

function renderDays() {
  $('#days').innerHTML = dates.map((d) => {
    const off = !workDays.includes(dow(d));
    return `<button class="day ${d === selDate ? 'active' : ''}" data-date="${d}" ${off ? 'disabled title="الدكتور مش موجود اليوم ده"' : ''}>
      ${d === today ? 'النهاردة' : dayName(d)}<small>${dayShort(d)}</small></button>`;
  }).join('');
  $$('.day').forEach((b) => b.addEventListener('click', () => { selDate = b.dataset.date; selTime = null; renderDays(); loadSlots(); }));
}

async function loadSlots() {
  $('#slots').innerHTML = '<span class="muted">جاري التحميل...</span>';
  updateSummary();
  try {
    const { slots } = await api(`/api/doctors/${doc.id}/slots?date=${selDate}`);
    $('#slots').innerHTML = slots.length
      ? slots.map((s) => `<button class="slot ${s.time === selTime ? 'active' : ''}" data-time="${s.time}" ${s.available ? '' : 'disabled'}>${fmtTime(s.time)}</button>`).join('')
      : '<span class="muted">مفيش مواعيد في اليوم ده.</span>';
    $$('.slot').forEach((b) => b.addEventListener('click', () => { selTime = b.dataset.time; $$('.slot').forEach((x) => x.classList.toggle('active', x === b)); updateSummary(); }));
  } catch (e) { $('#slots').innerHTML = `<span class="error">${esc(e.message)}</span>`; }
}

function updateSummary() {
  const ready = selTime && (!needsService || selService);
  const sum = $('#summary');
  if (ready) sum.innerHTML = `${needsService ? esc(svcName()) + '<br>' : ''}${dayLong(selDate)} — ${fmtTime(selTime)}`;
  else sum.textContent = needsService && !selService ? 'اختار الخدمة المطلوبة الأول.' : 'اختار الميعاد المناسب ليك.';
  sum.classList.toggle('empty-sum', !ready);
  $('#bookBtn').disabled = !ready;
}

$('#bookBtn').addEventListener('click', async () => {
  const btn = $('#bookBtn'); btn.disabled = true;
  try {
    await api('/api/bookings', { method: 'POST', body: { doctor_id: doc.id, date: selDate, time: selTime, service_id: selService } });
    toast('تم الحجز ✅');
    setTimeout(() => (location.href = '/my-bookings.html'), 700);
  } catch (e) {
    toast(e.message); selTime = null; loadSlots();
  }
});

renderPills();
renderDays();
loadSlots();
