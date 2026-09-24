'use strict';

// The offline till (protocol §13). Orders live on the agent, which checks, prices and keeps
// them; this page shows what it says and asks it to change them.

const $ = (sel) => document.querySelector(sel);
const fa = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const money = (rials) => `${Number(rials || 0).toLocaleString('fa-IR')} ریال`;
const SESSION = 'gnext-till-session';

const ROLES = { CASHIER: 'صندوق‌دار', SUPERVISOR: 'سرپرست', MANAGER: 'مدیر', ADMIN: 'مدیر سیستم', OWNER: 'مالک' };
const APPROVERS = ['SUPERVISOR', 'MANAGER', 'ADMIN', 'OWNER'];
const REASONS = { STOPPED: 'موجود نیست', OUT_OF_HOURS: 'خارج از ساعت فروش', SOLD_OUT: 'تمام شده' };
const MODES = { ONLINE: ['آنلاین', 'ok'], OFFLINE: ['آفلاین', 'bad'], HANDOVER: ['بازگشت اینترنت', ''] };

let token = safeGet(SESSION);
let tillState = null;
let user = null;
let menu = null;
let category = '';
let orders = []; // the agent's unfinished orders
let current = null; // the order on screen
let orderType = 'TAKEAWAY'; // for the next order, until one is started

function safeGet(key) {
  try {
    return sessionStorage.getItem(key) || '';
  } catch {
    return '';
  }
}
function safeSet(key, value) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    // A private window: the cashier signs in again after a reload.
  }
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

function toast(message, isError) {
  const t = $('#toast');
  t.textContent = message;
  t.className = 'toast' + (isError ? ' error' : '');
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), isError ? 6000 : 2500);
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Gnext-Local': '1', 'X-Gnext-Till-Session': token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.detail || `خطای ${fa(res.status)}`);
    err.code = data.code;
    err.line = data.line;
    // The session ended (idle, or someone else signed in): back to the names.
    if (res.status === 401 && data.code === 'UNAUTHENTICATED' && user) signedOut();
    throw err;
  }
  return data;
}

// ---- state: mode, till, shift, and what stops the till selling ----
async function loadState() {
  try {
    const res = await api('GET', '/api/till/state');
    tillState = res.state;
    user = res.user;
  } catch (e) {
    $('#where').textContent = e.code === 'NOT_ENROLLED' ? 'این رایانه هنوز به شعبه‌ای وصل نشده است' : 'عامل در دسترس نیست';
    return false;
  }
  const t = tillState;
  const [label, cls] = MODES[t.mode] || MODES.OFFLINE;
  $('#mode').textContent = label;
  $('#mode').className = 'badge ' + cls;
  $('#where').textContent = t.till
    ? `${t.till.name}${t.shift ? ` · شیفت ${fa(t.shift.shift_number || '')}` : ''}`
    : 'صندوقی انتخاب نشده';
  $('#who').textContent = user ? `${user.display_name} (${ROLES[user.role] || user.role})` : '';
  $('#lock').hidden = !user;

  const banner = $('#banner');
  const notes = [];
  if (t.mode === 'ONLINE') notes.push(el('div', {}, 'اینترنت وصل است؛ سفارش‌ها را در صندوق آنلاین جی‌نکست ثبت کنید.'));
  if (t.mode === 'HANDOVER') {
    notes.push(
      el('div', {},
        'اینترنت برگشته است. سفارش جدید را در صندوق آنلاین ثبت کنید؛ سفارش‌های باز همین‌جا تمام می‌شوند یا به صندوق آنلاین تحویل داده می‌شوند.',
        user ? el('button', { class: 'btn', onclick: handover }, 'تحویل به صندوق آنلاین') : '',
      ),
    );
  }
  if (t.problems.includes('NO_SNAPSHOT')) notes.push(el('div', {}, 'منوی شعبه هنوز از سرور دریافت نشده است.'));
  if (t.problems.includes('NO_STAFF')) notes.push(el('div', {}, 'هیچ کارمندی پین ندارد؛ در جی‌نکست برای کارکنان پین تعریف کنید.'));
  if (t.problems.includes('NO_TILL')) {
    notes.push(el('div', {}, 'هنوز صندوقی برای فروش آفلاین انتخاب نشده است؛ ', el('a', { href: '/' }, 'در تنظیمات عامل انتخاب کنید'), '.'));
  }
  if (t.problems.includes('NO_SHIFT')) notes.push(el('div', {}, 'این صندوق شیفت باز ندارد؛ بدون شیفت باز، فروش آفلاین ممکن نیست.'));
  banner.hidden = notes.length === 0;
  banner.replaceChildren(...notes);
  return true;
}

