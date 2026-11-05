import { $, $$, api, esc, homeFor } from './common.js';

// لو المستخدم مسجل دخول بالفعل نوديه على صفحته
try {
  const { user } = await api('/api/me');
  if (user) location.replace(homeFor(user.role));
} catch { /* ignore */ }

function show(mode) {
  $$('.seg button').forEach((b) => { const on = b.dataset.mode === mode; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
  $('#loginForm').hidden = mode !== 'login';
  $('#signupForm').hidden = mode !== 'signup';
  $('#err').innerHTML = '';
}
$$('.seg button').forEach((b) => b.addEventListener('click', () => show(b.dataset.mode)));

const fail = (e) => { $('#err').innerHTML = `<div class="error" role="alert">${esc(e.message)}</div>`; };

// التحويل بعد الدخول: لمسار داخلي فقط (next) أو لصفحة الدور
function go(user) {
  const next = new URLSearchParams(location.search).get('next');
  const safe = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
  location.href = user.role === 'patient' && safe ? safe : homeFor(user.role);
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#err').innerHTML = '';
  try { go(await api('/api/login', { method: 'POST', body: { email: $('#l_email').value, password: $('#l_password').value } })); }
  catch (err) { fail(err); }
});

$('#signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#err').innerHTML = '';
  try {
    go(await api('/api/register', { method: 'POST', body: {
      name: $('#s_name').value, phone: $('#s_phone').value, email: $('#s_email').value, password: $('#s_password').value,
    } }));
  } catch (err) { fail(err); }
});
