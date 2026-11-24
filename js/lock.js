// Money Tracker — PIN lock: key derivation, encryption and the vault on this device.
// Loaded before core.js as a plain <script>. Pure functions only (no DOM), so tests can load it in Node.
//
// How it works:
// - The 6-digit PIN goes through PBKDF2-SHA-256 (random 16-byte salt) to make an AES-GCM-256 key.
// - The access token is encrypted with that key and kept in the vault entry (LOCK_KEY).
// - The PIN is checked by decrypting the vault: a wrong PIN fails GCM's auth tag.
//   Neither the PIN nor a hash of it is ever stored.
// - The offline cache and queue are encrypted with the same key ("sealed"), each with a fresh 12-byte IV.
// - The key is non-extractable and lives only in memory while unlocked.

var LOCK_KEY = 'moneyLock_v1';
var LOCK_TOKEN_PLAIN = 'moneyToken';                      // where the token lived before the lock
var LOCK_DATA_KEYS = ['moneyCache_v1', 'moneyQueue_v1'];  // encrypted with the vault key; wiped with it
var LOCK_ITER = 210000;          // PBKDF2 rounds for new vaults; each vault records its own count
var LOCK_PIN_LEN = 6;
var LOCK_MAX_FAILS = 10;         // wrong PINs in a row before this device's data is wiped
var LOCK_FREE_FAILS = 4;         // tries without a wait; the 5th wrong PIN starts the delay
var LOCK_AFTER_MS = 5 * 60 * 1000;   // auto-lock after this long in the background

function lockSupported() {
  return !!(typeof crypto !== 'undefined' && crypto && crypto.subtle && crypto.getRandomValues &&
    typeof TextEncoder !== 'undefined');
}

// ── bytes <-> base64 (vault fields are stored as text) ──
function lockB64(bytes) {
  var s = '', b = new Uint8Array(bytes);
  for (var i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
function lockUnb64(str) {
  var s = atob(str), b = new Uint8Array(s.length);
  for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}
function lockRandom(n) { return crypto.getRandomValues(new Uint8Array(n)); }

function lockValidPin(pin) { return typeof pin === 'string' && new RegExp('^\\d{' + LOCK_PIN_LEN + '}$').test(pin); }

// PIN + salt → AES-GCM key (non-extractable: the raw key can't be read back out, even by our own code)
function lockDeriveKey(pin, salt, iter) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']).then(function(base) {
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: iter || LOCK_ITER },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  });
}

// Any JSON value → { iv, ct } (base64). A new random IV every time.
function lockEncrypt(key, obj) {
  var iv = lockRandom(12);
  return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(JSON.stringify(obj)))
    .then(function(ct) { return { iv: lockB64(iv), ct: lockB64(ct) }; });
}
// { iv, ct } → the JSON value. Rejects if the key is wrong or the data was changed.
function lockDecrypt(key, box) {
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: lockUnb64(box.iv) }, key, lockUnb64(box.ct))
    .then(function(pt) { return JSON.parse(new TextDecoder().decode(pt)); });
}

// ── Sealed values: the cache and queue as stored text. `extra` holds small plain fields (e.g. the queue count). ──
function lockIsSealed(text) {
  if (!text) return false;
  try { var o = JSON.parse(text); return !!(o && o.sealed === 1 && o.iv && o.ct); } catch (e) { return false; }
}
function lockSeal(key, obj, extra) {
  return lockEncrypt(key, obj).then(function(box) {
    return JSON.stringify(Object.assign({ sealed: 1 }, extra || {}, box));
  });
}
// Stored text → value, or `fallback` when there is nothing stored. Plain (unsealed) text is never trusted here.
function lockUnseal(key, text, fallback) {
  if (!text) return Promise.resolve(fallback);
  if (!lockIsSealed(text)) return Promise.reject(new Error('not sealed'));
  return lockDecrypt(key, JSON.parse(text));
}
// Plain fields of a sealed value (readable while locked)
function lockSealedInfo(text) {
  if (!lockIsSealed(text)) return null;
  return JSON.parse(text);
}

