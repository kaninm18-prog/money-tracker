// ── STAGE 4 MIGRATION (step 5) ───────────────────────────────
// docs/stage-4-plan.md step 5, C9 and docs/stage-4-migration-runbook.md. Moves the investments' cash to
// linked investment accounts so the Wealth Planner can own the holdings. Arm runs these from the Apps
// Script editor, once, on migration day:
//   migrationPlan()     read-only: checks the mapping, lists every change, predicts reconcile afterwards
//   migrateToLinked()   makes exactly the changes the last plan showed, logged in the _MigrationLog tab
//   undoMigration()     puts back what the log says was changed, then removes the log
// The mapping (JSON, format in the plan's "Migration mapping") is passed in, or read from the Script
// Property MIGRATION_MAPPING (the editor's Run button can't pass arguments). The Wealth Planner's
// applyBrokerMapping() reads the same JSON.
//
// What changes, per source account in the mapping:
//  (a) { "link": true }: the account is linked in place (LinkedTo = its name; "link": "<name>" for another
//      Wealth Planner name). Its trades, holding entries, transfers, starting balance, Income/Expense rows
//      and receivables stay as they are: after linking, C9 sends all of its cash to the Wealth Planner.
//  (b) { "holdings": { "<holding name or Id>": "<broker>" } }: a bank that paid a shop directly. Each buy
//      (sell) of those holdings gets a transfer bank → broker (broker → bank): same date, same amount
//      in the bank's currency, ReceivedAmount when the currencies differ. The entries' Account becomes the
//      broker, so the bank's balance doesn't change. Their fee / dividend rows stay on the bank (C5).
//      Brokers that aren't accounts yet are created as linked accounts.
//  "otherAssets": "<account name>": the linked account for things held with no broker (C7).

var MIGRATION_LOG = "_MigrationLog";
var MIGRATION_LOG_HEADER = ["Seq", "At", "Action", "Sheet", "Key", "Column", "Before", "After", "Note"];
var MIGRATION_PROP = "MIGRATION_MAPPING", MIGRATION_HASH = "MIGRATION_PLAN_HASH";
var MIGRATION_TRANSFER_ID = "MIG";                 // + the holding entry's Id: a replay never adds it twice
var OTHER_ASSETS_LINK = "Other assets";            // the Wealth Planner's _Export_Values row for no-broker things (C7)

// ── Mapping ──────────────────────────────────────────────────
function readMapping(json, errors) {
  if (json === undefined || json === null || json === "") json = PropertiesService.getScriptProperties().getProperty(MIGRATION_PROP);
  if (!json) { errors.push("No mapping: pass it in, or paste it into the Script Property " + MIGRATION_PROP); return null; }
  var m;
  try { m = typeof json === "string" ? JSON.parse(json) : JSON.parse(JSON.stringify(json)); }
  catch (e) { errors.push("The mapping is not valid JSON: " + e.message); return null; }
  if (!m || typeof m !== "object") { errors.push("The mapping must be a JSON object"); return null; }
  m.accounts = m.accounts || {}; m.brokers = m.brokers || {};
  if (typeof m.accounts !== "object" || typeof m.brokers !== "object") { errors.push("\"accounts\" and \"brokers\" must be objects"); return null; }
  Object.keys(m.brokers).forEach(function(n) {
    var b = m.brokers[n] || {};
    b.currency = String(b.currency || "THB").trim().toUpperCase();
    b.dividendsTo = String(b.dividendsTo || "").trim();
    b.rate = b.currency === "THB" ? 1 : toFloat(b.rate);
    if (!/^[A-Z]{3}$/.test(b.currency)) errors.push("Broker \"" + n + "\": currency should be a 3-letter code");
    if (b.currency !== "THB" && !(b.rate > 0)) errors.push("Broker \"" + n + "\": a " + b.currency + " broker needs \"rate\" (THB per 1 " + b.currency + ")");
    if (n.toLowerCase() === OTHER_ASSETS_LINK.toLowerCase()) errors.push("\"" + OTHER_ASSETS_LINK + "\" is kept for things with no broker; it can't be a broker");
    m.brokers[n] = b;
  });
  Object.keys(m.accounts).forEach(function(n) {
    var a = m.accounts[n] || {};
    if (a.link && a.holdings) errors.push("\"" + n + "\": choose \"link\" or \"holdings\", not both");
    else if (!a.link && !a.holdings) errors.push("\"" + n + "\": needs \"link\": true or \"holdings\": {…}");
    if (a.link) a.linkName = a.link === true ? n : String(a.link).trim();
    m.accounts[n] = a;
  });
  if (m.otherAssets !== undefined) m.otherAssets = String(m.otherAssets || "").trim();
  return m;
}

