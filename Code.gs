// ============================================================
//  Money Tracker — Google Apps Script Backend v5
//
//  Sheets:
//    Expenses         → Date | Amount(THB) | Category | Note | Account | IsRecurring | RecurrencePeriod | ProjectId | OrigAmount | Currency
//    Income           → Date | Amount(THB) | Category | Note | Account | OrigAmount | Currency
//    Transfers        → Date | Amount (in From currency) | FromAccount | ToAccount | Note | ReceivedAmount (in To currency, optional)
//    Accounts         → Name | Type | StartingBalance | CreditLimit | DueDay | StatementDay | Currency | Rate (THB per 1 unit)
//    Categories       → Name
//    IncomeCategories → Name
//    Projects         → Name | Budget | StartDate | EndDate
//    Receivables      → Date | Amount | Counterparty | Type | Note | ReimbursedBy | Status | SettledDate | Account | Id
//    ReceivableRepayments → Id | ReceivableId | Date | Amount | Account | Note
//    InstallmentPlans → Description | PurchaseDate | Merchant | TotalAmount | InstallmentCount | InstallmentAmount | FirstInstallmentDate | Account | Category | ProjectId | Status | InstallmentsPaid
//    CategoryBudgets  → Category | MonthlyLimit | AlertThreshold | IsActive | AppliesToProjects
//    RecurringExpenses→ Description | Amount | Category | Account | DayOfMonth | StartDate | Status | LastGenerated | ProjectId
// ============================================================

var SHEET = {
  EXPENSES:     "Expenses",
  INCOME:       "Income",
  TRANSFERS:    "Transfers",
  ACCOUNTS:     "Accounts",
  CATEGORIES:   "Categories",
  INCOME_CATS:  "IncomeCategories",
  PROJECTS:     "Projects",
  RECEIVABLES:  "Receivables",
  INSTALLMENTS: "InstallmentPlans",
  BUDGETS:      "CategoryBudgets",
  RECURRING:    "RecurringExpenses",
  REPAYMENTS:   "ReceivableRepayments"
};

// ── Helpers ──────────────────────────────────────────────────

var _ss = null, _sheetMemo = {};
function getSheet(name) {
  if (_sheetMemo[name]) return _sheetMemo[name];
  if (!_ss) _ss = SpreadsheetApp.getActiveSpreadsheet();
  var ss = _ss;
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    switch (name) {
      case SHEET.EXPENSES:
        sh.appendRow(["Date","Amount","Category","Note","Account","IsRecurring","RecurrencePeriod","ProjectId","OrigAmount","Currency"]);
        break;
      case SHEET.INCOME:
        sh.appendRow(["Date","Amount","Category","Note","Account","OrigAmount","Currency"]);
        break;
      case SHEET.TRANSFERS:
        sh.appendRow(["Date","Amount","FromAccount","ToAccount","Note","ReceivedAmount"]);
        break;
      case SHEET.ACCOUNTS:
        sh.appendRow(["Name","Type","StartingBalance","CreditLimit","DueDay","StatementDay","Currency","Rate"]);
        sh.appendRow(["Cash","cash",0,"","","","THB",1]);
        sh.appendRow(["Investment","investment",0,"","","","THB",1]);
        break;
      case SHEET.CATEGORIES:
        sh.appendRow(["Name"]);
        ["Food & Dining","Transport","Shopping","Bills & Utilities",
         "Healthcare","Entertainment","Education","Personal Care",
         "Travel","Savings","Other"].forEach(function(c){ sh.appendRow([c]); });
        break;
      case SHEET.INCOME_CATS:
        sh.appendRow(["Name"]);
        ["Salary","Investment Returns","Freelance","Bonus","Other Income"].forEach(function(c){ sh.appendRow([c]); });
        break;
      case SHEET.PROJECTS:
        sh.appendRow(["Name","Budget","StartDate","EndDate"]);
        break;
      case SHEET.RECEIVABLES:
        sh.appendRow(["Date","Amount","Counterparty","Type","Note","ReimbursedBy","Status","SettledDate","Account","Id"]);
        break;
      case SHEET.REPAYMENTS:
        sh.appendRow(["Id","ReceivableId","Date","Amount","Account","Note"]);
        sh.getRange(2, 3, 998, 1).setNumberFormat("@");   // Date stays plain text
        break;
      case SHEET.INSTALLMENTS:
        sh.appendRow(["Description","PurchaseDate","Merchant","TotalAmount","InstallmentCount",
                      "InstallmentAmount","FirstInstallmentDate","Account","Category","ProjectId",
                      "Status","InstallmentsPaid"]);
        break;
      case SHEET.BUDGETS:
        sh.appendRow(["Category","MonthlyLimit","AlertThreshold","IsActive","AppliesToProjects"]);
        break;
      case SHEET.RECURRING:
        sh.appendRow(["Description","Amount","Category","Account","DayOfMonth","StartDate","Status","LastGenerated","ProjectId"]);
        sh.getRange(2, 6, 998, 1).setNumberFormat("@");   // StartDate stays plain text
        sh.getRange(2, 8, 998, 1).setNumberFormat("@");   // LastGenerated stays plain text
        break;
    }
    sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight("bold");
  }
  _sheetMemo[name] = sh;
  return sh;
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function formatDate(val) {
  if (!val) return "";
  // Apps Script date objects from getValues() don't pass instanceof Date in V8 —
  // check for object type instead, then use Utilities.formatDate to format correctly.
  if (typeof val === 'object') return Utilities.formatDate(val, "GMT+7", "yyyy-MM-dd");
  return String(val).slice(0, 10);
}

function todayStr() {
  return Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd");
}

// Add n months to a "yyyy-MM-dd" string safely (uses local Date constructor, no timezone string)
function addMonths(dateStr, n) {
  if (!dateStr || dateStr.length < 10) return dateStr;
  var y = parseInt(dateStr.substring(0, 4));
  var m = parseInt(dateStr.substring(5, 7)) - 1; // 0-indexed
  var d = parseInt(dateStr.substring(8, 10));
  var dt = new Date(y, m + n, d);
  return Utilities.formatDate(dt, "GMT+7", "yyyy-MM-dd");
}

function toFloat(v) { return parseFloat(v) || 0; }
function toBool(v)  { return v === true || v === "true" || v === "TRUE" || v === 1; }
function round2(n)  { return Math.round(n * 100) / 100; }

