// Linked investment accounts and the Wealth Planner exports (docs/stage-4-plan.md, section 3 / step 4).
// The Wealth Planner side is a second fake spreadsheet (harness `wealth`). Run with `npm test`.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackend, WEALTH_ID } = require('./harness');
const fixture = require('./fixtures/unlinked');

const plain = x => JSON.parse(JSON.stringify(x));     // objects made inside the backend's vm → plain JSON
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.006, (msg || '') + ` expected ${b}, got ${a}`);
const VALUES = ['Account', 'Currency', 'Value', 'ValueTHB', 'AsOf'];
const DIVS = ['Id', 'Date', 'Holding', 'Amount', 'OrigAmount', 'Currency', 'Tax', 'Account'];

// Bank (THB) + two linked brokers: "KS" (THB, Wealth Planner name "Kasikorn Securities") and "IB" (USD, "IBKR").
function setup(opts) {
  const b = createBackend(Object.assign({ now: fixture.NOW }, opts || {}));
  b.api({ action: 'addAccount', name: 'Bank', type: 'bank', startingBalance: 100000 });
  b.api({ action: 'addAccount', name: 'KS', type: 'investment', startingBalance: 0, linkedTo: 'Kasikorn Securities' });
  b.api({ action: 'addAccount', name: 'IB', type: 'investment', startingBalance: 0, currency: 'USD', rate: 35, linkedTo: 'IBKR' });
  b.props.WEALTH_SHEET_ID = WEALTH_ID;
  const accounts = () => b.api({ action: 'getAccounts' });
  const acc = name => accounts().accounts.find(a => a.name === name);
  const values = rows => b.wealth.setTab('_Export_Values', VALUES, rows);
  const dividends = rows => b.wealth.setTab('_Export_Dividends', DIVS, rows);
  const income = () => plain(b.sheets.Income.rows.slice(1));
  return Object.assign(b, { accounts, acc, values, dividends, income });
}

test('the account form saves LinkedTo in column 9; an older app that sends no linkedTo keeps it', () => {
  const b = setup();
  const rows = b.sheets.Accounts.rows;
  assert.equal(rows[0][8], 'LinkedTo');
  const ks = rows.find(r => r[0] === 'KS');
  assert.equal(ks[8], 'Kasikorn Securities');
  assert.equal(rows.find(r => r[0] === 'Bank').length, 8, 'unlinked rows are written as before');
  const a = b.acc('KS');
  b.api({ action: 'updateAccount', rowIndex: a.rowIndex, key: 'KS', name: 'KS', type: 'investment', startingBalance: 0 });
  assert.equal(b.acc('KS').linkedTo, 'Kasikorn Securities');
  const res = b.api({ action: 'updateAccount', rowIndex: a.rowIndex, key: 'KS', name: 'KS', type: 'investment', startingBalance: 0, linkedTo: '' });
  assert.equal(res.linkedTo, '');
  assert.equal(b.acc('KS').linked, undefined, 'unlinked again');
});

// ── Balances ────────────────────────────────────────────────
test('linked balance comes from _Export_Values; THB value from ValueTHB, else Value × rate', () => {
  const b = setup();
  b.values([['Kasikorn Securities', 'THB', 52000, 52000, '2026-11-21'], ['IBKR', 'USD', 1000, '', '2026-11-21']]);
  const ks = b.acc('KS'), ib = b.acc('IB');
  near(ks.balance, 52000); near(ks.balanceThb, 52000);
  assert.equal(ks.linked, true); assert.equal(ks.valueAsOf, '2026-11-21'); assert.equal(ks.stale, false);
  near(ib.balance, 1000); near(ib.balanceThb, 35000, 'no ValueTHB: Value × rate');
  b.values([['Kasikorn Securities', 'THB', 52000, 52000, '2026-11-21'], ['IBKR', 'USD', 1000, 36000, '2026-11-21']]);
  near(b.acc('IB').balanceThb, 36000, 'ValueTHB wins');
  near(b.accounts().totalBalance, 100000 + 52000 + 36000);
});

test('own flows on a linked account are not added on top of its value', () => {
  const b = setup();
  b.values([['Kasikorn Securities', 'THB', 52000, 52000, '2026-11-21']]);
  b.api({ action: 'addIncome', date: '2026-11-10', amount: 500, category: 'Investment Returns', account: 'KS' });
  b.api({ action: 'addExpense', date: '2026-11-10', amount: 50, category: 'Other', account: 'KS' });
  b.api({ action: 'addReceivable', date: '2026-11-10', amount: 1000, counterparty: 'Ben', account: 'KS' });
  near(b.acc('KS').balance, 52000);
});