// ── Positions per broker (the Wealth Planner's rule, brokerLedger in its src/15_brokers.gs) ──
// qty of each holding at each broker ("" = no broker), entry by entry in date order. `keyOf(t)` gives the
// Wealth Planner name of an entry's account ("" = none).
function brokerPositions(txns, keyOf) {
  var qtyAt = {};
  function heldAt(q) { return Object.keys(q).filter(function(k){ return k && q[k] > 1e-9; }); }
  function take(q, k, n) {
    var got = Math.min(n, Math.max(q[k] || 0, 0));
    if (got > 0) { q[k] -= got; n -= got; }
    if (n > 1e-9 && k !== "" && (q[""] || 0) > 1e-9) { var o = Math.min(n, q[""]); q[""] -= o; n -= o; }
    var others = heldAt(q).filter(function(x){ return x !== k; }), tot = 0;
    others.forEach(function(x){ tot += q[x]; });
    if (n > 1e-9 && tot > 1e-9) { var part = Math.min(n, tot); others.forEach(function(x){ q[x] -= part * q[x] / tot; }); n -= part; }
    if (n > 1e-9) q[k] = (q[k] || 0) - n;
  }
  txns.filter(function(t){ return t.type === "buy" || t.type === "sell"; })
    .sort(function(a, b){ return a.date === b.date ? a.rowIndex - b.rowIndex : a.date.localeCompare(b.date); })
    .forEach(function(t) {
      var q = qtyAt[t.holdingId] || (qtyAt[t.holdingId] = {}), k = keyOf(t);
      if (!k) { var at = heldAt(q); if (at.length === 1) k = at[0]; }
      if (t.type === "buy") q[k] = (q[k] || 0) + t.quantity; else take(q, k, t.quantity);
    });
  return qtyAt;
}

