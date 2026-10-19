'use strict';

// The agent's own page (2.5.1): it only enrols the PC. Everything else is in Gnext (§20).

const $ = (sel) => document.querySelector(sel);
let state = null;

// Every change carries X-Gnext-Local; the agent refuses state changes without it.
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Gnext-Local': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.detail || `خطای ${res.status}`);
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}

function toast(message, isError) {
  const t = $('#toast');
  t.textContent = message;
  t.className = 'toast' + (isError ? ' error' : '');
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), isError ? 6000 : 3000);
}

async function refresh() {
  try {
    state = await api('GET', '/agent/api/status');
  } catch (e) {
    $('#conn').textContent = 'عامل در دسترس نیست';
    $('#conn').className = 'badge bad';
    return;
  }
  render();
}

function render() {
  const s = state;
  const connected = !!s.agent?.connected;
  const branch = s.agent?.branch_name || s.branch_name || '';

  $('#subtitle').textContent = `نسخه ${s.version}`;
  const conn = $('#conn');
  if (!s.enrolled) [conn.textContent, conn.className] = ['وصل نشده', 'badge'];
  else if (connected) [conn.textContent, conn.className] = ['متصل به سرور', 'badge ok'];
  else [conn.textContent, conn.className] = [s.stopped ? 'متوقف' : 'قطع از سرور', 'badge bad'];

  $('#enrolled').hidden = !s.enrolled;
  $('#not-enrolled').hidden = !!s.enrolled;
  $('#branch').textContent = branch || '—';

  // One form, shown in whichever card is visible.
  const form = $('#enrol-form');
  const slot = s.enrolled ? $('#enrol-slot-enrolled') : $('#enrol-slot-new');
  if (form.parentElement !== slot) slot.append(form);
  if (!form.dataset.touched) form.server.value = s.server || 'https://gnext.top';
}

$('#enrol-form').addEventListener('input', (e) => (e.currentTarget.dataset.touched = '1'));
$('#enrol-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  if (state?.enrolled && !confirm('عامل فعلی این رایانه لغو و با کد جدید ثبت می‌شود. ادامه می‌دهید؟')) return;
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await api('POST', '/agent/api/enrol', { server: form.server.value, code: form.code.value });
    form.code.value = '';
    delete form.dataset.touched;
    toast('ثبت شد. در حال اتصال…');
    setTimeout(refresh, 1500);
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
  }
});

refresh();
setInterval(refresh, 3000);
