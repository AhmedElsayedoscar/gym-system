'use strict';

const app = document.getElementById('app');
let ME = { role: 'staff', gymName: '' };

// ---------- التنقل ----------
const NAV = [
  ['#/', 'لوحة التحكم'],
  ['#/members', 'الأعضاء'],
  ['#/attendance', 'الحضور'],
  ['#/daily-report', '📊 التقرير اليومي', 'admin'],
  ['#/plans', 'الباقات', 'admin'],
  ['#/reminders', '🔔 الإشعارات', 'admin'],
  ['#/settings', '⚙️ الإعدادات', 'admin'],
];

function renderNav(current) {
  const nav = document.getElementById('nav');
  nav.replaceChildren(
    ...NAV.filter((n) => !n[2] || ME.role === 'admin').map(([href, label]) => {
      const on = href === '#/' ? current === '#/' : current.startsWith(href);
      return h('a', { href, class: on ? 'active' : '' }, label);
    }),
    h('a', { href: '/scan.html', class: 'scan-link' }, 'شاشة المسح')
  );
}

function todayLocal() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

// ---------- نافذة منبثقة ----------
function openModal(title, bodyEls, onSubmit, submitLabel = 'حفظ') {
  const err = h('div', { class: 'alert bad', hidden: true });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, submitLabel);
  const form = h(
    'form',
    {
      onsubmit: async (e) => {
        e.preventDefault();
        err.hidden = true;
        submit.disabled = true;
        try {
          await onSubmit(new FormData(form));
          back.remove();
        } catch (ex) {
          err.textContent = ex.message;
          err.hidden = false;
          submit.disabled = false;
        }
      },
    },
    h('h2', null, title),
    bodyEls,
    err,
    h('div', { class: 'actions' }, submit, h('button', { class: 'btn', type: 'button', onclick: () => back.remove() }, 'إلغاء'))
  );
  const back = h('div', { class: 'modal-back', onmousedown: (e) => e.target === back && back.remove() }, h('div', { class: 'modal' }, form));
  document.body.append(back);
  const first = form.querySelector('input, select, textarea');
  if (first) first.focus();
}

function field(label, input) {
  return h('div', { class: 'field' }, h('label', null, label), input);
}

function planOptions(plans, selectedId) {
  return plans.map((p) =>
    h('option', { value: p.id, selected: p.id === selectedId }, `${p.name} — ${p.duration_days} يوم — ${fmtMoney(p.price)} جنيه`)
  );
}

// ---------- لوحة التحكم ----------
async function pageDashboard() {
  const s = await api('GET', '/api/stats');
  const tile = (cls, num, lbl, href) =>
    h(href ? 'a' : 'div', { class: `tile ${cls}`, href, style: href ? 'color:inherit;text-decoration:none' : null }, h('div', { class: 'num' }, num), h('div', { class: 'lbl' }, lbl));

  const warn =
    ME.defaultPasswords &&
    h(
      'div',
      { class: 'alert warn', style: 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px' },
      h('span', null, '⚠️ تنبيه: السيستم يعمل بكلمة مرور افتراضية (المدير أو الموظف). يُنصح بتغييرها للأمان.'),
      h('a', { href: '#/settings', class: 'btn small primary', style: 'text-decoration:none' }, 'تغيير كلمات المرور')
    );

  const expiringRows = s.expiringList.length
    ? s.expiringList.map((m) =>
        h(
          'tr',
          { class: 'clickable', onclick: () => (location.hash = `#/members/${m.id}`) },
          h('td', null, m.name),
          h('td', { class: 'ltr' }, m.phone || '-'),
          h('td', null, ltr(m.end_date)),
          h('td', null, m.days_left === 0 ? 'النهارده' : `${m.days_left} يوم`)
        )
      )
    : [h('tr', null, h('td', { class: 'empty', colspan: 4 }, 'مفيش اشتراكات هتنتهي خلال أسبوع'))];

  const recentRows = s.recent.length
    ? s.recent.map((a) =>
        h(
          'tr',
          { class: 'clickable', onclick: () => (location.hash = `#/members/${a.member_id}`) },
          h('td', null, fmtTime(a.checkin_at)),
          h('td', null, a.name),
          h('td', null, badge(a.result, a.result === 'ok' ? 'دخول' : REASON_LABEL[a.reason] || 'مرفوض'))
        )
      )
    : [h('tr', null, h('td', { class: 'empty', colspan: 3 }, 'لا يوجد حضور مسجل لسه'))];

  app.replaceChildren(
    warn || '',
    h('div', { class: 'page-head' }, h('h1', null, 'لوحة التحكم'), h('span', { class: 'muted' }, ltr(s.today))),
    h(
      'div',
      { class: 'tiles' },
      tile('ok', s.active, 'اشتراكات سارية', '#/members?status=active'),
      tile('warn', s.expiring, 'ينتهي خلال 7 أيام', '#/members?status=expiring'),
      tile('bad', s.expired, 'اشتراكات منتهية', '#/members?status=expired'),
      tile('info', s.todayCount, 'حضور النهارده', '#/attendance'),
      tile('', s.deniedToday, 'محاولات مرفوضة النهارده', '#/attendance'),
      ME.role === 'admin' ? tile('gold', '📊 تقرير الوردية', 'التقرير اليومي للاشتراكات', '#/daily-report') : ''
    ),
    h(
      'div',
      { class: 'grid-2' },
      h(
        'div',
        { class: 'card' },
        h('h2', null, 'اشتراكات قاربت على الانتهاء'),
        h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'الاسم'), h('th', null, 'الموبايل'), h('th', null, 'تاريخ الانتهاء'), h('th', null, 'المتبقي'))), h('tbody', null, expiringRows)))
      ),
      h(
        'div',
        { class: 'card' },
        h('h2', null, 'آخر حركات الحضور'),
        h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'الوقت'), h('th', null, 'العضو'), h('th', null, 'النتيجة'))), h('tbody', null, recentRows)))
      )
    )
  );
}

// ---------- الأعضاء ----------
async function pageMembers(query) {
  const params = new URLSearchParams(query);
  let q = params.get('q') || '';
  let status = params.get('status') || 'all';

  const list = h('div', { class: 'card table-wrap' });
  const search = h('input', { type: 'search', placeholder: 'ابحث بالاسم أو الموبايل أو كود العضو', value: q });
  const statusSel = h(
    'select',
    null,
    ...[
      ['all', 'كل الأعضاء'],
      ['active', 'ساري'],
      ['expiring', 'قارب على الانتهاء'],
      ['expired', 'منتهي'],
      ['none', 'بدون اشتراك'],
      ['upcoming', 'لم يبدأ بعد'],
    ].map(([v, l]) => h('option', { value: v, selected: v === status }, l))
  );

  let timer;
  async function load() {
    const data = await api('GET', `/api/members?q=${encodeURIComponent(q)}&status=${status}`);
    list.replaceChildren(
      data.length
        ? h(
            'table',
            null,
            h('thead', null, h('tr', null, ['الاسم', 'الموبايل', 'الكود', 'الباقة', 'ينتهي في', 'الحالة'].map((t) => h('th', null, t)))),
            h(
              'tbody',
              null,
              data.map((m) =>
                h(
                  'tr',
                  { class: 'clickable', onclick: () => (location.hash = `#/members/${m.id}`) },
                  h('td', null, m.name),
                  h('td', { class: 'ltr' }, m.phone || '-'),
                  h('td', { class: 'mono' }, m.code),
                  h('td', null, m.sub.plan_name || '-'),
                  h('td', null, m.sub.end_date ? ltr(m.sub.end_date) : '-'),
                  h('td', null, m.active ? badge(m.sub.state) : badge('inactive', 'موقوف'))
                )
              )
            )
          )
        : h('div', { class: 'empty' }, 'لا يوجد أعضاء مطابقين')
    );
  }
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      q = search.value.trim();
      load().catch((e) => toast(e.message, true));
    }, 250);
  });
  statusSel.addEventListener('change', () => {
    status = statusSel.value;
    load().catch((e) => toast(e.message, true));
  });

  app.replaceChildren(
    h('div', { class: 'page-head' }, h('h1', null, 'الأعضاء'), h('button', { class: 'btn primary', onclick: () => addMemberModal() }, '+ عضو جديد')),
    h('div', { class: 'toolbar' }, search, statusSel),
    list
  );
  await load();
}

