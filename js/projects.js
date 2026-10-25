// Money Tracker — Projects, receivables, installment plans and budgets.
// Loaded as a plain <script> (not a module): functions are global so onclick="..." handlers work.

// ════════════════════════════════════════════
//  PROJECTS PAGE
// ════════════════════════════════════════════
function setProjectsTab(tab) {
  activeProjectsTab = tab;
  ['projects','receivables','installments','budget'].forEach(function(t){
    document.getElementById('proj-tab-'+t).classList.toggle('active', t===tab);
    document.getElementById('proj-panel-'+t).style.display = t===tab ? 'block' : 'none';
  });
}

function renderProjectsPage() {
  var html = '';
  if (!projects.length) {
    html = '<div class="empty"><div class="empty-icon">📁</div><p>No projects yet.<br>Use projects to track trip or event costs separately from monthly expenses.</p></div>';
  } else {
    projects.forEach(function(p) {
      var pct = p.budget > 0 ? Math.min(100, Math.round(p.spent/p.budget*100)) : 0;
      var over = p.budget > 0 && p.spent > p.budget;
      var dateRange = (p.startDate ? fmtDate(p.startDate) : '') + (p.endDate ? ' – '+fmtDate(p.endDate) : '');
      html += '<div class="project-card">' +
        '<div class="project-card-header">' +
          '<div><div class="project-card-name">📁 '+p.name+'</div><div class="project-card-dates">'+dateRange+'</div></div>' +
          '<div class="project-card-amount"><div class="project-card-spent">'+fmtMoney(p.spent)+'</div>' +
            (p.budget ? '<div class="project-card-budget">of '+fmtMoney(p.budget)+'</div>' : '') +
          '</div>' +
        '</div>' +
        (p.budget ? '<div class="project-progress-wrap"><div class="project-progress-bar'+(over?' over':'')+'" style="width:'+pct+'%"></div></div>' : '') +
        '<div class="project-actions">' +
          '<button class="acc-edit-btn" onclick="openEditProject('+p.rowIndex+')">✏️ Edit</button>' +
          '<button class="acc-del-btn" onclick="deleteProject('+p.rowIndex+',\''+escQ(p.name)+'\')">🗑️ Delete</button>' +
        '</div>' +
      '</div>';
    });
  }
  document.getElementById('projects-list').innerHTML = html;
}

function openAddProject() {
  editingProjectRow = null;
  document.getElementById('project-modal-title').textContent = 'New Project';
  document.getElementById('save-project-btn').textContent = 'Create Project';
  document.getElementById('fp-name').value  = '';
  document.getElementById('fp-budget').value = '';
  document.getElementById('fp-start').value = todayStr();
  document.getElementById('fp-end').value   = '';
  openModal('project-modal');
}

function openEditProject(rowIndex) {
  var p = projects.find(function(x){ return x.rowIndex===rowIndex; });
  if (!p) return;
  editingProjectRow = rowIndex;
  editingProjectKey = p.name;
  document.getElementById('project-modal-title').textContent = 'Edit Project';
  document.getElementById('save-project-btn').textContent = 'Save Changes';
  document.getElementById('fp-name').value   = p.name;
  document.getElementById('fp-budget').value = p.budget || '';
  document.getElementById('fp-start').value  = p.startDate || '';
  document.getElementById('fp-end').value    = p.endDate || '';
  openModal('project-modal');
}

function saveProject() {
  var name = document.getElementById('fp-name').value.trim();
  if (!name) { toast('Enter a project name'); return; }
  var payload = {
    name: name,
    budget:    parseFloat(document.getElementById('fp-budget').value) || 0,
    startDate: document.getElementById('fp-start').value,
    endDate:   document.getElementById('fp-end').value
  };
  if (editingProjectRow) { payload.action='updateProject'; payload.rowIndex=editingProjectRow; payload.key=editingProjectKey; }
  else { payload.action='addProject'; }
  document.getElementById('save-project-btn').textContent = 'Saving…';
  api(payload).then(function(res) {
    if (res.ok) {
      closeModal('project-modal');
      toast(editingProjectRow ? 'Project updated!' : 'Project created!');
      api({action:'getProjects'}).then(function(r){ if(r.ok){ projects=r.projects; renderProjectsPage(); populateProjectDropdown(); } });
    } else { toast('Error: '+res.error); }
    document.getElementById('save-project-btn').textContent = editingProjectRow ? 'Save Changes' : 'Create Project';
  });
}

function deleteProject(rowIndex, name) {
  if (!confirm('Delete project "'+name+'"?\nExpenses logged to this project will remain but lose their project tag.')) return;
  api({action:'deleteProject', rowIndex:rowIndex, key:name}).then(function(res){
    if (res.ok) { toast('Deleted'); api({action:'getProjects'}).then(function(r){ if(r.ok){ projects=r.projects; renderProjectsPage(); populateProjectDropdown(); } }); }
    else { toast('Error: '+res.error); }
  });
}

