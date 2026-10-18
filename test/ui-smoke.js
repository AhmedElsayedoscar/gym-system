// اختبار واجهة سريع باستخدام Playwright (بيشتغل لو Playwright متثبت عندك)
const { chromium } = require(process.env.PW_MODULE || 'playwright');
const SHOTS = process.env.SHOTS_DIR || '.';
const BASE = process.env.BASE || 'http://localhost:3111';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 }, locale: 'ar-EG', timezoneId: 'Africa/Cairo' });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push('console.' + m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => problems.push('requestfailed: ' + r.url()));

  // الدخول
  await page.goto(BASE + '/');
  await page.waitForURL('**/login.html');
  await page.fill('#pw', 'wrong');
  await page.click('button[type=submit]');
  await page.waitForSelector('#err:not([hidden])');
  console.log('wrong password message:', await page.textContent('#err'));
  await page.fill('#pw', 'adm1');
  await page.click('button[type=submit]');
  await page.waitForSelector('.tiles');
  console.log('dashboard brand:', await page.textContent('#brand'));
  await page.screenshot({ path: SHOTS + '/1-dashboard.png' });

  // إضافة عضو من الواجهة (مع اسم فيه رموز HTML للتأكد من الأمان)
  await page.goto(BASE + '/#/members');
  await page.click('text=+ عضو جديد');
  await page.fill('input[name=name]', 'محمد <b>صلاح</b>');
  await page.fill('input[name=phone]', '01234567890');
  await page.selectOption('select[name=plan_id]', { index: 1 });
  await page.click('button[type=submit]:has-text("إضافة")');
  await page.waitForSelector('.member-head');
  console.log('member title text:', (await page.textContent('.member-info h1')).trim());
  console.log('html injected as element?', (await page.$('.member-info h1 b')) !== null);
  const code = (await page.textContent('.qr-box .code')).trim();
  console.log('member code:', code);
  await page.screenshot({ path: SHOTS + '/2-member.png' });

  // تجديد
  await page.click('text=تجديد / اشتراك جديد');
  await page.selectOption('select[name=plan_id]', { index: 0 });
  await page.click('button[type=submit]:has-text("تسجيل الاشتراك")');
  const subCard = page.locator('.card', { has: page.locator('h2', { hasText: 'سجل الاشتراكات' }) });
  await page.waitForFunction(() => [...document.querySelectorAll('.card')].find((c) => c.querySelector('h2')?.textContent.includes('سجل الاشتراكات')).querySelectorAll('tbody tr').length >= 2);
  console.log('subscriptions rows after renew:', await subCard.locator('tbody tr').count());

  // البحث
  await page.goto(BASE + '/#/members');
  await page.fill('input[type=search]', '0123456');
  await page.waitForTimeout(600);
  console.log('search rows:', await page.locator('tbody tr').count());

  // شاشة المسح (إدخال يدوي)
  await page.goto(BASE + '/scan.html');
  await page.fill('#code', code.toLowerCase());
  await page.press('#code', 'Enter');
  await page.waitForSelector('.result.ok, .result.warn');
  console.log('scan result:', (await page.textContent('#result')).trim());
  await page.screenshot({ path: SHOTS + '/3-scan-ok.png' });
  await page.fill('#code', 'GYM-NOPE2222');
  await page.press('#code', 'Enter');
  await page.waitForSelector('.result.bad');
  console.log('unknown code result:', (await page.textContent('#result')).trim());
  await page.screenshot({ path: SHOTS + '/4-scan-bad.png' });

  // الكارت
  await page.goto(BASE + '/card.html?id=1');
  await page.waitForSelector('.member-card img');
  await page.waitForTimeout(300);
  await page.screenshot({ path: SHOTS + '/5-card.png' });

  // الحضور والباقات
  await page.goto(BASE + '/#/attendance');
  await page.waitForSelector('table');
  await page.goto(BASE + '/#/plans');
  await page.waitForSelector('table');
  await page.screenshot({ path: SHOTS + '/6-plans.png' });

  // موبايل
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(BASE + '/scan.html');
  await page.waitForTimeout(400);
  await page.screenshot({ path: SHOTS + '/7-scan-mobile.png' });

  console.log('PROBLEMS:', problems.length ? problems : 'none');
  await browser.close();
})().catch((e) => { console.error('TEST FAILED:', e.message); process.exit(1); });
