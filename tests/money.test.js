// Money rules: balances, currencies, transfers, receivables. Run with `npm test`.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackend } = require('./harness');

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.006, (msg || '') + ` expected ${b}, got ${a}`);
function setup() {
  const b = createBackend();
  b.api({ action: 'addAccount', name: 'Daily Spend', type: 'bank', startingBalance: 1000 });
  b.api({ action: 'addAccount', name: 'Saving', type: 'bank', startingBalance: 100000 });
  b.api({ action: 'addAccount', name: 'USD acct', type: 'bank', startingBalance: 100, currency: 'usd', rate: 33 });
  const acc = name => b.api({ action: 'getAccounts' }).accounts.find(a => a.name === name);
  return { api: b.api, acc, sheets: b.sheets };
}

test('THB accounts: starting balance, expense and income', () => {
  const { api, acc } = setup();
  api({ action: 'addExpense', date: '2026-07-02', amount: 250, category: 'Food & Dining', account: 'Daily Spend' });
  api({ action: 'addIncome', date: '2026-07-03', amount: 500, category: 'Salary', account: 'Daily Spend' });
  near(acc('Daily Spend').balance, 1250);
});

test('foreign-currency account: balance in its own currency, value in THB', () => {
  const { api, acc } = setup();
  const usd = acc('USD acct');
  assert.equal(usd.currency, 'USD');
  assert.equal(usd.rate, 33);
  near(usd.balanceThb, 3300);
  near(api({ action: 'getAccounts' }).totalBalance, 1000 + 100000 + 3300, 'total in THB');
});

test('USD income and expense use the original USD amount', () => {
  const { api, acc } = setup();
  api({ action: 'addIncome', date: '2026-07-01', amount: 1613.04, category: 'Other Income', account: 'USD acct', origAmount: 48.88, currency: 'USD' });
  near(acc('USD acct').balance, 148.88);
  api({ action: 'addExpense', date: '2026-07-02', amount: 660, category: 'Shopping', account: 'USD acct', origAmount: 20, currency: 'USD' });
  near(acc('USD acct').balance, 128.88);
  assert.equal(api({ action: 'getExpenses', month: 7, year: 2026 }).expenses[0].origAmount, 20);
});

test('THB account spending in USD is charged the THB amount', () => {
  const { api, acc } = setup();
  api({ action: 'addExpense', date: '2026-07-05', amount: 721.7, category: 'Shopping', account: 'Daily Spend', origAmount: 21.4, currency: 'USD' });
  near(acc('Daily Spend').balance, 1000 - 721.7);
});

test('currency exchange uses the amount actually received', () => {
  const { api, acc } = setup();
  api({ action: 'addTransfer', date: '2026-07-03', amount: 3300, fromAccount: 'Daily Spend', toAccount: 'USD acct', receivedAmount: 100 });
  near(acc('USD acct').balance, 200);
  near(acc('Daily Spend').balance, 1000 - 3300);
});

test('transfer between currencies without a received amount converts by rates', () => {
  const { api, acc } = setup();
  api({ action: 'addTransfer', date: '2026-07-04', amount: 10, fromAccount: 'USD acct', toAccount: 'Daily Spend' });
  near(acc('USD acct').balance, 90);
  near(acc('Daily Spend').balance, 1330);
});

test('transfers do not change the total', () => {
  const { api } = setup();
  const before = api({ action: 'getAccounts' }).totalBalance;
  api({ action: 'addTransfer', date: '2026-07-04', amount: 5000, fromAccount: 'Saving', toAccount: 'Daily Spend' });
  near(api({ action: 'getAccounts' }).totalBalance, before);
});

test('receivable: lent money leaves the account, repayments come back, auto-settles', () => {
  const { api, acc } = setup();
  api({ action: 'addReceivable', date: '2026-07-20', amount: 30000, counterparty: 'Earth', account: 'Saving' });
  let r = api({ action: 'getReceivables' }).receivables[0];
  assert.ok(r.id, 'receivable has an id');
  assert.equal(r.left, 30000);
  near(acc('Saving').balance, 70000, 'lent money leaves the account');

  let res = api({ action: 'addRepayment', receivableId: r.id, date: '2026-08-28', amount: 3000, account: 'Daily Spend' });
  assert.ok(res.ok);
  assert.equal(res.left, 27000);
  near(acc('Daily Spend').balance, 4000, 'repayment lands in the chosen account');
  near(acc('Saving').balance, 70000, 'lender account stays down');

  res = api({ action: 'addRepayment', receivableId: r.id, amount: 99999 });
  assert.ok(!res.ok, 'cannot repay more than what is left');

  res = api({ action: 'addRepayment', receivableId: r.id, date: '2026-09-28', amount: 27000, account: 'Saving' });
  assert.ok(res.settled, 'paying the rest settles it');
  r = api({ action: 'getReceivables' }).receivables[0];
  assert.equal(r.status, 'settled');
  assert.equal(r.left, 0);
  near(acc('Saving').balance, 97000);
});

test('deleting a repayment reopens the receivable', () => {
  const { api } = setup();
  api({ action: 'addReceivable', date: '2026-07-20', amount: 1000, counterparty: 'Tir', account: 'Saving' });
  let r = api({ action: 'getReceivables' }).receivables[0];
  api({ action: 'addRepayment', receivableId: r.id, amount: 1000, account: 'Saving', date: '2026-08-01' });
  r = api({ action: 'getReceivables' }).receivables[0];
  assert.equal(r.status, 'settled');
  const rp = r.repayments[0];
  api({ action: 'deleteRepayment', rowIndex: rp.rowIndex, id: rp.id });
  r = api({ action: 'getReceivables' }).receivables[0];
  assert.equal(r.status, 'pending');
  assert.equal(r.left, 1000);
});

test('transaction list shows repayments and what is left', () => {
  const { api } = setup();
  api({ action: 'addReceivable', date: '2026-09-01', amount: 6000, counterparty: 'Earth', account: 'Saving' });
  const r = api({ action: 'getReceivables' }).receivables[0];
  api({ action: 'addRepayment', receivableId: r.id, date: '2026-09-10', amount: 3000, account: 'Daily Spend' });
  const t = api({ action: 'getAllTransactions', month: 9, year: 2026 }).transactions;
  assert.ok(t.some(x => x.type === 'repayment' && x.amount === 3000));
  assert.ok(t.some(x => x.type === 'receivable' && x.left === 3000));
});

test('wrong token is refused', () => {
  const { api } = setup();
  const res = api({ action: 'getAccounts', token: 'nope' });
  assert.equal(res.ok, false);
  assert.ok(res.auth);
});

test('bootstrap returns everything the app needs on start-up', () => {
  const { api } = setup();
  const res = api({ action: 'bootstrap', month: 10, year: 2026 });
  assert.ok(res.ok);
  assert.ok(res.accounts && res.accounts.accounts.length >= 3);
});
