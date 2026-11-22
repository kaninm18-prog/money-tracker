// ── TRADING JOURNAL (e.g. XAUUSD on MT5) ─────────────────────
// Kept apart from long-term holdings. Profit/Commission/Swap are in the trade currency (usually USD).
// If a trade is linked to an account, its net result changes that account's balance.
function tradeRows() {
  return sheetToRows(getSheet(SHEET.TRADES), function(d, ri) {
    var profit = toFloat(d[11]), comm = toFloat(d[9]), swap = toFloat(d[10]);
    return { rowIndex: ri, id: String(d[0] || ""), ticket: String(d[1] || ""), symbol: String(d[2] || ""), side: String(d[3] || ""),
      volume: toFloat(d[4]), openTime: tradeTime(d[5]), openPrice: toFloat(d[6]), closeTime: tradeTime(d[7]), closePrice: toFloat(d[8]),
      commission: comm, swap: swap, profit: profit, net: round2(profit + comm + swap), account: String(d[12] || "").trim(),
      note: String(d[13] || ""), currency: String(d[14] || "USD") };
  });
}
function tradeTime(v) {
  if (!v) return "";
  if (typeof v === "object" && v.getTime) return Utilities.formatDate(v, "GMT+7", "yyyy-MM-dd HH:mm");
  return String(v).replace(/\./g, "-").replace("T", " ").substring(0, 16);
}
function getTrades() {
  var rows = tradeRows().map(function(t) {
    return [t.id, t.ticket, t.symbol, t.side, t.volume, t.openTime, t.openPrice, t.closeTime, t.closePrice, t.commission, t.swap, t.profit, t.account, t.note, t.currency];
  });
  return { ok: true, trades: rows };
}
function tradeRowValues(t, id) {
  return [id, String(t.ticket || ""), String(t.symbol || "").toUpperCase(), String(t.side || "").toLowerCase(), toFloat(t.volume),
    tradeTime(t.openTime), toFloat(t.openPrice) || "", tradeTime(t.closeTime), toFloat(t.closePrice) || "",
    toFloat(t.commission) || 0, toFloat(t.swap) || 0, toFloat(t.profit), String(t.account || ""), String(t.note || ""),
    String(t.currency || "USD").toUpperCase()];
}
function addTrade(p) {
  if (!p.symbol || !(toFloat(p.volume) > 0)) return jsonResponse({ ok: false, error: "Symbol and volume required" });
  if (p.id && idExists(SHEET.TRADES, p.id)) return jsonResponse({ ok: true, duplicate: true, id: p.id });
  var sh = getSheet(SHEET.TRADES), r = sh.getLastRow() + 1, id = p.id || newId("K");
  sh.getRange(r, 1, 1, 15).setNumberFormats([["@","@","@","@","0.00","@","0.00###","@","0.00###","0.00","0.00","0.00","@","@","@"]]);
  sh.getRange(r, 1, 1, 15).setValues([tradeRowValues(p, id)]);
  return jsonResponse({ ok: true, id: id });
}
function deleteTrade(p) {
  var row = resolveRow(SHEET.TRADES, p);
  if (!row) return staleResponse();
  getSheet(SHEET.TRADES).deleteRow(row);
  return jsonResponse({ ok: true });
}
// Bulk import (from an MT5 report parsed in the app). Trades whose ticket is already saved are skipped.
function importTrades(p) {
  var have = {}, rowOf = {};
  tradeRows().forEach(function(t){ if (t.ticket) { have[t.ticket] = true; rowOf[t.ticket] = t; } });
  var rows = [], skipped = 0, relinked = 0, tsh = getSheet(SHEET.TRADES);
  (p.trades || []).forEach(function(t) {
    var tk = String(t.ticket || "");
    if (tk && have[tk] && p.relink && rowOf[tk] && rowOf[tk].account !== String(p.account || "")) {
      tsh.getRange(rowOf[tk].rowIndex, 13).setValue(String(p.account || "")); relinked++; skipped++; return;   // e.g. unlink from an account
    }
    if (!t.symbol || !(toFloat(t.volume) > 0) || (tk && have[tk])) { skipped++; return; }
    if (tk) have[tk] = true;
    rows.push(tradeRowValues(Object.assign({}, t, { account: p.account || t.account || "" }), newId("K")));
  });
  if (rows.length) {
    var sh = getSheet(SHEET.TRADES), r = sh.getLastRow() + 1;
    sh.getRange(r, 1, rows.length, 15).setNumberFormats(rows.map(function(){ return ["@","@","@","@","0.00","@","0.00###","@","0.00###","0.00","0.00","0.00","@","@","@"]; }));
    sh.getRange(r, 1, rows.length, 15).setValues(rows);
  }
  return jsonResponse({ ok: true, added: rows.length, skipped: skipped, relinked: relinked });
}

