'use strict';

const video = document.getElementById('video');
const camMsg = document.getElementById('camMsg');
const guide = document.getElementById('guide');
const resultEl = document.getElementById('result');
const recentEl = document.getElementById('recent');
const codeInput = document.getElementById('code');
const countEl = document.getElementById('count');

let lastCode = '';
let lastAt = 0;
let idleTimer;
let busy = false;
const recent = [];

// ---------- صوت التنبيه ----------
let audioCtx;
function beep(kind) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const tones = kind === 'ok' ? [[880, 0.12]] : kind === 'warn' ? [[620, 0.12], [620, 0.12]] : [[240, 0.18], [240, 0.18]];
    let t = audioCtx.currentTime;
    for (const [freq, dur] of tones) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = freq;
      osc.type = 'square';
      gain.gain.value = 0.08;
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + dur);
      t += dur + 0.08;
    }
  } catch {
    /* الصوت اختياري */
  }
}

// ---------- عرض النتيجة ----------
function showResult(cls, big, sub) {
  resultEl.className = `result ${cls}`;
  resultEl.replaceChildren(h('div', { class: 'big' }, big), sub ? h('div', { class: 'sub' }, sub) : '');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    resultEl.className = 'result';
    resultEl.replaceChildren(h('div', { class: 'big' }, 'جاهز للمسح'), h('div', { class: 'sub' }, 'مرّر البار كود أو اكتب الكود أدناه'));
  }, 7000);
}

function addRecent(ok, name, note) {
  recent.unshift({ ok, name, note, at: new Date().toISOString() });
  recent.length = Math.min(recent.length, 6);
  recentEl.replaceChildren(
    ...recent.map((r) => h('div', { class: `item ${r.ok ? 'ok' : 'denied'}` }, h('span', null, r.name), h('span', { class: 'muted' }, `${r.note} · ${fmtTime(r.at)}`)))
  );
}

async function refreshCount() {
  try {
    const s = await api('GET', '/api/stats');
    countEl.textContent = `حضور النهارده: ${s.todayCount}`;
  } catch {
    /* ignore */
  }
}

async function handleCode(raw) {
  const code = String(raw || '').trim();
  if (!code || busy) return;
  const now = Date.now();
  if (code === lastCode && now - lastAt < 4000) return; // تجاهل التكرار السريع من الكاميرا
  lastCode = code;
  lastAt = now;
  busy = true;
  try {
    const r = await api('POST', '/api/checkin', { code });
    const name = r.member ? r.member.name : '';
    const planLine = r.sub && r.sub.plan_name ? `${r.sub.plan_name} — ينتهي ${ltr(r.sub.end_date)}${r.sub.days_left >= 0 ? ` (باقي ${r.sub.days_left} يوم)` : ''}` : '';
    if (r.ok && r.duplicate) {
      showResult('warn', `⚠️ تم دخوله اليوم (${name})`, r.message || `حضر اليوم الساعة ${r.time}`);
      beep('warn');
      addRecent(true, name, `تم دخوله (${r.time || 'اليوم'})`);
    } else if (r.ok) {
      showResult(r.warning ? 'warn' : 'ok', `أهلاً ${name}`, [planLine, r.warning].filter(Boolean).join(' · '));
      beep('ok');
      addRecent(true, name, 'دخول');
      refreshCount();
    } else {
      showResult('bad', name ? `${name} — ممنوع الدخول` : 'كود غير معروف', name ? r.message : 'اتأكد من الكارت أو اكتب الكود تاني');
      beep('denied');
      addRecent(false, name || code, REASON_LABEL[r.reason] || 'مرفوض');
    }
  } catch (e) {
    showResult('bad', 'حصل خطأ', e.message);
    beep('denied');
  } finally {
    busy = false;
  }
}

// ---------- الإدخال اليدوي / قارئ الباركود ----------
document.getElementById('manual').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = codeInput.value;
  codeInput.value = '';
  lastCode = ''; // الإدخال اليدوي مقصود، منعمل عليه تجاهل للتكرار
  handleCode(v);
  codeInput.focus();
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('a, button')) codeInput.focus();
});

// ---------- الكاميرا ----------
async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    camMsg.textContent = 'الكاميرا محتاجة اتصال آمن (HTTPS) أو فتح الصفحة من نفس الجهاز على localhost. تقدر تستخدم قارئ باركود أو تكتب الكود تحت.';
    return;
  }
  if (!('BarcodeDetector' in window)) {
    camMsg.textContent = 'المتصفح ده مابيدعمش قراءة الباركود بالكاميرا. استخدم Chrome على أندرويد/ويندوز، أو قارئ باركود USB، أو اكتب الكود تحت.';
    return;
  }
  let detector;
  try {
    // نجرب Code128 أولا، وإذا ماشتغلش نرجع للصيغتين الممكنتين
    try {
      detector = new BarcodeDetector({ formats: ['code_128', 'code_39'] });
    } catch {
      detector = new BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39'] });
    }
  } catch {
    camMsg.textContent = 'قراءة الباركود مش متاحة على الجهاز ده. استخدم قارئ باركود USB أو اكتب الكود تحت.';
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    camMsg.hidden = true;
    guide.hidden = false;
  } catch (e) {
    camMsg.textContent = e && e.name === 'NotAllowedError' ? 'اسمح للمتصفح باستخدام الكاميرا ثم أعد تحميل الصفحة.' : 'تعذر تشغيل الكاميرا. تقدر تكتب الكود يدويًا.';
    return;
  }
  const loop = async () => {
    if (video.readyState >= 2 && !busy) {
      try {
        const codes = await detector.detect(video);
        if (codes.length) await handleCode(codes[0].rawValue);
      } catch {
        /* تجاهل أخطاء الإطار الواحد */
      }
    }
    setTimeout(loop, 250);
  };
  loop();
}

(async function init() {
  try {
    const me = await api('GET', '/api/me');
    if (me.gymName) document.getElementById('gym').textContent = me.gymName;
  } catch {
    return;
  }
  refreshCount();
  startCamera();
})();
