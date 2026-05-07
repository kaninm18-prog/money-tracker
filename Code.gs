// ============================================================
//  Money Tracker — Google Apps Script Backend v5
//
//  Sheets:
//    Expenses         → Date | Amount | Category | Note | Account | IsRecurring | RecurrencePeriod | ProjectId
//    Income           → Date | Amount | Category | Note | Account
//    Transfers        → Date | Amount | FromAccount | ToAccount | Note
//    Accounts         → Name | Type | StartingBalance | CreditLimit | DueDay | StatementDay
//    Categories       → Name
//    IncomeCategories → Name
//    Projects         → Name | Budget | StartDate | EndDate
//    Receivables      → Date | Amount | Counterparty | Type | Note | ReimbursedBy | Status | SettledDate | Account
//    InstallmentPlans → Description | PurchaseDate | Merchant | TotalAmount | InstallmentCount | InstallmentAmount | FirstInstallmentDate | Account | Category | ProjectId | Status | InstallmentsPaid
//    CategoryBudgets  → Category | MonthlyLimit | AlertThreshold | IsActive | AppliesToProjects
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
  BUDGETS:      "CategoryBudgets"
};

// ── Helpers ──────────────────────────────────────────────────

function getSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    switch (name) {
      case SHEET.EXPENSES:
        sh.appendRow(["Date","Amount","Category","Note","Account","IsRecurring","RecurrencePeriod","ProjectId"]);
        break;
      case SHEET.INCOME:
        sh.appendRow(["Date","Amount","Category","Note","Account"]);
        break;
      case SHEET.TRANSFERS:
        sh.appendRow(["Date","Amount","FromAccount","ToAccount","Note"]);
        break;
      case SHEET.ACCOUNTS:
        sh.appendRow(["Name","Type","StartingBalance","CreditLimit","DueDay","StatementDay"]);
        sh.appendRow(["Cash","cash",0,"","",""]);
        sh.appendRow(["Investment","investment",0,"","",""]);
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
        sh.appendRow(["Date","Amount","Counterparty","Type","Note","ReimbursedBy","Status","SettledDate","Account"]);
        break;
      case SHEET.INSTALLMENTS:
        sh.appendRow(["Description","PurchaseDate","Merchant","TotalAmount","InstallmentCount",
                      "InstallmentAmount","FirstInstallmentDate","Account","Category","ProjectId",
                      "Status","InstallmentsPaid"]);
        break;
      case SHEET.BUDGETS:
        sh.appendRow(["Category","MonthlyLimit","AlertThreshold","IsActive","AppliesToProjects"]);
        break;
    }
    sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight("bold");
  }
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
      default:
        return jsonResponse({ ok: false, error: "Unknown action: " + p.action });
    }
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
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
  ]);
  return jsonResponse({ ok: true, rowIndex: sh.getLastRow() });
}

