// ── AUTOMATIC PRICES & EXCHANGE RATES ────────────────────────
// Uses Google Sheets' GOOGLEFINANCE in a hidden "_Prices" sheet.
//  • Holdings with a Symbol get today's price: "PTT.BK" or "BKK:PTT" (Thai stocks), "NASDAQ:AAPL",
//    "CURRENCY:BTCTHB"… Prices in other currencies are converted to baht.
//  • Foreign-currency accounts get today's rate (e.g. USD → THB).
//  • Gold (kind gold, unit oz / baht-weight / gram, or symbol XAUUSD, GOLD:BAHT, GOLD:GRAM) follows spot gold.
// Thai mutual funds are not in GOOGLEFINANCE — update those by hand.
// Gold has no stock symbol: it is priced from spot gold (XAU/USD, per troy ounce).
// Thai 96.5% gold: 1 baht-weight = 15.244 g × 96.5% = 0.47295 oz of pure gold (an estimate — shops add a spread).
var GOLD_UNITS = { OZ: 1, BAHT: 0.47295, GRAM: 1 / 31.1035 };
function goldUnit(sym, unit, kind) {
  var s = String(sym || "").trim().toUpperCase();
  if (s === "XAUUSD" || s === "GOLD" || s === "GOLD:OZ" || s === "CURRENCY:XAUUSD") return "OZ";
  if (s === "GOLD:BAHT") return "BAHT";
  if (s === "GOLD:GRAM") return "GRAM";
  if (s || kind !== "gold") return "";
  var u = String(unit || "").toLowerCase();
  if (/baht/.test(u)) return "BAHT";
  if (/^(oz|ounce|ounces|troy)/.test(u)) return "OZ";
  if (/^(g|gram|grams)$/.test(u)) return "GRAM";
  return "";
}
// What to ask GOOGLEFINANCE for a holding: { q, factor, cur } (cur = known quote currency) or null
function priceSource(h) {
  var g = goldUnit(h.symbol, h.unit, h.kind);
  if (g) return { q: "CURRENCY:XAUUSD", factor: GOLD_UNITS[g], cur: "USD" };
  var q = quoteSymbol(h.symbol);
  if (!q) return null;
  var m = q.match(/^CURRENCY:[A-Z]{3}([A-Z]{3})$/);
  return { q: q, factor: 1, cur: m ? m[1] : "" };
}
function quoteSymbol(sym) {
  var s = String(sym || "").trim().toUpperCase();
  if (!s) return "";
  if (s.indexOf(":") > 0) return s;
  var m = s.match(/^([A-Z0-9&\-]+)\.BK$/);
  if (m) return "BKK:" + m[1];
  return /^[A-Z0-9.\-]{1,12}$/.test(s) ? s : "";
}
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
  var today = todayStr(), result = { ok: true, updated: [], failed: [], rates: {} };
  var hs = getSheet(SHEET.HOLDINGS);
  var data = holdingsData().holdings.filter(function(h){ return h.autoPrice && h.quantity > 0; });
  // 1) prices + their currency
  var srcs = data.map(priceSource);
  var px = evalFormulas(data.map(function(h, i) {
    var q = srcs[i].q.replace(/"/g, "");
    return ['="' + q + '"', '=IFERROR(GOOGLEFINANCE("' + q + '","price"),"")', '=IFERROR(GOOGLEFINANCE("' + q + '","currency"),"")'];
  }));
  px.forEach(function(r, i) {                     // apply gold unit factor; known quote currency wins
    if (goodNumber(r[1])) r[1] = r[1] * srcs[i].factor;
    if (srcs[i].cur) r[2] = srcs[i].cur;
  });
  // 2) exchange rates for every non-THB currency we need (accounts + quote currencies)
  var accSh = getSheet(SHEET.ACCOUNTS);
  var accRows = sheetToRows(accSh, function(d, ri){ return { rowIndex: ri, name: d[0], cur: String(d[6] || "THB").trim().toUpperCase() || "THB" }; });
  var curs = {};
  accRows.forEach(function(a){ if (a.cur !== "THB") curs[a.cur] = true; });
  px.forEach(function(r){ var c = String(r[2] || "").toUpperCase(); if (c && c !== "THB") curs[c] = true; });
  var curList = Object.keys(curs);
  var fx = evalFormulas(curList.map(function(c) {
    return ['="' + c + '"', '=IFERROR(GOOGLEFINANCE("CURRENCY:' + c + 'THB"),"")', '=""'];
  }));
  curList.forEach(function(c, i){ if (goodNumber(fx[i][1])) result.rates[c] = fx[i][1]; });
  // 3) write holding prices (in baht)
  data.forEach(function(h, i) {
    var price = px[i] ? px[i][1] : "", cur = String(px[i] ? px[i][2] : "").toUpperCase() || "THB";
    if (goodNumber(price) && cur === "GBX") { price = price / 100; cur = "GBP"; }   // London quotes in pence
    var thb = goodNumber(price) ? (cur === "THB" ? price : (result.rates[cur] ? price * result.rates[cur] : 0)) : 0;
    if (!thb) { result.failed.push(h.name + (h.symbol ? " (" + h.symbol + ")" : "")); return; }
    var row = resolveRow(SHEET.HOLDINGS, { id: h.id });
    if (!row) return;
    hs.getRange(row, 7).setNumberFormat("@");
    hs.getRange(row, 6, 1, 2).setValues([[Math.round(thb * 10000) / 10000, today]]);
    ensureHeaders(hs, 10, ["QuoteCurrency", "NextXD", "NextDividend"]);
    hs.getRange(row, 10).setValue(cur);
    result.updated.push(h.name);
  });
  // 4) account exchange rates
  accRows.forEach(function(a) {
    if (a.cur === "THB" || !result.rates[a.cur]) return;
    accSh.getRange(a.rowIndex, 8).setValue(Math.round(result.rates[a.cur] * 10000) / 10000);
  });
  try { result.benchmark = fetchBenchmark(); } catch (e) { result.benchmark = { ok: false, error: e.message }; }
  PropertiesService.getScriptProperties().setProperty("LAST_PRICE_REFRESH", new Date().toISOString());
  return result;
}

// Daily job (set up by setupAutomation): refresh prices, then store this month's net worth
function dailyRefresh() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) return;
  try {
    refreshPrices();
    syncWealth();
    var acc = JSON.parse(getAccounts().getContent()), hld = holdingsData();
    saveNetWorthSnapshot(liveNetWorth(acc, hld));
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
  Logger.log("Prices updated: " + (r.updated.join(", ") || "none") + (r.failed.length ? " | not found: " + r.failed.join(", ") : ""));
  if (!props.getProperty("LAST_BACKUP")) Logger.log("First backup: " + backupNow());
}

