// PIN lock (js/lock.js): the browser script loaded in a vm with Node's WebCrypto and a fake localStorage.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CODE = fs.readFileSync(path.join(__dirname, '..', 'js', 'lock.js'), 'utf8');
const PIN = '482916';
const TOKEN = 'tok-SECRET-abc123-very-private';

function fakeStorage() {
  const m = new Map();
  return {
    map: m,
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    all: () => Array.from(m.values()).join('\n'),
  };
}
// A fresh copy of lock.js. `fast` lowers PBKDF2 rounds so the many-tries tests stay quick
// (the real count is checked on its own below).
function load(opts) {
  const store = fakeStorage();
  const ctx = { crypto: globalThis.crypto, TextEncoder, TextDecoder, btoa, atob, localStorage: store, Date, JSON, Math };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx, { filename: 'js/lock.js' });
  if (!opts || opts.fast !== false) ctx.LOCK_ITER = 1000;
  return { L: ctx, store };
}
async function withVault(L, pin) {
  const made = await L.lockCreateVault(pin || PIN, { token: TOKEN });
  L.lockWriteVault(made.vault);
  return made;
}

test('PBKDF2 uses at least 210,000 rounds and the vault records them', async () => {
  const { L } = load({ fast: false });
  assert.ok(L.LOCK_ITER >= 210000);
  const made = await L.lockCreateVault(PIN, { token: TOKEN });
  assert.equal(made.vault.it, L.LOCK_ITER);
  assert.equal(L.lockUnb64(made.vault.salt).length, 16);
  assert.equal(L.lockUnb64(made.vault.iv).length, 12);
});

test('round trip: the right PIN opens the vault and gives the token back', async () => {
  const { L } = load();
  await withVault(L);
  const r = await L.lockTryPin(PIN, 1000);
  assert.equal(r.ok, true);
  assert.equal(r.secret.token, TOKEN);
  const sealed = await L.lockSeal(r.key, { hello: 'world', n: [1, 2] });
  assert.deepEqual(JSON.parse(JSON.stringify(await L.lockUnseal(r.key, sealed))), { hello: 'world', n: [1, 2] });
});

test('a wrong PIN fails and is counted; the right PIN resets the count', async () => {
  const { L } = load();
  await withVault(L);
  const bad = await L.lockTryPin('000000', 1000);
  assert.equal(bad.ok, false);
  assert.equal(bad.fails, 1);
  assert.equal(bad.left, 9);
  assert.equal(L.lockReadVault().fails, 1);
  const bad2 = await L.lockTryPin('12345', 2000);          // not 6 digits: still a wrong try
  assert.equal(bad2.ok, false);
  assert.equal(L.lockReadVault().fails, 2);
  const good = await L.lockTryPin(PIN, 3000);
  assert.equal(good.ok, true);
  assert.equal(L.lockReadVault().fails, 0);
});

test('a sealed value cannot be opened with a key from another PIN', async () => {
  const { L } = load();
  const a = await L.lockCreateVault(PIN, { token: TOKEN });
  const b = await L.lockCreateVault('111111', { token: TOKEN });
  const sealed = await L.lockSeal(a.key, [1, 2, 3]);
  await assert.rejects(L.lockUnseal(b.key, sealed));
  await assert.rejects(L.lockUnseal(a.key, '[1,2,3]'), /not sealed/);   // plain text is never accepted
});

test('every encryption uses a new IV', async () => {
  const { L } = load();
  const { key } = await L.lockCreateVault(PIN, { token: TOKEN });
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    const box = await L.lockEncrypt(key, { same: 'value' });
    assert.ok(!seen.has(box.iv), 'IV reused');
    seen.add(box.iv);
  }
  const s1 = JSON.parse(await L.lockSeal(key, 'x')), s2 = JSON.parse(await L.lockSeal(key, 'x'));
  assert.notEqual(s1.iv, s2.iv);
  assert.notEqual(s1.ct, s2.ct);
});

