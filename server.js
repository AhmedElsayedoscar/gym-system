'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, DATA_DIR } = require('./db');
const { toSvg } = require('./qr');

// ---------- الإعدادات ----------
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const TZ = process.env.TZ_NAME || 'Africa/Cairo';
const GYM_NAME = process.env.GYM_NAME || 'الجيم';
const SESSION_HOURS = 12;
const DUPLICATE_WINDOW_MIN = 5; // تجاهل تكرار المسح لنفس العضو خلال هذه المدة
const EXPIRING_DAYS = 7;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

function getStaffPassword() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('staff_password');
  return (row && row.value) || process.env.STAFF_PASSWORD || 'staff123';
}

// مفتاح توقيع الجلسات (يتولد مرة واحدة ويتخزن)
const SECRET_FILE = path.join(DATA_DIR, 'session.key');
let SECRET;
if (process.env.SESSION_SECRET) SECRET = process.env.SESSION_SECRET;
else if (fs.existsSync(SECRET_FILE)) SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();
else {
  SECRET = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, SECRET, { mode: 0o600 });
}

// ---------- أدوات التاريخ ----------
function todayStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function validDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}
function addDays(s, n) {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function diffDays(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}
function formatTimeInZone(iso) {
  try {
    return new Date(iso).toLocaleTimeString('ar-EG-u-nu-latn', {
      timeZone: TZ,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return new Date(iso).toISOString().slice(11, 16);
  }
}

// ---------- أخطاء وردود ----------
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
function sendJson(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

// ---------- الجلسات ----------
function sign(payload) {
  const b = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
  return `${b}.${mac}`;
}
function verify(token) {
  if (typeof token !== 'string') return null;
  const [b, mac] = token.split('.');
  if (!b || !mac) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
  const a = Buffer.from(mac);
  const e = Buffer.from(expected);
  if (a.length !== e.length || !crypto.timingSafeEqual(a, e)) return null;
  try {
    const p = JSON.parse(Buffer.from(b, 'base64url').toString());
    if (!p.exp || p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// حماية بسيطة ضد تخمين كلمة المرور
const failures = new Map(); // ip -> {count, until}
function checkLoginAllowed(ip) {
  const f = failures.get(ip);
  if (f && f.until > Date.now() && f.count >= 5) {
    throw new ApiError(429, 'محاولات كتير غلط. استنى شوية وجرب تاني');
  }
}
function recordFailure(ip) {
  const f = failures.get(ip);
  if (!f || f.until < Date.now()) failures.set(ip, { count: 1, until: Date.now() + 10 * 60000 });
  else f.count++;
}

// ---------- منطق الأعضاء والاشتراكات ----------
function newMemberCode() {
  const rows = db.prepare('SELECT code FROM members').all();
  let max = 1000;
  for (const r of rows) {
    if (/^\d+$/.test(r.code)) {
      const n = parseInt(r.code, 10);
      if (n > max && n < 1000000000) max = n;
    }
  }
  let next = max + 1;
  while (db.prepare('SELECT 1 FROM members WHERE code = ?').get(String(next))) {
    next++;
  }
  return String(next);
}

function cleanMemberCode(val, required = false) {
  if (val === undefined || val === null || val === '') {
    if (required) throw new ApiError(400, 'كود العضو مطلوب');
    return null;
  }
  const s = String(val).trim();
  if (!/^\d+$/.test(s)) {
    throw new ApiError(400, 'كود العضو يجب أن يتكون من أرقام فقط');
  }
  if (s.length > 20) throw new ApiError(400, 'كود العضو طويل جداً (الحد الأقصى 20 رقماً)');
  return s;
}

function subscriptionState(memberId, today) {
  const covering = db
    .prepare(
      `SELECT * FROM subscriptions WHERE member_id = ? AND status = 'active'
       AND start_date <= ? AND end_date >= ? ORDER BY end_date DESC LIMIT 1`
    )
    .get(memberId, today, today);
  const last = db
    .prepare(`SELECT MAX(end_date) AS e FROM subscriptions WHERE member_id = ? AND status = 'active'`)
    .get(memberId).e;
  if (covering) {
    const daysLeft = diffDays(today, last);
    return {
      state: daysLeft <= EXPIRING_DAYS ? 'expiring' : 'active',
      plan_name: covering.plan_name,
      end_date: last,
      days_left: daysLeft,
    };
  }
  if (!last) return { state: 'none', plan_name: null, end_date: null, days_left: null };
  if (last < today) return { state: 'expired', plan_name: null, end_date: last, days_left: diffDays(today, last) };
  return { state: 'upcoming', plan_name: null, end_date: last, days_left: null };
}

function memberView(m, today) {
  return { ...m, active: !!m.active, sub: subscriptionState(m.id, today) };
}

function createSubscription(memberId, planId, startDate, priceOverride) {
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(planId);
  if (!plan) throw new ApiError(400, 'الباقة غير موجودة');
  const today = todayStr();
  let start = startDate;
  if (start !== undefined && start !== null && start !== '') {
    if (!validDate(start)) throw new ApiError(400, 'تاريخ البداية غير صحيح');
  } else {
    // تجديد: لو فيه اشتراك ساري يبدأ الجديد بعد نهايته، غير كده يبدأ النهارده
    const last = db
      .prepare(`SELECT MAX(end_date) AS e FROM subscriptions WHERE member_id = ? AND status = 'active'`)
      .get(memberId).e;
    start = last && last >= today ? addDays(last, 1) : today;
  }
  const end = addDays(start, plan.duration_days - 1);
  let price = plan.price;
  if (priceOverride !== undefined && priceOverride !== null && priceOverride !== '') {
    price = Number(priceOverride);
    if (!Number.isFinite(price) || price < 0) throw new ApiError(400, 'السعر غير صحيح');
  }
  const r = db
    .prepare(
      `INSERT INTO subscriptions (member_id, plan_id, plan_name, start_date, end_date, price, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(memberId, plan.id, plan.name, start, end, price, new Date().toISOString());
  return Number(r.lastInsertRowid);
}

function cleanStr(v, max, field, required = false) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new ApiError(400, `${field} مطلوب`);
  if (s.length > max) throw new ApiError(400, `${field} أطول من المسموح`);
  return s;
}

function doCheckin(rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code || code.length > 40) return { ok: false, reason: 'not_found', message: 'كود غير معروف' };
  const m = db.prepare('SELECT * FROM members WHERE code = ?').get(code);
  if (!m) return { ok: false, reason: 'not_found', message: 'كود غير معروف' };

  const today = todayStr();
  const now = new Date();
  const sub = subscriptionState(m.id, today);
  const base = { member: { id: m.id, name: m.name, phone: m.phone }, sub };
  const log = (result, reason) =>
    db
      .prepare('INSERT INTO attendance (member_id, day, checkin_at, result, reason) VALUES (?, ?, ?, ?, ?)')
      .run(m.id, today, now.toISOString(), result, reason);

  if (!m.active) {
    log('denied', 'inactive');
    return { ok: false, reason: 'inactive', message: 'العضوية موقوفة', ...base };
  }
  if (sub.state === 'none' || sub.state === 'expired' || sub.state === 'upcoming') {
    const message =
      sub.state === 'expired'
        ? `الاشتراك منتهي من ${Math.abs(sub.days_left)} يوم`
        : sub.state === 'upcoming'
          ? 'الاشتراك لسه ما بدأش'
          : 'مفيش اشتراك لهذا العضو';
    log('denied', sub.state);
    return { ok: false, reason: sub.state, message, ...base };
  }

  // فحص هل العضو سجل حضور اليوم بالفعل في أي وقت من نفس اليوم
  const todayCheckin = db
    .prepare(
      `SELECT checkin_at FROM attendance WHERE member_id = ? AND day = ? AND result = 'ok' ORDER BY checkin_at ASC LIMIT 1`
    )
    .get(m.id, today);

  if (todayCheckin) {
    const timeFormatted = formatTimeInZone(todayCheckin.checkin_at);
    return {
      ok: true,
      duplicate: true,
      time: timeFormatted,
      firstCheckinAt: todayCheckin.checkin_at,
      message: `تم دخوله اليوم الساعة ${timeFormatted}`,
      ...base,
    };
  }

  log('ok', '');
  const warning = sub.days_left <= 3 ? `الاشتراك ينتهي ${sub.days_left === 0 ? 'النهارده' : `بعد ${sub.days_left} يوم`}` : '';
  return { ok: true, duplicate: false, message: 'أهلاً بيك', warning, ...base };
}

// ---------- المسارات ----------
const routes = [];
function route(method, pattern, role, handler) {
  const keys = [];
  const re = new RegExp(
    '^' + pattern.replace(/:([a-z]+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$'
  );
  routes.push({ method, re, keys, role, handler });
}
function intParam(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(400, 'معرّف غير صحيح');
  return n;
}

route('POST', '/api/login', null, (ctx) => {
  checkLoginAllowed(ctx.ip);
  const pw = typeof ctx.body.password === 'string' ? ctx.body.password : '';
  let role = null;
  if (safeEqual(pw, ADMIN_PASSWORD)) role = 'admin';
  else if (safeEqual(pw, getStaffPassword())) role = 'staff';
  if (!role) {
    recordFailure(ctx.ip);
    throw new ApiError(401, 'كلمة المرور غلط');
  }
  failures.delete(ctx.ip);
  const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
  const secure = ctx.req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return {
    body: { ok: true, role },
    headers: {
      'Set-Cookie': `sid=${sign({ role, exp })}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}${secure}`,
    },
  };
});

route('POST', '/api/logout', null, () => ({
  body: { ok: true },
  headers: { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' },
}));

route('GET', '/api/me', 'staff', (ctx) => {
  const isDefaultStaff = getStaffPassword() === 'staff123';
  return {
    role: ctx.session.role,
    gymName: GYM_NAME,
    defaultPasswords: ctx.session.role === 'admin' ? isDefaultStaff : false,
  };
});

route('GET', '/api/stats', 'staff', () => {
  const today = todayStr();
  const soon = addDays(today, EXPIRING_DAYS);
  const members = db.prepare('SELECT * FROM members WHERE active = 1').all();
  let active = 0;
  let expiring = 0;
  let expired = 0;
  const expiringList = [];
  for (const m of members) {
    const s = subscriptionState(m.id, today);
    if (s.state === 'active' || s.state === 'expiring') active++;
    if (s.state === 'expiring') {
      expiring++;
      expiringList.push({ id: m.id, name: m.name, phone: m.phone, end_date: s.end_date, days_left: s.days_left });
    }
    if (s.state === 'expired') expired++;
  }
  expiringList.sort((a, b) => a.days_left - b.days_left);
  const todayCount = db
    .prepare(`SELECT COUNT(DISTINCT member_id) AS c FROM attendance WHERE day = ? AND result = 'ok'`)
    .get(today).c;
  const deniedToday = db.prepare(`SELECT COUNT(*) AS c FROM attendance WHERE day = ? AND result = 'denied'`).get(today).c;
  const recent = db
    .prepare(
      `SELECT a.id, a.checkin_at, a.result, a.reason, m.id AS member_id, m.name
       FROM attendance a JOIN members m ON m.id = a.member_id ORDER BY a.id DESC LIMIT 8`
    )
    .all();
  return {
    today,
    totalMembers: members.length,
    active,
    expiring,
    expired,
    todayCount,
    deniedToday,
    expiringList: expiringList.slice(0, 10),
    soon,
    recent,
  };
});

// الباقات
route('GET', '/api/plans', 'staff', (ctx) => {
  const all = ctx.url.searchParams.get('all') === '1' && ctx.session.role === 'admin';
  return db.prepare(`SELECT * FROM plans ${all ? '' : 'WHERE active = 1'} ORDER BY duration_days`).all();
});
route('POST', '/api/plans', 'admin', (ctx) => {
  const name = cleanStr(ctx.body.name, 60, 'اسم الباقة', true);
  const days = Number(ctx.body.duration_days);
  const price = Number(ctx.body.price);
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new ApiError(400, 'المدة بالأيام غير صحيحة');
  if (!Number.isFinite(price) || price < 0) throw new ApiError(400, 'السعر غير صحيح');
  const r = db.prepare('INSERT INTO plans (name, duration_days, price) VALUES (?, ?, ?)').run(name, days, price);
  return { id: Number(r.lastInsertRowid) };
});
route('PUT', '/api/plans/:id', 'admin', (ctx) => {
  const id = intParam(ctx.params.id);
  const old = db.prepare('SELECT * FROM plans WHERE id = ?').get(id);
  if (!old) throw new ApiError(404, 'الباقة غير موجودة');
  const name = cleanStr(ctx.body.name ?? old.name, 60, 'اسم الباقة', true);
  const days = Number(ctx.body.duration_days ?? old.duration_days);
  const price = Number(ctx.body.price ?? old.price);
  const active = ctx.body.active === undefined ? old.active : ctx.body.active ? 1 : 0;
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new ApiError(400, 'المدة بالأيام غير صحيحة');
  if (!Number.isFinite(price) || price < 0) throw new ApiError(400, 'السعر غير صحيح');
  db.prepare('UPDATE plans SET name = ?, duration_days = ?, price = ?, active = ? WHERE id = ?').run(
    name,
    days,
    price,
    active,
    id
  );
  return { ok: true };
});

// الأعضاء
route('GET', '/api/members', 'staff', (ctx) => {
  const today = todayStr();
  const q = (ctx.url.searchParams.get('q') || '').trim();
  const status = ctx.url.searchParams.get('status') || 'all';
  let rows;
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
    rows = db
      .prepare(`SELECT * FROM members WHERE name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\' ORDER BY name LIMIT 500`)
      .all(like, like, like.toUpperCase());
  } else rows = db.prepare('SELECT * FROM members ORDER BY id DESC LIMIT 500').all();
  let list = rows.map((m) => memberView(m, today));
  if (status !== 'all') {
    list = list.filter((m) => (status === 'active' ? m.sub.state === 'active' || m.sub.state === 'expiring' : m.sub.state === status));
  }
  return list;
});

route('POST', '/api/members', 'staff', (ctx) => {
  const name = cleanStr(ctx.body.name, 100, 'الاسم', true);
  const phone = cleanStr(ctx.body.phone, 30, 'رقم الموبايل');
  const notes = cleanStr(ctx.body.notes, 500, 'الملاحظات');
  const planId = ctx.body.plan_id ? intParam(ctx.body.plan_id) : null;
  if (planId && !db.prepare('SELECT 1 FROM plans WHERE id = ? AND active = 1').get(planId)) {
    throw new ApiError(400, 'الباقة غير موجودة');
  }
  const customCode = cleanMemberCode(ctx.body.code, false);
  let code;
  if (customCode) {
    if (db.prepare('SELECT 1 FROM members WHERE code = ?').get(customCode)) {
      throw new ApiError(400, 'كود العضو مستخدم بالفعل لعضو آخر');
    }
    code = customCode;
  } else {
    code = newMemberCode();
  }
  let id;
  db.exec('BEGIN');
  try {
    const r = db
      .prepare('INSERT INTO members (code, name, phone, notes, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(code, name, phone, notes, new Date().toISOString());
    id = Number(r.lastInsertRowid);
    if (planId) createSubscription(id, planId, ctx.body.start_date, ctx.body.price);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { id, code };
});

route('GET', '/api/members/:id', 'staff', (ctx) => {
  const id = intParam(ctx.params.id);
  const m = db.prepare('SELECT * FROM members WHERE id = ?').get(id);
  if (!m) throw new ApiError(404, 'العضو غير موجود');
  const subs = db.prepare('SELECT * FROM subscriptions WHERE member_id = ? ORDER BY start_date DESC, id DESC').all(id);
  const att = db
    .prepare('SELECT id, checkin_at, result, reason FROM attendance WHERE member_id = ? ORDER BY id DESC LIMIT 30')
    .all(id);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM attendance WHERE member_id = ? AND result = 'ok'`).get(id).c;
  return { member: memberView(m, todayStr()), subscriptions: subs, attendance: att, totalVisits: total };
});

route('PUT', '/api/members/:id', 'staff', (ctx) => {
  const id = intParam(ctx.params.id);
  const m = db.prepare('SELECT * FROM members WHERE id = ?').get(id);
  if (!m) throw new ApiError(404, 'العضو غير موجود');
  const name = cleanStr(ctx.body.name ?? m.name, 100, 'الاسم', true);
  const phone = cleanStr(ctx.body.phone ?? m.phone, 30, 'رقم الموبايل');
  const notes = cleanStr(ctx.body.notes ?? m.notes, 500, 'الملاحظات');
  const active = ctx.body.active === undefined ? m.active : ctx.body.active ? 1 : 0;
  let code = m.code;
  if (ctx.body.code !== undefined && ctx.body.code !== '') {
    const customCode = cleanMemberCode(ctx.body.code, true);
    if (customCode !== m.code) {
      if (db.prepare('SELECT 1 FROM members WHERE code = ? AND id != ?').get(customCode, id)) {
        throw new ApiError(400, 'كود العضو مستخدم بالفعل لعضو آخر');
      }
      code = customCode;
    }
  }
  db.prepare('UPDATE members SET code = ?, name = ?, phone = ?, notes = ?, active = ? WHERE id = ?').run(
    code,
    name,
    phone,
    notes,
    active,
    id
  );
  return { ok: true, code };
});

route('DELETE', '/api/members/:id', 'admin', (ctx) => {
  const id = intParam(ctx.params.id);
  db.prepare('DELETE FROM members WHERE id = ?').run(id);
  return { ok: true };
});

route('POST', '/api/members/:id/subscriptions', 'staff', (ctx) => {
  const id = intParam(ctx.params.id);
  if (!db.prepare('SELECT 1 FROM members WHERE id = ?').get(id)) throw new ApiError(404, 'العضو غير موجود');
  const planId = intParam(ctx.body.plan_id);
  const plan = db.prepare('SELECT active FROM plans WHERE id = ?').get(planId);
  if (!plan || !plan.active) throw new ApiError(400, 'الباقة غير موجودة');
  return { id: createSubscription(id, planId, ctx.body.start_date, ctx.body.price) };
});

route('DELETE', '/api/subscriptions/:id', 'admin', (ctx) => {
  const id = intParam(ctx.params.id);
  db.prepare(`UPDATE subscriptions SET status = 'cancelled' WHERE id = ?`).run(id);
  return { ok: true };
});

route('GET', '/api/members/:id/qr.svg', 'staff', (ctx) => {
  const id = intParam(ctx.params.id);
  const m = db.prepare('SELECT code FROM members WHERE id = ?').get(id);
  if (!m) throw new ApiError(404, 'العضو غير موجود');
  return { raw: toSvg(m.code), type: 'image/svg+xml; charset=utf-8' };
});

// المسارات العامة لعرض كارت العضوية والـ QR (متاحة للعضو عبر رابط الواتساب بدون تسجيل دخول)
function findMemberByIdent(ident) {
  const s = String(ident || '').trim();
  let m = db.prepare('SELECT * FROM members WHERE code = ?').get(s);
  if (!m && /^\d+$/.test(s)) {
    m = db.prepare('SELECT * FROM members WHERE id = ?').get(Number(s));
  }
  return m;
}

route('GET', '/api/public/card/:ident', null, (ctx) => {
  const m = findMemberByIdent(ctx.params.ident);
  if (!m) throw new ApiError(404, 'العضو غير موجود');
  const today = todayStr();
  const sub = subscriptionState(m.id, today);
  return {
    gymName: GYM_NAME,
    id: m.id,
    name: m.name,
    code: m.code,
    phone: m.phone,
    active: m.active,
    sub: {
      plan_name: sub.plan_name,
      end_date: sub.end_date,
      days_left: sub.days_left,
      state: m.active ? sub.state : 'inactive',
    },
    qrUrl: `/api/public/card-qr/${encodeURIComponent(m.code)}`,
  };
});

route('GET', '/api/public/card-qr/:ident', null, (ctx) => {
  const m = findMemberByIdent(ctx.params.ident);
  if (!m) throw new ApiError(404, 'العضو غير موجود');
  return { raw: toSvg(m.code), type: 'image/svg+xml; charset=utf-8' };
});

// الحضور
route('POST', '/api/checkin', 'staff', (ctx) => doCheckin(ctx.body.code));

route('GET', '/api/attendance', 'staff', (ctx) => {
  const date = ctx.url.searchParams.get('date');
  const from = ctx.url.searchParams.get('from');
  const to = ctx.url.searchParams.get('to');
  const q = (ctx.url.searchParams.get('q') || '').trim();
  const resFilter = ctx.url.searchParams.get('result') || 'all';
  const memberId = ctx.url.searchParams.get('member_id');

  const conditions = [];
  const params = [];

  if (date) {
    if (!validDate(date)) throw new ApiError(400, 'التاريخ غير صحيح');
    conditions.push('a.day = ?');
    params.push(date);
  } else if (from || to) {
    if (from) {
      if (!validDate(from)) throw new ApiError(400, 'تاريخ البداية غير صحيح');
      conditions.push('a.day >= ?');
      params.push(from);
    }
    if (to) {
      if (!validDate(to)) throw new ApiError(400, 'تاريخ النهاية غير صحيح');
      conditions.push('a.day <= ?');
      params.push(to);
    }
  } else {
    // الافتراضي هو اليوم
    conditions.push('a.day = ?');
    params.push(todayStr());
  }

  if (resFilter === 'ok' || resFilter === 'denied') {
    conditions.push('a.result = ?');
    params.push(resFilter);
  }

  if (memberId) {
    conditions.push('a.member_id = ?');
    params.push(intParam(memberId));
  }

  if (q) {
    const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
    conditions.push(`(m.name LIKE ? ESCAPE '\\' OR m.phone LIKE ? ESCAPE '\\' OR m.code LIKE ? ESCAPE '\\')`);
    params.push(like, like, like);
  }

  const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const sql = `
    SELECT a.id, a.day, a.checkin_at, a.result, a.reason, m.id AS member_id, m.name, m.phone, m.code
    FROM attendance a
    JOIN members m ON m.id = a.member_id
    ${whereClause}
    ORDER BY a.checkin_at DESC, a.id DESC
    LIMIT 2000
  `;
  return db.prepare(sql).all(...params);
});

// تسجيل حضور يدوي لتاريخ سابق أو اليوم
route('POST', '/api/attendance/manual', 'staff', (ctx) => {
  const memberId = intParam(ctx.body.member_id);
  const m = db.prepare('SELECT * FROM members WHERE id = ?').get(memberId);
  if (!m) throw new ApiError(404, 'العضو غير موجود');
  const day = ctx.body.date ? String(ctx.body.date).trim() : todayStr();
  if (!validDate(day)) throw new ApiError(400, 'التاريخ غير صحيح');
  const time = ctx.body.time && /^\d{2}:\d{2}$/.test(ctx.body.time) ? ctx.body.time.trim() : '12:00';
  const checkinAt = `${day}T${time}:00`;
  const r = db
    .prepare('INSERT INTO attendance (member_id, day, checkin_at, result, reason) VALUES (?, ?, ?, ?, ?)')
    .run(m.id, day, new Date(checkinAt).toISOString(), 'ok', 'manual');
  return { ok: true, id: Number(r.lastInsertRowid) };
});

// حذف حركة حضور مسجلة بالخطأ (للمدير)
route('DELETE', '/api/attendance/:id', 'admin', (ctx) => {
  const id = intParam(ctx.params.id);
  db.prepare('DELETE FROM attendance WHERE id = ?').run(id);
  return { ok: true };
});

// ---------- إعدادات النظام وتنبيهات الواتساب ----------
function getSetting(key, fallback = '') {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : fallback;
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?'
  ).run(key, String(value), String(value));
}

function formatReminderMessage(template, member, sub, gymName) {
  const days = sub.days_left;
  let daysStr = `${days} يوم`;
  if (days === 0) daysStr = 'اليوم';
  else if (days === 1) daysStr = 'غداً';
  else if (days === 2) daysStr = 'يومين';
  else if (days < 0) daysStr = `منتهي منذ ${Math.abs(days)} يوم`;

  const origin = process.env.BASE_URL || `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`;
  const cardUrl = `${origin}/card.html?code=${encodeURIComponent(member.code)}`;

  return (template || '')
    .replace(/{name}/g, member.name)
    .replace(/{code}/g, member.code)
    .replace(/{gym}/g, gymName)
    .replace(/{plan}/g, sub.plan_name || 'عضوية')
    .replace(/{end_date}/g, sub.end_date || '')
    .replace(/{days_left}/g, daysStr)
    .replace(/{card_url}/g, cardUrl);
}

async function sendWhatsAppViaGateway(gatewayUrl, token, phone, message) {
  let p = phone.replace(/[\s\-\(\)\+]/g, '');
  if (p.startsWith('00')) p = p.slice(2);
  if (/^01[0125]\d{8}$/.test(p)) p = '2' + p;

  const url = new URL(gatewayUrl);
  const isHttps = url.protocol === 'https:';
  const client = isHttps ? require('https') : require('http');

  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ phone: p, to: p, message, text: message, body: message });
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['x-api-key'] = token;
    }
    const req = client.request(
      url,
      {
        method: 'POST',
        headers,
        timeout: 12000,
      },
      (res) => {
        let resData = '';
        res.on('data', (c) => (resData += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(resData);
          else reject(new Error(`HTTP ${res.statusCode}: ${resData.slice(0, 100)}`));
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('انتهت مهلة الاتصال بالبوابة'));
    });
    req.write(payload);
    req.end();
  });
}

// قائمة الأعضاء للتذكير بالواتساب
route('GET', '/api/reminders/expiring', 'staff', (ctx) => {
  const today = todayStr();
  const daysAhead = Number(ctx.url.searchParams.get('days') || getSetting('remind_days', '3'));
  const members = db.prepare('SELECT * FROM members WHERE active = 1 ORDER BY name').all();
  const list = [];
  for (const m of members) {
    const sub = subscriptionState(m.id, today);
    if ((sub.days_left !== null && sub.days_left >= 0 && sub.days_left <= daysAhead) || (sub.state === 'expired' && sub.days_left >= -3)) {
      const lastRem = db
        .prepare('SELECT * FROM reminders WHERE member_id = ? ORDER BY sent_at DESC LIMIT 1')
        .get(m.id);
      list.push({
        id: m.id,
        code: m.code,
        name: m.name,
        phone: m.phone,
        plan_name: sub.plan_name || 'عضوية',
        end_date: sub.end_date,
        days_left: sub.days_left,
        state: sub.state,
        lastReminder: lastRem || null,
        remindedToday: lastRem ? lastRem.sent_at.slice(0, 10) === today : false,
      });
    }
  }
  list.sort((a, b) => a.days_left - b.days_left);
  return {
    today,
    daysAhead,
    list,
    template: getSetting('remind_template'),
    gymName: GYM_NAME,
    hasGateway: !!getSetting('gateway_url'),
  };
});

// تسجيل إرسال تذكير
route('POST', '/api/reminders/log', 'staff', (ctx) => {
  const memberId = intParam(ctx.body.member_id);
  const m = db.prepare('SELECT * FROM members WHERE id = ?').get(memberId);
  if (!m) throw new ApiError(404, 'العضو غير موجود');
  const today = todayStr();
  const sub = subscriptionState(m.id, today);
  const r = db
    .prepare('INSERT INTO reminders (member_id, sent_at, days_left, phone, status) VALUES (?, ?, ?, ?, ?)')
    .run(m.id, new Date().toISOString(), sub.days_left || 0, m.phone, 'sent');
  return { ok: true, id: Number(r.lastInsertRowid) };
});

// قراءة الإعدادات
route('GET', '/api/settings', 'admin', () => {
  const rows = db.prepare('SELECT * FROM settings').all();
  const obj = {};
  rows.forEach((r) => {
    // عدم إرسال كلمات المرور في رد الـ settings العادي للأمان
    if (r.key !== 'staff_password' && r.key !== 'admin_password') {
      obj[r.key] = r.value;
    }
  });
  obj.hasCustomStaffPassword = !!db.prepare("SELECT 1 FROM settings WHERE key = 'staff_password'").get();
  obj.hasCustomAdminPassword = !!db.prepare("SELECT 1 FROM settings WHERE key = 'admin_password'").get();
  return obj;
});

// حفظ الإعدادات العامة
route('POST', '/api/settings', 'admin', (ctx) => {
  for (const [k, v] of Object.entries(ctx.body)) {
    if (k !== 'staff_password' && k !== 'admin_password') {
      setSetting(k, v);
    }
  }
  return { ok: true };
});

// تغيير كلمة مرور الـ Staff (الموظف)
route('POST', '/api/settings/change-staff-password', 'admin', (ctx) => {
  const newPw = typeof ctx.body.newPassword === 'string' ? ctx.body.newPassword.trim() : '';
  if (!newPw || newPw.length < 4) {
    throw new ApiError(400, 'كلمة المرور يجب ألا تقل عن 4 حروف أو أرقام');
  }
  setSetting('staff_password', newPw);
  return { ok: true, message: 'تم تغيير كلمة مرور الموظفين (Staff) بنجاح' };
});

// دالة الإرسال التلقائي المستقلة
async function runAutomatedReminders() {
  const gatewayUrl = getSetting('gateway_url');
  const token = getSetting('gateway_token');
  if (!gatewayUrl) return { ok: false, reason: 'no_gateway' };

  const today = todayStr();
  const daysAhead = Number(getSetting('remind_days', '3'));
  const template = getSetting('remind_template');
  const members = db.prepare('SELECT * FROM members WHERE active = 1 AND phone != ""').all();
  let sentCount = 0;
  const errors = [];

  for (const m of members) {
    const sub = subscriptionState(m.id, today);
    if ((sub.days_left !== null && sub.days_left >= 0 && sub.days_left <= daysAhead) || (sub.state === 'expired' && sub.days_left >= -3)) {
      // التأكد من عدم تكرار التذكير لنفس العضو اليوم
      const alreadySent = db
        .prepare(`SELECT 1 FROM reminders WHERE member_id = ? AND sent_at >= ? LIMIT 1`)
        .get(m.id, today + 'T00:00:00.000Z');
      if (alreadySent) continue;

      const msg = formatReminderMessage(template, m, sub, GYM_NAME);
      try {
        await sendWhatsAppViaGateway(gatewayUrl, token, m.phone, msg);
        db.prepare(
          'INSERT INTO reminders (member_id, sent_at, days_left, phone, status) VALUES (?, ?, ?, ?, ?)'
        ).run(m.id, new Date().toISOString(), sub.days_left || 0, m.phone, 'automated');
        sentCount++;
      } catch (e) {
        errors.push(`${m.name}: ${e.message}`);
      }
    }
  }
  return { ok: true, sentCount, errors };
}

// فحص دوري في الخلفية كل ساعتين (أو فور تشغيل السيرفر) لإرسال التذكيرات تلقائياً
let autoReminderTimer = null;
function startAutoReminderWorker() {
  if (autoReminderTimer) clearInterval(autoReminderTimer);
  // فحص بعد دقيقة من تشغيل السيرفر
  setTimeout(async () => {
    try {
      const res = await runAutomatedReminders();
      if (res.sentCount > 0) console.log(`[AutoReminders] تم إرسال ${res.sentCount} رسالة تذكير تلقائية عبر الواتساب.`);
    } catch (e) {
      console.error('[AutoReminders] Error:', e.message);
    }
  }, 60 * 1000);

  // ثم فحص دوري كل ساعتين
  autoReminderTimer = setInterval(async () => {
    try {
      const res = await runAutomatedReminders();
      if (res.sentCount > 0) console.log(`[AutoReminders] تم إرسال ${res.sentCount} رسالة تذكير تلقائية عبر الواتساب.`);
    } catch (e) {
      console.error('[AutoReminders] Error:', e.message);
    }
  }, 2 * 60 * 60 * 1000);
}

// إرسال تلقائي عبر بوابة واتساب إن تم ربطها (يدوياً من زر لوحة التحكم)
route('POST', '/api/reminders/send-automated', 'admin', async () => {
  const gatewayUrl = getSetting('gateway_url');
  if (!gatewayUrl) throw new ApiError(400, 'لم يتم إدخال رابط بوابة الواتساب في الإعدادات');
  const res = await runAutomatedReminders();
  return res;
});

// ---------- الملفات الثابتة ----------
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};
function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  let file;
  try {
    file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(rel)));
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('غير موجود');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}

// ---------- السيرفر ----------
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 100 * 1024) {
        reject(new ApiError(413, 'الطلب كبير جدًا'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(v && typeof v === 'object' ? v : {});
      } catch {
        reject(new ApiError(400, 'صيغة الطلب غير صحيحة'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(self)');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; media-src 'self' blob:; frame-ancestors 'none'"
  );
  try {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new ApiError(405, 'غير مسموح');
      return serveStatic(req, res, url.pathname);
    }
    const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
    if (!r) throw new ApiError(404, 'غير موجود');
    const m = url.pathname.match(r.re);
    const params = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));

    let session = null;
    if (r.role) {
      session = verify(parseCookies(req).sid);
      if (!session) throw new ApiError(401, 'سجّل دخول الأول');
      if (r.role === 'admin' && session.role !== 'admin') throw new ApiError(403, 'الصلاحية للمدير فقط');
    }
    const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);
    const ip = req.socket.remoteAddress || '';
    const out = await r.handler({ req, url, params, body, session, ip });
    if (out && out.raw !== undefined) {
      res.writeHead(200, { 'Content-Type': out.type, 'Cache-Control': 'no-store' });
      return res.end(out.raw);
    }
    if (out && out.body !== undefined) return sendJson(res, 200, out.body, out.headers);
    sendJson(res, 200, out);
  } catch (e) {
    if (e instanceof ApiError) return sendJson(res, e.status, { error: e.message });
    console.error(e);
    sendJson(res, 500, { error: 'حصل خطأ في السيرفر' });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`السيستم شغال على http://localhost:${PORT}`);
    startAutoReminderWorker();
    if (getStaffPassword() === 'staff123') {
      console.log('ملاحظة: كلمة مرور الموظف الافتراضية هي staff123 (يمكن تغييرها من شاشة الإعدادات).');
    }
  });
}

module.exports = { server, doCheckin };
