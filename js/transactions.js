// Money Tracker — Transactions list and the expense / income / transfer forms (save, delete, duplicate check).
// Loaded as a plain <script> (not a module): functions are global so onclick="..." handlers work.

// ════════════════════════════════════════════
//  TRANSACTIONS PAGE
// ════════════════════════════════════════════
function setTypeTab(tab) {
  activeTypeTab = tab;
  ['all','income','expense','transfer'].forEach(function(t){
    document.getElementById('tab-'+t).classList.toggle('active', t===tab);
  });
  renderTransactions();
}

function renderFilterBar() {
  var html = '<div class="filter-chip active" id="fchip-all" onclick="setAcctFilter(\'all\')">All Accounts</div>';
  sortedAccounts().forEach(function(a){
    html += '<div class="filter-chip" id="fchip-'+encodeId(a.name)+'" onclick="setAcctFilter(\''+escQ(a.name)+'\')">'+acctIcon(a.type)+' '+a.name+'</div>';
  });
  document.getElementById('filter-bar').innerHTML = html;
  activeAcctFilter = 'all';
}
var activeAcctFilter = 'all';
function setAcctFilter(name) {
  activeAcctFilter = name;
  document.querySelectorAll('.filter-chip').forEach(function(el){ el.classList.remove('active'); });
  var chipId = name==='all' ? 'fchip-all' : 'fchip-'+encodeId(name);
  var el = document.getElementById(chipId);
  if (el) el.classList.add('active');
  renderTransactions();
}
function encodeId(s) { return s.replace(/[^a-zA-Z0-9]/g,'_'); }

function renderTransactions() {
  var query = (document.getElementById('search-input').value||'').toLowerCase();
  var global = searchAll && searchResults;
  var source = global ? searchResults.transactions : transactions;
  if (global) query = '';             // already matched on the server
  var filtered = source.filter(function(t) {
    if (activeTypeTab !== 'all' && t.type !== activeTypeTab) return false;
    if (activeAcctFilter !== 'all') {
      if (t.type==='transfer')   { if (t.fromAccount!==activeAcctFilter && t.toAccount!==activeAcctFilter) return false; }
      else if (t.type==='receivable') { if (t.account!==activeAcctFilter) return false; }
      else if (t.account !== activeAcctFilter) return false;
    }
    if (query) {
      var haystack = (t.category||'')+(t.note||'')+(t.account||'')+(t.fromAccount||'')+(t.toAccount||'');
      if (!haystack.toLowerCase().includes(query)) return false;
    }
    return true;
  });

  var html = '';
  if (!filtered.length) {
    html = '<div class="empty"><div class="empty-icon">🔍</div><p>No transactions found</p></div>';
  } else {
    // Group by date
    var byDate = {};
    filtered.forEach(function(t){ (byDate[t.date]=byDate[t.date]||[]).push(t); });
    Object.keys(byDate).sort(function(a,b){return b.localeCompare(a);}).forEach(function(date) {
      var dayInc = byDate[date].filter(function(t){return t.type==='income';}).reduce(function(s,t){return s+t.amount;},0);
      var dayExp = byDate[date].filter(function(t){return t.type==='expense';}).reduce(function(s,t){return s+t.amount;},0);
      var dayNet = dayInc - dayExp;
      html += '<div class="txn-date-header"><span>'+(global ? fmtDateY(date) : fmtDate(date))+'</span>' +
        '<span style="color:'+(dayNet>=0?'var(--income-color)':'var(--expense-color)')+'">'+fmtMoney(dayNet)+'</span></div>';
      byDate[date].forEach(function(t){ html += txnHtml(t); });
    });
  }
  if (global) {
    var tot = searchResults.total;
    html = '<div class="search-note">'+tot+' match'+(tot===1?'':'es')+' across all months'+(tot > searchResults.transactions.length ? ' · showing newest '+searchResults.transactions.length : '')+
      (filtered.length ? ' · total '+fmtMoney(filtered.filter(function(t){ return t.type==='expense'; }).reduce(function(a,t){ return a+t.amount; },0))+' spent' : '')+'</div>' + html;
  } else if (searchAll) {
    html = '<div class="search-note">Type at least 2 letters to search every month.</div>' + html;
  }
  document.getElementById('transactions-list').innerHTML = html;
}

