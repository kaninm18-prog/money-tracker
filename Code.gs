// ============================================================
//  Money Tracker — Google Apps Script Backend v6
//
//  Sheets:
//    Expenses         → Date | Amount(THB) | Category | Note | Account | IsRecurring | RecurrencePeriod | ProjectId | OrigAmount | Currency | Id | CreatedAt (ms)
//    Income           → Date | Amount(THB) | Category | Note | Account | OrigAmount | Currency | Id
//    Transfers        → Date | Amount (in From currency) | FromAccount | ToAccount | Note | ReceivedAmount (in To currency, optional) | Id
//    Accounts         → Name | Type | StartingBalance | CreditLimit | DueDay | StatementDay | Currency | Rate (THB per 1 unit)
//    Categories       → Name | Icon
//    IncomeCategories → Name | Icon
//    Projects         → Name | Budget | StartDate | EndDate
//    Receivables      → Date | Amount | Counterparty | Type | Note | ReimbursedBy | Status | SettledDate | Account | Id
//    ReceivableRepayments → Id | ReceivableId | Date | Amount | Account | Note
//    InstallmentPlans → Description | PurchaseDate | Merchant | TotalAmount | InstallmentCount | InstallmentAmount | FirstInstallmentDate | Account | Category | ProjectId | Status | InstallmentsPaid
//    CategoryBudgets  → Category | MonthlyLimit | AlertThreshold | IsActive | AppliesToProjects
//    RecurringExpenses→ Description | Amount | Category | Account | DayOfMonth | StartDate | Status | LastGenerated | ProjectId | Frequency | MonthOfYear
//    Holdings         → Id | Name | Kind | Symbol | Unit | CurrentPrice (THB/unit) | PriceDate | Note | Status | QuoteCurrency | NextXD | NextDividend (per unit)
//    Trades           → Id | Ticket | Symbol | Side | Volume | OpenTime | OpenPrice | CloseTime | ClosePrice | Commission | Swap | Profit | Account | Note | Currency
//    AllocationTargets→ Class | TargetPct
//    HoldingTxns      → Id | HoldingId | Date | Type (buy/sell/dividend) | Quantity | Price | Amount (THB) | Fee (dividends: tax withheld) | Account | Note | LinkedId
//    NetWorthHistory  → Month (yyyy-MM) | Date | Accounts | Investments | Assets | NetWorth | Receivables  (one snapshot per month, latest wins)
//    _Prices          → scratch sheet (hidden) where GOOGLEFINANCE formulas are evaluated
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
  REPAYMENTS:   "ReceivableRepayments",
  HOLDINGS:     "Holdings",
  HOLDING_TXNS: "HoldingTxns",
  NETWORTH:     "NetWorthHistory",
  TRADES:       "Trades",
  TARGETS:      "AllocationTargets",
  PRICES:       "_Prices"
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
        sh.appendRow(["Date","Amount","Category","Note","Account","IsRecurring","RecurrencePeriod","ProjectId","OrigAmount","Currency","Id","CreatedAt"]);
        break;
      case SHEET.INCOME:
        sh.appendRow(["Date","Amount","Category","Note","Account","OrigAmount","Currency","Id"]);
        break;
      case SHEET.TRANSFERS:
        sh.appendRow(["Date","Amount","FromAccount","ToAccount","Note","ReceivedAmount","Id"]);
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
      case SHEET.HOLDINGS:
        sh.appendRow(["Id","Name","Kind","Symbol","Unit","CurrentPrice","PriceDate","Note","Status"]);
        sh.getRange(2, 7, 998, 1).setNumberFormat("@");
        break;
      case SHEET.HOLDING_TXNS:
        sh.appendRow(["Id","HoldingId","Date","Type","Quantity","Price","Amount","Fee","Account","Note","LinkedId"]);
        sh.getRange(2, 3, 998, 1).setNumberFormat("@");
        break;
      case SHEET.TRADES:
        sh.appendRow(["Id","Ticket","Symbol","Side","Volume","OpenTime","OpenPrice","CloseTime","ClosePrice","Commission","Swap","Profit","Account","Note","Currency"]);
        sh.getRange(2, 6, 998, 1).setNumberFormat("@"); sh.getRange(2, 8, 998, 1).setNumberFormat("@"); sh.getRange(2, 2, 998, 1).setNumberFormat("@");
        break;
      case SHEET.TARGETS:
        sh.appendRow(["Class","TargetPct"]);
        break;
      case SHEET.NETWORTH:
        sh.appendRow(["Month","Date","Accounts","Investments","Assets","NetWorth","Receivables"]);
        sh.getRange(2, 1, 998, 2).setNumberFormat("@");
        break;
      case SHEET.PRICES:
        sh.appendRow(["Symbol","Price","Currency"]);
        sh.hideSheet();
        break;
      case SHEET.RECURRING:
        sh.appendRow(["Description","Amount","Category","Account","DayOfMonth","StartDate","Status","LastGenerated","ProjectId","Frequency","MonthOfYear"]);
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

var _fmtMemo = {};
function formatDate(val) {
  if (!val) return "";
  // Apps Script date objects from getValues() don't pass instanceof Date in V8 —
  // check for object type instead, then use Utilities.formatDate to format correctly.
  if (typeof val === 'object') {                  // memoised: history rebuilds format the same dates many times
    var k = val.getTime ? val.getTime() : String(val);
    return _fmtMemo[k] || (_fmtMemo[k] = Utilities.formatDate(val, "GMT+7", "yyyy-MM-dd"));
  }
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

// ── Security: shared secret token ────────────────────────────
// Run setupToken() once from the Apps Script editor (Run ▶), copy the token from the
// Execution log, and paste it into the app (Settings → Script Connection → Access token).
function setupToken() {
  var props = PropertiesService.getScriptProperties();
  var t = props.getProperty("API_TOKEN");
  if (!t) { t = Utilities.getUuid().replace(/-/g, ""); props.setProperty("API_TOKEN", t); }
  Logger.log("Your Money Tracker access token: " + t);
  return t;
}
function tokenError(p) {
  var want = PropertiesService.getScriptProperties().getProperty("API_TOKEN");
  if (!want) return "No access token set on the server yet. In Apps Script, run setupToken() once.";
  if (String(p.token || "") !== want) return "unauthorized";
  return "";
}

// ── Stable row IDs ───────────────────────────────────────────
// Edits and deletes find their row by Id, so a row that moved (because something was
// deleted on another device) is still the one that gets changed.
var ID_COL = {};
ID_COL[SHEET.EXPENSES]    = 11;
ID_COL[SHEET.INCOME]      = 8;
ID_COL[SHEET.TRANSFERS]   = 7;
ID_COL[SHEET.RECEIVABLES] = 10;
ID_COL[SHEET.REPAYMENTS]  = 1;
ID_COL[SHEET.HOLDINGS]    = 1;
ID_COL[SHEET.HOLDING_TXNS] = 1;
ID_COL[SHEET.TRADES]      = 1;
var ID_PREFIX = {};
ID_PREFIX[SHEET.EXPENSES] = "E"; ID_PREFIX[SHEET.INCOME] = "I"; ID_PREFIX[SHEET.TRANSFERS] = "T";

function newId(prefix) { return prefix + Utilities.getUuid().replace(/-/g, "").slice(0, 10); }

// Give every existing row an Id (once per request per sheet)
var _idsDone = {};
function ensureRowIds(name) {
  if (_idsDone[name]) return;
  _idsDone[name] = true;
  var sh = getSheet(name), col = ID_COL[name], last = sh.getLastRow();
  ensureHeaders(sh, col, ["Id"]);
  if (last < 2) return;
  var key = sh.getRange(2, 1, last - 1, 2).getValues();
  var ids = sh.getRange(2, col, last - 1, 1).getValues(), ch = false;
  for (var i = 0; i < ids.length; i++) {
    if (!ids[i][0] && (key[i][0] || key[i][1])) { ids[i][0] = newId(ID_PREFIX[name] || "X"); ch = true; }
  }
  if (ch) sh.getRange(2, col, last - 1, 1).setValues(ids);
}

// Possible duplicate: same date, amount and account (from/to for transfers) already saved
function findDuplicate(name, p) {
  var amt = toFloat(p.amount), date = String(p.date || todayStr()), hit = null;
  sheetToRows(getSheet(name), function(d) { return d; }).forEach(function(d) {
    if (hit || formatDate(d[0]) !== date || Math.abs(toFloat(d[1]) - amt) > 0.005) return;
    if (name === SHEET.TRANSFERS) {
      if (String(d[2]).trim() === String(p.fromAccount || "").trim() && String(d[3]).trim() === String(p.toAccount || "").trim())
        hit = { date: date, amount: toFloat(d[1]), note: String(d[4] || ""), account: d[2] + " → " + d[3] };
    } else if (String(d[4]).trim() === String(p.account || "").trim()) {
      hit = { date: date, amount: toFloat(d[1]), category: cleanName(d[2]), note: String(d[3] || ""), account: String(d[4]) };
    }
  });
  return hit;
}
function dupResponse(m) { return jsonResponse({ ok: false, possibleDuplicate: true, match: m, error: "Possible duplicate" }); }

function idExists(name, id) {
  if (!id) return false;
  var sh = getSheet(name), col = ID_COL[name], last = sh.getLastRow();
  if (last < 2) return false;
  var ids = sh.getRange(2, col, last - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]) === String(id)) return true;
  return false;
}

