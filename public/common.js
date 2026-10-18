'use strict';
// أدوات مشتركة بين كل الصفحات. كل النصوص بتتحط عن طريق textContent عشان نتفادى ثغرات XSS.

const TZ = 'Africa/Cairo';

async function api(method, url, body) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    throw new Error('مفيش اتصال بالسيرفر');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }
  // لا تعيد توجيه صفحة الكارنيه (بدون session للمشتركين)
  const onCardPage = window.location.pathname === '/card.html';
  if (res.status === 401 && !url.endsWith('/api/login') && !url.startsWith('/api/public/') && !onCardPage) {
    location.href = '/login.html';
    throw new Error('سجّل دخول الأول');
  }
  if (!res.ok) throw new Error((data && data.error) || 'حصل خطأ');
  return data;
}

function formatWhatsAppPhone(phone) {
  let cleaned = String(phone || '').replace(/[\s\-\(\)\+]/g, '');
  if (cleaned.startsWith('00')) cleaned = cleaned.slice(2);
  // أرقام الموبايل في مصر: 01xxxxxxxxx (11 رقم) تتحول إلى 201xxxxxxxxx
  if (/^01[0125]\d{8}$/.test(cleaned)) {
    cleaned = '2' + cleaned;
  }
  return cleaned;
}

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// يعزل التواريخ والأرقام عشان تتعرض بالترتيب الصحيح داخل النص العربي
function ltr(s) {
  return '\u2066' + s + '\u2069';
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('ar-EG-u-nu-latn', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
}
function fmtDateTime(iso) {
  return new Date(iso).toLocaleString('ar-EG-u-nu-latn', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
function fmtMoney(n) {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

const STATE_LABEL = {
  active: 'ساري',
  expiring: 'قارب على الانتهاء',
  expired: 'منتهي',
  none: 'بدون اشتراك',
  upcoming: 'لم يبدأ بعد',
};
const REASON_LABEL = {
  expired: 'اشتراك منتهي',
  none: 'بدون اشتراك',
  upcoming: 'اشتراك لم يبدأ',
  inactive: 'عضوية موقوفة',
  manual: 'تسجيل يدوي',
};

function fmtDayArabic(dayStr) {
  if (!dayStr) return '-';
  const d = new Date(dayStr + 'T00:00:00Z');
  return d.toLocaleDateString('ar-EG', { timeZone: 'UTC', weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric' });
}

function badge(state, text) {
  return h('span', { class: `badge ${state}` }, text || STATE_LABEL[state] || state);
}

function toast(msg, bad) {
  const t = h('div', { class: 'toast' + (bad ? ' bad' : '') }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 3200);
}

async function logout() {
  try {
    await api('POST', '/api/logout', {});
  } finally {
    location.href = '/login.html';
  }
}
