// The Stage 4 migration rehearsal (docs/stage-4-plan.md step 5–6, docs/stage-4-migration-runbook.md),
// end to end with BOTH apps' real code on fake sheets: the runbook's steps in order.
// Used by tests/migration.test.js here and by the Wealth Planner's tests/migration.test.js, so the same
// rehearsal runs in both repos' CI. No network, no real data.
'use strict';
const path = require('path');
const fs = require('fs');

const plain = x => JSON.parse(JSON.stringify(x));
const TABS = ['Holdings', 'HoldingTxns', 'Trades', 'AllocationTargets'];   // "Copy to…" in the runbook

// A checkout of the other repo: an env var, or next to this one (CI clones it there)
function findRepo(here, name, marker, envVar) {
  const tries = [process.env[envVar], path.join(here, '..', name), path.join(here, '..', '..', name)];
  return tries.find(d => d && fs.existsSync(path.join(d, marker)) && fs.existsSync(path.join(d, 'tests', 'harness.js')));
}

// Every tab as plain rows (trailing empty cells dropped: a real sheet has no row length)
function sheetDump(sheets, names) {
  const out = {};
  (names || Object.keys(sheets)).sort().forEach(n => {
    if (!sheets[n]) return;
    out[n] = plain(sheets[n].rows).map(r => { r = r.map(v => (v === undefined || v === null ? '' : v)); while (r.length && r[r.length - 1] === '') r.pop(); return r; });
  });
  return out;
}

// opts: { mtDir, wpDir, fixture, mapping, compare, afterMigrate(mt), beforeCopy(mt, wp) }
function rehearse(opts) {
  const mtH = require(path.join(opts.mtDir, 'tests', 'harness.js'));
  const wpH = require(path.join(opts.wpDir, 'tests', 'harness.js'));
  const fixture = opts.fixture, mapping = JSON.stringify(opts.mapping || fixture.MAPPING);
  const out = { steps: [] };
  const step = (name, v) => { out.steps.push(name); return v; };

  // Money Tracker as it is today
  const mt = mtH.createBackend({ now: fixture.NOW });
  fixture.build(mt);
  out.mt = mt;
  out.sheetBefore = sheetDump(mt.sheets);
  // 1. reconcile → before.json
  out.before = step('reconcile before', plain(mt.run('reconcile')));
  // 2. migrationPlan
  out.plan = step('migrationPlan', plain(mt.run('migrationPlan', mapping)));
  if (!out.plan.ok) return out;
  // 3. migrateToLinked (twice: the second run must change nothing)
  out.migrated = step('migrateToLinked', plain(mt.run('migrateToLinked', mapping)));
  out.sheetMigrated = sheetDump(mt.sheets);
  out.migratedAgain = plain(mt.run('migrateToLinked', mapping));
  out.sheetMigratedAgain = sheetDump(mt.sheets);
  if (opts.afterMigrate) opts.afterMigrate(mt);
  // Money Tracker writes _Export_LinkedFlows on its next start (WEALTH_SHEET_ID set: runbook step 8)
  mt.props.WEALTH_SHEET_ID = mtH.WEALTH_ID;
  mt.api({ action: 'bootstrap', month: 11, year: 2026 });

  // 4. copy the four tabs into the Wealth Planner + its Script Properties (BENCH*, MONEY_SHEET_ID)
  const wp = wpH.createBackend({ now: fixture.NOW });
  out.wp = wp;
  wp.props.MONEY_SHEET_ID = wpH.MONEY_ID;
  ['BENCH', 'BENCH_SYMBOL'].forEach(k => { if (mt.props[k] !== undefined) wp.props[k] = mt.props[k]; });
  wp.api({ action: 'bootstrap' });                  // a fresh Wealth Planner has its tabs (empty)
  TABS.forEach(n => {
    const rows = plain((mt.sheets[n] || { rows: [] }).rows);
    const sh = wp.makeSheet(n);
    rows.forEach(r => sh.appendRow(r));
    wp.sheets[n] = sh;
  });
  step('copy tabs');
  const copyFlows = () => {
    const rows = plain(mt.sheets._Export_LinkedFlows.rows);
    wp.money.setTab('_Export_LinkedFlows', rows[0], rows.slice(1));
  };
  copyFlows();
  if (opts.beforeCopy) opts.beforeCopy(mt, wp);
  // 5. applyBrokerMapping (twice)
  out.applied = step('applyBrokerMapping', plain(wp.run('applyBrokerMapping', mapping)));
  if (!out.applied.ok) return out;
  out.wpAfterApply = sheetDump(wp.sheets, ['HoldingTxns', 'Trades', 'Brokers']);
  out.appliedAgain = plain(wp.run('applyBrokerMapping', mapping));
  out.wpAfterApplyAgain = sheetDump(wp.sheets, ['HoldingTxns', 'Trades', 'Brokers']);
  // 6. Wealth Planner writeExports
  out.exports = step('writeExports', plain(wp.run('writeExports')));
  const copyExports = () => ['_Export_Values', '_Export_Dividends'].forEach(n => {
    const rows = plain(wp.sheets[n].rows);
    mt.wealth.setTab(n, rows[0], rows.slice(1));
  });
  copyExports();
  // 7. Money Tracker bootstrap
  out.boot = step('bootstrap', mt.api({ action: 'bootstrap', month: 11, year: 2026 }));
  // 8. reconcile → after.json
  out.after = step('reconcile after', plain(mt.run('reconcile')));
  // 9. the compare script
  out.compare = step('compare', opts.compare(out.before, out.after));
  // and once more round the loop (apps opened again): nothing moves
  mt.api({ action: 'bootstrap', month: 11, year: 2026 }); copyFlows();
  wp.run('writeExports'); copyExports();
  mt.api({ action: 'bootstrap', month: 11, year: 2026 });
  out.afterAgain = plain(mt.run('reconcile'));
  return out;
}

module.exports = { rehearse, findRepo, sheetDump, TABS };
