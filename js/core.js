// Money Tracker — State, theme, start-up, API calls, offline queue, navigation and shared helpers.
// Loaded as a plain <script> (not a module): functions are global so onclick="..." handlers work.

// ════════════════════════════════════════════
//  STATE
// ════════════════════════════════════════════
var SCRIPT_URL = localStorage.getItem('moneyScriptUrl') || '';
var API_TOKEN  = '';
try { API_TOKEN = localStorage.getItem('moneyToken') || ''; } catch(e) {}
var viewMonth  = new Date().getMonth() + 1;
var viewYear   = new Date().getFullYear();

var accounts     = [];
var totalBalance = 0;
var expCategories  = [];
var incCategories  = [];
var transactions = [];
var projects     = [];
var receivables  = [];
var installmentPlans = [];
var budgets = [];
var accountsEditMode = false;
var activeTypeTab    = 'all';
var activeProjectsTab = 'projects';
var activeRecvTab    = 'pending';
var editingExpenseRow      = null;
var editingTransferRow     = null;
var editingReceivableRow   = null;
var editingInstallmentRow  = null;
var editingIncomeRow   = null;
var editingAccountRow  = null;
var editingAccountKey  = '';
var editingProjectRow  = null;
var editingProjectKey  = '';
var editingBudgetId    = null;
var annualSummaryYear  = new Date().getFullYear();
var balanceMode  = localStorage.getItem('balanceMode') || 'net_worth';