async function addMemberModal() {
  const plans = await api('GET', '/api/plans');
  openModal(
    'عضو جديد',
    [
      field('الاسم', h('input', { name: 'name', required: true, maxlength: 100 })),
      field('كود العضو (أرقام فقط - اتركه فارغاً للتوليد التلقائي)', h('input', { name: 'code', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', placeholder: 'مثال: 1001 (تلقائي لو تُرك فارغاً)' })),
      field('رقم الموبايل', h('input', { name: 'phone', type: 'tel', inputmode: 'tel', maxlength: 30, class: 'ltr' })),
      field('الباقة (اختياري)', h('select', { name: 'plan_id' }, h('option', { value: '' }, 'بدون اشتراك دلوقتي'), planOptions(plans))),
      h('div', { class: 'row' }, field('تاريخ البداية', h('input', { name: 'start_date', type: 'date', value: todayLocal() })), field('السعر المدفوع (اختياري)', h('input', { name: 'price', type: 'number', min: 0, step: '0.01', placeholder: 'سعر الباقة' }))),
      field('ملاحظات', h('textarea', { name: 'notes', rows: 2, maxlength: 500 })),
    ],
    async (fd) => {
      const codeVal = fd.get('code')?.trim();
      const r = await api('POST', '/api/members', {
        name: fd.get('name'),
        code: codeVal || undefined,
        phone: fd.get('phone'),
        notes: fd.get('notes'),
        plan_id: fd.get('plan_id') || null,
        start_date: fd.get('start_date'),
        price: fd.get('price'),
      });
      toast('تمت إضافة العضو');
      location.hash = `#/members/${r.id}`;
    },
    'إضافة'
  );
}

async function pageMember(id) {
  const d = await api('GET', `/api/members/${id}`);
  const m = d.member;
  const refresh = () => route();

  const infoLine = (k, v) => h('div', { class: 'info-line' }, `${k}: `, h('b', null, v));

  const subRows = d.subscriptions.length
    ? d.subscriptions.map((s) =>
        h(
          'tr',
          null,
          h('td', null, s.plan_name),
          h('td', null, ltr(s.start_date)),
          h('td', null, ltr(s.end_date)),
          h('td', null, fmtMoney(s.price)),
          h('td', null, s.status === 'cancelled' ? badge('cancelled', 'ملغي') : badge('active', 'مسجل')),
          h(
            'td',
            null,
            ME.role === 'admin' && s.status === 'active'
              ? h(
                  'button',
                  {
                    class: 'btn small danger',
                    onclick: async () => {
                      if (!confirm('إلغاء هذا الاشتراك؟')) return;
                      try {
                        await api('DELETE', `/api/subscriptions/${s.id}`);
                        toast('تم إلغاء الاشتراك');
                        refresh();
                      } catch (e) {
                        toast(e.message, true);
                      }
                    },
                  },
                  'إلغاء'
                )
              : null
          )
        )
      )
    : [h('tr', null, h('td', { class: 'empty', colspan: 6 }, 'لا توجد اشتراكات'))];

  const attRows = d.attendance.length
    ? d.attendance.map((a) =>
        h('tr', null, h('td', null, fmtDateTime(a.checkin_at)), h('td', null, badge(a.result, a.result === 'ok' ? 'دخول' : REASON_LABEL[a.reason] || 'مرفوض')))
      )
    : [h('tr', null, h('td', { class: 'empty', colspan: 2 }, 'لا يوجد حضور'))];

  const actions = h(
    'div',
    { class: 'actions', style: 'margin-top:12px' },
    h('button', { class: 'btn primary', onclick: () => renewModal(m, refresh) }, 'تجديد / اشتراك جديد'),
    h('button', { class: 'btn', onclick: () => editMemberModal(m, refresh) }, 'تعديل البيانات'),
    h('a', { class: 'btn', href: `/card.html?code=${encodeURIComponent(m.code)}`, target: '_blank', rel: 'noopener' }, 'طباعة الكارت'),
    h('button', { class: 'btn whatsapp', onclick: () => openWhatsAppModal(m) }, '💬 إرسال الكارت عبر واتساب'),
    ME.role === 'admin' &&
      h(
        'button',
        {
          class: 'btn danger',
          onclick: async () => {
            if (!confirm(`حذف العضو "${m.name}" نهائيًا مع كل اشتراكاته وحضوره؟`)) return;
            try {
              await api('DELETE', `/api/members/${m.id}`);
              toast('تم حذف العضو');
              location.hash = '#/members';
            } catch (e) {
              toast(e.message, true);
            }
          },
        },
        'حذف'
      )
  );

  app.replaceChildren(
    h('div', { class: 'page-head' }, h('a', { href: '#/members' }, '← كل الأعضاء')),
    h(
      'div',
      { class: 'card' },
      h(
        'div',
        { class: 'member-head' },
        h('div', { class: 'qr-box' }, h('div', { class: 'code mono' }, m.code), h('img', { src: `/api/members/${m.id}/qr.svg`, alt: 'باركود' })),
        h(
          'div',
          { class: 'member-info' },
          h('h1', null, m.name, ' ', m.active ? badge(m.sub.state) : badge('inactive', 'موقوف')),
          infoLine('الموبايل', m.phone || '-'),
          infoLine('الباقة الحالية', m.sub.plan_name || '-'),
          infoLine('ينتهي في', m.sub.end_date ? `${ltr(m.sub.end_date)}${m.sub.days_left > 0 ? ` (باقي ${m.sub.days_left} يوم)` : ''}` : '-'),
          infoLine('عدد الزيارات', String(d.totalVisits)),
          m.notes && infoLine('ملاحظات', m.notes),
          actions
        )
      )
    ),
    h(
      'div',
      { class: 'card' },
      h('h2', null, 'سجل الاشتراكات'),
      h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, ['الباقة', 'من', 'إلى', 'السعر', 'الحالة', ''].map((t) => h('th', null, t)))), h('tbody', null, subRows)))
    ),
    h('div', { class: 'card' }, h('h2', null, 'آخر حضور'), h('div', { class: 'table-wrap' }, h('table', null, h('tbody', null, attRows))))
  );
}

async function renewModal(m, done) {
  const plans = await api('GET', '/api/plans');
  const hint = m.sub.end_date && m.sub.days_left > 0 ? `الاشتراك الجديد هيبدأ بعد انتهاء الحالي (${ltr(m.sub.end_date)}) لو سبت التاريخ فاضي.` : 'لو سبت التاريخ فاضي هيبدأ النهارده.';
  openModal(
    `تجديد اشتراك — ${m.name}`,
    [
      field('الباقة', h('select', { name: 'plan_id', required: true }, planOptions(plans))),
      h('div', { class: 'row' }, field('تاريخ البداية (اختياري)', h('input', { name: 'start_date', type: 'date' })), field('السعر المدفوع (اختياري)', h('input', { name: 'price', type: 'number', min: 0, step: '0.01', placeholder: 'سعر الباقة' }))),
      h('div', { class: 'muted', style: 'font-size:.9rem' }, hint),
    ],
    async (fd) => {
      await api('POST', `/api/members/${m.id}/subscriptions`, {
        plan_id: fd.get('plan_id'),
        start_date: fd.get('start_date'),
        price: fd.get('price'),
      });
      toast('تم تسجيل الاشتراك');
      done();
    },
    'تسجيل الاشتراك'
  );
}

