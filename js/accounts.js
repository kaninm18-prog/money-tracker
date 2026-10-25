// Money Tracker — Accounts page: account list, add/edit accounts, credit card statements, net worth history chart.
// Loaded as a plain <script> (not a module): functions are global so onclick="..." handlers work.

// ════════════════════════════════════════════
//  CREDIT CARD STATEMENT (accounts page)
// ════════════════════════════════════════════
function statementHtml(a) {
  var st = a.statement;
  if (!st) return '';
  var paidAll = st.lastSpend > 0 && st.leftToPay <= 0;
  return '<div class="stmt-box">' +
    '<div class="stmt-head">Last statement · '+fmtDate(st.lastStart)+' – '+fmtDate(st.lastEnd)+'</div>' +
    '<div class="stmt-row"><span>Billed</span><b>'+fmtMoney(st.lastSpend)+'</b></div>' +
    (st.paidSince ? '<div class="stmt-row"><span>Paid since</span><b>'+fmtMoney(st.paidSince)+'</b></div>' : '') +
    (st.lastSpend > 0 ? '<div class="stmt-row big"><span>'+(paidAll ? 'Paid' : 'Left to pay'+(st.dueDate ? ' · due '+fmtDate(st.dueDate) : ''))+'</span>' +
      (paidAll ? '<span class="paid">✓ in full</span>' : '<b>'+fmtMoney(st.leftToPay)+'</b>')+'</div>' : '') +
    '<div class="stmt-row" style="margin-top:6px"><span>This cycle so far ('+fmtDate(st.curStart)+' – '+fmtDate(st.curEnd)+')</span><b>'+fmtMoney(st.curSpend)+'</b></div>' +
  '</div>';
}

