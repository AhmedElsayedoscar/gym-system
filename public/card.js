'use strict';

let currentMember = null;
let currentGymName = 'الجيم';
let barcodeImageElement = null;

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

function getWhatsAppMessage(m,gym) {
  const planInfo = m.sub && m.sub.plan_name ? m.sub.plan_name : 'عضوية عامة';
  const endDate = m.sub && m.sub.end_date ? m.sub.end_date : 'غير محدد';

  return `مرحباً بك يا ${m.name} في X Gym🏋️‍♂️✨

تم تسجيل عضويتك بنجاح! تفاصيل الاشتراك:
🆔 كود العضوية: ${m.code}
📋 نوع الباقة: ${planInfo}
📅 تاريخ انتهاء الاشتراك: ${endDate}

🪪 مرفق صورة كارت العضوية والـ QR كود الخاص بك للدخول ✨
(يرجى حفظ صورة الكارت على هاتفك، وإبراز كود الـ QR عند مكتب الاستقبال لتسجيل حضورك في كل تمرين)
`;
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
  return renderMemberCardToBlob(currentMember, currentGymName, barcodeImageElement);
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
          gymName: me.gymName || 'X GYM',
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
    currentGymName = d.gymName || 'X GYM';
    document.title = `كارت ${d.name} (${d.code}) - ${currentGymName}`;

    const titleEl = document.getElementById('gym-title');
    if (titleEl) {
      titleEl.innerHTML = `<img src="/xgym-logo.jpg" alt="X GYM" class="card-brand-img"> <span>${currentGymName} VIP • كارت العضوية</span>`;
    }

    // تجهيز صورة الباركود
    const barcodeImg = h('img', {
      src: d.qrUrl || `/api/public/card-qr/${encodeURIComponent(d.code)}`,
      alt: 'باركود',
      loading: 'eager',
    });
    barcodeImageElement = barcodeImg;

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
          h('div', { class: 'gym' }, `⚡ ${currentGymName} VIP`),
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
        h('div', { class: 'qr' },
          h('div', { class: 'qr-inner' }, barcodeImg)
        )
      )
    );
  } catch (e) {
    box.innerHTML = `<div class="alert bad" style="text-align:center;">${e.message || 'تعذر تحميل بيانات الكارت'}</div>`;
  }
})();
