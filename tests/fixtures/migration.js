// A Money Tracker sheet shaped like Arm's investments before the Stage 4 migration (invented numbers):
//  • KBank (THB): salary, a gold-shop buy (with a fee) and sell, a fund bought from the bank whose
//    dividend is paid to the bank, and a USD card spend (foreign amount).
//  • MTS Gold (USD @ 34): a starting balance, transfers in and out, gold and an ETF bought and sold
//    there, a fee, a dividend, an interest Income row, closed and open trades, a receivable lent from it,
//    and a gold bar taken out (a no-account sell + a no-account Gold bar buy).
//  • A car with no account. Wallet: everyday spending.
// Used by tests/migration.test.js here and by the Wealth Planner's tests/migration.test.js.
'use strict';
const NOW = '2026-11-23T05:00:00Z';                 // noon in Thailand

const MAPPING = {
  accounts: {
    'MTS Gold (USD)': { link: true },
    KBank: { holdings: { 'Gold 96.5%': 'Gold shop', 'SCB Fund': 'SCB Fund' } },
  },
  brokers: {
    'MTS Gold (USD)': { currency: 'USD', rate: 34, dividendsTo: '' },
    'Gold shop': { currency: 'THB' },
    'SCB Fund': { currency: 'THB', dividendsTo: 'KBank' },
  },
  otherAssets: 'Other assets',
};

const PRICES = { 'Gold 96.5%': 43000, 'MTS Gold': 3600, 'GLD ETF': 1400, 'Gold bar': 14500, 'Car': 550000, 'SCB Fund': 12.5 };