// Find the sheet row for p.id (p.rowIndex is only a hint). 0 = not found.
function resolveRow(name, p) {
  var sh = getSheet(name), last = sh.getLastRow(), hint = parseInt(p.rowIndex) || 0;
  var col = ID_COL[name];
  if (p.id && col) {
    if (hint >= 2 && hint <= last && String(sh.getRange(hint, col).getValue()) === String(p.id)) return hint;
    if (last < 2) return 0;
    var ids = sh.getRange(2, col, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(p.id)) return i + 2;
    return 0;
  }
  return (hint >= 2 && hint <= last) ? hint : 0;      // older app version without ids
}

// For small lists (accounts, categories, projects…): check the row still holds the
// expected name (p.key, column 1); if it moved, find it by name.
function resolveByKey(name, p) {
  var sh = getSheet(name), last = sh.getLastRow(), hint = parseInt(p.rowIndex) || 0;
  if (p.key === undefined || p.key === null || p.key === "") return (hint >= 2 && hint <= last) ? hint : 0;
  var want = String(p.key);
  if (hint >= 2 && hint <= last && String(sh.getRange(hint, 1).getValue()) === want) return hint;
  if (last < 2) return 0;
  var v = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < v.length; i++) if (String(v[i][0]) === want) return i + 2;
  return 0;
}

function staleResponse() {
  return jsonResponse({ ok: false, stale: true,
    error: "This item was changed or deleted on another device. The app has refreshed, please try again." });
}

// ── Category names ───────────────────────────────────────────
// Strip invisible characters (emoji variation selectors, zero-width spaces) that made
// "Shopping" and "️Shopping" two different categories.
function cleanName(s) {
  return String(s == null ? "" : s).replace(/[︎️​-‍⁠﻿]/g, "").replace(/\s+/g, " ").trim();
}

// One-time repair of existing data (runs automatically once, from bootstrap)
function cleanupCategoriesOnce() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty("CLEAN_CATS_V1")) return 0;
  var fixed = 0;
  [[SHEET.EXPENSES, 3], [SHEET.INCOME, 3], [SHEET.BUDGETS, 1], [SHEET.RECURRING, 3], [SHEET.INSTALLMENTS, 9],
   [SHEET.CATEGORIES, 1], [SHEET.INCOME_CATS, 1]].forEach(function(sc) {
    var sh = getSheet(sc[0]), last = sh.getLastRow();
    if (last < 2) return;
    var rng = sh.getRange(2, sc[1], last - 1, 1), v = rng.getValues(), ch = false;
    v.forEach(function(r) { if (typeof r[0] === "string") { var c = cleanName(r[0]); if (c !== r[0]) { r[0] = c; ch = true; fixed++; } } });
    if (ch) rng.setValues(v);
  });
  // Remove duplicate category rows (keep the first)
  [SHEET.CATEGORIES, SHEET.INCOME_CATS].forEach(function(n) {
    var sh = getSheet(n), last = sh.getLastRow();
    if (last < 2) return;
    var v = sh.getRange(2, 1, last - 1, 1).getValues(), seen = {}, dup = [];
    v.forEach(function(r, i) { var k = String(r[0]).toLowerCase(); if (!k) return; if (seen[k]) dup.push(i + 2); else seen[k] = true; });
    for (var j = dup.length - 1; j >= 0; j--) sh.deleteRow(dup[j]);
  });
  props.setProperty("CLEAN_CATS_V1", new Date().toISOString());
  return fixed;
}

// During startup every sheet is read once and shared by all getters (was ~5 reads of Expenses)
var _readCache = null;
function sheetValues(sh) {
  if (!_readCache) return sh.getDataRange().getValues();
  var k = sh.getName();
  if (!_readCache[k]) _readCache[k] = sh.getDataRange().getValues();
  return _readCache[k];
}

function sheetToRows(sh, mapper) {
  var data = sheetValues(sh);
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0] && !data[i][1]) continue;
    rows.push(mapper(data[i], i + 1));
  }
  return rows;
}

// ── Entry Point ───────────────────────────────────────────────

function doPost(e) {
  var lock = null;
  try {
    var p = JSON.parse(e.postData.contents);
    var authErr = tokenError(p);
    if (authErr) return jsonResponse({ ok: false, auth: true, error: authErr });
    // One request at a time: stops laptop + phone from creating the same recurring /
    // installment rows twice, or writing over each other.
    lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) { lock = null; return jsonResponse({ ok: false, error: "Server busy, please try again" }); }
    return route(p);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  } finally {
    if (lock) { SpreadsheetApp.flush(); lock.releaseLock(); }
  }
}

function route(p) {
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
      case "setCategoryIcon":        return setCategoryIcon(p);
      case "refreshPrices":          return jsonResponse(refreshPrices());
      case "getTrades":              return jsonResponse(getTrades());
      case "addTrade":               return addTrade(p);
      case "deleteTrade":            return deleteTrade(p);
      case "importTrades":           return importTrades(p);
      case "importPack":             return importPack(p);
      case "setTargets":             return setTargets(p);
      case "setBenchmark":           return setBenchmark(p);
      case "getNetWorthHistory":     return jsonResponse(netWorthHistory(null));
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
      case "getTrends":              return getTrends(p);
      case "searchTransactions":     return searchTransactions(p);
      case "getHoldings":            return jsonResponse(holdingsData());
      case "addHolding":             return addHolding(p);
      case "updateHolding":          return updateHolding(p);
      case "deleteHolding":          return deleteHolding(p);
      case "addHoldingTxn":          return addHoldingTxn(p);
      case "deleteHoldingTxn":       return deleteHoldingTxn(p);
      case "backupNow":              return jsonResponse({ ok: true, name: backupNow(), last: todayStr() });
      default:
        return jsonResponse({ ok: false, error: "Unknown action: " + p.action });
    }
}

// One round-trip startup: returns everything the app needs on open.
// Reuses the existing getters (parsing their JSON) so logic stays identical.
function bootstrap(p) {
  function run(fn) { return JSON.parse(fn().getContent()); }
  // writes first (repairs, ids, due recurring/installment rows), then one read pass
  cleanupCategoriesOnce();
  ensureRowIds(SHEET.EXPENSES); ensureRowIds(SHEET.INCOME); ensureRowIds(SHEET.TRANSFERS);
  recvEnsureIds(getSheet(SHEET.RECEIVABLES));
  var generated = 0;
  if (p.runChecks) {
    generated += run(checkInstallments).generated || 0;
    generated += run(checkRecurring).generated || 0;
  }
  _readCache = {};
  try {
  var acc  = run(getAccounts);
  var exp  = run(getCategories);
  var inc  = run(getIncomeCategories);
  var txn  = run(function(){ return getAllTransactions(p); });
  var prj  = run(getProjects);
  var rec  = run(getReceivables);
  var ins  = run(getInstallmentPlans);
  var bud  = run(function(){ return getBudgets(p); });
  var rcr  = run(getRecurring);
  var trd  = run(function(){ return getTrends(p); });
  var hist = expenseHistory(180);
  var hld  = holdingsData();
  var pf   = portfolioMeta();
  var live = { accounts: acc.totalBalance || 0, investments: hld.totals.investments, assets: hld.totals.assets, receivables: receivablesAt("") };
  var nwh  = netWorthHistory(live);
  } finally { _readCache = null; }
  saveNetWorthSnapshot(live);
  var props = PropertiesService.getScriptProperties();
  return jsonResponse({
    ok: true,
    accounts: acc, categories: exp, incomeCategories: inc, transactions: txn,
    projects: prj, receivables: rec, installmentPlans: ins, budgets: bud, recurringExpenses: rcr,
    trends: trd, holdings: hld, netWorth: nwh, history: hist, portfolio: pf, checked: !!p.runChecks, generated: generated,
    prices: { last: props.getProperty("LAST_PRICE_REFRESH") || "", daily: !!props.getProperty("PRICES_DAILY") },
    backup: { last: props.getProperty("LAST_BACKUP") || "", weekly: !!props.getProperty("BACKUP_WEEKLY") }
  });
}

// ── RECURRING EXPENSES ───────────────────────────────────────
// Each row is one independent recurring charge (own amount and day of month).
// checkRecurring() creates a normal Expenses row for every due month it has not created yet.