// ---- sign-in ----
let pinUser = null;

function showSignin() {
  $('#sell').hidden = true;
  $('#signin').hidden = false;
  $('#pin-form').hidden = true;
  $('#staff').hidden = false;
  const staff = tillState?.staff || [];
  $('#staff').replaceChildren(
    ...(staff.length
      ? staff.map((u) => el('button', { type: 'button', onclick: () => askPin(u) }, u.display_name, el('small', {}, ROLES[u.role] || u.role)))
      : [el('p', { class: 'muted' }, 'کسی برای ورود تعریف نشده است.')]),
  );
}

function askPin(u) {
  pinUser = u;
  $('#staff').hidden = true;
  $('#pin-form').hidden = false;
  $('#pin-name').textContent = u.display_name;
  $('#pin').value = '';
  $('#pin').focus();
}

const latinDigits = (s) => s.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));

document.querySelectorAll('.keys [data-key]').forEach((b) =>
  b.addEventListener('click', () => {
    const pin = $('#pin');
    if (b.dataset.key === 'back') pin.value = pin.value.slice(0, -1);
    else if (pin.value.length < 8) pin.value += b.dataset.key;
    pin.focus();
  }),
);
$('#pin-cancel').addEventListener('click', showSignin);
$('#pin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const res = await api('POST', '/api/till/login', { user_id: pinUser.id, pin: latinDigits($('#pin').value) });
    token = res.token;
    safeSet(SESSION, token);
    user = res.user;
    await startSelling();
  } catch (err) {
    $('#pin').value = '';
    toast(err.message, true);
  }
});

$('#lock').addEventListener('click', async () => {
  await api('POST', '/api/till/logout').catch(() => {});
  signedOut();
});

function signedOut() {
  token = '';
  safeSet(SESSION, '');
  user = null;
  $('#who').textContent = '';
  $('#lock').hidden = true;
  showSignin();
}

// ---- the menu ----
async function startSelling() {
  await loadState();
  try {
    menu = await api('GET', '/api/till/menu');
  } catch (e) {
    toast(e.message, true);
    return;
  }
  $('#signin').hidden = true;
  $('#sell').hidden = false;
  renderCategories();
  renderProducts();
  renderTables();
  await loadOrders();
}

function renderCategories() {
  const used = new Set(menu.products.map((p) => p.category_id));
  const cats = [{ id: '', name: 'همه' }, ...menu.categories.filter((c) => used.has(c.id))];
  $('#categories').replaceChildren(
    ...cats.map((c) =>
      el('button', { class: c.id === category ? 'on' : '', onclick: () => { category = c.id; renderCategories(); renderProducts(); } }, c.name),
    ),
  );
}

function renderProducts() {
  const q = $('#search').value.trim();
  const list = menu.products.filter(
    (p) => (!category || p.category_id === category) && (!q || p.name.includes(q) || (p.code || '').toLowerCase().includes(q.toLowerCase())),
  );
  $('#products').replaceChildren(
    ...list.map((p) =>
      el(
        'button',
        { class: 'product' + (p.available ? '' : ' off'), type: 'button', onclick: () => choose(p) },
        el('span', { class: 'name' }, p.name),
        p.available ? el('span', { class: 'price' }, fromPrice(p)) : el('span', { class: 'why' }, REASONS[p.reason] || 'موجود نیست'),
      ),
    ),
  );
}
$('#search').addEventListener('input', renderProducts);

function fromPrice(p) {
  if (!p.variants.length) return money(p.price);
  const prices = p.variants.filter((v) => v.available).map((v) => Number(v.price));
  return prices.length ? `از ${money(Math.min(...prices))}` : '';
}

function tableName(id) {
  const t = menu?.tables.find((x) => x.id === id);
  return t ? `${t.area ? t.area + ' · ' : ''}میز ${fa(t.number)}` : '';
}

function renderTables() {
  $('#table').replaceChildren(el('option', { value: '' }, 'انتخاب کنید'), ...menu.tables.map((t) => el('option', { value: t.id }, tableName(t.id))));
}

// ---- choosing a product: size, add-ons, quantity ----
let pick = null;

