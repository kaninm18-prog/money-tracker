// The hard rule of stage 4 step 4: with no account linked, nothing changes. A realistic sheet
// (tests/fixtures/unlinked.js) must give exactly what the code before step 4 gave; the golden file
// was recorded from that code with `node tests/fixtures/make-golden.js <old src folder>`. Run with `npm test`.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackend } = require('./harness');
const fixture = require('./fixtures/unlinked');
const golden = require('./fixtures/unlinked-golden.json');

const plain = x => JSON.parse(JSON.stringify(x));     // objects made inside the backend's vm → plain JSON

test('nothing linked: getAccounts, net worth, history and snapshots are identical to before step 4', () => {
  const b = createBackend({ now: fixture.NOW });
  fixture.build(b);
  assert.deepEqual(plain(fixture.snapshot(b)), golden);
  assert.equal(b.wealth.opened, 0, 'the Wealth Planner is never opened');
});
