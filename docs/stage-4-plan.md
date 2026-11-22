# Stage 4 plan — split out the Wealth Planner

Status: **agreed 2026-11-22** (decisions in section 2). Nothing in this plan has been built yet.
Goal (from `ROADMAP.md`): Money Tracker stays a fast cashflow app; assets and investments move to their own app.

---

## 1. What is coupled today

The investment code is not a separate island. Five places in Money Tracker reach into it:

| Where | What it does with investments | After the split |
|---|---|---|
| `accountBalances()` — `src/07_accounts.gs` | A **buy** takes cash out of the account in `HoldingTxns.Account`, a **sell** puts it back. Closed **trades** add their net P/L to their account. | Replaced by ordinary transfers into a linked investment account (section 3). |
| `getAllTransactions()` — `src/11_combined.gs` | Lists buys/sells as `type: "holding"` rows. | Gone. They become transfers. |
| `addHoldingTxn()` — `src/16_holdings.gs` | Writes fees into **Expenses** ("Investment Fees") and dividends into **Income** ("Investment Returns"), joined by `LinkedId`. | Rows already written stay in Money Tracker as history. New ones: fees stay in the Wealth Planner; dividends still get an Income record in Money Tracker (D3). |
| Net worth — `src/19_net_worth.gs`, `bootstrap()`, `dailyRefresh()`, `js/dashboard.js` | Net worth = accounts + holdings value + receivables. Estimated months use `holdingsAt()` (at cost). | Net worth = accounts (linked ones at their Wealth Planner value) + receivables. |
| `refreshPrices()` — `src/18_prices.gs` | Also refreshes the **exchange rates of accounts**, not only holding prices. | Money Tracker keeps the exchange-rate half. |

Files that move wholesale: `src/16_holdings.gs`, `src/21_portfolio.gs`, `src/22_trading_journal.gs`, the holding parts of `src/18_prices.gs` and `src/23_import.gs`, `js/holdings.js`, `js/portfolio.js`, and the holding/trade/portfolio modals in `index.html` (`#holdings-section`, `#holding-modal`, `#trade-modal`, `#portfolio-modal`).
Tabs that move: `Holdings`, `HoldingTxns`, `Trades`, `AllocationTargets`, plus Script Properties `BENCH`, `BENCH_SYMBOL`.

**Gap:** there are no tests for holdings or trades yet (`tests/money.test.js` covers accounts, transfers and receivables only). Those tests come first (step 1), so the port has something to prove it changed nothing.

---

## 2. Decisions (agreed by Arm, 2026-11-22)

These change the money rules in `CLAUDE.md`, so an agent must not change them without asking Arm.

- **D1. How the two apps talk.** Agreed: each app writes a small **export tab**, and the other app's backend reads that tab by spreadsheet ID. Both sheets belong to the same Google account, so no web-app tokens are needed. The spreadsheet ID goes in Script Properties, never in code. Alternative: call each other's web app. That needs tokens and makes a network call on every bootstrap.
- **D2. Where the cash for a buy lives.** Agreed: every broker (or "paid straight from the bank" place, such as a gold shop) gets a **linked investment account** in Money Tracker. Cash reaches it by a transfer, Money Tracker shows its value from the Wealth Planner, and the Wealth Planner tracks the cash inside it (deposits − buys + sells + dividends − fees).
- **D3. Dividends and fees from now on.**
  - **Dividends:** each broker has a setting for where its dividends are paid: **the broker (linked) account** or **a specific bank account**. Either way, every dividend is **always recorded**: in the Wealth Planner's dividend history (with tax withheld) **and** as an Income row ("Investment Returns") in Money Tracker, so income reports still include it.
    - Paid to a bank account → the Income row adds to that bank's balance, exactly as today.
    - Paid to the broker → the Income row is on the linked account. It is a record only: the linked account's balance comes from the Wealth Planner value (which already includes the dividend), so it is not added twice.
  - **Fees:** recorded in the Wealth Planner only; they lower the broker's value. (Old fee rows stay in Money Tracker.)