// ── Search across all months ──
var searchAll = false, searchResults = null, searchTimer = null, searchSeq = 0;
function toggleSearchScope() {
  searchAll = !searchAll;
  var b = document.getElementById('search-scope');
  b.classList.toggle('on', searchAll);
  b.textContent = searchAll ? 'All months' : 'This month';
  onSearchInput();
}
function onSearchInput() {
  clearTimeout(searchTimer);
  var q = (document.getElementById('search-input').value || '').trim();
  if (!searchAll || q.length < 2) { searchResults = null; renderTransactions(); return; }
  searchTimer = setTimeout(function() {
    var seq = ++searchSeq;
    document.getElementById('transactions-list').innerHTML = '<div class="loading-wrap"><div class="spinner"></div></div>';
    api({action:'searchTransactions', q:q}).then(function(res) {
      if (seq !== searchSeq) return;
      if (res.ok) searchResults = res;
      else { searchResults = null; toast(/Unknown action/.test(res.error||'') ? 'Update Code.gs in Apps Script and redeploy first' : 'Error: '+(res.error||'?')); }
      renderTransactions();
    }).catch(function() { if (seq === searchSeq) { searchResults = null; renderTransactions(); toast('Searching all months needs a connection'); } });
  }, 350);
}

function txnHtml(t) {
  var icon, label, sublabel, amountStr, amountClass;
  if (t.type === 'expense') {
    icon = catIcon(t.category);
    label = (t.category||'Expense') +
      (t.isRecurring ? '<span class="recurring-badge">🔁 '+t.recurrencePeriod+'</span>' : '') +
      (t.projectId   ? '<span class="project-badge">📁 '+t.projectId+'</span>' : '');
    sublabel = (t.note||'—') + (t.account ? ' · '+t.account : '') + (t.origAmount && t.currency ? ' · '+fmtCur(t.origAmount, t.currency) : '');
    amountStr = '−'+fmtMoney(t.amount); amountClass = 'expense';
  } else if (t.type === 'income') {
    icon = catIcon(t.category); label = t.category||'Income';
    sublabel = (t.note||'—') + (t.account ? ' · '+t.account : '') + (t.origAmount && t.currency ? ' · '+fmtCur(t.origAmount, t.currency) : '');
    amountStr = '+'+fmtMoney(t.amount); amountClass = 'income';
  } else if (t.type === 'receivable') {
    var isWork = t.recvType === 'work';
    icon = isWork ? '💼' : '🤝';
    label = isWork ? 'Work Expense (Pending)' : 'Advance Payment (Pending)';
    var who = isWork ? (t.reimbursedBy || '—') : (t.counterparty || '—');
    sublabel = who + (t.note ? ' · '+t.note : '') + (t.account ? ' · '+t.account : '') +
      (t.returned > 0 ? ' · returned '+fmtMoney(t.returned)+', left '+fmtMoney(t.left) : '');
    amountStr = '−'+fmtMoney(t.amount); amountClass = 'receivable';
  } else if (t.type === 'holding') {
    var sell = t.holdingTxnType === 'sell';
    icon = sell ? '💹' : '📈'; label = (sell ? 'Sold ' : 'Bought ') + recEsc(t.holdingName);
    sublabel = (t.quantity ? fmtQty(t.quantity) + (t.unit ? ' ' + recEsc(t.unit) : '') + (t.price ? ' @ ' + fmtMoney(t.price) : '') : '') +
      (t.account ? ' · ' + recEsc(t.account) : ' · already owned') + (t.note ? ' · ' + recEsc(t.note) : '');
    amountStr = (sell ? '+' : '−') + fmtMoney(t.amount); amountClass = 'transfer';
  } else if (t.type === 'repayment') {
    icon = '🤝'; label = 'Repayment received';
    sublabel = (t.counterparty || '—') + (t.note ? ' · '+t.note : '') + (t.account ? ' · '+t.account : '');
    amountStr = '+'+fmtMoney(t.amount); amountClass = 'income';
  } else {
    icon = '↔️'; label = 'Transfer';
    var fcur = curOf(t.fromAccount), tcur = curOf(t.toAccount);
    sublabel = (t.fromAccount||'?')+' → '+(t.toAccount||'?') + (t.note ? ' · '+t.note : '') +
      (t.receivedAmount ? ' · received '+fmtCur(t.receivedAmount, tcur) : '');
    amountStr = fmtCur(t.amount, fcur); amountClass = 'transfer';
  }
  if (t.pending) label += '<span class="pending-badge">⏳ waiting to sync</span>';
  var onclickAttr = '';
  if (t.type==='expense')    onclickAttr = 'onclick="openEditExpense('+t.rowIndex+')"';
  else if (t.type==='income')     onclickAttr = 'onclick="openEditIncome('+t.rowIndex+')"';
  else if (t.type==='transfer')   onclickAttr = 'onclick="openEditTransfer('+t.rowIndex+')"';
  else if (t.type==='holding')    onclickAttr = 'onclick="openHolding(\''+escQ(t.holdingId)+'\')"';
  else if (t.type==='receivable') onclickAttr = 'onclick="openEditReceivable('+t.rowIndex+')"';
  else if (t.type==='repayment')  onclickAttr = 'onclick="showPage(\'projects\');setProjectsTab(\'receivables\')"';
  return '<div class="txn-item" '+onclickAttr+'>' +
    '<div class="txn-icon '+t.type+'">'+icon+'</div>' +
    '<div class="txn-info"><div class="txn-cat">'+label+'</div><div class="txn-sub">'+sublabel+'</div></div>' +
    '<div class="txn-right"><div class="txn-amount '+amountClass+'">'+amountStr+'</div><div class="txn-acct">'+fmtDate(t.date)+'</div></div>' +
  '</div>';
}