function choose(p) {
  if (!p.available) {
    toast(`«${p.name}» ${REASONS[p.reason] || 'موجود نیست'}.`, true);
    return;
  }
  if (!p.variants.length && !p.option_groups.length) {
    addLine({ product_id: p.id, variant_id: '', quantity: 1, options: [], notes: '' }).catch((e) => toast(e.message, true));
    return;
  }
  pick = { product: p, variant: p.variants.find((v) => v.available)?.id || '', options: new Set(), qty: 1 };
  $('#p-name').textContent = p.name;
  $('#p-notes').value = '';
  $('#p-error').hidden = true;
  renderPick();
  $('#dlg-product').showModal();
}

function groupHint(g) {
  if (g.min > 0 && g.max === g.min) return g.min === 1 ? 'یکی لازم است' : `${fa(g.min)} انتخاب لازم است`;
  if (g.min > 0) return `دست‌کم ${fa(g.min)}${g.max ? `، حداکثر ${fa(g.max)}` : ''}`;
  return g.max ? `اختیاری، حداکثر ${fa(g.max)}` : 'اختیاری';
}

function renderPick() {
  const p = pick.product;
  $('#p-variants').replaceChildren(
    ...p.variants.map((v) =>
      el(
        'button',
        { type: 'button', class: 'choice' + (v.id === pick.variant ? ' on' : ''), disabled: !v.available, onclick: () => { pick.variant = v.id; renderPick(); } },
        v.name, ' ', el('small', {}, v.available ? money(v.price) : REASONS[v.reason] || ''),
      ),
    ),
  );
  $('#p-groups').replaceChildren(
    ...p.option_groups.map((g) =>
      el(
        'div',
        { class: 'group' },
        el('h3', {}, g.name, ' ', el('small', {}, groupHint(g))),
        el(
          'div',
          { class: 'choices' },
          ...g.items.map((it) =>
            el(
              'button',
              { type: 'button', class: 'choice' + (pick.options.has(it.id) ? ' on' : ''), disabled: !it.available, onclick: () => toggleOption(g, it) },
              it.name,
              Number(it.price_delta) ? el('small', {}, ` +${money(it.price_delta)}`) : '',
            ),
          ),
        ),
      ),
    ),
  );
  $('#p-qty').textContent = fa(pick.qty);
  $('#p-price').textContent = `(${money(pickPrice())})`;
}

// One choice from a group of one replaces the other; a larger group stops at its maximum.
function toggleOption(g, it) {
  const inGroup = g.items.filter((x) => pick.options.has(x.id));
  if (pick.options.has(it.id)) {
    pick.options.delete(it.id);
  } else if (g.max === 1) {
    inGroup.forEach((x) => pick.options.delete(x.id));
    pick.options.add(it.id);
  } else if (g.max && inGroup.length >= g.max) {
    toast(`از «${g.name}» حداکثر ${fa(g.max)} انتخاب ممکن است.`, true);
    return;
  } else {
    pick.options.add(it.id);
  }
  renderPick();
}

// For the button only; the agent prices the line when it is added.
function pickPrice() {
  const p = pick.product;
  const base = Number(p.variants.length ? p.variants.find((v) => v.id === pick.variant)?.price || 0 : p.price);
  const extra = p.option_groups.flatMap((g) => g.items).filter((it) => pick.options.has(it.id)).reduce((s, it) => s + Number(it.price_delta), 0);
  return (base + extra) * pick.qty;
}

$('#p-minus').addEventListener('click', () => { pick.qty = Math.max(1, pick.qty - 1); renderPick(); });
$('#p-plus').addEventListener('click', () => { pick.qty = Math.min(999, pick.qty + 1); renderPick(); });
$('#product-form').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'ok') return;
  e.preventDefault();
  const p = pick.product;
  const order = p.option_groups.flatMap((g) => g.items.map((it) => it.id));
  try {
    await addLine({
      product_id: p.id,
      variant_id: pick.variant,
      quantity: pick.qty,
      options: order.filter((id) => pick.options.has(id)),
      notes: $('#p-notes').value.trim(),
    });
    $('#dlg-product').close('ok');
  } catch (err) {
    $('#p-error').textContent = err.message;
    $('#p-error').hidden = false;
  }
});

// ---- the orders, kept on the agent ----
async function loadOrders(keep) {
  const res = await api('GET', '/api/till/orders').catch(() => null);
  if (!res) return;
  orders = res.orders.filter((o) => o.state === 'OPEN' && !o.handed_over);
  const id = keep ?? current?.id;
  current = orders.find((o) => o.id === id) || null;
  renderOrder();
}

// Show the agent's answer about one order.
function show(order) {
  const i = orders.findIndex((o) => o.id === order?.id);
  if (order && order.state === 'OPEN' && !order.handed_over) {
    if (i >= 0) orders[i] = order;
    else orders.push(order);
    current = order;
  } else {
    if (i >= 0) orders.splice(i, 1);
    current = null;
  }
  renderOrder();
}

