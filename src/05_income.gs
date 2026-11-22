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