// ── The plan ─────────────────────────────────────────────────
// Everything the migration would change, worked out from the sheet as it is now. Reads only.
function migrationPlanData(mappingJson) {
  var errors = [], warnings = [], m = readMapping(mappingJson, errors);
  var plan = { ok: false, errors: errors, warnings: warnings, links: [], creates: [], transfers: [], rewrites: [], headers: [], caseA: [],
    changes: [], prediction: null, done: false };
  if (!m) return plan;
  var accounts = sheetToRows(getSheet(SHEET.ACCOUNTS), accountFromRow), byName = {};
  accounts.forEach(function(a){ byName[String(a.name || "").trim()] = a; });
  var hd = holdingsData(), holdingById = {}, txns = holdingTxnRows(), trades = tradeRows();
  hd.holdings.forEach(function(h){ holdingById[h.id] = h; });
  function hname(id) { return holdingById[id] ? holdingById[id].name : id; }

  // Wealth Planner name of each account after the migration (linked ones), and where every broker lives
  var after = {};                                   // MT account name → LinkedTo after the migration
  accounts.forEach(function(a){ if (a.linked) after[String(a.name).trim()] = a.linkedTo; });
  var brokerAccount = {};                           // broker (Wealth Planner name) → MT account name
  accounts.forEach(function(a){ if (a.linked) brokerAccount[a.linkedTo] = String(a.name).trim(); });

  // (a) link in place
  Object.keys(m.accounts).forEach(function(n) {
    var src = m.accounts[n], a = byName[n];
    if (!a) { errors.push("\"" + n + "\" is not an account in Money Tracker"); return; }
    if (!src.link) return;
    var b = m.brokers[src.linkName];
    if (!b) { errors.push("\"" + n + "\" links to \"" + src.linkName + "\", which is missing from \"brokers\""); return; }
    if (b.currency !== a.currency) errors.push("\"" + n + "\" is kept in " + a.currency + " but its broker \"" + src.linkName + "\" is in " + b.currency);
    else if (b.currency !== "THB" && Math.abs(b.rate - a.rate) > 1e-9)
      errors.push("Broker \"" + src.linkName + "\": rate " + b.rate + " differs from the account's rate " + a.rate + " — use \"rate\": " + a.rate);
    if (a.linked && a.linkedTo !== src.linkName) { errors.push("\"" + n + "\" is already linked to \"" + a.linkedTo + "\""); return; }
    if (brokerAccount[src.linkName] && brokerAccount[src.linkName] !== n) { errors.push("Two accounts would link to \"" + src.linkName + "\""); return; }
    after[n] = src.linkName; brokerAccount[src.linkName] = n;
    if (!a.linked) plan.links.push({ account: n, linkTo: src.linkName });
  });

  // (b) brokers paid from a bank: resolve each holding by Id, then by its exact name
  var bankHolding = {};                             // bank → holdingId → broker
  Object.keys(m.accounts).forEach(function(n) {
    var src = m.accounts[n];
    if (!src.holdings || !byName[n]) return;
    if (byName[n].linked) { errors.push("\"" + n + "\" is a linked account: its entries are already the broker's"); return; }
    var map = bankHolding[n] = {};
    Object.keys(src.holdings).forEach(function(key) {
      var broker = String(src.holdings[key] || "").trim();
      var hits = holdingById[key] ? [holdingById[key]] : hd.holdings.filter(function(h){ return h.name === key; });
      if (!hits.length) { errors.push("\"" + n + "\": no holding called \"" + key + "\""); return; }
      if (hits.length > 1) { errors.push("\"" + n + "\": " + hits.length + " holdings are called \"" + key + "\" — use the Id (" + hits.map(function(h){ return h.id; }).join(", ") + ")"); return; }
      if (!m.brokers[broker]) { errors.push("\"" + n + "\" → \"" + key + "\": broker \"" + broker + "\" is missing from \"brokers\""); return; }
      map[hits[0].id] = broker;
    });
  });
  // every broker used for (b) needs an account linked to it: an existing one, or a new one
  var needBroker = {};
  Object.keys(bankHolding).forEach(function(n){ Object.keys(bankHolding[n]).forEach(function(h){ needBroker[bankHolding[n][h]] = true; }); });
  Object.keys(needBroker).forEach(function(g) {
    var b = m.brokers[g];
    if (brokerAccount[g] && brokerAccount[g] !== g) { errors.push("Broker \"" + g + "\" is the account \"" + brokerAccount[g] + "\": use that account's name as the broker name"); return; }
    if (brokerAccount[g]) {
      var ex = byName[brokerAccount[g]];
      if (ex.currency !== b.currency) errors.push("Broker \"" + g + "\": the account \"" + ex.name + "\" is in " + ex.currency + ", the mapping says " + b.currency);
      return;
    }
    if (byName[g]) { errors.push("\"" + g + "\" is already an account that isn't linked: name the broker differently, or link that account"); return; }
    var row = [g, "investment", 0, "", "", "", b.currency, b.rate, g];
    plan.creates.push({ account: g, linkTo: g, currency: b.currency, rate: b.rate, row: row });
    brokerAccount[g] = g; after[g] = g;
    byName[g] = { name: g, type: "investment", startingBalance: 0, currency: b.currency, rate: b.rate, linked: true, linkedTo: g };
  });

  // Holding entries: each one must end up at a broker that is in the mapping, or have no account
  var unmapped = {}, trfIds = {};
  sheetToRows(getSheet(SHEET.TRANSFERS), transferFromRow).forEach(function(r){ trfIds[r.id] = true; });
  txns.forEach(function(t) {
    var A = t.account;
    if (!A) return;
    if (after[A]) {
      if (!m.brokers[after[A]]) errors.push("Entries on \"" + A + "\" go to \"" + after[A] + "\", which is missing from \"brokers\"");
      return;
    }
    var G = bankHolding[A] && bankHolding[A][t.holdingId];
    if (!G) { var k = A + " · " + hname(t.holdingId); unmapped[k] = (unmapped[k] || 0) + 1; return; }
    var bank = byName[A];
    if (!bank) { errors.push("\"" + A + "\" (entries of " + hname(t.holdingId) + ") is not an account: decide what it was"); return; }
    if (!brokerAccount[G]) return;                 // the broker itself has an error above
    if (t.type === "buy" || t.type === "sell") {
      var gAcc = byName[brokerAccount[G]];
      // the bank side moves by exactly what the entry moved before (accountBalances); the broker side by
      // what the Wealth Planner books for the entry (its txnAmt rule)
      var bankAmt = (t.origAmount && t.currency && t.currency === bank.currency) ? t.origAmount : (bank.currency === "THB" ? t.amount : t.amount / bank.rate);
      var brokerAmt = gAcc.currency === "THB" ? t.amount : ((t.origAmount && t.currency === gAcc.currency) ? t.origAmount : t.amount / gAcc.rate);
      var buy = t.type === "buy", id = MIGRATION_TRANSFER_ID + t.id;
      var x = { id: id, date: t.date, holding: hname(t.holdingId), type: t.type, quantity: t.quantity, txnId: t.id,
        from: buy ? A : gAcc.name, to: buy ? gAcc.name : A, amount: buy ? bankAmt : brokerAmt,
        received: bank.currency === gAcc.currency ? "" : (buy ? brokerAmt : bankAmt), currency: buy ? bank.currency : gAcc.currency };
      x.row = [t.date, x.amount, x.from, x.to, "Stage 4 migration: " + t.type + " " + x.holding, x.received, id];
      if (!trfIds[id]) plan.transfers.push(x);
    }
    plan.rewrites.push({ txnId: t.id, holding: hname(t.holdingId), type: t.type, date: t.date, from: A, to: brokerAccount[G] });
  });
  Object.keys(unmapped).forEach(function(k){ errors.push("Not in the mapping: " + unmapped[k] + " entr" + (unmapped[k] > 1 ? "ies" : "y") + " of " + k); });

  // Trades stay on their account, which must be linked; MT adds their net as-is, the Wealth Planner converts it
  trades.forEach(function(t) {
    if (!t.account) return;
    var L = after[t.account];
    if (!L) { errors.push("Trade " + (t.ticket || t.id) + " is on \"" + t.account + "\", which isn't linked in the mapping: trades can't become transfers"); return; }
    var a = byName[t.account], cur = String(t.currency || "USD").toUpperCase();
    if (a && t.closeTime && cur !== a.currency) errors.push("Trade " + (t.ticket || t.id) + " is in " + cur + " on \"" + t.account + "\" (" + a.currency + "): Money Tracker and the Wealth Planner would value it differently");
  });

  // C7: things with no broker → the Other assets account
  var keyAfter = function(t) {
    if (!t.account) return "";
    if (after[t.account]) return after[t.account];
    var G = bankHolding[t.account] && bankHolding[t.account][t.holdingId];
    return G || ("?" + t.account);
  };
  var qtyAt = brokerPositions(txns, keyAfter), noBroker = 0;
  Object.keys(qtyAt).forEach(function(h){ if (Math.abs(qtyAt[h][""] || 0) > 1e-9) noBroker++; });
  var otherAcc = "";
  accounts.forEach(function(a){ if (a.linked && a.linkedTo === OTHER_ASSETS_LINK) otherAcc = String(a.name).trim(); });
  if (m.otherAssets) {
    if (otherAcc && otherAcc !== m.otherAssets) errors.push("\"" + otherAcc + "\" is already linked to \"" + OTHER_ASSETS_LINK + "\"");
    else if (!otherAcc) {
      if (byName[m.otherAssets]) errors.push("\"" + m.otherAssets + "\" is already an account that isn't linked to \"" + OTHER_ASSETS_LINK + "\"");
      else {
        plan.creates.push({ account: m.otherAssets, linkTo: OTHER_ASSETS_LINK, currency: "THB", rate: 1, row: [m.otherAssets, "investment", 0, "", "", "", "THB", 1, OTHER_ASSETS_LINK] });
        byName[m.otherAssets] = { name: m.otherAssets, type: "investment", startingBalance: 0, currency: "THB", rate: 1, linked: true, linkedTo: OTHER_ASSETS_LINK };
        otherAcc = m.otherAssets;
      }
    }
  } else if (noBroker && !otherAcc) errors.push(noBroker + " holding(s) are held with no broker (a car, a gold bar…): add \"otherAssets\": \"<account name>\" so they stay in net worth (C7)");

  // case (a) items that become C9 flows
  plan.links.forEach(function(l) {
    var a = byName[l.account], fake = {}, inc, exp;
    fake[l.account] = { name: a.name, linked: true, linkedTo: l.linkTo, currency: a.currency, rate: a.rate };
    inc = sheetToRows(getSheet(SHEET.INCOME), incomeCashRow); exp = sheetToRows(getSheet(SHEET.EXPENSES), expenseCashRow);
    var flows = linkedOtherFlows(fake, inc, exp, loadReceivables());
    if (round2(a.startingBalance)) flows.unshift({ id: "OPENING", date: "", amount: a.startingBalance, kind: "opening" });
    flows.forEach(function(f){ plan.caseA.push({ account: l.account, id: f.id, date: f.date, kind: f.kind, amount: round2(f.amount), currency: a.currency }); });
    var mine = txns.filter(function(t){ return t.account === l.account; }).length, tr = trades.filter(function(t){ return t.account === l.account; }).length;
    if (mine || tr) plan.caseA.push({ account: l.account, id: "", date: "", kind: "moves with the copied tabs", amount: 0, currency: a.currency,
      note: mine + " holding entr" + (mine === 1 ? "y" : "ies") + ", " + tr + " trade" + (tr === 1 ? "" : "s") });
  });
  // Brokers whose dividends go to a bank: say what that means for the dividends already recorded
  Object.keys(m.brokers).forEach(function(g) {
    var to = m.brokers[g].dividendsTo;
    if (to && !byName[to]) errors.push("Broker \"" + g + "\": dividendsTo \"" + to + "\" is not an account in Money Tracker");
    else if (to) warnings.push("Broker \"" + g + "\": dividends recorded in the Wealth Planner from now on go to " + to + "; the old ones stay where Money Tracker booked them (C9)");
  });

  // Sheet headers the changes need (logged, so undo can clear them again)
  var ash = getSheet(SHEET.ACCOUNTS), tsh = getSheet(SHEET.TRANSFERS);
  if ((plan.links.length || plan.creates.length) && !ash.getRange(1, 9).getValue()) plan.headers.push({ sheet: SHEET.ACCOUNTS, column: 9, name: "LinkedTo" });
  if (plan.transfers.some(function(x){ return x.received !== ""; }) && !tsh.getRange(1, 6).getValue()) plan.headers.push({ sheet: SHEET.TRANSFERS, column: 6, name: "ReceivedAmount" });
  if (plan.transfers.length && !tsh.getRange(1, 7).getValue()) plan.headers.push({ sheet: SHEET.TRANSFERS, column: 7, name: "Id" });

  // The change list, in the order migrateToLinked applies it. Per entry, the transfer comes before the
  // Account change, so a run that stops half way never leaves a bank short.
  plan.headers.forEach(function(h){ plan.changes.push({ action: "header", sheet: h.sheet, key: "", column: h.column, before: "", after: h.name }); });
  plan.links.forEach(function(l){ plan.changes.push({ action: "setCell", sheet: SHEET.ACCOUNTS, key: l.account, column: 9, before: byName[l.account].linkedTo || "", after: l.linkTo }); });
  plan.creates.forEach(function(c){ plan.changes.push({ action: "addRow", sheet: SHEET.ACCOUNTS, key: c.account, column: "", before: "", after: c.row }); });
  var trfByTxn = {};
  plan.transfers.forEach(function(x){ trfByTxn[x.txnId] = x; });
  plan.rewrites.forEach(function(r) {
    var x = trfByTxn[r.txnId];
    if (x) plan.changes.push({ action: "addRow", sheet: SHEET.TRANSFERS, key: x.id, column: "", before: "", after: x.row });
    plan.changes.push({ action: "setCell", sheet: SHEET.HOLDING_TXNS, key: r.txnId, column: 9, before: r.from, after: r.to });
  });
  plan.hash = migrationHash(plan.changes);
  plan.done = !errors.length && !plan.changes.length;
  if (errors.length) return plan;
  plan.prediction = predictMigration(plan, m);
  plan.prediction.problems.forEach(function(p){ errors.push(p); });
  plan.ok = !errors.length;
  return plan;
}

