// ── RECONCILE (read-only) ────────────────────────────────────
// One snapshot of every balance and net worth, used to prove a big change (the Wealth Planner
// split, docs/stage-4-plan.md) moved nothing. Run `reconcile` from the Apps Script editor before
// and after, copy the logged JSON, and compare. It only reads; it never writes to the sheet.
function reconcileData() {
  var acc = JSON.parse(getAccounts().getContent()), rc = receivablesAt("");
  var accounts = acc.accounts.map(function(a) {
    var o = { name: String(a.name), type: String(a.type || ""), currency: a.currency, rate: a.rate, balance: a.balance, balanceThb: a.balanceThb };
    if (a.linked) { o.linkedTo = a.linkedTo; o.valueAsOf = a.valueAsOf; o.stale = a.stale; }
    return o;
  });
  return {
    ok: true, asOf: todayStr(),
    accounts: accounts, totalBalance: acc.totalBalance,
    receivables: rc,
    netWorth: round2(acc.totalBalance + rc)   // investments are inside the linked accounts
  };
}
function reconcile() {
  var r = reconcileData();
  Logger.log(JSON.stringify(r));
  return r;
}