test('a transfer into a linked account leaves the total unchanged, before and after the Wealth Planner sees it', () => {
  const b = setup();
  b.values([['Kasikorn Securities', 'THB', 52000, 52000, '2026-11-20'], ['IBKR', 'USD', 1000, 35000, '2026-11-20']]);
  const before = b.accounts().totalBalance;
  b.api({ action: 'addTransfer', date: '2026-11-21', amount: 10000, fromAccount: 'Bank', toAccount: 'KS' });
  b.api({ action: 'addTransfer', date: '2026-11-21', amount: 3500, fromAccount: 'Bank', toAccount: 'IB', receivedAmount: 99 });
  near(b.acc('KS').balance, 62000, 'not in the export yet: added on top');
  near(b.acc('IB').balance, 1099);
  near(b.acc('Bank').balance, 100000 - 13500);
  near(b.accounts().totalBalance, before - 3500 + 99 * 35, 'only the exchange-rate difference moves the total');
  // the Wealth Planner reads the flows and exports again: the deposits are now inside the value
  b.values([['Kasikorn Securities', 'THB', 62000, 62000, '2026-11-21'], ['IBKR', 'USD', 1099, 1099 * 35, '2026-11-21']]);
  near(b.acc('KS').balance, 62000, 'not counted twice');
  near(b.accounts().totalBalance, before - 3500 + 99 * 35);
  // THB to THB: exactly unchanged
  const t0 = b.accounts().totalBalance;
  b.api({ action: 'addTransfer', date: '2026-11-22', amount: 2000, fromAccount: 'KS', toAccount: 'Bank' });
  near(b.accounts().totalBalance, t0);
  near(b.acc('KS').balance, 60000);
});

test('net worth = accounts (linked ones at their Wealth Planner value) + owed to you', () => {
  const b = setup();
  b.values([['Kasikorn Securities', 'THB', 3200, 3200, '2026-11-21']]);
  b.api({ action: 'addReceivable', date: '2026-10-20', amount: 1000, counterparty: 'Ben', account: 'Bank' });
  const res = b.api({ action: 'bootstrap', month: 11, year: 2026 });
  const live = res.netWorth.months[res.netWorth.months.length - 1];
  assert.ok(live.live);
  assert.equal(live.investments, 0); assert.equal(live.assets, 0);
  near(res.accounts.totalBalance, 99000 + 3200);
  near(live.netWorth, res.accounts.totalBalance + 1000);
  const saved = b.sheets.NetWorthHistory.rows.find(r => r[0] === '2026-11');
  near(saved[3], 0); near(saved[4], 0); near(saved[5], live.netWorth, 'daily snapshot');
  b.run('dailyRefresh');
  const again = b.sheets.NetWorthHistory.rows.find(r => r[0] === '2026-11');
  near(again[5], live.netWorth, 'dailyRefresh snapshot');
  const r = b.context.reconcileData();
  near(r.netWorth, live.netWorth);
});

// ── When the Wealth Planner can't be read ───────────────────
test('export unreadable or missing: the cached value is used, marked stale, never 0', () => {
  const b = setup();
  b.values([['Kasikorn Securities', 'THB', 52000, 52000, '2026-11-20']]);
  near(b.acc('KS').balance, 52000);                         // fills the cache
  assert.ok(b.props.WEALTH_VALUES_CACHE);
  b.wealth.broken = true;
  b.api({ action: 'addTransfer', date: '2026-11-21', amount: 1000, fromAccount: 'Bank', toAccount: 'KS' });
  let ks = b.acc('KS');
  near(ks.balance, 53000, 'cached value + the transfer made since');
  assert.equal(ks.stale, true); assert.equal(ks.valueAsOf, '2026-11-20');
  near(b.acc('Bank').balance, 99000, 'the rest of the app keeps working');
  b.wealth.broken = false; b.wealth.removeTab('_Export_Values');
  ks = b.acc('KS');
  near(ks.balance, 53000); assert.equal(ks.stale, true);
  b.values([['Kasikorn Securities', 'THB', '', '', '2026-11-22']]);   // a blank value is unknown, not 0
  near(b.acc('KS').balance, 53000); assert.equal(b.acc('KS').stale, true);
  b.values([['Kasikorn Securities', 'THB', 0, 0, '2026-11-22']]);     // a real 0 (empty broker) is fine
  near(b.acc('KS').balance, 0); assert.equal(b.acc('KS').stale, false);
});