function guests() {
  return Number($('#guests').value) || 0;
}

async function addLine(input) {
  if (!current) {
    const res = await api('POST', '/api/till/orders', { order_type: orderType, table_id: $('#table').value, guest_count: guests() });
    show(res.order);
  }
  show((await api('POST', `/api/till/orders/${current.id}/lines`, input)).order);
  refreshMenu();
}

async function setQuantity(line, quantity) {
  try {
    show((await api('POST', `/api/till/orders/${current.id}/lines/${line.id}/quantity`, { quantity })).order);
    refreshMenu();
  } catch (e) {
    toast(e.message, true);
  }
}

// Striking a line the kitchen has: the cashier alone within the edit window, else an approver.
async function voidLine(line) {
  if (!confirm(`«${line.product_name}» از سفارش حذف شود؟`)) return;
  await withApproval('حذف ردیف', false, (extra) => api('POST', `/api/till/orders/${current.id}/lines/${line.id}/void`, extra));
  refreshMenu();
}

$('#cancel').addEventListener('click', async () => {
  if (!current) return;
  const sent = !!current.sent_at || current.call_number;
  if (!sent) {
    if (!confirm('این سفارش هنوز به آشپزخانه نرفته است و پاک می‌شود. ادامه می‌دهید؟')) return;
    try {
      const id = current.id;
      const res = await api('POST', `/api/till/orders/${id}/cancel`, {});
      // A dropped cart comes back as no order at all.
      if (res.dropped) {
        orders = orders.filter((o) => o.id !== id);
        current = null;
        renderOrder();
      } else show(res.order);
    } catch (e) {
      toast(e.message, true);
    }
    refreshMenu();
    return;
  }
  const note = await askApproval({ title: 'لغو سفارش', why: 'دلیل لغو را بنویسید.', note: true, pin: false });
  if (note === null) return;
  await withApproval('لغو سفارش', true, (extra) => api('POST', `/api/till/orders/${current.id}/cancel`, { note: note.note, ...extra }));
  toast('سفارش لغو شد.');
  refreshMenu();
});

// Runs a change; if the agent asks for an approver, asks for one and runs it again.
async function withApproval(title, isCancel, run) {
  try {
    show((await run({})).order);
  } catch (e) {
    if (e.code !== 'APPROVAL_REQUIRED') {
      toast(e.message, true);
      return;
    }
    const a = await askApproval({ title, why: e.message, note: false, pin: true });
    if (!a) return;
    try {
      show((await run({ approver_id: a.approver_id, pin: latinDigits(a.pin) })).order);
    } catch (e2) {
      toast(e2.message, true);
    }
  }
}

function askApproval({ title, why, note, pin }) {
  const dlg = $('#dlg-approve');
  const form = $('#approve-form');
  form.reset();
  $('#approve-title').textContent = title;
  $('#approve-why').textContent = why || '';
  $('#approve-note-row').hidden = !note;
  $('#approve-pin-rows').hidden = !pin;
  form.approver_id.replaceChildren(
    ...(tillState?.staff || []).filter((u) => APPROVERS.includes(u.role)).map((u) => el('option', { value: u.id }, u.display_name)),
  );
  // Answered on submit, which fires at once; close (Esc) only says no. The close event can wait
  // until the page is drawn again.
  return new Promise((resolve) => {
    let done = false;
    const answer = (value) => {
      if (!done) (done = true), resolve(value);
    };
    form.onsubmit = (e) =>
      answer(e.submitter?.value === 'ok' ? { note: form.note.value.trim(), approver_id: form.approver_id.value, pin: form.pin.value } : null);
    dlg.onclose = () => answer(null);
    dlg.showModal();
  });
}

$('#send').addEventListener('click', async () => {
  if (!current) return;
  try {
    const res = await api('POST', `/api/till/orders/${current.id}/send`);
    show(res.order);
    toast(`سفارش ${fa(res.order.call_number)} به آشپزخانه رفت.`);
  } catch (e) {
    toast(e.message, true);
  }
});

$('#new-order').addEventListener('click', () => {
  current = null;
  renderOrder();
});