- **D4. Assets** (property, vehicle, electronics; `HOLDING_KINDS` group `"asset"`). Agreed: move them too, since the roadmap says "assets and investments".
- **D5. Old net-worth months.** Saved snapshots keep their `Investments`/`Assets` columns unchanged. Agreed: months that are rebuilt (estimated) value linked accounts at what was transferred in. That's the same "at cost" idea as today.

D1, D2, D4 and D5 are the recommended options, agreed as written.

---

## 3. The contract between the apps

```
Money Tracker  ──writes──▶  tab  _Export_LinkedFlows   Id | Date | Account | Amount | Currency
                             (every transfer into / out of a linked investment account)
Wealth Planner ──reads───▶  turns those into deposits / withdrawals of broker cash

Wealth Planner ──writes──▶  tab  _Export_Values        Account | Currency | Value | ValueTHB | AsOf
Money Tracker  ──reads───▶  balance of each linked investment account

Wealth Planner ──writes──▶  tab  _Export_Dividends     Id | Date | Holding | Amount (THB) | OrigAmount | Currency | Tax | Account
Money Tracker  ──reads───▶  one Income row per dividend ("Investment Returns"), matched by Id
```

- An account is linked when it has a new `Accounts` column `LinkedTo`, added with `ensureHeaders` at the end of the row (never reorder columns).
- A linked account's balance = the `Value` from `_Export_Values`. If the tab can't be read, use the last value Money Tracker cached and mark the account "value from <AsOf>". Never show 0.
- Transfers into a linked account still never change the total at the moment they happen (the existing transfer rule). After that, the total moves only when market value moves.
- `_Export_Dividends.Account` is the broker's dividend setting at the time: the linked account or a bank account name.
- Money Tracker keeps its dividend Income rows in step with `_Export_Dividends` by `Id`: add the new ones, update changed ones, remove the ones no longer exported. It only touches rows whose `Id` came from this tab (prefix `WD`), never Income you typed yourself.
- In `accountBalances()`, Income rows on a **linked** account are skipped (the Wealth Planner value already includes them); on any other account they count as usual.
- All export tabs are rebuilt whole on each write (no partial edits). Ids are reused so a re-read never duplicates a row.

---

## 4. Steps

Each step is one branch → one PR → `npm run check` green → Arm reviews and merges. **(A)** marks the steps only Arm can do.

### Step 1 — Pin today's behaviour with tests (Money Tracker)
- Add `tests/holdings.test.js` against the fake sheet: average cost, realised/unrealised, sell more than held is refused, buy/sell moving account cash (THB and USD accounts, `OrigAmount`), fee → Expenses, dividend → Income with tax, deleting a holding removes its linked rows, `holdingsAt()` for net worth, and trade P/L changing an account balance.
- Add a read-only `reconcile` function returning every account balance (own currency and THB), holdings totals, receivables and net worth as one JSON object. Arm runs it from the Apps Script editor (running a function is fine; editing code there is not) and keeps the output as **before.json**.
- No behaviour change. This step can run in parallel with step 2.

### Step 2 — Create the Wealth Planner shell
- **(A)** Create the GitHub repo, a new Google Sheet "Wealth Planner", and a bound Apps Script project. Make one deployment and send the Script ID and Deployment ID. `CLASPRC_JSON` can be reused as a secret in the new repo.
- Agent: scaffold the new repo with what Stages 1–3 built in Money Tracker: the `deploy-backend.yml` + `checks.yml` workflows, ESLint, `tests/harness.js`, `CLAUDE.md`, `CHANGELOG.md` + `APP_VERSION` test, `sw.js`, GitHub Pages. Copy `api()` and the offline queue from `js/core.js`. Copying is fine: the two apps should not share code at run time.

### Step 3 — Port the investment code into the Wealth Planner
- Move the files listed in section 1, and the step 1 tests with them. The tests must pass unchanged, apart from the cash leg, which now uses the broker-cash ledger (D2).
- Add the broker-cash ledger, the reader for `_Export_LinkedFlows`, the writers for `_Export_Values` and `_Export_Dividends`, the per-broker "dividends paid to" setting (broker or a bank account), and the daily price refresh trigger. A dividend paid to a bank does **not** add to broker cash.
- Port `importPack` holdings + trades and `fetchBenchmark`.
- Front end: the holdings list, the holding/trade/portfolio modals, allocation & targets, returns vs index, dividends, the trading journal.