function populateProjectDropdown() {
  var opts = '<option value="">— No project (regular expense) —</option>';
  projects.forEach(function(p){ opts += '<option value="'+escQ(p.name)+'">📁 '+p.name+'</option>'; });
  var sel = document.getElementById('fe-project');
  if (sel) sel.innerHTML = opts;
}

// ════════════════════════════════════════════
//  RECEIVABLES
// ════════════════════════════════════════════
var activeRecvFilter = 'pending';

function setRecvTab(tab) {
  activeRecvFilter = tab;
  ['pending','settled'].forEach(function(t){
    document.getElementById('recv-tab-'+t).classList.toggle('active', t===tab);
  });
  renderReceivables();
}

function recvNums(r) {
  var returned = r.returned !== undefined ? r.returned : (r.status === 'settled' ? r.amount : 0);
  var left = r.left !== undefined ? r.left : (r.status === 'settled' ? 0 : r.amount);
  return { returned: returned, left: left, pct: r.amount ? Math.min(100, Math.round(returned / r.amount * 100)) : 0 };
}

function renderReceivables() {
  var filtered = receivables.filter(function(r){ return r.status === activeRecvFilter; });
  var html = '';
  if (!filtered.length) {
    var emptyMsg = activeRecvFilter==='pending' ? 'No pending receivables 🎉' : 'No settled receivables yet';
    html = '<div class="empty"><div class="empty-icon">🤝</div><p>'+emptyMsg+'</p></div>';
  } else {
    var tAmt = 0, tRet = 0, tLeft = 0;
    filtered.forEach(function(r){ var n = recvNums(r); tAmt += r.amount; tRet += n.returned; tLeft += n.left; });
    html += '<div style="font-size:0.8rem;font-weight:700;color:var(--income-color);text-align:right;margin-bottom:8px">' +
      (activeRecvFilter==='pending'
        ? 'Left to receive: '+fmtMoney(tLeft)+' <span style="font-weight:500;color:var(--text2)">· returned '+fmtMoney(tRet)+' of '+fmtMoney(tAmt)+'</span>'
        : 'Total: '+fmtMoney(tAmt)) + '</div>';
    filtered.forEach(function(r) {
      // For advance: counterparty = who owes you. For work: reimbursedBy = who reimburses.
      var n = recvNums(r);
      var displayName = r.type === 'work' ? (r.reimbursedBy || '—') : (r.counterparty || '—');
      var subInfo = r.type === 'work'
        ? (r.counterparty ? 'Paid for: ' + r.counterparty : '')
        : (r.reimbursedBy ? 'Reimbursed by: ' + r.reimbursedBy : '');
      var acctInfo = r.account ? ' · ' + r.account : '';
      var reps = (r.repayments || []).slice().sort(function(a,b){ return (a.date||'').localeCompare(b.date||''); });
      var repHtml = reps.length ? '<div class="recv-reps">' + reps.map(function(rp){
        return '<div class="recv-rep"><span>'+fmtDate(rp.date)+'</span><span>'+(rp.account||'')+(rp.note?' · '+rp.note:'')+'</span>' +
          '<span class="rp-amt">+'+fmtMoney(rp.amount)+'</span>' +
          '<button title="Remove" onclick="deleteRepayment('+rp.rowIndex+')">✕</button></div>';
      }).join('') + '</div>' : '';
      var isPending = r.status === 'pending';
      html += '<div class="recv-item">' +
        '<div class="recv-icon">'+(r.type==='work'?'💼':'🤝')+'</div>' +
        '<div class="recv-info">' +
          '<div class="recv-counterparty">'+displayName+'</div>' +
          '<div class="recv-note">'+(r.note||'—')+'</div>' +
          '<div class="recv-meta">'+fmtDate(r.date)+(subInfo?' · '+subInfo:'')+acctInfo+'</div>' +
          '<div class="recv-progress"><div style="width:'+n.pct+'%"></div></div>' +
          '<div class="recv-nums"><span>Returned <b>'+fmtMoney(n.returned)+'</b></span><span>Left <b>'+fmtMoney(n.left)+'</b></span></div>' +
          repHtml +
          (!isPending ? '<div style="font-size:0.72rem;color:var(--text2);margin-top:4px">Settled '+fmtDate(r.settledDate)+'</div>' : '') +
          '<div class="recv-btn-row">' +
            (isPending ? '<button class="recv-settle-btn" onclick="openRepayment('+r.rowIndex+')">+ Repayment</button>' : '') +
            (isPending ? '<button class="recv-settle-btn" style="background:var(--text2)" onclick="settleReceivable('+r.rowIndex+')">✓ Settle rest</button>' : '') +
            '<button class="recv-settle-btn" style="background:var(--text2)" onclick="openEditReceivable('+r.rowIndex+')">✏️ Edit</button>' +
          '</div>' +
          '<button class="recv-del-btn" onclick="deleteReceivable('+r.rowIndex+')">🗑️ Delete</button>' +
        '</div>' +
        '<div class="recv-right"><div class="recv-amount">'+fmtMoney(isPending ? n.left : r.amount)+'</div>' +
          (isPending && n.returned > 0 ? '<div style="font-size:0.68rem;color:var(--text2)">of '+fmtMoney(r.amount)+'</div>' : '') +
          '<div class="recv-status '+r.status+'">'+r.status+'</div></div>' +
      '</div>';
    });
  }
  document.getElementById('receivables-list').innerHTML = html;
}