test('the attempt is saved before the PIN is checked (closing the app mid-check does not skip it)', async () => {
  const { L, store } = load();
  await withVault(L);
  const p = L.lockTryPin('999999', 1000);
  assert.equal(JSON.parse(store.getItem(L.LOCK_KEY)).fails, 1);   // already written, synchronously
  await p;
});

test('delay schedule: free tries, then 30 s, 1 min, 2 min, 4 min, 8 min; 10 wrong wipes', () => {
  const { L } = load();
  assert.deepEqual([0, 1, 2, 3, 4].map(L.lockDelayFor), [0, 0, 0, 0, 0]);
  assert.deepEqual([5, 6, 7, 8, 9].map(L.lockDelayFor), [30000, 60000, 120000, 240000, 480000]);
  assert.equal(L.LOCK_MAX_FAILS, 10);
});

test('wrong PINs: the delay is enforced (and not counted), survives a reload, and the 10th wipes everything', async () => {
  const { L, store } = load();
  await withVault(L);
  store.setItem('moneyCache_v1', '{"sealed":1,"iv":"a","ct":"b"}');
  store.setItem('moneyQueue_v1', '{"sealed":1,"n":2,"iv":"a","ct":"b"}');
  store.setItem('moneyScriptUrl', 'https://example.invalid/exec');
  store.setItem('themePref', 'dark');
  let now = 1000000;
  for (let i = 1; i <= 4; i++) {
    const r = await L.lockTryPin('000000', now);
    assert.equal(r.fails, i); assert.equal(r.wait, 0); assert.equal(r.left, 10 - i);
  }
  let r = await L.lockTryPin('000000', now);                // 5th wrong: the delay starts
  assert.equal(r.fails, 5); assert.equal(r.wait, 30000); assert.equal(r.left, 5);
  // During the delay even the right PIN isn't tried, and the try isn't counted
  r = await L.lockTryPin(PIN, now + 29000);
  assert.equal(r.ok, false); assert.equal(r.waiting, true); assert.equal(r.fails, 5);
  // A reload (fresh copy of the script, same storage) keeps the count and the wait
  const L2 = load().L; L2.localStorage = store;
  assert.equal(L2.lockWaitLeft(L2.lockReadVault(), now + 10000), 20000);
  const delays = [60000, 120000, 240000, 480000];
  for (let i = 0; i < 4; i++) {
    now += 10 * 60 * 1000;
    r = await L.lockTryPin('000000', now);
    assert.equal(r.fails, 6 + i); assert.equal(r.wait, delays[i]); assert.equal(r.left, 4 - i);
  }
  assert.equal(L.lockQueuedCount(), 2);                      // what the warning tells the user before the last try
  now += 10 * 60 * 1000;
  r = await L.lockTryPin('000000', now);                     // 10th wrong
  assert.equal(r.wiped, true);
  assert.equal(store.getItem(L.LOCK_KEY), null);
  assert.equal(store.getItem('moneyCache_v1'), null);
  assert.equal(store.getItem('moneyQueue_v1'), null);
  assert.equal(store.getItem('moneyScriptUrl'), 'https://example.invalid/exec');   // the URL and settings stay
  assert.equal(store.getItem('themePref'), 'dark');
  assert.equal((await L.lockTryPin(PIN, now + 1)).noVault, true);
});