test('never read and no cache: valued at what was transferred in, marked unknown', () => {
  const b = setup();
  b.wealth.broken = true;
  b.api({ action: 'addTransfer', date: '2026-11-01', amount: 20000, fromAccount: 'Bank', toAccount: 'KS' });
  b.api({ action: 'addTransfer', date: '2026-11-05', amount: 5000, fromAccount: 'KS', toAccount: 'Bank' });
  const res = b.accounts(), ks = res.accounts.find(a => a.name === 'KS');
  assert.equal(ks.valueUnknown, true); assert.equal(ks.stale, true); assert.equal(ks.valueAsOf, '');
  near(ks.balance, 15000, 'not 0');
  near(res.totalBalance, 100000, 'the total is not silently lowered');
  delete b.props.WEALTH_SHEET_ID;                           // not set up at all: same
  near(b.acc('KS').balance, 15000);
});

// ── History (D5) ────────────────────────────────────────────
test('history: estimated months value a linked account at net transfers in', () => {
  const b = setup();
  b.values([['Kasikorn Securities', 'THB', 99000, 99000, '2026-11-21']]);
  b.api({ action: 'addTransfer', date: '2026-08-05', amount: 30000, fromAccount: 'Bank', toAccount: 'KS' });
  b.api({ action: 'addTransfer', date: '2026-09-20', amount: 4000, fromAccount: 'KS', toAccount: 'Bank' });
  b.api({ action: 'addIncome', date: '2026-09-25', amount: 700, category: 'Investment Returns', account: 'KS' });  // in the value already
  const months = b.api({ action: 'getNetWorthHistory' }).months, m = ym => months.find(x => x.month === ym);
  assert.equal(months[0].month, '2026-08');
  assert.ok(m('2026-08').estimated);
  near(m('2026-08').accounts, 100000, 'bank −30000, KS +30000 at cost: the transfer moves nothing');
  near(m('2026-08').investments, 0);
  near(m('2026-09').accounts, 100000);
  const ac = b.context.accountBalances('2026-09-30').accounts.find(a => a.name === 'KS');
  near(ac.balance, 26000, '30000 in − 4000 out; the dividend income is skipped');
  near(b.context.accountBalances('2026-07-31').accounts.find(a => a.name === 'KS').balance, 0);
});

// ── _Export_LinkedFlows ─────────────────────────────────────
test('_Export_LinkedFlows: one row per transfer into (+) or out of (−) a linked account', () => {
  const b = setup();
  b.api({ action: 'addTransfer', date: '2026-11-01', amount: 20000, fromAccount: 'Bank', toAccount: 'KS', id: 'T1' });
  b.api({ action: 'addTransfer', date: '2026-11-02', amount: 3500, fromAccount: 'Bank', toAccount: 'IB', receivedAmount: 99.5, id: 'T2' });
  b.api({ action: 'addTransfer', date: '2026-11-03', amount: 700, fromAccount: 'Bank', toAccount: 'IB', id: 'T3' });
  b.api({ action: 'addTransfer', date: '2026-11-04', amount: 10, fromAccount: 'IB', toAccount: 'Bank', id: 'T4' });
  b.api({ action: 'addTransfer', date: '2026-11-05', amount: 500, fromAccount: 'Bank', toAccount: 'Cash', id: 'T5' });
  b.api({ action: 'bootstrap', month: 11, year: 2026 });
  const sh = b.sheets._Export_LinkedFlows;
  assert.ok(sh.hidden);
  assert.deepEqual(plain(sh.rows), [
    ['Id', 'Date', 'Account', 'Amount', 'Currency'],
    ['T1', '2026-11-01', 'Kasikorn Securities', 20000, 'THB'],
    ['T2', '2026-11-02', 'IBKR', 99.5, 'USD'],        // the amount actually received
    ['T3', '2026-11-03', 'IBKR', 20, 'USD'],          // no received amount: 700 THB ÷ 35
    ['T4', '2026-11-04', 'IBKR', -10, 'USD'],
  ]);
  // rebuilt whole: a deleted transfer disappears
  const t1 = b.api({ action: 'getTransfers' }).transfers.find(t => t.id === 'T1');
  b.api({ action: 'deleteTransfer', rowIndex: t1.rowIndex, id: 'T1' });
  b.run('dailyRefresh');
  assert.deepEqual(sh.rows.map(r => r[0]), ['Id', 'T2', 'T3', 'T4']);
});