// ════════════════════════════════════════════
//  NET WORTH HISTORY (accounts page)
// ════════════════════════════════════════════
var nwHot = -1;
function renderNetWorth() {
  var card = document.getElementById('nw-card');
  if (!card) return;
  var data = netWorthHist;
  if (!data || data.length < 2) { card.style.display = 'none'; return; }
  card.style.display = '';
  document.getElementById('nw-sub').textContent = 'last ' + data.length + ' months';
  var W = 340, H = 130, padT = 10, padB = 18, padL = 2, padR = 2, n = data.length;
  var vals = data.map(function(m){ return m.netWorth; });
  var max = Math.max.apply(null, vals), min = Math.min.apply(null, vals);
  if (max === min) { max += 1; min -= 1; }
  var span = max - min; max += span * 0.08; min -= span * 0.08;
  var x = function(i){ return padL + (W - padL - padR) * (n === 1 ? 0.5 : i / (n - 1)); };
  var y = function(v){ return padT + (H - padT - padB) * (1 - (v - min) / (max - min)); };
  var pts = data.map(function(m, i){ return [x(i), y(m.netWorth)]; });
  var lastEst = -1; data.forEach(function(m, i){ if (m.estimated) lastEst = i; });
  var path = function(a, b){ var d = ''; for (var i = a; i <= b; i++) d += (i === a ? 'M' : 'L') + pts[i][0].toFixed(1) + ',' + pts[i][1].toFixed(1); return d; };
  var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Net worth at the end of each month">';
  if (min < 0 && max > 0) svg += '<line class="nw-zero" x1="0" x2="' + W + '" y1="' + y(0) + '" y2="' + y(0) + '"/>';
  svg += '<path class="nw-area" d="' + path(0, n - 1) + 'L' + x(n - 1) + ',' + (H - padB) + 'L' + x(0) + ',' + (H - padB) + 'Z"/>';
  if (lastEst >= 0) svg += '<path class="nw-line est" d="' + path(0, Math.min(n - 1, lastEst + 1)) + '"/>';
  if (lastEst + 1 < n - 1 || lastEst < 0) svg += '<path class="nw-line" d="' + path(Math.max(0, lastEst + 1), n - 1) + '"/>';
  var step = Math.max(1, Math.ceil(n / 6));
  data.forEach(function(m, i) {
    if ((n - 1 - i) % step === 0) svg += '<text class="tlbl" x="' + Math.min(W - 10, Math.max(10, x(i))) + '" y="' + (H - 4) + '">' + SHORT_MON[parseInt(m.month.substring(5, 7)) - 1] + '</text>';
  });
  var hi = nwHot >= 0 ? nwHot : n - 1;
  svg += '<line class="nw-cross" x1="' + x(hi) + '" x2="' + x(hi) + '" y1="' + padT + '" y2="' + (H - padB) + '"/>';
  svg += '<circle class="nw-dot" cx="' + x(hi) + '" cy="' + y(data[hi].netWorth) + '" r="4.5"/>';
  var hw = (W - padL - padR) / Math.max(1, n - 1);
  data.forEach(function(m, i) {
    svg += '<rect class="thit" x="' + (x(i) - hw / 2) + '" y="0" width="' + hw + '" height="' + H + '" onmouseenter="nwHover(' + i + ')" onclick="nwHover(' + i + ')"><title>' + m.month + '</title></rect>';
  });
  svg += '</svg>';
  document.getElementById('nw-chart').innerHTML = svg;
  document.getElementById('nw-chart').onmouseleave = function(){ nwHover(-1); };
  document.getElementById('nw-legend').innerHTML = lastEst >= 0
    ? '<span class="nw-key est"></span> estimated from your transactions (investments at cost) <span class="nw-key"></span> saved each month'
    : '';
  renderNwReadout(hi);
}
function nwHover(i) { if (nwHot === i) return; nwHot = i; renderNetWorth(); }
function renderNwReadout(i) {
  var d = netWorthHist, m = d[i]; if (!m) return;
  var prev = d[i - 1], yr = d[i - 12];
  var label = MONTH_NAMES[parseInt(m.month.substring(5, 7)) - 1] + ' ' + m.month.substring(0, 4) + (m.live ? ' · now' : m.estimated ? ' · estimated' : '');
  var cmp = function(o, txt){ if (!o) return ''; var dv = m.netWorth - o.netWorth;
    return '<span class="' + (dv > 0.5 ? 'tr-down' : dv < -0.5 ? 'tr-up' : '') + '">' + (dv >= 0 ? '▲ ' : '▼ ') + fmtMoney(Math.abs(dv)) + '</span> ' + txt; };
  document.getElementById('nw-readout').innerHTML =
    '<div><div class="tr-month">' + label + '</div><div class="tr-val">' + fmtMoney(m.netWorth) + '</div>' +
    '<div class="tr-month" style="margin-top:2px">Accounts ' + fmtMoney(m.accounts) + ' · Investments ' + fmtMoney(m.investments) + (m.assets ? ' · Assets ' + fmtMoney(m.assets) : '') + (m.receivables ? ' · Owed to you ' + fmtMoney(m.receivables) : '') + '</div></div>' +
    '<div class="tr-cmp">' + [cmp(prev, 'vs last month'), cmp(yr, 'vs a year ago')].filter(Boolean).join('<br>') + '</div>';
}

// ════════════════════════════════════════════
//  ACCOUNTS PAGE
// ════════════════════════════════════════════
function toggleAccountsEditMode() {
  accountsEditMode = !accountsEditMode;
  renderAccountsPage();
}

