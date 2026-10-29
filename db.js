'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'gym.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS plans (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  duration_days INTEGER NOT NULL CHECK (duration_days > 0),
  price         REAL NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS members (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  plan_id    INTEGER REFERENCES plans(id),
  plan_name  TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL,
  price      REAL NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sub_member ON subscriptions(member_id, status, end_date);
CREATE INDEX IF NOT EXISTS idx_sub_created ON subscriptions(created_at);

CREATE TABLE IF NOT EXISTS attendance (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  checkin_at TEXT NOT NULL,
  result     TEXT NOT NULL CHECK (result IN ('ok','denied')),
  reason     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_att_day ON attendance(day);
CREATE INDEX IF NOT EXISTS idx_att_member ON attendance(member_id, checkin_at);

CREATE TABLE IF NOT EXISTS reminders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  sent_at    TEXT NOT NULL,
  days_left  INTEGER NOT NULL,
  phone      TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'sent'
);
CREATE INDEX IF NOT EXISTS idx_rem_member ON reminders(member_id, sent_at);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// إعدادات التنبيهات الافتراضية
const defaultTemplate = `مرحباً بك يا {name} في {gym} 🏋️‍♂️✨

نود تذكيرك بأن اشتراكك الحالي ({plan}) سينتهي قريباً:
📅 تاريخ الانتهاء: {end_date}
⏳ متبقي: {days_left}

لتجديد الاشتراك وتجنب توقف كود الدخول، يمكنك التجديد في زيارتك القادمة بمكتب الاستقبال.

نتمنى لك وقتاً ممتعاً وتدريباً موفقاً! 💪🔥`;

const setIns = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
setIns.run('remind_days', '3');
setIns.run('remind_template', defaultTemplate);

// باقات افتراضية (الأسعار أمثلة فقط، يعدلها صاحب الجيم من شاشة الباقات)
if (db.prepare('SELECT COUNT(*) AS c FROM plans').get().c === 0) {
  const ins = db.prepare('INSERT INTO plans (name, duration_days, price) VALUES (?, ?, ?)');
  ins.run('شهري', 30, 300);
  ins.run('ربع سنوي (3 شهور)', 90, 800);
  ins.run('نصف سنوي (6 شهور)', 180, 1500);
  ins.run('سنوي', 365, 2800);
}

module.exports = { db, DATA_DIR };
