// Holdings, trades and net worth as they work today. These pin the behaviour before the
// investment code moves to the Wealth Planner (docs/stage-4-plan.md, step 1). Run with `npm test`.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackend } = require('./harness');

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.006, (msg || '') + ` expected ${b}, got ${a}`);
function setup() {
  const b = createBackend();
  b.api({ action: 'addAccount', name: 'Bank', type: 'bank', startingBalance: 100000 });
  b.api({ action: 'addAccount', name: 'USD Broker', type: 'bank', startingBalance: 1000, currency: 'USD', rate: 35 });
  const acc = name => b.api({ action: 'getAccounts' }).accounts.find(a => a.name === name);
  const holding = name => b.api({ action: 'getHoldings' }).holdings.find(h => h.name === name);
  const rows = name => (b.sheets[name] ? b.sheets[name].rows.slice(1) : []);
  // first buy creates the holding
  const buyNew = (name, kind, qty, price, account, date, extra) => b.api(Object.assign({ action: 'addHoldingTxn', type: 'buy',
    holding: { name, kind }, quantity: qty, price, account, date }, extra || {}));
  return { api: b.api, context: b.context, sheets: b.sheets, acc, holding, rows, buyNew };
}

test('buy takes cash out, sell puts it back; average cost, realised and unrealised', () => {
  const { api, acc, holding, buyNew } = setup();
  const r = buyNew('PTT', 'stock', 100, 30, 'Bank', '2026-01-10');
  assert.ok(r.ok);
  near(acc('Bank').balance, 97000);
  api({ action: 'addHoldingTxn', type: 'buy', holdingId: r.holdingId, quantity: 100, price: 40, account: 'Bank', date: '2026-02-10' });
  let h = holding('PTT');
  assert.equal(h.quantity, 200);
  near(h.cost, 7000); near(h.avgCost, 35);
  near(h.currentPrice, 40, 'latest trade price becomes the current price');
  near(h.value, 8000); near(h.unrealized, 1000);
  api({ action: 'addHoldingTxn', type: 'sell', holdingId: r.holdingId, quantity: 50, price: 50, account: 'Bank', date: '2026-03-10' });
  h = holding('PTT');
  assert.equal(h.quantity, 150);
  near(h.cost, 5250, 'sold units leave at average cost');
  near(h.realized, 750);
  near(h.value, 7500); near(h.unrealized, 2250);
  near(acc('Bank').balance, 100000 - 3000 - 4000 + 2500);
});

test('buys and sells are not spending or income', () => {
  const { api, rows, buyNew } = setup();
  const r = buyNew('PTT', 'stock', 10, 30, 'Bank', '2026-01-10');
  api({ action: 'addHoldingTxn', type: 'sell', holdingId: r.holdingId, quantity: 10, price: 35, account: 'Bank', date: '2026-01-20' });
  assert.equal(rows('Expenses').length, 0);
  assert.equal(rows('Income').length, 0);
  const list = api({ action: 'getAllTransactions', month: 1, year: 2026 }).transactions.filter(t => t.type === 'holding');
  assert.deepEqual(list.map(t => t.holdingTxnType).sort(), ['buy', 'sell']);
});