function renderAccountsPage() {
  // Update header style and button label
  var headerEl = document.getElementById('acct-page-header');
  var toggleBtn = document.getElementById('acct-edit-toggle-btn');
  if (headerEl) headerEl.classList.toggle('acct-edit-active', accountsEditMode);
  if (toggleBtn) toggleBtn.textContent = accountsEditMode ? 'Done' : 'Edit';

  var html = '';
  if (!accounts.length) {
    html = '<div class="empty"><div class="empty-icon">💳</div><p>No accounts yet. Add your first account below.</p></div>';
  } else {
    // Group by type in a defined order
    var TYPE_ORDER = [
      { key: 'bank',       label: '🏦 Bank Accounts' },
      { key: 'credit',     label: '💳 Credit Cards' },
      { key: 'cash',       label: '💵 Cash' },
      { key: 'wallet',     label: '📱 Digital Wallets' },
      { key: 'investment', label: '📈 Investments & Savings' }
    ];
    // Collect any types not in the predefined list
    var knownTypes = TYPE_ORDER.map(function(g){ return g.key; });
    var otherTypes = accounts
      .map(function(a){ return a.type; })
      .filter(function(t, i, arr){ return !knownTypes.includes(t) && arr.indexOf(t) === i; });
    otherTypes.forEach(function(t){ TYPE_ORDER.push({ key: t, label: '🏛 ' + typeLabel(t) }); });

    TYPE_ORDER.forEach(function(group) {
      var groupAccts = accounts.filter(function(a){ return a.type === group.key; });
      if (!groupAccts.length) return;
      html += '<div class="acc-page-section-header">' + group.label + '</div>';
      groupAccts.forEach(function(a) {
        if (a.type === 'credit') {
          var owed = ccOwed(a);
          var pct  = ccUsedPct(a);
          var nextDue = a.dueDay ? nextDueDate(a.dueDay) : null;
          var daysLeft = nextDue ? daysUntil(nextDue) : null;
          if (a.statement && a.statement.dueDate && a.statement.leftToPay > 0) { nextDue = new Date(a.statement.dueDate+'T00:00:00'); daysLeft = daysUntil(nextDue); }
          // local date (toISOString() converted to UTC and showed the day before in Thailand)
          var dueTxt = nextDue ? fmtDate(nextDue.getFullYear()+'-'+pad(nextDue.getMonth()+1)+'-'+pad(nextDue.getDate())) + (daysLeft<=3?' ⚠️':'') : '—';
          html += '<div class="acc-page-card is-credit">' +
            '<div class="acc-page-row">' +
              '<div class="acc-page-icon">💳</div>' +
              '<div class="acc-page-info"><div class="acc-page-name">'+a.name+'</div><div class="acc-page-type">Credit Card</div></div>' +
              '<div class="acc-page-balance neg">Owed<br>'+fmtMoney(owed)+'</div>' +
            '</div>' +
            '<div class="acc-page-credit-detail">' +
              (a.creditLimit ? '<div class="acc-page-credit-row"><span>Credit Limit</span><span>'+fmtMoney(a.creditLimit)+'</span></div>' +
                '<div class="acc-page-credit-row"><span>Available</span><span>'+fmtMoney(Math.max(0, a.creditLimit - owed))+'</span></div>' +
                '<div class="acc-page-limit-bar-wrap"><div class="acc-page-limit-bar" style="width:'+pct+'%"></div></div>' : '') +
              (a.dueDay ? '<div class="acc-page-credit-row" style="margin-top:8px"><span>Next Due Date</span><span>'+dueTxt+'</span></div>' : '') +
              (a.statementDay ? '<div class="acc-page-credit-row"><span>Statement Date</span><span>'+a.statementDay+(a.statementDay===1?'st':a.statementDay===2?'nd':a.statementDay===3?'rd':'th')+' of each month</span></div>' : '') +
              statementHtml(a) +
            '</div>' +
            balCheckRow(a) +
            (accountsEditMode ? '<div class="acc-page-actions">' +
              '<button class="acc-edit-btn" onclick="openEditAccount('+a.rowIndex+')">✏️ Edit</button>' +
              '<button class="acc-del-btn"  onclick="deleteAccount('+a.rowIndex+',\''+escQ(a.name)+'\')">🗑️ Delete</button>' +
            '</div>' : '') +
          '</div>';
        } else {
          var neg = a.balance < 0 ? ' neg' : '';
          html += '<div class="acc-page-card">' +
            '<div class="acc-page-row">' +
              '<div class="acc-page-icon">'+acctIcon(a.type)+'</div>' +
              '<div class="acc-page-info"><div class="acc-page-name">'+a.name+'</div><div class="acc-page-type">'+typeLabel(a.type)+(a.currency && a.currency !== 'THB' ? ' · '+a.currency+' @ ฿'+a.rate : '')+'</div></div>' +
              '<div class="acc-page-balance'+neg+'">'+fmtCur(a.balance, a.currency)+(a.currency && a.currency !== 'THB' ? '<div style="font-size:0.7rem;font-weight:500;color:var(--text2)">≈ '+fmtMoney(a.balanceThb)+'</div>' : '')+'</div>' +
            '</div>' +
            balCheckRow(a) +
            (accountsEditMode ? '<div class="acc-page-actions">' +
              '<button class="acc-edit-btn" onclick="openEditAccount('+a.rowIndex+')">✏️ Edit</button>' +
              '<button class="acc-del-btn"  onclick="deleteAccount('+a.rowIndex+',\''+escQ(a.name)+'\')">🗑️ Delete</button>' +
            '</div>' : '') +
          '</div>';
        }
      });
    });
  }
  document.getElementById('accounts-page-list').innerHTML = html;
}

