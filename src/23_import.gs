// ── IMPORT DATA FILE ─────────────────────────────────────────
// One file can add accounts, holdings (buys/sells, foreign prices converted at that day's rate)
// and trades. Safe to import twice: existing accounts (same name), holding entries (same id)
// and trades (same ticket) are skipped.
function fxOnDate(cur, date) {                     // THB per 1 unit of cur on that date (last close up to that day)
  cur = String(cur || "THB").toUpperCase();
  if (cur === "THB") return { rate: 1, source: "THB" };
  var y = parseInt(date.substring(0, 4)), m = parseInt(date.substring(5, 7)), d = parseInt(date.substring(8, 10));
  var gf = 'GOOGLEFINANCE("CURRENCY:' + cur + 'THB","close",DATE(' + y + ',' + m + ',' + d + ')-6,DATE(' + y + ',' + m + ',' + d + '))';
  var v = evalFormulas([['="' + cur + '"', '=IFERROR(INDEX(' + gf + ',ROWS(' + gf + '),2),"")', '=""']]);
  if (v.length && goodNumber(v[0][1])) return { rate: v[0][1], source: "Google Finance close on/before " + date };
  var acc = sheetToRows(getSheet(SHEET.ACCOUNTS), function(r){ return { cur: String(r[6] || "").toUpperCase(), rate: toFloat(r[7]) }; })
    .find(function(a){ return a.cur === cur && a.rate; });
  return acc ? { rate: acc.rate, source: "today's account rate (historical rate not found)" } : { rate: 0, source: "not found" };
}
// Daily closes of CURRENCY:XXXTHB for a date range, in one GOOGLEFINANCE call: [[yyyy-MM-dd, rate], ...]
function fxSeries(cur, from, to) {
  var f = from, t = to;
  var sh = getSheet(SHEET.PRICES), last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 3).clearContent();
  var d = function(s){ return 'DATE(' + parseInt(s.substring(0, 4)) + ',' + parseInt(s.substring(5, 7)) + ',' + parseInt(s.substring(8, 10)) + ')'; };
  sh.getRange(2, 1).setFormula('=IFERROR(GOOGLEFINANCE("CURRENCY:' + cur + 'THB","close",' + d(f) + '-7,' + d(t) + ',"DAILY"),"")');
  var vals = [];
  for (var attempt = 0; attempt < 6; attempt++) {
    SpreadsheetApp.flush();
    vals = sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), 2).getValues();
    if (!vals.some(function(r){ return /loading/i.test(String(r[0])); })) break;
    Utilities.sleep(1500);
  }
  var out = [];
  vals.forEach(function(r){ if (r[0] && typeof r[0] === "object" && goodNumber(r[1])) out.push([formatDate(r[0]), r[1]]); });
  sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), 3).clearContent();
  return out;
}
function rateFromSeries(sr, date) {
  if (!sr || !sr.length) return null;
  var r = null;
  for (var i = 0; i < sr.length && sr[i][0] <= date; i++) r = sr[i][1];
  return r ? { rate: r, source: "Google Finance daily close" } : null;
}
function importPack(p) {
  var out = { ok: true, accounts: { added: [], skipped: [] }, holdings: { added: 0, skipped: 0, fx: [] }, trades: null };
  // accounts
  var have = {};
  sheetToRows(getSheet(SHEET.ACCOUNTS), function(d){ return String(d[0] || "").trim().toLowerCase(); }).forEach(function(n){ have[n] = true; });
  (p.accounts || []).forEach(function(a) {
    var name = String(a.name || "").trim();
    if (!name) return;
    if (have[name.toLowerCase()]) {
      if (a.setStartingBalance) {                  // the file says what the opening balance should be
        var row = resolveByKey(SHEET.ACCOUNTS, { key: name });
        if (row) { getSheet(SHEET.ACCOUNTS).getRange(row, 3).setValue(toFloat(a.startingBalance)); out.accounts.updated = (out.accounts.updated || []).concat([name]); return; }
      }
      out.accounts.skipped.push(name); return;
    }
    JSON.parse(addAccount({ name: name, type: a.type || "bank", startingBalance: a.startingBalance || 0, currency: a.currency || "THB",
      rate: a.rate, creditLimit: a.creditLimit, dueDay: a.dueDay, statementDay: a.statementDay }).getContent());
    have[name.toLowerCase()] = true; out.accounts.added.push(name);
  });
  // holdings
  var hByName = {};
  holdingsData().holdings.forEach(function(h){ hByName[h.name.toLowerCase()] = h.id; });
  // one look-up of daily rates per currency for the whole period (instead of one per entry)
  var series = {}, ranges = {};
  (p.holdingTxns || []).forEach(function(t) {
    var c = String(t.currency || "THB").toUpperCase(), d = t.date || todayStr();
    if (c === "THB") return;
    var r = ranges[c] || (ranges[c] = { from: d, to: d });
    if (d < r.from) r.from = d; if (d > r.to) r.to = d;
  });
  Object.keys(ranges).forEach(function(c){ series[c] = fxSeries(c, ranges[c].from, ranges[c].to); });
  var noted = {};
  (p.holdingTxns || []).forEach(function(t) {
    if (t.id && idExists(SHEET.HOLDING_TXNS, t.id)) { out.holdings.skipped++; return; }
    var cur = String(t.currency || "THB").toUpperCase(), date = t.date || todayStr();
    var fx = cur === "THB" ? { rate: 1, source: "THB" } : (rateFromSeries(series[cur], date) || fxOnDate(cur, date));
    if (!fx.rate) { out.holdings.skipped++; out.holdings.fx.push(cur + " rate not found for " + date); return; }
    var qty = toFloat(t.quantity);
    var price = t.priceForeign !== undefined ? toFloat(t.priceForeign) * fx.rate : toFloat(t.price);
    var amount = (t.amountForeign !== undefined ? toFloat(t.amountForeign) * fx.rate : (toFloat(t.amount) || qty * price)) + toFloat(t.extraThb);
    var hName = String((t.holding || {}).name || "").trim(), hid = t.holdingId || hByName[hName.toLowerCase()] || "";
    var payload = { id: t.id, type: t.type || "buy", holdingId: hid, holding: t.holding, quantity: qty, price: round2(amount / (qty || 1)),
      amount: round2(amount), fee: toFloat(t.fee), tax: toFloat(t.tax), account: t.account || "", date: date,
      origAmount: cur !== "THB" ? (t.amountForeign !== undefined ? toFloat(t.amountForeign) : qty * toFloat(t.priceForeign)) : 0, currency: cur,
      note: String(t.note || "") + (cur !== "THB" ? " · " + cur + " @ " + (Math.round(fx.rate * 10000) / 10000) + " THB" : "") };
    var r = JSON.parse(addHoldingTxn(payload).getContent());
    if (!r.ok) { out.holdings.skipped++; out.holdings.fx.push((hName || "holding") + ": " + r.error); return; }
    if (r.holdingId && hName) hByName[hName.toLowerCase()] = r.holdingId;
    out.holdings.added++;
    if (cur !== "THB" && !noted[hName]) { noted[hName] = true; out.holdings.fx.push(hName + ": " + cur + " at each day's rate (" + fx.source + ")"); }
  });
  // trades
  if ((p.trades || []).length) out.trades = JSON.parse(importTrades({ trades: p.trades, account: p.tradeAccount || "", relink: !!p.relinkTrades }).getContent());
  return jsonResponse(out);
}
