'use strict';

let currentMember = null;
let currentGymName = 'الجيم';
let qrImageElement = null;

// زر الطباعة
document.getElementById('print').addEventListener('click', () => window.print());

// أزرار الاستقبال (Staff Only)
const closeBtn = document.getElementById('close');
if (closeBtn) {
  closeBtn.addEventListener('click', () => {
    window.close();
    if (!window.closed) location.href = '/';
  });
}

const waSendBtn = document.getElementById('wa-send');
if (waSendBtn) {
  waSendBtn.addEventListener('click', () => {
    if (!currentMember) return;
    sendViaWhatsApp(currentMember);
  });
}

const copyImgBtn = document.getElementById('copy-img');
if (copyImgBtn) {
  copyImgBtn.addEventListener('click', async () => {
    if (!currentMember) return;
    try {
      const blob = await renderCardToBlob();
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast('تم نسخ صورة الكارت (يمكنك الضغط على Ctrl+V في واتساب)');
      } else {
        toast('المتصفح لا يدعم نسخ الصور مباشرة، اضغط على تحميل الكارنيه', true);
      }
    } catch (e) {
      toast('فشل نسخ الصورة: ' + e.message, true);
    }
  });
}

const copyLinkBtn = document.getElementById('copy-link');
if (copyLinkBtn) {
  copyLinkBtn.addEventListener('click', async () => {
    if (!currentMember) return;
    const link = `${location.origin}/card.html?code=${encodeURIComponent(currentMember.code)}`;
    try {
      await navigator.clipboard.writeText(link);
      toast('تم نسخ رابط الكارت بنجاح');
    } catch {
      toast('فشل نسخ الرابط', true);
    }
  });
}

// زر التحميل الرئيسي (يعمل للجميع وللمشترك)
const dlBtn = document.getElementById('dl-img');
if (dlBtn) {
  dlBtn.addEventListener('click', downloadCard);
}

// زر المشاركة وحفظ في الصور (للهواتف المحمولة)
const shareBtn = document.getElementById('share-btn');
if (shareBtn) {
  if (navigator.share) {
    shareBtn.style.display = '';
    shareBtn.addEventListener('click', shareOrSaveCard);
  } else {
    shareBtn.style.display = 'none';
  }
}

