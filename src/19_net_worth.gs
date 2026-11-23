// ── NET WORTH HISTORY ────────────────────────────────────────
// Month-end net worth for up to 24 months. Months with a saved snapshot use it (it has the real
// market value of your investments at the time). Earlier months are rebuilt from your transactions,
// with investments/assets at what you paid ("estimated").
function monthEnd(ym) { var y = parseInt(ym.substring(0, 4)), m = parseInt(ym.substring(5, 7)); return ymd(y, m, 31); }
function holdingsAt(asOf) {                         // value at cost of what you held on that date
  var byId = {}, kinds = {};
  sheetToRows(getSheet(SHEET.HOLDINGS), function(d){ return { id: String(d[0]), kind: String(d[2] || "other") }; })
    .forEach(function(h){ kinds[h.id] = HOLDING_KINDS[h.kind] || "asset"; });
  holdingTxnRows().filter(function(t){ return t.date && t.date <= asOf; })
    .sort(function(a, b){ return a.date === b.date ? a.rowIndex - b.rowIndex : a.date.localeCompare(b.date); })
    .forEach(function(t) {
      var h = byId[t.holdingId] || (byId[t.holdingId] = { qty: 0, cost: 0 });
      if (t.type === "buy") { h.qty += t.quantity; h.cost += t.amount; }
      else if (t.type === "sell") { var out = h.qty > 0 ? h.cost / h.qty * t.quantity : 0; h.qty -= t.quantity; h.cost -= out; if (h.qty < 1e-9) { h.qty = 0; h.cost = 0; } }
    });
  var r = { investments: 0, assets: 0 };
  Object.keys(byId).forEach(function(id){ r[kinds[id] === "investment" ? "investments" : "assets"] += byId[id].cost; });
  return r;
}
// Money people still owe you (advances, work expenses to be reimbursed) — counted in net worth.
// asOf "" = now; otherwise what was outstanding on that date.
function receivablesAt(asOf) {
  var tot = 0;
  loadReceivables().forEach(function(r) {
    if (!asOf) { if (r.status === "pending") tot += r.left; return; }
    if (!(r.status === "pending" || r.repayments.length) || !r.date || r.date > asOf) return;
    var back = r.repayments.reduce(function(s, rp){ return s + (rp.date && rp.date <= asOf ? rp.amount : 0); }, 0);
    tot += Math.max(0, r.amount - back);
  });
  return round2(tot);
}
// Today's net worth parts. Once an account is linked, Money Tracker's own holdings are not added:
// they are being moved to the Wealth Planner and are counted inside the linked accounts' values.
function liveNetWorth(acc, hld) {
  var linked = (acc.accounts || []).some(function(a){ return a.linked; });
  return { accounts: acc.totalBalance || 0, investments: linked ? 0 : hld.totals.investments,
           assets: linked ? 0 : hld.totals.assets, receivables: receivablesAt("") };
}
function netWorthHistory(live) {
  var thisMonth = todayStr().substring(0, 7);
  var saved = {};
  sheetToRows(getSheet(SHEET.NETWORTH), function(d){ return { month: String(d[0]).substring(0, 7), accounts: toFloat(d[2]), investments: toFloat(d[3]), assets: toFloat(d[4]), receivables: toFloat(d[6]) }; })
    .forEach(function(r){ if (/^\d{4}-\d{2}$/.test(r.month)) saved[r.month] = r; });
  // first month with any data
  var first = thisMonth;
  [SHEET.EXPENSES, SHEET.INCOME, SHEET.TRANSFERS].forEach(function(n) {
    sheetToRows(getSheet(n), function(d){ return formatDate(d[0]); }).forEach(function(dt){ if (dt && dt.substring(0, 7) < first) first = dt.substring(0, 7); });
  });
  Object.keys(saved).forEach(function(m){ if (m < first) first = m; });
  var months = [], y = parseInt(thisMonth.substring(0, 4)), m = parseInt(thisMonth.substring(5, 7));
  for (var k = 0; k < 24; k++) {
    var ym = y + "-" + pad2(m);
    if (ym < first) break;
    months.unshift(ym);
    m--; if (m < 1) { m = 12; y--; }
  }
  var linked = anyLinkedAccount();                 // D5: linked accounts already hold the investments, at cost
  var out = months.map(function(ym) {
    var row;
    if (ym === thisMonth && live) row = { accounts: live.accounts, investments: live.investments, assets: live.assets, receivables: live.receivables || 0, estimated: false, live: true };
    else if (saved[ym]) row = { accounts: saved[ym].accounts, investments: saved[ym].investments, assets: saved[ym].assets, receivables: saved[ym].receivables || 0, estimated: false };
    else {
      var end = monthEnd(ym), ab = accountBalances(end).accounts, h = linked ? { investments: 0, assets: 0 } : holdingsAt(end);
      var tot = ab.reduce(function(s, a){ return s + a.balance * a.rate; }, 0);
      row = { accounts: tot, investments: h.investments, assets: h.assets, receivables: receivablesAt(end), estimated: true };
    }
    row.month = ym;
    row.accounts = round2(row.accounts); row.investments = round2(row.investments); row.assets = round2(row.assets);
    row.receivables = round2(row.receivables || 0);
    row.netWorth = round2(row.accounts + row.investments + row.assets + row.receivables);
    return row;
  });
  return { ok: true, months: out };
}
function saveNetWorthSnapshot(v) {
  var sh = getSheet(SHEET.NETWORTH), ym = todayStr().substring(0, 7), last = sh.getLastRow(), row = 0;
  if (last >= 2) {
    var col = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < col.length; i++) if (String(col[i][0]).substring(0, 7) === ym) { row = i + 2; break; }
  }
  if (!row) row = last + 1;
  sh.getRange(row, 1, 1, 2).setNumberFormat("@");
  ensureHeaders(sh, 7, ["Receivables"]);
  var rc = round2(v.receivables || 0);
  sh.getRange(row, 1, 1, 7).setValues([[ym, todayStr(), round2(v.accounts), round2(v.investments), round2(v.assets),
    round2(v.accounts + v.investments + v.assets + rc), rc]]);
}

