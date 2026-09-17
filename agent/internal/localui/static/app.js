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

const STATUS = {
  ONLINE: ['آنلاین', 'ok'],
  OFFLINE: ['قطع', 'bad'],
  ERROR: ['خطا', 'bad'],
  UNSUPPORTED: ['پشتیبانی نمی‌شود', ''],
  UNKNOWN: ['نامشخص', ''],
};
const TYPES = { THERMAL_RECEIPT: 'رسید', KITCHEN_IMPACT: 'آشپزخانه', LABEL: 'برچسب' };
const DRIVERS = { fake: 'آزمایشی', sep: 'سامان' };

function badge(status) {
  const [label, cls] = STATUS[status] || STATUS.UNKNOWN;
  return el('span', { class: 'badge ' + cls }, label);
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
    state = await api('GET', '/api/status');
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

  const user = s.user;
  $('#who').textContent = user ? `${user.display_name || user.username} (${user.role})` : '';
  $('#signin').hidden = !!user || !s.enrolled;
  $('#signout').hidden = !user;

  if (!$('#enrol-form').dataset.touched) {
    $('#enrol-form').server.value = s.server || 'https://gnextdev.ir';
  }
  $('#enrol-replace').hidden = !s.enrolled;
  $('#enrol-branch').textContent = branch;

  renderDevices(a, cfg, terminals);
}

function statusOf(a, kind, id) {
  return (a?.devices || []).find((d) => d.kind === kind && d.id === id)?.status || 'UNKNOWN';
}

function addr(c) {
  if (!c) return '—';
  if (c.kind === 'tcp') return `${c.host}:${c.port}`;
  if (c.kind === 'windows') return c.printer_name;
  return c.port || c.kind;
}

function renderDevices(a, cfg, terminals) {
  // Redraw only on change, so the 3-second refresh does not steal clicks or focus.
  const key = JSON.stringify([!!a, cfg.printers, terminals, a?.devices?.map((d) => d.kind + d.id + d.status)]);
  if (key === renderDevices.last) return;
  renderDevices.last = key;
  const printers = $('#printers');
  printers.replaceChildren(
    ...((cfg.printers || []).length
      ? cfg.printers.map((p) =>
          el('tr', {},
            el('td', {}, p.name, p.active ? '' : el('span', { class: 'muted small' }, ' (غیرفعال)')),
            el('td', { class: 'ltr' }, p.code),
            el('td', {}, TYPES[p.type] || p.type),
            el('td', { class: 'ltr' }, addr(p.connection)),
            // A printer without a connection is still printed by the cloud's simulator.
            el('td', {}, p.connection ? badge(statusOf(a, 'printer', p.id)) : el('span', { class: 'muted' }, 'وصل به عامل نیست')),
            el('td', { class: 'acts' },
              p.connection ? el('button', { class: 'btn sm', onclick: () => testPrint(p) }, 'چاپ آزمایشی') : '',
              ' ',
              el('button', { class: 'btn sm', onclick: () => editPrinter(p) }, p.connection ? 'ویرایش' : 'اتصال'),
              ' ',
              el('button', { class: 'btn sm danger', onclick: () => removeDevice('printers', p) }, 'حذف'),
            ),
          ),
        )
      : [el('tr', {}, el('td', { class: 'empty', colspan: 6 }, a ? 'چاپگری تعریف نشده است.' : 'عامل در حال اجرا نیست.'))]),
  );

  $('#terminals').replaceChildren(
    ...(terminals.length
      ? terminals.map((t) =>
          el('tr', {},
            el('td', {}, t.name),
            el('td', { class: 'ltr' }, t.code),
            el('td', {}, t.driver ? DRIVERS[t.driver] || t.driver : el('span', { class: 'muted' }, 'وصل به عامل نیست')),
            el('td', { class: 'ltr' }, addr(t.connection)),
            el('td', {}, t.driver ? badge(statusOf(a, 'terminal', t.id)) : el('span', { class: 'muted' }, '—')),
            el('td', { class: 'acts' },
              el('button', { class: 'btn sm', onclick: () => editTerminal(t) }, t.driver ? 'ویرایش' : 'اتصال'),
              ' ',
              el('button', { class: 'btn sm danger', onclick: () => removeDevice('terminals', t) }, 'حذف'),
            ),
          ),
        )
      : [el('tr', {}, el('td', { class: 'empty', colspan: 6 }, a ? 'کارت‌خوانی تعریف نشده است.' : 'عامل در حال اجرا نیست.'))]),
  );
}

// ---- sign-in ----
function requireSignIn() {
  if (state?.user) return Promise.resolve(true);
  if (!state?.enrolled) {
    toast('ابتدا این رایانه را به شعبه وصل کنید.', true);
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const dlg = $('#dlg-signin');
    const form = $('#signin-form');
    form.reset();
    dlg.onclose = async () => {
      if (dlg.returnValue !== 'ok') return resolve(false);
      try {
        const { user } = await api('POST', '/api/login', { username: form.username.value, password: form.password.value });
        state.user = user;
        render();
        toast(`خوش آمدید، ${user.display_name || user.username}`);
        resolve(true);
      } catch (e) {
        toast(e.message, true);
        resolve(false);
      }
    };
    dlg.showModal();
  });
}
$('#signin').addEventListener('click', () => requireSignIn());
$('#signout').addEventListener('click', async () => {
  await api('POST', '/api/logout').catch(() => {});
  await refresh();
});

