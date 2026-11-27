#!/usr/bin/env node
// Browser check of the project detail view (Projects page): the real app in Chromium (Playwright), served from
// this folder on localhost; Apps Script calls answered by the real backend on the fake sheet (tests/harness.js)
// through page.route — nothing leaves this machine. Not part of `npm test` (Playwright isn't a dependency):
//   node tests/browser/project-check.js
//   SHOTS=/some/folder node tests/browser/project-check.js     also saves screenshots there (don't commit them)
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
const SECRET = 'KitchenRenoKKK';

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

// ── the fake backend: the realistic fixture + one project with expenses in three months ──
function makeBackend() {
  const b = createBackend({ now: fixture.NOW });
  fixture.build(b);
  b.api({ action: 'addProject', name: SECRET, budget: 20000, startDate: '2026-09-01', endDate: '2026-12-31' });
  b.api({ action: 'addProject', name: 'Empty one', budget: 0 });
  const exp = (date, amount, category, note) => b.api({ action: 'addExpense', date, amount, category, account: 'Bank', projectId: SECRET, note });
  exp('2026-09-05', 8000, 'Shopping', 'Tiles');
  exp('2026-10-10', 3500, 'Shopping', 'Sink');
  exp('2026-10-12', 1200, 'Food', 'Lunch for the builders');
  exp('2026-11-20', 9000, 'Bills', 'Electrician');
  return b;
}
let backend = makeBackend();
let oldBackend = false;
let noStatusAction = false;                         // a backend from before setProjectStatus
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
    if (oldBackend && body.action === 'getProjectDetail') out = { ok: false, error: 'Unknown action: getProjectDetail' };
    else if (noStatusAction && body.action === 'setProjectStatus') out = { ok: false, error: 'Unknown action: setProjectStatus' };
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
async function openProject(page, name) {
  await page.evaluate(() => showPage('projects'));
  await page.waitForSelector('.project-card');
  await page.click('.project-card:has-text("' + name + '") .project-card-header');
  await page.waitForFunction(() => document.querySelector('#project-detail-modal.open') && !document.querySelector('#pd-body .spinner'), null, { timeout: 15000 });
}
async function shot(page, name) { if (SHOTS) await page.waitForTimeout(600), await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: false }); }
function step(name) { console.log('✓ ' + name); }