// ── The vault entry: { v, it, salt, iv, ct, fails, failAt } ──
// ct decrypts to { token }. fails/failAt survive a reload so closing the app doesn't reset the count.
function lockReadVault() {
  try {
    var v = JSON.parse(localStorage.getItem(LOCK_KEY) || 'null');
    return (v && v.v === 1 && v.salt && v.iv && v.ct) ? v : null;
  } catch (e) { return null; }
}
function lockWriteVault(v) { localStorage.setItem(LOCK_KEY, JSON.stringify(v)); }

// New vault for `secret` ({ token }) → { vault, key }. Nothing is written.
function lockCreateVault(pin, secret, iter) {
  if (!lockValidPin(pin)) return Promise.reject(new Error('PIN must be ' + LOCK_PIN_LEN + ' digits'));
  var salt = lockRandom(16);
  iter = iter || LOCK_ITER;
  return lockDeriveKey(pin, salt, iter).then(function(key) {
    return lockEncrypt(key, secret).then(function(box) {
      return { key: key, vault: { v: 1, it: iter, salt: lockB64(salt), iv: box.iv, ct: box.ct, fails: 0, failAt: 0 } };
    });
  });
}
// Same key, new secret (e.g. the token was changed in Settings) → vault to write
function lockResealVault(vault, key, secret) {
  return lockEncrypt(key, secret).then(function(box) {
    return Object.assign({}, vault, { iv: box.iv, ct: box.ct });
  });
}

// ── Wrong PINs ──
// Wait (ms) after `fails` wrong PINs in a row: none for the first 4, then 30 s, 1 min, 2 min, 4 min, 8 min.
function lockDelayFor(fails) {
  if (fails <= LOCK_FREE_FAILS) return 0;
  return 30000 * Math.pow(2, fails - LOCK_FREE_FAILS - 1);
}
function lockWaitLeft(vault, now) {
  if (!vault || !vault.fails) return 0;
  return Math.max(0, (vault.failAt || 0) + lockDelayFor(vault.fails) - now);
}
function lockTriesLeft(vault) { return LOCK_MAX_FAILS - ((vault && vault.fails) || 0); }

// Remove everything the PIN protects from this device. The URL, theme and other settings stay;
// the data in Google Sheets is never touched.
function lockWipe() {
  [LOCK_KEY, LOCK_TOKEN_PLAIN].concat(LOCK_DATA_KEYS).forEach(function(k) {
    try { localStorage.removeItem(k); } catch (e) {}
  });
}

// Try a PIN against the stored vault. Resolves to one of:
//   { ok:true, key, secret }                       right PIN (the fail count is reset)
//   { ok:false, waiting:true, wait, fails, left }  still in a delay — the PIN was not tried
//   { ok:false, fails, left, wait }                wrong PIN
//   { ok:false, wiped:true }                       wrong PIN number LOCK_MAX_FAILS: everything was wiped
//   { ok:false, noVault:true }
// The attempt is counted (and saved) before the PIN is checked, so closing the app mid-check doesn't skip it.
function lockTryPin(pin, now) {
  var vault = lockReadVault();
  if (!vault) return Promise.resolve({ ok: false, noVault: true });
  now = now || Date.now();
  var wait = lockWaitLeft(vault, now);
  if (wait > 0) return Promise.resolve({ ok: false, waiting: true, wait: wait, fails: vault.fails, left: lockTriesLeft(vault) });
  vault.fails = (vault.fails || 0) + 1;
  vault.failAt = now;
  lockWriteVault(vault);
  var tried = lockValidPin(pin) ? lockDeriveKey(pin, lockUnb64(vault.salt), vault.it || LOCK_ITER).then(function(key) {
    return lockDecrypt(key, vault).then(function(secret) { return { key: key, secret: secret }; });
  }) : Promise.reject(new Error('bad pin'));
  return tried.then(function(r) {
    vault.fails = 0; vault.failAt = 0;
    lockWriteVault(vault);
    return { ok: true, key: r.key, secret: r.secret };
  }, function() {
    if (vault.fails >= LOCK_MAX_FAILS) { lockWipe(); return { ok: false, wiped: true }; }
    return { ok: false, fails: vault.fails, left: lockTriesLeft(vault), wait: lockDelayFor(vault.fails) };
  });
}

