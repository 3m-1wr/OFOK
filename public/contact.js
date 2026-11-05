import { $, api, esc, requireRole, renderFooter, ICONS, SOCIAL_NAMES } from './common.js';

await requireRole('patient');
renderFooter();

const st = await api('/api/settings');
const META = {
  facebook: ['fb', 'صفحتنا على فيسبوك', 'آخر العروض والأخبار'],
  instagram: ['ig', 'حسابنا على إنستجرام', 'صور وقبل وبعد وحالات'],
  linkedin: ['li', 'صفحتنا على لينكد إن', 'عن OFOK والفريق'],
};
const ok = (u) => /^https?:\/\//i.test(u || '');
const cards = Object.keys(META).filter((k) => ok(st[k])).map((k) => {
  const [cls, title, sub] = META[k];
  return `<a class="card social ${cls}" href="${esc(st[k])}" target="_blank" rel="noopener noreferrer">
    <div class="badge">${ICONS[k]}</div><h2>${title}</h2><p>${sub}</p><span class="btn secondary small">زيارة ${SOCIAL_NAMES[k]}</span></a>`;
}).join('');
$('#social').innerHTML = cards || '<div class="card empty" style="grid-column:1/-1">روابط التواصل هتتضاف قريباً.</div>';