test('migration from a plaintext token encrypts token, cache and queue and deletes the plain copies', async () => {
  const { L, store } = load();
  const cache = { m: 11, y: 2026, d: { accounts: { ok: true, accounts: [{ name: 'SecretBankXYZ', balance: 123456.78 }] } } };
  const queue = [{ action: 'addExpense', id: 'E1', amount: 777.77, note: 'PrivateNoteQQQ', qid: 'Q1' }];
  store.setItem('moneyToken', TOKEN);
  store.setItem('moneyScriptUrl', 'https://example.invalid/exec');
  store.setItem('moneyCache_v1', JSON.stringify(cache));
  store.setItem('moneyQueue_v1', JSON.stringify(queue));
  assert.equal(L.lockNeedsMigration(), true);

  const r = await L.lockMigrate(PIN);
  assert.equal(r.secret.token, TOKEN);
  assert.equal(store.getItem('moneyToken'), null);
  assert.equal(L.lockNeedsMigration(), false);
  assert.equal(store.getItem('moneyScriptUrl'), 'https://example.invalid/exec');   // the URL can stay plain
  assert.ok(L.lockIsSealed(store.getItem('moneyCache_v1')));
  assert.ok(L.lockIsSealed(store.getItem('moneyQueue_v1')));
  assert.equal(L.lockQueuedCount(), 1);

  // A later unlock gets everything back
  const u = await L.lockTryPin(PIN, 5000);
  assert.equal(u.ok, true);
  assert.equal(u.secret.token, TOKEN);
  assert.deepEqual(JSON.parse(JSON.stringify(await L.lockUnseal(u.key, store.getItem('moneyQueue_v1')))), queue);
  assert.deepEqual(JSON.parse(JSON.stringify(await L.lockUnseal(u.key, store.getItem('moneyCache_v1')))), cache);
});

test('storage never holds the PIN, the token or the data in plain text (not even base64)', async () => {
  const { L, store } = load();
  store.setItem('moneyToken', TOKEN);
  store.setItem('moneyCache_v1', JSON.stringify({ m: 1, y: 2026, d: { note: 'SecretBankXYZ' } }));
  store.setItem('moneyQueue_v1', JSON.stringify([{ action: 'addIncome', note: 'PrivateNoteQQQ' }]));
  const r = await L.lockMigrate(PIN);
  const all = store.all();
  for (const s of [PIN, TOKEN, 'SecretBankXYZ', 'PrivateNoteQQQ']) {
    assert.ok(!all.includes(s), s + ' found in storage');
    assert.ok(!all.includes(Buffer.from(s).toString('base64').replace(/=+$/, '')), s + ' found base64-encoded');
  }
  // …and after a PIN change
  const key2 = await L.lockChangePin(r.key, '135790', { token: TOKEN });
  const all2 = store.all();
  for (const s of ['135790', PIN, TOKEN, 'SecretBankXYZ', 'PrivateNoteQQQ']) assert.ok(!all2.includes(s), s + ' found after PIN change');
  assert.ok(key2);
});

test('change PIN: the old PIN stops working, the new one opens the token, cache and queue', async () => {
  const { L, store } = load();
  const made = await withVault(L);
  store.setItem('moneyQueue_v1', await L.lockSeal(made.key, [{ id: 'E9' }], { n: 1 }));
  store.setItem('moneyCache_v1', await L.lockSeal(made.key, { m: 1, y: 2026, d: { x: 1 } }));
  const oldSalt = L.lockReadVault().salt;
  const newKey = await L.lockChangePin(made.key, '135790', { token: TOKEN });
  assert.notEqual(L.lockReadVault().salt, oldSalt);
  assert.equal((await L.lockTryPin(PIN, 1000)).ok, false);
  const r = await L.lockTryPin('135790', 2000);
  assert.equal(r.ok, true);
  assert.equal(r.secret.token, TOKEN);
  assert.equal((await L.lockUnseal(newKey, store.getItem('moneyQueue_v1')))[0].id, 'E9');
  assert.equal((await L.lockUnseal(r.key, store.getItem('moneyCache_v1'))).d.x, 1);
  assert.equal(L.lockQueuedCount(), 1);
});

test('a new token (Settings) is re-encrypted with the same key', async () => {
  const { L } = load();
  const made = await withVault(L);
  L.lockWriteVault(await L.lockResealVault(L.lockReadVault(), made.key, { token: 'new-token-999' }));
  const r = await L.lockTryPin(PIN, 1000);
  assert.equal(r.secret.token, 'new-token-999');
});

test('PINs must be exactly 6 digits', async () => {
  const { L } = load();
  for (const p of ['12345', '1234567', 'abcdef', '12 456', '']) assert.equal(L.lockValidPin(p), false, p);
  assert.equal(L.lockValidPin('012345'), true);
  await assert.rejects(L.lockCreateVault('1234', { token: TOKEN }));
});
