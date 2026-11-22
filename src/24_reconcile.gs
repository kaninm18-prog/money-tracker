// ── RECONCILE (read-only) ────────────────────────────────────
// One snapshot of every balance and net worth, used to prove a big change (the Wealth Planner
// split, docs/stage-4-plan.md) moved nothing. Run `reconcile` from the Apps Script editor before
// and after, copy the logged JSON, and compare. It only reads; it never writes to the sheet.
function reconcileData() {
  var acc = JSON.parse(getAccounts().getContent()), hld = holdingsData(), rc = receivablesAt(""), live = liveNetWorth(acc, hld);
  var accounts = acc.accounts.map(function(a) {
    var o = { name: String(a.name), type: String(a.type || ""), currency: a.currency, rate: a.rate, balance: a.balance, balanceThb: a.balanceThb };
    if (a.linked) { o.linkedTo = a.linkedTo; o.valueAsOf = a.valueAsOf; o.stale = a.stale; }
    return o;
  });
  var holdings = hld.holdings.map(function(h) {
    return { id: h.id, name: h.name, kind: h.kind, group: h.group, quantity: h.quantity, cost: h.cost, value: h.value,
             realized: h.realized, dividends: h.dividends };
  });
  return {
    ok: true, asOf: todayStr(),
    accounts: accounts, totalBalance: acc.totalBalance,
    holdings: holdings, holdingTotals: { investments: hld.totals.investments, assets: hld.totals.assets, value: hld.totals.value, cost: hld.totals.cost },
    trades: tradeRows().map(function(t){ return { id: t.id, ticket: t.ticket, account: t.account, closeTime: t.closeTime, net: t.net }; }),
    receivables: rc,
    netWorth: round2(acc.totalBalance + live.investments + live.assets + rc)   // linked accounts: holdings are inside them
  };
}
function reconcile() {
  var r = reconcileData();
  Logger.log(JSON.stringify(r));
  return r;
}
