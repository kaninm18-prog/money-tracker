// ── ACCOUNTS ─────────────────────────────────────────────────

// Account balances, optionally "as of" a date (yyyy-MM-dd, inclusive) for net worth history.
// Uses today's exchange rates for foreign-currency accounts.
function accountBalances(asOf) {
  function on(d) { return !asOf || (d && d <= asOf); }
  var sh = getSheet(SHEET.ACCOUNTS);
  var accounts = sheetToRows(sh, function(d, ri) {
    var cur = String(d[6] || "THB").trim().toUpperCase() || "THB";
    var rate = cur === "THB" ? 1 : (toFloat(d[7]) || 1);
    return {
      rowIndex: ri, name: d[0], type: d[1],
      startingBalance: toFloat(d[2]), balance: toFloat(d[2]),
      creditLimit: toFloat(d[3]), dueDay: parseInt(d[4]) || 0, statementDay: parseInt(d[5]) || 0,
      currency: cur, rate: rate
    };
  });
  var byName = {};
  accounts.forEach(function(a){ byName[String(a.name||'').trim()] = a; });
  var expRows  = sheetToRows(getSheet(SHEET.EXPENSES), function(d){ return { date: formatDate(d[0]), amount: toFloat(d[1]), account: String(d[4]||'').trim(), orig: toFloat(d[8]), cur: String(d[9]||'').trim().toUpperCase() }; });
  var incRows  = sheetToRows(getSheet(SHEET.INCOME),   function(d){ return { date: formatDate(d[0]), amount: toFloat(d[1]), account: String(d[4]||'').trim(), orig: toFloat(d[5]), cur: String(d[6]||'').trim().toUpperCase() }; });
  var trfRows  = sheetToRows(getSheet(SHEET.TRANSFERS), function(d){ return { date: formatDate(d[0]), amount: toFloat(d[1]), from: String(d[2]||'').trim(), to: String(d[3]||'').trim(), received: toFloat(d[5]) }; });
  incRows.forEach(function(r){ if (!on(r.date)) return; var a = byName[r.account]; if (a) a.balance += amtForAccount(a, r.amount, r.orig, r.cur); });
  expRows.forEach(function(r){ if (!on(r.date)) return; var a = byName[r.account]; if (a) a.balance -= amtForAccount(a, r.amount, r.orig, r.cur); });
  trfRows.forEach(function(r){
    if (!on(r.date)) return;
    var f = byName[r.from], t = byName[r.to];
    if (f) f.balance -= r.amount;                       // amount is in the From account's currency
    if (t) {
      var got = r.received;
      if (!got) got = (f && f.currency !== t.currency) ? (r.amount * f.rate) / t.rate : r.amount;
      t.balance += got;
    }
  });
  // Assets & investments: buying takes cash out of the account, selling puts it back
  holdingTxnRows().forEach(function(t) {
    if (!on(t.date)) return;
    var a = byName[t.account]; if (!a) return;
    var amt = (t.origAmount && t.currency && t.currency === a.currency) ? t.origAmount   // exact USD moved
            : (a.currency === 'THB' ? t.amount : t.amount / a.rate);
    if (t.type === 'buy') a.balance -= amt;
    else if (t.type === 'sell') a.balance += amt;
  });
  // Trading journal: closed trades linked to an account add their net profit/loss (in the account's currency)
  tradeRows().forEach(function(t) {
    if (!t.closeTime || !t.account || !on(t.closeTime.substring(0, 10))) return;
    var a = byName[t.account]; if (a) a.balance += t.net;
  });
  // Receivables: money lent out leaves the account; each repayment goes back into the account it landed in.
  // (Old settled receivables without a repayment log count as fully returned, so they net to zero.)
  loadReceivables().forEach(function(r) {
    if ((r.status === 'pending' || r.repayments.length) && on(r.date)) {
      var a = byName[r.account]; if (a) a.balance -= (a.currency === 'THB' ? r.amount : r.amount / a.rate);
    }
    r.repayments.forEach(function(rp) {
      if (!on(rp.date)) return;
      var a = byName[rp.account || r.account]; if (a) a.balance += (a.currency === 'THB' ? rp.amount : rp.amount / a.rate);
    });
  });
  return { accounts: accounts, expRows: expRows, trfRows: trfRows };
}

function getAccounts() {
  var ab = accountBalances(""), accounts = ab.accounts, expRows = ab.expRows, trfRows = ab.trfRows;
  var today = todayStr();
  accounts.forEach(function(a) {
    if (a.type === "credit" && a.statementDay) a.statement = cardStatement(a, today, expRows, trfRows);
  });
  var total = 0;
  accounts.forEach(function(a) {
    a.balance = round2(a.balance);
    a.balanceThb = round2(a.balance * a.rate);
    total += a.balanceThb;
  });
  return jsonResponse({ ok: true, accounts: accounts, totalBalance: round2(total) });
}

function addAccount(p) {
  var sh = getSheet(SHEET.ACCOUNTS);
  var cur = String(p.currency || "THB").trim().toUpperCase() || "THB";
  ensureHeaders(sh, 7, ["Currency", "Rate"]);
  sh.appendRow([
    p.name || "", p.type || "bank", toFloat(p.startingBalance),
    p.type === "credit" ? toFloat(p.creditLimit) : "",
    p.type === "credit" ? (parseInt(p.dueDay) || "") : "",
    p.type === "credit" ? (parseInt(p.statementDay) || "") : "",
    cur, cur === "THB" ? 1 : (toFloat(p.rate) || 1)
  ]);
  return jsonResponse({ ok: true, rowIndex: sh.getLastRow() });
}

function updateAccount(p) {
  var sh  = getSheet(SHEET.ACCOUNTS);
  var row = resolveByKey(SHEET.ACCOUNTS, p);
  if (!row) return staleResponse();
  var cur = String(p.currency || "THB").trim().toUpperCase() || "THB";
  ensureHeaders(sh, 7, ["Currency", "Rate"]);
  sh.getRange(row, 1, 1, 8).setValues([[
    p.name || "", p.type || "bank", toFloat(p.startingBalance),
    p.type === "credit" ? toFloat(p.creditLimit) : "",
    p.type === "credit" ? (parseInt(p.dueDay) || "") : "",
    p.type === "credit" ? (parseInt(p.statementDay) || "") : "",
    cur, cur === "THB" ? 1 : (toFloat(p.rate) || 1)
  ]]);
  return jsonResponse({ ok: true });
}

function deleteAccount(p) {
  var sh  = getSheet(SHEET.ACCOUNTS);
  var row = resolveByKey(SHEET.ACCOUNTS, p);
  if (!row) return staleResponse();
  sh.deleteRow(row);
  return jsonResponse({ ok: true });
}

