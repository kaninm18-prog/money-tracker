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
  var wealth = syncWealth();                       // Wealth Planner dividends in, linked flows out (skipped when not set up)
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
  var live = liveNetWorth(acc, hld);
  var nwh  = netWorthHistory(live);
  } finally { _readCache = null; }
  if (wealth.flows !== undefined && generated) writeLinkedFlows();   // new recurring transfers
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