// Short stable fingerprint of a change list (not for security: it only proves the plan didn't change)
function migrationHash(changes) {
  var s = JSON.stringify(changes), h = 5381;
  for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return ("0000000" + h.toString(16)).slice(-8) + "-" + changes.length;
}

// ── Prediction ───────────────────────────────────────────────
// reconcile as it will be after the migration, worked out in memory: the change list is applied to a copy
// of the sheet's values (the startup read cache, so the real code computes the balances), and each linked
// account is valued the Wealth Planner's way (its cash ledger + what is held there, at today's prices here).
function predictMigration(plan, m) {
  var before = reconcileData(), problems = [];
  var saved = _readCache, savedValues = _wealthValues;
  var copy = {};
  [SHEET.ACCOUNTS, SHEET.TRANSFERS, SHEET.HOLDING_TXNS].forEach(function(n){
    copy[n] = getSheet(n).getDataRange().getValues().map(function(r){ return r.slice(); });
  });
  plan.changes.forEach(function(c) {
    var rows = copy[c.sheet];
    if (c.action === "header") { while (rows[0].length < c.column) rows[0].push(""); rows[0][c.column - 1] = c.after; }
    else if (c.action === "addRow") rows.push(c.after.slice());
    else if (c.action === "setCell") {
      for (var i = 1; i < rows.length; i++) if (String(rows[i][0]).trim() === c.key) { while (rows[i].length < c.column) rows[i].push(""); rows[i][c.column - 1] = c.after; }
    }
  });
  var out;
  try {
    _readCache = copy;
    _wealthValues = {};                            // no Wealth Planner values: linked accounts come out at cost (their flows)
    var ab = accountBalances("").accounts, txns = holdingTxnRows(), trades = tradeRows(), hd = holdingsData();
    var byName = {}, byLink = {};
    ab.forEach(function(a){ byName[String(a.name).trim()] = a; if (a.linked) byLink[a.linkedTo] = a; });
    // the Wealth Planner's broker cash on top of the flows: − buys + sells + closed trades (copied fees and
    // dividends are left to Money Tracker, C9)
    var cash = {};
    ab.forEach(function(a){ if (a.linked) cash[a.linkedTo] = a.balance; });
    txns.forEach(function(t) {
      var a = byName[t.account];
      if (!a || !a.linked || (t.type !== "buy" && t.type !== "sell")) return;
      var amt = a.currency === "THB" ? t.amount : ((t.origAmount && t.currency === a.currency) ? t.origAmount : t.amount / a.rate);
      cash[a.linkedTo] += t.type === "buy" ? -amt : amt;
    });
    trades.forEach(function(t) {
      var a = byName[t.account];
      if (a && a.linked && t.closeTime) cash[a.linkedTo] += t.net;
    });
    var unit = {};
    hd.holdings.forEach(function(h){ unit[h.id] = h.quantity ? h.value / h.quantity : (h.currentPrice || 0); });
    var qtyAt = brokerPositions(txns, function(t){ var a = byName[t.account]; return a && a.linked ? a.linkedTo : (t.account ? "?" + t.account : ""); });
    var held = {};
    Object.keys(qtyAt).forEach(function(hid) {
      Object.keys(qtyAt[hid]).forEach(function(k) {
        var key = k === "" ? OTHER_ASSETS_LINK : k;
        held[key] = (held[key] || 0) + (unit[hid] || 0) * qtyAt[hid][k];
      });
    });
    Object.keys(held).forEach(function(k) {
      if (!byLink[k] && Math.abs(held[k]) > 0.005) problems.push("Holdings worth " + round2(held[k]) + " THB would be at \"" + k + "\", which no account links to");
    });
    var accounts = ab.map(function(a) {
      var o = { name: String(a.name), type: String(a.type || ""), currency: a.currency, rate: a.rate };
      if (a.linked) {
        var c = cash[a.linkedTo] || 0, h = held[a.linkedTo] || 0;
        o.linkedTo = a.linkedTo; o.cash = round2(c); o.holdingsThb = round2(h);
        o.balance = round2(c + h / a.rate); o.balanceThb = round2(c * a.rate + h);
      } else { o.balance = round2(a.balance); o.balanceThb = round2(a.balance * a.rate); }
      return o;
    });
    var total = 0;
    accounts.forEach(function(a){ total += a.balanceThb; });
    out = { accounts: accounts, totalBalance: round2(total), receivables: receivablesAt(""), holdingsValue: hd.totals.value };
    out.netWorth = round2(out.totalBalance + out.receivables);
  } finally { _readCache = saved; _wealthValues = savedValues; }

  // compare with now
  var now = {}, diffs = [];
  before.accounts.forEach(function(a){ now[a.name] = a; });
  out.accounts.forEach(function(a) {
    var b = now[a.name];
    if (!a.linkedTo) {
      if (!b) problems.push("Prediction: \"" + a.name + "\" appears from nowhere");
      else if (b.balance !== a.balance || b.balanceThb !== a.balanceThb)
        problems.push("Prediction: \"" + a.name + "\" would change from " + b.balance + " to " + a.balance + " " + a.currency + " — not migrating");
      return;
    }
    diffs.push({ account: a.name, linkedTo: a.linkedTo, beforeThb: b ? b.balanceThb : 0,
      afterThb: a.balanceThb, cash: a.cash, holdingsThb: a.holdingsThb, currency: a.currency });
  });
  before.accounts.forEach(function(a){ if (!out.accounts.some(function(x){ return x.name === a.name; })) problems.push("Prediction: \"" + a.name + "\" would disappear"); });
  if (round2(out.receivables) !== round2(before.receivables)) problems.push("Prediction: receivables would change from " + before.receivables + " to " + out.receivables);
  var linkedBefore = 0, linkedAfter = 0;
  diffs.forEach(function(d){ linkedBefore += d.beforeThb; linkedAfter += d.afterThb; });
  out.before = { netWorth: before.netWorth, totalBalance: before.totalBalance, holdingsValue: before.holdingTotals.value, receivables: before.receivables };
  out.linked = diffs;
  // what replaces "linked cash before + holdings at market value": the linked accounts afterwards
  out.marketDifference = round2(linkedAfter - linkedBefore - (before.netWorth - before.totalBalance - before.receivables));
  out.netWorthDifference = round2(out.netWorth - before.netWorth);
  if (Math.abs(out.netWorthDifference - out.marketDifference) > 0.005) problems.push("Prediction: net worth moves by " + out.netWorthDifference + " THB, of which only " + out.marketDifference + " is explained");
  out.problems = problems;
  return out;
}