var repayingRow = null;
function openRepayment(rowIndex) {
  var r = receivables.find(function(x){ return x.rowIndex === rowIndex; });
  if (!r) return;
  repayingRow = r;
  var n = recvNums(r);
  document.getElementById('rp-summary').textContent = (r.counterparty || r.reimbursedBy || 'Receivable') + ' — returned ' + fmtMoney(n.returned) + ' of ' + fmtMoney(r.amount) + ', left ' + fmtMoney(n.left);
  document.getElementById('rp-amount').value = n.left;
  var sel = document.getElementById('rp-account');
  sel.innerHTML = sortedAccounts().map(function(a){ return '<option value="'+escQ(a.name)+'">'+acctIcon(a.type)+' '+a.name+'</option>'; }).join('');
  sel.value = r.account || (accounts[0] ? accounts[0].name : '');
  document.getElementById('rp-date').value = todayStr();
  document.getElementById('rp-note').value = '';
  openModal('repay-modal');
  setTimeout(function(){ document.getElementById('rp-amount').focus(); }, 300);
}

function saveRepayment() {
  if (!repayingRow) return;
  var n = recvNums(repayingRow);
  var amount = parseFloat(document.getElementById('rp-amount').value);
  if (!amount || amount <= 0) { toast('Enter a valid amount'); return; }
  if (amount > n.left + 0.005) { toast('More than what is left (' + fmtMoney(n.left) + ')'); return; }
  var payload = { action: 'addRepayment', receivableId: repayingRow.id, rowIndex: repayingRow.rowIndex, amount: amount,
    account: document.getElementById('rp-account').value, date: document.getElementById('rp-date').value || todayStr(),
    note: document.getElementById('rp-note').value.trim() };
  var btn = document.getElementById('save-rp-btn'); btn.textContent = 'Saving…';
  api(payload).then(function(res){
    btn.textContent = 'Save Repayment';
    if (res.ok) { closeModal('repay-modal'); toast(res.settled ? 'Fully repaid — settled ✓' : 'Repayment saved'); loadAll(); }
    else { toast(/Unknown action/i.test(res.error||'') ? 'Update Code.gs in Apps Script and redeploy first' : 'Error: '+(res.error||'?')); }
  }).catch(function(){ btn.textContent = 'Save Repayment'; toast('Connection error'); });
}

function deleteRepayment(rowIndex) {
  if (!confirm('Remove this repayment?')) return;
  api({action:'deleteRepayment', rowIndex:rowIndex, id:repaymentId(rowIndex)}).then(function(res){
    if (res.ok) { toast('Repayment removed'); loadAll(); }
    else { toast('Error: '+(res.error||'?')); }
  });
}

