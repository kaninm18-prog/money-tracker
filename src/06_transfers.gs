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

