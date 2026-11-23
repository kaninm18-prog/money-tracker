#!/usr/bin/env node
// Stage 4 step 6: compare two `reconcile` outputs, before and after the migration.
//   node scripts/compare-reconcile.js before.json after.json [--max-market=<THB>]
// Each file holds the JSON that `reconcile` logged (a copy of the editor's log line is fine: the text
// before the first "{" is ignored). Runs locally only: no network, reads the two files and nothing else.
// Prints every difference. Exit code 1 (FAIL) on:
//  • any account that isn't linked after the migration with a different balance (to the cent, own currency
//    or THB), or missing, or new;
//  • a change in receivables;
//  • a linked account whose value is stale or unknown (the Wealth Planner export wasn't read);
//  • a net-worth change not explained by the market-value difference, or a market-value difference larger
//    than --max-market (default 0.05 THB: rounding only, as both apps use the same prices on the day).
'use strict';
const fs = require('fs');

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const fmt = n => r2(n).toFixed(2);

function parseReconcile(text) {
  const s = String(text), a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('no JSON object found');
  return JSON.parse(s.slice(a, b + 1));
}

function compare(before, after, opts) {
  opts = opts || {};
  const maxMarket = opts.maxMarket === undefined ? 0.05 : Number(opts.maxMarket);
  const lines = [], fails = [];
  const fail = msg => { fails.push(msg); lines.push('  ✗ ' + msg); };
  const okLine = msg => lines.push('  ✓ ' + msg);
  lines.push(`Stage 4 reconcile check — before ${before.asOf}, after ${after.asOf}`);
  if (before.asOf !== after.asOf) lines.push(`  ! the two files are from different days: prices and rates may have moved; make a fresh before.json on migration day`);

  const b = {}, a = {};
  (before.accounts || []).forEach(x => { b[x.name] = x; });
  (after.accounts || []).forEach(x => { a[x.name] = x; });
  lines.push('', 'Accounts that are not linked (must be identical to the cent):');
  let linkedBefore = 0, linkedAfter = 0;
  const linkedRows = [];
  Object.keys(b).forEach(n => {
    const x = b[n], y = a[n];
    if (!y) { fail(`${n}: missing after the migration`); return; }
    if (y.linkedTo) { linkedBefore += r2(x.balanceThb); return; }
    if (x.linkedTo) { fail(`${n}: was linked before, isn't after`); return; }
    const same = r2(x.balance) === r2(y.balance) && r2(x.balanceThb) === r2(y.balanceThb) && x.currency === y.currency;
    if (same) okLine(`${n}  ${fmt(y.balance)} ${y.currency}`);
    else fail(`${n}: ${fmt(x.balance)} ${x.currency} (${fmt(x.balanceThb)} THB) → ${fmt(y.balance)} ${y.currency} (${fmt(y.balanceThb)} THB)`);
  });
  Object.keys(a).forEach(n => {
    const y = a[n];
    if (y.linkedTo) {
      linkedAfter += r2(y.balanceThb);
      linkedRows.push(`  ${n} → ${y.linkedTo}: ${fmt(b[n] ? b[n].balanceThb : 0)} → ${fmt(y.balanceThb)} THB` + (y.currency !== 'THB' ? ` (${fmt(y.balance)} ${y.currency})` : '') +
        (y.valueAsOf ? `, value as of ${y.valueAsOf}` : ''));
      if (y.stale || !y.valueAsOf) fail(`${n}: its Wealth Planner value is ${y.valueAsOf ? 'stale (from ' + y.valueAsOf + ')' : 'unknown'} — run writeExports in the Wealth Planner, open Money Tracker, then reconcile again`);
    } else if (!b[n]) fail(`${n}: a new account that isn't linked`);
  });

  lines.push('', 'Receivables:');
  if (r2(before.receivables) === r2(after.receivables)) okLine(`${fmt(after.receivables)} THB`);
  else fail(`receivables ${fmt(before.receivables)} → ${fmt(after.receivables)}`);

  // Net worth before = accounts + holdings (Money Tracker's, at market value) + receivables. After, the
  // holdings are inside the linked accounts. The market-value difference is what the linked accounts are
  // worth now, minus (their cash before + the holdings before).
  const holdingsBefore = r2(before.netWorth - before.totalBalance - before.receivables);
  const holdingsAfter = r2(after.netWorth - after.totalBalance - after.receivables);
  const market = r2(linkedAfter - linkedBefore - holdingsBefore + holdingsAfter);
  const diff = r2(after.netWorth - before.netWorth);
  lines.push('', 'Linked accounts (cash + holdings, valued by the Wealth Planner):', ...linkedRows);
  lines.push('', 'Net worth:');
  lines.push(`  before ${fmt(before.netWorth)} = accounts ${fmt(before.totalBalance)} + holdings ${fmt(holdingsBefore)} + receivables ${fmt(before.receivables)}`);
  lines.push(`  after  ${fmt(after.netWorth)} = accounts ${fmt(after.totalBalance)} (linked ${fmt(linkedAfter)})` + (holdingsAfter ? ` + holdings ${fmt(holdingsAfter)}` : '') + ` + receivables ${fmt(after.receivables)}`);
  lines.push(`  difference ${fmt(diff)}: market value ${fmt(market)} (linked accounts now ${fmt(linkedAfter)} vs cash before ${fmt(linkedBefore)} + holdings ${fmt(holdingsBefore)})`);
  if (after.holdingTotals && before.holdingTotals && r2(after.holdingTotals.value) !== r2(before.holdingTotals.value))
    lines.push(`  ! Money Tracker's own holdings value moved ${fmt(before.holdingTotals.value)} → ${fmt(after.holdingTotals.value)}: prices were refreshed in between`);
  const unexplained = r2(diff - market);
  if (Math.abs(unexplained) > 0.005) fail(`net worth moved ${fmt(unexplained)} THB more than the market-value difference explains`);
  if (Math.abs(market) > maxMarket + 1e-9) fail(`market-value difference ${fmt(market)} THB is more than ${fmt(maxMarket)} — check each linked account against its holdings` +
    ` (prices or rates differ between the apps); if that is expected, run again with --max-market=${Math.ceil(Math.abs(market))}`);
  else okLine(`market-value difference ${fmt(market)} THB (allowed ${fmt(maxMarket)})`);

  lines.push('', fails.length ? `FAIL: ${fails.length} problem(s). Don't go on: undo or fix first.` : 'OK: every unlinked balance is identical and net worth is explained.');
  return { ok: !fails.length, fails, lines, market, diff };
}

if (require.main === module) {
  const args = process.argv.slice(2), files = args.filter(x => !x.startsWith('--'));
  const mm = args.find(x => x.startsWith('--max-market='));
  if (files.length !== 2) { console.error('usage: node scripts/compare-reconcile.js before.json after.json [--max-market=<THB>]'); process.exit(2); }
  let before, after;
  try { before = parseReconcile(fs.readFileSync(files[0], 'utf8')); after = parseReconcile(fs.readFileSync(files[1], 'utf8')); }
  catch (e) { console.error('Could not read the files: ' + e.message); process.exit(2); }
  const res = compare(before, after, { maxMarket: mm ? mm.split('=')[1] : undefined });
  console.log(res.lines.join('\n'));
  process.exit(res.ok ? 0 : 1);
}

module.exports = { compare, parseReconcile };