function openReceivableForm(rowIndex) {
  closeModal('chooser-modal');
  editingReceivableRow = rowIndex || null;
  document.getElementById('receivable-modal-title').textContent = rowIndex ? 'Edit Receivable' : 'Add Receivable';
  document.getElementById('save-recv-btn').textContent          = rowIndex ? 'Update Receivable' : 'Save Receivable';
  document.getElementById('delete-recv-btn').style.display      = rowIndex ? 'block' : 'none';
  // Populate account dropdown
  var acctSel = document.getElementById('fr-recv-account');
  acctSel.innerHTML = '<option value="">— Select account —</option>';
  sortedAccounts().forEach(function(a){ acctSel.innerHTML += '<option value="'+a.name+'">'+acctIcon(a.type)+' '+a.name+'</option>'; });
  if (rowIndex) {
    var r = receivables.find(function(x){ return x.rowIndex===rowIndex; });
    if (r) {
      document.getElementById('fr-amount').value       = r.amount;
      document.getElementById('fr-counterparty').value = r.counterparty || '';
      document.getElementById('fr-reimbursedby').value = r.reimbursedBy || 'PTTEP';
      document.getElementById('fr-note').value         = r.note || '';
      document.getElementById('fr-date').value         = r.date || todayStr();
      acctSel.value = r.account || '';
      var isWork = r.type === 'work';
      document.querySelectorAll('#recv-type-grid .acct-option').forEach(function(el,i){ el.classList.toggle('selected', isWork ? i===1 : i===0); });
      document.getElementById('fr-counterparty-group').style.display = isWork ? 'none' : 'block';
      document.getElementById('fr-reimb-group').style.display        = isWork ? 'block' : 'none';
    }
  } else {
    document.getElementById('fr-amount').value       = '';
    document.getElementById('fr-counterparty').value = '';
    document.getElementById('fr-reimbursedby').value = 'PTTEP';
    document.getElementById('fr-note').value         = '';
    document.getElementById('fr-date').value         = todayStr();
    acctSel.value = '';
    document.querySelectorAll('#recv-type-grid .acct-option').forEach(function(el,i){ el.classList.toggle('selected',i===0); });
    document.getElementById('fr-counterparty-group').style.display = 'block';
    document.getElementById('fr-reimb-group').style.display = 'none';
  }
  openModal('receivable-modal');
}

function openEditReceivable(rowIndex) { openReceivableForm(rowIndex); }

function selectRecvType(el, type) {
  document.querySelectorAll('#recv-type-grid .acct-option').forEach(function(x){ x.classList.remove('selected'); });
  el.classList.add('selected');
  document.getElementById('fr-counterparty-group').style.display = type==='advance' ? 'block' : 'none';
  document.getElementById('fr-reimb-group').style.display        = type==='work'    ? 'block' : 'none';
}

function saveReceivable() {
  var amount = parseFloat(document.getElementById('fr-amount').value);
  if (!amount || amount<=0) { toast('Enter a valid amount'); return; }
  var typeEls = document.querySelectorAll('#recv-type-grid .acct-option.selected');
  var type = typeEls.length ? (typeEls[0].textContent.includes('Work') ? 'work' : 'advance') : 'advance';
  var account = document.getElementById('fr-recv-account').value;
  // Only send the field relevant to each type; clear the other
  var counterparty = type === 'advance' ? document.getElementById('fr-counterparty').value.trim() : '';
  var reimbursedBy = type === 'work'    ? document.getElementById('fr-reimbursedby').value.trim() : '';
  var payload = {
    action: editingReceivableRow ? 'updateReceivable' : 'addReceivable',
    amount: amount, type: type,
    counterparty: counterparty,
    reimbursedBy: reimbursedBy,
    note: document.getElementById('fr-note').value.trim(),
    date: document.getElementById('fr-date').value || todayStr(),
    account: account
  };
  if (editingReceivableRow) { payload.rowIndex = editingReceivableRow; var rv0 = recvById(editingReceivableRow); payload.id = rv0 ? rv0.id : ''; }
  document.getElementById('save-recv-btn').textContent = 'Saving…';
  api(payload).then(function(res){
    if (res.ok) {
      closeModal('receivable-modal');
      toast(editingReceivableRow ? 'Updated!' : 'Receivable saved!');
      // Refresh receivables + accounts (balance affected by pending receivable)
      Promise.all([
        api({action:'getReceivables'}),
        api({action:'getAccounts'})
      ]).then(function(results){
        if (results[0].ok) { receivables = results[0].receivables; renderReceivables(); }
        if (results[1].ok) { accounts = results[1].accounts; totalBalance = results[1].totalBalance; renderAccountCards(); renderAccountsPage(); }
      });
    } else { toast('Error: '+res.error); }
    document.getElementById('save-recv-btn').textContent = editingReceivableRow ? 'Update Receivable' : 'Save Receivable';
  });
}

function deleteCurrentReceivable() {
  if (!editingReceivableRow || !confirm('Delete this receivable?')) return;
  api({action:'deleteReceivable', rowIndex:editingReceivableRow, id:(recvById(editingReceivableRow)||{}).id||''}).then(function(res){
    if (res.ok) { closeModal('receivable-modal'); toast('Deleted'); api({action:'getReceivables'}).then(function(r){ if(r.ok){ receivables=r.receivables; renderReceivables(); } }); }
    else { toast('Error: '+res.error); }
  });
}