// Write a header cell only if it is still empty (older sheets lack the newer columns)
function ensureHeaders(sh, startCol, names) {
  var cur = sh.getRange(1, startCol, 1, names.length).getValues()[0];
  var need = false;
  names.forEach(function(n, i){ if (!cur[i]) { cur[i] = n; need = true; } });
  if (need) sh.getRange(1, startCol, 1, names.length).setValues([cur]).setFontWeight("bold");
}
// Foreign-currency details of one transaction row
function fxFields(p) {
  var o = toFloat(p.origAmount), c = String(p.currency || "").trim().toUpperCase();
  return (o > 0 && c && c !== "THB") ? [o, c] : ["", ""];
}
// Amount of a THB transaction as it affects an account kept in its own currency
function amtForAccount(acc, thb, orig, cur) {
  if (!acc || acc.currency === "THB") return thb;
  if (orig && cur === acc.currency) return orig;
  return thb / (acc.rate || 1);
}

// Parse year and month directly from "yyyy-MM-dd" — avoids all timezone issues with new Date()
function dateMatchesMonth(dateStr, m, y) {
  if (!dateStr || dateStr.length < 7) return false;
  return parseInt(dateStr.substring(0, 4)) === y &&
         parseInt(dateStr.substring(5, 7)) === m;
}

function sheetToRows(sh, mapper) {
  var data = sh.getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0] && !data[i][1]) continue;
    rows.push(mapper(data[i], i + 1));
  }
  return rows;
}

// ── Entry Point ───────────────────────────────────────────────

