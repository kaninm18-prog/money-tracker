// Stage 4 step 7: the investment code now lives in the Wealth Planner. Money Tracker's balances and
// net worth are accounts + what is owed to you; the old actions are gone. Run with `npm test`.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackend } = require('./harness');

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.006, (msg || '') + ` expected ${b}, got ${a}`);
function setup() {
  const b = createBackend({ now: '2026-11-22T05:00:00Z' });
  b.api({ action: 'addAccount', name: 'Bank', type: 'bank', startingBalance: 100000 });
  b.api({ action: 'addAccount', name: 'USD Acc', type: 'bank', startingBalance: 1000, currency: 'USD', rate: 35 });
  return b;
}

test('the removed investment actions answer "Unknown action"', () => {
  const b = setup();
  ['getHoldings', 'addHolding', 'updateHolding', 'deleteHolding', 'addHoldingTxn', 'deleteHoldingTxn',
   'getTrades', 'addTrade', 'deleteTrade', 'importTrades', 'setTargets', 'setBenchmark'].forEach(action => {
    const r = b.api({ action });
    assert.equal(r.ok, false, action);
    assert.match(r.error, /Unknown action/, action);
  });
});

test('net worth = accounts + owed to you (live and rebuilt months), bootstrap has no holdings', () => {
  const b = setup();
  b.api({ action: 'addExpense', date: '2026-09-02', amount: 500, category: 'Other', account: 'Bank' });
  b.api({ action: 'addReceivable', date: '2026-10-01', amount: 2000, counterparty: 'Ben', type: 'advance', account: 'Bank' });
  const res = b.api({ action: 'bootstrap', month: 11, year: 2026 });
  assert.equal(res.holdings, undefined); assert.equal(res.portfolio, undefined);
  near(res.accounts.totalBalance, 100000 - 500 - 2000 + 35000);
  const months = res.netWorth.months, live = months[months.length - 1];
  assert.ok(live.live);
  near(live.netWorth, res.accounts.totalBalance + 2000);
  const sep = months.find(m => m.month === '2026-09');
  assert.ok(sep.estimated);
  near(sep.investments, 0); near(sep.assets, 0);
  near(sep.netWorth, 100000 - 500 + 35000);
});

test('reconcile: one read-only snapshot of balances and net worth', () => {
  const b = setup();
  b.api({ action: 'addReceivable', date: '2026-10-01', amount: 2000, counterparty: 'Ben', type: 'advance', account: 'Bank' });
  b.api({ action: 'bootstrap', month: 11, year: 2026 });       // every tab exists, as on the live sheet
  const snapshot = () => JSON.stringify(Object.keys(b.sheets).sort().map(n => [n, b.sheets[n].rows]));
  const before = snapshot();
  const r = b.context.reconcile();
  assert.ok(r.ok);
  near(r.accounts.find(a => a.name === 'Bank').balance, 98000);
  const usd = r.accounts.find(a => a.name === 'USD Acc');
  assert.equal(usd.currency, 'USD'); near(usd.balance, 1000); near(usd.balanceThb, 35000);
  near(r.receivables, 2000);
  near(r.netWorth, r.totalBalance + 2000);
  assert.equal(r.holdings, undefined);
  assert.equal(snapshot(), before, 'nothing written to any sheet');
});

test('importing a file adds accounts only; an old file with investments is accepted and those parts ignored', () => {
  const b = setup();
  const res = b.api({ action: 'importPack', format: 'money-tracker-import',
    accounts: [{ name: 'Savings', type: 'bank', startingBalance: 500 }, { name: 'Bank' }],
    holdingTxns: [{ type: 'buy', holding: { name: 'PTT', kind: 'stock' }, quantity: 1, price: 30, date: '2026-01-01' }],
    trades: [{ ticket: '1', symbol: 'XAUUSD' }] });
  assert.ok(res.ok);
  assert.deepEqual(Array.from(res.accounts.added), ['Savings']);
  assert.deepEqual(Array.from(res.accounts.skipped), ['Bank']);
  assert.equal(b.sheets.Holdings, undefined);
});
