// ── NET WORTH HISTORY ────────────────────────────────────────
// Month-end net worth for up to 24 months. Months with a saved snapshot use it (it has the real
// market value of your investments at the time). Earlier months are rebuilt from your transactions,
// ("estimated"). Investments are inside their linked accounts (at what was transferred in, D5).
function monthEnd(ym) { var y = parseInt(ym.substring(0, 4)), m = parseInt(ym.substring(5, 7)); return ymd(y, m, 31); }
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
// Today's net worth parts. Investments are inside the linked accounts' values (Wealth Planner), so the
// Investments and Assets columns stay for the saved history but are 0 from now on.
function liveNetWorth(acc) {
  return { accounts: acc.totalBalance || 0, investments: 0, assets: 0, receivables: receivablesAt("") };
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
  var out = months.map(function(ym) {
    var row;
    if (ym === thisMonth && live) row = { accounts: live.accounts, investments: live.investments, assets: live.assets, receivables: live.receivables || 0, estimated: false, live: true };
    else if (saved[ym]) row = { accounts: saved[ym].accounts, investments: saved[ym].investments, assets: saved[ym].assets, receivables: saved[ym].receivables || 0, estimated: false };
    else {
      var end = monthEnd(ym), ab = accountBalances(end).accounts;
      var tot = ab.reduce(function(s, a){ return s + a.balance * a.rate; }, 0);
      row = { accounts: tot, investments: 0, assets: 0, receivables: receivablesAt(end), estimated: true };
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

