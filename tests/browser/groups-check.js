#!/usr/bin/env node
// Browser check of account groups on the Accounts page: the real app in Chromium (Playwright), served from
// this folder on localhost; Apps Script calls answered by the real backend on the fake sheet (tests/harness.js)
// through page.route — nothing leaves this machine. Not part of `npm test` (Playwright isn't a dependency):
//   node tests/browser/groups-check.js
//   SHOTS=/some/folder node tests/browser/groups-check.js     also saves screenshots there (don't commit them)
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
const PIN = '123456';
const SHOTS = process.env.SHOTS || '';
const SECRET_GROUP = 'SecretGroupGGG';

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

// ── the fake backend: the realistic fixture + custom groups and a linked account ──
function makeBackend() {
  const b = createBackend({ now: fixture.NOW });
  fixture.build(b);
  b.api({ action: 'addAccount', name: 'PiggyBankPPP', type: 'bank', startingBalance: 50000, group: SECRET_GROUP });
  b.api({ action: 'addAccount', name: 'Grab', type: 'wallet', startingBalance: 300, group: 'Travel money' });
  b.api({ action: 'addAccount', name: 'Euro cash', type: 'cash', startingBalance: 100, currency: 'EUR', rate: 38, group: SECRET_GROUP });
  b.api({ action: 'addAccount', name: 'Broker', type: 'investment', startingBalance: 0, linkedTo: 'Kasikorn Securities' });
  b.api({ action: 'addAccount', name: 'Coins', type: 'cash', startingBalance: 0, group: '  ' + SECRET_GROUP.toLowerCase() + '  ' });   // same group, other case
  // A mixed group in debt: keeps the normal sign (only all-credit groups read "Owed")
  b.api({ action: 'addAccount', name: 'Shared card', type: 'credit', startingBalance: -5000, creditLimit: 20000 });
  b.api({ action: 'addAccount', name: 'Shared wallet', type: 'wallet', startingBalance: 1000 });
  b.api({ action: 'updateAccount', key: 'Shared card', name: 'Shared card', type: 'credit', startingBalance: -5000, creditLimit: 20000, group: 'Shared' });
  b.api({ action: 'updateAccount', key: 'Shared wallet', name: 'Shared wallet', type: 'wallet', startingBalance: 1000, group: 'SHARED' });
  return b;
}
let backend = makeBackend();
let oldBackend = false;          // answer renameAccountGroup like a backend that wasn't redeployed
const calls = [];

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
    calls.push(body);
    let out;
    if (oldBackend && body.action === 'renameAccountGroup') out = { ok: false, error: 'Unknown action: renameAccountGroup' };
    else { try { out = backend.api(Object.assign({}, body)); } catch (e) { out = { ok: false, error: String(e) }; } }
    if (body.token !== TOKEN) out = { ok: false, auth: true, error: 'unauthorized' };
    await r.fulfill({ contentType: 'application/json', body: JSON.stringify(out) }).catch(() => {});
  });
  return { ctx, page, errors };
}
async function typePin(page, pin) { await page.keyboard.type(pin, { delay: 20 }); }
async function waitUnlocked(page) {
  await page.waitForFunction(() => document.getElementById('app').style.display === 'flex' && accounts.length > 0, null, { timeout: 15000 });
}
async function setupAndUnlock(page, base) {
  await page.goto(base);
  await page.fill('#script-url-input', FAKE_URL); await page.fill('#script-token-input', TOKEN);
  await page.click('text=Next: set a PIN');
  await typePin(page, PIN); await page.waitForTimeout(150); await typePin(page, PIN);
  await waitUnlocked(page);
}
// Wait until the next loadAll after an action has drawn again
async function waitReload(page, fn) {
  await page.waitForFunction(fn, null, { timeout: 15000 });
}
// The group headings as drawn: [{ name, count, total, open }]
function headings(page) {
  return page.$$eval('#accounts-page-list .acc-group', gs => gs.map(g => ({
    name: g.querySelector('.acc-group-name').textContent,
    count: +g.querySelector('.acc-group-count').textContent,
    total: g.querySelector('.acc-group-total').textContent,
    open: g.querySelector('.acc-group-toggle').getAttribute('aria-expanded') === 'true',
    cards: g.querySelectorAll('.acc-page-card').length,
  })));
}
// What the page should show, worked out here from the backend's own answer
async function expected(page) {
  const acc = backend.api({ action: 'getAccounts' });
  const byName = {}, order = [];
  acc.accounts.forEach(a => { if (!byName[a.group]) { byName[a.group] = []; order.push(a.group); } byName[a.group].push(a); });
  const DEFAULTS = ['Bank accounts', 'Credit cards', 'Cash & wallets', 'Investments', 'Other'];
  const names = order.filter(g => !DEFAULTS.includes(g)).concat(DEFAULTS.filter(g => byName[g]));
  const out = [];
  for (const g of names) {
    const sum = byName[g].reduce((s, a) => s + a.balanceThb, 0);
    const owed = sum < 0 && byName[g].every(a => a.type === 'credit');      // all credit cards: "Owed ฿…"
    const total = await page.evaluate(n => fmtMoney(round2(n)), owed ? -sum : sum);
    out.push({ name: g, count: byName[g].length, total: (owed ? 'Owed ' : '') + total, sum });
  }
  return { groups: out, totalBalance: acc.totalBalance };
}
async function shot(page, name) { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true }); }
function step(name) { console.log('✓ ' + name); }

