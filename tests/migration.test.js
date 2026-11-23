// Stage 4 step 5–6: migrationPlan, migrateToLinked, undoMigration and scripts/compare-reconcile.js
// (docs/stage-4-plan.md, C9; docs/stage-4-migration-runbook.md). Fake sheets only. Run with `npm test`.
// The end-to-end rehearsal also needs a Wealth Planner checkout next to this repo (or WEALTH_PLANNER_DIR);
// CI clones it there (see .github/workflows/checks.yml).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createBackend } = require('./harness');
const fixture = require('./fixtures/migration');
const { rehearse, findRepo, sheetDump } = require('./migration-rehearsal');
const { compare, parseReconcile } = require('../scripts/compare-reconcile');

const plain = x => JSON.parse(JSON.stringify(x));
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.006, (msg || '') + ` expected ${b}, got ${a}`);
const MAP = JSON.stringify(fixture.MAPPING);
const ROOT = path.join(__dirname, '..');
// a Wealth Planner with applyBrokerMapping (step 5); an older checkout skips the rehearsal, saying so
const WP_DIR = findRepo(ROOT, 'wealth-planner', path.join('src', '16_migration.gs'), 'WEALTH_PLANNER_DIR');

function built() { const b = createBackend({ now: fixture.NOW }); fixture.build(b); return b; }
const bal = (b, name) => plain(b.api({ action: 'getAccounts' })).accounts.find(a => a.name === name);
const mapWith = f => { const m = JSON.parse(MAP); f(m); return JSON.stringify(m); };

// ── The plan ─────────────────────────────────────────────────
test('migrationPlan: every change listed, the prediction keeps every bank to the cent, and it writes nothing', () => {
  const b = built(), dump = sheetDump(b.sheets);
  const p = plain(b.run('migrationPlan', MAP));
  assert.equal(p.ok, true, p.errors.join('; '));
  assert.deepEqual(p.links, [{ account: 'MTS Gold (USD)', linkTo: 'MTS Gold (USD)' }]);
  assert.deepEqual(p.creates.map(c => [c.account, c.linkTo, c.currency]), [['MTS Gold', 'MTS Gold', 'THB'], ['SCB Fund', 'SCB Fund', 'THB'], ['Other assets', 'Other assets', 'THB']]);
  assert.deepEqual(p.transfers.map(x => [x.date, x.from, x.to, x.amount, x.received]), [
    ['2026-02-10', 'KBank', 'MTS Gold', 80000, ''], ['2026-06-15', 'MTS Gold', 'KBank', 42000, ''], ['2026-03-20', 'KBank', 'SCB Fund', 10000, '']]);
  assert.deepEqual(p.rewrites.map(r => [r.type, r.holding, r.from, r.to]), [
    ['buy', 'Gold 96.5%', 'KBank', 'MTS Gold'], ['sell', 'Gold 96.5%', 'KBank', 'MTS Gold'],
    ['buy', 'SCB Fund', 'KBank', 'SCB Fund'], ['dividend', 'SCB Fund', 'KBank', 'SCB Fund']]);
  assert.deepEqual(p.caseA.filter(f => f.id).map(f => [f.kind, f.amount]), [
    ['opening', 1000], ['income', 1.2], ['income', 2], ['expense', -1], ['receivable', -50], ['repayment', 25]]);
  const pr = p.prediction;
  assert.equal(pr.netWorthDifference, 0); assert.equal(pr.marketDifference, 0);
  const acc = n => pr.accounts.find(a => a.name === n);
  near(acc('MTS Gold (USD)').balanceThb, 31125.3 + 21400, 'cash before + its gold and ETF');
  near(acc('MTS Gold').balanceThb, 43000); near(acc('SCB Fund').balanceThb, 12500);
  near(acc('Other assets').balanceThb, 550000 + 14500, 'car + gold bar (C7)');
  assert.equal(acc('KBank').balance, bal(b, 'KBank').balance);
  assert.match(p.report, /READY/);
  assert.deepEqual(sheetDump(b.sheets), dump, 'read-only');
  assert.equal(b.props.MIGRATION_PLAN_HASH, p.hash, 'remembers what it showed');
});