function typeLabel(t) { return {cash:'Cash',bank:'Bank Account',investment:'Investment / Savings',wallet:'Digital Wallet',credit:'Credit Card'}[t] || t; }

// ════════════════════════════════════════════
//  ACCOUNTS CRUD
// ════════════════════════════════════════════
function toggleCreditFields() {
  var isCredit = document.getElementById('fa-type').value === 'credit';
  document.getElementById('credit-fields').style.display    = isCredit ? 'block' : 'none';
  document.getElementById('fa-balance-hint').style.display  = isCredit ? 'block' : 'none';
  onAcctCurChange();
}
function onAcctCurChange() {
  var isCredit = document.getElementById('fa-type').value === 'credit';
  var cur = (document.getElementById('fa-currency').value || 'THB').trim().toUpperCase();
  var foreign = cur.length === 3 && cur !== 'THB';
  document.getElementById('fa-rate-group').style.display = foreign ? 'block' : 'none';
  document.getElementById('fa-rate-label').textContent = 'Exchange rate (฿ per 1 ' + cur + ')';
  document.getElementById('fa-balance-label').textContent = (isCredit ? 'Current Balance (' : 'Starting Balance (') + (foreign ? cur : '฿') + ')';
  document.getElementById('fa-prefix').textContent = foreign ? curSym(cur) : '฿';
}

function openAddAccount() {
  editingAccountRow = null;
  document.getElementById('account-modal-title').textContent = 'Add Account';
  document.getElementById('save-account-btn').textContent = 'Add Account';
  document.getElementById('fa-name').value    = '';
  document.getElementById('fa-type').value    = 'bank';
  document.getElementById('fa-balance').value = '';
  document.getElementById('fa-limit').value   = '';
  document.getElementById('fa-dueday').value  = '';
  document.getElementById('fa-stmtday').value = '';
  document.getElementById('fa-currency').value = 'THB';
  document.getElementById('fa-rate').value = '';
  toggleCreditFields();
  openModal('account-modal');
}

