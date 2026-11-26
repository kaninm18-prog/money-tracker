// ── ACCOUNTS ─────────────────────────────────────────────────

function accountFromRow(d, ri) {
  var cur = String(d[6] || "THB").trim().toUpperCase() || "THB";
  var rate = cur === "THB" ? 1 : (toFloat(d[7]) || 1);
  var a = {
    rowIndex: ri, name: d[0], type: d[1],
    startingBalance: toFloat(d[2]), balance: toFloat(d[2]),
    creditLimit: toFloat(d[3]), dueDay: parseInt(d[4]) || 0, statementDay: parseInt(d[5]) || 0,
    currency: cur, rate: rate
  };
  // Linked investment account (its value lives in the Wealth Planner). Only set when linked, so
  // accounts that aren't linked come back exactly as before.
  var linkedTo = String(d[8] || "").trim();
  if (linkedTo) { a.linked = true; a.linkedTo = linkedTo; }
  // Group (column 10): the user's own heading on the Accounts page. Empty = the default for the type,
  // worked out here and never written back, so changing the type moves the account with it.
  a.group = String(d[9] || "").trim() || defaultAccountGroup(a.type);
  return a;
}
var ACCOUNT_GROUP_DEFAULTS = { bank: "Bank accounts", credit: "Credit cards", cash: "Cash & wallets",
                               wallet: "Cash & wallets", investment: "Investments" };
function defaultAccountGroup(type) { return ACCOUNT_GROUP_DEFAULTS[type] || "Other"; }
// What goes in the Group cell: empty when it is just the type's default
function groupToStore(type, group) {
  var g = String(group || "").replace(/\s+/g, " ").trim();
  return g === defaultAccountGroup(type) ? "" : g;
}
function transferFromRow(d) {
  return { date: formatDate(d[0]), amount: toFloat(d[1]), from: String(d[2]||'').trim(), to: String(d[3]||'').trim(), received: toFloat(d[5]), id: String(d[6] || "") };
}
// What a transfer adds to the To account, in the To account's currency
function transferReceived(r, f, t) {
  if (r.received) return r.received;
  return (f && f.currency !== t.currency) ? (r.amount * f.rate) / t.rate : r.amount;
}

// Account balances, optionally "as of" a date (yyyy-MM-dd, inclusive) for net worth history.
// Uses today's exchange rates for foreign-currency accounts.
// Linked investment accounts (docs/stage-4-plan.md section 3) only move by transfers here: now, their
// balance is the Wealth Planner value (25_linked_accounts.gs); on past dates, what was transferred in.
// Their own income (dividends already inside that value), spending, holdings, trades and
// receivables are not added on top.
function accountBalances(asOf) {
  function on(d) { return !asOf || (d && d <= asOf); }
  function own(a) { return a && !a.linked; }
  var sh = getSheet(SHEET.ACCOUNTS);
  var accounts = sheetToRows(sh, accountFromRow);
  var byName = {};
  accounts.forEach(function(a){ byName[String(a.name||'').trim()] = a; });
  var expRows  = sheetToRows(getSheet(SHEET.EXPENSES), function(d){ return { date: formatDate(d[0]), amount: toFloat(d[1]), account: String(d[4]||'').trim(), orig: toFloat(d[8]), cur: String(d[9]||'').trim().toUpperCase() }; });
  var incRows  = sheetToRows(getSheet(SHEET.INCOME),   function(d){ return { date: formatDate(d[0]), amount: toFloat(d[1]), account: String(d[4]||'').trim(), orig: toFloat(d[5]), cur: String(d[6]||'').trim().toUpperCase() }; });
  var trfRows  = sheetToRows(getSheet(SHEET.TRANSFERS), transferFromRow);
  incRows.forEach(function(r){ if (!on(r.date)) return; var a = byName[r.account]; if (own(a)) a.balance += amtForAccount(a, r.amount, r.orig, r.cur); });
  expRows.forEach(function(r){ if (!on(r.date)) return; var a = byName[r.account]; if (own(a)) a.balance -= amtForAccount(a, r.amount, r.orig, r.cur); });
  trfRows.forEach(function(r){
    if (!on(r.date)) return;
    var f = byName[r.from], t = byName[r.to];
    if (f) f.balance -= r.amount;                       // amount is in the From account's currency
    if (t) t.balance += transferReceived(r, f, t);
  });
  // Assets & investments: buying takes cash out of the account, selling puts it back
  holdingTxnRows().forEach(function(t) {
    if (!on(t.date)) return;
    var a = byName[t.account]; if (!own(a)) return;
    var amt = (t.origAmount && t.currency && t.currency === a.currency) ? t.origAmount   // exact USD moved
            : (a.currency === 'THB' ? t.amount : t.amount / a.rate);
    if (t.type === 'buy') a.balance -= amt;
    else if (t.type === 'sell') a.balance += amt;
  });
  // Trading journal: closed trades linked to an account add their net profit/loss (in the account's currency)
  tradeRows().forEach(function(t) {
    if (!t.closeTime || !t.account || !on(t.closeTime.substring(0, 10))) return;
    var a = byName[t.account]; if (own(a)) a.balance += t.net;
  });
  // Receivables: money lent out leaves the account; each repayment goes back into the account it landed in.
  // (Old settled receivables without a repayment log count as fully returned, so they net to zero.)
  loadReceivables().forEach(function(r) {
    if ((r.status === 'pending' || r.repayments.length) && on(r.date)) {
      var a = byName[r.account]; if (own(a)) a.balance -= (a.currency === 'THB' ? r.amount : r.amount / a.rate);
    }
    r.repayments.forEach(function(rp) {
      if (!on(rp.date)) return;
      var a = byName[rp.account || r.account]; if (own(a)) a.balance += (a.currency === 'THB' ? rp.amount : rp.amount / a.rate);
    });
  });
  if (!asOf && accounts.some(function(a){ return a.linked; })) applyLinkedValues(accounts, byName, trfRows);
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
    var thb = a.linkedThb !== undefined ? a.linkedThb : a.balance * a.rate;   // linked: the Wealth Planner's own THB value
    delete a.linkedThb;
    a.balance = round2(a.balance);
    a.balanceThb = round2(thb);
    total += a.balanceThb;
  });
  return jsonResponse({ ok: true, accounts: accounts, totalBalance: round2(total) });
}

