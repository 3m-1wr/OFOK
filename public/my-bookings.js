import { $, $$, api, esc, stars, initial, requireRole, toast, statusChip, dayLong, fmtTime, money, renderFooter } from './common.js';

await requireRole('patient');
renderFooter();

async function load() {
  let list;
  try { list = await api('/api/my/bookings'); } catch (e) { $('#list').innerHTML = `<div class="error">${esc(e.message)}</div>`; return; }
  if (!list.length) {
    $('#list').innerHTML = '<div class="card empty">مفيش حجوزات لسه.<br><br><a class="btn" href="/doctors.html">احجز دكتور</a></div>';
    return;
  }
  $('#list').innerHTML = list.map((b) => `
    <article class="card bcard" data-id="${b.id}">
      <div class="avatar" aria-hidden="true">${initial(b.doctor_name)}</div>
      <div style="flex:1;min-width:0">
        <h3>${esc(b.doctor_name)} ${statusChip(b.status)}</h3>
        <div class="meta">${esc(b.specialty)}${b.clinic_name ? ' · ' + esc(b.clinic_name) : ''}</div>
        ${b.service_name ? `<div style="margin-top:6px"><span class="chip teal">🦷 ${esc(b.service_name)}</span></div>` : ''}
        <div class="when"><span>📅 ${dayLong(b.date)}</span><span>🕐 ${fmtTime(b.time)}</span><span>💰 ${money(b.fee)} جنيه</span></div>
        <div class="actions">${b.status === 'confirmed' ? `<button class="btn danger small" data-cancel="${b.id}">إلغاء الحجز</button>` : ''}</div>
        ${b.status === 'completed' ? (b.my_rating
          ? `<div style="margin-top:10px">تقييمك: ${stars(b.my_rating)} ${b.my_comment ? '— ' + esc(b.my_comment) : ''}</div>`
          : `<form class="rate" data-rate="${b.id}" style="margin-top:12px;border-top:1px solid var(--line);padding-top:12px">
              <b>قيّم الكشف</b>
              <div class="ratepick" role="radiogroup" aria-label="التقييم">
                ${[5, 4, 3, 2, 1].map((n) => `<input type="radio" name="r${b.id}" id="r${b.id}-${n}" value="${n}"><label for="r${b.id}-${n}" title="${n} من 5">★</label>`).join('')}
              </div>
              <textarea rows="2" maxlength="500" placeholder="اكتب رأيك (اختياري)" style="margin:8px 0"></textarea>
              <button class="btn small">إرسال التقييم</button>
            </form>`) : ''}
      </div>
    </article>`).join('');

  $$('[data-cancel]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('متأكد إنك عايز تلغي الحجز؟')) return;
    try { await api(`/api/bookings/${btn.dataset.cancel}/cancel`, { method: 'POST' }); toast('تم إلغاء الحجز'); load(); }
    catch (e) { toast(e.message); }
  }));

  $$('form.rate').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rating = f.querySelector('input:checked')?.value;
    if (!rating) { toast('اختار عدد النجوم الأول'); return; }
    try {
      await api(`/api/bookings/${f.dataset.rate}/review`, { method: 'POST', body: { rating, comment: f.querySelector('textarea').value } });
      toast('شكراً على تقييمك'); load();
    } catch (err) { toast(err.message); }
  }));
}
load();