function doPost(e) {
  try {
    var p = JSON.parse(e.postData.contents);
    switch (p.action) {
      case "addExpense":             return addExpense(p);
      case "getExpenses":            return getExpenses(p);
      case "updateExpense":          return updateExpense(p);
      case "deleteExpense":          return deleteExpense(p);
      case "addIncome":              return addIncome(p);
      case "getIncome":              return getIncome(p);
      case "updateIncome":           return updateIncome(p);
      case "deleteIncome":           return deleteIncome(p);
      case "addTransfer":            return addTransfer(p);
      case "getTransfers":           return getTransfers(p);
      case "updateTransfer":         return updateTransfer(p);
      case "deleteTransfer":         return deleteTransfer(p);
      case "getAccounts":            return getAccounts();
      case "addAccount":             return addAccount(p);
      case "updateAccount":          return updateAccount(p);
      case "deleteAccount":          return deleteAccount(p);
      case "getCategories":          return getCategories();
      case "addCategory":            return addCategory(p);
      case "deleteCategory":         return deleteCategory(p);
      case "getIncomeCategories":    return getIncomeCategories();
      case "addIncomeCategory":      return addIncomeCategory(p);
      case "deleteIncomeCategory":   return deleteIncomeCategory(p);
      case "getProjects":            return getProjects();
      case "addProject":             return addProject(p);
      case "updateProject":          return updateProject(p);
      case "deleteProject":          return deleteProject(p);
      case "getReceivables":         return getReceivables();
      case "addReceivable":          return addReceivable(p);
      case "settleReceivable":       return settleReceivable(p);
      case "addRepayment":           return addRepayment(p);
      case "deleteRepayment":        return deleteRepayment(p);
      case "updateReceivable":       return updateReceivable(p);
      case "deleteReceivable":       return deleteReceivable(p);
      case "getAllTransactions":      return getAllTransactions(p);
      case "getSummary":             return getSummary(p);
      case "getInstallmentPlans":    return getInstallmentPlans();
      case "addInstallmentPlan":     return addInstallmentPlan(p);
      case "updateInstallmentPlan":  return updateInstallmentPlan(p);
      case "deleteInstallmentPlan":  return deleteInstallmentPlan(p);
      case "checkInstallments":      return checkInstallments();
      case "markInstallmentPaid":    return markInstallmentPaid(p);
      case "getBudgets":             return getBudgets(p);
      case "setBudget":              return setBudget(p);
      case "deleteBudget":           return deleteBudget(p);
      case "getAnnualSummary":       return getAnnualSummary(p);
      case "bootstrap":              return bootstrap(p);
      case "getRecurring":           return getRecurring();
      case "addRecurring":           return addRecurring(p);
      case "updateRecurring":        return updateRecurring(p);
      case "deleteRecurring":        return deleteRecurring(p);
      case "checkRecurring":         return checkRecurring();
      default:
        return jsonResponse({ ok: false, error: "Unknown action: " + p.action });
    }
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// One round-trip startup: returns everything the app needs on open.
// Reuses the existing getters (parsing their JSON) so logic stays identical.
function bootstrap(p) {
  function run(fn) { return JSON.parse(fn().getContent()); }
  var acc  = run(getAccounts);
  var exp  = run(getCategories);
  var inc  = run(getIncomeCategories);
  var txn  = run(function(){ return getAllTransactions(p); });
  var prj  = run(getProjects);
  var rec  = run(getReceivables);
  var ins  = run(getInstallmentPlans);
  var bud  = run(function(){ return getBudgets(p); });
  var rcr  = run(getRecurring);
  return jsonResponse({
    ok: true,
    accounts: acc, categories: exp, incomeCategories: inc, transactions: txn,
    projects: prj, receivables: rec, installmentPlans: ins, budgets: bud, recurringExpenses: rcr
  });
}

// ── RECURRING EXPENSES ───────────────────────────────────────
// Each row is one independent recurring charge (own amount and day of month).
// checkRecurring() creates a normal Expenses row for every due month it has not created yet.

function recurringRow(d, ri) {
  return {
    rowIndex: ri, description: d[0], amount: toFloat(d[1]), category: d[2], account: d[3],
    dayOfMonth: parseInt(d[4]) || 1, startDate: formatDate(d[5]),
    status: d[6] || "active", lastGenerated: formatDate(d[7]), projectId: d[8] || ""
  };
}

function getRecurring() {
  var rows = sheetToRows(getSheet(SHEET.RECURRING), recurringRow);
  return jsonResponse({ ok: true, recurring: rows });
}

function addRecurring(p) {
  var desc = String(p.description || "").trim();
  var amt  = toFloat(p.amount);
  if (!desc || amt <= 0) return jsonResponse({ ok: false, error: "Description and amount required" });
  var day = Math.min(31, Math.max(1, parseInt(p.dayOfMonth) || 1));
  var sh = getSheet(SHEET.RECURRING);
  var r = sh.getLastRow() + 1;
  sh.getRange(r, 6).setNumberFormat("@"); sh.getRange(r, 8).setNumberFormat("@");
  sh.getRange(r, 1, 1, 9).setValues([[desc, amt, p.category || "", p.account || "", day,
    p.startDate || todayStr(), p.status || "active", "", p.projectId || ""]]);
  return jsonResponse({ ok: true, rowIndex: r });
}

function updateRecurring(p) {
  var sh = getSheet(SHEET.RECURRING), row = parseInt(p.rowIndex);
  if (row < 2 || row > sh.getLastRow()) return jsonResponse({ ok: false, error: "Invalid row" });
  var day = Math.min(31, Math.max(1, parseInt(p.dayOfMonth) || 1));
  sh.getRange(row, 6).setNumberFormat("@");
  sh.getRange(row, 1, 1, 7).setValues([[String(p.description || "").trim(), toFloat(p.amount), p.category || "",
    p.account || "", day, p.startDate || todayStr(), p.status || "active"]]);
  sh.getRange(row, 9).setValue(p.projectId || "");
  return jsonResponse({ ok: true });
}

function deleteRecurring(p) {
  var sh = getSheet(SHEET.RECURRING), row = parseInt(p.rowIndex);
  if (row < 2 || row > sh.getLastRow()) return jsonResponse({ ok: false, error: "Invalid row" });
  sh.deleteRow(row);
  return jsonResponse({ ok: true });
}

function pad2(n) { return n < 10 ? "0" + n : "" + n; }

function checkRecurring() {
  var sh = getSheet(SHEET.RECURRING), expSh = getSheet(SHEET.EXPENSES);
  var today = todayStr();
  var ty = parseInt(today.substring(0, 4)), tm = parseInt(today.substring(5, 7));
  var items = sheetToRows(sh, recurringRow);
  var newRows = [], generated = 0;
  items.forEach(function(it) {
    if (it.status !== "active" || !it.amount) return;
    var y, m;
    if (it.lastGenerated) {                       // continue after the last month already created
      y = parseInt(it.lastGenerated.substring(0, 4)); m = parseInt(it.lastGenerated.substring(5, 7)) + 1;
      if (m > 12) { m = 1; y++; }
    } else if (it.startDate) {                    // first run: begin in the start month
      y = parseInt(it.startDate.substring(0, 4)); m = parseInt(it.startDate.substring(5, 7));
    } else return;
    var lastDone = "", guard = 0;
    while ((y < ty || (y === ty && m <= tm)) && guard < 36) {
      var dim = new Date(y, m, 0).getDate();      // days in month (Feb 30 -> 28/29)
      var due = y + "-" + pad2(m) + "-" + pad2(Math.min(it.dayOfMonth, dim));
      if (due > today) break;                     // not due yet - try again next time
      if (!it.startDate || due >= it.startDate) {
        newRows.push([due, it.amount, it.category || "Subscription", it.description, it.account || "",
                      "TRUE", "monthly", it.projectId || ""]);
        generated++;
      }
      lastDone = due;
      m++; if (m > 12) { m = 1; y++; }
      guard++;
    }
    if (lastDone) {
      sh.getRange(it.rowIndex, 8).setNumberFormat("@");
      sh.getRange(it.rowIndex, 8).setValue(lastDone);
    }
  });
  if (newRows.length) expSh.getRange(expSh.getLastRow() + 1, 1, newRows.length, 8).setValues(newRows);
  return jsonResponse({ ok: true, generated: generated });
}

function doGet() {
  return jsonResponse({ ok: true, message: "Money Tracker API v5 — live" });
}

// ── EXPENSES ──────────────────────────────────────────────────

function addExpense(p) {
  var sh = getSheet(SHEET.EXPENSES);
  sh.appendRow([
    p.date || todayStr(),
    toFloat(p.amount),
    p.category || "",
    p.note || "",
    p.account || "",
    p.isRecurring ? "TRUE" : "FALSE",
    p.recurrencePeriod || "",
    p.projectId || ""
  ].concat(fxFields(p)));
  var fx = fxFields(p);
  if (fx[0]) ensureHeaders(sh, 9, ["OrigAmount", "Currency"]);
  return jsonResponse({ ok: true, rowIndex: sh.getLastRow() });
}

function getExpenses(p) {
  var sh   = getSheet(SHEET.EXPENSES);
  var rows = sheetToRows(sh, function(d, ri) {
    return {
      rowIndex: ri, date: formatDate(d[0]), amount: toFloat(d[1]),
      category: d[2], note: d[3], account: d[4],
      isRecurring: toBool(d[5]), recurrencePeriod: d[6] || "", projectId: d[7] || "",
      origAmount: toFloat(d[8]) || 0, currency: d[9] || ""
    };
  });
  if (p.month && p.year) {
    var fm = parseInt(p.month), fy = parseInt(p.year);
    rows = rows.filter(function(r) { return dateMatchesMonth(r.date, fm, fy); });
  }
  rows.reverse();
  return jsonResponse({ ok: true, expenses: rows });
}

function updateExpense(p) {
  var sh  = getSheet(SHEET.EXPENSES);
  var row = parseInt(p.rowIndex);
  if (row < 2) return jsonResponse({ ok: false, error: "Invalid row" });
  sh.getRange(row, 1, 1, 10).setValues([[
    p.date || "", toFloat(p.amount), p.category || "", p.note || "", p.account || "",
    p.isRecurring ? "TRUE" : "FALSE", p.recurrencePeriod || "", p.projectId || ""
  ].concat(fxFields(p))]);
  if (fxFields(p)[0]) ensureHeaders(sh, 9, ["OrigAmount", "Currency"]);
  return jsonResponse({ ok: true });
}

function deleteExpense(p) {
  var sh  = getSheet(SHEET.EXPENSES);
  var row = parseInt(p.rowIndex);
  if (row < 2) return jsonResponse({ ok: false, error: "Invalid row" });
  sh.deleteRow(row);
  return jsonResponse({ ok: true });
}

// ── INCOME ────────────────────────────────────────────────────

function addIncome(p) {
  var sh = getSheet(SHEET.INCOME);
  sh.appendRow([p.date || todayStr(), toFloat(p.amount), p.category || "", p.note || "", p.account || ""].concat(fxFields(p)));
  if (fxFields(p)[0]) ensureHeaders(sh, 6, ["OrigAmount", "Currency"]);
  return jsonResponse({ ok: true, rowIndex: sh.getLastRow() });
}

function getIncome(p) {
  var sh   = getSheet(SHEET.INCOME);
  var rows = sheetToRows(sh, function(d, ri) {
    return { rowIndex: ri, date: formatDate(d[0]), amount: toFloat(d[1]), category: d[2], note: d[3], account: d[4],
      origAmount: toFloat(d[5]) || 0, currency: d[6] || "" };
  });
  if (p.month && p.year) {
    var fm = parseInt(p.month), fy = parseInt(p.year);
    rows = rows.filter(function(r) { return dateMatchesMonth(r.date, fm, fy); });
  }
  rows.reverse();
  return jsonResponse({ ok: true, income: rows });
}

function updateIncome(p) {
  var sh  = getSheet(SHEET.INCOME);
  var row = parseInt(p.rowIndex);
  if (row < 2) return jsonResponse({ ok: false, error: "Invalid row" });
  sh.getRange(row, 1, 1, 7).setValues([[p.date || "", toFloat(p.amount), p.category || "", p.note || "", p.account || ""].concat(fxFields(p))]);
  if (fxFields(p)[0]) ensureHeaders(sh, 6, ["OrigAmount", "Currency"]);
  return jsonResponse({ ok: true });
}

function deleteIncome(p) {
  var sh  = getSheet(SHEET.INCOME);
  var row = parseInt(p.rowIndex);
  if (row < 2) return jsonResponse({ ok: false, error: "Invalid row" });
  sh.deleteRow(row);
  return jsonResponse({ ok: true });
}

// ── TRANSFERS ─────────────────────────────────────────────────

function addTransfer(p) {
  var sh = getSheet(SHEET.TRANSFERS);
  var rcv = toFloat(p.receivedAmount);
  sh.appendRow([p.date || todayStr(), toFloat(p.amount), p.fromAccount || "", p.toAccount || "", p.note || "", rcv > 0 ? rcv : ""]);
  if (rcv > 0) ensureHeaders(sh, 6, ["ReceivedAmount"]);
  return jsonResponse({ ok: true, rowIndex: sh.getLastRow() });
}

function getTransfers(p) {
  var sh   = getSheet(SHEET.TRANSFERS);
  var rows = sheetToRows(sh, function(d, ri) {
    return { rowIndex: ri, date: formatDate(d[0]), amount: toFloat(d[1]), fromAccount: d[2], toAccount: d[3], note: d[4], receivedAmount: toFloat(d[5]) || 0 };
  });
  if (p.month && p.year) {
    var fm = parseInt(p.month), fy = parseInt(p.year);
    rows = rows.filter(function(r) { return dateMatchesMonth(r.date, fm, fy); });
  }
  rows.reverse();
  return jsonResponse({ ok: true, transfers: rows });
}

function deleteTransfer(p) {
  var sh  = getSheet(SHEET.TRANSFERS);
  var row = parseInt(p.rowIndex);
  if (row < 2) return jsonResponse({ ok: false, error: "Invalid row" });
  sh.deleteRow(row);
  return jsonResponse({ ok: true });
}

function updateTransfer(p) {
  var sh  = getSheet(SHEET.TRANSFERS);
  var row = parseInt(p.rowIndex);
  if (row < 2) return jsonResponse({ ok: false, error: "Invalid row" });
  var rcv = toFloat(p.receivedAmount);
  sh.getRange(row, 1, 1, 6).setValues([[
    p.date || todayStr(), toFloat(p.amount),
    p.fromAccount || "", p.toAccount || "", p.note || "", rcv > 0 ? rcv : ""
  ]]);
  if (rcv > 0) ensureHeaders(sh, 6, ["ReceivedAmount"]);
  return jsonResponse({ ok: true });
}

// ── ACCOUNTS ─────────────────────────────────────────────────

function getAccounts() {
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
  function bump(name, delta) { var a = byName[name]; if (a) a.balance += delta; }
  var expRows  = sheetToRows(getSheet(SHEET.EXPENSES), function(d){ return { amount: toFloat(d[1]), account: String(d[4]||'').trim(), orig: toFloat(d[8]), cur: String(d[9]||'').trim().toUpperCase() }; });
  var incRows  = sheetToRows(getSheet(SHEET.INCOME),   function(d){ return { amount: toFloat(d[1]), account: String(d[4]||'').trim(), orig: toFloat(d[5]), cur: String(d[6]||'').trim().toUpperCase() }; });
  var trfRows  = sheetToRows(getSheet(SHEET.TRANSFERS), function(d){ return { amount: toFloat(d[1]), from: String(d[2]||'').trim(), to: String(d[3]||'').trim(), received: toFloat(d[5]) }; });
  incRows.forEach(function(r){ var a = byName[r.account]; if (a) a.balance += amtForAccount(a, r.amount, r.orig, r.cur); });
  expRows.forEach(function(r){ var a = byName[r.account]; if (a) a.balance -= amtForAccount(a, r.amount, r.orig, r.cur); });
  trfRows.forEach(function(r){
    var f = byName[r.from], t = byName[r.to];
    if (f) f.balance -= r.amount;                       // amount is in the From account's currency
    if (t) {
      var got = r.received;
      if (!got) got = (f && f.currency !== t.currency) ? (r.amount * f.rate) / t.rate : r.amount;
      t.balance += got;
    }
  });
  // Receivables: money lent out leaves the account; each repayment goes back into the account it landed in.
  // (Old settled receivables without a repayment log count as fully returned, so they net to zero.)
  var rv = loadReceivables();
  rv.forEach(function(r) {
    if (r.status === 'pending' || r.repayments.length) {
      var a = byName[r.account]; if (a) a.balance -= (a.currency === 'THB' ? r.amount : r.amount / a.rate);
    }
    r.repayments.forEach(function(rp) {
      var a = byName[rp.account || r.account]; if (a) a.balance += (a.currency === 'THB' ? rp.amount : rp.amount / a.rate);
    });
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
  var row = parseInt(p.rowIndex);
  if (row < 2) return jsonResponse({ ok: false, error: "Invalid row" });
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
  var row = parseInt(p.rowIndex);
  if (row < 2) return jsonResponse({ ok: false, error: "Invalid row" });
  sh.deleteRow(row);
  return jsonResponse({ ok: true });
}

// ── CATEGORIES ────────────────────────────────────────────────

function getCategories() {
  var sh = getSheet(SHEET.CATEGORIES);
  return jsonResponse({ ok: true, categories: sheetToRows(sh, function(d, ri){ return { rowIndex: ri, name: d[0] }; }) });
}
function addCategory(p) {
  var name = (p.name || "").trim();
  if (!name) return jsonResponse({ ok: false, error: "Name required" });
  var sh = getSheet(SHEET.CATEGORIES); sh.appendRow([name]);
  return jsonResponse({ ok: true, rowIndex: sh.getLastRow() });
}
function deleteCategory(p) {
  var sh = getSheet(SHEET.CATEGORIES); var row = parseInt(p.rowIndex);
  if (row < 2) return jsonResponse({ ok: false, error: "Invalid row" });
  sh.deleteRow(row); return jsonResponse({ ok: true });
}

function getIncomeCategories() {
  var sh = getSheet(SHEET.INCOME_CATS);
  return jsonResponse({ ok: true, categories: sheetToRows(sh, function(d, ri){ return { rowIndex: ri, name: d[0] }; }) });
}
function addIncomeCategory(p) {
  var name = (p.name || "").trim();
  if (!name) return jsonResponse({ ok: false, error: "Name required" });
  var sh = getSheet(SHEET.INCOME_CATS); sh.appendRow([name]);
  return jsonResponse({ ok: true, rowIndex: sh.getLastRow() });
}
function deleteIncomeCategory(p) {
  var sh = getSheet(SHEET.INCOME_CATS); var row = parseInt(p.rowIndex);
  if (row < 2) return jsonResponse({ ok: false, error: "Invalid row" });
  sh.deleteRow(row); return jsonResponse({ ok: true });
}

// ── PROJECTS ─────────────────────────────────────────────────

function getProjects() {
  var sh = getSheet(SHEET.PROJECTS);
  var projects = sheetToRows(sh, function(d, ri) {
    return { rowIndex: ri, name: d[0], budget: toFloat(d[1]), startDate: formatDate(d[2]), endDate: formatDate(d[3]) };
  });
  var expSh = getSheet(SHEET.EXPENSES);
  var expRows = sheetToRows(expSh, function(d){ return { amount: toFloat(d[1]), projectId: d[7] || "" }; });
  projects.forEach(function(proj) {
    proj.spent = expRows.filter(function(e){ return e.projectId === proj.name; })
      .reduce(function(s, e){ return s + e.amount; }, 0);
    proj.spent = Math.round(proj.spent * 100) / 100;
  });
  return jsonResponse({ ok: true, projects: projects });
}

function addProject(p) {
  var name = (p.name || "").trim();
  if (!name) return jsonResponse({ ok: false, error: "Name required" });
  var sh = getSheet(SHEET.PROJECTS);
  sh.appendRow([name, toFloat(p.budget), p.startDate || "", p.endDate || ""]);
  return jsonResponse({ ok: true, rowIndex: sh.getLastRow() });
}

function updateProject(p) {
  var sh  = getSheet(SHEET.PROJECTS);
  var row = parseInt(p.rowIndex);
  if (row < 2) return jsonResponse({ ok: false, error: "Invalid row" });
  sh.getRange(row, 1, 1, 4).setValues([[p.name || "", toFloat(p.budget), p.startDate || "", p.endDate || ""]]);
  return jsonResponse({ ok: true });
}

function deleteProject(p) {
  var sh  = getSheet(SHEET.PROJECTS);
  var row = parseInt(p.rowIndex);
  if (row < 2) return jsonResponse({ ok: false, error: "Invalid row" });
  sh.deleteRow(row);
  return jsonResponse({ ok: true });
}

// ── RECEIVABLES ───────────────────────────────────────────────
// A receivable is money you lent / paid for someone. Repayments (ReceivableRepayments tab) come back
// in pieces: Returned = sum of repayments, Left = Amount - Returned. Each repayment adds to the
// account it landed in. When Left reaches 0 the receivable becomes "settled" automatically.

var _recvIds = false;
function recvEnsureIds(sh) {
  if (_recvIds) return;
  _recvIds = true;
  var last = sh.getLastRow();
  if (last < 2) return;
  ensureHeaders(sh, 10, ["Id"]);
  var rng = sh.getRange(2, 1, last - 1, 10), v = rng.getValues(), ch = false;
  v.forEach(function(r){
    if (!r[9] && (r[0] || r[1])) { r[9] = "R" + Utilities.getUuid().replace(/-/g, "").slice(0, 8); ch = true; }
  });
  if (ch) sh.getRange(2, 10, last - 1, 1).setValues(v.map(function(r){ return [r[9]]; }));
}

function loadReceivables() {
  var sh = getSheet(SHEET.RECEIVABLES);
  recvEnsureIds(sh);
  var reps = sheetToRows(getSheet(SHEET.REPAYMENTS), function(d, ri) {
    return { rowIndex: ri, id: d[0], receivableId: String(d[1]||''), date: formatDate(d[2]),
             amount: toFloat(d[3]), account: String(d[4]||'').trim(), note: String(d[5]||'') };
  });
  return sheetToRows(sh, function(d, ri) {
    var id = String(d[9] || '');
    var mine = reps.filter(function(x){ return x.receivableId === id; });
    var status = String(d[6] || 'pending').trim() || 'pending';
    var amount = toFloat(d[1]);
    var returned = mine.reduce(function(s, x){ return s + x.amount; }, 0);
    if (status === 'settled' && !mine.length) returned = amount;      // legacy: settled before repayments existed
    returned = round2(returned);
    return {
      rowIndex: ri, id: id, date: formatDate(d[0]), amount: amount,
      counterparty: d[2], type: d[3], note: d[4],
      reimbursedBy: d[5], status: status, settledDate: formatDate(d[7]),
      account: String(d[8]||'').trim(),
      repayments: mine, returned: returned, left: Math.max(0, round2(amount - returned))
    };
  });
}

function getReceivables() {
  return jsonResponse({ ok: true, receivables: loadReceivables() });
}

function addReceivable(p) {
  var sh = getSheet(SHEET.RECEIVABLES);
  recvEnsureIds(sh);
  ensureHeaders(sh, 10, ["Id"]);
  var id = "R" + Utilities.getUuid().replace(/-/g, "").slice(0, 8);
  sh.appendRow([
    p.date || todayStr(), toFloat(p.amount),
    p.counterparty || "", p.type || "advance",
    p.note || "", p.reimbursedBy || "",
    "pending", "", p.account || "", id
  ]);
  return jsonResponse({ ok: true, rowIndex: sh.getLastRow(), id: id });
}

function updateReceivable(p) {
  var sh  = getSheet(SHEET.RECEIVABLES);
  var row = parseInt(p.rowIndex);
  if (row < 2) return jsonResponse({ ok: false, error: "Invalid row" });
  // Keep existing status/settledDate (cols 7-8), update cols 1-6 and col 9 (account)
  sh.getRange(row, 1, 1, 6).setValues([[
    p.date || todayStr(), toFloat(p.amount),
    p.counterparty || "", p.type || "advance",
    p.note || "", p.reimbursedBy || ""
  ]]);
  sh.getRange(row, 9, 1, 1).setValue(p.account || "");
  return jsonResponse({ ok: true });
}

function markRecvStatus(row, status, date) {
  var sh = getSheet(SHEET.RECEIVABLES);
  sh.getRange(row, 7, 1, 2).setValues([[status, date || ""]]);
}

function addRepaymentRow(rv, amount, date, account, note) {
  var sh = getSheet(SHEET.REPAYMENTS);
  var r = sh.getLastRow() + 1;
  sh.getRange(r, 3).setNumberFormat("@");
  var id = "P" + Utilities.getUuid().replace(/-/g, "").slice(0, 8);
  sh.getRange(r, 1, 1, 6).setValues([[id, rv.id, date, amount, account || rv.account || "", note || ""]]);
  return r;
}

function addRepayment(p) {
  var all = loadReceivables(), rv = null;
  all.forEach(function(x){ if (x.id === String(p.receivableId) || (p.rowIndex && x.rowIndex === parseInt(p.rowIndex))) rv = x; });
  if (!rv) return jsonResponse({ ok: false, error: "Receivable not found" });
  var amt = round2(toFloat(p.amount));
  if (amt <= 0) return jsonResponse({ ok: false, error: "Amount must be more than 0" });
  if (amt > rv.left + 0.005) return jsonResponse({ ok: false, error: "More than what is left (" + rv.left + ")" });
  var date = p.date || todayStr();
  addRepaymentRow(rv, amt, date, String(p.account || "").trim(), p.note);
  var left = round2(rv.left - amt);
  if (left <= 0.005) markRecvStatus(rv.rowIndex, "settled", date);
  return jsonResponse({ ok: true, left: Math.max(0, left), settled: left <= 0.005 });
}

function deleteRepayment(p) {
  var sh = getSheet(SHEET.REPAYMENTS), row = parseInt(p.rowIndex);
  if (row < 2 || row > sh.getLastRow()) return jsonResponse({ ok: false, error: "Invalid row" });
  var recvId = String(sh.getRange(row, 2).getValue() || "");
  sh.deleteRow(row);
  loadReceivables().forEach(function(rv){
    if (rv.id === recvId && rv.status === "settled" && rv.repayments.length && rv.left > 0.005) markRecvStatus(rv.rowIndex, "pending", "");
  });
  return jsonResponse({ ok: true });
}

function settleReceivable(p) {
  var row = parseInt(p.rowIndex);
  if (row < 2) return jsonResponse({ ok: false, error: "Invalid row" });
  var date = p.settledDate || todayStr(), rv = null;
  loadReceivables().forEach(function(x){ if (x.rowIndex === row) rv = x; });
  if (rv && rv.status !== "settled" && rv.left > 0.005) addRepaymentRow(rv, rv.left, date, String(p.account || "").trim(), "Marked settled");
  markRecvStatus(row, "settled", date);
  return jsonResponse({ ok: true });
}

function deleteReceivable(p) {
  var sh  = getSheet(SHEET.RECEIVABLES);
  var row = parseInt(p.rowIndex);
  if (row < 2) return jsonResponse({ ok: false, error: "Invalid row" });
  var id = String(sh.getRange(row, 10).getValue() || "");
  if (id) {
    var rp = getSheet(SHEET.REPAYMENTS), data = rp.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) if (String(data[i][1]) === id) rp.deleteRow(i + 1);
  }
  sh.deleteRow(row);
  return jsonResponse({ ok: true });
}

// ── COMBINED ─────────────────────────────────────────────────

function getAllTransactions(p) {
  var m = p.month ? parseInt(p.month) : 0;
  var y = p.year  ? parseInt(p.year)  : 0;
  function inPeriod(dateStr) {
    if (!m || !y) return true;
    return dateMatchesMonth(dateStr, m, y);
  }
  var txns = [];
  sheetToRows(getSheet(SHEET.EXPENSES), function(d, ri) {
    return { rowIndex: ri, type: "expense", date: formatDate(d[0]), amount: toFloat(d[1]),
      category: d[2], note: d[3], account: d[4],
      isRecurring: toBool(d[5]), recurrencePeriod: d[6] || "", projectId: d[7] || "",
      origAmount: toFloat(d[8]) || 0, currency: d[9] || "" };
  }).forEach(function(r){ if (inPeriod(r.date)) txns.push(r); });

  sheetToRows(getSheet(SHEET.INCOME), function(d, ri) {
    return { rowIndex: ri, type: "income", date: formatDate(d[0]), amount: toFloat(d[1]),
      category: d[2], note: d[3], account: d[4], origAmount: toFloat(d[5]) || 0, currency: d[6] || "" };
  }).forEach(function(r){ if (inPeriod(r.date)) txns.push(r); });

  sheetToRows(getSheet(SHEET.TRANSFERS), function(d, ri) {
    return { rowIndex: ri, type: "transfer", date: formatDate(d[0]), amount: toFloat(d[1]),
      fromAccount: d[2], toAccount: d[3], note: d[4], receivedAmount: toFloat(d[5]) || 0 };
  }).forEach(function(r){ if (inPeriod(r.date)) txns.push(r); });

  // Pending receivables: always included regardless of month filter
  // (they are ongoing obligations that affect account balance until settled)
  loadReceivables().forEach(function(rv) {
    if (rv.status === 'pending') {
      txns.push({ rowIndex: rv.rowIndex, type: "receivable", date: rv.date, amount: rv.amount,
        counterparty: String(rv.counterparty||''), recvType: String(rv.type||'advance'),
        note: String(rv.note||''), reimbursedBy: String(rv.reimbursedBy||''),
        status: rv.status, account: rv.account, returned: rv.returned, left: rv.left });
    }
    rv.repayments.forEach(function(rp) {
      if (!inPeriod(rp.date)) return;
      txns.push({ rowIndex: rp.rowIndex, type: "repayment", date: rp.date, amount: rp.amount,
        counterparty: String(rv.counterparty||''), note: rp.note, account: rp.account || rv.account,
        receivableRow: rv.rowIndex });
    });
  });

  txns.sort(function(a,b){ return b.date.localeCompare(a.date); });
  return jsonResponse({ ok: true, transactions: txns });
}

function getSummary(p) {
  var m = parseInt(p.month), y = parseInt(p.year);
  function inMonth(dateStr) { return dateMatchesMonth(dateStr, m, y); }
  var totalExpense = 0, totalIncome = 0;
  sheetToRows(getSheet(SHEET.EXPENSES), function(d){ return { date: formatDate(d[0]), amount: toFloat(d[1]) }; })
    .forEach(function(r){ if (inMonth(r.date)) totalExpense += r.amount; });
  sheetToRows(getSheet(SHEET.INCOME), function(d){ return { date: formatDate(d[0]), amount: toFloat(d[1]) }; })
    .forEach(function(r){ if (inMonth(r.date)) totalIncome += r.amount; });
  return jsonResponse({ ok: true,
    totalExpense: Math.round(totalExpense*100)/100,
    totalIncome:  Math.round(totalIncome*100)/100,
    net:          Math.round((totalIncome-totalExpense)*100)/100 });
}

// ── INSTALLMENT PLANS ────────────────────────────────────────

function getInstallmentPlans() {
  var sh = getSheet(SHEET.INSTALLMENTS);
  var plans = sheetToRows(sh, function(d, ri) {
    var count  = parseInt(d[4]) || 0;
    var paid   = parseInt(d[11]) || 0;
    var instAmt = toFloat(d[5]);
    var firstDate = formatDate(d[6]);
    var nextDate  = (paid < count && firstDate) ? addMonths(firstDate, paid) : '';
    return {
      rowIndex: ri,
      description: d[0], purchaseDate: formatDate(d[1]),
      merchant: d[2], totalAmount: toFloat(d[3]),
      installmentCount: count, installmentAmount: instAmt,
      firstInstallmentDate: firstDate,
      account: d[7], category: d[8],
      projectId: d[9] || '', status: d[10] || 'active',
      installmentsPaid: paid,
      remaining: Math.max(0, count - paid),
      remainingAmount: Math.round(instAmt * Math.max(0, count - paid) * 100) / 100,
      nextInstallmentDate: nextDate
    };
  });
  return jsonResponse({ ok: true, installmentPlans: plans });
}

function addInstallmentPlan(p) {
  var sh    = getSheet(SHEET.INSTALLMENTS);
  var count = parseInt(p.installmentCount) || 1;
  var total = toFloat(p.totalAmount);
  var instAmt = Math.round(total / count * 100) / 100;
  sh.appendRow([
    p.description || '', p.purchaseDate || todayStr(),
    p.merchant || '', total, count, instAmt,
    p.firstInstallmentDate || todayStr(),
    p.account || '', p.category || '',
    p.projectId || '', 'active', 0
  ]);
  return jsonResponse({ ok: true, rowIndex: sh.getLastRow() });
}

function updateInstallmentPlan(p) {
  var sh  = getSheet(SHEET.INSTALLMENTS);
  var row = parseInt(p.rowIndex);
  if (row < 2) return jsonResponse({ ok: false, error: 'Invalid row' });
  var count   = parseInt(p.installmentCount) || 1;
  var total   = toFloat(p.totalAmount);
  var instAmt = Math.round(total / count * 100) / 100;
  sh.getRange(row, 1, 1, 12).setValues([[
    p.description || '', p.purchaseDate || '', p.merchant || '',
    total, count, instAmt, p.firstInstallmentDate || '',
    p.account || '', p.category || '', p.projectId || '',
    p.status || 'active', parseInt(p.installmentsPaid) || 0
  ]]);
  return jsonResponse({ ok: true });
}

function deleteInstallmentPlan(p) {
  var sh  = getSheet(SHEET.INSTALLMENTS);
  var row = parseInt(p.rowIndex);
  if (row < 2) return jsonResponse({ ok: false, error: 'Invalid row' });
  sh.deleteRow(row);
  return jsonResponse({ ok: true });
}

// Auto-generates expense rows for any installments that are due and not yet recorded
function checkInstallments() {
  var sh     = getSheet(SHEET.INSTALLMENTS);
  var expSh  = getSheet(SHEET.EXPENSES);
  var today  = todayStr();
  var plans  = sheetToRows(sh, function(d, ri) {
    return {
      rowIndex: ri, description: d[0],
      installmentCount: parseInt(d[4]) || 0,
      installmentAmount: toFloat(d[5]),
      firstInstallmentDate: formatDate(d[6]),
      account: d[7], category: d[8],
      projectId: d[9] || '', status: d[10] || 'active',
      installmentsPaid: parseInt(d[11]) || 0
    };
  });
  var generated = 0;
  plans.forEach(function(plan) {
    if (plan.status !== 'active') return;
    if (!plan.firstInstallmentDate || plan.installmentCount === 0) return;
    // Count how many installments are due by today
    var dueSoFar = 0;
    for (var n = 0; n < plan.installmentCount; n++) {
      var dueDate = addMonths(plan.firstInstallmentDate, n);
      if (dueDate <= today) dueSoFar++;
      else break;
    }
    var toGenerate = dueSoFar - plan.installmentsPaid;
    if (toGenerate <= 0) return;
    // Generate missing installment expense rows
    for (var i = 0; i < toGenerate; i++) {
      var instNum  = plan.installmentsPaid + i + 1;
      var instDate = addMonths(plan.firstInstallmentDate, plan.installmentsPaid + i);
      var note     = '[Inst ' + instNum + '/' + plan.installmentCount + '] ' + plan.description;
      expSh.appendRow([
        instDate, plan.installmentAmount,
        plan.category || 'Shopping', note,
        plan.account || '', 'FALSE', '', plan.projectId || ''
      ]);
      generated++;
    }
    var newPaid = plan.installmentsPaid + toGenerate;
    sh.getRange(plan.rowIndex, 12, 1, 1).setValue(newPaid);
    if (newPaid >= plan.installmentCount) {
      sh.getRange(plan.rowIndex, 11, 1, 1).setValue('completed');
    }
  });
  return jsonResponse({ ok: true, generated: generated });
}

function markInstallmentPaid(p) {
  var sh    = getSheet(SHEET.INSTALLMENTS);
  var expSh = getSheet(SHEET.EXPENSES);
  var row   = parseInt(p.rowIndex);
  if (row < 2) return jsonResponse({ ok: false, error: 'Invalid row' });

  var data  = sh.getRange(row, 1, 1, 12).getValues()[0];
  var plan  = {
    description:          data[0],
    installmentCount:     parseInt(data[4]) || 0,
    installmentAmount:    toFloat(data[5]),
    firstInstallmentDate: formatDate(data[6]),
    account:              data[7],
    category:             data[8],
    projectId:            data[9] || '',
    status:               data[10] || 'active',
    installmentsPaid:     parseInt(data[11]) || 0
  };

  if (plan.status !== 'active') return jsonResponse({ ok: false, error: 'Plan is not active' });
  if (plan.installmentsPaid >= plan.installmentCount) return jsonResponse({ ok: false, error: 'All installments already paid' });

  var instNum  = plan.installmentsPaid + 1;
  var instDate = addMonths(plan.firstInstallmentDate, plan.installmentsPaid);
  var note     = '[Inst ' + instNum + '/' + plan.installmentCount + '] ' + plan.description;
  expSh.appendRow([
    instDate, plan.installmentAmount,
    plan.category || 'Shopping', note,
    plan.account || '', 'FALSE', '', plan.projectId || ''
  ]);

  var newPaid = plan.installmentsPaid + 1;
  sh.getRange(row, 12, 1, 1).setValue(newPaid);
  if (newPaid >= plan.installmentCount) {
    sh.getRange(row, 11, 1, 1).setValue('completed');
  }
  return jsonResponse({ ok: true, instNum: instNum, instDate: instDate });
}

// ── CATEGORY BUDGETS ─────────────────────────────────────────

function getBudgets(p) {
  var sh = getSheet(SHEET.BUDGETS);
  var budgets = sheetToRows(sh, function(d, ri) {
    return {
      rowIndex: ri, category: d[0],
      monthlyLimit: toFloat(d[1]),
      alertThreshold: toFloat(d[2]) || 0.8,
      isActive: d[3] !== 'FALSE' && d[3] !== false,
      appliesToProjects: toBool(d[4])
    };
  });
  // Attach current-month spending to each budget
  var m = (p && p.month) ? parseInt(p.month) : (new Date().getMonth() + 1);
  var y = (p && p.year)  ? parseInt(p.year)  : new Date().getFullYear();
  var expRows = sheetToRows(getSheet(SHEET.EXPENSES), function(d) {
    return { date: formatDate(d[0]), amount: toFloat(d[1]), category: d[2], projectId: d[7] || '' };
  }).filter(function(r) { return dateMatchesMonth(r.date, m, y); });
  budgets.forEach(function(b) {
    var spent = expRows
      .filter(function(e) { return e.category === b.category && (b.appliesToProjects || !e.projectId); })
      .reduce(function(s, e) { return s + e.amount; }, 0);
    b.spent     = Math.round(spent * 100) / 100;
    b.remaining = Math.round((b.monthlyLimit - spent) * 100) / 100;
    b.usagePct  = b.monthlyLimit > 0 ? Math.round(spent / b.monthlyLimit * 100) : 0;
  });
  return jsonResponse({ ok: true, budgets: budgets });
}

function setBudget(p) {
  var sh = getSheet(SHEET.BUDGETS);
  var vals = [
    p.category || '',
    toFloat(p.monthlyLimit),
    toFloat(p.alertThreshold) || 0.8,
    p.isActive === false ? 'FALSE' : 'TRUE',
    p.appliesToProjects ? 'TRUE' : 'FALSE'
  ];
  if (p.rowIndex) {
    var row = parseInt(p.rowIndex);
    if (row < 2) return jsonResponse({ ok: false, error: 'Invalid row' });
    sh.getRange(row, 1, 1, 5).setValues([vals]);
  } else {
    sh.appendRow(vals);
  }
  return jsonResponse({ ok: true, rowIndex: sh.getLastRow() });
}

function deleteBudget(p) {
  var sh  = getSheet(SHEET.BUDGETS);
  var row = parseInt(p.rowIndex);
  if (row < 2) return jsonResponse({ ok: false, error: 'Invalid row' });
  sh.deleteRow(row);
  return jsonResponse({ ok: true });
}

// ── ANNUAL SUMMARY ───────────────────────────────────────────

function getAnnualSummary(p) {
  var y = parseInt(p.year) || new Date().getFullYear();
  var expenses = sheetToRows(getSheet(SHEET.EXPENSES), function(d) {
    return { date: formatDate(d[0]), amount: toFloat(d[1]), category: d[2], projectId: d[7] || '' };
  }).filter(function(r) { return r.date && parseInt(r.date.substring(0, 4)) === y; });

  var incomes = sheetToRows(getSheet(SHEET.INCOME), function(d) {
    return { date: formatDate(d[0]), amount: toFloat(d[1]), category: d[2] };
  }).filter(function(r) { return r.date && parseInt(r.date.substring(0, 4)) === y; });

  // Monthly breakdown (12 months)
  var monthly = [];
  for (var mo = 1; mo <= 12; mo++) {
    var mRegExp  = expenses.filter(function(e){ return dateMatchesMonth(e.date, mo, y) && !e.projectId; })
                           .reduce(function(s,e){ return s+e.amount; }, 0);
    var mProjExp = expenses.filter(function(e){ return dateMatchesMonth(e.date, mo, y) && !!e.projectId; })
                           .reduce(function(s,e){ return s+e.amount; }, 0);
    var mInc     = incomes.filter(function(e){ return dateMatchesMonth(e.date, mo, y); })
                          .reduce(function(s,e){ return s+e.amount; }, 0);
    var mNet     = mInc - mRegExp - mProjExp;
    monthly.push({
      month: mo,
      income:          Math.round(mInc*100)/100,
      regularExpenses: Math.round(mRegExp*100)/100,
      projectExpenses: Math.round(mProjExp*100)/100,
      net:             Math.round(mNet*100)/100,
      savingsRate:     mInc > 0 ? Math.round(mNet/mInc*100) : 0
    });
  }

  // Category breakdown (all expenses)
  var byCat = {};
  expenses.forEach(function(e){ byCat[e.category] = (byCat[e.category]||0) + e.amount; });
  var categories = Object.keys(byCat).map(function(c){
    return { category: c, amount: Math.round(byCat[c]*100)/100 };
  }).sort(function(a,b){ return b.amount - a.amount; });

  var totalIncome   = Math.round(incomes.reduce(function(s,e){ return s+e.amount; }, 0)*100)/100;
  var totalRegExp   = Math.round(expenses.filter(function(e){ return !e.projectId; }).reduce(function(s,e){ return s+e.amount; }, 0)*100)/100;
  var totalProjExp  = Math.round(expenses.filter(function(e){ return !!e.projectId; }).reduce(function(s,e){ return s+e.amount; }, 0)*100)/100;
  var totalExp      = Math.round((totalRegExp + totalProjExp)*100)/100;
  var surplus       = Math.round((totalIncome - totalExp)*100)/100;
  var savingsRate   = totalIncome > 0 ? Math.round(surplus/totalIncome*100) : 0;

  return jsonResponse({ ok: true,
    year: y,
    totalIncome:          totalIncome,
    totalRegularExpenses: totalRegExp,
    totalProjectExpenses: totalProjExp,
    totalExpenses:        totalExp,
    surplus:              surplus,
    savingsRate:          savingsRate,
    monthly:              monthly,
    categories:           categories
  });
}
