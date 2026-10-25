// Money Tracker — Smart suggestions (pattern engine).
// Learns from your last ~6 months of expenses, entirely on this device — nothing is sent anywhere.
//  • "Quick add" chips: what you usually log at this time / on this weekday, with your usual amount & account
//  • Note autocomplete: typing "star…" offers your usual Starbucks entry
//  • Heads-up nudges: a daily habit not logged yet today, a monthly bill missing this month,
//    a repeating charge that could be made automatic
//  • Unusual amount check when saving (catches typos like 4500 instead of 45)
// Loaded as a plain <script>: functions are global so onclick="..." handlers work.

var expHistory = [];
var SUG_DISMISS_KEY = 'sugDismiss_v1';
var habitCache = null;

function setHistory(h) {
  expHistory = (h.rows || []).map(function(r) {
    return { date: r[0], amount: r[1], category: r[2], note: r[3], account: r[4], recurring: !!r[5], projectId: r[6], createdAt: r[7] || 0 };
  });
  habitCache = null;
}

// ── helpers ──
function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }
function median(a) { if (!a.length) return 0; var s = a.slice().sort(function(x, y){ return x - y; }), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function niceAmount(v) { return v >= 1000 ? Math.round(v / 10) * 10 : v >= 100 ? Math.round(v) : Math.round(v * 2) / 2; }
function normNote(n) {
  return String(n || '').toLowerCase().replace(/[0-9]+/g, ' ').replace(/[.,#*()\[\]\-_\/\\:;'"!?+@&|]+/g, ' ')
    .replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' ');
}
function ordinal(d) { return d + (d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th'); }
function getDismissed() { try { return JSON.parse(localStorage.getItem(SUG_DISMISS_KEY) || '{}'); } catch(e) { return {}; } }
function isDismissed(key) { var d = getDismissed()[key]; return !!d && (d === 'forever' || d >= todayStr()); }
function dismissNudge(key, until) {
  var d = getDismissed(); d[key] = until || 'forever';
  try { localStorage.setItem(SUG_DISMISS_KEY, JSON.stringify(d)); } catch(e) {}
  renderNudges();
}

// What counts as a habit: your own entries — not automatic recurring rows, installments,
// investment fees or trip/project spending.
function learnRows() {
  var rows = expHistory.slice();
  // entries made on this device but not synced yet
  getQueue().forEach(function(q) {
    if (q.action === 'addExpense') rows.push({ date: q.date, amount: q.amount, category: q.category, note: q.note || '', account: q.account,
      recurring: false, projectId: q.projectId || '', createdAt: q.createdAt || 0 });
  });
  return rows.filter(function(r) {
    return r.date && r.amount > 0 && !r.recurring && !r.projectId && r.category !== 'Investment Fees' &&
      !/^\[Inst /.test(r.note || '') && !/^(Buy|Sell) fee · /.test(r.note || '');
  });
}

function buildHabits() {
  if (habitCache) return habitCache;
  var today = todayStr(), map = {};
  learnRows().forEach(function(r) {
    var nk = normNote(r.note), key = r.category + '|' + nk + '|' + r.account;
    var h = map[key] || (map[key] = { key: key, category: r.category, account: r.account, noteKey: nk, notes: {}, rows: [] });
    h.rows.push(r);
    var label = String(r.note || '').trim();
    if (label) h.notes[label] = (h.notes[label] || 0) + 1;
  });
  var list = Object.keys(map).map(function(k) {
    var h = map[k];
    h.rows.sort(function(a, b){ return a.date.localeCompare(b.date) || (a.createdAt - b.createdAt); });
    var recent = h.rows.slice(-10).map(function(r){ return r.amount; });
    h.typical = niceAmount(median(recent));
    h.amountMed = median(h.rows.map(function(r){ return r.amount; }));
    var dev = recent.map(function(a){ return Math.abs(a - median(recent)); });
    h.spread = h.typical ? median(dev) / h.typical : 1;
    h.count = h.rows.length;
    h.lastDate = h.rows[h.rows.length - 1].date;
    h.label = Object.keys(h.notes).sort(function(a, b){ return h.notes[b] - h.notes[a]; })[0] || '';
    h.title = h.label || h.category;
    var days = {}; h.rows.forEach(function(r){ days[r.date] = (days[r.date] || 0) + 1; });
    h.activeDays = Object.keys(days);
    h.perDay = h.count / h.activeDays.length;
    h.todayCount = days[today] || 0;
    h.hours = h.rows.filter(function(r){ return r.createdAt; }).map(function(r){ var d = new Date(r.createdAt); return d.getHours() + d.getMinutes() / 60; });
    return h;
  });
  habitCache = list;
  return list;
}

// ── 1) suggestions for right now ──
function scoreHabit(h, now) {
  var today = todayStr(), dow = now.getDay(), hr = now.getHours() + now.getMinutes() / 60;
  var tot = 0, sameDow = 0;
  h.rows.forEach(function(r) {
    var age = daysBetween(r.date, today);
    if (age < 0 || age > 120) return;
    var w = Math.pow(0.5, age / 30);                 // recent habits count more (half-life 30 days)
    tot += w;
    if (new Date(r.date + 'T00:00:00').getDay() === dow) sameDow += w;
  });
  if (tot < 1.2 || h.count < 3) return 0;
  var dowF = (sameDow + 0.3) / (tot + 2.1) * 7;      // this weekday vs. an even spread (smoothed)
  var hourF = 1;
  if (h.hours.length >= 3) {                          // within ±2h of now vs. an even spread over the day
    var near = h.hours.filter(function(x){ var d = Math.abs(x - hr); return Math.min(d, 24 - d) <= 2; }).length;
    hourF = Math.max(0.25, Math.min(3, (near + 0.6) / (h.hours.length * 5 / 24 + 0.6)));
  }
  var score = tot * Math.max(0.4, Math.min(2.5, dowF)) * hourF;
  return score;
}
function suggestionsNow(n) {
  var now = new Date();
  var scored = buildHabits()
    .filter(function(h){ return h.todayCount < Math.max(1, Math.round(h.perDay)); })      // already logged today
    .map(function(h){ return { h: h, s: scoreHabit(h, now) }; })
    .filter(function(x){ return x.s > 0; }).sort(function(a, b){ return b.s - a.s; });
  if (!scored.length) return [];
  var top = scored[0].s;
  return scored.filter(function(x){ return x.s >= top * 0.15; }).slice(0, n || 4).map(function(x){ return x.h; });
}
function chipsHtml(list, where) {
  return list.map(function(h) {
    return '<button class="sug-chip" onclick="quickFill(\'' + escQ(h.key) + '\')" title="' + escAttr(h.title + ' · ' + h.account) + '">' +
      '<span class="sug-ic">' + catIcon(h.category) + '</span><span class="sug-txt"><b>' + recEsc(h.title) + '</b>' +
      '<small>~' + fmtMoney(h.typical) + ' · ' + recEsc(h.account) + '</small></span></button>';
  }).join('');
}
function renderSuggestions() {
  var list = suggestionsNow(4);
  var card = document.getElementById('sug-card');
  if (card) {
    card.style.display = list.length ? '' : 'none';
    document.getElementById('sug-chips').innerHTML = chipsHtml(list, 'dash');
  }
  var ch = document.getElementById('chooser-sugg');
  if (ch) ch.innerHTML = list.length ? '<div class="sug-head">Suggested now</div><div class="sug-row">' + chipsHtml(list, 'chooser') + '</div>' : '';
}
function habitByKey(key) { return buildHabits().find(function(h){ return h.key === key; }) || null; }
// Open the expense form filled in from a habit (you can still change anything before saving)
function quickFill(key, amountOverride) {
  var h = habitByKey(key); if (!h) return;
  openExpenseForm();
  var amt = amountOverride || h.typical, acct = acctByName(h.account) ? h.account : null;
  document.getElementById('fe-amount').value = acct && curOf(acct) !== 'THB' ? round2(amt / rateOf(acct)) : amt;
  document.getElementById('fe-note').value = h.label;
  renderCatGrid('fe-cat-grid', expCategories, h.category);
  renderAcctList('fe-acct-list', acct);
  fxUpdate('fe');
  setTimeout(function(){ var a = document.getElementById('fe-amount'); a.focus(); a.select && a.select(); }, 320);
}

// ── 2) note autocomplete + usual amount hint ──
function onNoteInput() {
  var box = document.getElementById('fe-note-sugg'); if (!box) return;
  if (editingExpenseRow) { box.innerHTML = ''; return; }
  var q = normNote(document.getElementById('fe-note').value);
  if (q.length < 2) { box.innerHTML = ''; return; }
  var hits = buildHabits().filter(function(h){ return h.noteKey && h.noteKey.indexOf(q) >= 0; })
    .sort(function(a, b){ return (b.noteKey.indexOf(q) === 0) - (a.noteKey.indexOf(q) === 0) || b.count - a.count; }).slice(0, 3);
  box.innerHTML = hits.map(function(h) {
    return '<button class="note-sugg" onclick="applyNoteSugg(\'' + escQ(h.key) + '\')">' + catIcon(h.category) + ' <b>' + recEsc(h.label) + '</b> · ' +
      recEsc(h.category) + ' · ' + recEsc(h.account) + ' · ~' + fmtMoney(h.typical) + '</button>';
  }).join('');
}
function applyNoteSugg(key) {
  var h = habitByKey(key); if (!h) return;
  var amt = document.getElementById('fe-amount');
  document.getElementById('fe-note').value = h.label;
  renderCatGrid('fe-cat-grid', expCategories, h.category);
  if (acctByName(h.account)) renderAcctList('fe-acct-list', h.account);
  if (!amt.value) amt.value = h.typical;
  document.getElementById('fe-note-sugg').innerHTML = '';
  fxUpdate('fe'); amountHint();
}
// Placeholder shows your usual amount for the chosen category + account
function amountHint() {
  var amt = document.getElementById('fe-amount'); if (!amt) return;
  var cat = getSelectedCat('fe-cat-grid'), acct = getSelectedAcct('fe-acct-list');
  var hs = buildHabits().filter(function(h){ return h.category === cat && (!acct || h.account === acct); });
  var vals = []; hs.forEach(function(h){ h.rows.slice(-10).forEach(function(r){ vals.push(r.amount); }); });
  amt.placeholder = vals.length >= 3 && !privacyOn ? 'usually ' + niceAmount(median(vals)) : '0';
}

// ── 3) unusual amount check (before saving a new expense) ──
function unusualAmountCheck(amount, category) {
  var vals = learnRows().filter(function(r){ return r.category === category; }).map(function(r){ return r.amount; });
  if (vals.length < 5) return true;
  var m = median(vals), mad = median(vals.map(function(v){ return Math.abs(v - m); })) || m * 0.25;
  if (amount <= 500 || amount <= Math.max(m * 5, m + 10 * mad)) return true;
  return confirm(fmtMoney(amount) + ' is much more than your usual ' + category + ' (about ' + fmtMoney(niceAmount(m)) + ').\n\nSave it anyway?');
}

// ── 4) heads-up nudges ──
function monthKey(d) { return d.substring(0, 7); }
function prevMonths(n) {
  var out = [], d = new Date(); d.setDate(1);
  for (var i = 0; i < n; i++) { d.setMonth(d.getMonth() - 1); out.push(d.getFullYear() + '-' + pad(d.getMonth() + 1)); }
  return out;
}
function coveredByRecurring(h) {
  return recurringExpenses.some(function(r) {
    return r.status === 'active' && r.category === h.category && Math.abs(r.amount - h.typical) <= Math.max(1, h.typical * 0.15);
  });
}
function buildNudges() {
  var today = todayStr(), now = new Date(), hr = now.getHours(), dom = now.getDate(), thisMonth = monthKey(today);
  var out = [], last4 = prevMonths(4);
  buildHabits().forEach(function(h) {
    // monthly habit (a bill you pay yourself each month)
    var months = {}; h.rows.forEach(function(r){ months[monthKey(r.date)] = (months[monthKey(r.date)] || []).concat([parseInt(r.date.substring(8, 10))]); });
    var seen = last4.filter(function(m){ return months[m]; });
    var monthlyLike = seen.length >= 3 && h.count <= seen.length * 2 + (months[thisMonth] ? months[thisMonth].length : 0) + 1;
    if (monthlyLike && !coveredByRecurring(h)) {
      var day = Math.round(median([].concat.apply([], seen.map(function(m){ return months[m]; }))));
      var stable = h.spread <= 0.02;                 // same amount every time → can be made automatic
      var missing = !months[thisMonth] && dom > day + 3;
      var key = 'm|' + h.key + '|' + thisMonth;
      if (missing) {
        if (!isDismissed(key))
        out.push({ key: key, until: thisMonth + '-31', icon: catIcon(h.category), prio: 2,
          text: '<b>' + recEsc(h.title) + '</b> (~' + fmtMoney(h.typical) + ') is usually logged around the ' + ordinal(day) + ' — not this month yet.',
          actions: [['Add it', "quickFill('" + escQ(h.key) + "')"]].concat(stable ? [['Make automatic', "makeRecurringFrom('" + escQ(h.key) + "'," + day + ")"]] : []) });
      } else if (stable && !isDismissed('r|' + h.key)) {
        var firstM = seen[seen.length - 1];
        out.push({ key: 'r|' + h.key, until: 'forever', icon: '🔁', prio: 1,
          text: '<b>' + recEsc(h.title) + '</b> ' + fmtMoney(h.typical) + ' every month since ' + SHORT_MON[parseInt(firstM.substring(5, 7)) - 1] + '. Make it automatic?',
          actions: [['Set up', "makeRecurringFrom('" + escQ(h.key) + "'," + day + ")"]] });
      }
    }
    // daily habit not logged yet today
    var recentDays = h.activeDays.filter(function(d){ var a = daysBetween(d, today); return a >= 1 && a <= 21; }).length;
    // ...and you normally do it on this weekday (no weekday-coffee reminders on Sunday)
    var sameDow = 0, dowHits = 0;
    for (var w = 1; w <= 6; w++) { var dd = new Date(now); dd.setDate(dd.getDate() - 7 * w);
      var ds = dd.getFullYear() + '-' + pad(dd.getMonth() + 1) + '-' + pad(dd.getDate()); sameDow++; if (h.activeDays.indexOf(ds) >= 0) dowHits++; }
    if (recentDays >= 12 && h.todayCount === 0 && dowHits / sameDow >= 0.5) {
      var usual = h.hours.length >= 5 ? Math.ceil(h.hours.slice().sort(function(a, b){ return a - b; })[Math.floor(h.hours.length * 0.8)]) : 21;
      var key2 = 'd|' + h.key + '|' + today;
      if (hr >= Math.min(23, usual + 1) && !isDismissed(key2)) {
        out.push({ key: key2, until: today, icon: catIcon(h.category), prio: 3,
          text: 'You usually log <b>' + recEsc(h.title) + '</b> by ' + (usual > 12 ? (usual - 12) + 'pm' : usual + 'am') + ' — nothing yet today.',
          actions: [['Add ~' + fmtMoney(h.typical), "quickFill('" + escQ(h.key) + "')"]] });
      }
    }
  });
  if (typeof allocationNudges === 'function') out = out.concat(allocationNudges());
  return out.sort(function(a, b){ return b.prio - a.prio; }).slice(0, 4);
}
function renderNudges() {
  var card = document.getElementById('nudge-card'); if (!card) return;
  var list = buildNudges();
  card.style.display = list.length ? '' : 'none';
  document.getElementById('nudge-list').innerHTML = list.map(function(n) {
    return '<div class="nudge"><div class="nudge-ic">' + n.icon + '</div><div class="nudge-body"><div class="nudge-text">' + n.text + '</div>' +
      '<div class="nudge-acts">' + n.actions.map(function(a){ return '<button class="nudge-btn" onclick="' + a[1] + '">' + a[0] + '</button>'; }).join('') +
      '<button class="nudge-btn ghost" onclick="dismissNudge(\'' + escQ(n.key) + '\',\'' + n.until + '\')">' + (n.until === 'forever' ? 'No thanks' : 'Dismiss') + '</button></div></div></div>';
  }).join('');
}
// Open the recurring form pre-filled from a monthly habit
function makeRecurringFrom(key, day) {
  var h = habitByKey(key); if (!h) return;
  openRecurring();
  document.getElementById('rec-desc').value = h.label || h.category;
  document.getElementById('rec-amount').value = h.typical;
  document.getElementById('rec-day').value = Math.min(28, Math.max(1, day || 1));
  document.getElementById('rec-cat').value = h.category;
  if (acctByName(h.account)) document.getElementById('rec-acct').value = h.account;
  var d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + (h.rows.some(function(r){ return monthKey(r.date) === monthKey(todayStr()); }) ? 1 : 0));
  document.getElementById('rec-start').value = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-01';
}

function renderSmart() { habitCache = null; renderSuggestions(); renderNudges(); }
