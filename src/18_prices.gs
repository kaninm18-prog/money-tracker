// ── AUTOMATIC EXCHANGE RATES ─────────────────────────────────
// Uses Google Sheets' GOOGLEFINANCE in a hidden "_Prices" sheet. Foreign-currency accounts get today's
// rate (e.g. USD → THB). Prices of investments are the Wealth Planner's job now.
function evalFormulas(formulas) {                 // [[f1, f2...], ...] -> values (waits for "Loading...")
  var sh = getSheet(SHEET.PRICES);
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 3).clearContent();
  if (!formulas.length) return [];
  var rng = sh.getRange(2, 1, formulas.length, formulas[0].length);
  rng.setFormulas(formulas);
  var vals = [];
  for (var attempt = 0; attempt < 6; attempt++) {
    SpreadsheetApp.flush();
    vals = rng.getValues();
    var loading = vals.some(function(r){ return r.some(function(v){ return /loading/i.test(String(v)); }); });
    if (!loading) break;
    Utilities.sleep(1500);
  }
  return vals;
}
function goodNumber(v) { return typeof v === "number" && isFinite(v) && v > 0; }

function refreshPrices() {
  var result = { ok: true, updated: [], failed: [], rates: {} };
  var accSh = getSheet(SHEET.ACCOUNTS);
  var accRows = sheetToRows(accSh, function(d, ri){ return { rowIndex: ri, name: d[0], cur: String(d[6] || "THB").trim().toUpperCase() || "THB" }; });
  var curs = {};
  accRows.forEach(function(a){ if (a.cur !== "THB") curs[a.cur] = true; });
  var curList = Object.keys(curs);
  var fx = evalFormulas(curList.map(function(c) {
    return ['="' + c + '"', '=IFERROR(GOOGLEFINANCE("CURRENCY:' + c + 'THB"),"")', '=""'];
  }));
  curList.forEach(function(c, i){ if (goodNumber(fx[i][1])) result.rates[c] = fx[i][1]; });
  accRows.forEach(function(a) {
    if (a.cur === "THB" || !result.rates[a.cur]) return;
    accSh.getRange(a.rowIndex, 8).setValue(Math.round(result.rates[a.cur] * 10000) / 10000);
  });
  PropertiesService.getScriptProperties().setProperty("LAST_PRICE_REFRESH", new Date().toISOString());
  return result;
}

// Daily job (set up by setupAutomation): refresh exchange rates, then store this month's net worth
function dailyRefresh() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) return;
  try {
    refreshPrices();
    syncWealth();
    var acc = JSON.parse(getAccounts().getContent());
    saveNetWorthSnapshot(liveNetWorth(acc));
  } finally { lock.releaseLock(); }
}

// One-time setup from the Apps Script editor: weekly backup (Sun ~3am) + daily prices (~7am)
function setupAutomation() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    var f = t.getHandlerFunction();
    if (f === "backupNow" || f === "dailyRefresh") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("backupNow").timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).create();
  ScriptApp.newTrigger("dailyRefresh").timeBased().everyDays(1).atHour(7).create();
  var props = PropertiesService.getScriptProperties();
  props.setProperty("BACKUP_WEEKLY", "sunday");
  props.setProperty("PRICES_DAILY", "7am");
  var r = refreshPrices();
  Logger.log("Automation is on: weekly backup (Sundays) + daily prices (7am).");
  Logger.log("Exchange rates updated: " + (Object.keys(r.rates).join(", ") || "none"));
  if (!props.getProperty("LAST_BACKUP")) Logger.log("First backup: " + backupNow());
}

