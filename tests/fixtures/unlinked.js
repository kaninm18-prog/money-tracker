// A realistic sheet with nothing linked: every kind of row that moves a balance or net worth.
// Used by linked.test.js to prove step 4 changes nothing until an account is linked
// (the golden file was recorded from the code before step 4 by make-golden.js).
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
  const ptt = api({ action: 'addHoldingTxn', type: 'buy', holding: { name: 'PTT', kind: 'stock' }, quantity: 100, price: 30, account: 'Bank', date: '2026-06-10', fee: 15 });
  api({ action: 'addHoldingTxn', type: 'buy', holdingId: ptt.holdingId, quantity: 100, price: 40, account: 'Bank', date: '2026-08-10' });
  api({ action: 'addHoldingTxn', type: 'sell', holdingId: ptt.holdingId, quantity: 50, price: 45, account: 'Bank', date: '2026-09-15' });
  api({ action: 'addHoldingTxn', type: 'dividend', holdingId: ptt.holdingId, amount: 90, tax: 10, account: 'Bank', date: '2026-10-20' });
  api({ action: 'addHoldingTxn', type: 'buy', holding: { name: 'AAPL', kind: 'stock' }, quantity: 1, price: 7000, account: 'USD Broker', date: '2026-07-02', origAmount: 200, currency: 'USD' });
  api({ action: 'addHoldingTxn', type: 'buy', holding: { name: 'Car', kind: 'vehicle' }, quantity: 1, price: 500000, account: '', date: '2026-05-01' });
  api({ action: 'addTrade', ticket: '1', symbol: 'XAUUSD', side: 'buy', volume: 0.1, openTime: '2026-09-01 10:00', openPrice: 2000,
    closeTime: '2026-09-01 12:00', closePrice: 2005, commission: -2, swap: -1, profit: 50, account: 'USD Broker', currency: 'USD' });
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
    bootstrap: { accounts: boot.accounts, netWorth: boot.netWorth, holdingsTotals: boot.holdings.totals },
    reconcile: b.context.reconcileData(),
    sheetNames: Object.keys(b.sheets).sort(),
    savedSnapshots: b.sheets.NetWorthHistory.rows,
    income: b.sheets.Income.rows,
  };
}

module.exports = { NOW, build, snapshot };
