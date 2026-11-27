// Project detail: every expense of one project, across months, with breakdowns. Run with `npm test`.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackend } = require('./harness');

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.006, (msg || '') + ` expected ${b}, got ${a}`);
function setup() {
  const b = createBackend();
  b.api({ action: 'addAccount', name: 'Bank', type: 'bank', startingBalance: 100000 });
  b.api({ action: 'addProject', name: 'Japan trip', budget: 50000, startDate: '2026-10-01', endDate: '2026-12-31' });
  b.api({ action: 'addProject', name: 'Wedding', budget: 0 });
  const exp = (date, amount, category, projectId, note) => b.api({ action: 'addExpense', date, amount, category, account: 'Bank', projectId: projectId || '', note: note || '' });
  return Object.assign(b, { exp });
}

test('project detail: only that project\'s expenses, from every month, newest first', () => {
  const b = setup();
  b.exp('2026-10-05', 12000, 'Travel', 'Japan trip', 'Flights');
  b.exp('2026-11-20', 3000, 'Food & Dining', 'Japan trip', 'Ramen');
  b.exp('2026-11-21', 8000, 'Travel', 'Japan trip', 'Hotel');
  b.exp('2026-11-21', 500, 'Food & Dining', '', 'Not a project');
  b.exp('2026-11-22', 999, 'Shopping', 'Wedding');
  const r = b.api({ action: 'getProjectDetail', name: 'Japan trip' });
  assert.ok(r.ok);
  assert.deepEqual(r.expenses.map(e => e.note), ['Hotel', 'Ramen', 'Flights']);
  assert.ok(r.expenses.every(e => e.type === 'expense' && e.id && e.rowIndex), 'editable like the transaction list');
  near(r.project.spent, 23000); assert.equal(r.project.count, 3); near(r.project.budget, 50000);
  assert.equal(r.project.startDate, '2026-10-01');
});

test('project detail: breakdown by category (biggest first) and by month (newest first)', () => {
  const b = setup();
  b.exp('2026-10-05', 12000, 'Travel', 'Japan trip');
  b.exp('2026-11-20', 3000, 'Food & Dining', 'Japan trip');
  b.exp('2026-11-21', 8000, 'Travel', 'Japan trip');
  const r = b.api({ action: 'getProjectDetail', name: 'Japan trip' });
  assert.deepEqual(JSON.parse(JSON.stringify(r.categories)), [{ category: 'Travel', amount: 20000 }, { category: 'Food & Dining', amount: 3000 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(r.months)), [{ month: '2026-11', amount: 11000 }, { month: '2026-10', amount: 12000 }]);
});

test('project detail matches getProjects spent, and an empty project is fine', () => {
  const b = setup();
  b.exp('2026-10-05', 12000.5, 'Travel', 'Japan trip');
  b.exp('2026-11-20', 3000.25, 'Food & Dining', 'Japan trip');
  const list = b.api({ action: 'getProjects' }).projects.find(p => p.name === 'Japan trip');
  near(b.api({ action: 'getProjectDetail', name: 'Japan trip' }).project.spent, list.spent);
  const w = b.api({ action: 'getProjectDetail', name: 'Wedding' });
  assert.ok(w.ok); assert.equal(w.expenses.length, 0); near(w.project.spent, 0);
});

test('project detail: unknown project is stale; no name is an error', () => {
  const b = setup();
  assert.equal(b.api({ action: 'getProjectDetail', name: 'Nope' }).stale, true);
  assert.equal(b.api({ action: 'getProjectDetail' }).ok, false);
});

// ── Completed projects (display only) ──
test('a project starts active; completing it records the date, reopening clears it', () => {
  const b = setup();
  const list = () => b.api({ action: 'getProjects' }).projects;
  const japan = () => list().find(p => p.name === 'Japan trip');
  assert.equal(japan().status, 'active'); assert.equal(japan().completedDate, '');
  const r = b.api({ action: 'setProjectStatus', key: 'Japan trip', rowIndex: japan().rowIndex, status: 'completed' });
  assert.ok(r.ok, r.error);
  assert.equal(japan().status, 'completed');
  assert.match(japan().completedDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(Array.from(b.sheets.Projects.rows[0]).slice(4), ['Status', 'CompletedDate'], 'columns added at the end');
  assert.equal(list().find(p => p.name === 'Wedding').status, 'active', 'only that project');
  assert.equal(b.api({ action: 'getProjectDetail', name: 'Japan trip' }).project.status, 'completed');
  assert.ok(b.api({ action: 'setProjectStatus', key: 'Japan trip', rowIndex: japan().rowIndex, status: 'active' }).ok);
  assert.equal(japan().status, 'active'); assert.equal(japan().completedDate, '');
});

test('completing changes no spending: totals, expenses, balances and net worth stay the same', () => {
  const b = setup();
  b.exp('2026-10-05', 12000, 'Travel', 'Japan trip', 'Flights');
  b.exp('2026-11-20', 3000, 'Food & Dining', 'Japan trip');
  const before = { projects: b.api({ action: 'getProjects' }).projects.map(p => [p.name, p.spent]),
    detail: b.api({ action: 'getProjectDetail', name: 'Japan trip' }).expenses.length,
    total: b.api({ action: 'getAccounts' }).totalBalance, nw: b.api({ action: 'getNetWorthHistory' }).months.map(m => m.netWorth) };
  b.api({ action: 'setProjectStatus', key: 'Japan trip', status: 'completed' });
  const after = { projects: b.api({ action: 'getProjects' }).projects.map(p => [p.name, p.spent]),
    detail: b.api({ action: 'getProjectDetail', name: 'Japan trip' }).expenses.length,
    total: b.api({ action: 'getAccounts' }).totalBalance, nw: b.api({ action: 'getNetWorthHistory' }).months.map(m => m.netWorth) };
  assert.deepEqual(JSON.parse(JSON.stringify(after)), JSON.parse(JSON.stringify(before)));
  near(after.projects[0][1], 15000);
});

test('editing a completed project keeps it completed; unknown project is stale; bad status is refused', () => {
  const b = setup();
  const japan = () => b.api({ action: 'getProjects' }).projects.find(p => p.name === 'Japan trip');
  b.api({ action: 'setProjectStatus', key: 'Japan trip', status: 'completed' });
  assert.ok(b.api({ action: 'updateProject', key: 'Japan trip', rowIndex: japan().rowIndex, name: 'Japan trip', budget: 60000 }).ok);
  assert.equal(japan().status, 'completed', 'updateProject only writes the first 4 columns');
  near(japan().budget, 60000);
  assert.equal(b.api({ action: 'setProjectStatus', key: 'Nope', status: 'completed' }).stale, true);
  assert.equal(b.api({ action: 'setProjectStatus', key: 'Wedding', status: 'done' }).ok, false);
});

test('a project row typed by hand with Status "Completed" counts as completed; anything else as active', () => {
  const b = setup();
  b.api({ action: 'getProjects' });
  b.sheets.Projects.rows[1][4] = ' Completed ';
  b.sheets.Projects.rows[2][4] = 'paused';
  const ps = b.api({ action: 'getProjects' }).projects;
  assert.equal(ps[0].status, 'completed'); assert.equal(ps[1].status, 'active');
});
