// ── COMBINED ─────────────────────────────────────────────────

function getAllTransactions(p) {
  var m = p.month ? parseInt(p.month) : 0;
  var y = p.year  ? parseInt(p.year)  : 0;
  function inPeriod(dateStr) {
    if (!m || !y) return true;
    return dateMatchesMonth(dateStr, m, y);
  }
  var txns = [];
  sheetToRows(getSheet(SHEET.EXPENSES), function(d, ri) {
    return { rowIndex: ri, type: "expense", date: formatDate(d[0]), amount: toFloat(d[1]),
      category: d[2], note: d[3], account: d[4],
      isRecurring: toBool(d[5]), recurrencePeriod: d[6] || "", projectId: d[7] || "",
      origAmount: toFloat(d[8]) || 0, currency: d[9] || "", id: String(d[10] || "") };
  }).forEach(function(r){ if (inPeriod(r.date)) txns.push(r); });

  sheetToRows(getSheet(SHEET.INCOME), function(d, ri) {
    return { rowIndex: ri, type: "income", date: formatDate(d[0]), amount: toFloat(d[1]),
      category: d[2], note: d[3], account: d[4], origAmount: toFloat(d[5]) || 0, currency: d[6] || "", id: String(d[7] || "") };
  }).forEach(function(r){ if (inPeriod(r.date)) txns.push(r); });

  sheetToRows(getSheet(SHEET.TRANSFERS), function(d, ri) {
    return { rowIndex: ri, type: "transfer", date: formatDate(d[0]), amount: toFloat(d[1]),
      fromAccount: d[2], toAccount: d[3], note: d[4], receivedAmount: toFloat(d[5]) || 0, id: String(d[6] || "") };
  }).forEach(function(r){ if (inPeriod(r.date)) txns.push(r); });

  // Pending receivables: always included regardless of month filter
  // (they are ongoing obligations that affect account balance until settled)
  loadReceivables().forEach(function(rv) {
    if (rv.status === 'pending') {
      txns.push({ rowIndex: rv.rowIndex, id: rv.id, type: "receivable", date: rv.date, amount: rv.amount,
        counterparty: String(rv.counterparty||''), recvType: String(rv.type||'advance'),
        note: String(rv.note||''), reimbursedBy: String(rv.reimbursedBy||''),
        status: rv.status, account: rv.account, returned: rv.returned, left: rv.left });
    }
    rv.repayments.forEach(function(rp) {
      if (!inPeriod(rp.date)) return;
      txns.push({ rowIndex: rp.rowIndex, id: String(rp.id || ""), type: "repayment", date: rp.date, amount: rp.amount,
        counterparty: String(rv.counterparty||''), note: rp.note, account: rp.account || rv.account,
        receivableRow: rv.rowIndex });
    });
  });

  txns.sort(function(a,b){ return b.date.localeCompare(a.date); });
  return jsonResponse({ ok: true, transactions: txns });
}

function getSummary(p) {
  var m = parseInt(p.month), y = parseInt(p.year);
  function inMonth(dateStr) { return dateMatchesMonth(dateStr, m, y); }
  var totalExpense = 0, totalIncome = 0;
  sheetToRows(getSheet(SHEET.EXPENSES), function(d){ return { date: formatDate(d[0]), amount: toFloat(d[1]) }; })
    .forEach(function(r){ if (inMonth(r.date)) totalExpense += r.amount; });
  sheetToRows(getSheet(SHEET.INCOME), function(d){ return { date: formatDate(d[0]), amount: toFloat(d[1]) }; })
    .forEach(function(r){ if (inMonth(r.date)) totalIncome += r.amount; });
  return jsonResponse({ ok: true,
    totalExpense: Math.round(totalExpense*100)/100,
    totalIncome:  Math.round(totalIncome*100)/100,
    net:          Math.round((totalIncome-totalExpense)*100)/100 });
}