// ── Theme (auto / light / dark) ──
function themePref() { try { return localStorage.getItem('themePref') || 'auto'; } catch(e) { return 'auto'; } }
function applyTheme() {
  var pref = themePref();
  var dark = pref==='dark' || (pref==='auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  var m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = dark ? '#0d0e12' : '#1b1e2a';
  document.querySelectorAll('.theme-opt').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-pref')===pref); });
}
function setThemePref(p) { try { localStorage.setItem('themePref', p); } catch(e) {} applyTheme(); }
if (window.matchMedia) {
  var _mq = matchMedia('(prefers-color-scheme: dark)');
  (_mq.addEventListener ? _mq.addEventListener('change', applyTheme) : _mq.addListener && _mq.addListener(applyTheme));
}
document.addEventListener('DOMContentLoaded', applyTheme);
var BALANCE_MODES = {
  net_worth:       { label: 'Net Worth',       sub: 'accounts + investments + owed to you − debts' },
  monthly_balance: { label: 'Monthly Balance', sub: 'income minus expenses this month' },
  available_cash:  { label: 'Available Cash',  sub: 'cash & bank accounts only' },
  portfolio:       { label: 'Investments',     sub: 'current value of gold, stocks, funds…' }
};

var MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
var ACCT_ICONS  = { cash:'💵', bank:'🏦', investment:'📈', wallet:'📱', credit:'💳' };
var CAT_ICONS   = { "Food & Dining":"🍜","Transport":"🚗","Shopping":"🛍️","Bills & Utilities":"💡","Healthcare":"💊","Entertainment":"🎬","Education":"📚","Personal Care":"✨","Travel":"✈️","Savings":"🏦","Other":"📌","Salary":"💼","Investment Returns":"📈","Freelance":"💻","Bonus":"🎁","Other Income":"💰" };
var recurringExpenses = [];
var trends = [];
var backupInfo = null;
var netWorthHist = [], priceInfo = null;
var holdings = [], holdingTotals = { value: 0, investments: 0, assets: 0, cost: 0, unrealized: 0 };
var CAT_COLORS  = ["#64748b","#ff6584","#22c55e","#f59e0b","#3b82f6","#ec4899","#14b8a6","#f97316","#eab308","#06b6d4","#84cc16","#e11d48","#0891b2"];

// Icon for a category: the one you picked (saved in the sheet) → built-in → a guess from the name → 📌
function catIcon(n) {
  var c = expCategories.find(function(x){ return x.name === n; }) || incCategories.find(function(x){ return x.name === n; });
  if (c && c.icon) return c.icon;
  return CAT_ICONS[n] || guessIcon(n) || "📌";
}
var ICON_GUESS = [
  [/coffee|tea|cafe|café|starbucks|boba/i,'☕'], [/grocer|supermarket|market|makro|lotus|big ?c/i,'🛒'], [/daily/i,'🧾'],
  [/subscri|netflix|spotify|youtube|stream/i,'📺'], [/home|decor|furnitur|ikea/i,'🛋️'], [/fee|charge|bank/i,'🏧'],
  [/rent|condo|house/i,'🏠'], [/insur/i,'🛡️'], [/fuel|gas|petrol|oil/i,'⛽'], [/park/i,'🅿️'], [/car|vehicle/i,'🚗'],
  [/taxi|grab|bolt|bts|mrt|train|bus/i,'🚕'], [/flight|airline|travel|trip|hotel/i,'✈️'], [/phone|mobile/i,'📱'], [/internet|wifi/i,'🌐'],
  [/electric|water|utilit|bill/i,'💡'], [/gym|fitness|sport|run|golf/i,'🏋️'], [/doctor|hospital|clinic|medic|pharm|health/i,'💊'],
  [/beauty|hair|salon|spa|massage|personal/i,'💆'], [/cloth|fashion|shoe|uniqlo/i,'👕'], [/shop/i,'🛍️'], [/gift|present/i,'🎁'],
  [/donat|charity|merit|temple/i,'🙏'], [/tax/i,'🏛️'], [/invest|stock|fund/i,'📈'], [/pet|dog|cat\b/i,'🐾'], [/kid|child|baby|school/i,'🧸'],
  [/book|course|educat|learn/i,'📚'], [/game|steam|playstation|nintendo/i,'🎮'], [/movie|cinema|concert|entertain/i,'🎬'],
  [/drink|beer|bar|alcohol|wine/i,'🍺'], [/food|dining|restaurant|lunch|dinner|eat/i,'🍜'], [/family|parent|mom|dad/i,'👨‍👩‍👧'],
  [/salary|wage|pay/i,'💼'], [/bonus/i,'🎁'], [/interest|dividend|return/i,'📈'], [/refund|cashback/i,'↩️'], [/saving/i,'🏦']
];
function guessIcon(n) { n = String(n || ''); for (var i = 0; i < ICON_GUESS.length; i++) if (ICON_GUESS[i][0].test(n)) return ICON_GUESS[i][1]; return ''; }
function catColor(n, list) {
  var idx = list.findIndex(function(c){ return c.name === n; });
  return CAT_COLORS[Math.max(idx,0) % CAT_COLORS.length];
}
var CUR_SYM = {USD:'$',EUR:'€',GBP:'£',JPY:'¥',SGD:'S$',CNY:'¥',AUD:'A$'};
function acctByName(n) { return accounts.find(function(a){ return a.name === n; }) || null; }
function curOf(n)  { var a = acctByName(n); return (a && a.currency) ? a.currency : 'THB'; }
function rateOf(n) { var a = acctByName(n); return (a && a.rate) ? a.rate : 1; }
function curSym(c) { return c === 'THB' ? '฿' : (CUR_SYM[c] || c); }
function fmtCur(n, cur) {
  if (!cur || cur === 'THB') return fmtMoney(n);
  return (CUR_SYM[cur] || cur + ' ') + (privacyOn ? MASK : parseFloat(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}));
}
function acctThb(a) { return a.balanceThb !== undefined ? a.balanceThb : a.balance; }
function round2(n) { return Math.round(n * 100) / 100; }
// Expense / income forms: the amount is typed in the selected account's own currency
var editingFx = null;
function fxUpdate(p) {
  var acct = getSelectedAcct(p + '-acct-list'), cur = acct ? curOf(acct) : 'THB', rate = acct ? rateOf(acct) : 1;
  var foreign = cur !== 'THB';
  document.getElementById(p + '-amount-label').textContent = 'Amount (' + (foreign ? cur : '฿') + ')';
  document.getElementById(p + '-prefix').textContent = curSym(cur);
  var hint = document.getElementById(p + '-fx');
  if (!foreign) { hint.style.display = 'none'; return; }
  var v = parseFloat(document.getElementById(p + '-amount').value) || 0;
  hint.style.display = 'block';
  hint.textContent = '≈ ' + fmtMoney(v * rate) + '  ·  1 ' + cur + ' = ฿' + rate;
}
function fxPayload(val, acct) {
  var cur = acct ? curOf(acct) : 'THB';
  if (cur === 'THB') {
    return editingFx ? { amount: val, origAmount: editingFx.origAmount, currency: editingFx.currency } : { amount: val };
  }
  return { amount: round2(val * rateOf(acct)), origAmount: val, currency: cur };
}
function fxEditValue(t) {
  var cur = curOf(t.account);
  if (cur === 'THB') return t.amount;
  return (t.origAmount && t.currency === cur) ? t.origAmount : round2(t.amount / rateOf(t.account));
}
function fxKeep(t) { return (t && t.origAmount && t.currency && curOf(t.account) === 'THB') ? { origAmount: t.origAmount, currency: t.currency } : null; }
// Transfer form: amount sent is in the From currency; when the currencies differ we also ask for the amount received
function ftUpdate() {
  var from = document.getElementById('ft-from').value, to = document.getElementById('ft-to').value;
  var fc = curOf(from), tc = curOf(to), diff = fc !== tc;
  document.getElementById('ft-amount-label').textContent = 'Amount sent (' + (fc === 'THB' ? '฿' : fc) + ')';
  document.getElementById('ft-prefix').textContent = curSym(fc);
  document.getElementById('ft-recv-group').style.display = diff ? 'block' : 'none';
  if (!diff) return;
  document.getElementById('ft-recv-label').textContent = 'Amount received (' + (tc === 'THB' ? '฿' : tc) + ')';
  document.getElementById('ft-recv-prefix').textContent = curSym(tc);
  var rc = document.getElementById('ft-received');
  var amt = parseFloat(document.getElementById('ft-amount').value) || 0;
  var est = round2(amt * rateOf(from) / rateOf(to));
  if (rc.dataset.touched !== '1') rc.value = amt ? est : '';
  document.getElementById('ft-recv-hint').textContent = 'Estimated from your rates: ' + fmtCur(est, tc) + ' — type the exact amount your bank gave.';
}
function acctIcon(type) { return ACCT_ICONS[type] || '💳'; }
function sortedAccounts() {
  var ORDER = ['bank','cash','wallet','investment','credit'];
  return accounts.slice().sort(function(a, b) {
    var ai = ORDER.indexOf(a.type), bi = ORDER.indexOf(b.type);
    if (ai === -1) ai = 99; if (bi === -1) bi = 99;
    return ai !== bi ? ai - bi : a.name.localeCompare(b.name);
  });
}
// Privacy mode: every amount drawn through these helpers shows as dots (remembered on this device)
var privacyOn = false;
try { privacyOn = localStorage.getItem('privacyOn') === '1'; } catch(e) {}
var MASK = '••••';
function fmtMoney(n) { return privacyOn ? '฿' + MASK : "฿" + parseFloat(n||0).toLocaleString('th-TH',{minimumFractionDigits:0,maximumFractionDigits:2}); }
function togglePrivacy() {
  privacyOn = !privacyOn;
  try { localStorage.setItem('privacyOn', privacyOn ? '1' : '0'); } catch(e) {}
  syncPrivacyBtn();
  renderAll();
  toast(privacyOn ? 'Amounts hidden' : 'Amounts shown');
}
function syncPrivacyBtn() {
  var b = document.getElementById('privacy-btn');
  if (!b) return;
  b.textContent = privacyOn ? '🙈' : '👁️';
  b.title = privacyOn ? 'Show amounts' : 'Hide amounts';
  document.documentElement.classList.toggle('privacy', privacyOn);
}
document.addEventListener('DOMContentLoaded', syncPrivacyBtn);
function fmtDateY(str) { if(!str)return''; var d=new Date(str+'T00:00:00'); return d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}); }
function fmtDate(str) { if(!str)return''; var d=new Date(str+'T00:00:00'); return d.toLocaleDateString('en-GB',{day:'numeric',month:'short'}); }
function todayStr() { var d=new Date(); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
function pad(n) { return n<10?'0'+n:''+n; }

// ════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════
// Home-screen shortcut (long-press the app icon): index.html?add=expense | quick | income
var LAUNCH_ACTION = null;
try { LAUNCH_ACTION = new URLSearchParams(location.search).get('add'); } catch(e) {}
function runLaunchAction() {
  if (!LAUNCH_ACTION || !accounts.length) return;
  var a = LAUNCH_ACTION; LAUNCH_ACTION = null;
  try { history.replaceState(null, '', location.pathname); } catch(e) {}
  setTimeout(function() {
    if (a === 'expense') openExpenseForm();
    else if (a === 'income') openIncomeForm();
    else if (a === 'quick') openAddChooser();
  }, 150);
}

window.addEventListener('DOMContentLoaded', function() {
  if (!SCRIPT_URL) {
    show('setup-screen');
  } else {
    hide('setup-screen');
    show('app');
    document.getElementById('settings-url').value = SCRIPT_URL;
    document.getElementById('settings-token').value = API_TOKEN;
    updateMonthLabel();
    loadAll();
  }
  updateSyncBadge();
});
window.addEventListener('online',  function(){ updateSyncBadge(); if (SCRIPT_URL) loadAll(); });
window.addEventListener('offline', updateSyncBadge);
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', function(){ navigator.serviceWorker.register('sw.js').catch(function(){}); });
}

