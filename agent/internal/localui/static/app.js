'use strict';

const $ = (sel) => document.querySelector(sel);
const fa = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
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

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) node.append(c instanceof Node ? c : document.createTextNode(c ?? ''));
  return node;
}

function when(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fa-IR');
}

// ---- tabs ----
function showTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.panel').forEach((p) => (p.hidden = p.id !== 'tab-' + name));
  if (name === 'logs') loadLogs();
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.goto)));

// ---- status ----
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
  const a = s.agent;
  const connected = !!a?.connected;
  const branch = a?.branch_name || s.branch_name || '';

  $('#subtitle').textContent = s.enrolled ? `شعبه ${branch || '—'} · نسخه ${s.version}` : `وصل نشده · نسخه ${s.version}`;
  const conn = $('#conn');
  if (!s.enrolled) [conn.textContent, conn.className] = ['وصل نشده', 'badge'];
  else if (connected) [conn.textContent, conn.className] = ['متصل به سرور', 'badge ok'];
  else [conn.textContent, conn.className] = [s.stopped ? 'متوقف' : 'قطع از سرور', 'badge bad'];

  $('#not-enrolled').hidden = s.enrolled;
  $('#s-conn').textContent = !s.enrolled ? 'وصل نشده' : connected ? 'متصل' : s.stopped || 'در تلاش برای اتصال…';
  $('#s-server').textContent = s.server || '—';
  $('#s-branch').textContent = branch || '—';
  $('#s-since').textContent = when(a?.connected_since);
  $('#s-error').textContent = (!connected && a?.last_error) || '—';
  $('#s-version').textContent = s.version;
  $('#s-agent').textContent = s.agent_id || '—';
  $('#s-running').textContent = a ? fa(a.running) : '—';
  const cfg = a?.config || { printers: [], terminals: [] };
  const terminals = (cfg.terminals || []).filter((t) => t.active || t.driver);
  $('#s-devices').textContent = a ? `${fa((cfg.printers || []).length)} چاپگر، ${fa(terminals.length)} کارت‌خوان` : '—';

  renderRegisters(s);
  renderLinks(s);

  if (!$('#enrol-form').dataset.touched) {
    $('#enrol-form').server.value = s.server || 'https://gnext.top';
  }
  $('#enrol-replace').hidden = !s.enrolled;
  $('#enrol-branch').textContent = branch;
}

// Devices, the network scan and this PC's settings are on Gnext's own screens (2.5.0, §20).
function renderLinks(s) {
  $('#in-gnext').hidden = !s.enrolled;
  const origin = (s.app_origin || s.server || '').replace(/\/+$/, '');
  if (!origin) return;
  $('#link-printers').href = origin + '/app/operations/printers';
  $('#link-terminals').href = origin + '/app/operations/card-terminals';
  $('#link-agents').href = origin + '/app/operations/agents';
}

// ---- registers on this network, the app build ----
function renderRegisters(s) {
  const urls = s.lan_urls || [];
  // Redraw the list only when it changes, so the 3-second refresh does not steal a click on Copy.
  const key = JSON.stringify(urls);
  if (key !== renderRegisters.last) {
    renderRegisters.last = key;
    $('#lan-urls').replaceChildren(
      ...urls.map((u) =>
        el('li', {}, el('code', {}, u), el('button', { class: 'btn sm', type: 'button', onclick: (e) => copyText(u, e.currentTarget) }, 'کپی')),
      ),
    );
  }
  $('#lan-none').hidden = urls.length > 0;

  const app = s.app;
  $('#app-build').textContent = app?.build_id || 'هنوز دریافت نشده';
  $('#app-built').textContent = when(app?.built_at);
  $('#app-downloaded').textContent = when(app?.downloaded_at);
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    // No clipboard API (or no permission): select the text in a hidden field and copy that.
    const ta = el('textarea', { class: 'offscreen' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) return toast('کپی نشد؛ آدرس را با دست انتخاب کنید.', true);
  }
  const old = button.textContent;
  button.textContent = 'کپی شد';
  setTimeout(() => (button.textContent = old), 1500);
}

// ---- enrolment ----
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
    showTab('status');
    setTimeout(refresh, 1500);
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
  }
});

// ---- logs ----
async function loadLogs() {
  try {
    const { lines } = await api('GET', '/agent/api/logs?lines=400');
    const pre = $('#logs');
    pre.textContent = lines.join('\n') || '—';
    pre.scrollTop = pre.scrollHeight;
  } catch (e) {
    toast(e.message, true);
  }
}
$('#refresh-logs').addEventListener('click', loadLogs);

refresh();
setInterval(refresh, 3000);
