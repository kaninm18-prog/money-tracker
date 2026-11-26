// Money Tracker — PIN lock screens: unlock, set a PIN, change it, auto-lock, wrong-PIN limits.
// The crypto and the vault are in js/lock.js. Plain <script>; functions are global for onclick="...".
//
// While locked: no key and no token in memory, no data in the arrays or on screen, and no requests
// (api() refuses; answers to earlier requests are dropped because lockEpoch changed).

var unlockKey = null;          // AES-GCM key (non-extractable), only while unlocked
var lockEpoch = 0;             // +1 on every lock, so late answers can tell they're out of date
var hiddenAt = 0;              // when the page went into the background
var sealWrites = Promise.resolve();   // encrypted writes run one after another, in order
var rekeyed = new WeakMap();   // old key → new key after a PIN change, for writes queued before it
var pinEntry = '';
var pinFlow = null;            // { mode, kind, first, url, token }
var pinBusy = false, pinWaitTimer = null;

function isUnlocked() { return !!unlockKey; }

// Save a value encrypted under the vault key. Runs after earlier writes; if a lock happens first, the
// write still finishes with the key it was given (so an offline entry made just before locking is kept).
function saveSealed(storeKey, value, extra) {
  var key = unlockKey;
  if (!key) return;
  sealWrites = sealWrites.then(function() {
    var k = unlockKey || key;
    while (rekeyed.has(k)) k = rekeyed.get(k);
    return lockSeal(k, value, extra).then(function(text) {
      try { localStorage.setItem(storeKey, text); } catch(e) {}
    });
  }).catch(function(){});
}
// New token (Settings → Save Connection): re-encrypt it in the vault
function saveSecret(secret) {
  if (!isUnlocked()) return Promise.reject(new Error('locked'));
  var key = unlockKey;
  var job = sealWrites.then(function() {
    var v = lockReadVault();
    if (!v) throw new Error('no vault');
    return lockResealVault(v, key, secret).then(lockWriteVault);
  });
  sealWrites = job.catch(function(){});
  return job;
}

// ════════════════════════════════════════════
//  START-UP
// ════════════════════════════════════════════
function startLock() {
  takePristine();
  document.addEventListener('keydown', pinKeydown);
  if (!lockSupported()) { show('nocrypto-screen'); return; }
  if (lockReadVault()) { showPinScreen({ mode: 'unlock' }); return; }
  if (lockNeedsMigration()) {
    showPinScreen({ mode: 'new1', kind: 'migrate' });
    return;
  }
  showSetup('');
}
function showSetup(note) {
  hidePinScreen();
  var n = document.getElementById('setup-note');
  n.textContent = note || ''; n.style.display = note ? 'block' : 'none';
  document.getElementById('script-url-input').value = SCRIPT_URL;
  document.getElementById('script-token-input').value = '';
  show('setup-screen');
}
// From the setup screen: URL + token are good, now choose a PIN to protect them
function beginPinSetup(url, token) {
  showPinScreen({ mode: 'new1', kind: 'setup', url: url, token: token });
  document.getElementById('script-token-input').value = '';
}