function settleReceivable(rowIndex) {
  var r = receivables.find(function(x){ return x.rowIndex === rowIndex; });
  var n = r ? recvNums(r) : null;
  var msg = n && n.returned > 0
    ? 'Mark the remaining ' + fmtMoney(n.left) + ' as received' + (r.account ? ' into ' + r.account : '') + '?'
    : 'Mark this as settled (money received)?';
  if (!confirm(msg)) return;
  api({action:'settleReceivable', rowIndex:rowIndex, id: r ? r.id : '', settledDate:todayStr(), account: r ? r.account : ''}).then(function(res){
    if (res.ok) { toast('Marked as settled ✓'); loadAll(); }
    else { toast('Error: '+res.error); }
  });
}

function deleteReceivable(rowIndex) {
  if (!confirm('Delete this receivable?')) return;
  api({action:'deleteReceivable', rowIndex:rowIndex, id:(recvById(rowIndex)||{}).id||''}).then(function(res){
    if (res.ok) { toast('Deleted'); api({action:'getReceivables'}).then(function(r){ if(r.ok){ receivables=r.receivables; renderReceivables(); } }); }
    else { toast('Error: '+res.error); }
  });
}

// ════════════════════════════════════════════
//  INSTALLMENT PLANS
// ════════════════════════════════════════════
function renderInstallments() {
  var active = installmentPlans.filter(function(p){ return p.status === 'active'; });
  var totalMonthly = active.reduce(function(s,p){ return s + (p.installmentAmount||0); }, 0);

  var summaryEl = document.getElementById('installments-summary');
  if (summaryEl) {
    if (active.length) {
      summaryEl.style.display = 'flex';
      summaryEl.innerHTML =
        '<div><div class="inst-summary-label">Active Plans</div><div class="inst-summary-val">'+active.length+'</div></div>' +
        '<div style="text-align:right"><div class="inst-summary-label">Monthly Commitment</div><div class="inst-summary-val">'+fmtMoney(totalMonthly)+'</div></div>';
    } else {
      summaryEl.style.display = 'none';
    }
  }

  var html = '';
  if (!installmentPlans.length) {
    html = '<div class="empty"><div class="empty-icon">📅</div><p>No installment plans yet.<br>Add a plan to track monthly payments.</p></div>';
  } else {
    var today = todayStr();
    installmentPlans.forEach(function(p) {
      var paid    = p.installmentsPaid || 0;
      var total   = p.installmentCount || 1;
      var pct     = Math.min(100, Math.round(paid / total * 100));
      var remaining = p.remainingAmount || 0;
      var statusCls = p.status || 'active';
      var nextDate  = p.nextInstallmentDate || '';

      // A payment is due (or overdue) if next date exists and is <= today
      var paymentDue = statusCls === 'active' && nextDate && nextDate <= today;
      // Status label for the due-payment row
      var dueLabel = paymentDue
        ? '<span style="color:var(--expense-color);font-weight:600">⚠️ Inst '+(paid+1)+'/'+total+' due '+fmtDate(nextDate)+'</span>'
        : (nextDate ? '<span style="color:var(--income-color)">✅ Up to date · Next: '+fmtDate(nextDate)+'</span>' : '');

      html += '<div class="inst-card '+(statusCls==='cancelled'?'cancelled':statusCls==='completed'?'completed':'')+'">'+
        '<div class="inst-card-header">'+
          '<div><div class="inst-card-desc">'+escQ(p.description||'')+'</div>'+(p.merchant?'<div class="inst-card-merchant">'+escQ(p.merchant)+'</div>':'')+
          '</div>'+
          '<span class="inst-badge '+statusCls+'">'+statusCls+'</span>'+
        '</div>'+
        '<div class="inst-detail-row"><span>Monthly</span><span>'+fmtMoney(p.installmentAmount)+'</span></div>'+
        '<div class="inst-detail-row"><span>Progress</span><span>'+paid+' / '+total+' paid</span></div>'+
        '<div class="inst-detail-row"><span>Remaining</span><span>'+fmtMoney(remaining)+'</span></div>'+
        (p.account?'<div class="inst-detail-row"><span>Account</span><span>'+escQ(p.account)+'</span></div>':'')+
        (dueLabel?'<div class="inst-detail-row" style="margin-top:4px">'+dueLabel+'</div>':'')+
        '<div class="inst-progress"><div class="inst-progress-bar'+(statusCls==='completed'?' done':'')+'" style="width:'+pct+'%"></div></div>'+
        (statusCls==='active'?
          '<div class="inst-actions">'+
            (paymentDue ? '<button class="btn btn-primary" style="font-size:0.82rem;padding:7px 12px" onclick="markInstallmentPaid('+p.rowIndex+')">✓ Mark Inst '+(paid+1)+' Paid</button>' : '')+
            '<button class="acc-edit-btn" onclick="openAddInstallmentPlan('+p.rowIndex+')">✏️ Edit</button>'+
            '<button class="acc-edit-btn" onclick="cancelInstallmentPlan('+p.rowIndex+')">Cancel Plan</button>'+
          '</div>' : '')+
      '</div>';
    });
  }
  var listEl = document.getElementById('installments-list');
  if (listEl) listEl.innerHTML = html;
}

