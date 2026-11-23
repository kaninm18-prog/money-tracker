// ── LINKED INVESTMENT ACCOUNTS (Wealth Planner) ──────────────
// docs/stage-4-plan.md section 3. A broker (or a gold shop…) is an account with a LinkedTo name: its
// value lives in the Wealth Planner app, which writes it to its tab _Export_Values. Money Tracker
// writes every transfer into / out of a linked account to its own tab _Export_LinkedFlows, and copies
// the Wealth Planner's dividends (_Export_Dividends) into Income.
// The Wealth Planner spreadsheet id is the Script Property WEALTH_SHEET_ID (never in code).
// With no account linked and no WEALTH_SHEET_ID, nothing here runs.

var WEALTH_TAB = { VALUES: "_Export_Values", DIVIDENDS: "_Export_Dividends" };
var WEALTH_CACHE = "WEALTH_VALUES_CACHE";          // Script Property: last good values, JSON by Wealth Planner name
var DIVIDEND_ID = /^WD/;                           // Income rows with this Id prefix belong to the dividend sync

// Per request (reset like the other memos): undefined = not tried yet
var _wealthSS, _wealthValues;
function wealthSpreadsheet() {
  if (_wealthSS !== undefined) return _wealthSS;
  _wealthSS = null;
  var id = PropertiesService.getScriptProperties().getProperty("WEALTH_SHEET_ID");
  if (!id) return null;
  try { _wealthSS = SpreadsheetApp.openById(id); } catch (e) { _wealthSS = null; }   // no id in logs
  return _wealthSS;
}
// Data rows (no header) of a Wealth Planner export tab, or null when it can't be read
function wealthRows(tab) {
  var ss = wealthSpreadsheet();
  if (!ss) return null;
  try {
    var sh = ss.getSheetByName(tab);
    return sh ? sh.getDataRange().getValues().slice(1) : null;
  } catch (e) { return null; }
}
function numberCell(v) { return v !== "" && v !== null && v !== undefined && isFinite(parseFloat(v)); }

// { <Wealth Planner name>: { value, valueThb (or null), currency, asOf, stale } }.
// Fresh rows from _Export_Values win; anything it doesn't have comes from the cache, marked stale.
function wealthValues() {
  if (_wealthValues !== undefined) return _wealthValues;
  var props = PropertiesService.getScriptProperties(), cache = {};
  try { cache = JSON.parse(props.getProperty(WEALTH_CACHE) || "{}") || {}; } catch (e) { cache = {}; }
  var out = {}, merged = {}, changed = false;
  Object.keys(cache).forEach(function(n) {
    merged[n] = cache[n];
    out[n] = { value: cache[n].value, valueThb: cache[n].valueThb, currency: cache[n].currency, asOf: cache[n].asOf, stale: true };
  });
  (wealthRows(WEALTH_TAB.VALUES) || []).forEach(function(d) {
    var name = String(d[0] || "").trim();
    if (!name || !numberCell(d[2])) return;          // a blank value is unknown, not 0
    var v = { value: toFloat(d[2]), valueThb: numberCell(d[3]) ? toFloat(d[3]) : null,
              currency: String(d[1] || "").trim().toUpperCase(), asOf: formatDate(d[4]) };
    if (JSON.stringify(merged[name]) !== JSON.stringify(v)) { merged[name] = v; changed = true; }
    out[name] = { value: v.value, valueThb: v.valueThb, currency: v.currency, asOf: v.asOf, stale: false };
  });
  if (changed) props.setProperty(WEALTH_CACHE, JSON.stringify(merged));
  _wealthValues = out;
  return out;
}

// One entry per transfer into (+) or out of (−) a linked account, in that account's currency
function linkedFlowsOf(r, byName) {
  var f = byName[r.from], t = byName[r.to], out = [];
  if (f && f.linked) out.push({ id: r.id, date: r.date, account: f, amount: -r.amount, kind: "transfer" });
  if (t && t.linked) out.push({ id: r.id, date: r.date, account: t, amount: transferReceived(r, f, t), kind: "transfer" });
  return out;
}