function editMemberModal(m, done) {
  openModal(
    'تعديل بيانات العضو',
    [
      field('الاسم', h('input', { name: 'name', required: true, maxlength: 100, value: m.name })),
      field('كود العضو (أرقام فقط)', h('input', { name: 'code', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', value: m.code, required: true })),
      field('رقم الموبايل', h('input', { name: 'phone', type: 'tel', maxlength: 30, class: 'ltr', value: m.phone })),
      field('ملاحظات', h('textarea', { name: 'notes', rows: 2, maxlength: 500 }, m.notes)),
      h('div', { class: 'field' }, h('label', null, h('input', { type: 'checkbox', name: 'active', style: 'width:auto;margin-inline-end:8px', checked: m.active }), 'العضوية فعّالة (لو مش فعّالة الدخول بيترفض)')),
    ],
    async (fd) => {
      await api('PUT', `/api/members/${m.id}`, {
        name: fd.get('name'),
        code: fd.get('code')?.trim(),
        phone: fd.get('phone'),
        notes: fd.get('notes'),
        active: fd.get('active') === 'on',
      });
      toast('تم الحفظ');
      done();
    }
  );
}

function openWhatsAppModal(m) {
  const planInfo = m.sub && m.sub.plan_name ? m.sub.plan_name : 'عضوية عامة';
  const endDate = m.sub && m.sub.end_date ? m.sub.end_date : 'غير محدد';
  const gym = ME.gymName || 'X GYM';

  // رسالة الواتساب بدون رابط لوكال هوست إطلاقاً، ومجهزة لإرسال صورة الكارت
  const defaultMsg = `مرحباً بك يا ${m.name} في X GYM 

تم تسجيل عضويتك بنجاح! تفاصيل الاشتراك:
 كود العضوية: ${m.code}
 نوع الباقة: ${planInfo}
 تاريخ انتهاء الاشتراك: ${endDate}

🪪 مرفق صورة كارت العضوية والبار كود الخاص بك للدخول 
(يرجى حفظ صورة الكارت على هاتفك، وإبراز البار كود عند مكتب الاستقبال لتسجيل حضورك في كل تمرين)
`;

  const phoneInput = h('input', { type: 'tel', value: m.phone || '', placeholder: 'مثال: 01012345678', class: 'ltr' });
  const msgBox = h('textarea', { rows: 7, style: 'font-size:0.85rem;resize:vertical' }, defaultMsg);

  let cachedBlob = null;
  const previewImg = h('img', {
    alt: `كارت عضوية ${m.name}`,
    style: 'max-width:100%;height:auto;border-radius:10px;box-shadow:0 3px 10px rgba(0,0,0,0.12);display:none;border:1px solid #e2e8f0;margin:0 auto;'
  });
  const loadingStatus = h('div', { class: 'muted', style: 'padding:14px;text-align:center;font-size:0.9rem' }, '⏳ جاري توليد صورة الكارت عالية الدقة...');

  // توليد صورة الكارت في الخلفية فور فتح المودال
  renderMemberCardToBlob(m, gym).then((blob) => {
    cachedBlob = blob;
    previewImg.src = URL.createObjectURL(blob);
    previewImg.style.display = 'block';
    loadingStatus.style.display = 'none';
  }).catch((err) => {
    console.error(err);
    loadingStatus.textContent = 'تعذر تجهيز معاينة الصورة: ' + err.message;
  });

  const previewBox = h('div', {
    style: 'background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:12px;text-align:center;'
  },
    h('div', { style: 'font-weight:700;margin-bottom:8px;font-size:0.9rem;color:var(--brand-dark)' }, '🖼️ صورة كارت العضوية الرقمي:'),
    loadingStatus,
    previewImg,
    h('div', { style: 'font-size:0.8rem;color:#16a34a;font-weight:600;margin-top:8px' }, '💡 سيتم نسخ هذه الصورة تلقائياً للحافظة لتلصقها في واتساب (Ctrl+V)')
  );

  const canShare = !!(navigator.canShare && window.File);

  openModal(
    'إرسال صورة كارت العضوية عبر واتساب',
    [
      previewBox,
      field('رقم موبايل العضو', phoneInput),
      field('نص الرسالة المصاحبة للكارت', msgBox),
      h(
        'div',
        { class: 'actions', style: 'margin-top:10px;flex-wrap:wrap;gap:8px' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn',
            onclick: async () => {
              if (!cachedBlob) {
                toast('جاري تجهيز الصورة، انتظر ثانية...', true);
                cachedBlob = await renderMemberCardToBlob(m, gym);
              }
              const copied = await copyCardImageToClipboard(cachedBlob);
              if (copied) {
                toast('✅ تم نسخ صورة الكارت! اضغط Ctrl+V في واتساب');
              } else {
                downloadCardBlob(cachedBlob, `card-${m.code}.png`);
                toast('تم تحميل صورة الكارت لجهازك 💾');
              }
            },
          },
          '📋 نسخ صورة الكارت (Ctrl+V)'
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn',
            onclick: async () => {
              if (!cachedBlob) cachedBlob = await renderMemberCardToBlob(m, gym);
              downloadCardBlob(cachedBlob, `card-${m.code}.png`);
              toast('تم تحميل صورة الكارت 💾');
            },
          },
          '💾 حفظ الصورة (PNG)'
        ),
        canShare && h(
          'button',
          {
            type: 'button',
            class: 'btn',
            onclick: async () => {
              if (!cachedBlob) cachedBlob = await renderMemberCardToBlob(m, gym);
              const file = new File([cachedBlob], `card-${m.code}.png`, { type: 'image/png' });
              if (navigator.canShare({ files: [file] })) {
                await navigator.share({
                  title: `كارت عضوية ${m.name}`,
                  text: msgBox.value,
                  files: [file],
                });
              }
            },
          },
          '📤 مشاركة الصورة'
        ),
        h(
          'a',
          {
            class: 'btn',
            href: `/card.html?code=${encodeURIComponent(m.code)}`,
            target: '_blank',
            rel: 'noopener',
          },
          '🖨️ صفحة الكارت والطباعة'
        )
      ),
    ],
    async () => {
      const p = formatWhatsAppPhone(phoneInput.value);
      if (!p) throw new Error('يرجى إدخال رقم موبايل صحيح للعضو');

      // 1. نسخ صورة الكارت للحافظة
      if (!cachedBlob) {
        cachedBlob = await renderMemberCardToBlob(m, gym);
      }
      if (cachedBlob) {
        await copyCardImageToClipboard(cachedBlob);
        // حفظ نسخة في مجلد التنزيلات
        downloadCardBlob(cachedBlob, `card-${m.code}.png`);
      }

      // 2. فتح واتساب بالرسالة
      const waUrl = `https://wa.me/${p}?text=${encodeURIComponent(msgBox.value)}`;
      window.open(waUrl, '_blank', 'noopener,noreferrer');
      toast('✅ تم نسخ صورة الكارنيه للحافظة! اضغط Ctrl + V (لصق) في واتساب لإرسال الصورة فوراً 🖼️');
    },
    '💬 فتح واتساب وإرسال صورة الكارت'
  );
}

function shiftDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function manualAttendanceModal(done) {
  const members = await api('GET', '/api/members?status=all');
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  const dayStr = todayLocal();

  const memberSelect = h(
    'select',
    { name: 'member_id', required: true },
    h('option', { value: '' }, '-- اختر العضو --'),
    ...members.map((m) =>
      h('option', { value: m.id }, `${m.code} — ${m.name} ${m.phone ? '(' + m.phone + ')' : ''}`)
    )
  );

  const dateInput = h('input', { name: 'date', type: 'date', value: dayStr, required: true });
  const timeInput = h('input', { name: 'time', type: 'time', value: timeStr, required: true });

  openModal(
    'تسجيل حضور يدوي (لتاريخ سابق أو اليوم)',
    [
      field('العضو', memberSelect),
      h('div', { class: 'row' }, field('تاريخ الحضور (اليوم أو يوم سابق)', dateInput), field('وقت الحضور', timeInput)),
      h(
        'div',
        { class: 'muted', style: 'font-size:.85rem;margin-top:6px' },
        '💡 يمكنك اختيار أي يوم سابق لتسجيل حضور العضو فيه في حال لم يتم المسح في ذلك اليوم.'
      ),
    ],
    async (fd) => {
      const memberId = fd.get('member_id');
      if (!memberId) throw new Error('يرجى اختيار العضو');
      await api('POST', '/api/attendance/manual', {
        member_id: memberId,
        date: fd.get('date'),
        time: fd.get('time'),
      });
      toast('تم تسجيل الحضور بنجاح');
      done();
    },
    'تسجيل الحضور'
  );
}

// ---------- الحضور ----------
async function pageAttendance() {
  const today = todayLocal();
  let from = today;
  let to = today;
  let activePreset = 'today';
  let q = '';
  let resultFilter = 'all';

  const box = h('div', { class: 'card table-wrap' });
  const statsBox = h('div', { class: 'att-stats' });

  const fromInput = h('input', { type: 'date', value: from, style: 'max-width:160px' });
  const toInput = h('input', { type: 'date', value: to, style: 'max-width:160px' });
  const searchInput = h('input', { type: 'search', placeholder: 'ابحث بالاسم أو كود العضو أو الموبايل...', style: 'min-width:240px;flex:1' });
  const resSelect = h(
    'select',
    { style: 'max-width:160px' },
    h('option', { value: 'all' }, 'الكل (دخول ومرفوض)'),
    h('option', { value: 'ok' }, 'دخول مقبول فقط'),
    h('option', { value: 'denied' }, 'محاولات مرفوضة فقط')
  );

  const presetContainer = h('div', { class: 'preset-bar' });

  function setPreset(p) {
    activePreset = p;
    if (p === 'today') {
      from = today;
      to = today;
    } else if (p === 'yesterday') {
      const y = shiftDays(today, -1);
      from = y;
      to = y;
    } else if (p === 'week') {
      from = shiftDays(today, -6);
      to = today;
    } else if (p === 'month') {
      from = today.slice(0, 7) + '-01';
      to = today;
    } else if (p === 'all') {
      from = '2024-01-01';
      to = today;
    }
    fromInput.value = from;
    toInput.value = to;
    renderPresets();
    load().catch((e) => toast(e.message, true));
  }

  function renderPresets() {
    const list = [
      ['today', 'اليوم'],
      ['yesterday', 'أمس'],
      ['week', 'آخر 7 أيام'],
      ['month', 'هذا الشهر'],
      ['all', 'كل السجل'],
    ];
    presetContainer.replaceChildren(
      ...list.map(([id, label]) =>
        h(
          'button',
          {
            type: 'button',
            class: `preset-btn ${activePreset === id ? 'active' : ''}`,
            onclick: () => setPreset(id),
          },
          label
        )
      )
    );
  }

  async function load() {
    let url = `/api/attendance?from=${from}&to=${to}&result=${resultFilter}`;
    if (q) url += `&q=${encodeURIComponent(q)}`;

    const rows = await api('GET', url);
    const okCount = rows.filter((r) => r.result === 'ok').length;
    const deniedCount = rows.length - okCount;
    const uniqueMembers = new Set(rows.map((r) => r.member_id)).size;

    statsBox.replaceChildren(
      h('div', { class: 'att-stat-item' }, 'إجمالي الحركات: ', h('b', null, String(rows.length))),
      h('div', { class: 'att-stat-item' }, 'حضور مقبول: ', h('b', { style: 'color:#15803d' }, String(okCount))),
      h('div', { class: 'att-stat-item' }, 'محاولات مرفوضة: ', h('b', { style: 'color:#b91c1c' }, String(deniedCount))),
      h('div', { class: 'att-stat-item' }, 'أعضاء فريدين: ', h('b', null, String(uniqueMembers)))
    );

    box.replaceChildren(
      rows.length
        ? h(
            'table',
            null,
            h(
              'thead',
              null,
              h(
                'tr',
                null,
                ['اليوم والتاريخ', 'الوقت', 'كود العضو', 'اسم العضو', 'الموبايل', 'النتيجة / السبب', ME.role === 'admin' ? 'إجراء' : null]
                  .filter(Boolean)
                  .map((t) => h('th', null, t))
              )
            ),
            h(
              'tbody',
              null,
              rows.map((a) =>
                h(
                  'tr',
                  null,
                  h('td', null, fmtDayArabic(a.day)),
                  h('td', null, fmtTime(a.checkin_at)),
                  h('td', { class: 'mono' }, a.code || '-'),
                  h(
                    'td',
                    { class: 'clickable', onclick: () => (location.hash = `#/members/${a.member_id}`) },
                    h('b', { style: 'color:var(--brand-dark)' }, a.name)
                  ),
                  h('td', { class: 'ltr' }, a.phone || '-'),
                  h('td', null, badge(a.result, a.result === 'ok' ? (a.reason === 'manual' ? 'تسجيل يدوي' : 'دخول') : REASON_LABEL[a.reason] || 'مرفوض')),
                  ME.role === 'admin' &&
                    h(
                      'td',
                      null,
                      h(
                        'button',
                        {
                          class: 'btn danger',
                          style: 'padding:3px 8px;font-size:0.75rem',
                          title: 'حذف هذه الحركة',
                          onclick: async () => {
                            if (!confirm(`هل أنت متأكد من حذف حركة حضور ${a.name} بتاريخ ${a.day}؟`)) return;
                            try {
                              await api('DELETE', `/api/attendance/${a.id}`);
                              toast('تم حذف حركة الحضور');
                              load();
                            } catch (e) {
                              toast(e.message, true);
                            }
                          },
                        },
                        'حذف'
                      )
                    )
                )
              )
            )
          )
        : h('div', { class: 'empty' }, 'لا توجد حركات حضور مسجلة في هذه الفترة')
    );
  }

  fromInput.addEventListener('change', () => {
    from = fromInput.value;
    activePreset = 'custom';
    renderPresets();
    load().catch((e) => toast(e.message, true));
  });

  toInput.addEventListener('change', () => {
    to = toInput.value;
    activePreset = 'custom';
    renderPresets();
    load().catch((e) => toast(e.message, true));
  });

  resSelect.addEventListener('change', () => {
    resultFilter = resSelect.value;
    load().catch((e) => toast(e.message, true));
  });

  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      q = searchInput.value.trim();
      load().catch((e) => toast(e.message, true));
    }, 250);
  });

  const prevDayBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn',
      title: 'اليوم السابق',
      onclick: () => {
        from = shiftDays(from, -1);
        to = from;
        fromInput.value = from;
        toInput.value = to;
        activePreset = 'custom';
        renderPresets();
        load().catch((e) => toast(e.message, true));
      },
    },
    '◀ يوم سابق'
  );

  const nextDayBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn',
      title: 'اليوم التالي',
      onclick: () => {
        from = shiftDays(from, 1);
        to = from;
        fromInput.value = from;
        toInput.value = to;
        activePreset = 'custom';
        renderPresets();
        load().catch((e) => toast(e.message, true));
      },
    },
    'يوم لاحق ▶'
  );

  renderPresets();

  app.replaceChildren(
    h(
      'div',
      { class: 'page-head' },
      h('h1', null, 'سجل الحضور'),
      h('button', { class: 'btn primary', onclick: () => manualAttendanceModal(load) }, '+ تسجيل حضور يدوي')
    ),
    presetContainer,
    h(
      'div',
      { class: 'toolbar', style: 'align-items:center;margin-bottom:12px' },
      prevDayBtn,
      h('div', { class: 'date-nav' }, h('span', { class: 'muted' }, 'من:'), fromInput, h('span', { class: 'muted' }, 'إلى:'), toInput),
      nextDayBtn,
      resSelect
    ),
    h('div', { class: 'toolbar' }, searchInput),
    statsBox,
    box
  );

  await load();
}