test('cannot sell more than you hold, or delete a buy a later sale needs', () => {
  const { api, holding, buyNew } = setup();
  const r = buyNew('Gold', 'gold', 2, 40000, 'Bank', '2026-01-10');
  const bad = api({ action: 'addHoldingTxn', type: 'sell', holdingId: r.holdingId, quantity: 3, price: 41000, account: 'Bank', date: '2026-01-11' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /only hold 2/);
  assert.equal(holding('Gold').quantity, 2);
  api({ action: 'addHoldingTxn', type: 'sell', holdingId: r.holdingId, quantity: 1, price: 41000, account: 'Bank', date: '2026-01-12' });
  const del = api({ action: 'deleteHoldingTxn', id: r.id });
  assert.equal(del.ok, false);
  assert.equal(holding('Gold').quantity, 1);
});

test('something you already owned: no account, no cash moves', () => {
  const { acc, holding, buyNew } = setup();
  const r = buyNew('Car', 'vehicle', 1, 500000, '', '2026-01-10');
  assert.ok(r.ok);
  near(acc('Bank').balance, 100000);
  assert.equal(holding('Car').group, 'asset');
  const fee = buyNew('Watch', 'electronics', 1, 10000, '', '2026-01-10', { fee: 100 });
  assert.equal(fee.ok, false, 'a fee needs an account to come out of');
});

test('fees are expenses in the same account; deleting the trade removes the fee', () => {
  const { api, acc, rows, buyNew } = setup();
  const r = buyNew('PTT', 'stock', 100, 30, 'Bank', '2026-01-10', { fee: 15 });
  const exp = rows('Expenses');
  assert.equal(exp.length, 1);
  assert.equal(exp[0][1], 15);
  assert.equal(exp[0][2], 'Investment Fees');
  assert.equal(exp[0][4], 'Bank');
  near(acc('Bank').balance, 100000 - 3000 - 15);
  near(api({ action: 'getHoldings' }).holdings[0].fees, 15);
  assert.ok(api({ action: 'deleteHoldingTxn', id: r.id }).ok);
  assert.equal(rows('Expenses').length, 0);
  near(acc('Bank').balance, 100000);
});

test('dividends are income; tax withheld is recorded; quantity unchanged', () => {
  const { api, acc, holding, rows, buyNew } = setup();
  const r = buyNew('PTT', 'stock', 100, 30, 'Bank', '2026-01-10');
  const d = api({ action: 'addHoldingTxn', type: 'dividend', holdingId: r.holdingId, amount: 90, tax: 10, account: 'Bank', date: '2026-04-20' });
  assert.ok(d.ok);
  const inc = rows('Income');
  assert.equal(inc.length, 1);
  assert.equal(inc[0][1], 90);
  assert.equal(inc[0][2], 'Investment Returns');
  near(acc('Bank').balance, 100000 - 3000 + 90);
  const h = holding('PTT');
  assert.equal(h.quantity, 100);
  near(h.dividends, 90); near(h.taxWithheld, 10); near(h.fees, 0);
  const noAcc = api({ action: 'addHoldingTxn', type: 'dividend', holdingId: r.holdingId, amount: 5, date: '2026-04-21' });
  assert.equal(noAcc.ok, false, 'a dividend needs an account');
});

test('deleting a holding removes its entries and their fee / dividend rows', () => {
  const { api, acc, rows, buyNew } = setup();
  const r = buyNew('PTT', 'stock', 100, 30, 'Bank', '2026-01-10', { fee: 15 });
  api({ action: 'addHoldingTxn', type: 'dividend', holdingId: r.holdingId, amount: 90, account: 'Bank', date: '2026-04-20' });
  assert.ok(api({ action: 'deleteHolding', id: r.holdingId }).ok);
  assert.equal(rows('Holdings').length, 0);
  assert.equal(rows('HoldingTxns').length, 0);
  assert.equal(rows('Expenses').length, 0);
  assert.equal(rows('Income').length, 0);
  near(acc('Bank').balance, 100000);
});

test('USD account: the exact USD amount moves when given, else THB ÷ rate', () => {
  const { acc, buyNew } = setup();
  buyNew('AAPL', 'stock', 1, 3600, 'USD Broker', '2026-01-10', { origAmount: 100, currency: 'USD' });
  near(acc('USD Broker').balance, 900, 'exact USD wins over 3600 / 35');
  buyNew('MSFT', 'stock', 1, 700, 'USD Broker', '2026-01-11');
  near(acc('USD Broker').balance, 880, '700 THB / 35 = 20 USD');
});

test('closed trades linked to an account add their net result; open or unlinked ones do not', () => {
  const { api, acc } = setup();
  api({ action: 'addTrade', ticket: '1', symbol: 'XAUUSD', side: 'buy', volume: 0.1, openTime: '2026-02-01 10:00', openPrice: 2000,
    closeTime: '2026-02-01 12:00', closePrice: 2005, commission: -2, swap: -1, profit: 50, account: 'USD Broker', currency: 'USD' });
  near(acc('USD Broker').balance, 1047, 'profit + commission + swap');
  api({ action: 'addTrade', ticket: '2', symbol: 'XAUUSD', side: 'buy', volume: 0.1, openTime: '2026-02-02 10:00', openPrice: 2000,
    profit: 0, account: 'USD Broker' });
  api({ action: 'addTrade', ticket: '3', symbol: 'XAUUSD', side: 'sell', volume: 0.1, openTime: '2026-02-03 10:00', openPrice: 2010,
    closeTime: '2026-02-03 11:00', closePrice: 2000, profit: 100 });
  near(acc('USD Broker').balance, 1047);
  const imp = api({ action: 'importTrades', account: 'USD Broker', trades: [{ ticket: '1', symbol: 'XAUUSD', volume: 0.1, profit: 50 }] });
  assert.equal(imp.added, 0, 'a ticket already saved is skipped');
});

// "yyyy-MM" of n months before this month (net-worth history only covers the last 24 months)
function monthsAgo(n) {
  const d = new Date(Date.now() + 7 * 3600e3);              // the backend's GMT+7 "today"
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1));
  return x.getUTCFullYear() + '-' + String(x.getUTCMonth() + 1).padStart(2, '0');
}