// ════════════════════════════════════════════
//  PIN SCREEN
// ════════════════════════════════════════════
var PIN_TEXT = {
  unlock:   ['Enter your PIN', ''],
  new1:     ['Set a 6-digit PIN', 'It locks Money Tracker on this device and encrypts your access token and the data saved here.'],
  new2:     ['Confirm your PIN', 'Enter the same 6 digits again.'],
  old:      ['Enter your current PIN', ''],
  change1:  ['Choose a new PIN', ''],
  change2:  ['Confirm your new PIN', 'Enter the same 6 digits again.']
};
function showPinScreen(flow) {
  pinFlow = flow; pinEntry = ''; pinBusy = false;
  var t = PIN_TEXT[flow.mode];
  var sub = t[1];
  if (flow.kind === 'migrate' && flow.mode === 'new1') sub = 'New: Money Tracker now locks with a PIN. ' + sub;
  document.getElementById('lock-title').textContent = t[0];
  document.getElementById('lock-sub').textContent = sub;
  document.getElementById('pin-forgot').style.display = flow.mode === 'unlock' ? '' : 'none';
  document.getElementById('pin-cancel').style.display = flow.kind === 'change' ? '' : 'none';
  setPinMsg(flow.msg || '', flow.msgBad);
  hide('setup-screen');
  show('lock-screen');
  drawDots();
  if (flow.mode === 'unlock' || flow.mode === 'old') showWait();
}
function hidePinScreen() {
  hide('lock-screen');
  clearInterval(pinWaitTimer); pinWaitTimer = null;
  pinEntry = ''; pinFlow = null; pinBusy = false;
  drawDots();
}
function drawDots() {
  var dots = document.querySelectorAll('#pin-dots span');
  for (var i = 0; i < dots.length; i++) dots[i].classList.toggle('on', i < pinEntry.length);
}
function setPinMsg(text, bad) {
  var m = document.getElementById('pin-msg');
  m.textContent = text || '';
  m.classList.toggle('bad', !!bad);
}
function setPadEnabled(on) {
  document.querySelectorAll('#pin-pad button').forEach(function(b){ b.disabled = !on; });
}
function pinKey(d) {
  if (!pinFlow || pinBusy || pinWaitTimer || pinEntry.length >= LOCK_PIN_LEN) return;
  pinEntry += d;
  drawDots();
  if (pinEntry.length === LOCK_PIN_LEN) setTimeout(submitPin, 120);   // let the last dot show
}
function pinBack() {
  if (!pinFlow || pinBusy) return;
  pinEntry = pinEntry.slice(0, -1);
  drawDots();
}
// Laptop: type the digits, Backspace to correct, Escape to clear (or cancel a PIN change)
function pinKeydown(e) {
  if (!pinFlow || document.getElementById('lock-screen').style.display === 'none') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^[0-9]$/.test(e.key)) { e.preventDefault(); pinKey(e.key); }
  else if (e.key === 'Backspace') { e.preventDefault(); pinBack(); }
  else if (e.key === 'Escape') {
    e.preventDefault();
    if (pinFlow.kind === 'change') cancelPinFlow(); else if (!pinBusy) { pinEntry = ''; drawDots(); }
  }
}
function cancelPinFlow() { if (pinFlow && pinFlow.kind === 'change' && !pinBusy) hidePinScreen(); }

function submitPin() {
  if (!pinFlow || pinEntry.length !== LOCK_PIN_LEN) return;
  var pin = pinEntry, f = pinFlow;
  if (f.mode === 'unlock' || f.mode === 'old') return checkPin(pin, f);
  if (f.mode === 'new1' || f.mode === 'change1') {
    showPinScreen(Object.assign({}, f, { mode: f.mode === 'new1' ? 'new2' : 'change2', first: pin }));
    return;
  }
  // new2 / change2: must match
  if (pin !== f.first) {
    showPinScreen(Object.assign({}, f, { mode: f.mode === 'new2' ? 'new1' : 'change1', first: null,
      msg: "The PINs didn't match — try again.", msgBad: true }));
    return;
  }
  busy('Encrypting…');
  if (f.kind === 'change') return finishChangePin(pin);
  // First run after the update (token from storage) or first-time setup (token just typed)
  var job = sealWrites.then(function() { return lockMigrate(pin, f.kind === 'setup' ? f.token : undefined); });
  sealWrites = job.catch(function(){});
  job.then(function(r) {
    if (f.kind === 'setup') { localStorage.setItem('moneyScriptUrl', f.url); SCRIPT_URL = f.url; }
    finishUnlock(r.key, r.secret, r.queue, r.cache);
    toast('PIN set — Money Tracker is now locked when you leave it');
  }).catch(function() {
    showPinScreen(Object.assign({}, f, { mode: 'new1', first: null, msg: 'Could not save (storage full?). Try again.', msgBad: true }));
  });
}
function busy(text) { pinBusy = true; setPadEnabled(false); setPinMsg(text); }

