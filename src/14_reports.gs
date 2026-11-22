// ── ANNUAL SUMMARY ───────────────────────────────────────────

function getAnnualSummary(p) {
  var y = parseInt(p.year) || new Date().getFullYear();
  var expenses = sheetToRows(getSheet(SHEET.EXPENSES), function(d) {
    return { date: formatDate(d[0]), amount: toFloat(d[1]), category: d[2], projectId: d[7] || '' };
  }).filter(function(r) { return r.date && parseInt(r.date.substring(0, 4)) === y; });

  var incomes = sheetToRows(getSheet(SHEET.INCOME), function(d) {
    return { date: formatDate(d[0]), amount: toFloat(d[1]), category: d[2] };
  }).filter(function(r) { return r.date && parseInt(r.date.substring(0, 4)) === y; });

  // Monthly breakdown (12 months)
  var monthly = [];
  for (var mo = 1; mo <= 12; mo++) {
    var mRegExp  = expenses.filter(function(e){ return dateMatchesMonth(e.date, mo, y) && !e.projectId; })
                           .reduce(function(s,e){ return s+e.amount; }, 0);
    var mProjExp = expenses.filter(function(e){ return dateMatchesMonth(e.date, mo, y) && !!e.projectId; })
                           .reduce(function(s,e){ return s+e.amount; }, 0);
    var mInc     = incomes.filter(function(e){ return dateMatchesMonth(e.date, mo, y); })
                          .reduce(function(s,e){ return s+e.amount; }, 0);
    var mNet     = mInc - mRegExp - mProjExp;
    monthly.push({
      month: mo,
      income:          Math.round(mInc*100)/100,
      regularExpenses: Math.round(mRegExp*100)/100,
      projectExpenses: Math.round(mProjExp*100)/100,
      net:             Math.round(mNet*100)/100,
      savingsRate:     mInc > 0 ? Math.round(mNet/mInc*100) : 0
    });
  }

  // Category breakdown (all expenses)
  var byCat = {};
  expenses.forEach(function(e){ byCat[e.category] = (byCat[e.category]||0) + e.amount; });
  var categories = Object.keys(byCat).map(function(c){
    return { category: c, amount: Math.round(byCat[c]*100)/100 };
  }).sort(function(a,b){ return b.amount - a.amount; });

  var totalIncome   = Math.round(incomes.reduce(function(s,e){ return s+e.amount; }, 0)*100)/100;
  var totalRegExp   = Math.round(expenses.filter(function(e){ return !e.projectId; }).reduce(function(s,e){ return s+e.amount; }, 0)*100)/100;
  var totalProjExp  = Math.round(expenses.filter(function(e){ return !!e.projectId; }).reduce(function(s,e){ return s+e.amount; }, 0)*100)/100;
  var totalExp      = Math.round((totalRegExp + totalProjExp)*100)/100;
  var surplus       = Math.round((totalIncome - totalExp)*100)/100;
  var savingsRate   = totalIncome > 0 ? Math.round(surplus/totalIncome*100) : 0;

  return jsonResponse({ ok: true,
    year: y,
    totalIncome:          totalIncome,
    totalRegularExpenses: totalRegExp,
    totalProjectExpenses: totalProjExp,
    totalExpenses:        totalExp,
    surplus:              surplus,
    savingsRate:          savingsRate,
    monthly:              monthly,
    categories:           categories
  });
}

// ── SPENDING TRENDS ──────────────────────────────────────────
// Last 12 months up to the current month: regular (non-project) spending, project
// spending, income, and regular spending per category.
function getTrends(p) {
  var today = todayStr();
  var ey = parseInt(today.substring(0, 4)), em = parseInt(today.substring(5, 7));
  var months = [], idx = {};
  for (var k = 11; k >= 0; k--) {
    var y = ey, m = em - k;
    while (m < 1) { m += 12; y--; }
    var key = y + "-" + pad2(m);
    idx[key] = months.length;
    months.push({ year: y, month: m, expense: 0, projectExpense: 0, income: 0, byCat: {} });
  }
  sheetToRows(getSheet(SHEET.EXPENSES), function(d) {
    return { date: formatDate(d[0]), amount: toFloat(d[1]), category: cleanName(d[2]) || "Other", projectId: d[7] || "" };
  }).forEach(function(r) {
    var i = idx[r.date.substring(0, 7)];
    if (i === undefined) return;
    var mo = months[i];
    if (r.projectId) { mo.projectExpense += r.amount; return; }
    mo.expense += r.amount;
    mo.byCat[r.category] = (mo.byCat[r.category] || 0) + r.amount;
  });
  sheetToRows(getSheet(SHEET.INCOME), function(d) {
    return { date: formatDate(d[0]), amount: toFloat(d[1]) };
  }).forEach(function(r) {
    var i = idx[r.date.substring(0, 7)];
    if (i !== undefined) months[i].income += r.amount;
  });
  months.forEach(function(mo) {
    mo.expense = round2(mo.expense); mo.projectExpense = round2(mo.projectExpense); mo.income = round2(mo.income);
    Object.keys(mo.byCat).forEach(function(c) { mo.byCat[c] = round2(mo.byCat[c]); });
  });
  return jsonResponse({ ok: true, months: months });
}

