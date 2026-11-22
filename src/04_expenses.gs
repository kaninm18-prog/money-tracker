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