// Write a new vault with its sealed [cache, queue]. The order matters if storage is full: the cache goes first
// (it can be fetched again), the queue is written before the vault (if it fails, the old vault and queue still match).
function lockStoreSealed(vault, sealed) {
  localStorage.removeItem(LOCK_DATA_KEYS[0]);
  if (sealed[1]) localStorage.setItem(LOCK_DATA_KEYS[1], sealed[1]); else localStorage.removeItem(LOCK_DATA_KEYS[1]);
  lockWriteVault(vault);
  if (sealed[0]) { try { localStorage.setItem(LOCK_DATA_KEYS[0], sealed[0]); } catch (e) {} }
}

// ── First run after the update: a plaintext token (and plain cache/queue) exist ──
function lockNeedsMigration() {
  try { return !lockReadVault() && !!localStorage.getItem(LOCK_TOKEN_PLAIN); } catch (e) { return false; }
}
// Encrypt the token, cache and queue under a new PIN and delete the plain copies. `token` is the one just
// typed on the setup screen; without it, the plain token stored by the old version is used.
// Everything is encrypted first, then written in one go, so a failure leaves the old data as it was.
// Resolves to { key, secret, queue, cache } — the decrypted values, ready to use.
function lockMigrate(pin, token) {
  if (token === undefined) token = localStorage.getItem(LOCK_TOKEN_PLAIN) || '';
  var plain = LOCK_DATA_KEYS.map(function(k) { return localStorage.getItem(k); });
  var parsed = plain.map(function(t) {
    if (!t || lockIsSealed(t)) return null;   // a sealed leftover from an old vault can't be read — drop it
    try { return JSON.parse(t); } catch (e) { return null; }
  });
  var cache = parsed[0], queue = Array.isArray(parsed[1]) ? parsed[1] : [];
  return lockCreateVault(pin, { token: token }).then(function(made) {
    return Promise.all([
      cache ? lockSeal(made.key, cache) : null,
      queue.length ? lockSeal(made.key, queue, { n: queue.length }) : null
    ]).then(function(sealed) {
      lockStoreSealed(made.vault, sealed);
      localStorage.removeItem(LOCK_TOKEN_PLAIN);
      return { key: made.key, secret: { token: token }, queue: queue, cache: cache };
    });
  });
}

// New PIN: a new salt and key; the token, cache and queue are re-encrypted with it, then written in one go.
function lockChangePin(oldKey, newPin, secret) {
  var stored = LOCK_DATA_KEYS.map(function(k) { return localStorage.getItem(k); });
  return Promise.all(stored.map(function(t) {
    return lockUnseal(oldKey, t, null).catch(function() { return null; });
  })).then(function(vals) {
    return lockCreateVault(newPin, secret).then(function(made) {
      var queue = Array.isArray(vals[1]) ? vals[1] : [];
      return Promise.all([
        vals[0] ? lockSeal(made.key, vals[0]) : null,
        queue.length ? lockSeal(made.key, queue, { n: queue.length }) : null
      ]).then(function(sealed) {
        lockStoreSealed(made.vault, sealed);
        return made.key;
      });
    });
  });
}

// Offline entries waiting to be sent (readable while locked, so the wipe warning can say how many)
function lockQueuedCount() {
  try {
    var t = localStorage.getItem(LOCK_DATA_KEYS[1]);
    var info = lockSealedInfo(t);
    if (info) return info.n || 0;
    var q = t ? JSON.parse(t) : [];
    return Array.isArray(q) ? q.length : 0;
  } catch (e) { return 0; }
}