function recurringRow(d, ri) {
  return {
    rowIndex: ri, description: d[0], amount: toFloat(d[1]), category: d[2], account: d[3],
    dayOfMonth: parseInt(d[4]) || 1, startDate: formatDate(d[5]),
    status: d[6] || "active", lastGenerated: formatDate(d[7]), projectId: d[8] || "",
    frequency: String(d[9] || "monthly") === "yearly" ? "yearly" : "monthly",
    monthOfYear: parseInt(d[10]) || (formatDate(d[5]) ? parseInt(formatDate(d[5]).substring(5, 7)) : 1)
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
  var freq = p.frequency === "yearly" ? "yearly" : "monthly";
  var start = p.startDate || todayStr();
  var moy = Math.min(12, Math.max(1, parseInt(p.monthOfYear) || parseInt(start.substring(5, 7))));
  ensureHeaders(sh, 10, ["Frequency", "MonthOfYear"]);
  sh.getRange(r, 1, 1, 11).setValues([[desc, amt, cleanName(p.category), p.account || "", day,
    start, p.status || "active", p.lastGenerated || "", p.projectId || "", freq, moy]]);
  return jsonResponse({ ok: true, rowIndex: r });
}

function updateRecurring(p) {
  var sh = getSheet(SHEET.RECURRING), row = resolveByKey(SHEET.RECURRING, p);
  if (!row) return staleResponse();
  var day = Math.min(31, Math.max(1, parseInt(p.dayOfMonth) || 1));
  sh.getRange(row, 6).setNumberFormat("@");
  sh.getRange(row, 1, 1, 7).setValues([[String(p.description || "").trim(), toFloat(p.amount), cleanName(p.category),
    p.account || "", day, p.startDate || todayStr(), p.status || "active"]]);
  sh.getRange(row, 9).setValue(p.projectId || "");
  ensureHeaders(sh, 10, ["Frequency", "MonthOfYear"]);
  var start = p.startDate || todayStr();
  sh.getRange(row, 10, 1, 2).setValues([[p.frequency === "yearly" ? "yearly" : "monthly",
    Math.min(12, Math.max(1, parseInt(p.monthOfYear) || parseInt(start.substring(5, 7))))]]);
  return jsonResponse({ ok: true });
}

function deleteRecurring(p) {
  var sh = getSheet(SHEET.RECURRING), row = resolveByKey(SHEET.RECURRING, p);
  if (!row) return staleResponse();
  sh.deleteRow(row);
  return jsonResponse({ ok: true });
}

function pad2(n) { return n < 10 ? "0" + n : "" + n; }

function checkRecurring() {
  var sh = getSheet(SHEET.RECURRING), expSh = getSheet(SHEET.EXPENSES);
  ensureRowIds(SHEET.EXPENSES);
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
    while ((y < ty || (y === ty && m <= tm)) && guard < 60) {
      var dim = new Date(y, m, 0).getDate();      // days in month (Feb 30 -> 28/29)
      var due = y + "-" + pad2(m) + "-" + pad2(Math.min(it.dayOfMonth, dim));
      if (due > today) break;                     // not due yet - try again next time
      var inMonth = it.frequency !== "yearly" || m === it.monthOfYear;
      if (inMonth && (!it.startDate || due >= it.startDate)) {
        newRows.push([due, it.amount, it.category || "Subscription", it.description, it.account || "",
                      "TRUE", it.frequency, it.projectId || "", "", "", newId("E")]);
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
  if (newRows.length) expSh.getRange(expSh.getLastRow() + 1, 1, newRows.length, 11).setValues(newRows);
  return jsonResponse({ ok: true, generated: generated });
}

function doGet() {
  return jsonResponse({ ok: true, message: "Money Tracker API v6 — live" });
}

// ── EXPENSES ──────────────────────────────────────────────────

function addExpense(p) {
  var sh = getSheet(SHEET.EXPENSES);
  ensureRowIds(SHEET.EXPENSES);
  if (p.id && idExists(SHEET.EXPENSES, p.id)) return jsonResponse({ ok: true, duplicate: true, id: p.id });
  if (p.checkDup) { var dm = findDuplicate(SHEET.EXPENSES, p); if (dm) return dupResponse(dm); }
  var fx0 = fxFields(p);
  sh.appendRow([
    p.date || todayStr(),
    toFloat(p.amount),
    cleanName(p.category),
    p.note || "",
    p.account || "",
    p.isRecurring ? "TRUE" : "FALSE",
    p.recurrencePeriod || "",
    p.projectId || "",
    fx0[0], fx0[1],
    String(p.id || newId("E")),
    toFloat(p.createdAt) || Date.now()          // when it was logged (ms) — used to learn your habits by time of day
  ]);
  if (fx0[0]) ensureHeaders(sh, 9, ["OrigAmount", "Currency"]);
  ensureHeaders(sh, 12, ["CreatedAt"]);
  return jsonResponse({ ok: true, rowIndex: sh.getLastRow() });
}

function getExpenses(p) {
  var sh   = getSheet(SHEET.EXPENSES);
  var rows = sheetToRows(sh, function(d, ri) {
    return {
      rowIndex: ri, date: formatDate(d[0]), amount: toFloat(d[1]),
      category: d[2], note: d[3], account: d[4],
      isRecurring: toBool(d[5]), recurrencePeriod: d[6] || "", projectId: d[7] || "",
      origAmount: toFloat(d[8]) || 0, currency: d[9] || "", id: String(d[10] || "")
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
  var row = resolveRow(SHEET.EXPENSES, p);
  if (!row) return staleResponse();
  sh.getRange(row, 1, 1, 10).setValues([[
    p.date || "", toFloat(p.amount), cleanName(p.category), p.note || "", p.account || "",
    p.isRecurring ? "TRUE" : "FALSE", p.recurrencePeriod || "", p.projectId || ""
  ].concat(fxFields(p))]);
  if (fxFields(p)[0]) ensureHeaders(sh, 9, ["OrigAmount", "Currency"]);
  return jsonResponse({ ok: true });
}

function deleteExpense(p) {
  var sh  = getSheet(SHEET.EXPENSES);
  var row = resolveRow(SHEET.EXPENSES, p);
  if (!row) return staleResponse();
  sh.deleteRow(row);
  return jsonResponse({ ok: true });
}

// ── INCOME ────────────────────────────────────────────────────

function addIncome(p) {
  var sh = getSheet(SHEET.INCOME);
  ensureRowIds(SHEET.INCOME);
  if (p.id && idExists(SHEET.INCOME, p.id)) return jsonResponse({ ok: true, duplicate: true, id: p.id });
  if (p.checkDup) { var dm = findDuplicate(SHEET.INCOME, p); if (dm) return dupResponse(dm); }
  sh.appendRow([p.date || todayStr(), toFloat(p.amount), cleanName(p.category), p.note || "", p.account || ""]
    .concat(fxFields(p)).concat([String(p.id || newId("I"))]));
  if (fxFields(p)[0]) ensureHeaders(sh, 6, ["OrigAmount", "Currency"]);
  return jsonResponse({ ok: true, rowIndex: sh.getLastRow() });
}

function getIncome(p) {
  var sh   = getSheet(SHEET.INCOME);
  var rows = sheetToRows(sh, function(d, ri) {
    return { rowIndex: ri, date: formatDate(d[0]), amount: toFloat(d[1]), category: d[2], note: d[3], account: d[4],
      origAmount: toFloat(d[5]) || 0, currency: d[6] || "", id: String(d[7] || "") };
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
  var row = resolveRow(SHEET.INCOME, p);
  if (!row) return staleResponse();
  sh.getRange(row, 1, 1, 7).setValues([[p.date || "", toFloat(p.amount), cleanName(p.category), p.note || "", p.account || ""].concat(fxFields(p))]);
  if (fxFields(p)[0]) ensureHeaders(sh, 6, ["OrigAmount", "Currency"]);
  return jsonResponse({ ok: true });
}

function deleteIncome(p) {
  var sh  = getSheet(SHEET.INCOME);
  var row = resolveRow(SHEET.INCOME, p);
  if (!row) return staleResponse();
  sh.deleteRow(row);
  return jsonResponse({ ok: true });
}

// ── TRANSFERS ─────────────────────────────────────────────────

function addTransfer(p) {
  var sh = getSheet(SHEET.TRANSFERS);
  var rcv = toFloat(p.receivedAmount);
  ensureRowIds(SHEET.TRANSFERS);
  if (p.id && idExists(SHEET.TRANSFERS, p.id)) return jsonResponse({ ok: true, duplicate: true, id: p.id });
  if (p.checkDup) { var dm = findDuplicate(SHEET.TRANSFERS, p); if (dm) return dupResponse(dm); }
  sh.appendRow([p.date || todayStr(), toFloat(p.amount), p.fromAccount || "", p.toAccount || "", p.note || "", rcv > 0 ? rcv : "",
    String(p.id || newId("T"))]);
  if (rcv > 0) ensureHeaders(sh, 6, ["ReceivedAmount"]);
  return jsonResponse({ ok: true, rowIndex: sh.getLastRow() });
}

function getTransfers(p) {
  var sh   = getSheet(SHEET.TRANSFERS);
  var rows = sheetToRows(sh, function(d, ri) {
    return { rowIndex: ri, date: formatDate(d[0]), amount: toFloat(d[1]), fromAccount: d[2], toAccount: d[3], note: d[4], receivedAmount: toFloat(d[5]) || 0, id: String(d[6] || "") };
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
  var row = resolveRow(SHEET.TRANSFERS, p);
  if (!row) return staleResponse();
  sh.deleteRow(row);
  return jsonResponse({ ok: true });
}

function updateTransfer(p) {
  var sh  = getSheet(SHEET.TRANSFERS);
  var row = resolveRow(SHEET.TRANSFERS, p);
  if (!row) return staleResponse();
  var rcv = toFloat(p.receivedAmount);
  sh.getRange(row, 1, 1, 6).setValues([[
    p.date || todayStr(), toFloat(p.amount),
    p.fromAccount || "", p.toAccount || "", p.note || "", rcv > 0 ? rcv : ""
  ]]);
  if (rcv > 0) ensureHeaders(sh, 6, ["ReceivedAmount"]);
  return jsonResponse({ ok: true });
}

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
    var amt = a.currency === 'THB' ? t.amount : t.amount / a.rate;
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

// ── CATEGORIES ────────────────────────────────────────────────

function getCategories() {
  var sh = getSheet(SHEET.CATEGORIES);
  return jsonResponse({ ok: true, categories: sheetToRows(sh, function(d, ri){ return { rowIndex: ri, name: d[0], icon: String(d[1] || "") }; }) });
}
function categoryExists(sheetName, name) {
  return sheetToRows(getSheet(sheetName), function(d){ return cleanName(d[0]).toLowerCase(); })
    .indexOf(name.toLowerCase()) >= 0;
}
function addCategory(p) {
  var name = cleanName(p.name);
  if (!name) return jsonResponse({ ok: false, error: "Name required" });
  if (categoryExists(SHEET.CATEGORIES, name)) return jsonResponse({ ok: false, error: "That category already exists" });
  var sh = getSheet(SHEET.CATEGORIES); sh.appendRow([name, cleanIcon(p.icon)]);
  if (cleanIcon(p.icon)) ensureHeaders(sh, 2, ["Icon"]);
  return jsonResponse({ ok: true, rowIndex: sh.getLastRow() });
}
function deleteCategory(p) {
  var sh = getSheet(SHEET.CATEGORIES); var row = resolveByKey(SHEET.CATEGORIES, p);
  if (!row) return staleResponse();
  sh.deleteRow(row); return jsonResponse({ ok: true });
}

function getIncomeCategories() {
  var sh = getSheet(SHEET.INCOME_CATS);
  return jsonResponse({ ok: true, categories: sheetToRows(sh, function(d, ri){ return { rowIndex: ri, name: d[0], icon: String(d[1] || "") }; }) });
}
function addIncomeCategory(p) {
  var name = cleanName(p.name);
  if (!name) return jsonResponse({ ok: false, error: "Name required" });
  if (categoryExists(SHEET.INCOME_CATS, name)) return jsonResponse({ ok: false, error: "That category already exists" });
  var sh = getSheet(SHEET.INCOME_CATS); sh.appendRow([name, cleanIcon(p.icon)]);
  if (cleanIcon(p.icon)) ensureHeaders(sh, 2, ["Icon"]);
  return jsonResponse({ ok: true, rowIndex: sh.getLastRow() });
}
function deleteIncomeCategory(p) {
  var sh = getSheet(SHEET.INCOME_CATS); var row = resolveByKey(SHEET.INCOME_CATS, p);
  if (!row) return staleResponse();
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
  var row = resolveByKey(SHEET.PROJECTS, p);
  if (!row) return staleResponse();
  sh.getRange(row, 1, 1, 4).setValues([[p.name || "", toFloat(p.budget), p.startDate || "", p.endDate || ""]]);
  return jsonResponse({ ok: true });
}

function deleteProject(p) {
  var sh  = getSheet(SHEET.PROJECTS);
  var row = resolveByKey(SHEET.PROJECTS, p);
  if (!row) return staleResponse();
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
  recvEnsureIds(sh);
  var row = resolveRow(SHEET.RECEIVABLES, p);
  if (!row) return staleResponse();
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
  all.forEach(function(x){ if (p.receivableId ? x.id === String(p.receivableId) : (p.rowIndex && x.rowIndex === parseInt(p.rowIndex))) rv = x; });
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
  var sh = getSheet(SHEET.REPAYMENTS), row = resolveRow(SHEET.REPAYMENTS, p);
  if (!row) return staleResponse();
  var recvId = String(sh.getRange(row, 2).getValue() || "");
  sh.deleteRow(row);
  loadReceivables().forEach(function(rv){
    if (rv.id === recvId && rv.status === "settled" && rv.repayments.length && rv.left > 0.005) markRecvStatus(rv.rowIndex, "pending", "");
  });
  return jsonResponse({ ok: true });
}

function settleReceivable(p) {
  recvEnsureIds(getSheet(SHEET.RECEIVABLES));
  var row = resolveRow(SHEET.RECEIVABLES, p);
  if (!row) return staleResponse();
  var date = p.settledDate || todayStr(), rv = null;
  loadReceivables().forEach(function(x){ if (x.rowIndex === row) rv = x; });
  if (rv && rv.status !== "settled" && rv.left > 0.005) addRepaymentRow(rv, rv.left, date, String(p.account || "").trim(), "Marked settled");
  markRecvStatus(row, "settled", date);
  return jsonResponse({ ok: true });
}

function deleteReceivable(p) {
  var sh  = getSheet(SHEET.RECEIVABLES);
  recvEnsureIds(sh);
  var row = resolveRow(SHEET.RECEIVABLES, p);
  if (!row) return staleResponse();
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
      origAmount: toFloat(d[8]) || 0, currency: d[9] || "", id: String(d[10] || "") };
  }).forEach(function(r){ if (inPeriod(r.date)) txns.push(r); });

  sheetToRows(getSheet(SHEET.INCOME), function(d, ri) {
    return { rowIndex: ri, type: "income", date: formatDate(d[0]), amount: toFloat(d[1]),
      category: d[2], note: d[3], account: d[4], origAmount: toFloat(d[5]) || 0, currency: d[6] || "", id: String(d[7] || "") };
  }).forEach(function(r){ if (inPeriod(r.date)) txns.push(r); });

  sheetToRows(getSheet(SHEET.TRANSFERS), function(d, ri) {
    return { rowIndex: ri, type: "transfer", date: formatDate(d[0]), amount: toFloat(d[1]),
      fromAccount: d[2], toAccount: d[3], note: d[4], receivedAmount: toFloat(d[5]) || 0, id: String(d[6] || "") };
  }).forEach(function(r){ if (inPeriod(r.date)) txns.push(r); });

  // Asset / investment buys and sells (cash movements, not expenses)
  var hNames = {};
  sheetToRows(getSheet(SHEET.HOLDINGS), function(d){ return { id: String(d[0]), name: String(d[1]), unit: String(d[4] || "") }; })
    .forEach(function(h){ hNames[h.id] = h; });
  holdingTxnRows().forEach(function(t) {
    if ((t.type !== 'buy' && t.type !== 'sell') || !inPeriod(t.date)) return;
    var h = hNames[t.holdingId] || {};
    txns.push({ rowIndex: t.rowIndex, id: t.id, type: "holding", holdingTxnType: t.type, holdingId: t.holdingId,
      holdingName: h.name || "?", unit: h.unit || "", date: t.date, amount: t.amount, quantity: t.quantity,
      price: t.price, fee: t.fee, account: t.account, note: t.note });
  });

  // Pending receivables: always included regardless of month filter
  // (they are ongoing obligations that affect account balance until settled)
  loadReceivables().forEach(function(rv) {
    if (rv.status === 'pending') {
      txns.push({ rowIndex: rv.rowIndex, id: rv.id, type: "receivable", date: rv.date, amount: rv.amount,
        counterparty: String(rv.counterparty||''), recvType: String(rv.type||'advance'),
        note: String(rv.note||''), reimbursedBy: String(rv.reimbursedBy||''),
        status: rv.status, account: rv.account, returned: rv.returned, left: rv.left });
    }
    rv.repayments.forEach(function(rp) {
      if (!inPeriod(rp.date)) return;
      txns.push({ rowIndex: rp.rowIndex, id: String(rp.id || ""), type: "repayment", date: rp.date, amount: rp.amount,
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
    p.account || '', cleanName(p.category),
    p.projectId || '', 'active', 0
  ]);
  return jsonResponse({ ok: true, rowIndex: sh.getLastRow() });
}

function updateInstallmentPlan(p) {
  var sh  = getSheet(SHEET.INSTALLMENTS);
  var row = resolveByKey(SHEET.INSTALLMENTS, p);
  if (!row) return staleResponse();
  var count   = parseInt(p.installmentCount) || 1;
  var total   = toFloat(p.totalAmount);
  var instAmt = Math.round(total / count * 100) / 100;
  sh.getRange(row, 1, 1, 12).setValues([[
    p.description || '', p.purchaseDate || '', p.merchant || '',
    total, count, instAmt, p.firstInstallmentDate || '',
    p.account || '', cleanName(p.category), p.projectId || '',
    p.status || 'active', parseInt(p.installmentsPaid) || 0
  ]]);
  return jsonResponse({ ok: true });
}

function deleteInstallmentPlan(p) {
  var sh  = getSheet(SHEET.INSTALLMENTS);
  var row = resolveByKey(SHEET.INSTALLMENTS, p);
  if (!row) return staleResponse();
  sh.deleteRow(row);
  return jsonResponse({ ok: true });
}

// Auto-generates expense rows for any installments that are due and not yet recorded
function checkInstallments() {
  var sh     = getSheet(SHEET.INSTALLMENTS);
  var expSh  = getSheet(SHEET.EXPENSES);
  ensureRowIds(SHEET.EXPENSES);
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
        plan.account || '', 'FALSE', '', plan.projectId || '', '', '', newId('E')
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
  ensureRowIds(SHEET.EXPENSES);
  var row   = resolveByKey(SHEET.INSTALLMENTS, p);
  if (!row) return staleResponse();

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
    plan.account || '', 'FALSE', '', plan.projectId || '', '', '', newId('E')
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
    cleanName(p.category),
    toFloat(p.monthlyLimit),
    toFloat(p.alertThreshold) || 0.8,
    p.isActive === false ? 'FALSE' : 'TRUE',
    p.appliesToProjects ? 'TRUE' : 'FALSE'
  ];
  if (p.rowIndex) {
    var row = resolveByKey(SHEET.BUDGETS, p);
    if (!row) return staleResponse();
    sh.getRange(row, 1, 1, 5).setValues([vals]);
  } else {
    sh.appendRow(vals);
  }
  return jsonResponse({ ok: true, rowIndex: sh.getLastRow() });
}

function deleteBudget(p) {
  var sh  = getSheet(SHEET.BUDGETS);
  var row = resolveByKey(SHEET.BUDGETS, p);
  if (!row) return staleResponse();
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

// ── SPENDING TRENDS ──────────────────────────────────────────
// Last 12 months up to the current month: regular (non-project) spending, project
// spending, income, and regular spending per category.
function getTrends(p) {
  var today = todayStr();
  var ey = parseInt(today.substring(0, 4)), em = parseInt(today.substring(5, 7));
  var months = [], idx = {};
  for (var k = 11; k >= 0; k--) {
    var y = ey, m = em - k;
    while (m < 1) { m += 12; y--; }
    var key = y + "-" + pad2(m);
    idx[key] = months.length;
    months.push({ year: y, month: m, expense: 0, projectExpense: 0, income: 0, byCat: {} });
  }
  sheetToRows(getSheet(SHEET.EXPENSES), function(d) {
    return { date: formatDate(d[0]), amount: toFloat(d[1]), category: cleanName(d[2]) || "Other", projectId: d[7] || "" };
  }).forEach(function(r) {
    var i = idx[r.date.substring(0, 7)];
    if (i === undefined) return;
    var mo = months[i];
    if (r.projectId) { mo.projectExpense += r.amount; return; }
    mo.expense += r.amount;
    mo.byCat[r.category] = (mo.byCat[r.category] || 0) + r.amount;
  });
  sheetToRows(getSheet(SHEET.INCOME), function(d) {
    return { date: formatDate(d[0]), amount: toFloat(d[1]) };
  }).forEach(function(r) {
    var i = idx[r.date.substring(0, 7)];
    if (i !== undefined) months[i].income += r.amount;
  });
  months.forEach(function(mo) {
    mo.expense = round2(mo.expense); mo.projectExpense = round2(mo.projectExpense); mo.income = round2(mo.income);
    Object.keys(mo.byCat).forEach(function(c) { mo.byCat[c] = round2(mo.byCat[c]); });
  });
  return jsonResponse({ ok: true, months: months });
}

// ── CREDIT CARD STATEMENTS ───────────────────────────────────
// The statement closes on StatementDay each month. Returns the last closed statement
// (what the bank bills), payments made since it closed, and the current cycle so far.
function ymd(y, m, d) { var dim = new Date(y, m, 0).getDate(); return y + "-" + pad2(m) + "-" + pad2(Math.min(d, dim)); }
function shiftMonth(y, m, n) { m += n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return [y, m]; }
function dayAfter(s) {
  var d = new Date(Date.UTC(parseInt(s.substring(0, 4)), parseInt(s.substring(5, 7)) - 1, parseInt(s.substring(8, 10)) + 1));
  return d.toISOString().slice(0, 10);
}
function cardStatement(a, today, expRows, trfRows) {
  var ty = parseInt(today.substring(0, 4)), tm = parseInt(today.substring(5, 7)), S = a.statementDay;
  var lc = today > ymd(ty, tm, S) ? [ty, tm] : shiftMonth(ty, tm, -1);
  var lastClose = ymd(lc[0], lc[1], S);
  var pc = shiftMonth(lc[0], lc[1], -1), prevClose = ymd(pc[0], pc[1], S);
  var nc = shiftMonth(lc[0], lc[1], 1),  nextClose = ymd(nc[0], nc[1], S);
  var name = String(a.name || "").trim();
  function spend(from, to) {
    return round2(expRows.reduce(function(s, r) {
      return (r.account === name && r.date > from && r.date <= to) ? s + amtForAccount(a, r.amount, r.orig, r.cur) : s;
    }, 0));
  }
  var paid = round2(trfRows.reduce(function(s, r) {
    return (r.to === name && r.date > lastClose && r.date <= today) ? s + (r.received || r.amount) : s;
  }, 0));
  var lastSpend = spend(prevClose, lastClose);
  var due = "";
  if (a.dueDay) {
    due = ymd(lc[0], lc[1], a.dueDay);
    if (due <= lastClose) { var dm = shiftMonth(lc[0], lc[1], 1); due = ymd(dm[0], dm[1], a.dueDay); }
  }
  return {
    lastStart: dayAfter(prevClose), lastEnd: lastClose, lastSpend: lastSpend,
    paidSince: paid, leftToPay: Math.max(0, round2(lastSpend - paid)), dueDate: due,
    curStart: dayAfter(lastClose), curEnd: nextClose, curSpend: spend(lastClose, today)
  };
}

// ── SEARCH (all months) ──────────────────────────────────────
function searchTransactions(p) {
  var q = cleanName(p.q).toLowerCase();
  if (q.length < 2) return jsonResponse({ ok: true, transactions: [], total: 0 });
  var out = [];
  function hit(parts) { return parts.join(" ").toLowerCase().indexOf(q) >= 0; }
  sheetToRows(getSheet(SHEET.EXPENSES), function(d, ri) {
    return { rowIndex: ri, type: "expense", date: formatDate(d[0]), amount: toFloat(d[1]),
      category: cleanName(d[2]), note: String(d[3] || ""), account: String(d[4] || ""),
      isRecurring: toBool(d[5]), recurrencePeriod: d[6] || "", projectId: d[7] || "",
      origAmount: toFloat(d[8]) || 0, currency: d[9] || "", id: String(d[10] || "") };
  }).forEach(function(r) { if (hit([r.category, r.note, r.account, r.projectId, r.amount])) out.push(r); });
  sheetToRows(getSheet(SHEET.INCOME), function(d, ri) {
    return { rowIndex: ri, type: "income", date: formatDate(d[0]), amount: toFloat(d[1]),
      category: cleanName(d[2]), note: String(d[3] || ""), account: String(d[4] || ""),
      origAmount: toFloat(d[5]) || 0, currency: d[6] || "", id: String(d[7] || "") };
  }).forEach(function(r) { if (hit([r.category, r.note, r.account, r.amount])) out.push(r); });
  sheetToRows(getSheet(SHEET.TRANSFERS), function(d, ri) {
    return { rowIndex: ri, type: "transfer", date: formatDate(d[0]), amount: toFloat(d[1]),
      fromAccount: String(d[2] || ""), toAccount: String(d[3] || ""), note: String(d[4] || ""),
      receivedAmount: toFloat(d[5]) || 0, id: String(d[6] || "") };
  }).forEach(function(r) { if (hit([r.fromAccount, r.toAccount, r.note, r.amount])) out.push(r); });
  out.sort(function(a, b) { return b.date.localeCompare(a.date); });
  return jsonResponse({ ok: true, transactions: out.slice(0, 200), total: out.length });
}

// ── BACKUP ───────────────────────────────────────────────────
// Run setupWeeklyBackup() once from the Apps Script editor (it asks for Drive permission).
// Every Sunday ~3am a copy of this spreadsheet goes to "Money Tracker Backups" in your Drive;
// the newest 12 copies are kept.
var BACKUP_FOLDER = "Money Tracker Backups", BACKUP_KEEP = 12;
function backupNow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var it = DriveApp.getFoldersByName(BACKUP_FOLDER);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(BACKUP_FOLDER);
  var name = ss.getName() + " - backup " + todayStr();
  DriveApp.getFileById(ss.getId()).makeCopy(name, folder);
  var files = [], fi = folder.getFiles();
  while (fi.hasNext()) files.push(fi.next());
  files.sort(function(a, b) { return b.getDateCreated() - a.getDateCreated(); });
  files.slice(BACKUP_KEEP).forEach(function(f) { f.setTrashed(true); });
  PropertiesService.getScriptProperties().setProperty("LAST_BACKUP", todayStr());
  return name;
}
function setupWeeklyBackup() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "backupNow") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("backupNow").timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).create();
  PropertiesService.getScriptProperties().setProperty("BACKUP_WEEKLY", "sunday");
  var name = backupNow();
  Logger.log("Weekly backup is on. First backup made: " + name);
}

// ── ASSETS & INVESTMENTS ─────────────────────────────────────
// A holding is anything you own that isn't cash: gold, stocks, funds, property, a car...
// Buying/selling moves cash in/out of an account but is NOT an expense or income.
// Fees are real expenses (saved to Expenses, category "Investment Fees");
// dividends are income (saved to Income, category "Investment Returns").
// Cost basis uses the average-cost method.
var HOLDING_KINDS = { gold: "investment", stock: "investment", etf: "investment", fund: "investment",
  crypto: "investment", bond: "investment", property: "asset", vehicle: "asset", electronics: "asset", other: "asset" };

function holdingTxnRows() {
  return sheetToRows(getSheet(SHEET.HOLDING_TXNS), function(d, ri) {
    return { rowIndex: ri, id: String(d[0] || ""), holdingId: String(d[1] || ""), date: formatDate(d[2]),
      type: String(d[3] || ""), quantity: toFloat(d[4]), price: toFloat(d[5]), amount: toFloat(d[6]),
      fee: toFloat(d[7]), account: String(d[8] || "").trim(), note: String(d[9] || ""), linkedId: String(d[10] || "") };
  });
}

function holdingsData() {
  var txns = holdingTxnRows();
  var holdings = sheetToRows(getSheet(SHEET.HOLDINGS), function(d, ri) {
    var kind = String(d[2] || "other");
    return { rowIndex: ri, id: String(d[0] || ""), name: String(d[1] || ""), kind: kind,
      group: HOLDING_KINDS[kind] || "asset", symbol: String(d[3] || ""), unit: String(d[4] || ""),
      currentPrice: toFloat(d[5]), priceDate: formatDate(d[6]), note: String(d[7] || ""),
      status: String(d[8] || "active"), quoteCurrency: String(d[9] || ""), nextXD: formatDate(d[10]), nextDividend: toFloat(d[11]) };
  });
  var totals = { value: 0, cost: 0, unrealized: 0, realized: 0, dividends: 0, investments: 0, assets: 0 };
  holdings.forEach(function(h) {
    var mine = txns.filter(function(t){ return t.holdingId === h.id; })
      .sort(function(a, b){ return a.date === b.date ? a.rowIndex - b.rowIndex : a.date.localeCompare(b.date); });
    var qty = 0, cost = 0, realized = 0, dividends = 0, invested = 0, fees = 0, lastPrice = 0, tax = 0;
    mine.forEach(function(t) {
      if (t.type === "dividend") tax += t.fee; else fees += t.fee;     // on dividends the Fee column holds tax withheld
      if (t.type === "buy") { qty += t.quantity; cost += t.amount; invested += t.amount; if (t.price) lastPrice = t.price; }
      else if (t.type === "sell") {
        var avg = qty > 0 ? cost / qty : 0, out = avg * t.quantity;
        realized += t.amount - out; qty -= t.quantity; cost -= out;
        if (qty < 1e-9) { qty = 0; cost = 0; }
        if (t.price) lastPrice = t.price;
      } else if (t.type === "dividend") dividends += t.amount;
    });
    var price = h.currentPrice || lastPrice;
    h.quantity = Math.round(qty * 1e6) / 1e6;
    h.cost = round2(cost);
    h.avgCost = qty > 0 ? round2(cost / qty) : 0;
    h.value = round2(price ? qty * price : cost);
    h.priced = !!price;
    h.unrealized = round2(h.value - h.cost);
    h.realized = round2(realized); h.dividends = round2(dividends); h.invested = round2(invested); h.fees = round2(fees); h.taxWithheld = round2(tax);
    h.txns = mine.slice().reverse();
    h.autoPrice = h.group === "investment" && !!quoteSymbol(h.symbol);
    totals.value += h.value; totals.cost += h.cost; totals.unrealized += h.unrealized;
    totals.realized += h.realized; totals.dividends += h.dividends;
    totals[h.group === "investment" ? "investments" : "assets"] += h.value;
  });
  Object.keys(totals).forEach(function(k){ totals[k] = round2(totals[k]); });
  return { ok: true, holdings: holdings, totals: totals };
}

function holdingFields(p) {
  var kind = HOLDING_KINDS[p.kind] ? p.kind : "other";
  return { name: String(p.name || "").trim(), kind: kind, symbol: String(p.symbol || "").trim().toUpperCase(),
    unit: String(p.unit || "").trim(), price: toFloat(p.currentPrice), note: String(p.note || "") };
}
function addHolding(p) {
  var f = holdingFields(p);
  if (!f.name) return jsonResponse({ ok: false, error: "Name required" });
  var sh = getSheet(SHEET.HOLDINGS), id = p.id || newId("H"), r = sh.getLastRow() + 1;
  sh.getRange(r, 7).setNumberFormat("@");
  sh.getRange(r, 1, 1, 9).setValues([[id, f.name, f.kind, f.symbol, f.unit, f.price || "", f.price ? todayStr() : "", f.note, "active"]]);
  return jsonResponse({ ok: true, id: id });
}
function updateHolding(p) {
  var row = resolveRow(SHEET.HOLDINGS, p);
  if (!row) return staleResponse();
  var sh = getSheet(SHEET.HOLDINGS), cur = sh.getRange(row, 1, 1, 9).getValues()[0];
  var f = holdingFields(Object.assign({ name: cur[1], kind: cur[2], symbol: cur[3], unit: cur[4], currentPrice: cur[5], note: cur[7] }, p));
  var priceChanged = p.currentPrice !== undefined && toFloat(p.currentPrice) !== toFloat(cur[5]);
  sh.getRange(row, 7).setNumberFormat("@");
  sh.getRange(row, 2, 1, 7).setValues([[f.name, f.kind, f.symbol, f.unit, f.price || "",
    priceChanged ? (p.priceDate || todayStr()) : cur[6], f.note]]);
  if (p.nextXD !== undefined || p.nextDividend !== undefined) {      // expected next dividend (you type it in)
    ensureHeaders(sh, 10, ["QuoteCurrency", "NextXD", "NextDividend"]);
    sh.getRange(row, 11).setNumberFormat("@");
    sh.getRange(row, 11, 1, 2).setValues([[p.nextXD || "", toFloat(p.nextDividend) || ""]]);
  }
  return jsonResponse({ ok: true });
}
function deleteLinkedRow(linkedId) {
  if (!linkedId) return;
  var name = linkedId.charAt(0) === "E" ? SHEET.EXPENSES : linkedId.charAt(0) === "I" ? SHEET.INCOME : null;
  if (!name) return;
  ensureRowIds(name);
  var row = resolveRow(name, { id: linkedId });
  if (row) getSheet(name).deleteRow(row);
}
function deleteHolding(p) {
  var row = resolveRow(SHEET.HOLDINGS, p);
  if (!row) return staleResponse();
  var id = String(getSheet(SHEET.HOLDINGS).getRange(row, 1).getValue());
  var tsh = getSheet(SHEET.HOLDING_TXNS);
  holdingTxnRows().filter(function(t){ return t.holdingId === id; }).reverse().forEach(function(t) {
    deleteLinkedRow(t.linkedId);
    tsh.deleteRow(t.rowIndex);
  });
  getSheet(SHEET.HOLDINGS).deleteRow(row);
  return jsonResponse({ ok: true });
}
function addHoldingTxn(p) {
  var type = String(p.type || "");
  if (["buy", "sell", "dividend"].indexOf(type) < 0) return jsonResponse({ ok: false, error: "Unknown type" });
  if (p.id && idExists(SHEET.HOLDING_TXNS, p.id)) return jsonResponse({ ok: true, duplicate: true, id: p.id });
  var holdingId = String(p.holdingId || "");
  if (!holdingId) {                                   // first purchase creates the holding
    if (type !== "buy") return jsonResponse({ ok: false, error: "Choose what you are selling" });
    var hr = JSON.parse(addHolding(p.holding || {}).getContent());
    if (!hr.ok) return jsonResponse(hr);
    holdingId = hr.id;
  }
  var data = holdingsData(), h = null;
  data.holdings.forEach(function(x){ if (x.id === holdingId) h = x; });
  if (!h) return staleResponse();
  var qty = toFloat(p.quantity), price = toFloat(p.price), amount = round2(toFloat(p.amount) || qty * price), fee = round2(toFloat(p.fee));
  var date = p.date || todayStr(), account = String(p.account || "").trim();
  if (amount <= 0) return jsonResponse({ ok: false, error: "Enter an amount" });
  if (type !== "dividend" && qty <= 0) return jsonResponse({ ok: false, error: "Enter a quantity" });
  if (type === "sell" && qty > h.quantity + 1e-9) return jsonResponse({ ok: false, error: "You only hold " + h.quantity + (h.unit ? " " + h.unit : "") });
  // account may be empty for buy/sell = something you already owned (no cash moves)
  if (!account && (type === "dividend" || fee > 0)) return jsonResponse({ ok: false, error: "Choose an account" });
  var linked = "";
  if (type === "dividend") {
    linked = newId("I");
    ensureRowIds(SHEET.INCOME);
    getSheet(SHEET.INCOME).appendRow([date, amount, "Investment Returns", "Dividend · " + h.name + (p.note ? " · " + p.note : ""), account, "", "", linked]);
    if (!categoryExists(SHEET.INCOME_CATS, "Investment Returns")) getSheet(SHEET.INCOME_CATS).appendRow(["Investment Returns"]);
  } else if (fee > 0) {
    linked = newId("E");
    ensureRowIds(SHEET.EXPENSES);
    getSheet(SHEET.EXPENSES).appendRow([date, fee, "Investment Fees", (type === "buy" ? "Buy fee · " : "Sell fee · ") + h.name, account,
      "FALSE", "", "", "", "", linked]);
    if (!categoryExists(SHEET.CATEGORIES, "Investment Fees")) getSheet(SHEET.CATEGORIES).appendRow(["Investment Fees"]);
  }
  var sh = getSheet(SHEET.HOLDING_TXNS), r = sh.getLastRow() + 1, id = p.id || newId("X");
  sh.getRange(r, 3).setNumberFormat("@");
  var tax = round2(toFloat(p.tax));
  sh.getRange(r, 1, 1, 11).setValues([[id, holdingId, date, type, type === "dividend" ? "" : qty, price || "",
    amount, type === "dividend" ? (tax || "") : (fee || ""), account, String(p.note || ""), linked]]);
  // latest trade price becomes the current price, unless a newer price was set by hand
  if (price && type !== "dividend" && (!h.priceDate || date >= h.priceDate)) {
    var hs = getSheet(SHEET.HOLDINGS), hrow = resolveRow(SHEET.HOLDINGS, { id: holdingId });
    hs.getRange(hrow, 7).setNumberFormat("@");
    hs.getRange(hrow, 6, 1, 2).setValues([[price, date]]);
  }
  return jsonResponse({ ok: true, id: id, holdingId: holdingId });
}
function deleteHoldingTxn(p) {
  var row = resolveRow(SHEET.HOLDING_TXNS, p);
  if (!row) return staleResponse();
  var sh = getSheet(SHEET.HOLDING_TXNS), d = sh.getRange(row, 1, 1, 11).getValues()[0];
  if (String(d[3]) === "buy") {             // can't remove a buy that later sells depend on
    var h = null; holdingsData().holdings.forEach(function(x){ if (x.id === String(d[1])) h = x; });
    if (h && h.quantity + 1e-9 < toFloat(d[4])) return jsonResponse({ ok: false, error: "Delete the later sale first — you'd be holding less than zero" });
  }
  deleteLinkedRow(String(d[10] || ""));
  sh.deleteRow(resolveRow(SHEET.HOLDING_TXNS, p));
  return jsonResponse({ ok: true });
}

// ── CATEGORY ICONS ───────────────────────────────────────────
// Any emoji shown next to a category (column B of Categories / IncomeCategories); empty = app default.
function cleanIcon(s) { return String(s == null ? "" : s).trim().slice(0, 16); }
function setCategoryIcon(p) {
  var name = p.type === "income" ? SHEET.INCOME_CATS : SHEET.CATEGORIES;
  var row = resolveByKey(name, p);
  if (!row) return staleResponse();
  var sh = getSheet(name);
  ensureHeaders(sh, 2, ["Icon"]);
  sh.getRange(row, 2).setValue(cleanIcon(p.icon));
  return jsonResponse({ ok: true });
}

// ── AUTOMATIC PRICES & EXCHANGE RATES ────────────────────────
// Uses Google Sheets' GOOGLEFINANCE in a hidden "_Prices" sheet.
//  • Holdings with a Symbol get today's price: "PTT.BK" or "BKK:PTT" (Thai stocks), "NASDAQ:AAPL",
//    "CURRENCY:BTCTHB"… Prices in other currencies are converted to baht.
//  • Foreign-currency accounts get today's rate (e.g. USD → THB).
// Thai gold prices and Thai mutual funds are not in GOOGLEFINANCE — update those by hand.
function quoteSymbol(sym) {
  var s = String(sym || "").trim().toUpperCase();
  if (!s) return "";
  if (s.indexOf(":") > 0) return s;
  var m = s.match(/^([A-Z0-9&\-]+)\.BK$/);
  if (m) return "BKK:" + m[1];
  return /^[A-Z0-9.\-]{1,12}$/.test(s) ? s : "";
}
function evalFormulas(formulas) {                 // [[f1, f2...], ...] -> values (waits for "Loading...")
  var sh = getSheet(SHEET.PRICES);
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 3).clearContent();
  if (!formulas.length) return [];
  var rng = sh.getRange(2, 1, formulas.length, formulas[0].length);
  rng.setFormulas(formulas);
  var vals = [];
  for (var attempt = 0; attempt < 6; attempt++) {
    SpreadsheetApp.flush();
    vals = rng.getValues();
    var loading = vals.some(function(r){ return r.some(function(v){ return /loading/i.test(String(v)); }); });
    if (!loading) break;
    Utilities.sleep(1500);
  }
  return vals;
}
function goodNumber(v) { return typeof v === "number" && isFinite(v) && v > 0; }

function refreshPrices() {
  var today = todayStr(), result = { ok: true, updated: [], failed: [], rates: {} };
  var hs = getSheet(SHEET.HOLDINGS);
  var data = holdingsData().holdings.filter(function(h){ return h.autoPrice && h.quantity > 0; });
  // 1) prices + their currency
  var px = evalFormulas(data.map(function(h) {
    var q = quoteSymbol(h.symbol).replace(/"/g, "");
    return ['="' + q + '"', '=IFERROR(GOOGLEFINANCE("' + q + '","price"),"")', '=IFERROR(GOOGLEFINANCE("' + q + '","currency"),"")'];
  }));
  // 2) exchange rates for every non-THB currency we need (accounts + quote currencies)
  var accSh = getSheet(SHEET.ACCOUNTS);
  var accRows = sheetToRows(accSh, function(d, ri){ return { rowIndex: ri, name: d[0], cur: String(d[6] || "THB").trim().toUpperCase() || "THB" }; });
  var curs = {};
  accRows.forEach(function(a){ if (a.cur !== "THB") curs[a.cur] = true; });
  px.forEach(function(r){ var c = String(r[2] || "").toUpperCase(); if (c && c !== "THB") curs[c] = true; });
  var curList = Object.keys(curs);
  var fx = evalFormulas(curList.map(function(c) {
    return ['="' + c + '"', '=IFERROR(GOOGLEFINANCE("CURRENCY:' + c + 'THB"),"")', '=""'];
  }));
  curList.forEach(function(c, i){ if (goodNumber(fx[i][1])) result.rates[c] = fx[i][1]; });
  // 3) write holding prices (in baht)
  data.forEach(function(h, i) {
    var price = px[i] ? px[i][1] : "", cur = String(px[i] ? px[i][2] : "").toUpperCase() || "THB";
    if (goodNumber(price) && cur === "GBX") { price = price / 100; cur = "GBP"; }   // London quotes in pence
    var thb = goodNumber(price) ? (cur === "THB" ? price : (result.rates[cur] ? price * result.rates[cur] : 0)) : 0;
    if (!thb) { result.failed.push(h.name + " (" + h.symbol + ")"); return; }
    var row = resolveRow(SHEET.HOLDINGS, { id: h.id });
    if (!row) return;
    hs.getRange(row, 7).setNumberFormat("@");
    hs.getRange(row, 6, 1, 2).setValues([[Math.round(thb * 10000) / 10000, today]]);
    ensureHeaders(hs, 10, ["QuoteCurrency", "NextXD", "NextDividend"]);
    hs.getRange(row, 10).setValue(cur);
    result.updated.push(h.name);
  });
  // 4) account exchange rates
  accRows.forEach(function(a) {
    if (a.cur === "THB" || !result.rates[a.cur]) return;
    accSh.getRange(a.rowIndex, 8).setValue(Math.round(result.rates[a.cur] * 10000) / 10000);
  });
  try { result.benchmark = fetchBenchmark(); } catch (e) { result.benchmark = { ok: false, error: e.message }; }
  PropertiesService.getScriptProperties().setProperty("LAST_PRICE_REFRESH", new Date().toISOString());
  return result;
}

// Daily job (set up by setupAutomation): refresh prices, then store this month's net worth
function dailyRefresh() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) return;
  try {
    refreshPrices();
    var acc = JSON.parse(getAccounts().getContent()), hld = holdingsData();
    saveNetWorthSnapshot({ accounts: acc.totalBalance || 0, investments: hld.totals.investments, assets: hld.totals.assets, receivables: receivablesAt("") });
  } finally { lock.releaseLock(); }
}

// One-time setup from the Apps Script editor: weekly backup (Sun ~3am) + daily prices (~7am)
function setupAutomation() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    var f = t.getHandlerFunction();
    if (f === "backupNow" || f === "dailyRefresh") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("backupNow").timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).create();
  ScriptApp.newTrigger("dailyRefresh").timeBased().everyDays(1).atHour(7).create();
  var props = PropertiesService.getScriptProperties();
  props.setProperty("BACKUP_WEEKLY", "sunday");
  props.setProperty("PRICES_DAILY", "7am");
  var r = refreshPrices();
  Logger.log("Automation is on: weekly backup (Sundays) + daily prices (7am).");
  Logger.log("Prices updated: " + (r.updated.join(", ") || "none") + (r.failed.length ? " | not found: " + r.failed.join(", ") : ""));
  if (!props.getProperty("LAST_BACKUP")) Logger.log("First backup: " + backupNow());
}

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
      var end = monthEnd(ym), ab = accountBalances(end).accounts, h = holdingsAt(end);
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

// ── HISTORY FOR SMART SUGGESTIONS ────────────────────────────
// Compact list of recent expenses the app learns your habits from (all on your device):
// [date, amount, category, note, account, isRecurring, projectId, createdAtMs]
function expenseHistory(days) {
  var from = addMonths(todayStr(), -Math.ceil(days / 30));
  var rows = [];
  sheetToRows(getSheet(SHEET.EXPENSES), function(d) { return d; }).forEach(function(d) {
    var date = formatDate(d[0]);
    if (!date || date < from) return;
    var c = d[11];
    var created = typeof c === "number" ? c : (c && c.getTime ? c.getTime() : 0);
    rows.push([date, toFloat(d[1]), cleanName(d[2]), String(d[3] || ""), String(d[4] || "").trim(),
      toBool(d[5]) ? 1 : 0, String(d[7] || ""), created]);
  });
  return { ok: true, from: from, rows: rows };
}

// ── PORTFOLIO: targets, benchmark ────────────────────────────
function portfolioMeta() {
  var targets = {};
  sheetToRows(getSheet(SHEET.TARGETS), function(d){ return [String(d[0]), toFloat(d[1])]; }).forEach(function(r){ if (r[0]) targets[r[0]] = r[1]; });
  var props = PropertiesService.getScriptProperties();
  var bench = null;
  try { bench = JSON.parse(props.getProperty("BENCH") || "null"); } catch (e) {}
  return { ok: true, targets: targets, benchmarkSymbol: props.getProperty("BENCH_SYMBOL") || "INDEXBKK:SET",
           benchmark: bench, tradeCount: Math.max(0, getSheet(SHEET.TRADES).getLastRow() - 1) };
}
function setTargets(p) {                           // p.targets = { "Gold": 20, "Thai stocks": 30, ... }
  var sh = getSheet(SHEET.TARGETS), last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 2).clearContent();
  var rows = Object.keys(p.targets || {}).filter(function(k){ return toFloat(p.targets[k]) > 0; })
    .map(function(k){ return [k, toFloat(p.targets[k])]; });
  if (rows.length) sh.getRange(2, 1, rows.length, 2).setValues(rows);
  return jsonResponse({ ok: true });
}
function setBenchmark(p) {
  var sym = String(p.symbol || "").trim().toUpperCase();
  if (!sym) return jsonResponse({ ok: false, error: "Symbol required" });
  PropertiesService.getScriptProperties().setProperty("BENCH_SYMBOL", sym);
  return jsonResponse({ ok: true, benchmark: fetchBenchmark() });
}
// Weekly closing prices of the comparison index since your first investment (max ~5 years),
// saved in Script Properties so the app can ask "what if the same money had gone into the index?"
function fetchBenchmark() {
  var props = PropertiesService.getScriptProperties();
  var sym = props.getProperty("BENCH_SYMBOL") || "INDEXBKK:SET";
  var first = "";
  holdingTxnRows().forEach(function(t){ if (t.date && (!first || t.date < first)) first = t.date; });
  if (!first) return { ok: false, error: "No investments yet" };
  var minStart = addMonths(todayStr(), -60);
  if (first < minStart) first = minStart;
  var start = addMonths(first, 0), y = parseInt(start.substring(0, 4)), m = parseInt(start.substring(5, 7)), d = parseInt(start.substring(8, 10));
  var sh = getSheet(SHEET.PRICES), last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 3).clearContent();
  sh.getRange(2, 1).setFormula('=IFERROR(GOOGLEFINANCE("' + sym.replace(/"/g, "") + '","close",DATE(' + y + "," + m + "," + (d > 7 ? d - 7 : 1) + '),TODAY(),"WEEKLY"),"")');
  var vals = [];
  for (var attempt = 0; attempt < 6; attempt++) {
    SpreadsheetApp.flush();
    var lr = Math.max(2, sh.getLastRow());
    vals = sh.getRange(2, 1, lr - 1, 2).getValues();
    if (!vals.some(function(r){ return /loading/i.test(String(r[0])); })) break;
    Utilities.sleep(1500);
  }
  var series = [];
  vals.forEach(function(r) {
    if (r[0] && typeof r[0] === "object" && typeof r[1] === "number" && r[1] > 0) series.push([formatDate(r[0]), Math.round(r[1] * 100) / 100]);
  });
  sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), 3).clearContent();
  if (!series.length) return { ok: false, error: "No prices for " + sym };
  var out = { symbol: sym, series: series.slice(-300) };
  props.setProperty("BENCH", JSON.stringify(out));
  return { ok: true, symbol: sym, points: out.series.length };
}