function show(id) { document.getElementById(id).style.display='flex'; }
function hide(id) { document.getElementById(id).style.display='none'; }

function saveScriptUrl() {
  var url = document.getElementById('script-url-input').value.trim();
  if (!url.startsWith('http')) { toast('Please enter a valid URL'); return; }
  var tok = document.getElementById('script-token-input').value.trim();
  if (!tok) { toast('Paste the access token from setupToken()'); return; }
  localStorage.setItem('moneyScriptUrl', url);
  localStorage.setItem('moneyToken', tok);
  SCRIPT_URL = url; API_TOKEN = tok;
  hide('setup-screen'); show('app');
  document.getElementById('settings-url').value = url;
  document.getElementById('settings-token').value = tok;
  updateMonthLabel();
  loadAll();
}
function updateScriptUrl() {
  var url = document.getElementById('settings-url').value.trim();
  if (!url.startsWith('http')) { toast('Please enter a valid URL'); return; }
  var tok = document.getElementById('settings-token').value.trim();
  localStorage.setItem('moneyScriptUrl', url);
  localStorage.setItem('moneyToken', tok);
  SCRIPT_URL = url; API_TOKEN = tok;
  toast('Connection saved');
  closeModal('settings-modal');
  loadAll();
}

// ════════════════════════════════════════════
//  API
// ════════════════════════════════════════════
function newClientId(prefix) {
  var r = (window.crypto && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, '') : (Date.now().toString(16) + Math.random().toString(16).slice(2));
  return prefix + r.slice(0, 10);
}