(async () => {
  const srv = await serve();
  const BASE = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch();

  {
    const { ctx, page, errors } = await newPage(browser);
    await setupAndUnlock(page, BASE);
    const netWorthBefore = await page.textContent('#header-networth');
    await page.evaluate(() => showPage('accounts'));

    // ── 1. Headings, order, counts and ฿ subtotals ──
    const exp = await expected(page);
    const got = await headings(page);
    assert.deepEqual(got.map(g => g.name), [SECRET_GROUP, 'Travel money', 'Shared', 'Bank accounts', 'Credit cards', 'Cash & wallets', 'Investments'],
      'custom groups first (in sheet order), then the defaults');
    assert.deepEqual(got.map(g => ({ name: g.name, count: g.count, total: g.total })), exp.groups.map(g => ({ name: g.name, count: g.count, total: g.total })));
    got.forEach(g => { assert.equal(g.open, true); assert.equal(g.cards, g.count); });
    const sumOfGroups = exp.groups.reduce((s, g) => s + g.sum, 0);
    assert.ok(Math.abs(sumOfGroups - exp.totalBalance) < 0.01, 'the subtotals add up to the total');
    assert.equal(exp.groups.find(g => g.name === SECRET_GROUP).total, '฿53,800', 'PiggyBankPPP 50,000 + €100 × 38');
    // "Travel"/"travel "/"TRAVEL" are one group, shown with the first spelling
    assert.equal(got.find(g => g.name === SECRET_GROUP).count, 3, 'the lower-case spelling joined the group');
    assert.ok(!got.some(g => g.name !== SECRET_GROUP && g.name.toLowerCase() === SECRET_GROUP.toLowerCase()));
    assert.deepEqual(got.find(g => g.name === 'Shared'), { name: 'Shared', count: 2, total: '฿-4,000', open: true, cards: 2 }, 'mixed group in debt: normal sign');
    assert.equal(got.find(g => g.name === 'Credit cards').total, 'Owed ฿3,700', 'credit cards only: reads like the card');
    assert.match(await page.locator('.acc-group:has-text("Credit cards") .acc-group-total').getAttribute('class'), /neg/);
    // The linked line and balance check still show inside their groups
    const inv = page.locator('.acc-group', { hasText: 'Investments' });
    assert.match(await inv.textContent(), /🔗 Kasikorn Securities/);
    assert.equal(await page.locator('.acc-group', { hasText: 'Bank accounts' }).locator('.bal-check-row button').count(), 1);
    await shot(page, 'groups-light');
    step('groups drawn in the chosen order with the right counts and ฿ subtotals (they add up to the total); names match in any case; "Owed ฿3,700" for credit cards only, normal sign for a mixed group; linked line + balance check inside groups');

    // ── 2. Collapse and expand ──
    await page.click('.acc-group:has-text("Travel money") .acc-group-toggle');
    let h = await headings(page);
    const isOpen = hs => Object.fromEntries(hs.map(g => [g.name, g.open]));
    const ALL_OPEN = Object.fromEntries(exp.groups.map(g => [g.name, true]));
    assert.deepEqual(isOpen(h), Object.assign({}, ALL_OPEN, { 'Travel money': false }));
    assert.equal(h[1].cards, 0, 'collapsed: no cards');
    assert.equal(h[1].total, exp.groups[1].total, 'collapsed: subtotal still shown');
    await page.click('.acc-group:has-text("Credit cards") .acc-group-toggle');
    await page.evaluate(() => renderAll());                              // a redraw keeps what's collapsed
    h = await headings(page);
    assert.deepEqual(isOpen(h), Object.assign({}, ALL_OPEN, { 'Travel money': false, 'Credit cards': false }));
    await shot(page, 'groups-collapsed-light');
    await page.click('.acc-group:has-text("Credit cards") .acc-group-toggle');
    h = await headings(page);
    assert.deepEqual(isOpen(h), Object.assign({}, ALL_OPEN, { 'Travel money': false }));
    assert.equal(h.find(g => g.name === 'Credit cards').cards, 1);
    const stored = await page.evaluate(() => JSON.stringify(Object.assign({}, localStorage)));
    assert.ok(!stored.includes('Travel money') && !stored.includes(SECRET_GROUP), 'no group names in plain localStorage');
    step('tapping a heading collapses / expands it; a redraw keeps the state; nothing about groups in localStorage');

    // ── 3. Edit mode inside groups; the form saves a group ──
    await page.click('#acct-edit-toggle-btn');
    const n = (await expected(page)).groups.reduce((s, g) => s + g.count, 0);
    assert.equal(await page.locator('.acc-edit-btn').count(), n - 1, 'Edit on every account in an open group');   // Grab is collapsed
    assert.equal(await page.locator('.acc-group-rename').count(), exp.groups.length, '✏️ on every heading');
    await page.click('.acc-group:has-text("Bank accounts") .acc-edit-btn');
    assert.equal(await page.inputValue('#fa-group'), 'Bank accounts', 'prefilled with the current group');
    const opts = await page.$$eval('#fa-group-list option', os => os.map(o => o.value));
    for (const g of [SECRET_GROUP, 'Travel money', 'Bank accounts', 'Credit cards', 'Cash & wallets', 'Investments']) assert.ok(opts.includes(g), 'suggests ' + g);
    assert.equal(opts.filter(o => o.toLowerCase() === SECRET_GROUP.toLowerCase()).length, 1, 'one spelling per group in the suggestions');
    await page.fill('#fa-group', 'Everyday');
    calls.length = 0;
    await page.click('#save-account-btn');
    await waitReload(page, () => !!Array.from(document.querySelectorAll('.acc-group-name')).find(e => e.textContent === 'Everyday'));
    const upd = calls.find(c => c.action === 'updateAccount');
    assert.equal(upd.group, 'Everyday');
    assert.equal(backend.api({ action: 'getAccounts' }).accounts.find(a => a.name === 'Bank').group, 'Everyday');
    h = await headings(page);
    assert.ok(!h.some(g => g.name === 'Bank accounts'), 'the empty default group is gone');
    assert.equal(h.find(g => g.name === 'Travel money').open, false, 'still collapsed after the reload');
    step('edit mode shows Edit/Delete inside groups and ✏️ on headings; the form prefills and suggests groups, and saves the new group');

    // New account: default for the type, follows the type until typed over
    await page.evaluate(() => openAddAccount());
    assert.equal(await page.inputValue('#fa-group'), 'Bank accounts');
    await page.selectOption('#fa-type', 'credit');
    assert.equal(await page.inputValue('#fa-group'), 'Credit cards');
    await page.selectOption('#fa-type', 'wallet');
    assert.equal(await page.inputValue('#fa-group'), 'Cash & wallets');
    await page.fill('#fa-group', 'Travel money');
    await page.selectOption('#fa-type', 'cash');
    assert.equal(await page.inputValue('#fa-group'), 'Travel money', 'a typed group is kept when the type changes');
    await page.fill('#fa-name', 'Yen pocket');
    calls.length = 0;
    await page.click('#save-account-btn');
    await waitReload(page, () => accounts.some(a => a.name === 'Yen pocket'));
    assert.equal(calls.find(c => c.action === 'addAccount').group, 'Travel money');
    assert.equal((await headings(page)).find(g => g.name === 'Travel money').count, 2);
    step('new account: group prefilled with the type default and follows the type until typed; saved with addAccount');

    // ── 4. Rename ──
    page.once('dialog', d => { assert.match(d.message(), /Rename group "Travel money" \(2 accounts\)/); d.accept('Trips'); });
    calls.length = 0;
    await page.click('.acc-group:has-text("Travel money") .acc-group-rename');
    await waitReload(page, () => !!Array.from(document.querySelectorAll('.acc-group-name')).find(e => e.textContent === 'Trips'));
    assert.deepEqual(calls.filter(c => c.action === 'renameAccountGroup').map(c => [c.from, c.to]), [['Travel money', 'Trips']]);
    h = await headings(page);
    const trips = h.find(g => g.name === 'Trips');
    assert.equal(trips.count, 2); assert.equal(trips.open, false, 'collapsed state follows the rename');
    assert.ok(!h.some(g => g.name === 'Travel money'));
    // Renaming a default group works the same way
    page.once('dialog', d => d.accept('Cards'));
    await page.click('.acc-group:has-text("Credit cards") .acc-group-rename');
    await waitReload(page, () => !!Array.from(document.querySelectorAll('.acc-group-name')).find(e => e.textContent === 'Cards'));
    // Cancel does nothing
    calls.length = 0;
    page.once('dialog', d => d.dismiss());
    await page.click('.acc-group:has-text("Cards") .acc-group-rename');
    await page.waitForTimeout(200);
    assert.equal(calls.length, 0, 'cancel sends nothing');
    // An old backend: a clear message
    oldBackend = true;
    page.once('dialog', d => d.accept('Whatever'));
    await page.click('.acc-group:has-text("Cards") .acc-group-rename');
    await page.waitForFunction(() => /redeploy Apps Script/.test(document.getElementById('toast').textContent));
    oldBackend = false;
    step('✏️ renames a group (custom or default) on all its accounts in one call; cancel sends nothing; an old backend gets a redeploy message');

    // ── 5. Totals unchanged; dashboard cards still drawn, in group order ──
    await page.evaluate(() => showPage('dashboard'));
    assert.equal(await page.textContent('#header-networth'), netWorthBefore, 'net worth unchanged by regrouping and renaming (the one new account is ฿0)');
    const cards = await page.$$eval('#account-cards-wrap .account-card-name', es => es.map(e => e.textContent));
    const want = await page.evaluate(() => { var o = []; acctGroups(sortedAccounts()).forEach(function(g){ o = o.concat(g.accounts.map(function(a){ return a.name; })); }); return o; });
    assert.deepEqual(cards, want);
    assert.equal(cards.length, await page.evaluate(() => accounts.length));
    step('net worth unchanged; dashboard: every account card drawn, ordered by group');

    // ── 6. Lock clears the groups; unlock starts with every group open ──
    await page.evaluate(() => showPage('accounts'));
    await page.click('.acc-group:has-text("' + SECRET_GROUP + '") .acc-group-toggle');
    await page.evaluate(() => lockNow());
    const html = await page.evaluate(() => document.documentElement.outerHTML + Array.from(document.querySelectorAll('input')).map(e => e.value).join('|'));
    for (const s of [SECRET_GROUP, 'Trips', 'Everyday', 'PiggyBankPPP']) assert.ok(!html.includes(s), '"' + s + '" still in the page after lock');
    const mem = await page.evaluate(() => JSON.stringify([collapsedGroups, acctGroupList, accounts, accountsEditMode]));
    assert.equal(mem, '[{},[],[],false]', 'group state emptied on lock');
    assert.ok(!(await page.evaluate(() => JSON.stringify(Object.assign({}, localStorage)))).includes(SECRET_GROUP));
    await typePin(page, PIN); await waitUnlocked(page);
    await page.evaluate(() => showPage('accounts'));
    h = await headings(page);
    assert.ok(h.every(g => g.open), 'all open again after unlock');
    assert.equal(await page.locator('.acc-group-rename').count(), 0, 'edit mode off after unlock');
    step('lock empties the page, the collapsed state and the group list; unlock draws every group open');

    assert.deepEqual(errors, [], 'console errors');
    await ctx.close();
  }

  // ── 7. Layout at 390 px, light and dark (with a long group name) ──
  backend = makeBackend();
  backend.api({ action: 'addAccount', name: 'Long', type: 'bank', startingBalance: 1234567.89, group: 'A really very long group name for the holidays' });
  for (const scheme of ['light', 'dark']) {
    const { ctx, page, errors } = await newPage(browser, { colorScheme: scheme });
    await setupAndUnlock(page, BASE);
    await page.evaluate(() => showPage('accounts'));
    await page.click('#acct-edit-toggle-btn');
    await page.click('.acc-group:has-text("Travel money") .acc-group-toggle');
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw <= 390, 'no sideways scroll (' + sw + ')');
    const boxes = await page.$$eval('.acc-group-head', hs => hs.map(h => {
      const r = h.getBoundingClientRect(), t = h.querySelector('.acc-group-total').getBoundingClientRect(),
            b = h.querySelector('.acc-group-rename').getBoundingClientRect(), n = h.querySelector('.acc-group-name').getBoundingClientRect();
      return { left: r.left, right: r.right, totalRight: t.right, totalLeft: t.left, renameRight: b.right, nameRight: n.right, h: r.height };
    }));
    boxes.forEach(b => {
      assert.ok(b.left >= 0 && b.right <= 390, 'heading inside the screen');
      assert.ok(b.renameRight <= b.right + 0.5 && b.totalRight <= b.renameRight, 'subtotal and ✏️ fit');
      assert.ok(b.nameRight <= b.totalLeft, 'a long name is cut, not overlapping the subtotal');
      assert.ok(b.h < 60, 'heading stays on one line');
    });
    const colors = await page.$eval('.acc-group-total', e => [getComputedStyle(e).color, getComputedStyle(document.body).backgroundColor]);
    assert.notEqual(colors[0], colors[1], 'subtotal readable on the background');
    await shot(page, 'groups-edit-' + scheme);
    assert.deepEqual(errors, [], 'console errors (' + scheme + ')');
    await ctx.close();
  }
  step('390 px light and dark: headings fit (long name cut with …, subtotal and ✏️ visible), no sideways scroll, no console errors');

  await browser.close();
  srv.close();
  console.log('\nAll group checks passed. Requests made: ' + calls.length + ' (all to the stub).');
})().catch(e => { console.error(e); process.exit(1); });