// ════════════════════════════════════════════
//  ADD / EDIT EXPENSE
// ════════════════════════════════════════════
function openAddChooser() { closeModal('chooser-modal'); openModal('chooser-modal'); }

function openExpenseForm(rowIndex) {
  closeModal('chooser-modal');
  editingExpenseRow = rowIndex || null;
  document.getElementById('expense-modal-title').textContent = rowIndex ? 'Edit Expense' : 'Add Expense';
  document.getElementById('save-expense-btn').textContent = rowIndex ? 'Update Expense' : 'Save Expense';
  document.getElementById('delete-expense-btn').style.display = rowIndex ? 'block' : 'none';

  if (rowIndex) {
    var t = findTxn('expense', rowIndex);
    document.getElementById('fe-amount').value = t ? fxEditValue(t) : '';
    editingFx = fxKeep(t);
    document.getElementById('fe-note').value   = t ? (t.note||'') : '';
    document.getElementById('fe-date').value   = t ? t.date : todayStr();
    renderCatGrid('fe-cat-grid', expCategories, t ? t.category : null);
    renderAcctList('fe-acct-list', t ? t.account : null);
    // repeat is set up when adding; existing repeats are managed in Settings → Recurring
    document.getElementById('fe-repeat-group').style.display = 'none';
    document.getElementById('fe-recurring').checked = t ? !!t.isRecurring : false;
    document.getElementById('fe-recurrence-period').value = t ? (t.recurrencePeriod||'monthly') : 'monthly';
    document.getElementById('fe-project').value = t ? (t.projectId||'') : '';
  } else {
    document.getElementById('fe-amount').value = '';
    editingFx = null;
    document.getElementById('fe-note').value   = '';
    document.getElementById('fe-date').value   = todayStr();
    document.getElementById('fe-repeat-group').style.display = '';
    document.getElementById('fe-recurring').checked = false;
    document.getElementById('fe-recurrence-period').value = 'monthly';
    document.getElementById('fe-recurring-sub').style.display = 'none';
    document.getElementById('fe-project').value = '';
    renderCatGrid('fe-cat-grid', expCategories, null);
    renderAcctList('fe-acct-list', null);
  }
  fxUpdate('fe');
  openModal('expense-modal');
  setTimeout(function(){ document.getElementById('fe-amount').focus(); }, 300);
}