function rawApi(payload, retries) {
  if (retries === undefined) retries = 2;
  return fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(Object.assign({}, payload, { token: API_TOKEN }))
  }).then(function(r){ return r.json(); }).catch(function(err) {
    if (retries <= 0) throw err;
    return new Promise(function(res){ setTimeout(res, 800 * (3 - retries)); })
      .then(function(){ return rawApi(payload, retries - 1); });
  });
}

var authWarned = false;
function api(payload, retries) {
  var queueable = QUEUEABLE[payload.action];
  if (queueable && /^add/.test(payload.action) && !payload.id) payload.id = newClientId(queueable);
  if (queueable && !payload.id) queueable = null;          // edits/deletes need the row id to be safe
  if (queueable && navigator.onLine === false) return Promise.resolve(enqueue(payload));
  return rawApi(payload, retries).then(function(res) {
    if (res && res.auth) {
      if (!authWarned) { authWarned = true; setTimeout(function(){ authWarned = false; }, 4000);
        setTimeout(function(){ toast(res.error === 'unauthorized' ? 'Access token is wrong or missing — check Settings' : res.error); }, 50); }
    } else if (res && res.stale) {
      setTimeout(loadAll, 300);
    }
    return res;
  }).catch(function(err) {
    if (queueable) return enqueue(payload);     // network down: keep it and send later
    throw err;
  });
}

