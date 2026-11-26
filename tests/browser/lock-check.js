#!/usr/bin/env node
// Browser check of the PIN lock: the real app in Chromium (Playwright), served from this folder on localhost.
// Apps Script calls are answered by the real backend code running on the fake sheet (tests/harness.js),
// through page.route — nothing leaves this machine. Not part of `npm test` (Playwright isn't a dependency):
//   node tests/browser/lock-check.js            (needs `require('playwright')` to work)
//   SHOTS=/some/folder node tests/browser/lock-check.js     also saves screenshots there (don't commit them)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createBackend, TOKEN } = require('../harness');
const fixture = require('../fixtures/unlinked');

const ROOT = path.join(__dirname, '..', '..');
const FAKE_URL = 'https://script.google.com/macros/s/FAKE-FOR-TESTS/exec';   // never reached: page.route answers
const PIN = '123456', PIN2 = '654321';
const SECRETS = ['SecretBankXYZ', 'PrivateNoteQQQ', TOKEN];
const SHOTS = process.env.SHOTS || '';

// ── a tiny static server (WebCrypto needs a secure context: localhost counts) ──
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f)) { rsp.writeHead(404); rsp.end(); return; }
      rsp.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(rsp);
    }).listen(0, '127.0.0.1', () => res(srv));
  });
}

// ── the fake backend ──
const backend = createBackend({ now: fixture.NOW });
fixture.build(backend);
backend.api({ action: 'addAccount', name: 'SecretBankXYZ', type: 'bank', startingBalance: 98765 });
backend.api({ action: 'addExpense', date: '2026-11-03', amount: 432, category: 'Shopping', account: 'SecretBankXYZ', note: 'PrivateNoteQQQ' });
const calls = [];                 // every request the app made: { action, locked, at }
let delayNext = 0;
let isLocked = () => false;

async function newPage(browser, opts) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' }, opts || {}));
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route('**/script.google.com/**', async r => {
    let body = {};
    try { body = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
    calls.push({ action: body.action, locked: await isLocked(page).catch(() => 'closed'), payload: body });
    if (delayNext) { const d = delayNext; delayNext = 0; await new Promise(res => setTimeout(res, d)); }
    let out;
    try { out = backend.api(Object.assign({}, body, { token: body.token })); } catch (e) { out = { ok: false, error: String(e) }; }
    // The harness adds the right token itself; check the app sent it, like the real backend would
    if (body.token !== TOKEN) out = { ok: false, auth: true, error: 'unauthorized' };
    await r.fulfill({ contentType: 'application/json', body: JSON.stringify(out) }).catch(() => {});
  });
  return { ctx, page, errors };
}

const visible = (page, sel) => page.locator(sel).isVisible();
async function storageDump(page) { return page.evaluate(() => JSON.stringify(Object.assign({}, localStorage))); }
async function assertNoPlainSecrets(page, what) {
  const dump = await storageDump(page);
  for (const s of SECRETS.concat([PIN, PIN2])) assert.ok(!dump.includes(s), what + ': "' + s + '" found in localStorage');
  assert.ok(!/"moneyToken"/.test(dump), what + ': moneyToken still stored');
}
// Nothing from the data anywhere in the page (rendered, hidden, or typed into inputs)
async function assertNoDataInPage(page, what) {
  const html = await page.evaluate(() => document.documentElement.outerHTML +
    Array.from(document.querySelectorAll('input,textarea')).map(e => e.value).join('|'));
  for (const s of SECRETS) assert.ok(!html.includes(s), what + ': "' + s + '" still in the page');
  const mem = await page.evaluate(() => JSON.stringify([API_TOKEN, accounts, transactions, serverTxns, queueMem, cacheMem, expHistory, !!unlockKey]));
  for (const s of SECRETS) assert.ok(!mem.includes(s), what + ': "' + s + '" still in memory');
  assert.ok(mem.endsWith('false]'), what + ': key still in memory');
}
async function typePin(page, pin) { await page.keyboard.type(pin, { delay: 20 }); }
async function tapPin(page, pin) { for (const d of pin) await page.click('#pin-pad button:text-is("' + d + '")'); }
async function waitUnlocked(page) {
  await page.waitForFunction(() => document.getElementById('app').style.display === 'flex' && accounts.length > 0, null, { timeout: 15000 });
}
async function waitLockMsg(page, re) {
  await page.waitForFunction(r => new RegExp(r).test(document.getElementById('pin-msg').textContent), re.source, { timeout: 15000 });
  return page.textContent('#pin-msg');
}
async function shot(page, name) { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); }
function step(name) { console.log('✓ ' + name); }