function openEditExpense(rowIndex) { openExpenseForm(rowIndex); }

function saveExpense() {
  var amount = parseFloat(document.getElementById('fe-amount').value);
  if (!amount || amount<=0) { toast('Enter a valid amount'); return; }
  var cat  = getSelectedCat('fe-cat-grid');
  var acct = getSelectedAcct('fe-acct-list');
  if (!cat)  { toast('Select a category'); return; }
  if (!acct) { toast('Select an account'); return; }
  var note      = document.getElementById('fe-note').value.trim();
  var date      = document.getElementById('fe-date').value || todayStr();
  var recurring = document.getElementById('fe-recurring').checked;
  var recPeriod = document.getElementById('fe-recurrence-period').value;
  var projectId = document.getElementById('fe-project').value;
  var payload   = Object.assign({ category:cat, account:acct, note, date,
    isRecurring: recurring, recurrencePeriod: recurring ? recPeriod : '', projectId: projectId }, fxPayload(amount, acct));
  submitTxn('expense', payload, editingExpenseRow, 'expense-modal', 'save-expense-btn', ['Save Expense', 'Update Expense'], 'Expense added!',
    recurring && !editingExpenseRow ? function(){ createRepeatFrom(payload, recPeriod); } : null);
}

function deleteCurrentExpense() {
  if (!editingExpenseRow || !confirm('Delete this expense?')) return;
  deleteTxn('expense', editingExpenseRow, 'expense-modal');
}

// ── Shared save / delete for expenses, income and transfers ──
// Handles: duplicate check on new entries, offline queue, editing entries not yet synced.
function capType(type) { return type.charAt(0).toUpperCase() + type.slice(1); }
function submitTxn(type, payload, editingRow, modalId, btnId, labels, addedMsg, onSaved) {
  var btn = document.getElementById(btnId);
  var t = editingRow ? findTxn(type, editingRow) : null;
  if (t && t.queuedAdd) {                                   // still waiting to sync: just change the waiting copy
    editQueuedAdd(t.id, payload);
    closeModal(modalId); toast('Updated — waiting to sync'); refreshPending();
    return;
  }
  if (editingRow) { payload.action = 'update' + capType(type); payload.rowIndex = editingRow; payload.id = t ? t.id : ''; }
  else payload.action = 'add' + capType(type);
  btn.textContent = 'Saving…';
  saveWithDupCheck(payload, type).then(function(res) {
    btn.textContent = editingRow ? labels[1] : labels[0];
    if (!res) return;                                       // user cancelled at the duplicate warning
    if (res.ok && res.queued) {
      closeModal(modalId);
      toast(editingRow ? 'Changed on this device — will sync when online'
        : onSaved ? 'Saved offline — add the repeat in Settings → Recurring when back online' : OFFLINE_SAVED);
      refreshPending();
    } else if (res.ok) {
      closeModal(modalId); toast(editingRow ? 'Updated!' : addedMsg);
      if (onSaved) onSaved(res); else loadAll();
    } else toast('Error: ' + (res.error || '?'));
  }).catch(function(){ btn.textContent = editingRow ? labels[1] : labels[0]; toast('Connection error'); });
}
function deleteTxn(type, editingRow, modalId) {
  var t = findTxn(type, editingRow);
  if (t && t.queuedAdd) { dropQueuedAdd(t.id); closeModal(modalId); toast('Removed'); refreshPending(); return; }
  api({ action: 'delete' + capType(type), rowIndex: editingRow, id: t ? t.id : '' }).then(function(res) {
    if (res.ok && res.queued) { closeModal(modalId); toast('Deleted on this device — will sync when online'); refreshPending(); }
    else if (res.ok) { closeModal(modalId); toast('Deleted'); loadAll(); }
    else toast('Error: ' + (res.error || '?'));
  }).catch(function(){ toast('Connection error'); });
}

