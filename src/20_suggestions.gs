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

