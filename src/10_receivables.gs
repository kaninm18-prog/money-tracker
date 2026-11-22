// ── RECEIVABLES ───────────────────────────────────────────────
// A receivable is money you lent / paid for someone. Repayments (ReceivableRepayments tab) come back
// in pieces: Returned = sum of repayments, Left = Amount - Returned. Each repayment adds to the
// account it landed in. When Left reaches 0 the receivable becomes "settled" automatically.

var _recvIds = false;
function recvEnsureIds(sh) {
  if (_recvIds) return;
  _recvIds = true;
  var last = sh.getLastRow();
  if (last < 2) return;
  ensureHeaders(sh, 10, ["Id"]);
  var rng = sh.getRange(2, 1, last - 1, 10), v = rng.getValues(), ch = false;
  v.forEach(function(r){
    if (!r[9] && (r[0] || r[1])) { r[9] = "R" + Utilities.getUuid().replace(/-/g, "").slice(0, 8); ch = true; }
  });
  if (ch) sh.getRange(2, 10, last - 1, 1).setValues(v.map(function(r){ return [r[9]]; }));
}

function loadReceivables() {
  var sh = getSheet(SHEET.RECEIVABLES);
  recvEnsureIds(sh);
  var reps = sheetToRows(getSheet(SHEET.REPAYMENTS), function(d, ri) {
    return { rowIndex: ri, id: d[0], receivableId: String(d[1]||''), date: formatDate(d[2]),
             amount: toFloat(d[3]), account: String(d[4]||'').trim(), note: String(d[5]||'') };
  });
  return sheetToRows(sh, function(d, ri) {
    var id = String(d[9] || '');
    var mine = reps.filter(function(x){ return x.receivableId === id; });
    var status = String(d[6] || 'pending').trim() || 'pending';
    var amount = toFloat(d[1]);
    var returned = mine.reduce(function(s, x){ return s + x.amount; }, 0);
    if (status === 'settled' && !mine.length) returned = amount;      // legacy: settled before repayments existed
    returned = round2(returned);
    return {
      rowIndex: ri, id: id, date: formatDate(d[0]), amount: amount,
      counterparty: d[2], type: d[3], note: d[4],
      reimbursedBy: d[5], status: status, settledDate: formatDate(d[7]),
      account: String(d[8]||'').trim(),
      repayments: mine, returned: returned, left: Math.max(0, round2(amount - returned))
    };
  });
}

function getReceivables() {
  return jsonResponse({ ok: true, receivables: loadReceivables() });
}

function addReceivable(p) {
  var sh = getSheet(SHEET.RECEIVABLES);
  recvEnsureIds(sh);
  ensureHeaders(sh, 10, ["Id"]);
  var id = "R" + Utilities.getUuid().replace(/-/g, "").slice(0, 8);
  sh.appendRow([
    p.date || todayStr(), toFloat(p.amount),
    p.counterparty || "", p.type || "advance",
    p.note || "", p.reimbursedBy || "",
    "pending", "", p.account || "", id
  ]);
  return jsonResponse({ ok: true, rowIndex: sh.getLastRow(), id: id });
}

function updateReceivable(p) {
  var sh  = getSheet(SHEET.RECEIVABLES);
  recvEnsureIds(sh);
  var row = resolveRow(SHEET.RECEIVABLES, p);
  if (!row) return staleResponse();
  // Keep existing status/settledDate (cols 7-8), update cols 1-6 and col 9 (account)
  sh.getRange(row, 1, 1, 6).setValues([[
    p.date || todayStr(), toFloat(p.amount),
    p.counterparty || "", p.type || "advance",
    p.note || "", p.reimbursedBy || ""
  ]]);
  sh.getRange(row, 9, 1, 1).setValue(p.account || "");
  return jsonResponse({ ok: true });
}

function markRecvStatus(row, status, date) {
  var sh = getSheet(SHEET.RECEIVABLES);
  sh.getRange(row, 7, 1, 2).setValues([[status, date || ""]]);
}

function addRepaymentRow(rv, amount, date, account, note) {
  var sh = getSheet(SHEET.REPAYMENTS);
  var r = sh.getLastRow() + 1;
  sh.getRange(r, 3).setNumberFormat("@");
  var id = "P" + Utilities.getUuid().replace(/-/g, "").slice(0, 8);
  sh.getRange(r, 1, 1, 6).setValues([[id, rv.id, date, amount, account || rv.account || "", note || ""]]);
  return r;
}

function addRepayment(p) {
  var all = loadReceivables(), rv = null;
  all.forEach(function(x){ if (p.receivableId ? x.id === String(p.receivableId) : (p.rowIndex && x.rowIndex === parseInt(p.rowIndex))) rv = x; });
  if (!rv) return jsonResponse({ ok: false, error: "Receivable not found" });
  var amt = round2(toFloat(p.amount));
  if (amt <= 0) return jsonResponse({ ok: false, error: "Amount must be more than 0" });
  if (amt > rv.left + 0.005) return jsonResponse({ ok: false, error: "More than what is left (" + rv.left + ")" });
  var date = p.date || todayStr();
  addRepaymentRow(rv, amt, date, String(p.account || "").trim(), p.note);
  var left = round2(rv.left - amt);
  if (left <= 0.005) markRecvStatus(rv.rowIndex, "settled", date);
  return jsonResponse({ ok: true, left: Math.max(0, left), settled: left <= 0.005 });
}

function deleteRepayment(p) {
  var sh = getSheet(SHEET.REPAYMENTS), row = resolveRow(SHEET.REPAYMENTS, p);
  if (!row) return staleResponse();
  var recvId = String(sh.getRange(row, 2).getValue() || "");
  sh.deleteRow(row);
  loadReceivables().forEach(function(rv){
    // Reopen if money is now outstanding. With no repayments left it would otherwise look like an
    // old-style settled receivable (counted as fully returned), so reopen that case too.
    if (rv.id === recvId && rv.status === "settled" && (!rv.repayments.length || rv.left > 0.005)) markRecvStatus(rv.rowIndex, "pending", "");
  });
  return jsonResponse({ ok: true });
}

function settleReceivable(p) {
  recvEnsureIds(getSheet(SHEET.RECEIVABLES));
  var row = resolveRow(SHEET.RECEIVABLES, p);
  if (!row) return staleResponse();
  var date = p.settledDate || todayStr(), rv = null;
  loadReceivables().forEach(function(x){ if (x.rowIndex === row) rv = x; });
  if (rv && rv.status !== "settled" && rv.left > 0.005) addRepaymentRow(rv, rv.left, date, String(p.account || "").trim(), "Marked settled");
  markRecvStatus(row, "settled", date);
  return jsonResponse({ ok: true });
}

function deleteReceivable(p) {
  var sh  = getSheet(SHEET.RECEIVABLES);
  recvEnsureIds(sh);
  var row = resolveRow(SHEET.RECEIVABLES, p);
  if (!row) return staleResponse();
  var id = String(sh.getRange(row, 10).getValue() || "");
  if (id) {
    var rp = getSheet(SHEET.REPAYMENTS), data = rp.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) if (String(data[i][1]) === id) rp.deleteRow(i + 1);
  }
  sh.deleteRow(row);
  return jsonResponse({ ok: true });
}

