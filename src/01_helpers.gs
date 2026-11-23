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
      case SHEET.LINKED_FLOWS:
        sh.appendRow(["Id","Date","Account","Amount","Currency"]);
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