function build(b) {
  const api = b.api;
  const ok = r => { if (!r || !r.ok) throw new Error('fixture: ' + JSON.stringify(r)); return r; };
  ok(api({ action: 'addAccount', name: 'KBank', type: 'bank', startingBalance: 300000 }));
  ok(api({ action: 'addAccount', name: 'Wallet', type: 'cash', startingBalance: 5000 }));
  ok(api({ action: 'addAccount', name: 'MTS Gold (USD)', type: 'investment', startingBalance: 1000, currency: 'USD', rate: 34 }));
  ok(api({ action: 'addIncome', date: '2026-01-25', amount: 80000, category: 'Salary', account: 'KBank' }));
  ok(api({ action: 'addIncome', date: '2026-06-25', amount: 80000, category: 'Salary', account: 'KBank' }));
  ok(api({ action: 'addExpense', date: '2026-02-03', amount: 650, category: 'Food & Dining', account: 'Wallet' }));
  ok(api({ action: 'addExpense', date: '2026-04-12', amount: 3417, category: 'Travel', account: 'KBank', origAmount: 100.5, currency: 'USD' }));
  ok(api({ action: 'addTransfer', date: '2026-03-01', amount: 34000, fromAccount: 'KBank', toAccount: 'MTS Gold (USD)', receivedAmount: 1000 }));
  ok(api({ action: 'addTransfer', date: '2026-10-01', amount: 100, fromAccount: 'MTS Gold (USD)', toAccount: 'KBank', receivedAmount: 3390 }));
  ok(api({ action: 'addTransfer', date: '2026-05-05', amount: 2000, fromAccount: 'KBank', toAccount: 'Wallet' }));
  ok(api({ action: 'addIncome', date: '2026-08-31', amount: 40.8, category: 'Other Income', note: 'Interest', account: 'MTS Gold (USD)', origAmount: 1.2, currency: 'USD' }));

  // the gold shop, paid straight from KBank
  const g = ok(api({ action: 'addHoldingTxn', type: 'buy', holding: { name: 'Gold 96.5%', kind: 'gold', unit: 'baht' }, quantity: 2, price: 40000,
    fee: 500, account: 'KBank', date: '2026-02-10' }));
  ok(api({ action: 'addHoldingTxn', type: 'sell', holdingId: g.holdingId, quantity: 1, price: 42000, account: 'KBank', date: '2026-06-15' }));
  // a fund bought from the bank, dividend paid to the bank
  const f = ok(api({ action: 'addHoldingTxn', type: 'buy', holding: { name: 'SCB Fund', kind: 'fund' }, quantity: 1000, price: 10, account: 'KBank', date: '2026-03-20' }));
  ok(api({ action: 'addHoldingTxn', type: 'dividend', holdingId: f.holdingId, amount: 270, tax: 30, account: 'KBank', date: '2026-09-20' }));

  // MTS Gold (USD)
  const m = ok(api({ action: 'addHoldingTxn', type: 'buy', holding: { name: 'MTS Gold', kind: 'gold', unit: 'g' }, quantity: 10, price: 3400,
    origAmount: 1000, currency: 'USD', fee: 34, feeOrig: 1, account: 'MTS Gold (USD)', date: '2026-03-05' }));
  ok(api({ action: 'addHoldingTxn', type: 'sell', holdingId: m.holdingId, quantity: 2, price: 3740, origAmount: 220, currency: 'USD',
    account: 'MTS Gold (USD)', date: '2026-05-01' }));
  const e = ok(api({ action: 'addHoldingTxn', type: 'buy', holding: { name: 'GLD ETF', kind: 'etf' }, quantity: 5, price: 1360, origAmount: 200, currency: 'USD',
    account: 'MTS Gold (USD)', date: '2026-04-01' }));
  ok(api({ action: 'addHoldingTxn', type: 'dividend', holdingId: e.holdingId, amount: 68, origAmount: 2, currency: 'USD', tax: 6.8,
    account: 'MTS Gold (USD)', date: '2026-09-01' }));
  // a gold bar taken out of MTS: the gold leaves with no cash, the bar is a new holding with no account
  ok(api({ action: 'addHoldingTxn', type: 'sell', holdingId: m.holdingId, quantity: 4, price: 3500, account: '', date: '2026-07-01' }));
  ok(api({ action: 'addHoldingTxn', type: 'buy', holding: { name: 'Gold bar', kind: 'gold', unit: 'bar' }, quantity: 1, price: 14000, account: '', date: '2026-07-01' }));
  // the car: no account, no cash
  ok(api({ action: 'addHoldingTxn', type: 'buy', holding: { name: 'Car', kind: 'vehicle' }, quantity: 1, price: 600000, account: '', date: '2025-12-01' }));
  // trades on MTS (USD): two closed, one still open
  ok(api({ action: 'addTrade', ticket: '1001', symbol: 'XAUUSD', side: 'buy', volume: 0.1, openTime: '2026-06-02 10:00', openPrice: 2300,
    closeTime: '2026-06-02 15:00', closePrice: 2303.5, commission: -3, swap: -1.5, profit: 35, account: 'MTS Gold (USD)', currency: 'USD' }));
  ok(api({ action: 'addTrade', ticket: '1002', symbol: 'XAUUSD', side: 'sell', volume: 0.05, openTime: '2026-07-10 09:00', openPrice: 2350,
    closeTime: '2026-07-11 09:00', closePrice: 2352, commission: -1.5, swap: -0.75, profit: -10, account: 'MTS Gold (USD)', currency: 'USD' }));
  ok(api({ action: 'addTrade', ticket: '1003', symbol: 'XAUUSD', side: 'buy', volume: 0.1, openTime: '2026-11-20 09:00', openPrice: 2400,
    account: 'MTS Gold (USD)', currency: 'USD' }));
  // a receivable lent from MTS (1700 THB = 50 USD), half repaid into MTS, the rest pending
  ok(api({ action: 'addReceivable', date: '2026-08-01', amount: 1700, counterparty: 'Friend', account: 'MTS Gold (USD)' }));
  const r = api({ action: 'getReceivables' }).receivables[0];
  ok(api({ action: 'addRepayment', receivableId: r.id, date: '2026-09-15', amount: 850, account: 'MTS Gold (USD)' }));
  // today's prices (held fixed: the Wealth Planner gets the same Holdings tab)
  api({ action: 'getHoldings' }).holdings.forEach(h => ok(api({ action: 'updateHolding', id: h.id, rowIndex: h.rowIndex, currentPrice: PRICES[h.name], priceDate: '2026-11-22' })));
  ok(api({ action: 'setTargets', targets: { Gold: 60, Funds: 40 } }));
  ok(api({ action: 'bootstrap', month: 11, year: 2026 }));
}

module.exports = { NOW, MAPPING, PRICES, build };