async function downloadCard() {
  if (!currentMember) return;
  const btn = document.getElementById('dl-img');
  const origText = btn.textContent;
  try {
    btn.textContent = '⏳ جاري التجهيز...';
    btn.disabled = true;
    const blob = await renderCardToBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `card-${currentMember.code}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('تم بدء تحميل كارت العضوية بنجاح 💾');
  } catch (e) {
    toast('فشل تصدير الصورة: ' + e.message, true);
  } finally {
    btn.textContent = origText;
    btn.disabled = false;
  }
}

async function shareOrSaveCard() {
  if (!currentMember) return;
  try {
    const blob = await renderCardToBlob();
    const file = new File([blob], `card-${currentMember.code}.png`, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        title: `كارت عضوية ${currentMember.name}`,
        text: `كارت عضوية ${currentMember.name} في ${currentGymName}`,
        files: [file],
      });
      toast('تمت المشاركة بنجاح');
      return;
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
  }
  // إذا لم تنجح المشاركة، يتم التنزيل العادي كبديل
  downloadCard();
}

function getWhatsAppMessage(m, gym) {
  const planInfo = m.sub && m.sub.plan_name ? m.sub.plan_name : 'عضوية عامة';
  const endDate = m.sub && m.sub.end_date ? m.sub.end_date : 'غير محدد';

  return `مرحباً بك يا ${m.name} في ${gym} 🏋️‍♂️✨

تم تسجيل عضويتك بنجاح! تفاصيل الاشتراك:
🆔 كود العضوية: ${m.code}
📋 نوع الباقة: ${planInfo}
📅 تاريخ انتهاء الاشتراك: ${endDate}

🪪 مرفق صورة كارت العضوية والـ QR كود الخاص بك للدخول ✨
(يرجى حفظ صورة الكارت على هاتفك، وإبراز كود الـ QR عند مكتب الاستقبال لتسجيل حضورك في كل تمرين)

نتمنى لك وقتاً ممتعاً وتدريباً موفقاً! 💪🔥`;
}

async function sendViaWhatsApp(m) {
  let phone = formatWhatsAppPhone(m.phone);
  if (!phone) {
    const inputPhone = prompt(`العضو "${m.name}" ليس لديه رقم موبايل مسجل. أدخل رقم الموبايل لإرسال الكارت عبر واتساب:`);
    if (!inputPhone) return;
    phone = formatWhatsAppPhone(inputPhone);
    if (!phone) {
      toast('رقم الموبايل غير صحيح', true);
      return;
    }
  }

  // تجهيز ونسخ صورة الكارت للحافظة وتحميلها
  try {
    const blob = await renderCardToBlob();
    if (blob) {
      await copyCardImageToClipboard(blob);
      downloadCardBlob(blob, `card-${m.code}.png`);
    }
  } catch (err) {
    console.warn('Render card error:', err);
  }

  const msg = getWhatsAppMessage(m, currentGymName);
  const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
  window.open(waUrl, '_blank', 'noopener,noreferrer');
  toast('✅ تم نسخ صورة الكارنيه للحافظة! اضغط Ctrl + V في واتساب لإرسال الصورة فوراً 🖼️');
}

async function renderCardToBlob() {
  const canvas = document.getElementById('cardCanvas');
  const w = 1016;
  const h = 638;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  // التأكد من اكتمال تحميل صورة الـ QR
  if (qrImageElement && (!qrImageElement.complete || qrImageElement.naturalWidth === 0)) {
    await new Promise((resolve) => {
      qrImageElement.onload = resolve;
      qrImageElement.onerror = resolve;
      setTimeout(resolve, 1500);
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

  // شريط جانبي بلون متدرج أخضر
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
  ctx.font = 'bold 36px "Segoe UI", Tahoma, Arial, sans-serif';
  ctx.fillText(currentGymName, w - 120, 75);

  // خط فاصل رفيع
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(w - 120, 95);
  ctx.lineTo(w - 560, 95);
  ctx.stroke();

  // اسم العضو
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 44px "Segoe UI", Tahoma, Arial, sans-serif';
  let name = currentMember.name;
  if (name.length > 28) name = name.slice(0, 26) + '...';
  ctx.fillText(name, w - 120, 160);

  // كود العضو (أرقام فقط)
  ctx.fillStyle = '#16a34a';
  ctx.font = 'bold 26px "Segoe UI", Tahoma, Arial, sans-serif';
  ctx.fillText('كود العضوية:', w - 120, 220);

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 46px Consolas, monospace, sans-serif';
  ctx.fillText(currentMember.code, w - 280, 225);

  // تفاصيل الباقة والانتهاء
  const plan = (currentMember.sub && currentMember.sub.plan_name) || 'عضوية عامة';
  const endDate = (currentMember.sub && currentMember.sub.end_date) || '-';

  ctx.fillStyle = '#475569';
  ctx.font = '26px "Segoe UI", Tahoma, Arial, sans-serif';
  ctx.fillText(`الباقة: ${plan}`, w - 120, 290);
  ctx.fillText(`تاريخ الصلاحية: ${endDate}`, w - 120, 340);

  // حالة الاشتراك
  const state = (currentMember.sub && currentMember.sub.state) || (currentMember.active ? 'active' : 'inactive');
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
  ctx.font = 'bold 24px "Segoe UI", Tahoma, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(stateText, w - 220, 423);

  // جملة إرشادية أسفل الكارت
  ctx.fillStyle = '#94a3b8';
  ctx.font = '20px "Segoe UI", Tahoma, Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('يرجى إبراز كود الـ QR عند الدخول لتسجيل الحضور', w - 120, 580);

  // رسم الـ QR كود
  if (qrImageElement) {
    if (!qrImageElement.complete) {
      await new Promise((resolve) => {
        qrImageElement.onload = resolve;
        qrImageElement.onerror = resolve;
      });
    }
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
      ctx.drawImage(qrImageElement, qrX, qrY, qrSize, qrSize);
    } catch {
      /* ignore drawing error */
    }
  }

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

(async function init() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const id = params.get('id');
  const box = document.getElementById('card');

  const queryIdent = code || id;
  if (!queryIdent) {
    box.innerHTML = '<div class="alert bad" style="text-align:center;">بيانات العضو غير محددة بالرابط</div>';
    return;
  }

  // فحص هل المستخدم مسجل دخول كموظف/مدير لإظهار أزرار الإدارة
  let isStaff = false;
  try {
    const meResp = await fetch('/api/me', { credentials: 'same-origin' });
    if (meResp.ok) {
      const me = await meResp.json();
      if (me && me.role) {
        isStaff = true;
        document.querySelectorAll('.staff-only').forEach((el) => (el.style.display = ''));
      }
    }
  } catch {
    // ليس مسجل دخول (المشترك نفسه فاتح الرابط)
  }

  try {
    let d;
    try {
      d = await api('GET', `/api/public/card/${encodeURIComponent(queryIdent)}`);
    } catch (err) {
      if (isStaff) {
        // تجربة مسار الأعضاء المعتاد في حالة تسجيل الدخول
        const me = await api('GET', '/api/me');
        const mem = await api('GET', `/api/members/${encodeURIComponent(queryIdent)}`);
        d = {
          gymName: me.gymName || 'الجيم',
          name: mem.member.name,
          code: mem.member.code,
          phone: mem.member.phone,
          active: mem.member.active,
          sub: mem.member.sub,
          qrUrl: `/api/members/${mem.member.id}/qr.svg`,
        };
      } else {
        throw err;
      }
    }

    currentMember = d;
    currentGymName = d.gymName || 'الجيم';
    document.title = `كارت ${d.name} (${d.code}) - ${currentGymName}`;

    const titleEl = document.getElementById('gym-title');
    if (titleEl) {
      titleEl.textContent = `🏋️‍♂️ ${currentGymName} - كارت العضوية`;
    }

    // تجهيز صورة الـ QR
    const qrImg = h('img', {
      src: d.qrUrl || `/api/public/card-qr/${encodeURIComponent(d.code)}`,
      alt: 'QR Code',
      loading: 'eager',
    });
    qrImageElement = qrImg;

    const plan = (d.sub && d.sub.plan_name) || 'عضوية عامة';
    const endDate = (d.sub && d.sub.end_date) || '-';
    const state = (d.sub && d.sub.state) || (d.active ? 'active' : 'inactive');

    box.replaceChildren(
      h(
        'div',
        { class: 'member-card' },
        h('div', { class: 'side' }),
        h(
          'div',
          { class: 'body' },
          h('div', { class: 'gym' }, currentGymName),
          h('div', { class: 'nm' }, d.name),
          h('div', { class: 'cd mono' }, `كود: ${d.code}`),
          h(
            'div',
            { class: 'details' },
            h('span', null, `الباقة: ${plan}`),
            h('span', null, `الانتهاء: ${endDate}`),
            h('span', null, badge(state))
          )
        ),
        h('div', { class: 'qr' }, qrImg)
      )
    );
  } catch (e) {
    box.innerHTML = `<div class="alert bad" style="text-align:center;">${e.message || 'تعذر تحميل بيانات الكارت'}</div>`;
  }
})();