// ── TRADING JOURNAL (e.g. XAUUSD on MT5) ─────────────────────
// Kept apart from long-term holdings. Profit/Commission/Swap are in the trade currency (usually USD).
// If a trade is linked to an account, its net result changes that account's balance.
function tradeRows() {
  return sheetToRows(getSheet(SHEET.TRADES), function(d, ri) {
    var profit = toFloat(d[11]), comm = toFloat(d[9]), swap = toFloat(d[10]);
    return { rowIndex: ri, id: String(d[0] || ""), ticket: String(d[1] || ""), symbol: String(d[2] || ""), side: String(d[3] || ""),
      volume: toFloat(d[4]), openTime: tradeTime(d[5]), openPrice: toFloat(d[6]), closeTime: tradeTime(d[7]), closePrice: toFloat(d[8]),
      commission: comm, swap: swap, profit: profit, net: round2(profit + comm + swap), account: String(d[12] || "").trim(),
      note: String(d[13] || ""), currency: String(d[14] || "USD") };
  });
}
function tradeTime(v) {
  if (!v) return "";
  if (typeof v === "object" && v.getTime) return Utilities.formatDate(v, "GMT+7", "yyyy-MM-dd HH:mm");
  return String(v).replace(/\./g, "-").replace("T", " ").substring(0, 16);
}
function getTrades() {
  var rows = tradeRows().map(function(t) {
    return [t.id, t.ticket, t.symbol, t.side, t.volume, t.openTime, t.openPrice, t.closeTime, t.closePrice, t.commission, t.swap, t.profit, t.account, t.note, t.currency];
  });
  return { ok: true, trades: rows };
}
function tradeRowValues(t, id) {
  return [id, String(t.ticket || ""), String(t.symbol || "").toUpperCase(), String(t.side || "").toLowerCase(), toFloat(t.volume),
    tradeTime(t.openTime), toFloat(t.openPrice) || "", tradeTime(t.closeTime), toFloat(t.closePrice) || "",
    toFloat(t.commission) || 0, toFloat(t.swap) || 0, toFloat(t.profit), String(t.account || ""), String(t.note || ""),
    String(t.currency || "USD").toUpperCase()];
}
function addTrade(p) {
  if (!p.symbol || !(toFloat(p.volume) > 0)) return jsonResponse({ ok: false, error: "Symbol and volume required" });
  if (p.id && idExists(SHEET.TRADES, p.id)) return jsonResponse({ ok: true, duplicate: true, id: p.id });
  var sh = getSheet(SHEET.TRADES), r = sh.getLastRow() + 1, id = p.id || newId("K");
  sh.getRange(r, 1, 1, 15).setNumberFormats([["@","@","@","@","0.00","@","0.00###","@","0.00###","0.00","0.00","0.00","@","@","@"]]);
  sh.getRange(r, 1, 1, 15).setValues([tradeRowValues(p, id)]);
  return jsonResponse({ ok: true, id: id });
}
function deleteTrade(p) {
  var row = resolveRow(SHEET.TRADES, p);
  if (!row) return staleResponse();
  getSheet(SHEET.TRADES).deleteRow(row);
  return jsonResponse({ ok: true });
}
// Bulk import (from an MT5 report parsed in the app). Trades whose ticket is already saved are skipped.
function importTrades(p) {
  var have = {};
  tradeRows().forEach(function(t){ if (t.ticket) have[t.ticket] = true; });
  var rows = [], skipped = 0;
  (p.trades || []).forEach(function(t) {
    var tk = String(t.ticket || "");
    if (!t.symbol || !(toFloat(t.volume) > 0) || (tk && have[tk])) { skipped++; return; }
    if (tk) have[tk] = true;
    rows.push(tradeRowValues(Object.assign({}, t, { account: p.account || t.account || "" }), newId("K")));
  });
  if (rows.length) {
    var sh = getSheet(SHEET.TRADES), r = sh.getLastRow() + 1;
    sh.getRange(r, 1, rows.length, 15).setNumberFormats(rows.map(function(){ return ["@","@","@","@","0.00","@","0.00###","@","0.00###","0.00","0.00","0.00","@","@","@"]; }));
    sh.getRange(r, 1, rows.length, 15).setValues(rows);
  }
  return jsonResponse({ ok: true, added: rows.length, skipped: skipped });
}