// ── CREDIT CARD STATEMENTS ───────────────────────────────────
// The statement closes on StatementDay each month. Returns the last closed statement
// (what the bank bills), payments made since it closed, and the current cycle so far.
function ymd(y, m, d) { var dim = new Date(y, m, 0).getDate(); return y + "-" + pad2(m) + "-" + pad2(Math.min(d, dim)); }
function shiftMonth(y, m, n) { m += n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return [y, m]; }
function dayAfter(s) {
  var d = new Date(Date.UTC(parseInt(s.substring(0, 4)), parseInt(s.substring(5, 7)) - 1, parseInt(s.substring(8, 10)) + 1));
  return d.toISOString().slice(0, 10);
}
function cardStatement(a, today, expRows, trfRows) {
  var ty = parseInt(today.substring(0, 4)), tm = parseInt(today.substring(5, 7)), S = a.statementDay;
  var lc = today > ymd(ty, tm, S) ? [ty, tm] : shiftMonth(ty, tm, -1);
  var lastClose = ymd(lc[0], lc[1], S);
  var pc = shiftMonth(lc[0], lc[1], -1), prevClose = ymd(pc[0], pc[1], S);
  var nc = shiftMonth(lc[0], lc[1], 1),  nextClose = ymd(nc[0], nc[1], S);
  var name = String(a.name || "").trim();
  function spend(from, to) {
    return round2(expRows.reduce(function(s, r) {
      return (r.account === name && r.date > from && r.date <= to) ? s + amtForAccount(a, r.amount, r.orig, r.cur) : s;
    }, 0));
  }
  var paid = round2(trfRows.reduce(function(s, r) {
    return (r.to === name && r.date > lastClose && r.date <= today) ? s + (r.received || r.amount) : s;
  }, 0));
  var lastSpend = spend(prevClose, lastClose);
  var due = "";
  if (a.dueDay) {
    due = ymd(lc[0], lc[1], a.dueDay);
    if (due <= lastClose) { var dm = shiftMonth(lc[0], lc[1], 1); due = ymd(dm[0], dm[1], a.dueDay); }
  }
  return {
    lastStart: dayAfter(prevClose), lastEnd: lastClose, lastSpend: lastSpend,
    paidSince: paid, leftToPay: Math.max(0, round2(lastSpend - paid)), dueDate: due,
    curStart: dayAfter(lastClose), curEnd: nextClose, curSpend: spend(lastClose, today)
  };
}

// ── SEARCH (all months) ──────────────────────────────────────
function searchTransactions(p) {
  var q = cleanName(p.q).toLowerCase();
  if (q.length < 2) return jsonResponse({ ok: true, transactions: [], total: 0 });
  var out = [];
  function hit(parts) { return parts.join(" ").toLowerCase().indexOf(q) >= 0; }
  sheetToRows(getSheet(SHEET.EXPENSES), function(d, ri) {
    return { rowIndex: ri, type: "expense", date: formatDate(d[0]), amount: toFloat(d[1]),
      category: cleanName(d[2]), note: String(d[3] || ""), account: String(d[4] || ""),
      isRecurring: toBool(d[5]), recurrencePeriod: d[6] || "", projectId: d[7] || "",
      origAmount: toFloat(d[8]) || 0, currency: d[9] || "", id: String(d[10] || "") };
  }).forEach(function(r) { if (hit([r.category, r.note, r.account, r.projectId, r.amount])) out.push(r); });
  sheetToRows(getSheet(SHEET.INCOME), function(d, ri) {
    return { rowIndex: ri, type: "income", date: formatDate(d[0]), amount: toFloat(d[1]),
      category: cleanName(d[2]), note: String(d[3] || ""), account: String(d[4] || ""),
      origAmount: toFloat(d[5]) || 0, currency: d[6] || "", id: String(d[7] || "") };
  }).forEach(function(r) { if (hit([r.category, r.note, r.account, r.amount])) out.push(r); });
  sheetToRows(getSheet(SHEET.TRANSFERS), function(d, ri) {
    return { rowIndex: ri, type: "transfer", date: formatDate(d[0]), amount: toFloat(d[1]),
      fromAccount: String(d[2] || ""), toAccount: String(d[3] || ""), note: String(d[4] || ""),
      receivedAmount: toFloat(d[5]) || 0, id: String(d[6] || "") };
  }).forEach(function(r) { if (hit([r.fromAccount, r.toAccount, r.note, r.amount])) out.push(r); });
  out.sort(function(a, b) { return b.date.localeCompare(a.date); });
  return jsonResponse({ ok: true, transactions: out.slice(0, 200), total: out.length });
}

