// Money Tracker — Settings: categories and icons, recurring expenses, backup status.
// Loaded as a plain <script> (not a module): functions are global so onclick="..." handlers work.

// ════════════════════════════════════════════
//  BACKUP (settings)
// ════════════════════════════════════════════
function renderBackupStatus() {
  var el = document.getElementById('backup-status');
  if (!el) return;
  if (!backupInfo) { el.textContent = 'Backups need the latest Code.gs in Apps Script.'; return; }
  el.textContent = (backupInfo.last ? 'Last backup: ' + fmtDateY(backupInfo.last) + '. ' : 'No backup yet. ') +
    (backupInfo.weekly ? 'A copy is saved to "Money Tracker Backups" in your Google Drive every Sunday (newest 12 kept).'
                       : 'Weekly backup is off — in Apps Script, run setupAutomation() once to turn it on.') +
    (priceInfo ? (priceInfo.daily ? ' Prices and exchange rates update every day at 7am.' : ' Daily price updates are off — setupAutomation() turns them on too.') : '');
}
function backupNow() {
  var btn = document.getElementById('backup-btn'); btn.textContent = 'Backing up…'; btn.disabled = true;
  api({action:'backupNow'}).then(function(res) {
    btn.textContent = '☁️ Back up now'; btn.disabled = false;
    if (res.ok) { backupInfo = Object.assign({}, backupInfo || {}, { last: res.last }); renderBackupStatus(); toast('Backup saved to Google Drive'); }
    else if (/Unknown action/.test(res.error || '')) toast('Update Code.gs in Apps Script and redeploy first');
    else if (/permission|authori[sz]/i.test(res.error || '')) toast('Run setupAutomation() in Apps Script once to allow Drive access');
    else toast('Error: ' + (res.error || '?'));
  }).catch(function(){ btn.textContent = '☁️ Back up now'; btn.disabled = false; toast('Connection error'); });
}

// ════════════════════════════════════════════
//  SETTINGS — CATEGORIES
// ════════════════════════════════════════════
function renderSettingsCats() {
  var expHtml = expCategories.map(function(c) {
    return '<div style="display:flex;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)">' +
      '<button class="cat-icon-btn" title="Change icon" onclick="openIconPicker(\'expense\',\''+escQ(c.name)+'\')">'+catIcon(c.name)+'</button>' +
      '<span style="flex:1;font-size:0.85rem">'+recEsc(c.name)+'</span>' +
      '<button onclick="deleteExpCat('+c.rowIndex+',\''+escQ(c.name)+'\')" style="background:none;border:none;color:var(--expense-color);cursor:pointer;font-size:1rem">🗑️</button>' +
    '</div>';
  }).join('');
  document.getElementById('settings-exp-cats').innerHTML = expHtml || '<p style="font-size:0.8rem;color:var(--text2)">No categories</p>';

  var incHtml = incCategories.map(function(c) {
    return '<div style="display:flex;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)">' +
      '<button class="cat-icon-btn" title="Change icon" onclick="openIconPicker(\'income\',\''+escQ(c.name)+'\')">'+catIcon(c.name)+'</button>' +
      '<span style="flex:1;font-size:0.85rem">'+recEsc(c.name)+'</span>' +
      '<button onclick="deleteIncCat('+c.rowIndex+',\''+escQ(c.name)+'\')" style="background:none;border:none;color:var(--expense-color);cursor:pointer;font-size:1rem">🗑️</button>' +
    '</div>';
  }).join('');
  document.getElementById('settings-inc-cats').innerHTML = incHtml || '<p style="font-size:0.8rem;color:var(--text2)">No categories</p>';
}

