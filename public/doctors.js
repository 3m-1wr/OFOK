import { $, api, esc, stars, initial, requireRole, toast, money, renderFooter } from './common.js';

await requireRole('patient');
renderFooter();

const [specs, catalog] = await Promise.all([api('/api/specialties'), api('/api/services')]);
$('#specialty').insertAdjacentHTML('beforeend', specs.map((s) => `<option>${esc(s)}</option>`).join(''));
$('#service').insertAdjacentHTML('beforeend', catalog.map((c) =>
  `<optgroup label="${esc(c.name_ar)}">${c.services.map((s) => `<option value="${s.id}">${esc(s.name_ar)}</option>`).join('')}</optgroup>`).join(''));

const params = new URLSearchParams(location.search);
if (params.get('service')) $('#service').value = params.get('service');
const serviceName = (id) => catalog.flatMap((c) => c.services).find((s) => String(s.id) === String(id))?.name_ar;

function card(d, serviceId) {
  const link = `/doctor.html?id=${d.id}${serviceId ? '&service=' + serviceId : ''}`;
  const tags = d.services.slice(0, 3).map((s) => `<span class="tag">${esc(s.name_ar)}</span>`).join('')
    + (d.services.length > 3 ? `<span class="tag">+${d.services.length - 3}</span>` : '');
  return `<article class="card dcard">
    <div class="top">
      <div class="avatar" aria-hidden="true">${initial(d.name)}</div>
      <div style="min-width:0">
        <h3><a href="${link}">${esc(d.name)}</a></h3>
        <div class="meta">${esc(d.specialty)}</div>
        <div>${stars(d.rating)} <span class="muted">(${d.reviews_count})</span></div>
      </div>
    </div>
    ${tags ? `<div class="tags">${tags}</div>` : ''}
    <div class="foot"><span class="price">${money(d.fee)} <small>جنيه</small></span><a class="btn small" href="${link}">احجز دلوقتي</a></div>
  </article>`;
}

async function search() {
  const p = new URLSearchParams();
  if ($('#q').value.trim()) p.set('q', $('#q').value.trim());
  if ($('#specialty').value) p.set('specialty', $('#specialty').value);
  const sid = $('#service').value;
  if (sid) p.set('service', sid);
  let list;
  try { list = await api('/api/doctors?' + p); } catch (e) { toast(e.message); return; }
  $('#activeFilter').innerHTML = sid
    ? `<div class="activefilter">🦷 الدكاترة اللي بيقدموا خدمة: <b>${esc(serviceName(sid))}</b> <button class="btn ghost small" id="clearSvc" type="button">إلغاء الفلتر</button></div>` : '';
  $('#clearSvc')?.addEventListener('click', () => { $('#service').value = ''; search(); });
  $('#count').textContent = list.length ? `${list.length} دكتور` : '';
  $('#list').innerHTML = list.length ? list.map((d) => card(d, sid)).join('')
    : '<div class="card empty" style="grid-column:1/-1">مفيش دكاترة مطابقين، جرّب تغيّر البحث أو الخدمة.</div>';
}

$('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); search(); });
$('#specialty').addEventListener('change', search);
$('#service').addEventListener('change', search);
search();