// ════════════════════════════════════════════
//  OFFLINE QUEUE — new expenses / income / transfers made without signal
//  are kept on this device and sent when the connection is back. Each carries
//  its own id, so a resend can never create a duplicate row.
// ════════════════════════════════════════════
// Saved on the device while offline, sent in order when back online
var QUEUEABLE = { addExpense: 'E', addIncome: 'I', addTransfer: 'T',
  updateExpense: 'E', updateIncome: 'I', updateTransfer: 'T',
  deleteExpense: 'E', deleteIncome: 'I', deleteTransfer: 'T' };
var ACTION_TYPE = { Expense: 'expense', Income: 'income', Transfer: 'transfer' };
function opType(action) { return ACTION_TYPE[action.replace(/^(add|update|delete)/, '')]; }
var QUEUE_KEY = 'moneyQueue_v1';
function getQueue() { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch(e) { return []; } }
function setQueue(q) { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch(e) {} updateSyncBadge(); }
function enqueue(payload) {
  var q = getQueue(), item = Object.assign({}, payload);
  delete item.checkDup;                                   // asked already, on this device
  if (/^add/.test(item.action) && q.some(function(x){ return x.action === item.action && x.id === item.id; })) return { ok: true, queued: true, id: item.id };
  item.qid = newClientId('Q');
  q.push(item);
  setQueue(q);
  return { ok: true, queued: true, id: item.id };
}
function sendable(item) { var c = Object.assign({}, item); delete c.qid; return c; }
var flushing = null;
function flushQueue() {
  if (flushing) return flushing;
  var q = getQueue();
  if (!q.length || !SCRIPT_URL) return Promise.resolve(0);
  var sent = 0, stale = 0;
  flushing = q.reduce(function(chain, item) {
    return chain.then(function(stop) {
      if (stop) return true;
      return rawApi(sendable(item), 1).then(function(res) {
        var drop = function(){ setQueue(getQueue().filter(function(x){ return x.qid ? x.qid !== item.qid : x.id !== item.id; })); };
        if (res && res.ok) { sent++; drop(); return false; }
        if (res && res.stale) { drop(); stale++; return false; }   // row was changed/deleted on another device
        return true;                       // server refused (e.g. token) — keep it, try later
      }).catch(function(){ return true; }); // still offline
    });
  }, Promise.resolve(false)).then(function() {
    flushing = null;
    if (sent) toast(sent + ' offline ' + (sent === 1 ? 'change' : 'changes') + ' synced' + (stale ? ' · ' + stale + ' skipped (changed on another device)' : ''));
    else if (stale) toast(stale + ' offline change(s) skipped — the item was changed on another device');
    return sent;
  });
  return flushing;
}
// Show the server data with the waiting offline changes applied on top
var serverTxns = [];
function inViewMonth(date) { return date && parseInt(date.substring(0,4)) === viewYear && parseInt(date.substring(5,7)) === viewMonth; }
function txnFields(op) {
  var f = Object.assign({}, op); ['action','qid','token','checkDup','rowIndex'].forEach(function(k){ delete f[k]; });
  return f;
}
function mergePending() {
  var list = serverTxns.map(function(t){ return Object.assign({}, t); });
  var byId = {}; list.forEach(function(t){ if (t.id) byId[t.id] = t; });
  getQueue().forEach(function(op, k) {
    var type = opType(op.action);
    if (!type) return;
    if (/^add/.test(op.action)) {
      if (byId[op.id] || !inViewMonth(op.date)) return;
      var t = Object.assign(txnFields(op), { type: type, pending: true, queuedAdd: true, rowIndex: -(k + 1) });
      list.push(t); byId[op.id] = t;
    } else if (/^update/.test(op.action)) {
      if (byId[op.id]) Object.assign(byId[op.id], txnFields(op), { pending: true });
    } else if (/^delete/.test(op.action)) {
      list = list.filter(function(t){ return t.id !== op.id; });
    }
  });
  transactions = list.sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); });
}
// Change a not-yet-sent new entry in place (edit) or drop it (delete)
function editQueuedAdd(id, fields) {
  setQueue(getQueue().map(function(x){ return (/^add/.test(x.action) && x.id === id) ? Object.assign(x, fields, { action: x.action, id: id, qid: x.qid }) : x; }));
}
function dropQueuedAdd(id) { setQueue(getQueue().filter(function(x){ return !(/^add/.test(x.action) && x.id === id); })); }
// Possible duplicate in what's on screen (used when offline; online the server checks every month)
function localDup(type, p) {
  return transactions.find(function(t) {
    if (t.type !== type || t.date !== p.date || Math.abs(t.amount - p.amount) > 0.005) return false;
    return type === 'transfer' ? (t.fromAccount === p.fromAccount && t.toAccount === p.toAccount) : t.account === p.account;
  }) || null;
}
function dupMessage(m, type) {
  return 'This looks like a duplicate of:\n\n' + fmtMoney(m.amount) + (m.category ? ' · ' + m.category : '') +
    ' · ' + (m.account || ((m.fromAccount||'') + ' → ' + (m.toAccount||''))) + (m.note ? ' · "' + m.note + '"' : '') + '\non ' + fmtDateY(m.date) +
    '\n\nSave it anyway?';
}
// Save with duplicate check: returns the final server/queue result, or null if the user cancelled
function saveWithDupCheck(payload, type) {
  if (!/^add/.test(payload.action)) return api(payload);
  if (navigator.onLine === false) {
    var m = localDup(type, payload);
    if (m && !confirm(dupMessage(m, type))) return Promise.resolve(null);
    return api(payload);
  }
  payload.checkDup = true;
  return api(payload).then(function(res) {
    if (res && res.possibleDuplicate) {
      if (!confirm(dupMessage(res.match, type))) return null;
      payload.checkDup = false;
      return api(payload);
    }
    return res;
  });
}
function refreshPending() { mergePending(); renderDashboard(); renderTransactions(); updateSyncBadge(); }
function updateSyncBadge() {
  var el = document.getElementById('sync-badge');
  if (!el) return;
  var n = getQueue().length, off = navigator.onLine === false;
  if (!n && !off) { el.style.display = 'none'; return; }
  el.style.display = 'inline-block';
  el.textContent = (off ? 'Offline' : 'Syncing') + (n ? ' · ' + n + ' waiting' : '');
}
var OFFLINE_SAVED = 'Saved on this device — will sync when online';