// C9: the rest of a linked account's cash that only Money Tracker knows about, so the Wealth Planner
// gets it through _Export_LinkedFlows too (a linked account's own rows are skipped in its balance here):
//  • Income rows on it (+) and Expense rows on it (−), in the account's currency. Not the WD dividends:
//    those come from the Wealth Planner and are already inside its value (D3).
//  • Receivables lent from it (−) and repayments received into it (+), by the same rule as accountBalances.
// The opening balance (StartingBalance) is added by writeLinkedFlows.
function linkedOtherFlows(byName, incRows, expRows, receivables) {
  var out = [];
  function linked(n) { var a = byName[n]; return a && a.linked ? a : null; }
  function own(a, thb) { return a.currency === "THB" ? thb : thb / a.rate; }
  incRows.forEach(function(r) {
    var a = linked(r.account);
    if (a && !DIVIDEND_ID.test(r.id)) out.push({ id: r.id, date: r.date, account: a, amount: amtForAccount(a, r.amount, r.orig, r.cur), kind: "income" });
  });
  expRows.forEach(function(r) {
    var a = linked(r.account);
    if (a) out.push({ id: r.id, date: r.date, account: a, amount: -amtForAccount(a, r.amount, r.orig, r.cur), kind: "expense" });
  });
  receivables.forEach(function(r) {
    var a = linked(r.account);
    if (a && (r.status === "pending" || r.repayments.length)) out.push({ id: r.id, date: r.date, account: a, amount: -own(a, r.amount), kind: "receivable" });
    r.repayments.forEach(function(rp) {
      var b = linked(rp.account || r.account);
      if (b) out.push({ id: String(rp.id || ""), date: rp.date, account: b, amount: own(b, rp.amount), kind: "repayment" });
    });
  });
  return out;
}

// Today's balance of each linked account (called by accountBalances with no asOf).
//  • Known value: the export Value, plus flows (transfers and the C9 rows) dated after its AsOf, which the Wealth Planner
//    can't have seen yet. That keeps the rule "a transfer never changes the total" on the day it is
//    made. balanceThb = ValueTHB when the export has it, else Value × rate.
//  • From the cache (export missing / unreadable): the same, marked stale with its AsOf.
//  • Never known: the at-cost balance (starting balance + every flow), marked valueUnknown,
//    so it is never silently 0.
function applyLinkedValues(accounts, byName, trfRows, other) {
  var vals = wealthValues(), pending = {};
  accounts.forEach(function(a) {
    if (!a.linked) return;
    var v = vals[a.linkedTo];
    a.stale = !v || !!v.stale;
    a.valueAsOf = v ? v.asOf : "";
    if (!v) a.valueUnknown = true;
    pending[a.linkedTo] = 0;
  });
  var flows = [];
  trfRows.forEach(function(r){ flows = flows.concat(linkedFlowsOf(r, byName)); });
  flows.concat(other || []).forEach(function(x) {
    var v = vals[x.account.linkedTo];
    if (v && v.asOf && x.date && x.date > v.asOf) pending[x.account.linkedTo] += x.amount;
  });
  accounts.forEach(function(a) {
    var v = a.linked && vals[a.linkedTo];
    if (!v) return;
    var p = pending[a.linkedTo], value = v.value;
    // export in another currency than the account: use its THB value at the account's rate
    if (v.currency && v.currency !== a.currency && v.valueThb !== null) value = v.valueThb / a.rate;
    a.balance = value + p;
    if (v.valueThb !== null) a.linkedThb = v.valueThb + p * a.rate;
  });
}

function anyLinkedAccount() {
  return sheetToRows(getSheet(SHEET.ACCOUNTS), function(d){ return String(d[8] || "").trim(); }).some(Boolean);
}

