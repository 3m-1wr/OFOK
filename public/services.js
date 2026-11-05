import { $, api, esc, requireRole, renderFooter, CAT_ICONS } from './common.js';

await requireRole('patient');
renderFooter();

const catalog = await api('/api/services');

function render() {
  const q = $('#q').value.trim().toLowerCase();
  const html = catalog.map((c, i) => {
    const catHit = q && `${c.name_ar} ${c.name_en}`.toLowerCase().includes(q);
    const items = c.services.filter((s) => !q || catHit || `${s.name_ar} ${s.name_en}`.toLowerCase().includes(q));
    if (!items.length) return '';
    return `<article class="card cat">
      <header><div class="ico" aria-hidden="true">${CAT_ICONS[i % CAT_ICONS.length]}</div>
        <h2>${esc(c.name_ar)}${c.name_en ? `<small class="en">${esc(c.name_en)}</small>` : ''}</h2><span class="num">${i + 1}</span></header>
      <ul>${items.map((s) => `<li class="${s.doctors ? '' : 'none'}"><a href="/doctors.html?service=${s.id}">
        <span class="nm">${esc(s.name_ar)}${s.name_en ? `<small class="en">${esc(s.name_en)}</small>` : ''}</span>
        <span class="cnt">${s.doctors ? s.doctors + ' دكتور' : 'قريباً'}</span></a></li>`).join('')}</ul>
    </article>`;
  }).join('');
  $('#grid').innerHTML = html || '<div class="card empty" style="grid-column:1/-1">مفيش خدمة بالاسم ده.</div>';
}
$('#q').addEventListener('input', render);
render();