(async () => {
  const srv = await serve();
  const BASE = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch();

  {
    const { ctx, page, errors } = await newPage(browser);
    await setupAndUnlock(page, BASE);
    const netWorth = await page.textContent('#header-networth');
    await openProject(page, SECRET);
    const body = await page.textContent('#pd-body');
    const money = n => page.evaluate(x => fmtMoney(x), n);
    assert.match(await page.textContent('#pd-title'), new RegExp(SECRET));
    assert.ok(body.includes(await money(21700)), 'total spent across all months');
    assert.ok(body.includes('of ' + (await money(20000))) && body.includes((await money(1700)) + ' over'), 'budget and over');
    assert.ok(body.includes('4 expenses'));
    const cats = await page.$$eval('#pd-body .pd-row', rs => rs.map(r => r.textContent));
    assert.match(cats[0], /Shopping.*11,500.*53%/, 'biggest category first, with its share');
    assert.ok(cats.some(c => /November 2026.*9,000/.test(c)) && cats.some(c => /September 2026.*8,000/.test(c)), 'by month');
    const items = await page.$$eval('#pd-body .txn-item', es => es.map(e => e.textContent));
    assert.equal(items.length, 4, 'every expense, including other months');
    assert.match(items[0], /Electrician/); assert.match(items[3], /Tiles/);
    const heads = await page.$$eval('#pd-body .txn-date-header', es => es.map(e => e.textContent));
    assert.deepEqual(heads.map(h => h.replace(/฿.*/, '')), ['November 2026', 'October 2026', 'September 2026']);
    await shot(page, 'project-light');
    step('detail shows spent vs budget, category and month breakdowns, and every expense across months, newest first');

    // tap an expense from another month → its edit form opens, prefilled
    await page.click('#pd-body .txn-item:has-text("Tiles")');
    await page.waitForFunction(() => document.querySelector('#expense-modal.open') || document.querySelector('.modal-overlay.open'));
    const amt = await page.evaluate(() => { var i = document.querySelector('.modal-overlay.open input[type=number]'); return i ? i.value : ''; });
    assert.equal(+amt, 8000, 'edit form prefilled from the project list');
    assert.equal(await page.evaluate(() => document.getElementById('project-detail-modal').classList.contains('open')), false);
    await page.evaluate(() => document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open')));
    step('tapping an expense from an older month opens it for editing');

    // empty project; old backend
    await openProject(page, 'Empty one');
    assert.match(await page.textContent('#pd-body'), /No expenses in this project yet/);
    await page.evaluate(() => closeModal('project-detail-modal'));
    oldBackend = true;
    await page.click('.project-card:has-text("' + SECRET + '") .project-card-header');
    await page.waitForFunction(() => /Redeploy Apps Script/.test(document.getElementById('toast').textContent));
    oldBackend = false;
    await page.evaluate(() => closeModal('project-detail-modal'));
    assert.equal(await page.textContent('#header-networth'), netWorth, 'viewing changes nothing');
    step('an empty project says so; an old backend gets a redeploy message; net worth unchanged');

    // complete → hidden; Show completed; picker; editing keeps the project; reopen
    const cardNames = () => page.$$eval('#projects-list .project-card-name', es => es.map(e => e.textContent));
    await openProject(page, SECRET);
    await page.click('#pd-status-btn:has-text("Mark as completed")');
    await page.waitForFunction(() => !document.querySelector('#project-detail-modal.open'));
    await page.waitForFunction(s => !document.getElementById('projects-list').textContent.includes(s), SECRET);
    assert.deepEqual(await cardNames(), ['📁 Empty one'], 'the completed card is hidden');
    assert.match(await page.textContent('.projects-done-toggle'), /Show completed \(1\)/);
    assert.ok(calls.some(c => c.action === 'setProjectStatus' && c.status === 'completed' && c.key === SECRET));
    await page.evaluate(() => openExpenseForm());
    const opts = await page.$$eval('#fe-project option', os => os.map(o => o.textContent));
    assert.ok(!opts.some(o => o.includes(SECRET)), 'not offered for a new expense: ' + opts.join(' | '));
    await page.evaluate(() => document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open')));
    await page.click('.projects-done-toggle');
    assert.deepEqual(await cardNames(), ['📁 Empty one', '✓ ' + SECRET], 'shown again under the active ones');
    assert.match(await page.textContent('.project-card.completed .project-card-dates'), /✓ Completed/);
    await shot(page, 'projects-completed');
    await openProject(page, SECRET);
    assert.match(await page.textContent('#pd-actions'), /Completed on/);
    await page.click('#pd-body .txn-item:has-text("Electrician")');
    await page.waitForFunction(() => document.querySelector('#expense-modal.open'));
    assert.equal(await page.inputValue('#fe-project'), SECRET, 'editing keeps the completed project');
    assert.match(await page.$eval('#fe-project', s => s.options[s.selectedIndex].textContent), /\(completed\)/);
    await page.evaluate(() => document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open')));
    noStatusAction = true;
    await openProject(page, SECRET);
    await page.click('#pd-status-btn:has-text("Reopen")');
    await page.waitForFunction(() => /Redeploy Apps Script to complete projects/.test(document.getElementById('toast').textContent));
    noStatusAction = false;
    assert.equal(await page.isEnabled('#pd-status-btn'), true, 'the button works again after an old backend');
    await page.click('#pd-status-btn:has-text("Reopen")');
    await page.waitForFunction(s => !document.querySelector('#project-detail-modal.open') &&
      [].some.call(document.querySelectorAll('#projects-list .project-card:not(.completed) .project-card-name'), e => e.textContent.includes(s)), SECRET);
    assert.equal(await page.locator('.projects-done-toggle').count(), 0, 'no completed projects left: no toggle');
    assert.equal(await page.textContent('#header-networth'), netWorth, 'completing and reopening change nothing about money');
    step('Mark as completed hides the card; Show completed brings it back; not in the picker, but kept when editing; Reopen; old backend message');

    // lock clears it
    await openProject(page, SECRET);
    await page.evaluate(() => lockNow());
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    for (const s of [SECRET, 'Electrician', 'Tiles']) assert.ok(!html.includes(s), '"' + s + '" still in the page after lock');
    assert.equal(await page.evaluate(() => projectDetail), null);
    assert.equal(await page.evaluate(() => showCompletedProjects), false);
    assert.ok(!(await page.evaluate(() => JSON.stringify(Object.assign({}, localStorage)))).includes(SECRET));
    step('lock empties the detail view and projectDetail; nothing in plain localStorage');
    assert.deepEqual(errors, [], 'console errors');
    await ctx.close();
  }

  for (const scheme of ['light', 'dark']) {
    backend = makeBackend();
    const { ctx, page, errors } = await newPage(browser, { colorScheme: scheme });
    await setupAndUnlock(page, BASE);
    await openProject(page, SECRET);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw <= 390, 'no sideways scroll (' + sw + ')');
    const over = await page.$$eval('#pd-body .pd-row, #pd-body .txn-item', es => es.filter(e => e.getBoundingClientRect().right > 390.5).length);
    assert.equal(over, 0, 'rows fit the screen');
    await shot(page, 'project-' + scheme);
    assert.deepEqual(errors, [], 'console errors (' + scheme + ')');
    await ctx.close();
  }
  step('390 px light and dark: everything fits, no console errors');

  await browser.close();
  srv.close();
  console.log('\nAll project checks passed. Requests made: ' + calls.length + ' (all to the stub).');
})().catch(e => { console.error(e); process.exit(1); });