test('migrationPlan reads the mapping from the Script Property when none is passed', () => {
  const b = built();
  b.props.MIGRATION_MAPPING = MAP;
  assert.equal(b.run('migrationPlan').ok, true);
  delete b.props.MIGRATION_MAPPING;
  assert.match(plain(b.run('migrationPlan')).errors[0], /No mapping/);
});

test('migrationPlan refuses, clearly, anything unmapped or ambiguous — and migrateToLinked then changes nothing', () => {
  const cases = [
    [mapWith(m => { delete m.accounts.KBank; }), /Not in the mapping: 2 entries of KBank · Gold 96\.5%/],
    [mapWith(m => { delete m.accounts.KBank.holdings['SCB Fund']; }), /Not in the mapping: 2 entries of KBank · SCB Fund/],
    [mapWith(m => { delete m.brokers['MTS Gold']; }), /broker "MTS Gold" is missing/],
    [mapWith(m => { delete m.otherAssets; }), /held with no broker.*otherAssets/],
    [mapWith(m => { m.brokers['MTS Gold (USD)'].rate = 35; }), /rate 35 differs from the account's rate 34/],
    [mapWith(m => { m.brokers['MTS Gold (USD)'].currency = 'THB'; }), /kept in USD but its broker .* is in THB/],
    [mapWith(m => { m.accounts.KBank.holdings['Gold 99%'] = 'MTS Gold'; }), /no holding called "Gold 99%"/],
    [mapWith(m => { m.accounts.Nowhere = { link: true }; }), /"Nowhere" is not an account/],
    [mapWith(m => { m.accounts.KBank.holdings['Gold 96.5%'] = 'Wallet'; m.brokers.Wallet = {}; }), /"Wallet" is already an account that isn't linked/],
    [mapWith(m => { m.brokers['MTS Gold'].dividendsTo = 'Bank X'; }), /dividendsTo "Bank X" is not an account/],
    [mapWith(m => { m.brokers.USDshop = { currency: 'USD' }; }), /needs "rate"/],
    ['{ not json', /not valid JSON/],
  ];
  cases.forEach(([map, re]) => {
    const b = built(), dump = sheetDump(b.sheets);
    const p = plain(b.run('migrationPlan', map));
    assert.equal(p.ok, false, String(re));
    assert.ok(p.errors.some(e => re.test(e)), `${re} in ${JSON.stringify(p.errors)}`);
    assert.match(p.report, /NOT READY/);
    const r = plain(b.run('migrateToLinked', map));
    assert.equal(r.ok, false);
    assert.deepEqual(sheetDump(b.sheets), dump, 'nothing changed: ' + re);
  });
  // two holdings with the same name: the name is ambiguous, the Id is not
  const b = built();
  b.api({ action: 'addHoldingTxn', type: 'buy', holding: { name: 'Gold 96.5%', kind: 'gold' }, quantity: 1, price: 40000, account: 'Wallet', date: '2026-02-11' });
  const p = plain(b.run('migrationPlan', MAP));
  assert.ok(p.errors.some(e => /2 holdings are called "Gold 96\.5%" — use the Id/.test(e)), p.errors.join('; '));
  // a trade on a bank can't become a transfer
  const t = built();
  t.api({ action: 'addTrade', ticket: '7', symbol: 'XAUUSD', side: 'buy', volume: 0.1, openTime: '2026-06-02 10:00', openPrice: 1,
    closeTime: '2026-06-02 11:00', closePrice: 1, profit: 1, account: 'KBank', currency: 'USD' });
  assert.ok(plain(t.run('migrationPlan', MAP)).errors.some(e => /Trade 7 is on "KBank".*trades can't become transfers/.test(e)));
});

test('migrateToLinked needs a READY plan on exactly this data', () => {
  const b = built();
  assert.match(plain(b.run('migrateToLinked', MAP)).error, /Run migrationPlan first/);
  b.run('migrationPlan', MAP);
  b.api({ action: 'addHoldingTxn', type: 'buy', holdingId: b.api({ action: 'getHoldings' }).holdings.find(h => h.name === 'Gold 96.5%').id,
    quantity: 1, price: 41000, account: 'KBank', date: '2026-11-20' });
  const dump = sheetDump(b.sheets);
  assert.match(plain(b.run('migrateToLinked', MAP)).error, /again: something changed/);
  assert.deepEqual(sheetDump(b.sheets), dump);
});

// ── Apply, twice, and undo ───────────────────────────────────
test('migrateToLinked: banks unchanged to the cent, every change logged; twice changes nothing more', () => {
  const b = built(), before = plain(b.context.reconcileData());
  const p = plain(b.run('migrationPlan', MAP));
  const r = plain(b.run('migrateToLinked', MAP));
  assert.equal(r.ok, true); assert.equal(r.applied, p.changes.length);
  const log = plain(b.sheets._MigrationLog.rows);
  assert.deepEqual(log[0], ['Seq', 'At', 'Action', 'Sheet', 'Key', 'Column', 'Before', 'After', 'Note']);
  assert.equal(log.length - 1, p.changes.length);
  ['KBank', 'Wallet', 'Cash', 'Investment'].forEach(n => {
    const x = before.accounts.find(a => a.name === n), y = bal(b, n);
    assert.equal(y.balance, x.balance, n); assert.equal(y.balanceThb, x.balanceThb, n);
  });
  const acc = plain(b.sheets.Accounts.rows);
  assert.equal(acc[0][8], 'LinkedTo');
  assert.equal(acc.find(a => a[0] === 'MTS Gold (USD)')[8], 'MTS Gold (USD)');
  assert.deepEqual(acc.find(a => a[0] === 'MTS Gold'), ['MTS Gold', 'investment', 0, '', '', '', 'THB', 1, 'MTS Gold']);
  const tx = plain(b.sheets.HoldingTxns.rows).filter(t => t[8] === 'KBank');
  assert.equal(tx.length, 0, 'no holding entry left on the bank');
  const fees = plain(b.sheets.Expenses.rows).filter(e => e[2] === 'Investment Fees');
  assert.deepEqual(fees.map(e => e[4]).sort(), ['KBank', 'MTS Gold (USD)'], 'fee rows stay where they were (C5)');
  const dump = sheetDump(b.sheets);
  const again = plain(b.run('migrateToLinked', MAP));
  assert.equal(again.ok, true); assert.equal(again.done, true);
  assert.deepEqual(sheetDump(b.sheets), dump, 'idempotent');
  assert.equal(plain(b.run('migrationPlan', MAP)).done, true, 'the plan says it is done');
});

test('undoMigration restores the exact pre-migration sheet', () => {
  const b = built(), dump = sheetDump(b.sheets);
  b.run('migrationPlan', MAP); b.run('migrateToLinked', MAP);
  const u = plain(b.run('undoMigration'));
  assert.equal(u.ok, true);
  assert.deepEqual(sheetDump(b.sheets), dump);
  assert.equal(plain(b.run('undoMigration')).undone, 0, 'nothing left to undo');
  // and it can be done again from there
  assert.equal(b.run('migrationPlan', MAP).ok, true);
  assert.equal(b.run('migrateToLinked', MAP).ok, true);
});

test('undoMigration changes nothing when something was added or edited since', () => {
  const b = built();
  b.run('migrationPlan', MAP); b.run('migrateToLinked', MAP);
  b.api({ action: 'addTransfer', date: '2026-11-23', amount: 1000, fromAccount: 'KBank', toAccount: 'MTS Gold', id: 'T-new' });
  let dump = sheetDump(b.sheets), u = plain(b.run('undoMigration'));
  assert.equal(u.ok, false);
  assert.ok(u.problems.some(x => /"MTS Gold" is used in Transfers by a row the migration didn't write \(T-new\)/.test(x)), u.problems.join('; '));
  assert.deepEqual(sheetDump(b.sheets), dump);
  const t = b.api({ action: 'getTransfers' }).transfers.find(x => x.id === 'T-new');
  b.api({ action: 'deleteTransfer', id: 'T-new', rowIndex: t.rowIndex });
  // a migrated entry moved by hand
  const row = b.sheets.HoldingTxns.rows.findIndex(r => r[8] === 'MTS Gold');
  b.sheets.HoldingTxns.rows[row][8] = 'Wallet';
  dump = sheetDump(b.sheets); u = plain(b.run('undoMigration'));
  assert.equal(u.ok, false);
  assert.ok(u.problems.some(x => /column 9 is now "Wallet"/.test(x)));
  assert.deepEqual(sheetDump(b.sheets), dump);
  b.sheets.HoldingTxns.rows[row][8] = 'MTS Gold';
  assert.equal(plain(b.run('undoMigration')).ok, true);
});

test('after the migration, investment entries are refused here (they belong in the Wealth Planner); undo lifts it', () => {
  const b = built();
  b.run('migrationPlan', MAP); b.run('migrateToLinked', MAP);
  const h = b.api({ action: 'getHoldings' }).holdings[0];
  const r = b.api({ action: 'addHoldingTxn', type: 'buy', holdingId: h.id, quantity: 1, price: 1, account: 'KBank', date: '2026-11-23' });
  assert.equal(r.ok, false); assert.match(r.error, /moved to the Wealth Planner/);
  assert.equal(b.api({ action: 'addTrade', symbol: 'X', volume: 1 }).ok, false);
  assert.equal(b.api({ action: 'addExpense', date: '2026-11-23', amount: 1, category: 'Other', account: 'KBank' }).ok, true, 'everything else works');
  b.api({ action: 'deleteExpense', id: b.api({ action: 'getExpenses' }).expenses.find(e => e.date === '2026-11-23').id });
  b.run('undoMigration');
  assert.equal(b.api({ action: 'addHoldingTxn', type: 'buy', holdingId: h.id, quantity: 1, price: 1, account: 'KBank', date: '2026-11-23' }).ok, true);
});

// ── The compare script (step 6) ──────────────────────────────
test('compare-reconcile: reads the editor log line, passes identical files, fails on every kind of change', () => {
  const b = built(), before = plain(b.context.reconcileData());
  assert.deepEqual(parseReconcile('12:00:01 PM\tInfo\t' + JSON.stringify(before)), before);
  assert.equal(compare(before, before).ok, true);
  const bad = (f, re) => { const a = plain(before); f(a); const r = compare(before, a); assert.equal(r.ok, false); assert.ok(r.fails.some(x => re.test(x)), r.fails.join('; ')); };
  bad(a => { a.accounts.find(x => x.name === 'KBank').balance += 0.01; }, /KBank: 375743\.00 THB .* → 375743\.01/);
  bad(a => { a.accounts = a.accounts.filter(x => x.name !== 'Wallet'); }, /Wallet: missing/);
  bad(a => { a.accounts.push({ name: 'New', currency: 'THB', balance: 0, balanceThb: 0 }); }, /New: a new account that isn't linked/);
  bad(a => { a.receivables += 1; a.netWorth += 1; }, /receivables 850\.00 → 851\.00/);
  bad(a => { a.netWorth += 5; }, /market-value difference 5\.00 THB is more than 0\.05/);         // holdings worth more
  bad(a => { a.netWorth += 5; a.totalBalance += 5; }, /net worth moved 5\.00 THB more than/);     // accounts don't add up
});

// ── The rehearsal: both apps' real code, end to end ──────────
const skip = WP_DIR ? false : 'no Wealth Planner checkout with src/16_migration.gs next to this repo (set WEALTH_PLANNER_DIR)';

test('REHEARSAL: the whole migration with both apps, banks to the cent, net worth unchanged, twice = once, undo = exact', { skip }, () => {
  const r = rehearse({ mtDir: ROOT, wpDir: WP_DIR, fixture, compare });
  assert.equal(r.plan.ok, true, (r.plan.errors || []).join('; '));
  assert.equal(r.applied.ok, true, (r.applied.errors || []).join('; '));
  // every unlinked balance identical to the cent
  r.before.accounts.forEach(x => {
    const y = r.after.accounts.find(a => a.name === x.name);
    if (y.linkedTo) return;
    assert.equal(y.balance, x.balance, x.name); assert.equal(y.balanceThb, x.balanceThb, x.name);
  });
  // each linked account = its cash + holdings before (prices held fixed)
  const after = n => r.after.accounts.find(a => a.name === n);
  const mts = after('MTS Gold (USD)');
  assert.equal(mts.stale, false); assert.equal(mts.valueAsOf, '2026-11-23');
  near(mts.balanceThb, 31125.3 + 10 * 0 + 4 * 3600 + 5 * 1400, 'MTS cash 915.45 USD + 4 g gold + 5 ETF');
  near(mts.balance, 915.45 + (4 * 3600 + 5 * 1400) / 34);
  near(after('MTS Gold').balanceThb, 43000, '1 baht of gold left, no cash: the transfers net out the buy and sell');
  near(after('SCB Fund').balanceThb, 12500, 'its dividend stayed on KBank (C5), not counted again');
  near(after('Other assets').balanceThb, 564500, 'car + gold bar');
  // net worth identical; the prediction was right
  assert.equal(r.after.netWorth, r.before.netWorth);
  assert.equal(r.compare.ok, true, r.compare.lines.join('\n'));
  r.plan.prediction.accounts.forEach(p => near(after(p.name).balanceThb, p.balanceThb, 'predicted ' + p.name));
  // twice = once, on both sides; and the loop again moves nothing
  assert.deepEqual(r.sheetMigratedAgain, r.sheetMigrated);
  assert.deepEqual(r.wpAfterApplyAgain, r.wpAfterApply);
  assert.deepEqual(r.afterAgain.accounts, r.after.accounts); assert.equal(r.afterAgain.netWorth, r.after.netWorth);
  // the Wealth Planner side: brokers from the mapping, entries at their brokers, ledger adds up
  const brokers = plain(r.wp.sheets.Brokers.rows).slice(1).map(x => [x[0], x[1], x[2]]);
  assert.deepEqual(brokers.sort(), [['MTS Gold', 'THB', ''], ['MTS Gold (USD)', 'USD', ''], ['SCB Fund', 'THB', 'KBank']].sort());
  assert.equal(r.exports.ledger.check.diff, 0);
  const flows = plain(r.mt.sheets._Export_LinkedFlows.rows);
  assert.ok(flows.some(f => f[0] === 'OPENING' && f[2] === 'MTS Gold (USD)' && f[3] === 1000), 'C9 opening row');
  // undo after the whole loop: the data tabs come back exactly, and so do the balances
  const u = plain(r.mt.run('undoMigration'));
  assert.equal(u.ok, true, (u.problems || []).join('; '));
  const core = ['Accounts', 'Transfers', 'HoldingTxns', 'Holdings', 'Trades', 'Expenses', 'Income', 'Receivables', 'ReceivableRepayments'];
  assert.deepEqual(sheetDump(r.mt.sheets, core), Object.fromEntries(core.filter(n => r.sheetBefore[n]).map(n => [n, r.sheetBefore[n]])));
  assert.ok(!r.mt.sheets._Export_LinkedFlows, 'no stale flows left for the Wealth Planner');
  const back = plain(r.mt.run('reconcile'));
  assert.deepEqual(back.accounts, r.before.accounts); assert.equal(back.netWorth, r.before.netWorth);
});

test('REHEARSAL guard: a bank transfer lost after the migration is caught by the compare script', { skip }, () => {
  const r = rehearse({ mtDir: ROOT, wpDir: WP_DIR, fixture, compare, afterMigrate: mt => {
    const i = mt.sheets.Transfers.rows.findIndex(x => String(x[6]).startsWith('MIG'));
    mt.sheets.Transfers.rows.splice(i, 1);
  } });
  assert.equal(r.compare.ok, false);
  assert.ok(r.compare.fails.some(f => /^KBank:/.test(f)), r.compare.fails.join('; '));
});

test('REHEARSAL guard: Wealth Planner prices that differ from Money Tracker\'s show as a market-value difference', { skip }, () => {
  const r = rehearse({ mtDir: ROOT, wpDir: WP_DIR, fixture, compare, beforeCopy: (mt, wp) => {
    const row = wp.sheets.Holdings.rows.find(x => x[1] === 'Gold 96.5%');
    row[5] = 43100;                                   // the Wealth Planner refreshed its gold price
  } });
  assert.equal(r.compare.ok, false);
  near(r.compare.market, 100);
  assert.ok(r.compare.fails.some(f => /market-value difference 100\.00 THB/.test(f)));
  assert.equal(compare(r.before, r.after, { maxMarket: 100 }).ok, true, 'accepted when Arm allows it');
});