// ── Report ───────────────────────────────────────────────────
function migMoney(n, cur) { return (Math.round(n * 100) / 100).toFixed(2) + " " + (cur || "THB"); }
function migrationReport(plan) {
  var L = [];
  L.push("STAGE 4 MIGRATION PLAN — " + todayStr() + "   (plan " + (plan.hash || "-") + ")");
  if (plan.errors.length) {
    L.push(""); L.push("NOT READY. Nothing will be changed until these are fixed:");
    plan.errors.forEach(function(e){ L.push("  ✗ " + e); });
  }
  if (plan.done) { L.push(""); L.push("Nothing to do: the migration has already been applied (see the " + MIGRATION_LOG + " tab)."); }
  plan.warnings.forEach(function(w){ L.push("  ! " + w); });
  L.push(""); L.push("1. Accounts linked in place (case a):");
  if (!plan.links.length) L.push("   (none)");
  plan.links.forEach(function(l){ L.push("   " + l.account + "  →  LinkedTo \"" + l.linkTo + "\""); });
  L.push(""); L.push("2. Accounts created (linked):");
  if (!plan.creates.length) L.push("   (none)");
  plan.creates.forEach(function(c){ L.push("   " + c.account + "  (" + c.currency + (c.currency !== "THB" ? " @ " + c.rate : "") + ")  →  LinkedTo \"" + c.linkTo + "\""); });
  L.push(""); L.push("3. Holding entries paid from a bank (case b): each buy/sell becomes a transfer, the entry moves to the broker");
  if (!plan.rewrites.length) L.push("   (none)");
  var trf = {};
  plan.transfers.forEach(function(x){ trf[x.txnId] = x; });
  plan.rewrites.forEach(function(r) {
    var x = trf[r.txnId];
    L.push("   " + r.date + "  " + r.type + " " + r.holding + "  [" + r.txnId + "]  Account " + r.from + " → " + r.to +
      (x ? "   + transfer " + x.from + " → " + x.to + "  " + migMoney(x.amount, x.currency) + (x.received !== "" ? "  (received " + round2(x.received) + ")" : "") + "  [" + x.id + "]"
         : (r.type === "dividend" ? "   (no transfer: its Income row stays on " + r.from + ")" : "   (transfer already there)")));
  });
  L.push(""); L.push("4. Case (a) cash the Wealth Planner will get through _Export_LinkedFlows (C9):");
  if (!plan.caseA.length) L.push("   (none)");
  plan.caseA.forEach(function(f){ L.push("   " + f.account + "  " + (f.date || "          ") + "  " + f.kind + (f.id ? "  [" + f.id + "]" : "") + (f.note ? "  " + f.note : "  " + migMoney(f.amount, f.currency))); });
  var p = plan.prediction;
  if (p) {
    L.push(""); L.push("5. Predicted reconcile after the migration (today's prices and rates):");
    p.accounts.forEach(function(a) {
      var now = null;
      (p.linked || []).forEach(function(d){ if (d.account === a.name) now = d; });
      if (a.linkedTo) L.push("   " + a.name + " (linked → " + a.linkedTo + ")  " + migMoney(a.balanceThb) + "  = cash " + migMoney(a.cash, a.currency) + " + holdings " + migMoney(a.holdingsThb) +
        "   (now " + migMoney(now ? now.beforeThb : 0) + ")");
      else L.push("   " + a.name + "  " + migMoney(a.balance, a.currency) + "  unchanged ✓");
    });
    L.push("   Receivables " + migMoney(p.receivables) + " unchanged ✓");
    L.push("   Net worth now " + migMoney(p.before.netWorth) + " (accounts " + migMoney(p.before.totalBalance) + " + holdings " + migMoney(p.before.holdingsValue) + " + receivables " + migMoney(p.before.receivables) + ")");
    L.push("   Net worth after " + migMoney(p.netWorth) + "   difference " + migMoney(p.netWorthDifference) + ", all of it the market-value difference (" + migMoney(p.marketDifference) + ")");
  }
  L.push("");
  L.push(plan.ok ? "READY. Next: run migrateToLinked (it applies exactly this plan " + plan.hash + ")." : (plan.done ? "" : "Fix the items above and run migrationPlan again."));
  return L.join("\n");
}