// A change the cloud refused for lack of a session asks for sign-in and tries once more.
async function asManager(fn) {
  if (!(await requireSignIn())) return;
  try {
    await fn();
  } catch (e) {
    if (e.status === 401) {
      state.user = null;
      if (await requireSignIn()) {
        try { await fn(); } catch (e2) { toast(e2.message, true); }
      }
      return;
    }
    toast(e.message, true);
  }
  setTimeout(refresh, 800);
}

// ---- printers ----
function editPrinter(p) {
  asManager(async () => {
    const dlg = $('#dlg-printer');
    const form = $('#printer-form');
    form.reset();
    $('#found-list').replaceChildren();
    $('#scan-result').textContent = '';
    $('#printer-title').textContent = !p ? 'افزودن چاپگر' : p.connection ? 'ویرایش چاپگر' : 'اتصال چاپگر به عامل';
    if (p) {
      form.name.value = p.name;
      form.code.value = p.code;
      form.printer_type.value = p.type;
      form.paper_width_mm.value = String(p.paper_width_mm || 80);
      form.host.value = p.connection?.host || '';
      form.port.value = p.connection?.port || 9100;
    }
    const ok = await new Promise((resolve) => {
      dlg.onclose = () => resolve(dlg.returnValue === 'ok');
      dlg.showModal();
    });
    if (!ok) return;
    const body = {
      name: form.name.value,
      code: form.code.value,
      printer_type: form.printer_type.value,
      paper_width_mm: Number(form.paper_width_mm.value),
      connection: { kind: 'tcp', host: form.host.value.trim(), port: Number(form.port.value) },
    };
    if (p) await api('PATCH', `/api/printers/${p.id}`, body);
    else await api('POST', '/api/printers', body);
    toast('چاپگر ذخیره شد.');
  });
}
$('#add-printer').addEventListener('click', () => editPrinter(null));

$('#scan').addEventListener('click', async () => {
  const btn = $('#scan');
  btn.disabled = true;
  $('#scan-result').textContent = 'در حال جستجو… (تا ۳۰ ثانیه)';
  try {
    const { found } = await api('POST', '/api/scan', { port: Number($('#printer-form').port.value) || 9100 });
    $('#scan-result').textContent = found.length ? `${fa(found.length)} دستگاه پیدا شد:` : 'دستگاهی پیدا نشد.';
    $('#found-hosts').replaceChildren(...found.map((f) => el('option', { value: f.host })));
    $('#found-list').replaceChildren(
      ...found.map((f) => el('button', { type: 'button', class: 'btn sm', onclick: () => { $('#printer-form').host.value = f.host; } }, f.host)),
    );
  } catch (e) {
    $('#scan-result').textContent = e.message;
  } finally {
    btn.disabled = false;
  }
});

async function testPrint(p) {
  toast(`در حال ارسال چاپ آزمایشی به ${p.name}…`);
  try {
    await api('POST', `/api/printers/${p.id}/test`);
    toast('چاپ آزمایشی ارسال شد.');
  } catch (e) {
    toast(e.message, true);
  }
}

// ---- terminals ----
function editTerminal(t) {
  asManager(async () => {
    const dlg = $('#dlg-terminal');
    const form = $('#terminal-form');
    form.reset();
    $('#terminal-title').textContent = t ? 'ویرایش کارت‌خوان' : 'افزودن کارت‌خوان';
    if (t) {
      const c = t.connection;
      form.name.value = t.name;
      form.code.value = t.code;
      form.driver.value = t.driver || 'fake';
      form.kind.value = c?.kind === 'serial' ? 'serial' : 'tcp';
      form.host.value = c?.kind === 'tcp' ? c.host : '';
      form.port.value = c?.kind === 'tcp' ? c.port : 8888;
      form.com.value = c?.kind === 'serial' ? c.port : '';
      if (c?.kind === 'serial') form.baud.value = String(c.baud || 115200);
    }
    showTerminalKind();
    const ok = await new Promise((resolve) => {
      dlg.onclose = () => resolve(dlg.returnValue === 'ok');
      dlg.showModal();
    });
    if (!ok) return;
    const serial = form.kind.value === 'serial';
    const connection = serial
      ? { kind: 'serial', port: form.com.value.trim().toUpperCase(), baud: Number(form.baud.value) }
      : { kind: 'tcp', host: form.host.value.trim(), port: Number(form.port.value) || 8888 };
    if (serial ? !connection.port : !connection.host) {
      throw new Error(serial ? 'پورت COM را وارد کنید.' : 'آدرس IP کارت‌خوان را وارد کنید.');
    }
    const body = {
      name: form.name.value,
      code: form.code.value,
      driver: form.driver.value,
      connection,
    };
    if (t) await api('PATCH', `/api/terminals/${t.id}`, body);
    else await api('POST', '/api/terminals', body);
    toast('کارت‌خوان ذخیره شد.');
  });
}
$('#add-terminal').addEventListener('click', () => editTerminal(null));

function showTerminalKind() {
  const serial = $('#terminal-form').kind.value === 'serial';
  $('#terminal-lan').hidden = serial;
  $('#terminal-com').hidden = !serial;
}
$('#terminal-form').kind.addEventListener('change', showTerminalKind);

function removeDevice(kind, d) {
  const what = kind === 'printers' ? 'چاپگر' : 'کارت‌خوان';
  if (!confirm(`${what} «${d.name}» حذف شود؟`)) return;
  asManager(async () => {
    await api('DELETE', `/api/${kind}/${d.id}`);
    toast(`${what} حذف شد.`);
  });
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
    await api('POST', '/api/enrol', { server: form.server.value, code: form.code.value });
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
    const { lines } = await api('GET', '/api/logs?lines=400');
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