// ── IMPORT DATA FILE ─────────────────────────────────────────
// One file can add accounts, holdings (buys/sells, foreign prices converted at that day's rate)
// and trades. Safe to import twice: existing accounts (same name), holding entries (same id)
// and trades (same ticket) are skipped.
function fxOnDate(cur, date) {                     // THB per 1 unit of cur on that date (last close up to that day)
  cur = String(cur || "THB").toUpperCase();
  if (cur === "THB") return { rate: 1, source: "THB" };
  var y = parseInt(date.substring(0, 4)), m = parseInt(date.substring(5, 7)), d = parseInt(date.substring(8, 10));
  var gf = 'GOOGLEFINANCE("CURRENCY:' + cur + 'THB","close",DATE(' + y + ',' + m + ',' + d + ')-6,DATE(' + y + ',' + m + ',' + d + '))';
  var v = evalFormulas([['="' + cur + '"', '=IFERROR(INDEX(' + gf + ',ROWS(' + gf + '),2),"")', '=""']]);
  if (v.length && goodNumber(v[0][1])) return { rate: v[0][1], source: "Google Finance close on/before " + date };
  var acc = sheetToRows(getSheet(SHEET.ACCOUNTS), function(r){ return { cur: String(r[6] || "").toUpperCase(), rate: toFloat(r[7]) }; })
    .find(function(a){ return a.cur === cur && a.rate; });
  return acc ? { rate: acc.rate, source: "today's account rate (historical rate not found)" } : { rate: 0, source: "not found" };
}
function importPack(p) {
  var out = { ok: true, accounts: { added: [], skipped: [] }, holdings: { added: 0, skipped: 0, fx: [] }, trades: null };
  // accounts
  var have = {};
  sheetToRows(getSheet(SHEET.ACCOUNTS), function(d){ return String(d[0] || "").trim().toLowerCase(); }).forEach(function(n){ have[n] = true; });
  (p.accounts || []).forEach(function(a) {
    var name = String(a.name || "").trim();
    if (!name) return;
    if (have[name.toLowerCase()]) { out.accounts.skipped.push(name); return; }
    JSON.parse(addAccount({ name: name, type: a.type || "bank", startingBalance: a.startingBalance || 0, currency: a.currency || "THB",
      rate: a.rate, creditLimit: a.creditLimit, dueDay: a.dueDay, statementDay: a.statementDay }).getContent());
    have[name.toLowerCase()] = true; out.accounts.added.push(name);
  });
  // holdings
  var hByName = {};
  holdingsData().holdings.forEach(function(h){ hByName[h.name.toLowerCase()] = h.id; });
  (p.holdingTxns || []).forEach(function(t) {
    if (t.id && idExists(SHEET.HOLDING_TXNS, t.id)) { out.holdings.skipped++; return; }
    var cur = String(t.currency || "THB").toUpperCase(), date = t.date || todayStr();
    var fx = cur === "THB" ? { rate: 1, source: "THB" } : fxOnDate(cur, date);
    if (!fx.rate) { out.holdings.skipped++; out.holdings.fx.push(cur + " rate not found for " + date); return; }
    var qty = toFloat(t.quantity);
    var price = t.priceForeign !== undefined ? toFloat(t.priceForeign) * fx.rate : toFloat(t.price);
    var amount = (t.amountForeign !== undefined ? toFloat(t.amountForeign) * fx.rate : (toFloat(t.amount) || qty * price)) + toFloat(t.extraThb);
    var hName = String((t.holding || {}).name || "").trim(), hid = t.holdingId || hByName[hName.toLowerCase()] || "";
    var payload = { id: t.id, type: t.type || "buy", holdingId: hid, holding: t.holding, quantity: qty, price: round2(amount / (qty || 1)),
      amount: round2(amount), fee: toFloat(t.fee), tax: toFloat(t.tax), account: t.account || "", date: date,
      note: String(t.note || "") + (cur !== "THB" ? " · " + cur + " @ " + (Math.round(fx.rate * 10000) / 10000) + " THB" : "") };
    var r = JSON.parse(addHoldingTxn(payload).getContent());
    if (!r.ok) { out.holdings.skipped++; out.holdings.fx.push((hName || "holding") + ": " + r.error); return; }
    if (r.holdingId && hName) hByName[hName.toLowerCase()] = r.holdingId;
    out.holdings.added++;
    if (cur !== "THB") out.holdings.fx.push(hName + ": " + cur + " " + (Math.round(fx.rate * 10000) / 10000) + " (" + fx.source + ")");
  });
  // trades
  if ((p.trades || []).length) out.trades = JSON.parse(importTrades({ trades: p.trades, account: p.tradeAccount || "" }).getContent());
  return jsonResponse(out);
}
