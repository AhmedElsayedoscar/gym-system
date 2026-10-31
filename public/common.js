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

let _bgLogoImgCache = null;
function loadCardBgImage() {
  if (_bgLogoImgCache) return Promise.resolve(_bgLogoImgCache);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      _bgLogoImgCache = img;
      resolve(img);
    };
    img.onerror = () => resolve(null);
    img.src = '/xgym-logo.jpg';
  });
}

// توليد كارت العضوية بدقة عالية كصورة (PNG Blob) بخلفية وثيم X GYM الفاخر
async function renderMemberCardToBlob(m, gymName, barcodeImgElem) {
  const canvas = document.createElement('canvas');
  const w = 1016;
  const h = 638;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  let barcodeImg = barcodeImgElem;
  if (!barcodeImg) {
    barcodeImg = new Image();
    barcodeImg.crossOrigin = 'anonymous';
    const barSrc = m.qrUrl || `/api/public/card-qr/${encodeURIComponent(m.code)}`;
    barcodeImg.src = barSrc;
  }

  const [bgImg] = await Promise.all([
    loadCardBgImage(),
    new Promise((resolve) => {
      if (barcodeImg.complete && barcodeImg.naturalWidth > 0) return resolve();
      barcodeImg.onload = resolve;
      barcodeImg.onerror = resolve;
      setTimeout(resolve, 2000);
    }),
  ]);

  // خلفية الكارت الفخمة
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 28);
  ctx.clip();

  // رسم خلفية الصورة الخاصة بـ X GYM
  if (bgImg && bgImg.naturalWidth > 0) {
    const scale = Math.max(w / bgImg.naturalWidth, h / bgImg.naturalHeight);
    const sw = bgImg.naturalWidth * scale;
    const sh = bgImg.naturalHeight * scale;
    const sx = (w - sw) / 2;
    const sy = (h - sh) / 2;
    ctx.drawImage(bgImg, sx, sy, sw, sh);

    // طبقة ظل فخمة لضمان قراءة النصوص والـ QR بوضوح استثنائي
    const overlay = ctx.createLinearGradient(0, 0, w, 0);
    overlay.addColorStop(0, 'rgba(8, 9, 13, 0.90)');
    overlay.addColorStop(0.45, 'rgba(12, 14, 20, 0.78)');
    overlay.addColorStop(1, 'rgba(8, 9, 13, 0.92)');
    ctx.fillStyle = overlay;
    ctx.fillRect(0, 0, w, h);
  } else {
    // خلفية كربونية داكنة بديلة
    ctx.fillStyle = '#0d0e12';
    ctx.fillRect(0, 0, w, h);
  }

  // شريط جانبي ذهبي متدرج
  const sideGrad = ctx.createLinearGradient(0, 0, 0, h);
  sideGrad.addColorStop(0, '#ffd778');
  sideGrad.addColorStop(0.5, '#e5a93c');
  sideGrad.addColorStop(1, '#9a5e0b');
  ctx.fillStyle = sideGrad;
  ctx.fillRect(0, 0, 85, h);

  ctx.restore();

  // إطار خارجي ذهبي متدرج
  const goldBorder = ctx.createLinearGradient(0, 0, w, h);
  goldBorder.addColorStop(0, '#ffd778');
  goldBorder.addColorStop(0.35, '#f5be53');
  goldBorder.addColorStop(0.7, '#d48f1f');
  goldBorder.addColorStop(1, '#8e580a');
  ctx.strokeStyle = goldBorder;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(3, 3, w - 6, h - 6, 26);
  ctx.stroke();

  // خط توهج ذهبي داخلي خفيف
  ctx.strokeStyle = 'rgba(255, 215, 120, 0.25)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(9, 9, w - 18, h - 18, 22);
  ctx.stroke();

  // النصوص باللغة العربية
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';

  // اسم الجيم بشعار ذهبي فخم
  ctx.fillStyle = '#ffd778';
  ctx.font = '900 38px "Segoe UI", Cairo, Tahoma, Arial, sans-serif';
  ctx.fillText(gymName || 'X GYM', w - 120, 75);

  ctx.fillStyle = '#e5a93c';
  ctx.font = 'bold 16px "Segoe UI", Cairo, Tahoma, Arial, sans-serif';
  ctx.fillText('VIP MEMBERSHIP CARD • كارت عضوية خاص', w - 120, 103);

  // خط فاصل ذهبي متدرج
  const lineGrad = ctx.createLinearGradient(w - 120, 0, w - 560, 0);
  lineGrad.addColorStop(0, '#e5a93c');
  lineGrad.addColorStop(1, 'rgba(229, 169, 60, 0)');
  ctx.strokeStyle = lineGrad;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(w - 120, 116);
  ctx.lineTo(w - 560, 116);
  ctx.stroke();

  // اسم العضو بخط عريض وواضح
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 48px "Segoe UI", Cairo, Tahoma, Arial, sans-serif';
  let name = m.name || '';
  if (name.length > 26) name = name.slice(0, 24) + '...';
  ctx.fillText(name, w - 120, 180);

  // كود العضوية بأرقام بارزة
  ctx.fillStyle = '#e5a93c';
  ctx.font = 'bold 26px "Segoe UI", Cairo, Tahoma, Arial, sans-serif';
  ctx.fillText('كود العضوية:', w - 120, 245);

  ctx.fillStyle = '#ffd778';
  ctx.font = '900 52px Consolas, monospace, sans-serif';
  ctx.fillText(String(m.code || ''), w - 280, 252);

  // جملة إرشادية للسكانر
  ctx.fillStyle = '#cbd5e1';
  ctx.font = 'bold 16px "Segoe UI", Cairo, Tahoma, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('⚡ وجّه الباركود أمام السكانر لتسجيل الحضور فوراً', w / 2, 292);

  // رسم الباركود الرئيسي بحجم ضخم وعريض جداً لأعلى سرعة استجابة في المسح
  const naturalRatio = (barcodeImg.naturalWidth && barcodeImg.naturalHeight)
    ? (barcodeImg.naturalWidth / barcodeImg.naturalHeight)
    : 3.0;

  const barH = 260; // ارتفاع ضخم للأعمدة يضمن التقاط السكانر فوراً بأي زاوية
  let barW = Math.round(barH * naturalRatio);
  const maxBarW = Math.round(w * 0.82); // حد أقصى 82% من عرض الكارت (~830px)
  if (barW > maxBarW) barW = maxBarW;
  const minBarW = Math.round(w * 0.60); // حد أدنى 60% (~610px)
  if (barW < minBarW) barW = minBarW;

  const padX = 20;
  const padY = 15;
  const boxW = barW + padX * 2;
  const boxH = barH + padY * 2;
  const boxX = Math.round((w - boxW) / 2);
  const boxY = 315;

  // خلفية بيضاء ناصعة مع إطار ذهبي فخم يمنحان السكانر أعلى تباين ممكن
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxW, boxH, 18);
  ctx.fill();

  ctx.strokeStyle = '#e5a93c';
  ctx.lineWidth = 4;
  ctx.stroke();

  try {
    ctx.drawImage(barcodeImg, boxX + padX, boxY + padY, barW, barH);
  } catch (err) {
    console.warn('Barcode draw error:', err);
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