function openAddInstallmentPlan(rowIndex) {
  editingInstallmentRow = rowIndex || null;
  document.getElementById('installment-modal-title').textContent = rowIndex ? 'Edit Installment Plan' : 'Add Installment Plan';
  document.getElementById('save-installment-btn').textContent    = rowIndex ? 'Update Plan' : 'Add Plan';
  document.getElementById('delete-installment-btn').style.display = rowIndex ? 'block' : 'none';
  if (rowIndex) {
    var p = installmentPlans.find(function(x){ return x.rowIndex===rowIndex; });
    if (p) {
      document.getElementById('fin-desc').value          = p.description || '';
      document.getElementById('fin-merchant').value      = p.merchant || '';
      document.getElementById('fin-purchase-date').value = p.purchaseDate || todayStr();
      document.getElementById('fin-total').value         = p.totalAmount || '';
      document.getElementById('fin-months').value        = p.installmentCount || '';
      document.getElementById('fin-first-date').value    = p.firstInstallmentDate || todayStr();
      document.getElementById('fin-preview').style.display = 'block';
      document.getElementById('fin-preview').textContent = fmtMoney(p.installmentAmount) + ' per month for ' + p.installmentCount + ' months';
    }
  } else {
    document.getElementById('fin-desc').value = '';
    document.getElementById('fin-merchant').value = '';
    document.getElementById('fin-purchase-date').value = todayStr();
    document.getElementById('fin-total').value = '';
    document.getElementById('fin-months').value = '';
    document.getElementById('fin-first-date').value = todayStr();
    document.getElementById('fin-preview').style.display = 'none';
  }

  // Populate account dropdown
  var acctOpts = sortedAccounts().map(function(a){ return '<option value="'+escQ(a.name)+'">'+acctIcon(a.type)+' '+a.name+'</option>'; }).join('');
  document.getElementById('fin-account').innerHTML = acctOpts || '<option value="">No accounts</option>';

  // Populate category dropdown
  var catOpts = expCategories.map(function(c){ return '<option value="'+escQ(c.name)+'">'+catIcon(c.name)+' '+c.name+'</option>'; }).join('');
  document.getElementById('fin-category').innerHTML = catOpts || '<option value="">No categories</option>';

  // Populate project dropdown
  var projOpts = '<option value="">— No project —</option>';
  projects.forEach(function(p){ projOpts += '<option value="'+escQ(p.name)+'">📁 '+p.name+'</option>'; });
  document.getElementById('fin-project').innerHTML = projOpts;

  openModal('installment-modal');
}

function updateInstallmentPreview() {
  var total = parseFloat(document.getElementById('fin-total').value) || 0;
  var months = parseInt(document.getElementById('fin-months').value) || 0;
  var previewEl = document.getElementById('fin-preview');
  if (total > 0 && months > 0) {
    var monthly = total / months;
    previewEl.textContent = fmtMoney(monthly) + ' per month for ' + months + ' months';
    previewEl.style.display = 'block';
  } else {
    previewEl.style.display = 'none';
  }
}

function saveInstallmentPlan() {
  var desc = document.getElementById('fin-desc').value.trim();
  var total = parseFloat(document.getElementById('fin-total').value);
  var months = parseInt(document.getElementById('fin-months').value);
  var firstDate = document.getElementById('fin-first-date').value;
  var acct = document.getElementById('fin-account').value;
  var cat = document.getElementById('fin-category').value;
  if (!desc) { toast('Enter a description'); return; }
  if (!total || total <= 0) { toast('Enter a valid total amount'); return; }
  if (!months || months < 1) { toast('Enter number of months'); return; }
  if (!firstDate) { toast('Select first installment date'); return; }

  var payload = {
    action: editingInstallmentRow ? 'updateInstallmentPlan' : 'addInstallmentPlan',
    description: desc,
    merchant: document.getElementById('fin-merchant').value.trim(),
    purchaseDate: document.getElementById('fin-purchase-date').value,
    totalAmount: total,
    installmentCount: months,
    installmentAmount: total / months,
    firstInstallmentDate: firstDate,
    account: acct,
    category: cat,
    projectId: document.getElementById('fin-project').value
  };
  if (editingInstallmentRow) {
    payload.rowIndex = editingInstallmentRow;
    var existing = installmentPlans.find(function(x){ return x.rowIndex===editingInstallmentRow; });
    payload.key = existing ? existing.description : '';
    payload.installmentsPaid = existing ? existing.installmentsPaid : 0;
    payload.status = existing ? existing.status : 'active';
  }

  document.getElementById('save-installment-btn').textContent = 'Saving…';
  api(payload).then(function(res){
    if (res.ok) {
      closeModal('installment-modal');
      toast(editingInstallmentRow ? 'Plan updated!' : 'Installment plan added!');
      api({action:'getInstallmentPlans'}).then(function(r){ if(r.ok){ installmentPlans=r.installmentPlans||[]; renderInstallments(); } });
    } else { toast('Error: '+(res.error||'?')); }
    document.getElementById('save-installment-btn').textContent = editingInstallmentRow ? 'Update Plan' : 'Add Plan';
  }).catch(function(){ toast('Connection error'); document.getElementById('save-installment-btn').textContent = 'Add Plan'; });
}

