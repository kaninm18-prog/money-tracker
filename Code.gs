// ============================================================
//  Money Tracker — Google Apps Script Backend v4
//
//  Sheets:
//    Expenses         → Date | Amount | Category | Note | Account | IsRecurring | RecurrencePeriod | ProjectId
//    Income           → Date | Amount | Category | Note | Account
//    Transfers        → Date | Amount | FromAccount | ToAccount | Note
//    Accounts         → Name | Type | StartingBalance | CreditLimit | DueDay | StatementDay
//    Categories       → Name
//    IncomeCategories → Name
//    Projects         → Name | Budget | StartDate | EndDate
//    Receivables      → Date | Amount | Counterparty | Type | Note | ReimbursedBy | Status | SettledDate
// ============================================================

var SHEET = {
  EXPENSES:    "Expenses",
  INCOME:      "Income",
  TRANSFERS:   "Transfers",
  ACCOUNTS:    "Accounts",
  CATEGORIES:  "Categories",
  INCOME_CATS: "IncomeCategories",
  PROJECTS:    "Projects",
  RECEIVABLES: "Receivables"
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
        sh.appendRow(["Date","Amount","Counterparty","Type","Note","ReimbursedBy","Status","SettledDate"]);
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
  if (val instanceof Date) return Utilities.formatDate(val, "GMT+7", "yyyy-MM-dd");
  return String(val).slice(0, 10);
}

function toFloat(v) { return parseFloat(v) || 0; }
function toBool(v)  { return v === true || v === "true" || v === "TRUE" || v === 1; }

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
      case "addExpense":            return addExpense(p);
      case "getExpenses":           return getExpenses(p);
      case "updateExpense":         return updateExpense(p);
      case "deleteExpense":         return deleteExpense(p);
      case "addIncome":             return addIncome(p);
      case "getIncome":             return getIncome(p);
      case "updateIncome":          return updateIncome(p);
      case "deleteIncome":          return deleteIncome(p);
      case "addTransfer":           return addTransfer(p);
      case "getTransfers":          return getTransfers(p);
      case "deleteTransfer":        return deleteTransfer(p);
      case "getAccounts":           return getAccounts();
      case "addAccount":            return addAccount(p);
      case "updateAccount":         return updateAccount(p);
      case "deleteAccount":         return deleteAccount(p);
      case "getCategories":         return getCategories();
      case "addCategory":           return addCategory(p);
      case "deleteCategory":        return deleteCategory(p);
      case "getIncomeCategories":   return getIncomeCategories();
      case "addIncomeCategory":     return addIncomeCategory(p);
      case "deleteIncomeCategory":  return deleteIncomeCategory(p);
      case "getProjects":           return getProjects();
      case "addProject":            return addProject(p);
      case "updateProject":         return updateProject(p);
      case "deleteProject":         return deleteProject(p);
      case "getReceivables":        return getReceivables();
      case "addReceivable":         return addReceivable(p);
      case "settleReceivable":      return settleReceivable(p);
      case "deleteReceivable":      return deleteReceivable(p);
      case "getAllTransactions":     return getAllTransactions(p);
      case "getSummary":            return getSummary(p);
      default:
        return jsonResponse({ ok: false, error: "Unknown action: " + p.action });
    }
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function doGet() {
  return jsonResponse({ ok: true, message: "Money Tracker API v4 — live" });
}

// ── EXPENSES ──────────────────────────────────────────────────

function addExpense(p) {
  var sh = getSheet(SHEET.EXPENSES);
  sh.appendRow([
    p.date || formatDate(new Date()),
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
    rows = rows.filter(function(r) {
      var dt = new Date(r.date + "T00:00:00");
      return dt.getMonth()+1 === parseInt(p.month) && dt.getFullYear() === parseInt(p.year);
    });
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
  sh.appendRow([p.date || formatDate(new Date()), toFloat(p.amount), p.category || "", p.note || "", p.account || ""]);
  return jsonResponse({ ok: true, rowIndex: sh.getLastRow() });
}

function getIncome(p) {
  var sh   = getSheet(SHEET.INCOME);
  var rows = sheetToRows(sh, function(d, ri) {
    return { rowIndex: ri, date: formatDate(d[0]), amount: toFloat(d[1]), category: d[2], note: d[3], account: d[4] };
  });
  if (p.month && p.year) {
    rows = rows.filter(function(r) {
      var dt = new Date(r.date + "T00:00:00");
      return dt.getMonth()+1 === parseInt(p.month) && dt.getFullYear() === parseInt(p.year);
    });
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
  sh.appendRow([p.date || formatDate(new Date()), toFloat(p.amount), p.fromAccount || "", p.toAccount || "", p.note || ""]);
  return jsonResponse({ ok: true, rowIndex: sh.getLastRow() });
}

function getTransfers(p) {
  var sh   = getSheet(SHEET.TRANSFERS);
  var rows = sheetToRows(sh, function(d, ri) {
    return { rowIndex: ri, date: formatDate(d[0]), amount: toFloat(d[1]), fromAccount: d[2], toAccount: d[3], note: d[4] };
  });
  if (p.month && p.year) {
    rows = rows.filter(function(r) {
      var dt = new Date(r.date + "T00:00:00");
      return dt.getMonth()+1 === parseInt(p.month) && dt.getFullYear() === parseInt(p.year);
    });
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
  var expRows = sheetToRows(expSh, function(d){ return { amount: toFloat(d[1]), account: d[4] }; });
  var incRows = sheetToRows(incSh, function(d){ return { amount: toFloat(d[1]), account: d[4] }; });
  var trfRows = sheetToRows(trfSh, function(d){ return { amount: toFloat(d[1]), from: d[2], to: d[3] }; });
  accounts.forEach(function(acc) {
    var bal = acc.startingBalance;
    incRows.forEach(function(r){ if (r.account === acc.name) bal += r.amount; });
    expRows.forEach(function(r){ if (r.account === acc.name) bal -= r.amount; });
    trfRows.forEach(function(r){
      if (r.from === acc.name) bal -= r.amount;
      if (r.to   === acc.name) bal += r.amount;
    });
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
  // Compute spent per project from all expenses
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
      reimbursedBy: d[5], status: d[6] || "pending", settledDate: formatDate(d[7])
    };
  });
  return jsonResponse({ ok: true, receivables: rows });
}

function addReceivable(p) {
  var sh = getSheet(SHEET.RECEIVABLES);
  sh.appendRow([
    p.date || formatDate(new Date()), toFloat(p.amount),
    p.counterparty || "", p.type || "advance",
    p.note || "", p.reimbursedBy || "",
    "pending", ""
  ]);
  return jsonResponse({ ok: true, rowIndex: sh.getLastRow() });
}

function settleReceivable(p) {
  var sh  = getSheet(SHEET.RECEIVABLES);
  var row = parseInt(p.rowIndex);
  if (row < 2) return jsonResponse({ ok: false, error: "Invalid row" });
  sh.getRange(row, 7, 1, 2).setValues([["settled", p.settledDate || formatDate(new Date())]]);
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
    var dt = new Date(dateStr + "T00:00:00");
    return dt.getMonth()+1 === m && dt.getFullYear() === y;
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

  txns.sort(function(a,b){ return b.date.localeCompare(a.date); });
  return jsonResponse({ ok: true, transactions: txns });
}

function getSummary(p) {
  var m = parseInt(p.month), y = parseInt(p.year);
  function inMonth(dateStr) {
    var dt = new Date(dateStr + "T00:00:00");
    return dt.getMonth()+1 === m && dt.getFullYear() === y;
  }
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