function getExpenses(p) {
  var sh   = getSheet(SHEET.EXPENSES);
  var rows = sheetToRows(sh, function(d, ri) {
    return {
      rowIndex: ri, date: formatDate(d[0]), amount: toFloat(d[1]),
      category: d[2], note: d[3], account: d[4],
      isRecurring: toBool(d[5]), recurrencePeriod: d[6] || "", projectId: d[7] || ""
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
  sh.getRange(row, 1, 1, 8).setValues([[
    p.date || "", toFloat(p.amount), p.category || "", p.note || "", p.account || "",
    p.isRecurring ? "TRUE" : "FALSE", p.recurrencePeriod || "", p.projectId || ""
  ]]);
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
  sh.appendRow([p.date || todayStr(), toFloat(p.amount), p.category || "", p.note || "", p.account || ""]);
  return jsonResponse({ ok: true, rowIndex: sh.getLastRow() });
}

function getIncome(p) {
  var sh   = getSheet(SHEET.INCOME);
  var rows = sheetToRows(sh, function(d, ri) {
    return { rowIndex: ri, date: formatDate(d[0]), amount: toFloat(d[1]), category: d[2], note: d[3], account: d[4] };
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
  sh.getRange(row, 1, 1, 5).setValues([[p.date || "", toFloat(p.amount), p.category || "", p.note || "", p.account || ""]]);
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
  sh.appendRow([p.date || todayStr(), toFloat(p.amount), p.fromAccount || "", p.toAccount || "", p.note || ""]);
  return jsonResponse({ ok: true, rowIndex: sh.getLastRow() });
}

function getTransfers(p) {
  var sh   = getSheet(SHEET.TRANSFERS);
  var rows = sheetToRows(sh, function(d, ri) {
    return { rowIndex: ri, date: formatDate(d[0]), amount: toFloat(d[1]), fromAccount: d[2], toAccount: d[3], note: d[4] };
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
  sh.getRange(row, 1, 1, 5).setValues([[
    p.date || todayStr(), toFloat(p.amount),
    p.fromAccount || "", p.toAccount || "", p.note || ""
  ]]);
  return jsonResponse({ ok: true });
}

// ── ACCOUNTS ─────────────────────────────────────────────────

function getAccounts() {
  var sh = getSheet(SHEET.ACCOUNTS);
  var accounts = sheetToRows(sh, function(d, ri) {
    return {
      rowIndex: ri, name: d[0], type: d[1],
      startingBalance: toFloat(d[2]), balance: toFloat(d[2]),
      creditLimit: toFloat(d[3]), dueDay: parseInt(d[4]) || 0, statementDay: parseInt(d[5]) || 0
    };
  });
  var expSh  = getSheet(SHEET.EXPENSES);
  var incSh  = getSheet(SHEET.INCOME);
  var trfSh  = getSheet(SHEET.TRANSFERS);
  var expRows  = sheetToRows(expSh, function(d){ return { amount: toFloat(d[1]), account: String(d[4]||'').trim() }; });
  var incRows  = sheetToRows(incSh, function(d){ return { amount: toFloat(d[1]), account: String(d[4]||'').trim() }; });
  var trfRows  = sheetToRows(trfSh, function(d){ return { amount: toFloat(d[1]), from: String(d[2]||'').trim(), to: String(d[3]||'').trim() }; });
  var recvRows = sheetToRows(getSheet(SHEET.RECEIVABLES), function(d){
    return { amount: toFloat(d[1]), account: String(d[8]||'').trim(), status: String(d[6]||'pending').trim() };
  });
  accounts.forEach(function(acc) {
    var n = String(acc.name||'').trim();
    var bal = acc.startingBalance;
    incRows.forEach(function(r){ if (r.account === n) bal += r.amount; });
    expRows.forEach(function(r){ if (r.account === n) bal -= r.amount; });
    trfRows.forEach(function(r){
      if (r.from === n) bal -= r.amount;
      if (r.to   === n) bal += r.amount;
    });
    // Pending receivables deduct from account (money went out; reverses when settled)
    recvRows.forEach(function(r){ if (r.account === n && r.status === 'pending') bal -= r.amount; });
    acc.balance = Math.round(bal * 100) / 100;
  });
  var total = accounts.reduce(function(s, a){ return s + a.balance; }, 0);
  return jsonResponse({ ok: true, accounts: accounts, totalBalance: Math.round(total * 100) / 100 });
}

function addAccount(p) {
  var sh = getSheet(SHEET.ACCOUNTS);
  sh.appendRow([
    p.name || "", p.type || "bank", toFloat(p.startingBalance),
    p.type === "credit" ? toFloat(p.creditLimit) : "",
    p.type === "credit" ? (parseInt(p.dueDay) || "") : "",
    p.type === "credit" ? (parseInt(p.statementDay) || "") : ""
  ]);
  return jsonResponse({ ok: true, rowIndex: sh.getLastRow() });
}

function updateAccount(p) {
  var sh  = getSheet(SHEET.ACCOUNTS);
  var row = parseInt(p.rowIndex);
  if (row < 2) return jsonResponse({ ok: false, error: "Invalid row" });
  sh.getRange(row, 1, 1, 6).setValues([[
    p.name || "", p.type || "bank", toFloat(p.startingBalance),
    p.type === "credit" ? toFloat(p.creditLimit) : "",
    p.type === "credit" ? (parseInt(p.dueDay) || "") : "",
    p.type === "credit" ? (parseInt(p.statementDay) || "") : ""
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

function getReceivables() {
  var sh = getSheet(SHEET.RECEIVABLES);
  var rows = sheetToRows(sh, function(d, ri) {
    return {
      rowIndex: ri, date: formatDate(d[0]), amount: toFloat(d[1]),
      counterparty: d[2], type: d[3], note: d[4],
      reimbursedBy: d[5], status: d[6] || "pending", settledDate: formatDate(d[7]),
      account: String(d[8]||'').trim()
    };
  });
  return jsonResponse({ ok: true, receivables: rows });
}

function addReceivable(p) {
  var sh = getSheet(SHEET.RECEIVABLES);
  sh.appendRow([
    p.date || todayStr(), toFloat(p.amount),
    p.counterparty || "", p.type || "advance",
    p.note || "", p.reimbursedBy || "",
    "pending", "", p.account || ""
  ]);
  return jsonResponse({ ok: true, rowIndex: sh.getLastRow() });
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

function settleReceivable(p) {
  var sh  = getSheet(SHEET.RECEIVABLES);
  var row = parseInt(p.rowIndex);
  if (row < 2) return jsonResponse({ ok: false, error: "Invalid row" });
  sh.getRange(row, 7, 1, 2).setValues([["settled", p.settledDate || todayStr()]]);
  return jsonResponse({ ok: true });
}

function deleteReceivable(p) {
  var sh  = getSheet(SHEET.RECEIVABLES);
  var row = parseInt(p.rowIndex);
  if (row < 2) return jsonResponse({ ok: false, error: "Invalid row" });
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
      isRecurring: toBool(d[5]), recurrencePeriod: d[6] || "", projectId: d[7] || "" };
  }).forEach(function(r){ if (inPeriod(r.date)) txns.push(r); });

  sheetToRows(getSheet(SHEET.INCOME), function(d, ri) {
    return { rowIndex: ri, type: "income", date: formatDate(d[0]), amount: toFloat(d[1]),
      category: d[2], note: d[3], account: d[4] };
  }).forEach(function(r){ if (inPeriod(r.date)) txns.push(r); });

  sheetToRows(getSheet(SHEET.TRANSFERS), function(d, ri) {
    return { rowIndex: ri, type: "transfer", date: formatDate(d[0]), amount: toFloat(d[1]),
      fromAccount: d[2], toAccount: d[3], note: d[4] };
  }).forEach(function(r){ if (inPeriod(r.date)) txns.push(r); });

  // Pending receivables: money went out, shown as deductions in history
  sheetToRows(getSheet(SHEET.RECEIVABLES), function(d, ri) {
    return { rowIndex: ri, type: "receivable", date: formatDate(d[0]), amount: toFloat(d[1]),
      counterparty: String(d[2]||''), recvType: String(d[3]||'advance'),
      note: String(d[4]||''), reimbursedBy: String(d[5]||''),
      status: String(d[6]||'pending'), account: String(d[8]||'').trim() };
  }).forEach(function(r){ if (r.status === 'pending' && inPeriod(r.date)) txns.push(r); });

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