function cancelInstallmentPlan(rowIndex) {
  if (!confirm('Cancel this installment plan? History will be kept.')) return;
  var existing = installmentPlans.find(function(x){ return x.rowIndex===rowIndex; });
  if (!existing) return;
  api({action:'updateInstallmentPlan', rowIndex:rowIndex, key:existing.description, status:'cancelled', merchant:existing.merchant, purchaseDate:existing.purchaseDate, projectId:existing.projectId,
       description:existing.description, totalAmount:existing.totalAmount,
       installmentCount:existing.installmentCount, firstInstallmentDate:existing.firstInstallmentDate,
       account:existing.account, category:existing.category, installmentsPaid:existing.installmentsPaid
  }).then(function(res){
    if (res.ok) { toast('Plan cancelled'); api({action:'getInstallmentPlans'}).then(function(r){ if(r.ok){ installmentPlans=r.installmentPlans||[]; renderInstallments(); } }); }
    else { toast('Error: '+res.error); }
  });
}

function deleteCurrentInstallment() {
  if (!editingInstallmentRow || !confirm('Permanently delete this installment plan? This cannot be undone.')) return;
  var ex0 = installmentPlans.find(function(x){ return x.rowIndex===editingInstallmentRow; });
  api({action:'deleteInstallmentPlan', rowIndex:editingInstallmentRow, key: ex0 ? ex0.description : ''}).then(function(res){
    if (res.ok) { closeModal('installment-modal'); toast('Plan deleted'); api({action:'getInstallmentPlans'}).then(function(r){ if(r.ok){ installmentPlans=r.installmentPlans||[]; renderInstallments(); } }); }
    else { toast('Error: '+res.error); }
  });
}

function markInstallmentPaid(rowIndex) {
  if (!confirm('Record this month\'s installment payment as an expense now?')) return;
  var ip = installmentPlans.find(function(x){ return x.rowIndex===rowIndex; });
  api({action:'markInstallmentPaid', rowIndex:rowIndex, key: ip ? ip.description : ''}).then(function(res){
    if (res.ok) {
      toast('Installment ' + res.instNum + ' marked paid ✓');
      // Refresh installment list and accounts (balance changes)
      Promise.all([
        api({action:'getInstallmentPlans'}),
        api({action:'getAccounts'})
      ]).then(function(results){
        if (results[0].ok) { installmentPlans = results[0].installmentPlans||[]; renderInstallments(); }
        if (results[1].ok) { accounts = results[1].accounts; totalBalance = results[1].totalBalance; renderDashboard(); renderAccountCards(); renderAccountsPage(); }
      });
    } else { toast('Error: '+(res.error||'?')); }
  }).catch(function(){ toast('Connection error'); });
}