// ════════════════════════════════════════════
//  ADD / EDIT INCOME
// ════════════════════════════════════════════
function openIncomeForm(rowIndex) {
  closeModal('chooser-modal');
  editingIncomeRow = rowIndex || null;
  document.getElementById('income-modal-title').textContent = rowIndex ? 'Edit Income' : 'Add Income';
  document.getElementById('save-income-btn').textContent = rowIndex ? 'Update Income' : 'Save Income';
  document.getElementById('delete-income-btn').style.display = rowIndex ? 'block' : 'none';

  if (rowIndex) {
    var t = findTxn('income', rowIndex);
    document.getElementById('fi-amount').value = t ? fxEditValue(t) : '';
    editingFx = fxKeep(t);
    document.getElementById('fi-note').value   = t ? (t.note||'') : '';
    document.getElementById('fi-date').value   = t ? t.date : todayStr();
    renderCatGrid('fi-cat-grid', incCategories, t ? t.category : null);
    renderAcctList('fi-acct-list', t ? t.account : null);
  } else {
    document.getElementById('fi-amount').value = '';
    editingFx = null;
    document.getElementById('fi-note').value   = '';
    document.getElementById('fi-date').value   = todayStr();
    renderCatGrid('fi-cat-grid', incCategories, null);
    renderAcctList('fi-acct-list', null);
  }
  fxUpdate('fi');
  openModal('income-modal');
  setTimeout(function(){ document.getElementById('fi-amount').focus(); }, 300);
}

function openEditIncome(rowIndex) { openIncomeForm(rowIndex); }

function saveIncome() {
  var amount = parseFloat(document.getElementById('fi-amount').value);
  if (!amount || amount<=0) { toast('Enter a valid amount'); return; }
  var cat  = getSelectedCat('fi-cat-grid');
  var acct = getSelectedAcct('fi-acct-list');
  if (!cat)  { toast('Select a category'); return; }
  if (!acct) { toast('Select an account'); return; }
  var note = document.getElementById('fi-note').value.trim();
  var date = document.getElementById('fi-date').value || todayStr();
  var payload = Object.assign({ category:cat, account:acct, note, date }, fxPayload(amount, acct));
  submitTxn('income', payload, editingIncomeRow, 'income-modal', 'save-income-btn', ['Save Income', 'Update Income'], 'Income added!');
}

function deleteCurrentIncome() {
  if (!editingIncomeRow || !confirm('Delete this income?')) return;
  deleteTxn('income', editingIncomeRow, 'income-modal');
}