// ── Dividends (D3) ──────────────────────────────────────────
test('dividends: paid to a bank raise its balance; paid to the broker are a record only', () => {
  const b = setup();
  b.values([['Kasikorn Securities', 'THB', 52000, 52000, '2026-11-21'], ['IBKR', 'USD', 1000, 35000, '2026-11-21']]);
  b.dividends([
    ['WD1', '2026-11-10', 'PTT', 900, '', 'THB', 100, 'Bank'],
    ['WD2', '2026-11-11', 'SCB', 450, '', 'THB', 50, 'Kasikorn Securities'],   // paid to the broker (Wealth Planner name)
    ['WD3', '2026-11-12', 'AAPL', 350, 10, 'USD', 1.5, 'IBKR'],
  ]);
  const boot = b.api({ action: 'bootstrap', month: 11, year: 2026 });
  assert.ok(boot.ok);
  assert.deepEqual(b.income(), [
    ['2026-11-10', 900, 'Investment Returns', 'Dividend · PTT', 'Bank', '', '', 'WD1'],
    ['2026-11-11', 450, 'Investment Returns', 'Dividend · SCB', 'KS', '', '', 'WD2'],
    ['2026-11-12', 350, 'Investment Returns', 'Dividend · AAPL', 'IB', 10, 'USD', 'WD3'],
  ]);
  near(b.acc('Bank').balance, 100900);
  near(b.acc('KS').balance, 52000, 'already inside the Wealth Planner value');
  near(b.acc('IB').balance, 1000);
  near(b.api({ action: 'getSummary', month: 11, year: 2026 }).totalIncome, 1700, 'all three are in income reports');
  near(b.api({ action: 'getAnnualSummary', year: 2026 }).totalIncome, 1700);
});

test('dividend sync: twice adds nothing, changes update, removed ones go, your own Income is never touched', () => {
  const b = setup();
  b.api({ action: 'addIncome', date: '2026-11-01', amount: 60000, category: 'Salary', account: 'Bank' });
  b.api({ action: 'addIncome', date: '2026-11-02', amount: 90, category: 'Investment Returns', note: 'Dividend · PTT', account: 'Bank' });
  const mine = () => b.income().filter(r => !/^WD/.test(r[7]));
  const typed = JSON.stringify(mine());
  b.dividends([['WD1', '2026-11-10', 'PTT', 900, '', 'THB', 100, 'Bank'], ['WD2', '2026-11-11', 'SCB', 450, '', 'THB', 50, 'Bank'],
               ['X9', '2026-11-11', 'Not ours', 1, '', 'THB', 0, 'Bank']]);   // not a WD id: ignored
  b.api({ action: 'bootstrap', month: 11, year: 2026 });
  b.api({ action: 'bootstrap', month: 11, year: 2026 });
  b.run('dailyRefresh');
  assert.equal(b.income().length, 4, 'two typed + two synced, whatever the number of syncs');
  b.dividends([['WD1', '2026-11-10', 'PTT', 950, '', 'THB', 100, 'Bank']]);    // WD1 corrected, WD2 deleted in the Wealth Planner
  b.run('dailyRefresh');
  const wd = b.income().filter(r => /^WD/.test(r[7]));
  assert.deepEqual(wd, [['2026-11-10', 950, 'Investment Returns', 'Dividend · PTT', 'Bank', '', '', 'WD1']]);
  near(b.acc('Bank').balance, 100000 + 60000 + 90 + 950);
  b.wealth.broken = true;                                     // can't read the export: nothing is removed
  b.run('dailyRefresh');
  assert.equal(b.income().filter(r => /^WD/.test(r[7])).length, 1);
  b.wealth.broken = false; b.wealth.removeTab('_Export_Dividends');
  b.api({ action: 'bootstrap', month: 11, year: 2026 });
  assert.equal(b.income().filter(r => /^WD/.test(r[7])).length, 1, 'missing tab: nothing is removed');
  b.dividends([]);                                            // every dividend deleted in the Wealth Planner
  b.api({ action: 'bootstrap', month: 11, year: 2026 });
  assert.equal(b.income().filter(r => /^WD/.test(r[7])).length, 0);
  assert.equal(JSON.stringify(mine()), typed, 'typed Income unchanged throughout');
});

test('dividend sync only runs when WEALTH_SHEET_ID is set', () => {
  const b = setup();
  delete b.props.WEALTH_SHEET_ID;
  b.dividends([['WD1', '2026-11-10', 'PTT', 900, '', 'THB', 100, 'Bank']]);
  b.api({ action: 'bootstrap', month: 11, year: 2026 });
  assert.equal(b.income().length, 0);
  assert.equal(b.wealth.opened, 0);
});