// ---------- التقرير اليومي وتقفيل الوردية (للمدير) ----------
async function pageDailyReport(query) {
  if (ME.role !== 'admin') {
    app.replaceChildren(h('div', { class: 'alert bad' }, 'الصفحة دي للمدير فقط'));
    return;
  }

  const params = new URLSearchParams(query);
  const today = todayLocal();
  let selectedDate = params.get('date') || today;
  let q = '';
  let typeFilter = 'all'; // all, new, renew
  let reportData = null;

  // عناصر الرأس وشريط التنقل بين الأيام
  const dateDisplay = h('span', { class: 'muted', style: 'font-weight:700;font-size:1.05rem' });
  const dateInput = h('input', {
    type: 'date',
    value: selectedDate,
    style: 'max-width:160px;font-weight:700',
    onchange: (e) => {
      if (e.target.value) setDay(e.target.value);
    },
  });

  const presetContainer = h('div', { class: 'preset-bar no-print' });
  const summaryBox = h('div', { class: 'tiles' });
  const tableWrap = h('div', { class: 'card table-wrap' });
  const historyCard = h('div', { class: 'card no-print', style: 'margin-top:22px' });

  // حقول التصفية والبحث في جدول اليوم
  const searchInput = h('input', {
    type: 'search',
    placeholder: 'ابحث في حركات اليوم بالاسم، كود العضو، الموبايل، أو الباقة...',
    style: 'min-width:250px;flex:2',
    oninput: (e) => {
      q = e.target.value.trim().toLowerCase();
      renderTable();
    },
  });

  const typeSelect = h(
    'select',
    {
      style: 'max-width:200px;flex:1',
      onchange: (e) => {
        typeFilter = e.target.value;
        renderTable();
      },
    },
    h('option', { value: 'all' }, 'الكل (اشتراكات وتجديدات)'),
    h('option', { value: 'new' }, '🟢 اشتراكات جديدة فقط'),
    h('option', { value: 'renew' }, '🔄 تجديدات فقط')
  );

  function setDay(day) {
    selectedDate = day;
    dateInput.value = day;
    try {
      history.replaceState(null, '', `#/daily-report?date=${day}`);
    } catch {
      /* ignore */
    }
    load(day).catch((e) => toast(e.message, true));
  }

  function renderPresets() {
    const isToday = selectedDate === today;
    const yesterday = shiftDays(today, -1);
    const isYesterday = selectedDate === yesterday;

    presetContainer.replaceChildren(
      h(
        'button',
        {
          type: 'button',
          class: `preset-btn ${isToday ? 'active' : ''}`,
          onclick: () => setDay(today),
        },
        '📅 اليوم'
      ),
      h(
        'button',
        {
          type: 'button',
          class: `preset-btn ${isYesterday ? 'active' : ''}`,
          onclick: () => setDay(yesterday),
        },
        '⏪ أمس'
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'preset-btn',
          title: 'اليوم السابق',
          onclick: () => setDay(shiftDays(selectedDate, -1)),
        },
        '◀ اليوم السابق'
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'preset-btn',
          title: 'اليوم التالي',
          onclick: () => setDay(shiftDays(selectedDate, 1)),
        },
        'اليوم التالي ▶'
      )
    );
  }

  function renderSummary() {
    if (!reportData) return;
    const tile = (cls, num, lbl) =>
      h('div', { class: `tile ${cls}` }, h('div', { class: 'num' }, num), h('div', { class: 'lbl' }, lbl));

    summaryBox.replaceChildren(
      tile('gold', `${fmtMoney(reportData.totalRevenue)} ج.م`, '💰 إجمالي إيراد اليوم (خزينة الوردية)'),
      tile('info', reportData.totalCount, '🧾 إجمالي حركات الاشتراك'),
      tile('ok', `${reportData.newCount} (${fmtMoney(reportData.newRevenue)} ج.م)`, '🟢 اشتراكات جديدة'),
      tile('', `${reportData.renewCount} (${fmtMoney(reportData.renewRevenue)} ج.م)`, '🔄 تجديد اشتراك'),
      tile('info', `${reportData.attendanceCount} زيارة`, '🏋️‍♂️ حضور الأعضاء اليوم')
    );
  }

  function renderTable() {
    if (!reportData) return;
    const rows = (reportData.list || []).filter((r) => {
      if (typeFilter === 'new' && r.type !== 'new') return false;
      if (typeFilter === 'renew' && r.type !== 'renew') return false;
      if (q) {
        const text = `${r.member_name} ${r.member_code} ${r.member_phone} ${r.plan_name}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });

    const totalFilteredCash = rows.reduce((acc, r) => (r.status !== 'cancelled' ? acc + (Number(r.price) || 0) : acc), 0);

    const tbody = h('tbody');
    if (!rows.length) {
      tbody.append(
        h(
          'tr',
          null,
          h(
            'td',
            { class: 'empty', colspan: 10 },
            reportData.list.length === 0
              ? 'مفيش أي اشتراكات أو تجديدات مسجلة في هذا اليوم.'
              : 'لا توجد نتائج مطابقة للبحث أو التصفية.'
          )
        )
      );
    } else {
      rows.forEach((r, idx) => {
        const isCancelled = r.status === 'cancelled';
        const typeBadge =
          r.type === 'new'
            ? h('span', { class: 'badge sub-new' }, '🟢 جديد')
            : h('span', { class: 'badge sub-renew' }, '🔄 تجديد');

        const statusBadge = isCancelled
          ? h('span', { class: 'badge sub-cancelled' }, 'ملغي')
          : h('span', { class: 'badge active' }, 'ساري');

        const tr = h(
          'tr',
          {
            style: isCancelled ? 'opacity:0.6;' : '',
          },
          h('td', { class: 'muted' }, String(idx + 1)),
          h('td', null, r.time || '-'),
          h('td', { class: 'mono', style: 'font-weight:bold;color:#ffd778' }, r.member_code),
          h(
            'td',
            null,
            h(
              'a',
              {
                href: `#/members/${r.member_id}`,
                style: 'font-weight:700;color:#fff;',
                title: 'فتح ملف العضو',
              },
              r.member_name
            )
          ),
          h(
            'td',
            { class: 'ltr' },
            r.member_phone
              ? h(
                  'a',
                  {
                    href: `https://wa.me/${formatWhatsAppPhone(r.member_phone)}`,
                    target: '_blank',
                    rel: 'noopener',
                    style: 'color:#cbd5e1;font-size:0.9rem',
                    title: 'مراسلة عبر واتساب',
                  },
                  r.member_phone
                )
              : '-'
          ),
          h('td', null, typeBadge),
          h('td', { style: 'font-weight:600' }, r.plan_name),
          h('td', { class: 'muted', style: 'font-size:0.85rem' }, `${ltr(r.start_date)} إلى ${ltr(r.end_date)}`),
          h(
            'td',
            { style: 'font-weight:800;color:#ffd778;font-size:1.05rem' },
            `${fmtMoney(r.price)} ج.م`
          ),
          h('td', null, statusBadge)
        );
        tbody.append(tr);
      });
    }

    const tfoot = h(
      'tfoot',
      null,
      h(
        'tr',
        { style: 'background:#181c28;border-top:2px solid var(--brand);font-weight:800;font-size:1rem;' },
        h('td', { colspan: 5, style: 'color:#fff;' }, `عدد العمليات المعروضة: ${rows.length}`),
        h('td', { colspan: 3, style: 'text-align:end;color:#cbd5e1;' }, 'إجمالي المبلغ المعروض:'),
        h('td', { colspan: 2, style: 'color:#ffd778;font-size:1.15rem;' }, `${fmtMoney(totalFilteredCash)} ج.م`)
      )
    );

    tableWrap.replaceChildren(
      h(
        'table',
        null,
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            h('th', { style: 'width:40px' }, '#'),
            h('th', null, 'الوقت'),
            h('th', null, 'كود العضو'),
            h('th', null, 'اسم المشترك'),
            h('th', null, 'رقم الموبايل'),
            h('th', null, 'نوع الحركة'),
            h('th', null, 'الباقة'),
            h('th', null, 'المدة'),
            h('th', null, 'المبلغ المدفوع'),
            h('th', null, 'الحالة')
          )
        ),
        tbody,
        tfoot
      )
    );
  }

  function renderHistory() {
    if (!reportData || !reportData.recentHistory) return;
    const items = reportData.recentHistory.map((item) => {
      const isSel = item.date === selectedDate;
      const isTd = item.date === today;
      const dObj = new Date(item.date + 'T00:00:00Z');
      const dayName = dObj.toLocaleDateString('ar-EG', { weekday: 'short', timeZone: 'UTC' });
      const dateDisplayStr = item.date.slice(5); // MM-DD

      return h(
        'div',
        {
          class: `history-item ${isSel ? 'active' : ''}`,
          onclick: () => setDay(item.date),
          title: `عرض تقرير ${item.date}`,
        },
        h('div', { class: 'd-title' }, isTd ? 'اليوم' : `${dayName} (${dateDisplayStr})`),
        h('div', { class: 'd-rev' }, `${fmtMoney(item.revenue)} ج.م`),
        h('div', { class: 'd-cnt' }, `${item.count} اشتراك`)
      );
    });

    historyCard.replaceChildren(
      h(
        'div',
        { style: 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:6px' },
        h('h2', { style: 'margin:0;' }, '🗓️ سجل تقفيل الوردية للأيام السابقة (آخر أسبوعين)'),
        h('span', { class: 'muted', style: 'font-size:0.85rem' }, 'اضغط على أي يوم لعرض اشتراكاته وإيراده بالكامل')
      ),
      h('div', { class: 'history-grid' }, ...items)
    );
  }

  async function load(day) {
    reportData = await api('GET', `/api/reports/daily?date=${encodeURIComponent(day)}`);
    const dateFormatted = fmtDayArabic(day);
    dateDisplay.textContent = dateFormatted;
    renderPresets();
    renderSummary();
    renderTable();
    renderHistory();
  }

  // ورقة مطبوعة لتقفيل الوردية (تظهر فقط عند الطباعة)
  const printHeader = h(
    'div',
    { class: 'print-only', style: 'margin-bottom:20px;text-align:center;border-bottom:2px solid #000;padding-bottom:12px' },
    h('h1', { style: 'margin:0 0 6px 0;font-size:1.8rem;color:#000' }, `${ME.gymName || 'X GYM'} — تقرير إيراد الوردية اليومي`),
    h('div', { style: 'font-size:1.1rem;font-weight:bold;color:#333' }, `تاريخ اليوم: ${selectedDate} (${fmtDayArabic(selectedDate)})`),
    h('div', { style: 'font-size:0.9rem;color:#666;margin-top:4px' }, `وقت استخراج التقرير: ${new Date().toLocaleString('ar-EG', { timeZone: TZ })}`)
  );

  const printSignatures = h(
    'div',
    { class: 'print-only-flex', style: 'justify-content:space-between;margin-top:40px;padding-top:20px;border-top:1px dashed #444;font-size:1rem;color:#000' },
    h('div', null, h('b', null, 'مسؤول الوردية (الاستقبال):'), ' ................................'),
    h('div', null, h('b', null, 'المشرف / الإدارة:'), ' ................................'),
    h('div', null, h('b', null, 'الخزينة المستلمة:'), ' ................................ ج.م')
  );

  app.replaceChildren(
    printHeader,
    h(
      'div',
      { class: 'page-head no-print' },
      h(
        'div',
        null,
        h('h1', { style: 'display:flex;align-items:center;gap:10px' }, '📊 التقرير اليومي للوردية'),
        h('div', { class: 'muted', style: 'font-size:0.95rem;margin-top:2px' }, 'متابعة كافة الاشتراكات والتجديدات اليومية ومطابقة إيراد الخزينة')
      ),
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn primary',
            onclick: () => window.print(),
          },
          '🖨️ طباعة تقرير الوردية'
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn',
            onclick: () => setDay(selectedDate),
          },
          '🔄 تحديث'
        )
      )
    ),
    h(
      'div',
      { class: 'card no-print', style: 'padding:14px 18px;margin-bottom:16px;' },
      h(
        'div',
        { style: 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px' },
        h('div', { class: 'date-nav' }, h('span', { style: 'font-weight:700' }, 'تاريخ الوردية:'), dateInput, dateDisplay),
        presetContainer
      )
    ),
    summaryBox,
    h(
      'div',
      { class: 'toolbar no-print', style: 'margin-top:20px;margin-bottom:12px' },
      searchInput,
      typeSelect
    ),
    tableWrap,
    printSignatures,
    historyCard
  );

  await load(selectedDate);
}

