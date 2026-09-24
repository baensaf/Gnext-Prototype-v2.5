'use strict';

// The offline till (protocol §13). The agent checks and prices everything; this page only shows
// what it says. The order is held here until the till keeps orders itself (P4).

const $ = (sel) => document.querySelector(sel);
const fa = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const money = (rials) => `${Number(rials || 0).toLocaleString('fa-IR')} ریال`;
const SESSION = 'gnext-till-session';

const ROLES = { CASHIER: 'صندوق‌دار', SUPERVISOR: 'سرپرست', MANAGER: 'مدیر', ADMIN: 'مدیر سیستم', OWNER: 'مالک' };
const REASONS = { STOPPED: 'موجود نیست', OUT_OF_HOURS: 'خارج از ساعت فروش', SOLD_OUT: 'تمام شده' };
const MODES = { ONLINE: ['آنلاین', 'ok'], OFFLINE: ['آفلاین', 'bad'], HANDOVER: ['بازگشت اینترنت', ''] };

let token = safeGet(SESSION);
let tillState = null;
let user = null;
let menu = null;
let category = '';
let cart = []; // what the till screen asked for: { product_id, variant_id, quantity, options, notes }
let priced = null; // what the agent made of it: { lines, totals }
let badLine = null;
let orderType = 'TAKEAWAY';

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

  const notes = [];
  if (t.mode === 'ONLINE') notes.push('اینترنت وصل است؛ سفارش‌ها را در صندوق آنلاین جی‌نکست ثبت کنید.');
  if (t.problems.includes('NO_SNAPSHOT')) notes.push('منوی شعبه هنوز از سرور دریافت نشده است.');
  if (t.problems.includes('NO_STAFF')) notes.push('هیچ کارمندی پین ندارد؛ در جی‌نکست برای کارکنان پین تعریف کنید.');
  if (t.problems.includes('NO_TILL')) notes.push('هنوز صندوقی برای فروش آفلاین انتخاب نشده است؛ در تنظیمات عامل انتخاب کنید.');
  if (t.problems.includes('NO_SHIFT')) notes.push('این صندوق شیفت باز ندارد؛ بدون شیفت باز، فروش آفلاین ممکن نیست.');
  const banner = $('#banner');
  banner.hidden = notes.length === 0;
  banner.replaceChildren(...notes.map((n) => el('div', {}, n)));
  if (t.problems.includes('NO_TILL')) banner.append(el('a', { href: '/' }, 'رفتن به تنظیمات عامل'));
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
  const pin = $('#pin').value.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  try {
    const res = await api('POST', '/api/till/login', { user_id: pinUser.id, pin });
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
  renderOrder();
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

function renderTables() {
  $('#table').replaceChildren(
    el('option', { value: '' }, 'انتخاب کنید'),
    ...menu.tables.map((t) => el('option', { value: t.id }, `${t.area ? t.area + ' · ' : ''}میز ${fa(t.number)}`)),
  );
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
        {
          type: 'button',
          class: 'choice' + (v.id === pick.variant ? ' on' : ''),
          disabled: !v.available,
          onclick: () => { pick.variant = v.id; renderPick(); },
        },
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
              {
                type: 'button',
                class: 'choice' + (pick.options.has(it.id) ? ' on' : ''),
                disabled: !it.available,
                onclick: () => toggleOption(g, it),
              },
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

// ---- the order ----
const sameLine = (a, b) =>
  a.product_id === b.product_id && a.variant_id === b.variant_id && a.notes === b.notes && a.options.join() === b.options.join();

// A change is kept only if the agent accepts the whole order with it.
async function reprice(next) {
  const result = next.length ? await api('POST', '/api/till/price', { lines: next }) : { lines: [], totals: null };
  cart = next;
  priced = result;
  badLine = null;
  renderOrder();
}

async function addLine(input) {
  const next = cart.map((l) => ({ ...l }));
  const same = next.find((l) => sameLine(l, input));
  if (same) same.quantity += input.quantity;
  else next.push(input);
  await reprice(next);
}

async function changeQty(i, delta) {
  const next = cart.map((l) => ({ ...l }));
  next[i].quantity += delta;
  if (next[i].quantity < 1) next.splice(i, 1);
  try {
    await reprice(next);
  } catch (e) {
    toast(e.message, true);
  }
}

function renderOrder() {
  const lines = priced?.lines || [];
  $('#empty').hidden = cart.length > 0;
  $('#lines').replaceChildren(
    ...lines.map((l, i) =>
      el(
        'li',
        { class: i === badLine ? 'bad' : '' },
        el('div', { class: 'line-head' },
          el('span', { class: 'name' }, l.variant_name ? `${l.product_name} (${l.variant_name})` : l.product_name),
          el('span', {}, money(l.line_total)),
        ),
        l.options.length ? el('div', { class: 'line-sub' }, l.options.map((o) => o.name).join('، ')) : '',
        l.notes ? el('div', { class: 'line-sub' }, `توضیح: ${l.notes}`) : '',
        el('div', { class: 'line-tools' },
          el('button', { class: 'btn', onclick: () => changeQty(i, -1) }, '−'),
          el('span', {}, fa(l.quantity)),
          el('button', { class: 'btn', onclick: () => changeQty(i, +1) }, '+'),
          el('span', { class: 'muted small' }, `× ${money(Number(l.line_total) / Number(l.quantity))}`),
        ),
      ),
    ),
  );
  const t = priced?.totals;
  $('#subtotal').textContent = money(t?.subtotal);
  $('#tax').textContent = money(t?.tax_total);
  $('#grand').textContent = money(t?.grand_total);
  $('#clear').disabled = cart.length === 0;
}

$('#clear').addEventListener('click', () => {
  if (cart.length && confirm('سفارش پاک شود؟')) reprice([]);
});

document.querySelectorAll('.order-type [data-type]').forEach((b) =>
  b.addEventListener('click', () => {
    orderType = b.dataset.type;
    document.querySelectorAll('.order-type [data-type]').forEach((x) => x.classList.toggle('on', x === b));
    $('#dine-in').hidden = orderType !== 'DINE_IN';
  }),
);

// What sells changes with the clock (a window closes, a stop ends): check the order again.
async function recheck() {
  if (!user || !cart.length) return;
  try {
    await reprice(cart);
  } catch (e) {
    if (typeof e.line === 'number') {
      badLine = e.line;
      renderOrder();
    }
    toast(e.message, true);
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
setInterval(async () => {
  if (!user || $('#sell').hidden) return;
  try {
    menu = await api('GET', '/api/till/menu');
    renderProducts();
  } catch {
    // The next tick tries again.
  }
  recheck();
}, 60000);