// ── Category icon picker ──
var ICON_CHOICES = [
  ['Food & drink', '🍜 🍚 🍔 🍕 🍣 🥗 🍰 🍩 ☕ 🧋 🍺 🍷 🛒 🥤 🍱 🍳'],
  ['Shopping & home', '🛍️ 👕 👟 👜 💄 🛋️ 🏠 🧹 🧺 🪴 🔧 💡 🛏️ 🧴 📦 🎁'],
  ['Transport & travel', '🚗 ⛽ 🅿️ 🚕 🚆 🚌 🏍️ ✈️ 🏨 🧳 🗺️ 🚲'],
  ['Bills & money', '🧾 💳 🏧 🏦 💰 💸 📈 🏛️ 🛡️ 📱 🌐 📺 🔁 💼 📄 🪙'],
  ['Health & personal', '💊 🏥 🦷 👓 💆 💇 🏋️ 🧘 ✨ 🧼'],
  ['Fun & family', '🎬 🎮 🎵 🎤 📚 🎓 🧸 🐾 👨‍👩‍👧 💝 🙏 🎉 ⚽ ⛳ 📷 🎨'],
  ['Other', '📌 ⭐ ❤️ 🔥 ⚡ 🌱 🧩 🗂️ 🔔 ❓']
];
var iconPick = null;
function openIconPicker(type, name) {
  iconPick = { type: type, name: name };
  var cur = catIcon(name);
  document.getElementById('ip-title').textContent = 'Icon for ' + name;
  document.getElementById('ip-custom').value = '';
  setIconPreview(cur);
  document.getElementById('ip-grid').innerHTML = ICON_CHOICES.map(function(g) {
    return '<div class="ip-group">' + g[0] + '</div><div class="ip-row">' + g[1].split(' ').map(function(e) {
      return '<button class="ip-opt" onclick="setIconPreview(\'' + e + '\')">' + e + '</button>';
    }).join('') + '</div>';
  }).join('');
  openModal('icon-modal');
}
function setIconPreview(e) {
  iconPick.icon = e;
  document.getElementById('ip-preview').textContent = e || '📌';
  document.querySelectorAll('#ip-grid .ip-opt').forEach(function(b){ b.classList.toggle('sel', b.textContent === e); });
}
function onIconTyped() {
  var v = document.getElementById('ip-custom').value.trim();
  if (v) setIconPreview(Array.from(v).slice(0, 4).join(''));
}
function saveCategoryIcon(useDefault) {
  if (!iconPick) return;
  var icon = useDefault ? '' : (iconPick.icon || '');
  var list = iconPick.type === 'income' ? incCategories : expCategories;
  var c = list.find(function(x){ return x.name === iconPick.name; });
  if (!c) { toast('Category not found — refresh'); return; }
  var old = c.icon;
  c.icon = icon;                                   // show it right away
  closeModal('icon-modal'); renderAll();
  api({ action: 'setCategoryIcon', type: iconPick.type, key: c.name, rowIndex: c.rowIndex, icon: icon }).then(function(res) {
    if (res.ok) {
      toast(useDefault ? 'Icon reset' : 'Icon saved');
      try {                                        // keep the offline copy in step
        var cc = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
        if (cc && cc.d) { cc.d.categories = { ok:true, categories:expCategories }; cc.d.incomeCategories = { ok:true, categories:incCategories }; localStorage.setItem(CACHE_KEY, JSON.stringify(cc)); }
      } catch(e) {}
    }
    else { c.icon = old; renderAll(); toast(/Unknown action/.test(res.error||'') ? 'Update Code.gs in Apps Script and redeploy first' : 'Error: ' + (res.error || '?')); }
  }).catch(function(){ c.icon = old; renderAll(); toast('Changing icons needs a connection'); });
}

function promptAddCategory(type) {
  var name = prompt('New '+(type==='income'?'income':'expense')+' category name:');
  if (!name || !name.trim()) return;
  var action = type==='income' ? 'addIncomeCategory' : 'addCategory';
  api({action:action, name:name.trim()}).then(function(res) {
    if (res.ok) {
      toast('Category added — pick an icon');
      var nm = name.trim();
      api({action: type==='income' ? 'getIncomeCategories' : 'getCategories'}).then(function(r){
        if (!r.ok) return;
        if (type==='income') incCategories=r.categories; else expCategories=r.categories;
        renderSettingsCats();
        openIconPicker(type, nm);
      });
    } else { toast('Error: '+res.error); }
  });
}

function deleteExpCat(rowIndex, name) {
  if (!confirm('Delete "'+name+'"?')) return;
  api({action:'deleteCategory', rowIndex:rowIndex, key:name}).then(function(res){
    if(res.ok){toast('Deleted'); api({action:'getCategories'}).then(function(r){if(r.ok){expCategories=r.categories;renderSettingsCats();}});}
    else{toast('Error: '+res.error);}
  });
}
function deleteIncCat(rowIndex, name) {
  if (!confirm('Delete "'+name+'"?')) return;
  api({action:'deleteIncomeCategory', rowIndex:rowIndex, key:name}).then(function(res){
    if(res.ok){toast('Deleted'); api({action:'getIncomeCategories'}).then(function(r){if(r.ok){incCategories=r.categories;renderSettingsCats();}});}
    else{toast('Error: '+res.error);}
  });
}

// ════════════════════════════════════════════
//  SETTINGS
// ════════════════════════════════════════════
function openSettings() {
  document.getElementById('settings-url').value = SCRIPT_URL;
  renderSettingsCats();
  renderBackupStatus();
  openModal('settings-modal');
}