function checkPin(pin, f) {
  busy('Checking…');
  var job = sealWrites.then(function() { return lockTryPin(pin, Date.now()); });
  sealWrites = job.catch(function(){});
  job.then(function(r) {
    if (r.noVault) { wipedToSetup(''); return; }
    if (r.wiped) { wipedToSetup('Too many wrong PINs — the data saved on this device was erased. Your data in Google Sheets is safe. Connect again to continue.'); return; }
    if (pinFlow !== f) return;           // the screen changed meanwhile (e.g. auto-lock during a PIN change)
    pinBusy = false; pinEntry = ''; drawDots(); setPadEnabled(true);
    if (r.ok) {
      if (f.mode === 'old') { showPinScreen({ mode: 'change1', kind: 'change' }); return; }
      finishUnlock(r.key, r.secret);
      return;
    }
    if (r.waiting) { showWait(); return; }
    setPinMsg('Wrong PIN. ' + r.left + (r.left === 1 ? ' try' : ' tries') + ' left.' + wipeWarning(r.left), true);
    if (r.wait) showWait();
  }).catch(function() {
    if (pinFlow !== f) return;
    pinBusy = false; pinEntry = ''; drawDots(); setPadEnabled(true);
    setPinMsg('Something went wrong — try again.', true);
  });
}
// Said once the delays start, so nothing is lost by surprise
function wipeWarning(left) {
  if (left > LOCK_MAX_FAILS - LOCK_FREE_FAILS - 1) return '';
  var n = queuedCount();
  return ' After that, the data saved on this device is erased' +
    (n ? ' — including ' + n + ' offline ' + (n === 1 ? 'entry' : 'entries') + ' not sent yet, which will be lost.' : '.');
}
function queuedCount() { return lockQueuedCount() + lockedQueue.length; }

// After several wrong PINs: count down, keypad off
function showWait() {
  clearInterval(pinWaitTimer); pinWaitTimer = null;
  var v = lockReadVault();
  var tick = function() {
    var ms = lockWaitLeft(v, Date.now());
    if (ms <= 0) {
      clearInterval(pinWaitTimer); pinWaitTimer = null; setPadEnabled(true);
      if (v && v.fails > LOCK_FREE_FAILS) setPinMsg(lockTriesLeft(v) + ' tries left.' + wipeWarning(lockTriesLeft(v)), true);
      return;
    }
    var s = Math.ceil(ms / 1000);
    setPinMsg('Too many wrong PINs. Try again in ' + Math.floor(s / 60) + ':' + pad(s % 60) + '. ' +
      lockTriesLeft(v) + ' tries left.' + wipeWarning(lockTriesLeft(v)), true);
  };
  if (lockWaitLeft(v, Date.now()) > 0) { setPadEnabled(false); pinWaitTimer = setInterval(tick, 1000); }
  tick();
}

// Right PIN: read the encrypted queue and cache, then open the app
function finishUnlock(key, secret, queue, cache) {
  var got = queue !== undefined ? Promise.resolve([queue, cache]) : Promise.all([
    lockUnseal(key, localStorage.getItem(QUEUE_KEY), []).catch(function(){ return []; }),
    lockUnseal(key, localStorage.getItem(CACHE_KEY), null).catch(function(){ return null; })
  ]);
  return got.then(function(v) {
    unlockKey = key;
    API_TOKEN = (secret && secret.token) || '';
    queueMem = Array.isArray(v[0]) ? v[0] : [];
    cacheMem = v[1] || null;
    if (lockedQueue.length) {          // failed to send while locked: add them now
      var have = {};
      queueMem.forEach(function(x){ have[x.qid] = 1; });
      var extra = lockedQueue.filter(function(x){ return !have[x.qid]; });
      lockedQueue = [];
      setQueue(queueMem.concat(extra));
    }
    hidePinScreen();
    openApp();
  });
}