var CACHE_KEY = 'moneyCache_v1';

function applyData(d) {
  if (d.accounts && d.accounts.ok)         { accounts=d.accounts.accounts; totalBalance=d.accounts.totalBalance; }
  if (d.categories && d.categories.ok)     { expCategories=d.categories.categories; }
  if (d.incomeCategories && d.incomeCategories.ok) { incCategories=d.incomeCategories.categories; }
  if (d.transactions && d.transactions.ok) { serverTxns=d.transactions.transactions; mergePending(); }
  if (d.projects && d.projects.ok)         { projects=d.projects.projects; }
  if (d.receivables && d.receivables.ok)   { receivables=d.receivables.receivables; }
  if (d.installmentPlans && d.installmentPlans.ok) { installmentPlans=d.installmentPlans.installmentPlans||[]; }
  if (d.budgets && d.budgets.ok)           { budgets=d.budgets.budgets||[]; }
  if (d.recurringExpenses && d.recurringExpenses.ok) { recurringExpenses=d.recurringExpenses.recurring||[]; }
  if (d.trends && d.trends.ok) { trends=d.trends.months||[]; }
  if (d.backup) { backupInfo = d.backup; }
  if (d.history && d.history.ok) { setHistory(d.history); }
  if (d.netWorth && d.netWorth.ok) { netWorthHist = d.netWorth.months || []; }
  if (d.prices) { priceInfo = d.prices; }
  if (d.holdings && d.holdings.ok) { holdings = d.holdings.holdings || []; holdingTotals = d.holdings.totals || holdingTotals; }
  renderAll();
  runLaunchAction();
}

function saveCache(d) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({m:viewMonth, y:viewYear, d:d})); } catch(e) {}
}

function loadCache() {
  try {
    var c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (c && c.m === viewMonth && c.y === viewYear && c.d) { applyData(c.d); return true; }
  } catch(e) {}
  return false;
}