async function handover() {
  const open = orders.length;
  if (!confirm(`${fa(open)} سفارش باز به صندوق آنلاین تحویل داده می‌شود؛ سفارش‌هایی که به آشپزخانه نرفته‌اند پاک می‌شوند. ادامه می‌دهید؟`)) return;
  try {
    const res = await api('POST', '/api/till/handover');
    toast(`${fa(res.handed)} سفارش تحویل شد${res.dropped ? `، ${fa(res.dropped)} سفارش ارسال‌نشده پاک شد` : ''}.`);
    await loadState();
    await loadOrders(null);
  } catch (e) {
    toast(e.message, true);
  }
}

// Type, table and guests: for the order on screen, or the next one.
document.querySelectorAll('.order-type [data-type]').forEach((b) =>
  b.addEventListener('click', () => {
    orderType = b.dataset.type;
    saveInfo();
  }),
);
$('#table').addEventListener('change', saveInfo);
$('#guests').addEventListener('change', saveInfo);

async function saveInfo() {
  if (current) {
    try {
      show((await api('POST', `/api/till/orders/${current.id}/info`, { order_type: orderType, table_id: $('#table').value, guest_count: guests() })).order);
      return;
    } catch (e) {
      toast(e.message, true);
    }
  }
  renderOrder();
}

function renderOrder() {
  const o = current;
  // The order tabs: each unfinished order by its number, or its table, or "new".
  $('#open-orders').replaceChildren(
    ...orders.map((x) =>
      el('button', { type: 'button', class: x.id === o?.id ? 'on' : '', onclick: () => { current = x; renderOrder(); } },
        x.call_number ? `#${fa(x.call_number)}` : 'ارسال‌نشده', x.table_id ? ` · ${tableName(x.table_id)}` : ''),
    ),
  );
  if (o) orderType = o.order_type;
  document.querySelectorAll('.order-type [data-type]').forEach((x) => x.classList.toggle('on', x.dataset.type === orderType));
  $('#dine-in').hidden = orderType !== 'DINE_IN';
  if (o) {
    $('#table').value = o.table_id || '';
    $('#guests').value = o.guest_count || '';
  }
  $('#order-head').replaceChildren(
    o ? (o.call_number ? el('span', { class: 'call' }, `سفارش ${fa(o.call_number)}`) : 'سفارش جدید (هنوز به آشپزخانه نرفته)') : 'سفارش جدید',
  );

  const lines = o?.lines || [];
  $('#empty').hidden = lines.length > 0;
  $('#lines').replaceChildren(
    ...lines.map((l) =>
      el(
        'li',
        {},
        el('div', { class: 'line-head' },
          el('span', { class: 'name' }, l.variant_name ? `${l.product_name} (${l.variant_name})` : l.product_name),
          el('span', {}, money(l.line_total)),
        ),
        l.options.length ? el('div', { class: 'line-sub' }, l.options.map((x) => x.name).join('، ')) : '',
        l.notes ? el('div', { class: 'line-sub' }, `توضیح: ${l.notes}`) : '',
        l.sent_at
          ? el('div', { class: 'line-tools' },
              el('span', { class: 'line-sent' }, `در آشپزخانه · ${fa(l.quantity)} عدد`),
              el('button', { class: 'btn danger', onclick: () => voidLine(l) }, 'حذف'),
            )
          : el('div', { class: 'line-tools' },
              el('button', { class: 'btn', onclick: () => setQuantity(l, Number(l.quantity) - 1) }, '−'),
              el('span', {}, fa(l.quantity)),
              el('button', { class: 'btn', onclick: () => setQuantity(l, Number(l.quantity) + 1) }, '+'),
              el('span', { class: 'muted small' }, `× ${money(Number(l.line_total) / Number(l.quantity))}`),
            ),
      ),
    ),
  );
  const t = o?.totals;
  $('#subtotal').textContent = money(t?.subtotal);
  $('#tax').textContent = money(t?.tax_total);
  $('#grand').textContent = money(t?.grand_total);
  $('#cancel').disabled = !o;
  $('#send').disabled = !o || !lines.some((l) => !l.sent_at);
}

// Today's stock moves with every order the till takes.
async function refreshMenu() {
  try {
    menu = await api('GET', '/api/till/menu');
    renderProducts();
  } catch {
    // The next tick tries again.
  }
}

async function boot() {
  if (!(await loadState())) return;
  if (user) await startSelling();
  else showSignin();
}

boot();
setInterval(async () => {
  await loadState();
  // The session ended on the agent (idle): back to the names.
  if (!user && !$('#sell').hidden) signedOut();
}, 10000);
setInterval(() => {
  if (!user || $('#sell').hidden) return;
  refreshMenu();
  loadOrders(); // the agent may have handed orders over on its own
}, 30000);
