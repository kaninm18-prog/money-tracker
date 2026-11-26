// Account groups: column 10 "Group" of Accounts, its defaults, and renameAccountGroup. Run with `npm test`.
// Grouping is display only: balances and totals must not move.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackend } = require('./harness');
const fixture = require('./fixtures/unlinked');

const plain = x => JSON.parse(JSON.stringify(x));

function setup() {
  const b = createBackend({ now: fixture.NOW });
  const accounts = () => plain(b.api({ action: 'getAccounts' }));
  // (a new sheet starts with the built-in Cash and Investment accounts)
  const groups = () => Object.fromEntries(accounts().accounts.filter(a => a.name !== 'Cash' && a.name !== 'Investment').map(a => [a.name, a.group]));
  const acc = name => accounts().accounts.find(a => a.name === name);
  const row = name => plain(b.sheets.Accounts.rows.find(r => r[0] === name));
  return Object.assign(b, { accounts, groups, acc, row });
}

test('an empty group is the default for the type, worked out on read and not written back', () => {
  const b = setup();
  for (const [name, type] of [['B', 'bank'], ['C', 'credit'], ['Ca', 'cash'], ['W', 'wallet'], ['I', 'investment'], ['X', 'loan']])
    b.api({ action: 'addAccount', name, type, startingBalance: 0 });
  b.api({ action: 'addAccount', name: 'L', type: 'investment', startingBalance: 0, linkedTo: 'Broker' });
  assert.deepEqual(b.groups(), { B: 'Bank accounts', C: 'Credit cards', Ca: 'Cash & wallets', W: 'Cash & wallets',
                        I: 'Investments', X: 'Other', L: 'Investments' });
  b.sheets.Accounts.rows.slice(1).forEach(r => assert.ok(!r[9], 'nothing written to Group for ' + r[0]));
  assert.ok(!b.sheets.Accounts.rows[0][9], 'no Group header until a group is saved');
});

test('addAccount saves a custom group in column 10 (header added), keeping LinkedTo empty', () => {
  const b = setup();
  const r = b.api({ action: 'addAccount', name: 'KBank', type: 'bank', startingBalance: 100, group: '  Thai  banks ' });
  assert.equal(r.ok, true);
  assert.equal(r.group, 'Thai banks');
  assert.equal(b.row('KBank')[8], '', 'LinkedTo stays empty');
  assert.equal(b.row('KBank')[9], 'Thai banks');
  assert.equal(b.sheets.Accounts.rows[0][9], 'Group');
  assert.equal(b.acc('KBank').group, 'Thai banks');
  assert.equal(b.acc('KBank').linked, undefined, 'not linked');
  // The type's own default is stored as empty, so a later type change moves the account with it
  b.api({ action: 'addAccount', name: 'SCB', type: 'bank', startingBalance: 0, group: 'Bank accounts' });
  assert.ok(!b.row('SCB')[9]);
  assert.equal(b.acc('SCB').group, 'Bank accounts');
});

test('updateAccount: a sent group is saved; no group (older app) keeps the saved one', () => {
  const b = setup();
  b.api({ action: 'addAccount', name: 'KBank', type: 'bank', startingBalance: 100, group: 'Thai banks' });
  const base = { action: 'updateAccount', key: 'KBank', rowIndex: 2, name: 'KBank', type: 'bank', startingBalance: 100 };
  b.api(base);                                                   // older app: no group field
  assert.equal(b.acc('KBank').group, 'Thai banks');
  const r = b.api(Object.assign({}, base, { group: 'Everyday' }));
  assert.equal(r.group, 'Everyday');
  assert.equal(b.acc('KBank').group, 'Everyday');
  b.api(Object.assign({}, base, { group: '' }));                 // cleared → back to the default
  assert.equal(b.row('KBank')[9], '');
  assert.equal(b.acc('KBank').group, 'Bank accounts');
  b.api(Object.assign({}, base, { type: 'investment' }));        // default follows the type
  assert.equal(b.acc('KBank').group, 'Investments');
});

test('updateAccount keeps LinkedTo and Group independent', () => {
  const b = setup();
  b.api({ action: 'addAccount', name: 'KS', type: 'investment', startingBalance: 0, linkedTo: 'Kasikorn Securities', group: 'Brokers' });
  assert.deepEqual(b.row('KS').slice(8, 10), ['Kasikorn Securities', 'Brokers']);
  const base = { action: 'updateAccount', key: 'KS', rowIndex: 2, name: 'KS', type: 'investment', startingBalance: 0 };
  b.api(base);                                                   // neither sent: both kept
  assert.deepEqual(b.row('KS').slice(8, 10), ['Kasikorn Securities', 'Brokers']);
  b.api(Object.assign({}, base, { linkedTo: '' }));              // unlink: group kept
  assert.deepEqual(b.row('KS').slice(8, 10), ['', 'Brokers']);
  b.api(Object.assign({}, base, { linkedTo: 'X', group: 'Long term' }));
  assert.deepEqual(b.row('KS').slice(8, 10), ['X', 'Long term']);
});