// Fallback for a backend that has not been redeployed with 'bootstrap' yet
function fetchLegacy() {
  return Promise.all([
    api({action:'getAccounts'}), api({action:'getCategories'}), api({action:'getIncomeCategories'}),
    api({action:'getAllTransactions', month:viewMonth, year:viewYear}),
    api({action:'getProjects'}), api({action:'getReceivables'}),
    api({action:'getInstallmentPlans'}), api({action:'getBudgets', month:viewMonth, year:viewYear})
  ]).then(function(r) {
    return { ok:true, accounts:r[0], categories:r[1], incomeCategories:r[2], transactions:r[3],
             projects:r[4], receivables:r[5], installmentPlans:r[6], budgets:r[7] };
  });
}

var firstLoad = true;
function loadAll() {
  // Show last-known data instantly on the first open, then refresh in the background
  var hadCache = firstLoad ? loadCache() : false;
  firstLoad = false;
  return flushQueue().then(function(){ return api({action:'bootstrap', month:viewMonth, year:viewYear, runChecks:true}); }).then(function(res) {
    if (res && res.auth) throw new Error('auth');
    if (res && res.ok === false && /Unknown action/.test(res.error || '')) return fetchLegacy();
    return res;
  }).then(function(d) {
    applyData(d);
    saveCache(d);
    if (searchAll && searchResults) onSearchInput();
    if (d.checked) return;   // new backend: due installments/recurring were already created in the same call
    // Older backend: generate due installments, then recurring expenses; refresh only if something was created
    api({action:'checkInstallments'}, 0).then(function(r) {
      var n = (r && r.ok && r.generated) || 0;
      return api({action:'checkRecurring'}, 0).then(function(r2) { return n + ((r2 && r2.ok && r2.generated) || 0); });
    }).then(function(n) { if (n > 0) loadAll(); }).catch(function(){});
  }).catch(function(e) {
    console.error(e);
    if (e && e.message === 'auth') return;
    refreshPending();
    var n = getQueue().length;
    toast((hadCache || transactions.length ? 'Offline — showing saved data' : 'Connection error - reload to retry') + (n ? ' · ' + n + ' waiting to sync' : ''));
  });
}

function loadTransactions() {
  return Promise.all([
    api({action:'getAllTransactions', month:viewMonth, year:viewYear}),
    api({action:'getBudgets', month:viewMonth, year:viewYear})
  ]).then(function(results){
    if (results[0].ok) { serverTxns=results[0].transactions; mergePending(); renderDashboard(); renderTransactions(); }
    if (results[1].ok) { budgets=results[1].budgets||[]; renderBudgetPlanner(); }
  });
}

function loadAccounts() {
  return api({action:'getAccounts'}).then(function(res){
    if (res.ok) { accounts=res.accounts; totalBalance=res.totalBalance; renderAccountCards(); renderAccountsPage(); }
  });
}

// ════════════════════════════════════════════
//  NAVIGATION
// ════════════════════════════════════════════
var PAGES = ['dashboard','transactions','accounts','projects'];

function showPage(name) {
  PAGES.forEach(function(p) {
    document.getElementById('page-'+p).classList.toggle('active', p===name);
    var nb = document.getElementById('nav-'+p);
    if (nb) nb.classList.toggle('active', p===name);
  });
  // Reset accounts edit mode when leaving accounts page
  if (name !== 'accounts' && accountsEditMode) {
    accountsEditMode = false;
    renderAccountsPage();
  }
}

function changeMonth(d) {
  viewMonth += d;
  if (viewMonth>12){viewMonth=1;viewYear++;}
  if (viewMonth<1) {viewMonth=12;viewYear--;}
  updateMonthLabel();
  loadTransactions().catch(function(){ serverTxns = []; refreshPending(); toast('Offline — this month is not saved on this device'); });
}
function updateMonthLabel() {
  document.getElementById('header-month-label').textContent = MONTH_NAMES[viewMonth-1]+' '+viewYear;
}