function openEditAccount(rowIndex) {
  var a = accounts.find(function(x){ return x.rowIndex===rowIndex; });
  if (!a) return;
  editingAccountRow = rowIndex;
  editingAccountKey = a.name;
  document.getElementById('account-modal-title').textContent = 'Edit Account';
  document.getElementById('save-account-btn').textContent = 'Save Changes';
  document.getElementById('fa-name').value    = a.name;
  document.getElementById('fa-type').value    = a.type;
  document.getElementById('fa-balance').value = a.startingBalance;
  document.getElementById('fa-limit').value   = a.creditLimit || '';
  document.getElementById('fa-dueday').value  = a.dueDay || '';
  document.getElementById('fa-stmtday').value = a.statementDay || '';
  document.getElementById('fa-currency').value = a.currency || 'THB';
  document.getElementById('fa-rate').value = (a.currency && a.currency !== 'THB') ? a.rate : '';
  toggleCreditFields();
  openModal('account-modal');
}

function saveAccount() {
  var name    = document.getElementById('fa-name').value.trim();
  var type    = document.getElementById('fa-type').value;
  var balance = parseFloat(document.getElementById('fa-balance').value) || 0;
  if (!name) { toast('Enter an account name'); return; }
  var payload = { name, type, startingBalance: balance };
  var cur = (document.getElementById('fa-currency').value || 'THB').trim().toUpperCase();
  if (cur.length !== 3) { toast('Currency must be a 3-letter code, e.g. USD'); return; }
  payload.currency = cur;
  if (cur !== 'THB') {
    var rate = parseFloat(document.getElementById('fa-rate').value);
    if (!rate || rate <= 0) { toast('Enter the exchange rate (฿ per 1 ' + cur + ')'); return; }
    payload.rate = rate;
  }
  if (type === 'credit') {
    payload.creditLimit  = parseFloat(document.getElementById('fa-limit').value)  || 0;
    payload.dueDay       = parseInt(document.getElementById('fa-dueday').value)   || 0;
    payload.statementDay = parseInt(document.getElementById('fa-stmtday').value)  || 0;
  }
  if (editingAccountRow) { payload.action='updateAccount'; payload.rowIndex=editingAccountRow; payload.key=editingAccountKey; }
  else { payload.action='addAccount'; }
  document.getElementById('save-account-btn').textContent = 'Saving…';
  api(payload).then(function(res) {
    if (res.ok) { closeModal('account-modal'); toast(editingAccountRow?'Account updated!':'Account added!'); loadAll(); }
    else { toast('Error: '+(res.error||'?')); }
    document.getElementById('save-account-btn').textContent = editingAccountRow?'Save Changes':'Add Account';
  });
}

function deleteAccount(rowIndex, name) {
  if (!confirm('Delete account "'+name+'"?\nThis won\'t delete transactions linked to it.')) return;
  api({action:'deleteAccount', rowIndex:rowIndex, key:name}).then(function(res) {
    if (res.ok) { toast('Account deleted'); loadAll(); }
    else { toast('Error: '+res.error); }
  });
}