// ---------- الباقات (للمدير) ----------
async function pagePlans() {
  if (ME.role !== 'admin') {
    app.replaceChildren(h('div', { class: 'alert bad' }, 'الصفحة دي للمدير فقط'));
    return;
  }
  const plans = await api('GET', '/api/plans?all=1');
  app.replaceChildren(
    h('div', { class: 'page-head' }, h('h1', null, 'الباقات'), h('button', { class: 'btn primary', onclick: () => planModal(null) }, '+ باقة جديدة')),
    h(
      'div',
      { class: 'card table-wrap' },
      h(
        'table',
        null,
        h('thead', null, h('tr', null, ['الباقة', 'المدة (يوم)', 'السعر', 'الحالة', ''].map((t) => h('th', null, t)))),
        h(
          'tbody',
          null,
          plans.map((p) =>
            h(
              'tr',
              null,
              h('td', null, p.name),
              h('td', null, p.duration_days),
              h('td', null, fmtMoney(p.price)),
              h('td', null, p.active ? badge('active', 'متاحة') : badge('cancelled', 'مخفية')),
              h('td', null, h('button', { class: 'btn small', onclick: () => planModal(p) }, 'تعديل'))
            )
          )
        )
      )
    )
  );
}

function planModal(p) {
  openModal(
    p ? 'تعديل الباقة' : 'باقة جديدة',
    [
      field('اسم الباقة', h('input', { name: 'name', required: true, maxlength: 60, value: p ? p.name : '' })),
      h('div', { class: 'row' }, field('المدة بالأيام', h('input', { name: 'duration_days', type: 'number', min: 1, max: 3650, required: true, value: p ? p.duration_days : 30 })), field('السعر', h('input', { name: 'price', type: 'number', min: 0, step: '0.01', required: true, value: p ? p.price : 0 }))),
      p && h('div', { class: 'field' }, h('label', null, h('input', { type: 'checkbox', name: 'active', style: 'width:auto;margin-inline-end:8px', checked: !!p.active }), 'متاحة للاشتراك')),
      h('div', { class: 'muted', style: 'font-size:.9rem' }, 'تعديل السعر أو المدة لا يؤثر على الاشتراكات المسجلة قبل كده.'),
    ],
    async (fd) => {
      const body = { name: fd.get('name'), duration_days: Number(fd.get('duration_days')), price: Number(fd.get('price')) };
      if (p) {
        body.active = fd.get('active') === 'on';
        await api('PUT', `/api/plans/${p.id}`, body);
      } else await api('POST', '/api/plans', body);
      toast('تم الحفظ');
      route();
    }
  );
}