### Step 4 — Linked investment accounts in Money Tracker
- `LinkedTo` column, the reader for `_Export_Values` with the cached fallback, the writer for `_Export_LinkedFlows`, and the dividend sync from `_Export_Dividends` into Income.
- Account form: a "Linked investment account" type. The dashboard and net worth stop adding `holdingTotals`, because the value is now inside accounts.
- Add the D5 rule to `netWorthHistory()`.
- Tests: a linked account's balance comes from the export, a transfer into it leaves the total unchanged, there's no double counting in net worth, and the missing-export fallback works. Dividends: one paid to a bank raises that bank's balance; one paid to a broker appears in income reports but doesn't change the linked balance; syncing twice adds nothing; a dividend deleted in the Wealth Planner disappears; Income you typed yourself is never touched.
- Hidden behind "no account is linked yet" so it can merge before the migration. With nothing linked, behaviour is exactly as today.
- Steps 3 and 4 can run in parallel (two agents) once the contract in section 3 is agreed. A third agent reviews both PRs against the contract.

### Step 5 — Migration (rehearsed on the fake sheet, then run once for real)
- Agent writes `migrateToLinked` (Money Tracker) and a test that runs it on a fake sheet built from the step 1 fixtures. Then it checks that every non-linked account balance and the total net worth come out identical.
- What it does:
  1. Create one linked account per place money went (each distinct `HoldingTxns.Account` used by a buy/sell, plus the trade accounts such as MTS Gold (USD)).
  2. Turn every buy into a transfer *bank → linked account* (same date, amount, `OrigAmount`/currency), and every sell into the reverse. Bank balances stay the same, to the cent.
  3. Leave the historic fee/dividend rows in Expenses/Income where they are. Historic dividends are copied into the Wealth Planner's dividend history but keep their existing Money Tracker Income rows (not re-synced), so nothing is counted twice.
- **(A)** Before running: `backupNow`, copy the four tabs into the Wealth Planner sheet ("Copy to…" in Sheets), and copy the `BENCH*` Script Properties. Then run `migrateToLinked` from the editor and run `reconcile` again → **after.json**.

### Step 6 — Check to the cent
- A script in `scripts/` diffs `before.json` against `after.json`. Every non-linked account balance must match exactly. Net worth must match, except for the market-value difference between "linked account at Wealth Planner value" and "holdings at market value", which should be 0 on the same day.
- **(A)** Arm reads the diff. Any mismatch → stop and fix. Don't go to step 7.

### Step 7 — Remove investment code from Money Tracker
- Only after step 6 is clean and both apps have run side by side for about a week.
- Delete the files listed in section 1, the `route()` cases, the `type: "holding"` rows in the transaction list, and `holdingTotals`.
- **(A)** Hide the old tabs; don't delete them. Bump the `sw.js` `CACHE`.
- Update `CLAUDE.md`: remove the "Planned" section and rewrite the investment money rule to describe linked accounts.

### Later in Stage 4 (separate plans)
- Rebuild the MTS gold history from `gold_investment.xlsx`, with realised/unrealised P/L in USD. This uses Arm's personal statement: an agent opens it only when that is the task, and it is never committed (`.gitignore` already covers `gold_investment*`).
- Asset-planning features (to be decided).

---

## 5. Risks and how the plan handles them

| Risk | Guard |
|---|---|
| Bank balances shift after the migration | Step 5 turns each buy/sell into a transfer with the same amount; step 6 checks every balance to the cent. |
| A dividend paid to a broker counted twice (Income row **and** Wealth Planner value) | Income rows on linked accounts are skipped in balances; step 4 test. |
| Net worth counted twice (linked account value **and** holdings) | Step 4 test; `holdingTotals` is dropped from net worth in the same PR that adds linked accounts. |
| The Wealth Planner is down or its export is stale | Cached last value, shown with its date; never 0. |
| An agent touches live data | Every step runs on the fake sheet; Arm runs `reconcile` and `migrateToLinked` by hand (`CLAUDE.md` rule 1). |
| Losing the old data | `backupNow` before step 5; old tabs are hidden, not deleted, in step 7. |