// ════════════════════════════════════════════
//  LOCKING
// ════════════════════════════════════════════
function lockNow() {
  if (!isUnlocked()) return;
  dropUnlocked();
  showPinScreen({ mode: 'unlock' });
}
// Forget the key, the token and every piece of data, on screen and in memory
function dropUnlocked() {
  lockEpoch++;
  unlockKey = null;
  API_TOKEN = '';
  flushing = null;
  queueMem = []; cacheMem = null; serverTxns = [];
  accounts = []; totalBalance = 0; expCategories = []; incCategories = []; transactions = [];
  projects = []; receivables = []; installmentPlans = []; budgets = []; recurringExpenses = [];
  trends = []; backupInfo = null; netWorthHist = []; priceInfo = null;
  searchResults = null; searchAll = false; projectDetail = null; collapsedGroups = {}; acctGroupList = []; accountsEditMode = false; expHistory = []; habitCache = null;
  pendingBudgetAlert = null; packPending = null;
  clearScreen();
}
// The app and every modal exactly as index.html has them, before any data is drawn (taken at start-up).
// Restoring them on lock removes every trace of the data: drawn lists, filled-in forms, search, the token in
// Settings. All handlers inside are onclick="…" attributes, so they come back with the HTML.
var pristine = null;
function lockRegions() {
  return [document.getElementById('app')].concat(Array.prototype.slice.call(document.querySelectorAll('body > .modal-overlay, body > .annual-modal-overlay')));
}
function takePristine() {
  pristine = lockRegions().map(function(el){ return { el: el, html: el.innerHTML }; });
}
function clearScreen() {
  hide('app');
  document.querySelectorAll('.modal-overlay.open, .annual-modal-overlay.open').forEach(function(m){ m.classList.remove('open'); });
  if (pristine) pristine.forEach(function(p){ p.el.innerHTML = p.html; });
  applyTheme(); syncPrivacyBtn();
  var t = document.getElementById('toast'); t.classList.remove('show'); t.textContent = '';
}

// Auto-lock: after LOCK_AFTER_MS in the background, checked when the app comes back
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'hidden') { if (!hiddenAt) hiddenAt = Date.now(); }
  else checkAutoLock();
});
window.addEventListener('pagehide', function() { if (!hiddenAt) hiddenAt = Date.now(); });
window.addEventListener('pageshow', function() { if (document.visibilityState !== 'hidden') checkAutoLock(); });
function checkAutoLock() {
  var since = hiddenAt; hiddenAt = 0;
  if (since && isUnlocked() && Date.now() - since >= LOCK_AFTER_MS) lockNow();
}

// ════════════════════════════════════════════
//  SETTINGS: Lock now, Change PIN
// ════════════════════════════════════════════
function lockFromSettings() { closeModal('settings-modal'); lockNow(); }
function startChangePin() {
  if (!isUnlocked()) return;
  closeModal('settings-modal');
  showPinScreen({ mode: 'old', kind: 'change' });
}
function finishChangePin(pin) {
  var oldKey = unlockKey, secret = { token: API_TOKEN };
  var job = sealWrites.then(function() { return lockChangePin(oldKey, pin, secret); });
  sealWrites = job.catch(function(){});
  job.then(function(newKey) {
    rekeyed.set(oldKey, newKey);
    if (unlockKey !== oldKey) return;    // locked meanwhile: the unlock screen stays; the new PIN opens it
    unlockKey = newKey;
    hidePinScreen();
    toast('PIN changed');
  }).catch(function() {
    if (unlockKey !== oldKey) return;
    showPinScreen({ mode: 'change1', kind: 'change', msg: 'Could not save the new PIN. Your old PIN still works.', msgBad: true });
  });
}

// ════════════════════════════════════════════
//  FORGOT PIN / TOO MANY TRIES
// ════════════════════════════════════════════
function forgotPin() {
  if (pinBusy) return;
  var n = queuedCount();
  var msg = 'Forgot your PIN?\n\nThis erases what Money Tracker saved on this device:\n' +
    '• the offline copy of your data\n• the access token\n' +
    (n ? '• ' + n + ' offline ' + (n === 1 ? 'entry' : 'entries') + ' not sent yet — these will be LOST\n' : '') +
    '\nYour data in Google Sheets is not touched. To connect again you need the web app URL and the access token (Apps Script → setupToken).\n\nErase and start over?';
  if (!confirm(msg)) return;
  var job = sealWrites.then(function() { lockWipe(); });
  sealWrites = job.catch(function(){});
  job.then(function() { wipedToSetup('This device was reset. Connect again to continue.'); });
}
function wipedToSetup(note) {
  if (isUnlocked()) dropUnlocked();
  lockedQueue = [];
  showSetup(note);
}