// ════════════════════════════════════════════
//  BALANCE CHECK — compare with what your bank app shows
//  The difference is saved as a transfer to/from "Balance adjustment", so the account becomes
//  correct without counting as income or spending.
// ════════════════════════════════════════════
var ADJ_ACCOUNT = 'Balance adjustment';
var balCheckAcct = null;
function balCheckedKey(name) { return 'balChecked_' + name; }
function lastBalCheck(name) { try { return localStorage.getItem(balCheckedKey(name)) || ''; } catch(e) { return ''; } }
function balCheckRow(a) {
  var last = lastBalCheck(a.name);
  var age = last ? daysBetween(last, todayStr()) : null;
  var txt = last ? 'Checked ' + (age === 0 ? 'today' : age === 1 ? 'yesterday' : fmtDate(last)) + ' ✓' : 'Not checked against your bank yet';
  return '<div class="bal-check-row"><span class="' + (last && age <= 31 ? 'ok' : '') + '">' + txt + '</span>' +
    '<button onclick="openBalanceCheck(' + a.rowIndex + ')">⚖️ Check balance</button></div>';
}
function openBalanceCheck(rowIndex) {
  var a = accounts.find(function(x){ return x.rowIndex === rowIndex; });
  if (!a) return;
  balCheckAcct = a;
  var credit = a.type === 'credit';
  document.getElementById('bc-title').textContent = 'Check ' + a.name;
  document.getElementById('bc-app').innerHTML = 'The app shows <b>' + (credit ? fmtMoney(ccOwed(a)) + ' owed' : fmtCur(a.balance, a.currency)) + '</b>';
  document.getElementById('bc-label').textContent = credit ? 'Amount owed in your bank / card app' : 'Balance in your bank app' + (a.currency && a.currency !== 'THB' ? ' (' + a.currency + ')' : '');
  document.getElementById('bc-actual').value = '';
  document.getElementById('bc-note').value = '';
  document.getElementById('bc-diff').innerHTML = '';
  document.getElementById('bc-save').textContent = 'Save';
  openModal('balcheck-modal');
  setTimeout(function(){ document.getElementById('bc-actual').focus(); }, 300);
}
function balDiff() {
  var a = balCheckAcct, v = parseFloat(document.getElementById('bc-actual').value);
  if (!a || isNaN(v)) return null;
  var actual = a.type === 'credit' ? -Math.abs(v) : v;
  return Math.round((actual - a.balance) * 100) / 100;
}
function balCheckPreview() {
  var d = balDiff(), el = document.getElementById('bc-diff'), btn = document.getElementById('bc-save');
  if (d === null) { el.innerHTML = ''; btn.textContent = 'Save'; return; }
  var a = balCheckAcct, cur = a.currency || 'THB';
  if (Math.abs(d) < 0.005) { el.innerHTML = '<span class="pl-pos">✓ Matches — nothing to fix</span>'; btn.textContent = 'Mark as checked'; return; }
  var more = a.type === 'credit' ? (d < 0 ? 'You owe ' + fmtCur(-d, cur) + ' more than the app shows' : 'You owe ' + fmtCur(d, cur) + ' less than the app shows')
                                 : (d > 0 ? 'Your bank has ' + fmtCur(d, cur) + ' more than the app' : 'Your bank has ' + fmtCur(-d, cur) + ' less than the app');
  el.innerHTML = more + '.<br><span class="hold-sub">Saving adds a balance adjustment of ' + (d > 0 ? '+' : '−') + fmtCur(Math.abs(d), cur) +
    ' (not counted as income or spending). If you can, find and add the missing entry instead.</span>';
  btn.textContent = 'Save adjustment';
}
function saveBalanceCheck() {
  var a = balCheckAcct, d = balDiff();
  if (!a || d === null) { toast('Enter the balance from your bank app'); return; }
  var done = function(msg) {
    try { localStorage.setItem(balCheckedKey(a.name), todayStr()); } catch(e) {}
    closeModal('balcheck-modal'); toast(msg);
  };
  if (Math.abs(d) < 0.005) { done('✓ ' + a.name + ' matches your bank'); renderAccountsPage(); return; }
  var note = document.getElementById('bc-note').value.trim() || 'Balance check';
  var payload = d > 0 ? { action: 'addTransfer', fromAccount: ADJ_ACCOUNT, toAccount: a.name, amount: Math.abs(d), date: todayStr(), note: note }
                      : { action: 'addTransfer', fromAccount: a.name, toAccount: ADJ_ACCOUNT, amount: Math.abs(d), date: todayStr(), note: note };
  var btn = document.getElementById('bc-save'); btn.textContent = 'Saving…';
  api(payload).then(function(res) {
    btn.textContent = 'Save adjustment';
    if (res.ok && res.queued) { done('Saved on this device — will sync when online'); refreshPending(); }
    else if (res.ok) { done('Adjusted ' + a.name + ' by ' + (d > 0 ? '+' : '−') + fmtCur(Math.abs(d), a.currency)); loadAll(); }
    else toast('Error: ' + (res.error || '?'));
  }).catch(function(){ btn.textContent = 'Save adjustment'; toast('Connection error'); });
}