// ════════════════════════════════════════════
//  RECURRING EXPENSES (managed in Settings)
// ════════════════════════════════════════════
var editingRecurringRow = null, editingRecurringKey = '';
function recEsc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
function renderRecurring() {
  var el = document.getElementById('settings-recurring');
  if (!el) return;
  if (!recurringExpenses.length) { el.innerHTML = '<div class="balance-mode-desc">No recurring items yet.</div>'; return; }
  el.innerHTML = recurringExpenses.map(function(r) {
    var sub = (r.frequency === 'yearly' ? 'Yearly · ' + r.dayOfMonth + ' ' + SHORT_MON[(r.monthOfYear||1)-1] : 'Monthly · day ' + r.dayOfMonth) + ' · ' + recEsc(r.account) + ' · ' + recEsc(r.category) + (r.status !== 'active' ? ' · Paused' : '');
    return '<div class="rec-row' + (r.status !== 'active' ? ' rec-paused' : '') + '" onclick="openRecurring(' + r.rowIndex + ')">'
      + '<div class="rec-main"><div class="rec-name">' + recEsc(r.description) + '</div><div class="rec-sub">' + sub + '</div></div>'
      + '<div class="rec-amt">' + fmtMoney(r.amount) + '</div></div>';
  }).join('');
}
function openRecurring(rowIndex) {
  var r = rowIndex ? recurringExpenses.filter(function(x){ return x.rowIndex === rowIndex; })[0] : null;
  editingRecurringRow = r ? r.rowIndex : null;
  editingRecurringKey = r ? r.description : '';
  document.getElementById('rec-title').textContent = r ? 'Edit recurring expense' : 'Add recurring expense';
  document.getElementById('rec-desc').value = r ? r.description : '';
  document.getElementById('rec-amount').value = r ? r.amount : '';
  document.getElementById('rec-day').value = r ? r.dayOfMonth : '';
  document.getElementById('rec-cat').innerHTML = expCategories.map(function(c){ return '<option>' + recEsc(c.name) + '</option>'; }).join('');
  document.getElementById('rec-acct').innerHTML = accounts.map(function(a){ return '<option>' + recEsc(a.name) + '</option>'; }).join('');
  if (r) { document.getElementById('rec-cat').value = r.category; document.getElementById('rec-acct').value = r.account; }
  document.getElementById('rec-start').value = r ? r.startDate : todayStr();
  document.getElementById('rec-month').innerHTML = MONTH_NAMES.map(function(n, i){ return '<option value="'+(i+1)+'">'+n+'</option>'; }).join('');
  document.getElementById('rec-freq').value = r && r.frequency === 'yearly' ? 'yearly' : 'monthly';
  document.getElementById('rec-month').value = String(r && r.monthOfYear ? r.monthOfYear : new Date().getMonth() + 1);
  recFreqChange();
  document.getElementById('rec-active').checked = r ? r.status === 'active' : true;
  document.getElementById('rec-del-btn').style.display = r ? 'block' : 'none';
  openModal('rec-modal');
}
function recFreqChange() {
  document.getElementById('rec-month-group').style.display = document.getElementById('rec-freq').value === 'yearly' ? '' : 'none';
}
function saveRecurring() {
  var desc = document.getElementById('rec-desc').value.trim();
  var amt = parseFloat(document.getElementById('rec-amount').value);
  var day = parseInt(document.getElementById('rec-day').value);
  if (!desc) { toast('Enter a description'); return; }
  if (!amt || amt <= 0) { toast('Enter a valid amount'); return; }
  if (!day || day < 1 || day > 31) { toast('Day must be 1-31'); return; }
  var payload = { description:desc, amount:amt, dayOfMonth:day,
    category:document.getElementById('rec-cat').value, account:document.getElementById('rec-acct').value,
    startDate:document.getElementById('rec-start').value || todayStr(),
    status:document.getElementById('rec-active').checked ? 'active' : 'paused',
    frequency:document.getElementById('rec-freq').value, monthOfYear:parseInt(document.getElementById('rec-month').value) };
  if (editingRecurringRow) { payload.action = 'updateRecurring'; payload.rowIndex = editingRecurringRow; payload.key = editingRecurringKey; }
  else { payload.action = 'addRecurring'; }
  var btn = document.getElementById('rec-save-btn'); btn.textContent = 'Saving…';
  api(payload).then(function(res) {
    btn.textContent = 'Save';
    if (res.ok) { closeModal('rec-modal'); toast(editingRecurringRow ? 'Updated!' : 'Recurring added!'); loadAll(); }
    else if (/Unknown action/.test(res.error || '')) { toast('Update Code.gs in Apps Script and redeploy first'); }
    else { toast('Error: ' + (res.error || '?')); }
  }).catch(function(){ btn.textContent = 'Save'; toast('Connection error'); });
}
function deleteRecurringItem() {
  if (!editingRecurringRow || !confirm('Delete this recurring item? Past entries stay.')) return;
  api({action:'deleteRecurring', rowIndex:editingRecurringRow, key:editingRecurringKey}).then(function(res) {
    if (res.ok) { closeModal('rec-modal'); toast('Deleted'); loadAll(); } else toast('Error: ' + (res.error || '?'));
  }).catch(function(){ toast('Connection error'); });
}


