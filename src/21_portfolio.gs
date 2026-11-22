// ── PORTFOLIO: targets, benchmark ────────────────────────────
function portfolioMeta() {
  var targets = {};
  sheetToRows(getSheet(SHEET.TARGETS), function(d){ return [String(d[0]), toFloat(d[1])]; }).forEach(function(r){ if (r[0]) targets[r[0]] = r[1]; });
  var props = PropertiesService.getScriptProperties();
  var bench = null;
  try { bench = JSON.parse(props.getProperty("BENCH") || "null"); } catch (e) {}
  return { ok: true, targets: targets, benchmarkSymbol: props.getProperty("BENCH_SYMBOL") || "INDEXBKK:SET",
           benchmark: bench, tradeCount: Math.max(0, getSheet(SHEET.TRADES).getLastRow() - 1) };
}
function setTargets(p) {                           // p.targets = { "Gold": 20, "Thai stocks": 30, ... }
  var sh = getSheet(SHEET.TARGETS), last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 2).clearContent();
  var rows = Object.keys(p.targets || {}).filter(function(k){ return toFloat(p.targets[k]) > 0; })
    .map(function(k){ return [k, toFloat(p.targets[k])]; });
  if (rows.length) sh.getRange(2, 1, rows.length, 2).setValues(rows);
  return jsonResponse({ ok: true });
}
function setBenchmark(p) {
  var sym = String(p.symbol || "").trim().toUpperCase();
  if (!sym) return jsonResponse({ ok: false, error: "Symbol required" });
  PropertiesService.getScriptProperties().setProperty("BENCH_SYMBOL", sym);
  return jsonResponse({ ok: true, benchmark: fetchBenchmark() });
}
// Weekly closing prices of the comparison index since your first investment (max ~5 years),
// saved in Script Properties so the app can ask "what if the same money had gone into the index?"
function fetchBenchmark() {
  var props = PropertiesService.getScriptProperties();
  var sym = props.getProperty("BENCH_SYMBOL") || "INDEXBKK:SET";
  var first = "";
  holdingTxnRows().forEach(function(t){ if (t.date && (!first || t.date < first)) first = t.date; });
  if (!first) return { ok: false, error: "No investments yet" };
  var minStart = addMonths(todayStr(), -60);
  if (first < minStart) first = minStart;
  var start = addMonths(first, 0), y = parseInt(start.substring(0, 4)), m = parseInt(start.substring(5, 7)), d = parseInt(start.substring(8, 10));
  var sh = getSheet(SHEET.PRICES), last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 3).clearContent();
  sh.getRange(2, 1).setFormula('=IFERROR(GOOGLEFINANCE("' + sym.replace(/"/g, "") + '","close",DATE(' + y + "," + m + "," + (d > 7 ? d - 7 : 1) + '),TODAY(),"WEEKLY"),"")');
  var vals = [];
  for (var attempt = 0; attempt < 6; attempt++) {
    SpreadsheetApp.flush();
    var lr = Math.max(2, sh.getLastRow());
    vals = sh.getRange(2, 1, lr - 1, 2).getValues();
    if (!vals.some(function(r){ return /loading/i.test(String(r[0])); })) break;
    Utilities.sleep(1500);
  }
  var series = [];
  vals.forEach(function(r) {
    if (r[0] && typeof r[0] === "object" && typeof r[1] === "number" && r[1] > 0) series.push([formatDate(r[0]), Math.round(r[1] * 100) / 100]);
  });
  sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), 3).clearContent();
  if (!series.length) return { ok: false, error: "No prices for " + sym };
  var out = { symbol: sym, series: series.slice(-300) };
  props.setProperty("BENCH", JSON.stringify(out));
  return { ok: true, symbol: sym, points: out.series.length };
}