// ════════════════════════════════════════════
//  RENDER ALL
// ════════════════════════════════════════════
function renderAll() {
  renderAccountCards();
  renderAccountsPage();
  renderDashboard();
  renderTransactions();
  renderFilterBar();
  renderSettingsCats();
  renderProjectsPage();
  renderReceivables();
  renderInstallments();
  renderBudgetPlanner();
  renderRecurring();
  renderUpcoming();
  renderBackupStatus();
  renderHoldings();
  renderNetWorth();
  populateProjectDropdown();
  syncBalanceModeUI();
  // Update year review label
  var yrEl = document.getElementById('year-review-yr');
  if (yrEl) yrEl.textContent = viewYear;
}

// ════════════════════════════════════════════
//  FORM HELPERS
// ════════════════════════════════════════════
function renderCatGrid(gridId, cats, selected) {
  var html = cats.map(function(c) {
    var sel = selected===c.name ? ' selected' : '';
    return '<div class="cat-option'+sel+'" data-name="'+escAttr(c.name)+'" onclick="selectCat(this)">' +
      '<span class="cat-opt-icon">'+catIcon(c.name)+'</span>'+c.name+'</div>';
  }).join('');
  document.getElementById(gridId).innerHTML = html || '<p style="font-size:0.8rem;color:var(--text2)">No categories. Add some in Settings.</p>';
}

function selectCat(el) {
  el.closest('.cat-grid').querySelectorAll('.cat-option').forEach(function(x){x.classList.remove('selected');});
  el.classList.add('selected');
  if (el.closest('.cat-grid').id === 'fe-cat-grid') amountHint();
}

function getSelectedCat(gridId) {
  var sel = document.getElementById(gridId).querySelector('.cat-option.selected');
  if (!sel) return null;
  // Read the exact name (stripping the icon from the text left an invisible U+FE0F behind)
  return sel.getAttribute('data-name');
}

function renderAcctList(listId, selected) {
  var html = sortedAccounts().map(function(a) {
    var sel = selected===a.name ? ' selected' : '';
    return '<div class="acct-option'+sel+'" data-name="'+escAttr(a.name)+'" onclick="selectAcct(this)">'+acctIcon(a.type)+' '+a.name+'</div>';
  }).join('');
  document.getElementById(listId).innerHTML = html || '<p style="font-size:0.8rem;color:var(--text2)">No accounts yet. Add one in Accounts tab first.</p>';
}

function selectAcct(el) {
  el.closest('.acct-list').querySelectorAll('.acct-option').forEach(function(x){x.classList.remove('selected');});
  el.classList.add('selected');
  var lid = el.closest('.acct-list').id;
  if (lid === 'fe-acct-list') { fxUpdate('fe'); amountHint(); } else if (lid === 'fi-acct-list') fxUpdate('fi');
}

function getSelectedAcct(listId) {
  var sel = document.getElementById(listId).querySelector('.acct-option.selected');
  if (!sel) return null;
  return sel.getAttribute('data-name');
}

// ════════════════════════════════════════════
//  MODAL HELPERS
// ════════════════════════════════════════════
function openModal(id) {
  var el = document.getElementById(id);
  el.classList.add('open');
  el.onclick = function(e){ if(e.target===el){ el.classList.remove('open'); } };
}
function closeModal(id) { document.getElementById(id).classList.remove('open'); }


// ════════════════════════════════════════════
//  TOAST
// ════════════════════════════════════════════
var toastTimer;
function toast(msg, ms) {
  var el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ el.classList.remove('show'); }, ms || 2500);
}

// ════════════════════════════════════════════
//  UTILS
// ════════════════════════════════════════════
function escQ(s) { return String(s).replace(/'/g,"\\'"); }
function escAttr(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
// Stable id of a loaded transaction (sent with edits/deletes so the server finds the right row)
function findTxn(type, rowIndex) {
  var match = function(x){ return x.type === type && x.rowIndex === rowIndex; };
  return transactions.find(match) || (searchResults ? searchResults.transactions.find(match) : null) || null;
}
function txnId(type, rowIndex) {
  var t = findTxn(type, rowIndex);
  return t && t.id ? t.id : '';
}
function recvById(rowIndex) { return receivables.find(function(x){ return x.rowIndex === rowIndex; }) || null; }
function repaymentId(rowIndex) {
  var id = '';
  receivables.forEach(function(r){ (r.repayments||[]).forEach(function(rp){ if (rp.rowIndex === rowIndex) id = rp.id; }); });
  return id;
}