(async () => {
  const srv = await serve();
  const BASE = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch();
  isLocked = page => page.evaluate(() => !unlockKey);
  const allErrors = [];

  // ── 1. First run after the update: a plaintext token, cache and offline queue exist ──
  {
    const { ctx, page, errors } = await newPage(browser);
    await page.goto(BASE);
    assert.ok(await visible(page, '#setup-screen'), 'empty device starts on setup');
    const boot = backend.api({ action: 'bootstrap', month: 11, year: 2026 });
    await page.evaluate(a => {
      localStorage.setItem('moneyScriptUrl', a.url);
      localStorage.setItem('moneyToken', a.token);
      localStorage.setItem('moneyCache_v1', JSON.stringify({ m: new Date().getMonth() + 1, y: new Date().getFullYear(), d: a.boot }));
      localStorage.setItem('moneyQueue_v1', JSON.stringify([{ action: 'addExpense', id: 'Eoldqueue01', date: '2026-11-04', amount: 55,
        category: 'Shopping', account: 'Wallet', note: 'queued before update', qid: 'Qold' }]));
    }, { url: FAKE_URL, token: TOKEN, boot });
    calls.length = 0;
    await page.reload();
    assert.ok(await visible(page, '#lock-screen'));
    assert.equal(await page.textContent('#lock-title'), 'Set a 6-digit PIN');
    assert.equal(await page.isVisible('#pin-forgot'), false, 'no Forgot link while setting a PIN');
    assert.equal(await page.isVisible('#app'), false);
    await shot(page, 'set-pin-light');
    await tapPin(page, PIN);                                  // the on-screen keypad…
    await page.waitForFunction(() => document.getElementById('lock-title').textContent === 'Confirm your PIN');
    assert.equal(calls.length, 0, 'no request before the PIN is set');
    await typePin(page, '111111');                            // …a mismatch…
    await waitLockMsg(page, /didn't match/);
    await tapPin(page, PIN); await page.waitForFunction(() => document.getElementById('lock-title').textContent === 'Confirm your PIN');
    await typePin(page, PIN);                                 // …and the keyboard
    await waitUnlocked(page);
    await page.waitForFunction(() => getQueue().length === 0, null, { timeout: 15000 });
    assert.ok(calls.some(c => c.action === 'addExpense' && c.payload.id === 'Eoldqueue01'), 'the old offline entry was sent');
    assert.ok((await page.textContent('#app')).includes('SecretBankXYZ'));
    await page.waitForTimeout(300);                           // let the encrypted cache write land
    await assertNoPlainSecrets(page, 'after first PIN');
    const st = JSON.parse(await storageDump(page));
    assert.ok(st.moneyLock_v1 && JSON.parse(st.moneyCache_v1).sealed === 1, 'vault + sealed cache');
    assert.equal(st.moneyScriptUrl, FAKE_URL);
    step('first run: set PIN (keypad + keyboard, mismatch handled) → unlocked; old queue sent; no plaintext token/data in localStorage');

    // ── 2. Reload → locked, nothing shown, nothing requested ──
    calls.length = 0;
    await page.reload();
    assert.ok(await visible(page, '#lock-screen'));
    assert.equal(await page.textContent('#lock-title'), 'Enter your PIN');
    await page.waitForTimeout(400);
    assert.equal(calls.length, 0, 'no request while locked');
    await assertNoDataInPage(page, 'locked after reload');
    await shot(page, 'unlock-light');
    step('reload → locked, no data in the page or memory, no request made');

    // ── 3. Wrong PIN ×3, then the right one (keyboard: Backspace corrects) ──
    for (let i = 1; i <= 3; i++) {
      await typePin(page, '00000' + i);
      await waitLockMsg(page, new RegExp((10 - i) + ' tries left'));
    }
    assert.match(await page.textContent('#pin-msg'), /Wrong PIN\. 7 tries left\./);
    await shot(page, 'wrong-pin-light');
    await typePin(page, '12349'); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
    await typePin(page, '456');
    await waitUnlocked(page);
    assert.equal(JSON.parse(JSON.parse(await storageDump(page)).moneyLock_v1).fails, 0, 'count reset');
    step('wrong PIN ×3 shows tries left, then the right PIN (typed, with Backspace) unlocks and resets the count');

    // ── 4. Hidden for 4 min → still open; > 5 min → locked ──
    const goHidden = (ms) => page.evaluate(ms => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      hiddenAt = Date.now() - ms;                                  // pretend it went to the background ms ago
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    }, ms);
    await goHidden(4 * 60 * 1000);
    assert.equal(await page.evaluate(() => isUnlocked()), true, 'still unlocked after 4 min');
    await goHidden(5 * 60 * 1000 + 1000);
    assert.equal(await page.evaluate(() => isUnlocked()), false, 'locked after > 5 min');
    assert.ok(await visible(page, '#lock-screen'));
    await assertNoDataInPage(page, 'auto-locked');
    step('background 4 min → still open; > 5 min → locked and cleared');
    await typePin(page, PIN); await waitUnlocked(page);

    // ── 5. A request in flight when the lock hits: its answer is not shown ──
    delayNext = 1500;
    await page.evaluate(() => { loadAll(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => lockNow());
    await page.waitForTimeout(2200);
    await assertNoDataInPage(page, 'late answer after lock');
    const reqWhileLocked = calls.filter(c => c.locked === true);
    assert.equal(reqWhileLocked.length, 0, 'no request started while locked');
    step('an answer arriving after the lock is dropped (nothing drawn, nothing in memory)');
    await typePin(page, PIN); await waitUnlocked(page);

    // ── 5b. Every page and modal with data open, then lock ──
    for (const pg of ['transactions', 'accounts', 'projects', 'dashboard']) await page.evaluate(p => showPage(p), pg);
    await page.evaluate(() => { showPage('transactions'); });
    await page.fill('#search-input', 'Private');
    await page.waitForFunction(() => document.getElementById('page-transactions').textContent.includes('PrivateNoteQQQ'));
    await page.evaluate(() => { openExpenseForm(); });
    await page.fill('#fe-note', 'PrivateNoteQQQ typed');
    await page.evaluate(() => { closeModal('expense-modal'); openTransferForm(); });
    await page.evaluate(() => { closeModal('transfer-modal'); showAnnualSummary(2026); });
    await page.waitForTimeout(500);
    await page.evaluate(() => { closeAnnualSummary(); openSettings(); });
    assert.equal(await page.inputValue('#settings-token'), TOKEN, 'token shown in Settings while unlocked');
    await page.evaluate(() => lockNow());
    await assertNoDataInPage(page, 'locked with pages and modals opened');
    await typePin(page, PIN); await waitUnlocked(page);
    assert.ok(await page.textContent('#app').then(t => t.includes('SecretBankXYZ')), 'drawn again after unlock');
    assert.equal(await page.inputValue('#settings-token'), TOKEN, 'token back in Settings after unlock');
    step('pages, search, forms, year review and Settings opened → lock clears them all; unlock draws again');

    // ── 6. Offline entries survive lock → reload → unlock, then are sent ──
    await ctx.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.evaluate(() => openExpenseForm());
    await page.fill('#fe-amount', '321');
    await page.fill('#fe-note', 'PrivateNoteQQQ offline');
    await page.click('#fe-cat-grid .cat-option >> nth=0');
    await page.click('#fe-acct-list .acct-option >> nth=0');
    await page.click('#save-expense-btn');
    await page.waitForFunction(() => getQueue().length === 1);
    assert.match(await page.textContent('#sync-badge'), /1 waiting/);
    await page.click('.header-settings-btn >> nth=1');           // ⚙️
    await page.click('text=🔒 Lock now');
    assert.ok(await visible(page, '#lock-screen'));
    await page.waitForTimeout(200);
    let st2 = JSON.parse(await storageDump(page));
    assert.equal(JSON.parse(st2.moneyQueue_v1).n, 1, 'sealed queue keeps the count');
    await assertNoPlainSecrets(page, 'offline entry, locked');
    await assertNoDataInPage(page, 'locked with offline entry');
    await ctx.setOffline(false);                                  // (without the service worker a reload needs the network)
    calls.length = 0;
    await page.reload();
    await page.waitForTimeout(300);
    assert.equal(calls.length, 0, 'nothing sent before the unlock');
    await typePin(page, PIN);
    await waitUnlocked(page);
    await page.waitForFunction(() => getQueue().length === 0, null, { timeout: 15000 });
    assert.ok(calls.some(c => c.action === 'addExpense' && c.payload.note === 'PrivateNoteQQQ offline' && c.payload.amount === 321), 'offline expense sent after unlock');
    step('offline expense → Lock now → reload → unlock → sent (queue stayed encrypted with its count)');

    // ── 7. Change PIN ──
    await page.click('.header-settings-btn >> nth=1');
    await page.click('text=🔑 Change PIN');
    assert.equal(await page.textContent('#lock-title'), 'Enter your current PIN');
    assert.ok(await page.isVisible('#pin-cancel'));
    await page.keyboard.press('Escape');                          // Esc cancels a change
    assert.equal(await page.isVisible('#lock-screen'), false);
    assert.equal(await page.evaluate(() => isUnlocked()), true);
    await page.click('.header-settings-btn >> nth=1');
    await page.click('text=🔑 Change PIN');
    await typePin(page, '999999');
    await waitLockMsg(page, /Wrong PIN/);
    await typePin(page, PIN);
    await page.waitForFunction(() => document.getElementById('lock-title').textContent === 'Choose a new PIN');
    await typePin(page, PIN2);
    await page.waitForFunction(() => document.getElementById('lock-title').textContent === 'Confirm your new PIN');
    await typePin(page, PIN2);
    await page.waitForFunction(() => document.getElementById('lock-screen').style.display === 'none');
    await page.waitForTimeout(200);
    await assertNoPlainSecrets(page, 'after change');
    await page.evaluate(() => lockNow());
    await typePin(page, PIN);
    await waitLockMsg(page, /Wrong PIN/);
    await typePin(page, PIN2);
    await waitUnlocked(page);
    step('Change PIN: Esc cancels, wrong current PIN refused, new PIN set; old PIN then fails, new one works');

    // ── 8. 10 wrong → wiped (with the warning about unsent entries) ──
    await ctx.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.evaluate(() => saveWithDupCheck({ action: 'addIncome', amount: 5, category: 'Salary', account: 'Bank', date: '2026-11-05', note: 'x' }, 'income'));
    await page.evaluate(() => lockNow());
    await page.waitForTimeout(200);
    for (let i = 1; i <= 9; i++) {
      await typePin(page, '00000' + (i % 10));
      await waitLockMsg(page, new RegExp((10 - i) + ' tr(y|ies) left'));
      if (i >= 5) {                                              // the delay is on; skip it by moving the last fail back in time
        const msg = await page.textContent('#pin-msg');
        assert.match(msg, /1 offline entry not sent yet, which will be lost/, 'warns about the unsent entry');
        if (i === 5) { assert.match(msg, /Try again in 0:(30|29)/); await shot(page, 'delay-light'); }
        assert.equal(await page.isDisabled('#pin-pad button >> nth=0'), true, 'keypad off during the delay');
        await page.evaluate(() => { var v = lockReadVault(); v.failAt = 1; lockWriteVault(v); showWait(); });
      }
    }
    await typePin(page, '000000');
    await page.waitForFunction(() => document.getElementById('setup-screen').style.display === 'flex');
    assert.match(await page.textContent('#setup-note'), /Too many wrong PINs/);
    const st3 = JSON.parse(await storageDump(page));
    assert.ok(!st3.moneyLock_v1 && !st3.moneyCache_v1 && !st3.moneyQueue_v1, 'vault, cache and queue wiped');
    assert.equal(st3.moneyScriptUrl, FAKE_URL, 'URL kept');
    assert.equal(await page.inputValue('#script-url-input'), FAKE_URL, 'URL prefilled');
    await ctx.setOffline(false);
    step('5th wrong starts the delay (keypad off, countdown, unsent-entry warning); 10th wipes vault/cache/queue → setup');

    // ── 9. First-time setup screen → PIN → Forgot PIN ──
    await page.fill('#script-token-input', TOKEN);
    await page.click('text=Next: set a PIN');
    assert.equal(await page.textContent('#lock-title'), 'Set a 6-digit PIN');
    await typePin(page, PIN); await page.waitForFunction(() => document.getElementById('lock-title').textContent === 'Confirm your PIN');
    await typePin(page, PIN);
    await waitUnlocked(page);
    await page.waitForTimeout(300);
    await assertNoPlainSecrets(page, 'after setup');
    await page.evaluate(() => lockNow());
    const dialogs = [];
    page.once('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
    await page.click('#pin-forgot');
    assert.ok(await visible(page, '#lock-screen'), 'cancel keeps everything');
    assert.ok(JSON.parse(await storageDump(page)).moneyLock_v1);
    page.once('dialog', d => { dialogs.push(d.message()); d.accept(); });
    await page.click('#pin-forgot');
    await page.waitForFunction(() => document.getElementById('setup-screen').style.display === 'flex');
    assert.match(dialogs[1], /offline copy of your data/);
    assert.match(dialogs[1], /Google Sheets is not touched/);
    const st4 = JSON.parse(await storageDump(page));
    assert.ok(!st4.moneyLock_v1 && !st4.moneyCache_v1 && !st4.moneyQueue_v1);
    step('setup screen → set PIN → unlocked; Forgot PIN: cancel keeps all, confirm wipes → setup');

    assert.deepEqual(errors, [], 'console errors');
    allErrors.push(...errors);
    await ctx.close();
  }

  // ── 10. Dark mode at 390 px, and a short phone ──
  for (const scheme of ['dark', 'light']) {
    const { ctx, page, errors } = await newPage(browser, { colorScheme: scheme });
    await page.goto(BASE);
    await page.evaluate(u => { localStorage.setItem('moneyScriptUrl', u); }, FAKE_URL);
    await page.fill('#script-url-input', FAKE_URL); await page.fill('#script-token-input', TOKEN);
    await page.click('text=Next: set a PIN');
    await typePin(page, PIN); await page.waitForTimeout(150); await typePin(page, PIN);
    await waitUnlocked(page);
    await page.evaluate(() => lockNow());
    await typePin(page, '111111');
    await waitLockMsg(page, /Wrong PIN/);
    await shot(page, 'unlock-' + scheme);
    const box = await page.locator('#pin-pad').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390, 'keypad fits at 390 px');
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw <= 390, 'no horizontal scroll');
    await page.setViewportSize({ width: 390, height: 600 });
    await shot(page, 'unlock-short-' + scheme);
    const forgot = await page.locator('#pin-forgot').boundingBox();
    assert.ok(forgot.y + forgot.height <= 600 + 1, 'Forgot PIN reachable on a short screen');
    await page.click('.header-settings-btn >> nth=1').catch(() => {});   // app hidden: nothing to click
    assert.deepEqual(errors, [], 'console errors (' + scheme + ')');
    await ctx.close();
  }
  step('390 px light and dark: keypad fits, no sideways scroll, Forgot PIN reachable at 600 px tall');

  // ── 11. No WebCrypto → refuses to open ──
  {
    const { ctx, page, errors } = await newPage(browser);
    await page.addInitScript(() => { Object.defineProperty(window.crypto, 'subtle', { value: undefined }); });
    await page.goto(BASE);
    await page.evaluate(() => { localStorage.setItem('moneyScriptUrl', 'x'); localStorage.setItem('moneyToken', 'y'); });
    await page.reload();
    assert.ok(await visible(page, '#nocrypto-screen'));
    assert.equal(await page.isVisible('#app'), false);
    assert.equal(await page.isVisible('#setup-screen'), false);
    assert.equal(await page.isVisible('#lock-screen'), false);
    await shot(page, 'nocrypto');
    assert.deepEqual(errors, []);
    await ctx.close();
  }
  step('no crypto.subtle → clear message, app not opened');

  // ── 12. Service worker: the lock files are cached, and an offline open still starts locked ──
  {
    const { ctx, page, errors } = await newPage(browser, { serviceWorkers: 'allow' });
    await page.goto(BASE);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => caches.keys().then(k => k.length > 0));
    const cached = await page.evaluate(() => caches.keys().then(ks => caches.open(ks.filter(k => k.indexOf('money-tracker-') === 0)[0]))
      .then(c => c.keys()).then(rs => rs.map(r => new URL(r.url).pathname)));
    for (const f of ['/js/lock.js', '/js/lockscreen.js']) assert.ok(cached.includes(f), f + ' cached');
    await page.fill('#script-url-input', FAKE_URL); await page.fill('#script-token-input', TOKEN);
    await page.click('text=Next: set a PIN');
    await typePin(page, PIN); await page.waitForTimeout(150); await typePin(page, PIN);
    await waitUnlocked(page);
    await page.waitForTimeout(300);
    await ctx.setOffline(true);
    await page.reload();
    assert.ok(await visible(page, '#lock-screen'), 'offline open → lock screen');
    await typePin(page, PIN);
    await waitUnlocked(page);                                   // from the encrypted offline copy
    assert.ok((await page.textContent('#app')).includes('SecretBankXYZ'));
    assert.deepEqual(errors.filter(e => !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e)), []);
    await ctx.close();
  }
  step('service worker caches lock.js + lockscreen.js; offline open → lock screen → unlock shows the encrypted offline copy');

  // ── 13. Unlock time on a slow CPU (6× throttled) ──
  {
    const { ctx, page } = await newPage(browser);
    await page.goto(BASE);
    const cdp = await ctx.newCDPSession(page);
    const times = {};
    for (const rate of [1, 6]) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      times[rate] = await page.evaluate(() => {
        var t = performance.now();
        return lockDeriveKey('123456', lockRandom(16), LOCK_ITER).then(function() { return Math.round(performance.now() - t); });
      });
    }
    console.log('  PBKDF2 ' + await page.evaluate(() => LOCK_ITER) + ' rounds: ' + times[1] + ' ms normal, ' + times[6] + ' ms with 6× CPU throttling (DevTools throttling does not slow native WebCrypto, so this is not a phone estimate)');
    await ctx.close();
  }

  await browser.close();
  srv.close();
  console.log('\nAll browser checks passed. Requests made: ' + calls.length + ' (all to the stub).');
})().catch(e => { console.error(e); process.exit(1); });
