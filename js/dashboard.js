// Money Tracker — Dashboard: header balance, account cards, card reminders, monthly summary, upcoming bills, spending trend.
// Loaded as a plain <script> (not a module): functions are global so onclick="..." handlers work.

// ════════════════════════════════════════════
//  CREDIT CARD HELPERS
// ════════════════════════════════════════════
function nextDueDate(dueDay) {
  var today = new Date(); today.setHours(0,0,0,0);
  var thisMonth = new Date(today.getFullYear(), today.getMonth(), dueDay);
  if (thisMonth <= today) return new Date(today.getFullYear(), today.getMonth()+1, dueDay);
  return thisMonth;
}
function daysUntil(date) {
  var today = new Date(); today.setHours(0,0,0,0);
  return Math.round((date - today) / (1000*60*60*24));
}
function ccOwed(a) { return a.balance < 0 ? Math.abs(a.balance) : 0; }
function ccUsedPct(a) {
  if (!a.creditLimit) return 0;
  return Math.min(100, Math.round(ccOwed(a) / a.creditLimit * 100));
}

// ════════════════════════════════════════════
//  REMINDER BANNERS
// ════════════════════════════════════════════
function getCCPaidKey(name) {
  var now = new Date();
  return 'ccPaid_' + name + '_' + now.getFullYear() + '_' + (now.getMonth() + 1);
}

function markCCPaid(name) {
  try { localStorage.setItem(getCCPaidKey(name), '1'); } catch(e) {}
  renderReminders();
}

function isCCPaidThisMonth(name) {
  try { return localStorage.getItem(getCCPaidKey(name)) === '1'; } catch(e) { return false; }
}