// Rebuild _Export_LinkedFlows (whole tab) for the Wealth Planner. Only when an account is linked.
// Rows: every transfer into / out of a linked account, and (C9) each linked account's opening balance
// (Id OPENING, no date), its Income/Expense rows and receivables. Column 6 Kind says which; the Wealth
// Planner only needs columns 1–5, so an older Wealth Planner still reads the tab.
function linkedFlowRows() {
  var accounts = sheetToRows(getSheet(SHEET.ACCOUNTS), accountFromRow), byName = {};
  accounts.forEach(function(a){ byName[String(a.name || "").trim()] = a; });
  if (!accounts.some(function(a){ return a.linked; })) return null;
  ensureRowIds(SHEET.TRANSFERS); ensureRowIds(SHEET.INCOME); ensureRowIds(SHEET.EXPENSES);   // the Wealth Planner matches flows by Id
  var rows = [["Id", "Date", "Account", "Amount", "Currency", "Kind"]];
  function push(x) { rows.push([x.id, x.date, x.account.linkedTo, round2(x.amount), x.account.currency, x.kind]); }
  accounts.forEach(function(a) {
    if (a.linked && round2(a.startingBalance)) push({ id: "OPENING", date: "", account: a, amount: a.startingBalance, kind: "opening" });
  });
  sheetToRows(getSheet(SHEET.TRANSFERS), transferFromRow).forEach(function(r){ linkedFlowsOf(r, byName).forEach(push); });
  linkedOtherFlows(byName, sheetToRows(getSheet(SHEET.INCOME), incomeCashRow), sheetToRows(getSheet(SHEET.EXPENSES), expenseCashRow),
    loadReceivables()).forEach(push);
  return rows;
}
function writeLinkedFlows() {
  var rows = linkedFlowRows();
  if (!rows) return -1;
  var sh = getSheet(SHEET.LINKED_FLOWS);
  sh.clearContents();
  sh.getRange(1, 2, rows.length, 1).setNumberFormat("@");   // dates stay plain text
  sh.getRange(1, 1, rows.length, 6).setValues(rows);
  sh.getRange(1, 1, 1, 6).setFontWeight("bold");
  return rows.length - 1;
}

// Keep Income in step with the Wealth Planner's _Export_Dividends, matched by Id (D3).
// Only rows whose Id starts with WD are touched: added, updated, or removed when no longer exported.
// Income you typed yourself is never changed. Export unreadable → nothing changes.
function syncDividends() {
  var exp = wealthRows(WEALTH_TAB.DIVIDENDS);
  if (!exp) return null;
  var byLinked = {};                                 // a dividend paid to the broker names its Wealth Planner account
  sheetToRows(getSheet(SHEET.ACCOUNTS), accountFromRow).forEach(function(a){ if (a.linked) byLinked[a.linkedTo] = String(a.name).trim(); });
  var want = {}, order = [], fx = false;
  exp.forEach(function(d) {
    var id = String(d[0] || "").trim();
    if (!DIVIDEND_ID.test(id) || want[id]) return;
    var acct = String(d[7] || "").trim(), f = fxFields({ origAmount: d[4], currency: d[5] });
    if (f[0]) fx = true;
    want[id] = [formatDate(d[1]), round2(toFloat(d[3])), "Investment Returns", "Dividend · " + String(d[2] || "").trim(),
                byLinked[acct] || acct, f[0], f[1], id];
    order.push(id);
  });
  var sh = getSheet(SHEET.INCOME);
  ensureRowIds(SHEET.INCOME);
  if (fx) ensureHeaders(sh, 6, ["OrigAmount", "Currency"]);
  var data = sh.getDataRange().getValues(), seen = {}, del = [], res = { added: 0, updated: 0, removed: 0 };
  for (var i = 1; i < data.length; i++) {
    var d = data[i], id = String(d[7] || "");
    if (!DIVIDEND_ID.test(id)) continue;
    if (!want[id] || seen[id]) { del.push(i + 1); continue; }
    seen[id] = true;
    var have = [formatDate(d[0]), round2(toFloat(d[1])), cleanName(d[2]), String(d[3] || ""), String(d[4] || "").trim(),
                toFloat(d[5]) || "", String(d[6] || "").trim().toUpperCase(), id];
    if (JSON.stringify(have) !== JSON.stringify(want[id])) { sh.getRange(i + 1, 1, 1, 8).setValues([want[id]]); res.updated++; }
  }
  for (var j = del.length - 1; j >= 0; j--) { sh.deleteRow(del[j]); res.removed++; }   // bottom up: rows don't shift
  order.forEach(function(id){ if (!seen[id]) { sh.appendRow(want[id]); res.added++; } });
  return res;
}

// The Wealth Planner side of bootstrap / dailyRefresh. Each part is skipped when it isn't set up.
function syncWealth() {
  var out = {};
  if (PropertiesService.getScriptProperties().getProperty("WEALTH_SHEET_ID")) {
    try { out.dividends = syncDividends(); } catch (e) { out.dividends = { ok: false, error: e.message }; }
  }
  if (anyLinkedAccount()) out.flows = writeLinkedFlows();
  return out;
}