// ---------- صفحة الإشعارات وتنبيهات الواتساب ----------
async function pageReminders() {
  if (ME.role !== 'admin') {
    app.replaceChildren(h('div', { class: 'alert bad' }, 'هذه الصفحة للمدير فقط'));
    return;
  }

  const [data, settings] = await Promise.all([
    api('GET', '/api/reminders/expiring'),
    api('GET', '/api/settings'),
  ]);

  let editingTemplate = data.template || '';
  let editingDays = settings.remind_days || '3';

  const tableBox = h('div', { class: 'table-wrap' });

  function buildReminderTable(list, template, gymName) {
    if (!list.length) {
      tableBox.replaceChildren(h('div', { class: 'empty' }, 'لا يوجد أعضاء اشتراكاتهم على وشك الانتهاء'));
      return;
    }
    tableBox.replaceChildren(
      h(
        'table',
        null,
        h(
          'thead', null,
          h('tr', null,
            h('th', null, 'كود'),
            h('th', null, 'الاسم'),
            h('th', null, 'الموبايل'),
            h('th', null, 'الباقة'),
            h('th', null, 'ينتهي في'),
            h('th', null, 'المتبقي'),
            h('th', null, 'آخر تذكير'),
            h('th', null, 'إجراء')
          )
        ),
        h('tbody', null,
          ...list.map((m) => {
            const daysStr = m.days_left === null ? '-' : m.days_left === 0 ? 'النهارده' : m.days_left > 0 ? `${m.days_left} يوم` : `منتهي منذ ${Math.abs(m.days_left)} يوم`;
            const phone = m.phone || '';

            function makeWhatsAppMsg() {
              const days = m.days_left;
              let dStr = `${days} يوم`;
              if (days === 0) dStr = 'اليوم';
              else if (days === 1) dStr = 'غداً';
              else if (days === 2) dStr = 'يومين';
              else if (days < 0) dStr = `منتهي منذ ${Math.abs(days)} يوم`;
              const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
              const cardUrl = isLocal ? '' : `${location.origin}/card.html?code=${encodeURIComponent(m.code)}`;
              let resMsg = (template || '')
                .replace(/{name}/g, m.name)
                .replace(/{code}/g, m.code)
                .replace(/{gym}/g, gymName)
                .replace(/{plan}/g, m.plan_name)
                .replace(/{end_date}/g, m.end_date || '-')
                .replace(/{days_left}/g, dStr);
              if (cardUrl) {
                resMsg = resMsg.replace(/{card_url}/g, cardUrl);
              } else {
                resMsg = resMsg.replace(/\n?📲 كارت العضوية والبار كود الخاص بك:\n?{card_url}/g, '').replace(/{card_url}/g, '');
              }
              return resMsg;
            }

            async function logAndMark(btn) {
              try {
                await api('POST', '/api/reminders/log', { member_id: m.id });
                btn.textContent = '✅ تم التسجيل';
                btn.disabled = true;
                toast(`تم تسجيل إرسال التذكير لـ ${m.name}`);
              } catch (e) {
                toast(e.message, true);
              }
            }

            const waBtn = h(
              'button',
              {
                class: 'btn whatsapp',
                style: 'font-size:0.8rem;padding:4px 10px;margin-inline-end:4px',
                onclick: async (e) => {
                  if (!phone) { toast('العضو ليس له رقم موبايل', true); return; }
                  let p = phone.replace(/[\s\-\(\)\+]/g, '');
                  if (p.startsWith('00')) p = p.slice(2);
                  if (/^01[0125]\d{8}$/.test(p)) p = '2' + p;
                  const msg = makeWhatsAppMsg();
                  window.open(`https://wa.me/${p}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
                  await logAndMark(e.currentTarget);
                }
              },
              m.remindedToday ? '✅ تم اليوم' : '💬 واتساب'
            );
            if (m.remindedToday) waBtn.disabled = true;

            const previewBtn = h(
              'button',
              {
                class: 'btn',
                style: 'font-size:0.8rem;padding:4px 8px',
                onclick: () => {
                  const msg = makeWhatsAppMsg();
                  openModal(`معاينة رسالة ${m.name}`,
                    [h('pre', { style: 'white-space:pre-wrap;font-size:0.85rem;direction:rtl;text-align:right;background:#141724;color:#f1f5f9;padding:14px;border-radius:10px;border:1px solid rgba(229,169,60,0.25);max-height:320px;overflow-y:auto' }, msg)],
                    async () => {}, 'إغلاق'
                  );
                }
              }, '👁️ معاينة'
            );

            return h('tr', null,
              h('td', { class: 'mono' }, m.code),
              h('td', { class: 'clickable', onclick: () => (location.hash = `#/members/${m.id}`) }, h('b', { style: 'color:var(--brand-light)' }, m.name)),
              h('td', { class: 'ltr' }, phone || '-'),
              h('td', null, m.plan_name),
              h('td', null, m.end_date ? ltr(m.end_date) : '-'),
              h('td', null, h('b', { style: m.days_left <= 0 ? 'color:#f87171' : m.days_left <= 2 ? 'color:#fbbf24' : 'color:#4ade80' }, daysStr)),
              h('td', { class: 'muted', style: 'font-size:0.8rem' }, m.lastReminder ? fmtDateTime(m.lastReminder.sent_at) : '-'),
              h('td', null, waBtn, previewBtn)
            );
          })
        )
      )
    );
  }

  buildReminderTable(data.list, data.template, data.gymName);

  const templateBox = h('textarea', { rows: 9, style: 'font-size:0.88rem;resize:vertical;direction:rtl;text-align:right;width:100%' }, editingTemplate);
  const daysInput = h('input', { type: 'number', min: 1, max: 30, value: editingDays, style: 'max-width:90px' });

  const saveSettingsBtn = h('button', { class: 'btn primary', onclick: async () => {
    try {
      await api('POST', '/api/settings', {
        remind_days: daysInput.value,
        remind_template: templateBox.value,
      });
      toast('تم حفظ إعدادات الرسائل بنجاح');
      route();
    } catch (e) { toast(e.message, true); }
  }}, '💾 حفظ إعدادات التذكير');

  app.replaceChildren(
    h('div', { class: 'page-head' },
      h('h1', null, '🔔 إشعارات تجديد الاشتراكات')
    ),
    h('div', { class: 'alert warn', style: 'margin-bottom:14px' },
      `📋 قائمة الأعضاء الذين اشتراكاتهم ستنتهي خلال ${data.daysAhead} يوم أو انتهت مؤخراً (${data.list.length} عضو)`
    ),
    h('div', { class: 'card table-wrap', style: 'margin-bottom:18px' }, tableBox),

    h('div', { class: 'card' },
      h('h2', null, '⚙️ إعدادات قالب رسالة التذكير'),
      h('div', { class: 'row', style: 'margin-bottom:14px;align-items:center;gap:12px' },
        h('label', { style: 'font-weight:600' }, 'التذكير قبل الانتهاء بـ:'),
        daysInput,
        h('span', { class: 'muted' }, 'يوم')
      ),
      field('نص الرسالة (يمكنك استخدام {name} {gym} {plan} {end_date} {days_left} {card_url})', templateBox),
      h('div', { class: 'actions', style: 'margin-top:16px' }, saveSettingsBtn)
    )
  );
}

// ---------- صفحة الإعدادات وتغيير كلمات المرور ----------
async function pageSettings() {
  if (ME.role !== 'admin') {
    app.replaceChildren(h('div', { class: 'alert bad' }, 'هذه الصفحة للمدير فقط'));
    return;
  }

  const settings = await api('GET', '/api/settings');

  // كارت تغيير باسوورد المدير (Admin)
  const adminCurrentPw = h('input', {
    type: 'password',
    placeholder: 'كلمة المرور الحالية للمدير',
    autocomplete: 'current-password',
    style: 'direction:ltr',
  });
  const adminNewPw = h('input', {
    type: 'password',
    placeholder: 'كلمة المرور الجديدة للمدير (4 خانات فأكثر)',
    autocomplete: 'new-password',
    style: 'direction:ltr',
  });
  const adminConfirmPw = h('input', {
    type: 'password',
    placeholder: 'تأكيد كلمة المرور الجديدة',
    autocomplete: 'new-password',
    style: 'direction:ltr',
  });

  const showAdminPwCheck = h('input', {
    type: 'checkbox',
    id: 'show-admin-pw',
    style: 'width:auto;margin:0',
  });
  showAdminPwCheck.addEventListener('change', () => {
    const t = showAdminPwCheck.checked ? 'text' : 'password';
    adminCurrentPw.type = t;
    adminNewPw.type = t;
    adminConfirmPw.type = t;
  });

  const adminErr = h('div', { class: 'alert bad', hidden: true, style: 'margin-top:10px' });
  const adminSuccess = h('div', { class: 'alert ok', hidden: true, style: 'margin-top:10px' });
  const changeAdminBtn = h('button', { class: 'btn primary' }, '💾 حفظ كلمة مرور المدير');

  changeAdminBtn.addEventListener('click', async () => {
    adminErr.hidden = true;
    adminSuccess.hidden = true;
    const current = adminCurrentPw.value;
    const next = adminNewPw.value.trim();
    const confirm = adminConfirmPw.value.trim();

    if (!current) {
      adminErr.textContent = 'يرجى إدخال كلمة المرور الحالية للمدير';
      adminErr.hidden = false;
      adminCurrentPw.focus();
      return;
    }
    if (!next || next.length < 4) {
      adminErr.textContent = 'كلمة المرور الجديدة يجب ألا تقل عن 4 خانات';
      adminErr.hidden = false;
      adminNewPw.focus();
      return;
    }
    if (next !== confirm) {
      adminErr.textContent = 'كلمة المرور الجديدة وتأكيدها غير متطابقين';
      adminErr.hidden = false;
      adminConfirmPw.focus();
      return;
    }
    changeAdminBtn.disabled = true;
    try {
      const res = await api('POST', '/api/settings/change-admin-password', {
        currentPassword: current,
        newPassword: next,
      });
      adminSuccess.textContent = res.message || 'تم تحديث كلمة مرور المدير بنجاح';
      adminSuccess.hidden = false;
      adminCurrentPw.value = '';
      adminNewPw.value = '';
      adminConfirmPw.value = '';
      toast('تم تحديث كلمة مرور المدير بنجاح');
      ME = await api('GET', '/api/me');
    } catch (e) {
      adminErr.textContent = e.message;
      adminErr.hidden = false;
    } finally {
      changeAdminBtn.disabled = false;
    }
  });

  const adminCard = h('div', { class: 'card', style: 'margin-bottom:20px' },
    h('h2', null, '🛡️ تغيير كلمة مرور المدير (Admin)'),
    h('p', { class: 'muted', style: 'font-size:0.9rem;margin-bottom:14px' },
      'تمنحك هذه الكلمة صلاحيات الإدارة الكاملة (حذف وتعديل الأعضاء والاشتراكات، إدارة الأسعار والباقات، والوصول لكافة الإعدادات).'
    ),
    h('div', { class: 'row', style: 'align-items:flex-end;gap:12px;margin-bottom:8px' },
      field('كلمة المرور الحالية', adminCurrentPw),
      field('كلمة المرور الجديدة', adminNewPw),
      field('تأكيد الكلمة الجديدة', adminConfirmPw)
    ),
    h('div', { style: 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-top:8px' },
      h('label', { for: 'show-admin-pw', style: 'cursor:pointer;font-weight:normal;font-size:0.85rem;display:inline-flex;align-items:center;gap:6px;user-select:none;margin:0' },
        showAdminPwCheck,
        'إظهار كلمات المرور'
      ),
      changeAdminBtn
    ),
    adminErr,
    adminSuccess
  );

  // كارت تغيير باسوورد الموظف
  const staffPwInput = h('input', {
    type: 'text',
    placeholder: 'أدخل كلمة مرور جديدة للموظف (مثال: staff2026)',
    autocomplete: 'new-password',
    style: 'direction:ltr',
  });
  const staffErr = h('div', { class: 'alert bad', hidden: true, style: 'margin-top:10px' });
  const staffSuccess = h('div', { class: 'alert ok', hidden: true, style: 'margin-top:10px' });
  const changeStaffBtn = h('button', { class: 'btn primary' }, '💾 حفظ كلمة مرور الموظف');

  changeStaffBtn.addEventListener('click', async () => {
    staffErr.hidden = true;
    staffSuccess.hidden = true;
    const val = staffPwInput.value.trim();
    if (!val || val.length < 4) {
      staffErr.textContent = 'كلمة المرور يجب ألا تقل عن 4 خانات';
      staffErr.hidden = false;
      return;
    }
    changeStaffBtn.disabled = true;
    try {
      const res = await api('POST', '/api/settings/change-staff-password', { newPassword: val });
      staffSuccess.textContent = res.message || 'تم تحديث كلمة المرور بنجاح';
      staffSuccess.hidden = false;
      staffPwInput.value = '';
      toast('تم تحديث كلمة مرور الموظفين بنجاح');
      ME = await api('GET', '/api/me');
    } catch (e) {
      staffErr.textContent = e.message;
      staffErr.hidden = false;
    } finally {
      changeStaffBtn.disabled = false;
    }
  });

  const staffCard = h('div', { class: 'card', style: 'margin-bottom:20px' },
    h('h2', null, '🔑 تغيير كلمة مرور الموظفين (Staff)'),
    h('p', { class: 'muted', style: 'font-size:0.9rem;margin-bottom:14px' },
      'تُستخدم هذه الكلمة لتسجيل دخول موظفي الاستقبال (صلاحيات تسجيل الحضور، إضافة الأعضاء والاشتراكات، دون صلاحية حذف الأعضاء أو تعديل الأسعار أو تغيير كلمات المرور).'
    ),
    h('div', { class: 'row', style: 'align-items:flex-end;gap:12px' },
      field('كلمة المرور الجديدة للموظف', staffPwInput),
      h('div', { class: 'field' }, changeStaffBtn)
    ),
    staffErr,
    staffSuccess
  );

  // كارت معلومات النظام والحالة
  const infoCard = h('div', {
    class: 'card',
    style: 'background:linear-gradient(135deg, rgba(20,24,35,0.95) 0%, rgba(14,16,24,0.95) 100%);border:1.5px solid rgba(229,169,60,0.35);box-shadow:0 8px 24px rgba(0,0,0,0.4);border-radius:14px;padding:22px;margin-bottom:20px;'
  },
    h('h3', { style: 'color:#ffd778;display:flex;align-items:center;gap:8px;margin-bottom:14px;font-size:1.15rem;font-weight:800;' },
      '🛡️ معلومات الأمان وكلمات المرور'
    ),
    h('ul', { style: 'margin:0;padding-inline-start:24px;font-size:0.95rem;line-height:2.2;color:#cbd5e1;' },
      h('li', null,
        'كلمة المرور الافتراضية للمدير هي: ',
        h('code', { style: 'background:rgba(229,169,60,0.15);color:#ffd778;border:1px solid rgba(229,169,60,0.35);padding:2px 8px;border-radius:6px;font-weight:bold;font-family:Consolas,monospace;' }, 'admin123'),
        ' وكلمة مرور الموظف هي: ',
        h('code', { style: 'background:rgba(229,169,60,0.15);color:#ffd778;border:1px solid rgba(229,169,60,0.35);padding:2px 8px;border-radius:6px;font-weight:bold;font-family:Consolas,monospace;' }, 'staff123')
      ),
      h('li', null, 'عند تعديل أي كلمة مرور، تُحفظ تلقائياً في قاعدة البيانات بشكل دائم ولا تتأثر بإعادة تشغيل الجهاز أو السيرفر.'),
      h('li', null, 'تأكد من حفظ كلمة مرور المدير الجديدة في مكان آمن لضمان عدم فقدان صلاحيات الإدارة.'),
      h('li', null, 'حساب الموظف (Staff) يتيح تسجيل الحضور وإضافة الأعضاء والاشتراكات، دون صلاحية حذف البيانات أو تعديل الأسعار أو تغيير كلمات المرور.')
    )
  );

  // كارت النسخ الاحتياطي وحماية البيانات
  const backupCard = h('div', { class: 'card', style: 'margin-bottom:20px;' });
  async function renderBackupSection() {
    try {
      const status = await api('GET', '/api/backup/status');
      const backupBtn = h('button', { class: 'btn primary' }, '⚡ أخذ نسخة احتياطية الآن');
      const downloadBtn = h('a', { class: 'btn', href: '/api/backup/download', target: '_blank', download: '' }, '💾 تحميل نسخة لجهازك / فلاشة');
      const restoreInput = h('input', { type: 'file', accept: '.db,.sqlite', style: 'display:none' });
      const restoreBtn = h('button', { class: 'btn danger' }, '🔄 استرجاع نسخة احتياطية');

      backupBtn.onclick = async () => {
        backupBtn.disabled = true;
        try {
          const res = await api('POST', '/api/backup/now', {});
          toast(res.message || 'تم عمل نسخة احتياطية بنجاح');
          renderBackupSection();
        } catch (e) {
          toast(e.message, true);
        } finally {
          backupBtn.disabled = false;
        }
      };

      restoreBtn.onclick = () => restoreInput.click();

      restoreInput.onchange = async () => {
        const file = restoreInput.files[0];
        if (!file) return;
        if (!confirm(`⚠️ تحذير هـام جداً:\n\nاسترجاع ملف النسخة الاحتياطية (${file.name}) سيستبدل جميع بيانات الجيم الحالية بالبيانات الموجودة في الملف.\n\nهل أنت متأكد من المتابعة والاسترجاع؟`)) {
          restoreInput.value = '';
          return;
        }
        toast('جاري استرجاع قاعدة البيانات...');
        try {
          const buf = await file.arrayBuffer();
          const res = await fetch('/api/backup/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: buf,
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'فشل الاسترجاع');
          alert('✅ ' + (data.message || 'تم استرجاع قاعدة البيانات بنجاح!'));
          location.reload();
        } catch (e) {
          alert('❌ ' + e.message);
        } finally {
          restoreInput.value = '';
        }
      };

      const backupsTable = status.recentBackups && status.recentBackups.length
        ? h('div', { class: 'table-wrap', style: 'margin-top:14px;max-height:220px;overflow-y:auto;' },
            h('table', null,
              h('thead', null,
                h('tr', null,
                  h('th', null, 'اسم النسخة'),
                  h('th', null, 'الحجم'),
                  h('th', null, 'تاريخ ووقت الحفظ')
                )
              ),
              h('tbody', null,
                status.recentBackups.map(b =>
                  h('tr', null,
                    h('td', { class: 'mono', style: 'color:#ffd778;font-size:0.88rem' }, b.name),
                    h('td', null, `${Math.round(b.size / 1024)} كيلوبايت`),
                    h('td', { class: 'muted', style: 'font-size:0.85rem' }, fmtDateTime(b.mtime))
                  )
                )
              )
            )
          )
        : h('div', { class: 'muted', style: 'margin-top:10px;font-size:0.9rem' }, 'لا توجد نسخ احتياطية مسجلة بعد.');

      backupCard.replaceChildren(
        h('h2', { style: 'color:#ffd778;display:flex;align-items:center;gap:8px;' }, '💾 النسخ الاحتياطي وحماية البيانات من الضياع'),
        h('p', { class: 'muted', style: 'font-size:0.92rem;margin-bottom:14px;line-height:1.7' },
          'يقوم السيستم بعمل نسخ احتياطي تلقائي يومياً. لحماية بياناتك من سقوط نسخة الويندوز أو تلف الجهاز، يمكنك تحميل نسخة احتياطية يدوياً بضغطة زر أو حفظها في بارتشن آخر / فلاشة خارجية.'
        ),
        h('div', { class: 'row', style: 'gap:10px;align-items:center;margin-bottom:14px;' },
          backupBtn,
          downloadBtn,
          restoreBtn,
          restoreInput
        ),
        h('div', { style: 'background:rgba(20,24,35,0.7);border:1px solid rgba(229,169,60,0.2);border-radius:10px;padding:12px 16px;margin-bottom:12px;font-size:0.9rem;' },
          h('div', { style: 'margin-bottom:6px' }, h('b', { style: 'color:#cbd5e1' }, '📁 مسار النسخ التلقائي: '), h('code', { class: 'mono', style: 'color:#ffd778' }, status.primaryDir)),
          status.secondaryDir
            ? h('div', null, h('b', { style: 'color:#4ade80' }, '🛡️ مسار الحماية الإضافي (بارتشن آمن): '), h('code', { class: 'mono', style: 'color:#4ade80' }, status.secondaryDir))
            : ''
        ),
        h('h3', { style: 'font-size:0.95rem;margin:14px 0 6px;' }, '🕒 آخر النسخ الاحتياطية المحفوظة تلقائياً:'),
        backupsTable,
        h('div', { style: 'background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);border-radius:10px;padding:12px 16px;margin-top:14px;font-size:0.88rem;color:#bfdbfe;line-height:1.7;' },
          '💡 ', h('b', null, 'نصيحة ذهبية للحفظ السحابي المجاني:'),
          ' يمكنك تثبيت برنامج Google Drive أو OneDrive على الكمبيوتر، وتحديد مجلد النسخ الاحتياطية ليتزامن معه. بذلك سيتم رفع كل نسخة احتياطية تلقائياً وبأمان على حسابك في جوجل دون أي مجهود منك!'
        )
      );
    } catch (e) {
      backupCard.replaceChildren(h('div', { class: 'alert bad' }, 'تعذر تحميل حالة النسخ الاحتياطي: ' + e.message));
    }
  }
  renderBackupSection();

  app.replaceChildren(
    h('div', { class: 'page-head' },
      h('h1', null, '⚙️ الإعدادات وحماية البيانات')
    ),
    backupCard,
    adminCard,
    staffCard,
    infoCard
  );
}

// ---------- الراوتر ----------
async function route() {
  const full = location.hash || '#/';
  const [pathPart, query = ''] = full.split('?');
  renderNav(pathPart);
  try {
    let m;
    if (pathPart === '#/' || pathPart === '#') await pageDashboard();
    else if (pathPart === '#/members') await pageMembers(query);
    else if ((m = pathPart.match(/^#\/members\/(\d+)$/))) await pageMember(m[1]);
    else if (pathPart === '#/attendance') await pageAttendance();
    else if (pathPart === '#/daily-report') await pageDailyReport(query);
    else if (pathPart === '#/plans') await pagePlans();
    else if (pathPart === '#/reminders') await pageReminders();
    else if (pathPart === '#/settings') await pageSettings();
    else app.replaceChildren(h('div', { class: 'empty' }, 'الصفحة غير موجودة'));
  } catch (e) {
    app.replaceChildren(h('div', { class: 'alert bad' }, e.message));
  }
}

(async function init() {
  try {
    ME = await api('GET', '/api/me');
  } catch {
    return; // api() بيحوّل لصفحة الدخول
  }
  if (ME.gymName) {
    document.title = `${ME.gymName} — نظام الإدارة`;
    const brandEl = document.getElementById('brand');
    if (brandEl) {
      brandEl.replaceChildren(
        h('img', { src: '/xgym-logo.jpg', alt: ME.gymName, class: 'brand-logo' }),
        h('span', null, ME.gymName)
      );
    }
  }
  document.getElementById('logout').addEventListener('click', logout);
  window.addEventListener('hashchange', route);
  route();
})();