// Run from the Apps Script editor. Reads only (it remembers the plan's fingerprint for migrateToLinked).
function migrationPlan(mappingJson) {
  var plan = migrationPlanData(mappingJson);
  plan.report = migrationReport(plan);
  Logger.log(plan.report);
  if (plan.ok) PropertiesService.getScriptProperties().setProperty(MIGRATION_HASH, plan.hash);
  return plan;
}

// ── Apply ────────────────────────────────────────────────────
function migrationLogSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(MIGRATION_LOG);
  if (!sh) { sh = ss.insertSheet(MIGRATION_LOG); sh.appendRow(MIGRATION_LOG_HEADER); sh.getRange(1, 1, 1, MIGRATION_LOG_HEADER.length).setFontWeight("bold"); }
  return sh;
}
function migrationDone() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MIGRATION_LOG);
  return !!sh && sh.getLastRow() > 1;
}
function migrationKeyRow(sheet, key) {                      // Accounts by Name (col 1), the others by Id
  if (sheet === SHEET.ACCOUNTS) {
    var v = getSheet(sheet).getDataRange().getValues();
    for (var i = 1; i < v.length; i++) if (String(v[i][0]).trim() === key) return i + 1;
    return 0;
  }
  return resolveRow(sheet, { id: key });
}

// Applies the plan. Refuses unless migrationPlan ran on exactly this data and was READY.
function migrateToLinked(mappingJson) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var plan = migrationPlanData(mappingJson);
    if (plan.done) { Logger.log("Nothing to do: already migrated."); return { ok: true, applied: 0, done: true }; }
    if (!plan.ok) { Logger.log(migrationReport(plan)); return { ok: false, error: "The plan is not ready: run migrationPlan and fix what it lists", errors: plan.errors }; }
    var want = PropertiesService.getScriptProperties().getProperty(MIGRATION_HASH);
    if (want !== plan.hash) {
      Logger.log("The data changed since the last migrationPlan (or it wasn't run). Run migrationPlan again and read it.");
      return { ok: false, error: "Run migrationPlan first (or again: something changed since it ran)" };
    }
    var log = migrationLogSheet(), seq = log.getLastRow(), at = new Date().toISOString();
    plan.changes.forEach(function(c) {
      // log first, then change: undo checks each cell, so a run cut short in between is still undone right
      seq++;
      log.appendRow([seq, at, c.action, c.sheet, c.key, c.column, String(c.before), c.action === "addRow" ? JSON.stringify(c.after) : String(c.after), ""]);
      var sh = getSheet(c.sheet);
      if (c.action === "header") sh.getRange(1, c.column).setValue(c.after);
      else if (c.action === "addRow") {
        if (c.sheet === SHEET.TRANSFERS) sh.getRange(sh.getLastRow() + 1, 1).setNumberFormat("@");
        sh.appendRow(c.after);
      } else if (c.action === "setCell") {
        var row = migrationKeyRow(c.sheet, c.key);
        if (!row) throw new Error("Row " + c.key + " in " + c.sheet + " not found");
        sh.getRange(row, c.column).setValue(c.after);
      }
    });
    PropertiesService.getScriptProperties().deleteProperty(MIGRATION_HASH);
    Logger.log("Migration applied: " + plan.changes.length + " changes, logged in " + MIGRATION_LOG + ". Next: copy the tabs to the Wealth Planner (runbook step 6).");
    return { ok: true, applied: plan.changes.length, hash: plan.hash };
  } finally { lock.releaseLock(); }
}