function renderReminders() {
  var cards = accounts.filter(function(a){ return a.type==='credit' && a.dueDay; });
  var due = cards.filter(function(a){
    if (a.statement && a.statement.dueDate) {
      var st = a.statement;
      return st.leftToPay > 0 && daysUntil(new Date(st.dueDate+'T00:00:00')) <= 3 && !isCCPaidThisMonth(a.name);
    }
    return daysUntil(nextDueDate(a.dueDay)) <= 3 && !isCCPaidThisMonth(a.name);
  });
  if (!due.length) { document.getElementById('cc-reminders').innerHTML = ''; return; }

  var items = due.map(function(a) {
    var st = a.statement && a.statement.dueDate ? a.statement : null;
    var d = st ? daysUntil(new Date(st.dueDate+'T00:00:00')) : daysUntil(nextDueDate(a.dueDay));
    var label = d < 0 ? 'OVERDUE' : d === 0 ? 'Due TODAY' : d === 1 ? 'Due TOMORROW' : 'Due in ' + d + ' days';
    var owed = st ? st.leftToPay : ccOwed(a);
    var safeName = a.name.replace(/'/g, "\\'");
    return '<div class="cc-reminder-item">' +
      '<div><div class="cc-reminder-name">💳 ' + a.name + '</div>' +
      '<div class="cc-reminder-detail">' + (owed > 0 ? 'Owed: ' + fmtMoney(owed) : 'Balance clear') + '</div></div>' +
      '<div style="display:flex;align-items:center;gap:6px">' +
        '<div class="cc-reminder-days">' + label + '</div>' +
        '<button class="cc-paid-btn" onclick="markCCPaid(\'' + safeName + '\')">✓ Paid</button>' +
      '</div>' +
    '</div>';
  }).join('');

  document.getElementById('cc-reminders').innerHTML =
    '<div class="cc-reminder-banner">' +
      '<button class="cc-reminder-close" onclick="document.getElementById(\'cc-reminders\').innerHTML=\'\'">✕</button>' +
      '<div class="cc-reminder-title">⚠️ Credit Card Payment Due Soon</div>' +
      items +
    '</div>';
}

// ════════════════════════════════════════════
//  ACCOUNT CARDS (top strip)
// ════════════════════════════════════════════
function renderAccountCards() {
  var bal = computeBalance();
  var modeInfo = BALANCE_MODES[balanceMode] || BALANCE_MODES.net_worth;
  document.getElementById('header-balance-label').textContent = modeInfo.label.toUpperCase();
  document.getElementById('header-networth').textContent = fmtMoney(bal);
  document.getElementById('header-networth-sub').textContent = modeInfo.sub;

  var html = '';
  sortedAccounts().forEach(function(a) {
    if (a.type === 'credit') {
      var owed = ccOwed(a);
      var pct  = ccUsedPct(a);
      html += '<div class="account-card credit-card" onclick="showPage(\'accounts\')">' +
        '<div class="account-card-type">💳</div>' +
        '<div class="account-card-name">' + a.name + '</div>' +
        '<div class="cc-card-label">Owed</div>' +
        '<div class="account-card-balance neg">' + fmtMoney(owed) + '</div>' +
        (a.creditLimit ? '<div class="cc-limit-bar-wrap"><div class="cc-limit-bar" style="width:'+pct+'%"></div></div><div class="cc-limit-text">'+pct+'% of '+fmtMoney(a.creditLimit)+'</div>' : '') +
      '</div>';
    } else {
      var neg = a.balance < 0 ? ' neg' : '';
      html += '<div class="account-card" onclick="showPage(\'accounts\')">' +
        '<div class="account-card-type">' + acctIcon(a.type) + '</div>' +
        '<div class="account-card-name">' + a.name + '</div>' +
        '<div class="account-card-balance' + neg + '">' + fmtCur(a.balance, a.currency) + '</div>' +
        (a.currency && a.currency !== 'THB' ? '<div class="account-card-sub">≈ ' + fmtMoney(a.balanceThb) + '</div>' : '') +
      '</div>';
    }
  });
  if (!accounts.length) html = '<div style="padding:18px 0;color:var(--text2);font-size:0.82rem">No accounts yet — add one from the Accounts tab</div>';
  document.getElementById('account-cards-wrap').innerHTML = html;

  renderReminders();
}

// ════════════════════════════════════════════
//  BALANCE MODE
// ════════════════════════════════════════════
function computeBalance() {
  var mode = balanceMode;
  if (mode === 'monthly_balance') {
    var inc = transactions.filter(function(t){return t.type==='income';}).reduce(function(s,t){return s+t.amount;},0);
    var exp = transactions.filter(function(t){return t.type==='expense'&&!t.projectId;}).reduce(function(s,t){return s+t.amount;},0);
    return inc - exp;
  }
  if (mode === 'available_cash') {
    return accounts.filter(function(a){return a.type==='cash'||a.type==='bank';}).reduce(function(s,a){return s+acctThb(a);},0);
  }
  if (mode === 'portfolio') return holdingTotals.investments || 0;
  return totalBalance + (holdingTotals.value || 0); // net worth = accounts + assets & investments
}

function cycleBalanceMode() {
  var modes = ['net_worth','monthly_balance','available_cash','portfolio'];
  var idx = modes.indexOf(balanceMode);
  balanceMode = modes[(idx+1) % modes.length];
  localStorage.setItem('balanceMode', balanceMode);
  syncBalanceModeUI();
  renderAccountCards(); // re-renders header balance
}

function setBalanceMode(mode) {
  balanceMode = mode;
  localStorage.setItem('balanceMode', mode);
  syncBalanceModeUI();
  renderAccountCards();
}

function syncBalanceModeUI() {
  // Settings radio list
  document.querySelectorAll('.balance-mode-opt').forEach(function(el){
    var radio = el.querySelector('input');
    var active = radio && radio.value === balanceMode;
    el.classList.toggle('selected', active);
    if (radio) radio.checked = active;
  });
}

// ════════════════════════════════════════════
//  DASHBOARD
// ════════════════════════════════════════════
function renderDashboard() {
  // Separate regular vs project expenses
  var expenses        = transactions.filter(function(t){return t.type==='expense';});
  var regularExpenses = expenses.filter(function(t){return !t.projectId;});
  var projectExpenses = expenses.filter(function(t){return !!t.projectId;});
  var incomes         = transactions.filter(function(t){return t.type==='income';});
  var totalExp  = regularExpenses.reduce(function(s,t){return s+t.amount;},0);
  var totalInc  = incomes.reduce(function(s,t){return s+t.amount;},0);
  var net       = totalInc - totalExp;

  document.getElementById('stat-income').textContent  = fmtMoney(totalInc);
  document.getElementById('stat-expense').textContent = fmtMoney(totalExp);
  var netEl = document.getElementById('stat-net');
  netEl.textContent = fmtMoney(net);
  netEl.className = 'pill-val pill-net ' + (net >= 0 ? 'pos' : 'neg');

  // Category breakdown (regular expenses only, excluding project expenses)
  var bycat = {};
  regularExpenses.forEach(function(e){ bycat[e.category]=(bycat[e.category]||0)+e.amount; });
  var sorted = Object.keys(bycat).sort(function(a,b){return bycat[b]-bycat[a];}).slice(0,6);
  var maxAmt = sorted.length ? bycat[sorted[0]] : 1;
  var html = '';
  if (!sorted.length) {
    html = '<div class="empty"><div class="empty-icon">📭</div><p>No expenses this month</p></div>';
  } else {
    sorted.forEach(function(cat) {
      var pct = Math.round(bycat[cat]/maxAmt*100);
      var color = catColor(cat, expCategories);
      html += '<div class="cat-row">' +
        '<div class="cat-dot" style="background:'+color+'"></div>' +
        '<div class="cat-name">'+catIcon(cat)+' '+cat+'</div>' +
        '<div class="cat-bar-wrap"><div class="cat-bar" style="width:'+pct+'%;background:'+color+'"></div></div>' +
        '<div class="cat-amount">'+fmtMoney(bycat[cat])+'</div>' +
      '</div>';
    });
  }
  document.getElementById('cat-breakdown').innerHTML = html;

  // Recent 5 transactions
  var recent = transactions.slice(0,5);
  var rhtml = recent.length ? recent.map(txnHtml).join('') :
    '<div class="empty"><div class="empty-icon">📭</div><p>No activity this month</p></div>';
  document.getElementById('recent-list').innerHTML = rhtml;
  renderTrend();
  var yrEl = document.getElementById('year-review-yr');
  if (yrEl) yrEl.textContent = viewYear;
}

// ════════════════════════════════════════════
//  UPCOMING BILLS (dashboard) — next 30 days
// ════════════════════════════════════════════
function ymdClamp(y, m, d) {           // m may overflow; day clamped to month length
  var first = new Date(y, m - 1, 1), yy = first.getFullYear(), mm = first.getMonth() + 1;
  var dim = new Date(yy, mm, 0).getDate();
  return yy + '-' + pad(mm) + '-' + pad(Math.min(d, dim));
}
function addDaysStr(str, n) { var d = new Date(str+'T00:00:00'); d.setDate(d.getDate() + n); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
function upcomingBills() {
  var today = todayStr(), limit = addDaysStr(today, 30), now = new Date(), items = [];
  recurringExpenses.forEach(function(r) {
    if (r.status !== 'active' || !r.amount) return;
    for (var k = 0; k < 14; k++) {
      var cm = new Date(now.getFullYear(), now.getMonth() + k, 1);
      if (r.frequency === 'yearly' && cm.getMonth() + 1 !== (r.monthOfYear || 1)) continue;
      var c = ymdClamp(now.getFullYear(), now.getMonth() + 1 + k, r.dayOfMonth);
      if (c < today || (r.startDate && c < r.startDate) || (r.lastGenerated && c <= r.lastGenerated)) continue;
      if (c <= limit) items.push({ date:c, name:r.description, sub:(r.frequency === 'yearly' ? 'Yearly' : 'Monthly')+' · '+(r.account||''), amount:r.amount });
      break;
    }
  });
  installmentPlans.forEach(function(p) {
    if (p.status !== 'active' || !p.nextInstallmentDate || p.nextInstallmentDate > limit) return;
    items.push({ date:p.nextInstallmentDate, name:p.description, late:p.nextInstallmentDate < today,
      sub:'Installment '+((p.installmentsPaid||0)+1)+'/'+p.installmentCount+(p.account ? ' · '+p.account : ''), amount:p.installmentAmount });
  });
  accounts.forEach(function(a) {
    if (a.type !== 'credit') return;
    var st = a.statement;
    if (st && st.dueDate) {
      if (st.leftToPay > 0 && st.dueDate <= limit)
        items.push({ date:st.dueDate, name:a.name+' bill', late:st.dueDate < today, card:true,
          sub:'Statement '+fmtDate(st.lastStart)+' – '+fmtDate(st.lastEnd), amount:st.leftToPay });
    } else if (a.dueDay && ccOwed(a) > 0 && !isCCPaidThisMonth(a.name)) {
      var nd = nextDueDate(a.dueDay), ds = nd.getFullYear()+'-'+pad(nd.getMonth()+1)+'-'+pad(nd.getDate());
      if (ds <= limit) items.push({ date:ds, name:a.name+' bill', card:true, sub:'Card balance', amount:ccOwed(a) });
    }
  });
  return items.sort(function(x, y){ return x.date.localeCompare(y.date); });
}
function renderUpcoming() {
  var card = document.getElementById('upcoming-card');
  if (!card) return;
  var items = upcomingBills();
  if (!items.length) { card.style.display = 'none'; return; }
  card.style.display = '';
  var total = items.reduce(function(s, x){ return s + (x.amount || 0); }, 0);
  document.getElementById('upcoming-total').textContent = fmtMoney(total) + ' in the next 30 days';
  var shown = items.slice(0, 6);
  document.getElementById('upcoming-list').innerHTML = shown.map(function(x) {
    var d = new Date(x.date+'T00:00:00'), days = daysUntil(d);
    var when = x.late ? 'overdue' : days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'in '+days+' days';
    return '<div class="up-row'+(x.late ? ' late' : '')+'"'+(x.card ? ' onclick="showPage(\'accounts\')" style="cursor:pointer"' : '')+'>' +
      '<div class="up-date"><div class="d">'+d.getDate()+'</div><div class="m">'+SHORT_MON[d.getMonth()]+'</div></div>' +
      '<div style="min-width:0"><div class="up-name">'+recEsc(x.name)+'</div><div class="up-sub">'+recEsc(x.sub)+' · '+when+'</div></div>' +
      '<div class="up-amt">'+fmtMoney(x.amount)+'</div></div>';
  }).join('') + (items.length > shown.length ? '<div class="up-more">+'+(items.length - shown.length)+' more</div>' : '');
}

// ════════════════════════════════════════════
//  SPENDING TREND (dashboard)
// ════════════════════════════════════════════
var SHORT_MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
var trendHot = -1;
function trendSelIdx() {
  for (var i = 0; i < trends.length; i++) if (trends[i].year === viewYear && trends[i].month === viewMonth) return i;
  return -1;
}
// Average regular spending of the (up to) 6 months before month i that have any spending
function trendAvg(i, cat) {
  var vals = [];
  for (var j = i - 1; j >= 0 && vals.length < 6; j--) {
    if (!trends[j].expense) continue;
    vals.push(cat ? (trends[j].byCat[cat] || 0) : trends[j].expense);
  }
  return vals.length ? vals.reduce(function(a,b){ return a+b; }, 0) / vals.length : null;
}
// Share of month i that has passed (1 for past months) — the current month is compared
// with the same share of the average, so day 10 isn't judged against a full month.
function trendElapsed(i) {
  var m = trends[i], now = new Date();
  if (!m || m.year !== now.getFullYear() || m.month !== now.getMonth() + 1) return 1;
  return now.getDate() / new Date(m.year, m.month, 0).getDate();
}
function pctTxt(cur, avg) {
  if (avg === null || avg <= 0) return '';
  var d = Math.round((cur - avg) / avg * 100);
  if (d === 0) return '<span>same as avg</span>';
  return '<span class="'+(d > 0 ? 'tr-up' : 'tr-down')+'">'+(d > 0 ? '▲ ' : '▼ ')+Math.abs(d)+'%</span> vs avg';
}
function renderTrend() {
  var card = document.getElementById('trend-card');
  if (!card) return;
  if (!trends.length) { card.style.display = 'none'; return; }
  card.style.display = '';
  var sel = trendSelIdx();
  var W = 340, H = 128, padT = 8, padB = 18, n = trends.length, gap = 6;
  var bw = (W - gap * (n - 1)) / n;
  var max = Math.max.apply(null, trends.map(function(m){ return m.expense; }).concat([1]));
  var avgSel = sel >= 0 ? trendAvg(sel) : trendAvg(n);
  var y = function(v){ return padT + (H - padT - padB) * (1 - v / max); };
  var base = H - padB;
  var svg = '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Regular spending per month for the last 12 months">';
  trends.forEach(function(m, i) {
    var x = i * (bw + gap), top = y(m.expense), h = Math.max(0, base - top);
    var r = Math.min(4, bw / 2, h);
    var cls = 'tb' + (i === sel ? ' sel' : '') + (i === trendHot ? ' hot' : '');
    if (h > 0) svg += '<path class="'+cls+'" data-i="'+i+'" d="M'+x+','+base+' V'+(top+r)+' Q'+x+','+top+' '+(x+r)+','+top+' H'+(x+bw-r)+' Q'+(x+bw)+','+top+' '+(x+bw)+','+(top+r)+' V'+base+' Z"/>';
    svg += '<text class="tlbl'+(i === sel ? ' sel' : '')+'" x="'+(x + bw/2)+'" y="'+(H - 5)+'">'+SHORT_MON[m.month-1].charAt(0)+'</text>';
    svg += '<rect class="thit" x="'+(x - gap/2)+'" y="0" width="'+(bw + gap)+'" height="'+H+'" onmouseenter="trendHover('+i+')" onmouseleave="trendHover(-1)" onclick="trendHover('+i+', true)"><title>'+SHORT_MON[m.month-1]+' '+m.year+': '+fmtMoney(m.expense)+'</title></rect>';
  });
  svg += '<line class="tbase" x1="0" x2="'+W+'" y1="'+base+'" y2="'+base+'"/>';
  if (avgSel) {
    svg += '<line class="tavg" x1="0" x2="'+W+'" y1="'+y(avgSel)+'" y2="'+y(avgSel)+'"/>';
    svg += '<text class="tavg-lbl" x="'+W+'" y="'+(y(avgSel) - 3)+'">6-mo avg</text>';
  }
  svg += '</svg>';
  document.getElementById('trend-chart').innerHTML = svg;
  renderTrendReadout(trendHot >= 0 ? trendHot : sel);
  renderTrendCats(sel);
}
function trendHover(i, sticky) {
  trendHot = i;
  document.querySelectorAll('#trend-chart .tb').forEach(function(el){ el.classList.remove('hot'); });
  var bar = i >= 0 ? document.querySelector('#trend-chart path.tb[data-i="'+i+'"]') : null;
  if (bar) bar.classList.add('hot');
  renderTrendReadout(i >= 0 ? i : trendSelIdx());
}
function renderTrendReadout(i) {
  var el = document.getElementById('trend-readout');
  if (i < 0 || !trends[i]) { el.innerHTML = '<div class="tr-month">Tap a bar to see that month</div>'; return; }
  var m = trends[i], avg = trendAvg(i), f = trendElapsed(i);
  var soFar = f < 1 ? ' · so far' : '';
  el.innerHTML = '<div><div class="tr-month">'+MONTH_NAMES[m.month-1]+' '+m.year+soFar+(m.projectExpense ? ' · +'+fmtMoney(m.projectExpense)+' projects' : '')+'</div>' +
    '<div class="tr-val">'+fmtMoney(m.expense)+'</div></div>' +
    '<div class="tr-cmp">'+(avg !== null ? pctTxt(m.expense, avg * f)+'<br>'+(f < 1 ? 'usual by today ' : 'avg ')+fmtMoney(Math.round(avg * f)) : 'not enough history yet')+'</div>';
}
function renderTrendCats(sel) {
  var el = document.getElementById('trend-cats');
  if (sel < 0) { el.innerHTML = ''; return; }
  var m = trends[sel];
  var cats = Object.keys(m.byCat).sort(function(a,b){ return m.byCat[b] - m.byCat[a]; }).slice(0, 5);
  if (!cats.length || trendAvg(sel) === null) { el.innerHTML = ''; return; }
  var f = trendElapsed(sel);
  el.innerHTML = '<div class="trend-cats-title">'+(f < 1 ? 'So far vs your usual by this day' : 'This month vs your average')+'</div>' + cats.map(function(c) {
    var avg = trendAvg(sel, c);
    if (avg) avg *= f;
    return '<div class="trend-cat"><div class="tc-name">'+catIcon(c)+' '+recEsc(c)+'</div>' +
      '<div class="tc-amt">'+fmtMoney(m.byCat[c])+'</div>' +
      '<div class="tc-cmp">'+(avg ? pctTxt(m.byCat[c], avg) : 'new')+'</div></div>';
  }).join('');
}