// ════════════════════════════════════════════
//  IMPORT DATA FILE (.json "money-tracker-import")
// ════════════════════════════════════════════
var packPending = null;
function onPackFile(input) {
  var f = input.files && input.files[0]; input.value = '';
  if (!f) return;
  f.text().then(function(txt) {
    var p; try { p = JSON.parse(txt); } catch(e) { toast('That file is not a valid import file'); return; }
    if (!p || p.format !== 'money-tracker-import') { toast('That file is not a Money Tracker import file'); return; }
    packPending = p;
    var tr = p.trades || [], hx = p.holdingTxns || [], ac = p.accounts || [];
    var closed = tr.filter(function(t){ return t.closeTime; }).map(function(t){ return t.closeTime.substring(0, 10); }).sort();
    var net = tr.reduce(function(s, t){ return s + (+t.profit || 0) + (+t.commission || 0) + (+t.swap || 0); }, 0);
    var lines = [];
    if (p.source) lines.push('<span class="hold-sub">From ' + recEsc(p.source) + '</span>');
    ac.forEach(function(a) {
      var exists = accounts.some(function(x){ return x.name.toLowerCase() === String(a.name).toLowerCase(); });
      lines.push('🏦 Account <b>' + recEsc(a.name) + '</b>' + (a.currency && a.currency !== 'THB' && String(a.name).indexOf(a.currency) < 0 ? ' (' + a.currency + ')' : '') +
        (exists ? ' — already exists, will be kept as is' : ', opening balance ' + fmtCur(a.startingBalance || 0, a.currency || 'THB')));
    });
    if (tr.length) lines.push('📈 <b>' + tr.length + ' trades</b>' + (closed.length ? ' · ' + fmtDateY(closed[0]) + ' – ' + fmtDateY(closed[closed.length - 1]) : '') +
      ' · net ' + (tr[0].currency === 'USD' || !tr[0].currency ? fmtUsd(net) : net.toFixed(2)) + (p.tradeAccount ? ' · linked to ' + recEsc(p.tradeAccount) : ''));
    hx.forEach(function(t) {
      var h = t.holding || {};
      lines.push((t.type === 'buy' ? '🥇 ' : '• ') + recEsc(h.name || 'Holding') + ': ' + t.type + ' ' + (t.quantity || '') + ' ' + recEsc(h.unit || '') +
        (t.currency && t.currency !== 'THB' ? ' — priced in ' + t.currency + ', converted at the ' + fmtDateY(t.date) + ' rate' : '') + (t.account ? '' : ' (already owned, no money moves)'));
    });
    lines.push('<span class="hold-sub">Anything already in the app (same account name, trade or entry) is skipped.</span>');
    document.getElementById('pack-summary').innerHTML = lines.join('<br>');
    document.getElementById('pack-go').textContent = 'Import';
    closeModal('settings-modal');
    openModal('pack-modal');
  });
}
function confirmPackImport() {
  if (!packPending) return;
  var btn = document.getElementById('pack-go'); btn.textContent = 'Importing… (looking up exchange rates)'; btn.disabled = true;
  api(Object.assign({ action: 'importPack' }, packPending)).then(function(res) {
    btn.disabled = false; btn.textContent = 'Import';
    if (!res.ok) { toast(/Unknown action/.test(res.error || '') ? 'Update Code.gs in Apps Script and redeploy first' : 'Error: ' + (res.error || '?'), 5000); return; }
    packPending = null; closeModal('pack-modal');
    var parts = [];
    if (res.accounts.added.length) parts.push(res.accounts.added.length + ' account' + (res.accounts.added.length > 1 ? 's' : ''));
    if (res.trades && res.trades.added) parts.push(res.trades.added + ' trades');
    if (res.holdings.added) parts.push(res.holdings.added + ' investment entr' + (res.holdings.added > 1 ? 'ies' : 'y'));
    var skipped = (res.accounts.skipped.length) + (res.trades ? res.trades.skipped : 0) + res.holdings.skipped;
    toast((parts.length ? 'Imported ' + parts.join(', ') : 'Nothing new to import') + (skipped ? ' · ' + skipped + ' already there' : ''), 6000);
    if (res.holdings.fx.length) setTimeout(function(){ toast(res.holdings.fx.join(' · '), 7000); }, 6200);
    trades = null;
    loadAll();
  }).catch(function(){ btn.disabled = false; btn.textContent = 'Import'; toast('Importing needs a connection'); });
}