function addAccount(p) {
  var sh = getSheet(SHEET.ACCOUNTS);
  var cur = String(p.currency || "THB").trim().toUpperCase() || "THB";
  var linkedTo = String(p.linkedTo || "").trim();
  var group = groupToStore(p.type || "bank", p.group);
  ensureHeaders(sh, 7, ["Currency", "Rate"]);
  var row = [
    p.name || "", p.type || "bank", toFloat(p.startingBalance),
    p.type === "credit" ? toFloat(p.creditLimit) : "",
    p.type === "credit" ? (parseInt(p.dueDay) || "") : "",
    p.type === "credit" ? (parseInt(p.statementDay) || "") : "",
    cur, cur === "THB" ? 1 : (toFloat(p.rate) || 1)
  ];
  if (linkedTo || group) row.push(linkedTo);
  if (group) row.push(group);
  sh.appendRow(row);
  if (linkedTo) ensureHeaders(sh, 9, ["LinkedTo"]);
  if (group) ensureHeaders(sh, 10, ["Group"]);
  return jsonResponse({ ok: true, rowIndex: sh.getLastRow(), linkedTo: linkedTo, group: group || defaultAccountGroup(p.type || "bank") });
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
  // An app version without the linked-account field sends no linkedTo: keep what is saved.
  var linkedTo = String(sh.getRange(row, 9).getValue() || "").trim();
  if (p.linkedTo !== undefined && p.linkedTo !== null) {
    linkedTo = String(p.linkedTo).trim();
    if (linkedTo) ensureHeaders(sh, 9, ["LinkedTo"]);
    if (linkedTo || sh.getRange(row, 9).getValue()) sh.getRange(row, 9).setValue(linkedTo);
  }
  // Same for the group: no `group` sent (older app) keeps the saved one
  var group = String(sh.getRange(row, 10).getValue() || "").trim();
  if (p.group !== undefined && p.group !== null) group = groupToStore(p.type || "bank", p.group);
  else group = groupToStore(p.type || "bank", group);    // the type may have changed to the one it matches
  if (group) ensureHeaders(sh, 10, ["Group"]);
  if (group || sh.getRange(row, 10).getValue()) sh.getRange(row, 10).setValue(group);
  return jsonResponse({ ok: true, linkedTo: linkedTo, group: group || defaultAccountGroup(p.type || "bank") });
}

// Rename a group on every account in it (including accounts that only had it as their type's default).
// One call, so a rename can't stop half-way.
function renameAccountGroup(p) {
  var from = String(p.from || "").replace(/\s+/g, " ").trim(), to = String(p.to || "").replace(/\s+/g, " ").trim();
  if (!from || !to) return jsonResponse({ ok: false, error: "Enter a group name" });
  var sh = getSheet(SHEET.ACCOUNTS), last = sh.getLastRow(), n = 0;
  if (last < 2) return jsonResponse({ ok: true, renamed: 0 });
  var rows = sh.getRange(2, 1, last - 1, Math.max(10, sh.getLastColumn())).getValues();
  ensureHeaders(sh, 10, ["Group"]);
  rows.forEach(function(d, i) {
    if (!d[0] && !d[1]) return;
    var type = d[1];
    var g = String(d[9] || "").trim() || defaultAccountGroup(type);
    if (g !== from) return;
    sh.getRange(i + 2, 10).setValue(groupToStore(type, to));
    n++;
  });
  return jsonResponse({ ok: true, renamed: n });
}

function deleteAccount(p) {
  var sh  = getSheet(SHEET.ACCOUNTS);
  var row = resolveByKey(SHEET.ACCOUNTS, p);
  if (!row) return staleResponse();
  sh.deleteRow(row);
  return jsonResponse({ ok: true });
}

