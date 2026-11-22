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