// ── Undo ─────────────────────────────────────────────────────
// Checks everything first and changes nothing if any row is not as the migration left it (or as it was
// before). Then reverts newest first and removes the log tab.
function undoMigration() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet(), log = ss.getSheetByName(MIGRATION_LOG);
    if (!log || log.getLastRow() < 2) { Logger.log("Nothing to undo."); return { ok: true, undone: 0 }; }
    var entries = log.getDataRange().getValues().slice(1).map(function(r) {
      return { action: String(r[2]), sheet: String(r[3]), key: String(r[4]), column: parseInt(r[5]) || 0, before: String(r[6]), after: String(r[7]) };
    });
    var problems = [], todo = [], created = {}, ours = {};
    entries.forEach(function(e) {
      if (e.action === "addRow" && e.sheet === SHEET.ACCOUNTS) created[e.key] = true;
      if (e.action === "addRow") ours[e.sheet + "|" + e.key] = true;
      if (e.action === "setCell" && e.sheet === SHEET.HOLDING_TXNS) ours[e.sheet + "|" + e.key] = true;
    });
    // a created account must not be used by anything the migration didn't write
    var names = Object.keys(created);
    if (names.length) {
      var used = function(sheet, cols, idCol) {
        getSheet(sheet).getDataRange().getValues().slice(1).forEach(function(r) {
          cols.forEach(function(c) {
            var n = String(r[c] || "").trim();
            if (created[n] && !(idCol >= 0 && ours[sheet + "|" + String(r[idCol])])) problems.push("\"" + n + "\" is used in " + sheet + " by a row the migration didn't write" + (idCol >= 0 ? " (" + r[idCol] + ")" : "") + ": delete or move it first");
          });
        });
      };
      used(SHEET.EXPENSES, [4], 10); used(SHEET.INCOME, [4], 7); used(SHEET.TRANSFERS, [2, 3], 6);
      used(SHEET.RECEIVABLES, [8], 9); used(SHEET.REPAYMENTS, [4], 0); used(SHEET.HOLDING_TXNS, [8], 0); used(SHEET.TRADES, [12], 0);
    }
    entries.slice().reverse().forEach(function(e) {
      var sh = getSheet(e.sheet);
      if (e.action === "header") {
        var h = String(sh.getRange(1, e.column).getValue());
        if (h === e.after) todo.push(e); else if (h !== e.before) problems.push(e.sheet + " column " + e.column + " header is now \"" + h + "\"");
      } else if (e.action === "setCell") {
        var row = migrationKeyRow(e.sheet, e.key);
        if (!row) { problems.push(e.sheet + " row " + e.key + " is gone"); return; }
        var v = String(sh.getRange(row, e.column).getValue()).trim();
        if (v === e.after) todo.push(e); else if (v !== e.before) problems.push(e.sheet + " " + e.key + " column " + e.column + " is now \"" + v + "\", not \"" + e.after + "\"");
      } else if (e.action === "addRow") {
        var r2 = migrationKeyRow(e.sheet, e.key);
        if (!r2) return;                           // never added (run cut short) or already removed
        var want = JSON.parse(e.after), have = sh.getRange(r2, 1, 1, want.length).getValues()[0];
        var same = want.every(function(w, i){ return String(e.sheet === SHEET.TRANSFERS && i === 0 ? formatDate(have[i]) : have[i]) === String(w); });
        if (same) todo.push(e); else problems.push(e.sheet + " row " + e.key + " was edited after the migration: put it back or delete it by hand");
      }
    });
    if (problems.length) {
      Logger.log("NOT UNDONE. Nothing was changed:\n  ✗ " + problems.join("\n  ✗ "));
      return { ok: false, error: "Not undone: " + problems.length + " problem(s)", problems: problems };
    }
    todo.forEach(function(e) {
      var sh = getSheet(e.sheet);
      if (e.action === "header") sh.getRange(1, e.column).setValue("");
      else if (e.action === "setCell") sh.getRange(migrationKeyRow(e.sheet, e.key), e.column).setValue(e.before);
      else if (e.action === "addRow") sh.deleteRow(migrationKeyRow(e.sheet, e.key));
    });
    ss.deleteSheet(log);
    // nothing linked any more: the Wealth Planner must not keep reading old flows
    if (!anyLinkedAccount()) {
      var fl = ss.getSheetByName(SHEET.LINKED_FLOWS);
      if (fl) { ss.deleteSheet(fl); delete _sheetMemo[SHEET.LINKED_FLOWS]; }
    }
    Logger.log("Migration undone: " + todo.length + " changes reverted, " + MIGRATION_LOG + " removed.");
    return { ok: true, undone: todo.length };
  } finally { lock.releaseLock(); }
}
