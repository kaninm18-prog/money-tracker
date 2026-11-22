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

