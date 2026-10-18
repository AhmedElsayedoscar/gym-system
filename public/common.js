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

// توليد كارت العضوية بدقة عالية كصورة (PNG Blob)
async function renderMemberCardToBlob(m, gymName, qrImgElem) {
  const canvas = document.createElement('canvas');
  const w = 1016;
  const h = 638;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  let qrImg = qrImgElem;
  if (!qrImg) {
    qrImg = new Image();
    qrImg.crossOrigin = 'anonymous';
    const qrSrc = m.qrUrl || `/api/public/card-qr/${encodeURIComponent(m.code)}`;
    qrImg.src = qrSrc;
  }

  if (!qrImg.complete || qrImg.naturalWidth === 0) {
    await new Promise((resolve) => {
      qrImg.onload = resolve;
      qrImg.onerror = resolve;
      setTimeout(resolve, 2000);
    });
  }

  // خلفية الكارت البيضاء مع حواف ناعمة
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 28);
  ctx.fill();

  // إطار خارجي خفيف
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(2, 2, w - 4, h - 4, 26);
  ctx.stroke();

  // شريط جانبي بلون متدرج أخضر رياضي
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#16a34a');
  grad.addColorStop(1, '#14532d');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(0, 0, 95, h, [28, 0, 0, 28]);
  ctx.fill();

  // النصوص باللغة العربية
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';

  // اسم الجيم
  ctx.fillStyle = '#14532d';
  ctx.font = 'bold 36px "Segoe UI", Cairo, Tahoma, Arial, sans-serif';
  ctx.fillText(gymName || 'الجيم', w - 120, 75);

  // خط فاصل رفيع
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(w - 120, 95);
  ctx.lineTo(w - 560, 95);
  ctx.stroke();

  // اسم العضو
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 44px "Segoe UI", Cairo, Tahoma, Arial, sans-serif';
  let name = m.name || '';
  if (name.length > 28) name = name.slice(0, 26) + '...';
  ctx.fillText(name, w - 120, 160);

  // كود العضو (أرقام فقط)
  ctx.fillStyle = '#16a34a';
  ctx.font = 'bold 26px "Segoe UI", Cairo, Tahoma, Arial, sans-serif';
  ctx.fillText('كود العضوية:', w - 120, 220);

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 46px Consolas, monospace, sans-serif';
  ctx.fillText(String(m.code || ''), w - 280, 225);

  // تفاصيل الباقة والانتهاء
  const plan = (m.sub && m.sub.plan_name) || 'عضوية عامة';
  const endDate = (m.sub && m.sub.end_date) || '-';

  ctx.fillStyle = '#475569';
  ctx.font = '26px "Segoe UI", Cairo, Tahoma, Arial, sans-serif';
  ctx.fillText(`الباقة: ${plan}`, w - 120, 290);
  ctx.fillText(`تاريخ الصلاحية: ${endDate}`, w - 120, 340);

  // حالة الاشتراك
  const state = (m.sub && m.sub.state) || (m.active ? 'active' : 'inactive');
  let stateText = 'ساري';
  let stateBg = '#dcfce7';
  let stateFg = '#15803d';
  if (state === 'expired' || state === 'inactive') {
    stateText = state === 'inactive' ? 'موقوف' : 'منتهي';
    stateBg = '#fee2e2';
    stateFg = '#b91c1c';
  } else if (state === 'expiring') {
    stateText = 'قارب على الانتهاء';
    stateBg = '#fef3c7';
    stateFg = '#b45309';
  }

  // رسم بادج الحالة
  ctx.fillStyle = stateBg;
  ctx.beginPath();
  ctx.roundRect(w - 320, 390, 200, 48, 24);
  ctx.fill();

  ctx.fillStyle = stateFg;
  ctx.font = 'bold 24px "Segoe UI", Cairo, Tahoma, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(stateText, w - 220, 423);

  // جملة إرشادية أسفل الكارت
  ctx.fillStyle = '#94a3b8';
  ctx.font = '20px "Segoe UI", Cairo, Tahoma, Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('يرجى إبراز كود الـ QR عند الدخول لتسجيل الحضور', w - 120, 580);

  // رسم الـ QR كود
  const qrSize = 360;
  const qrX = 120;
  const qrY = 110;

  // خلفية بيضاء وإطار للـ QR
  ctx.fillStyle = '#f8fafc';
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(qrX - 10, qrY - 10, qrSize + 20, qrSize + 20, 16);
  ctx.fill();
  ctx.stroke();

  try {
    ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
  } catch (err) {
    console.warn('QR draw error:', err);
  }

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

async function copyCardImageToClipboard(blob) {
  if (navigator.clipboard && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return true;
    } catch (e) {
      console.warn('Clipboard write failed:', e);
      return false;
    }
  }
  return false;
}

function downloadCardBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'card.png';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