test('renameAccountGroup renames custom and default groups on every account in them, and nothing else', () => {
  const b = setup();
  b.api({ action: 'addAccount', name: 'KBank', type: 'bank', startingBalance: 0 });
  b.api({ action: 'addAccount', name: 'SCB', type: 'bank', startingBalance: 0 });
  b.api({ action: 'addAccount', name: 'Wallet', type: 'wallet', startingBalance: 0, group: 'Everyday' });
  b.api({ action: 'addAccount', name: 'Card', type: 'credit', startingBalance: 0 });
  let r = b.api({ action: 'renameAccountGroup', from: 'Bank accounts', to: 'Everyday' });
  assert.deepEqual(plain(r), { ok: true, renamed: 2 });
  r = b.api({ action: 'renameAccountGroup', from: 'Everyday', to: 'Daily money' });
  assert.equal(r.renamed, 3);
  assert.deepEqual(b.groups(), { KBank: 'Daily money', SCB: 'Daily money', Wallet: 'Daily money', Card: 'Credit cards' });
  // Renaming to a type's own default stores it as empty again for accounts of that type
  b.api({ action: 'renameAccountGroup', from: 'Daily money', to: 'Bank accounts' });
  assert.equal(b.row('KBank')[9], '');
  assert.equal(b.row('Wallet')[9], 'Bank accounts');
  assert.equal(b.acc('Wallet').group, 'Bank accounts');
  assert.equal(b.api({ action: 'renameAccountGroup', from: 'Nope', to: 'X' }).renamed, 0);
  assert.equal(b.api({ action: 'renameAccountGroup', from: 'Credit cards', to: ' ' }).ok, false);
});

test('groups never change balances or totals', () => {
  const b = createBackend({ now: fixture.NOW });
  fixture.build(b);
  const before = plain(b.api({ action: 'getAccounts' }));
  const nwBefore = plain(b.api({ action: 'getNetWorthHistory' }));
  const names = before.accounts.map(a => a.name);
  names.forEach((n, i) => {
    const a = before.accounts[i];
    b.api({ action: 'updateAccount', key: n, rowIndex: a.rowIndex, name: n, type: a.type, startingBalance: a.startingBalance,
      creditLimit: a.creditLimit, dueDay: a.dueDay, statementDay: a.statementDay, currency: a.currency, rate: a.rate,
      group: i % 2 ? 'Odd' : 'Even' });
  });
  b.api({ action: 'renameAccountGroup', from: 'Odd', to: 'Renamed' });
  const after = plain(b.api({ action: 'getAccounts' }));
  assert.equal(after.totalBalance, before.totalBalance);
  after.accounts.forEach((a, i) => {
    assert.equal(a.group, i % 2 ? 'Renamed' : 'Even');
    const x = Object.assign({}, a), y = Object.assign({}, before.accounts[i]);
    delete x.group; delete y.group;
    assert.deepEqual(x, y);
  });
  assert.deepEqual(plain(b.api({ action: 'getNetWorthHistory' })), nwBefore);
});

test('group names match without regard to case or extra spaces; the first spelling (sheet order) is shown', () => {
  const b = setup();
  b.api({ action: 'addAccount', name: 'A', type: 'bank', startingBalance: 0, group: 'Travel' });
  b.api({ action: 'addAccount', name: 'B', type: 'wallet', startingBalance: 0, group: 'travel ' });
  b.api({ action: 'addAccount', name: 'C', type: 'cash', startingBalance: 0, group: '  TRAVEL' });
  b.api({ action: 'addAccount', name: 'D', type: 'bank', startingBalance: 0, group: 'bank ACCOUNTS' });     // the default, in another case
  b.api({ action: 'addAccount', name: 'E', type: 'wallet', startingBalance: 0, group: 'investments' });    // a default name on another type
  assert.deepEqual(b.groups(), { A: 'Travel', B: 'Travel', C: 'Travel', D: 'Bank accounts', E: 'Investments' });
  assert.ok(!b.row('D')[9], "the type's default in any case is stored empty");
  assert.deepEqual([b.row('B')[9], b.row('C')[9]], ['travel', 'TRAVEL'], 'cells keep what was typed (spaces tidied)');
});

test('renameAccountGroup matches the group in any case and with extra spaces', () => {
  const b = setup();
  b.api({ action: 'addAccount', name: 'A', type: 'bank', startingBalance: 0, group: 'Travel' });
  b.api({ action: 'addAccount', name: 'B', type: 'wallet', startingBalance: 0, group: 'travel ' });
  b.api({ action: 'addAccount', name: 'C', type: 'cash', startingBalance: 0, group: 'TRAVEL' });
  b.api({ action: 'addAccount', name: 'D', type: 'cash', startingBalance: 0, group: 'Travels' });
  assert.equal(b.api({ action: 'renameAccountGroup', from: ' tRaVeL  ', to: '  Trips   abroad ' }).renamed, 3);
  assert.deepEqual(b.groups(), { A: 'Trips abroad', B: 'Trips abroad', C: 'Trips abroad', D: 'Travels' });
  // A case-only rename works too
  assert.equal(b.api({ action: 'renameAccountGroup', from: 'Trips abroad', to: 'TRIPS ABROAD' }).renamed, 3);
  assert.equal(b.acc('B').group, 'TRIPS ABROAD');
  // A default group by another spelling
  b.api({ action: 'addAccount', name: 'K', type: 'credit', startingBalance: 0 });
  assert.equal(b.api({ action: 'renameAccountGroup', from: 'CREDIT CARDS', to: 'Cards' }).renamed, 1);
  assert.equal(b.acc('K').group, 'Cards');
  // Renaming into an existing group's name in another case merges them under one spelling
  b.api({ action: 'renameAccountGroup', from: 'travels', to: 'trips ABROAD' });
  assert.deepEqual(new Set(Object.values(b.groups())), new Set(['TRIPS ABROAD', 'Cards']));
});
