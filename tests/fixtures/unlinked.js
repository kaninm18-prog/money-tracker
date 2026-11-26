// A realistic sheet with nothing linked: every kind of row that moves a balance or net worth.
// Used by groups.test.js (display-only grouping must not move a balance).
'use strict';
const NOW = '2026-11-22T05:00:00Z';                 // fixed clock: noon in Thailand

function build(b) {
  const api = b.api;
  api({ action: 'addAccount', name: 'Bank', type: 'bank', startingBalance: 150000 });
  api({ action: 'addAccount', name: 'Wallet', type: 'wallet', startingBalance: 2000 });
  api({ action: 'addAccount', name: 'USD Broker', type: 'investment', startingBalance: 1000, currency: 'USD', rate: 35 });
  api({ action: 'addAccount', name: 'Card', type: 'credit', startingBalance: -1200, creditLimit: 50000, dueDay: 5, statementDay: 25 });
  api({ action: 'addExpense', date: '2026-06-03', amount: 420, category: 'Food & Dining', account: 'Wallet' });
  api({ action: 'addExpense', date: '2026-07-14', amount: 1800, category: 'Shopping', account: 'Card' });
  api({ action: 'addExpense', date: '2026-10-28', amount: 2500, category: 'Travel', account: 'Card' });
  api({ action: 'addExpense', date: '2026-11-02', amount: 700, category: 'Shopping', account: 'USD Broker', origAmount: 20, currency: 'USD' });
  api({ action: 'addIncome', date: '2026-06-25', amount: 60000, category: 'Salary', account: 'Bank' });
  api({ action: 'addIncome', date: '2026-10-25', amount: 60000, category: 'Salary', account: 'Bank' });
  api({ action: 'addIncome', date: '2026-09-01', amount: 350, category: 'Other Income', account: 'USD Broker', origAmount: 10, currency: 'USD' });
  api({ action: 'addTransfer', date: '2026-07-01', amount: 35000, fromAccount: 'Bank', toAccount: 'USD Broker', receivedAmount: 990 });
  api({ action: 'addTransfer', date: '2026-08-05', amount: 3000, fromAccount: 'Bank', toAccount: 'Wallet' });
  api({ action: 'addTransfer', date: '2026-11-05', amount: 1800, fromAccount: 'Bank', toAccount: 'Card' });
  api({ action: 'addReceivable', date: '2026-08-10', amount: 5000, counterparty: 'Earth', account: 'Bank' });
  const r = api({ action: 'getReceivables' }).receivables[0];
  api({ action: 'addRepayment', receivableId: r.id, date: '2026-09-10', amount: 2000, account: 'Wallet' });
  // a saved month: net worth history uses it instead of rebuilding
  api({ action: 'getNetWorthHistory' });
  b.sheets.NetWorthHistory.appendRow(['2026-08', '2026-08-31', 180000, 9000, 500000, 689000, 5000]);
}

// Everything the hard rule covers, as plain JSON
function snapshot(b) {
  const api = b.api;
  const boot = api({ action: 'bootstrap', month: 11, year: 2026 });
  const after = api({ action: 'getAccounts' });
  return {
    getAccounts: after,
    netWorthHistory: api({ action: 'getNetWorthHistory' }),
    bootstrap: { accounts: boot.accounts, netWorth: boot.netWorth },
    reconcile: b.context.reconcileData(),
    sheetNames: Object.keys(b.sheets).sort(),
    savedSnapshots: b.sheets.NetWorthHistory.rows,
    income: b.sheets.Income.rows,
  };
}

module.exports = { NOW, build, snapshot };
