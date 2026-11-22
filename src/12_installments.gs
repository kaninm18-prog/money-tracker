// ── INSTALLMENT PLANS ────────────────────────────────────────

function getInstallmentPlans() {
  var sh = getSheet(SHEET.INSTALLMENTS);
  var plans = sheetToRows(sh, function(d, ri) {
    var count  = parseInt(d[4]) || 0;
    var paid   = parseInt(d[11]) || 0;
    var instAmt = toFloat(d[5]);
    var firstDate = formatDate(d[6]);
    var nextDate  = (paid < count && firstDate) ? addMonths(firstDate, paid) : '';
    return {
      rowIndex: ri,
      description: d[0], purchaseDate: formatDate(d[1]),
      merchant: d[2], totalAmount: toFloat(d[3]),
      installmentCount: count, installmentAmount: instAmt,
      firstInstallmentDate: firstDate,
      account: d[7], category: d[8],
      projectId: d[9] || '', status: d[10] || 'active',
      installmentsPaid: paid,
      remaining: Math.max(0, count - paid),
      remainingAmount: Math.round(instAmt * Math.max(0, count - paid) * 100) / 100,
      nextInstallmentDate: nextDate
    };
  });
  return jsonResponse({ ok: true, installmentPlans: plans });
}

function addInstallmentPlan(p) {
  var sh    = getSheet(SHEET.INSTALLMENTS);
  var count = parseInt(p.installmentCount) || 1;
  var total = toFloat(p.totalAmount);
  var instAmt = Math.round(total / count * 100) / 100;
  sh.appendRow([
    p.description || '', p.purchaseDate || todayStr(),
    p.merchant || '', total, count, instAmt,
    p.firstInstallmentDate || todayStr(),
    p.account || '', cleanName(p.category),
    p.projectId || '', 'active', 0
  ]);
  return jsonResponse({ ok: true, rowIndex: sh.getLastRow() });
}

function updateInstallmentPlan(p) {
  var sh  = getSheet(SHEET.INSTALLMENTS);
  var row = resolveByKey(SHEET.INSTALLMENTS, p);
  if (!row) return staleResponse();
  var count   = parseInt(p.installmentCount) || 1;
  var total   = toFloat(p.totalAmount);
  var instAmt = Math.round(total / count * 100) / 100;
  sh.getRange(row, 1, 1, 12).setValues([[
    p.description || '', p.purchaseDate || '', p.merchant || '',
    total, count, instAmt, p.firstInstallmentDate || '',
    p.account || '', cleanName(p.category), p.projectId || '',
    p.status || 'active', parseInt(p.installmentsPaid) || 0
  ]]);
  return jsonResponse({ ok: true });
}

function deleteInstallmentPlan(p) {
  var sh  = getSheet(SHEET.INSTALLMENTS);
  var row = resolveByKey(SHEET.INSTALLMENTS, p);
  if (!row) return staleResponse();
  sh.deleteRow(row);
  return jsonResponse({ ok: true });
}

// Auto-generates expense rows for any installments that are due and not yet recorded
function checkInstallments() {
  var sh     = getSheet(SHEET.INSTALLMENTS);
  var expSh  = getSheet(SHEET.EXPENSES);
  ensureRowIds(SHEET.EXPENSES);
  var today  = todayStr();
  var plans  = sheetToRows(sh, function(d, ri) {
    return {
      rowIndex: ri, description: d[0],
      installmentCount: parseInt(d[4]) || 0,
      installmentAmount: toFloat(d[5]),
      firstInstallmentDate: formatDate(d[6]),
      account: d[7], category: d[8],
      projectId: d[9] || '', status: d[10] || 'active',
      installmentsPaid: parseInt(d[11]) || 0
    };
  });
  var generated = 0;
  plans.forEach(function(plan) {
    if (plan.status !== 'active') return;
    if (!plan.firstInstallmentDate || plan.installmentCount === 0) return;
    // Count how many installments are due by today
    var dueSoFar = 0;
    for (var n = 0; n < plan.installmentCount; n++) {
      var dueDate = addMonths(plan.firstInstallmentDate, n);
      if (dueDate <= today) dueSoFar++;
      else break;
    }
    var toGenerate = dueSoFar - plan.installmentsPaid;
    if (toGenerate <= 0) return;
    // Generate missing installment expense rows
    for (var i = 0; i < toGenerate; i++) {
      var instNum  = plan.installmentsPaid + i + 1;
      var instDate = addMonths(plan.firstInstallmentDate, plan.installmentsPaid + i);
      var note     = '[Inst ' + instNum + '/' + plan.installmentCount + '] ' + plan.description;
      expSh.appendRow([
        instDate, plan.installmentAmount,
        plan.category || 'Shopping', note,
        plan.account || '', 'FALSE', '', plan.projectId || '', '', '', newId('E')
      ]);
      generated++;
    }
    var newPaid = plan.installmentsPaid + toGenerate;
    sh.getRange(plan.rowIndex, 12, 1, 1).setValue(newPaid);
    if (newPaid >= plan.installmentCount) {
      sh.getRange(plan.rowIndex, 11, 1, 1).setValue('completed');
    }
  });
  return jsonResponse({ ok: true, generated: generated });
}

function markInstallmentPaid(p) {
  var sh    = getSheet(SHEET.INSTALLMENTS);
  var expSh = getSheet(SHEET.EXPENSES);
  ensureRowIds(SHEET.EXPENSES);
  var row   = resolveByKey(SHEET.INSTALLMENTS, p);
  if (!row) return staleResponse();

  var data  = sh.getRange(row, 1, 1, 12).getValues()[0];
  var plan  = {
    description:          data[0],
    installmentCount:     parseInt(data[4]) || 0,
    installmentAmount:    toFloat(data[5]),
    firstInstallmentDate: formatDate(data[6]),
    account:              data[7],
    category:             data[8],
    projectId:            data[9] || '',
    status:               data[10] || 'active',
    installmentsPaid:     parseInt(data[11]) || 0
  };

  if (plan.status !== 'active') return jsonResponse({ ok: false, error: 'Plan is not active' });
  if (plan.installmentsPaid >= plan.installmentCount) return jsonResponse({ ok: false, error: 'All installments already paid' });

  var instNum  = plan.installmentsPaid + 1;
  var instDate = addMonths(plan.firstInstallmentDate, plan.installmentsPaid);
  var note     = '[Inst ' + instNum + '/' + plan.installmentCount + '] ' + plan.description;
  expSh.appendRow([
    instDate, plan.installmentAmount,
    plan.category || 'Shopping', note,
    plan.account || '', 'FALSE', '', plan.projectId || '', '', '', newId('E')
  ]);

  var newPaid = plan.installmentsPaid + 1;
  sh.getRange(row, 12, 1, 1).setValue(newPaid);
  if (newPaid >= plan.installmentCount) {
    sh.getRange(row, 11, 1, 1).setValue('completed');
  }
  return jsonResponse({ ok: true, instNum: instNum, instDate: instDate });
}