// ════════════════════════════════════════════
//  BUDGET PLANNER
// ════════════════════════════════════════════
function renderBudgetPlanner() {
  var totalLimit = budgets.reduce(function(s,b){ return s+(b.monthlyLimit||0); }, 0);
  var totalSpent = budgets.reduce(function(s,b){ return s+(b.spent||0); }, 0);
  var overviewEl = document.getElementById('budget-overview-card');
  if (overviewEl) {
    if (budgets.length) {
      var ovPct = totalLimit > 0 ? Math.round(totalSpent/totalLimit*100) : 0;
      overviewEl.innerHTML = '<div class="budget-overview">' +
        '<div class="budget-overview-title">Total Budget Overview</div>' +
        '<div class="budget-overview-row">' +
          '<div><div class="budget-overview-spent">'+fmtMoney(totalSpent)+'</div><div class="budget-overview-limit">of '+fmtMoney(totalLimit)+' limit</div></div>' +
          '<div class="budget-overview-pct">'+ovPct+'%</div>' +
        '</div>' +
      '</div>';
    } else {
      overviewEl.innerHTML = '';
    }
  }

  var html = '';
  if (!budgets.length) {
    html = '<div class="empty"><div class="empty-icon">📊</div><p>No budgets set yet.<br>Set a monthly limit for each category.</p></div>';
  } else {
    budgets.forEach(function(b) {
      var pct = b.monthlyLimit > 0 ? Math.min(100, Math.round((b.spent||0)/b.monthlyLimit*100)) : 0;
      var alertPct = Math.round((b.alertThreshold||0.8)*100);
      var barCls = pct >= 90 ? 'red' : pct >= alertPct ? 'amber' : '';
      html += '<div class="budget-item">' +
        '<div class="budget-item-header">' +
          '<div class="budget-item-icon">'+catIcon(b.category)+'</div>' +
          '<div class="budget-item-name">'+escQ(b.category)+'</div>' +
          '<div class="budget-item-pct" style="color:'+(pct>=90?'var(--expense-color)':pct>=alertPct?'var(--transfer-color)':'var(--income-color)')+'">'+pct+'%</div>' +
        '</div>' +
        '<div class="budget-bar-wrap"><div class="budget-bar '+barCls+'" style="width:'+pct+'%"></div></div>' +
        '<div class="budget-item-footer"><span>'+fmtMoney(b.spent||0)+' spent</span><span>Limit: '+fmtMoney(b.monthlyLimit)+'</span></div>' +
        '<div class="budget-item-actions">' +
          '<button class="acc-edit-btn" onclick="openSetBudget(\''+escQ(b.category)+'\','+b.monthlyLimit+','+alertPct+','+(b.appliesToProjects?1:0)+','+b.rowIndex+')">✏️ Edit</button>' +
          '<button class="acc-del-btn" onclick="deleteBudget('+b.rowIndex+',\''+escQ(b.category)+'\')">🗑️ Delete</button>' +
        '</div>' +
      '</div>';
    });
  }
  var listEl = document.getElementById('budget-list');
  if (listEl) listEl.innerHTML = html;
}

function openSetBudget(category, limit, threshold, includeProjects, rowIndex) {
  document.getElementById('budget-modal').dataset.rowIndex = rowIndex || '';
  document.getElementById('budget-modal').dataset.key = rowIndex ? (category || '') : '';

  // Populate category dropdown
  var catOpts = expCategories.map(function(c){ return '<option value="'+escQ(c.name)+'">'+catIcon(c.name)+' '+c.name+'</option>'; }).join('');
  document.getElementById('fb-category').innerHTML = catOpts || '<option value="">No categories</option>';
  if (category) {
    document.getElementById('fb-category').value = category;
    document.getElementById('budget-modal-title').textContent = 'Edit Budget';
  } else {
    document.getElementById('budget-modal-title').textContent = 'Set Budget';
  }
  document.getElementById('fb-limit').value = limit || '';
  document.getElementById('fb-threshold').value = threshold || 80;
  document.getElementById('fb-include-projects').checked = !!includeProjects;
  openModal('budget-modal');
}

function saveBudget() {
  var category = document.getElementById('fb-category').value;
  var limit = parseFloat(document.getElementById('fb-limit').value);
  if (!category) { toast('Select a category'); return; }
  if (!limit || limit <= 0) { toast('Enter a valid limit'); return; }
  var rowIndex = document.getElementById('budget-modal').dataset.rowIndex;
  var payload = {
    action: rowIndex ? 'setBudget' : 'setBudget',
    category: category,
    monthlyLimit: limit,
    alertThreshold: (parseFloat(document.getElementById('fb-threshold').value) || 80) / 100,
    appliesToProjects: document.getElementById('fb-include-projects').checked
  };
  if (rowIndex) { payload.rowIndex = parseInt(rowIndex); payload.key = document.getElementById('budget-modal').dataset.key || ''; }
  document.getElementById('save-budget-btn').textContent = 'Saving…';
  api(payload).then(function(res){
    if (res.ok) {
      closeModal('budget-modal');
      toast('Budget saved!');
      api({action:'getBudgets', month:viewMonth, year:viewYear}).then(function(r){ if(r.ok){ budgets=r.budgets||[]; renderBudgetPlanner(); } });
    } else { toast('Error: '+(res.error||'?')); }
    document.getElementById('save-budget-btn').textContent = 'Save Budget';
  }).catch(function(){ toast('Connection error'); document.getElementById('save-budget-btn').textContent = 'Save Budget'; });
}

function deleteBudget(rowIndex, category) {
  if (!confirm('Remove budget for "'+category+'"?')) return;
  api({action:'deleteBudget', rowIndex:rowIndex, key:category}).then(function(res){
    if (res.ok) { toast('Budget removed'); api({action:'getBudgets', month:viewMonth, year:viewYear}).then(function(r){ if(r.ok){ budgets=r.budgets||[]; renderBudgetPlanner(); } }); }
    else { toast('Error: '+res.error); }
  });
}