test('net worth: estimated months count holdings at cost, as of month end', () => {
  const { api, context, buyNew } = setup();
  const m1 = monthsAgo(3), m2 = monthsAgo(2);
  // history starts at the first expense / income / transfer — holding entries alone don't start it
  api({ action: 'addExpense', date: m1 + '-01', amount: 100, category: 'Other', account: 'Bank' });
  const r = buyNew('PTT', 'stock', 100, 30, 'Bank', m1 + '-10');
  buyNew('Car', 'vehicle', 1, 500000, '', m1 + '-15');
  api({ action: 'addHoldingTxn', type: 'buy', holdingId: r.holdingId, quantity: 100, price: 40, account: 'Bank', date: m2 + '-10' });
  api({ action: 'addHoldingTxn', type: 'sell', holdingId: r.holdingId, quantity: 100, price: 50, account: 'Bank', date: m2 + '-20' });
  const first = context.holdingsAt(m1 + '-31');
  near(first.investments, 3000); near(first.assets, 500000);
  near(context.holdingsAt(m2 + '-31').investments, 3500, 'after the sale: 100 left at average cost 35');
  const months = api({ action: 'getNetWorthHistory' }).months;
  assert.equal(months[0].month, m1);
  const m = months[0];
  assert.ok(m.estimated);
  near(m.accounts, 100000 - 100 - 3000 + 35000, 'Bank after the expense and buy + USD Broker in THB');
  near(m.netWorth, m.accounts + 3000 + 500000);
});

test('live net worth = accounts + holdings at market value + owed to you', () => {
  const { api, buyNew } = setup();
  buyNew('PTT', 'stock', 100, 30, 'Bank', '2026-01-10');
  api({ action: 'addReceivable', date: '2026-02-01', amount: 2000, counterparty: 'Ben', type: 'advance', account: 'Bank' });
  const res = api({ action: 'bootstrap', month: 2, year: 2026 });
  const live = res.netWorth.months[res.netWorth.months.length - 1];
  assert.ok(live.live);
  near(res.accounts.totalBalance, 97000 - 2000 + 35000);
  near(live.netWorth, res.accounts.totalBalance + res.holdings.totals.value + 2000);
});

test('reconcile: one read-only snapshot of balances and net worth', () => {
  const { api, context, sheets, buyNew } = setup();
  buyNew('PTT', 'stock', 100, 30, 'Bank', '2026-01-10');
  buyNew('Car', 'vehicle', 1, 500000, '', '2026-01-15');
  api({ action: 'addReceivable', date: '2026-02-01', amount: 2000, counterparty: 'Ben', type: 'advance', account: 'Bank' });
  api({ action: 'bootstrap', month: 2, year: 2026 });       // every tab exists, as on the live sheet
  const snapshot = () => JSON.stringify(Object.keys(sheets).sort().map(n => [n, sheets[n].rows]));
  const before = snapshot();
  const r = context.reconcile();
  assert.ok(r.ok);
  const bank = r.accounts.find(a => a.name === 'Bank'), usd = r.accounts.find(a => a.name === 'USD Broker');
  near(bank.balance, 95000);
  assert.equal(usd.currency, 'USD'); near(usd.balance, 1000); near(usd.balanceThb, 35000);
  near(r.holdingTotals.investments, 3000); near(r.holdingTotals.assets, 500000);
  near(r.receivables, 2000);
  near(r.netWorth, r.totalBalance + 3000 + 500000 + 2000);
  assert.equal(r.holdings.length, 2);
  assert.equal(snapshot(), before, 'nothing written to any sheet');
});