// ════════════════════════════════════════════
//  TRANSFER
// ════════════════════════════════════════════
function openTransferForm(rowIndex) {
  closeModal('chooser-modal');
  editingTransferRow = rowIndex || null;
  document.getElementById('transfer-modal-title').textContent = rowIndex ? 'Edit Transfer' : 'Transfer Between Accounts';
  document.getElementById('save-transfer-btn').textContent    = rowIndex ? 'Update Transfer' : 'Save Transfer';
  document.getElementById('delete-transfer-btn').style.display = rowIndex ? 'block' : 'none';
  var opts = sortedAccounts().map(function(a){ return '<option value="'+escQ(a.name)+'">'+acctIcon(a.type)+' '+a.name+'</option>'; }).join('');
  document.getElementById('ft-from').innerHTML = opts;
  document.getElementById('ft-to').innerHTML   = opts;
  if (rowIndex) {
    var t = findTxn('transfer', rowIndex);
    if (t) {
      document.getElementById('ft-amount').value = t.amount;
      document.getElementById('ft-note').value   = t.note || '';
      document.getElementById('ft-date').value   = t.date || todayStr();
      document.getElementById('ft-from').value   = t.fromAccount || '';
      document.getElementById('ft-to').value     = t.toAccount   || '';
      var rc0 = document.getElementById('ft-received');
      rc0.value = t.receivedAmount || ''; rc0.dataset.touched = t.receivedAmount ? '1' : '';
    }
  } else {
    document.getElementById('ft-amount').value = '';
    document.getElementById('ft-note').value   = '';
    document.getElementById('ft-date').value   = todayStr();
    document.getElementById('ft-received').value = ''; document.getElementById('ft-received').dataset.touched = '';
    if (accounts.length > 1) document.getElementById('ft-to').selectedIndex = 1;
  }
  ftUpdate();
  openModal('transfer-modal');
}

function openEditTransfer(rowIndex) { openTransferForm(rowIndex); }

function saveTransfer() {
  var amount = parseFloat(document.getElementById('ft-amount').value);
  if (!amount || amount<=0) { toast('Enter a valid amount'); return; }
  var from = document.getElementById('ft-from').value;
  var to   = document.getElementById('ft-to').value;
  if (from === to) { toast('From and To accounts must be different'); return; }
  var note = document.getElementById('ft-note').value.trim();
  var date = document.getElementById('ft-date').value || todayStr();
  var payload = { amount, fromAccount:from, toAccount:to, note, date };
  if (curOf(from) !== curOf(to)) {
    var rcv = parseFloat(document.getElementById('ft-received').value);
    if (!rcv || rcv <= 0) { toast('Enter the amount received'); return; }
    payload.receivedAmount = rcv;
  }
  submitTxn('transfer', payload, editingTransferRow, 'transfer-modal', 'save-transfer-btn', ['Save Transfer', 'Update Transfer'], 'Transfer saved!');
}

function deleteCurrentTransfer() {
  if (!editingTransferRow || !confirm('Delete this transfer?')) return;
  deleteTxn('transfer', editingTransferRow, 'transfer-modal');
}

// ════════════════════════════════════════════
//  RECURRING EXPENSE TOGGLE
// ════════════════════════════════════════════
function toggleRecurringFields() {
  var on = document.getElementById('fe-recurring').checked;
  document.getElementById('fe-recurring-sub').style.display = on ? 'block' : 'none';
  var d = document.getElementById('fe-date').value || todayStr(), dt = new Date(d+'T00:00:00');
  var yearly = document.getElementById('fe-recurrence-period').value === 'yearly';
  document.getElementById('fe-repeat-hint').textContent = 'Adds this again ' +
    (yearly ? 'every year on ' + dt.getDate() + ' ' + SHORT_MON[dt.getMonth()] : 'on day ' + dt.getDate() + ' of every month') +
    '. Change or stop it in Settings → Recurring expenses.';
}
// "Repeat automatically" on a new expense: this entry is the first one; the recurring item makes the next ones
function createRepeatFrom(p, period) {
  var dt = new Date(p.date+'T00:00:00');
  api({ action:'addRecurring', description: p.note || p.category, amount: p.amount, category: p.category, account: p.account,
        dayOfMonth: dt.getDate(), monthOfYear: dt.getMonth() + 1, frequency: period === 'yearly' ? 'yearly' : 'monthly',
        startDate: p.date, lastGenerated: p.date, projectId: p.projectId || '' }).then(function(r) {
    toast(r.ok ? 'Expense added · repeats ' + (period === 'yearly' ? 'every year' : 'every month') : 'Expense added, but the repeat failed: ' + (r.error || '?'));
    loadAll();
  }).catch(function(){ toast('Expense added, but the repeat needs a connection'); loadAll(); });
}

