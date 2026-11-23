# Stage 4 migration runbook (steps 5 and 6)

Arm's steps, in order, to move the investments from Money Tracker (MT) to the Wealth Planner (WP).
Background: `docs/stage-4-plan.md` (D1–D5, C1–C9, the mapping format under step 5).
Every step says **what to check** before going on. If a check fails, stop, and use **Undo** at the bottom.

Everything below runs from each app's **Apps Script editor**: choose the function in the toolbar, press **Run**, read the
**Execution log**. Running a function is fine. Never edit code there.

Plan for about an hour. **Make no new entries in either app, on any device, from step 2 until step 13 is OK.**
A `before.json` from another day can't be compared: prices, rates and entries will have moved.

---

## 0. The day before

1. Both pull requests (`step-5-migration` in each repo) are merged, and both **Deploy backend** runs on GitHub are green.
   - **Check:** in each editor, the function list has `migrationPlan` (MT) and `applyBrokerMapping` (WP).
2. Write the mapping (format in the plan, step 5). Decide:
   - which accounts are linked in place (MTS Gold (USD));
   - for each bank that paid a shop directly, which **broker name** each holding goes to (e.g. "Gold shop");
   - each broker's currency, rate (non-THB brokers) and where its dividends go;
   - the name of the Other assets account.
   - Keep it in a text file on the laptop.
3. In WP, check that the Holdings, HoldingTxns, Trades and AllocationTargets tabs are **empty** (headers only).
   - If you typed test entries there, delete them now. The copied tabs replace them in step 6.
4. Look at **Triggers** (clock icon) in both editors and note when `dailyRefresh` runs.
   - Pick a time well away from it: a price or rate refresh in the middle makes the plan refuse, or shows as a market-value difference.

## 1. Phone and laptop idle

- Open MT on each device and wait until nothing is waiting to send (no "offline / queued" note).
  - Opening it also adds any recurring or instalment entries due today. Let it: they must be in before.json.
- Then close MT and WP everywhere, except this laptop.

## 2. `backupNow` (MT)

- Run `backupNow`.
- **Check:** the log names a new copy of the sheet in Drive, dated today. Open it once to see it's there.

## 3. Fresh `reconcile` → `before.json` (MT)

- Run `reconcile`. Copy the whole logged line into a file `before.json` on the laptop (the time stamp in front is fine).
- **Check:** it starts with `{"ok":true,"asOf":"<today>"`. The account balances look like the app.

## 4. `migrationPlan` (MT): read the report

1. **Project Settings → Script Properties → Add**: `MIGRATION_MAPPING` = the mapping JSON.
2. Run `migrationPlan`. It only reads.
3. Read the report:
   - **1. Accounts linked in place**: only the ones you meant.
   - **2. Accounts created**: one per broker paid from a bank, plus Other assets. Check names, currencies and rates.
   - **3. Holding entries paid from a bank**: every buy and sell of those holdings, each with its transfer.
     - The amount is what left (or came back to) the bank.
     - Dividends have no transfer: their Income row stays on the bank.
   - **4. Case (a) cash**: the opening balance, Income/Expense rows and receivables of each linked-in-place account.
     - The Wealth Planner will receive these as cash (C9).
   - **5. Predicted reconcile**:
     - every account that isn't linked says **unchanged ✓**;
     - each linked account = its cash + its holdings;
     - **Net worth after** = **Net worth now**, difference **0.00**.
4. **Check:** the last line says **READY**.
   - **NOT READY** lists exactly what is missing or ambiguous: fix the mapping (in the property) and run `migrationPlan` again.

## 5. `migrateToLinked` (MT)

- Run `migrateToLinked`. It refuses unless the data is exactly what the last `migrationPlan` showed.
- **Check:**
  - the log says `Migration applied: N changes`, and a new tab `_MigrationLog` has N rows;
  - run it once more: `Nothing to do: already migrated`;
  - open MT on the laptop: every bank, card and wallet shows the same balance as in `before.json`;
  - the new linked accounts show "value unknown / at cost" until step 9; that's expected.
- Run `writeLinkedFlows` (MT). It writes the hidden tab `_Export_LinkedFlows` that WP reads.
  - **Check:** the tab exists (View → Hidden sheets) and has an `OPENING` row for each linked-in-place account with a starting balance.
- Close MT again.

## 6. Copy the four tabs to WP ("Copy to…")

For each of **Holdings, HoldingTxns, Trades, AllocationTargets** in the MT sheet:

1. Right-click the tab → **Copy to → Existing spreadsheet** → the Wealth Planner sheet.
2. In WP, delete its old empty tab of that name.
3. Rename "Copy of Holdings" to exactly `Holdings` (and the same for the others).

- **Check:**
  - the four tab names are exact;
  - each tab has as many rows as in MT;
  - HoldingTxns has no entry left on a bank you mapped (they now name the broker).

## 7. The `BENCH*` properties (WP)

- Copy `BENCH` and `BENCH_SYMBOL` from MT's Script Properties into WP's Script Properties (same names, same values).
- **Check:** WP → Portfolio → returns vs index shows your index.

## 8. The sheet IDs

The ID is the long part of the sheet's address between `/d/` and `/edit`. Don't paste it anywhere else (no chats, no notes in the repo).

- MT Script Properties: `WEALTH_SHEET_ID` = the WP sheet's ID.
- WP Script Properties: `MONEY_SHEET_ID` = the MT sheet's ID.
- The first run that reads the other sheet asks for permission: allow it.

## 9. `applyBrokerMapping` (WP)

1. WP Script Properties: `MIGRATION_MAPPING` = the **same** mapping JSON.
2. Run `applyBrokerMapping`.
3. **Check:**
   - no ✗ lines;
   - "HoldingTxns Account changes" are only renames you expect (usually 0: MT already moved them);
   - "Brokers added" lists every broker with the right currency, rate and dividends-to;
   - under "Values exported", each broker's value (THB) matches section 5 of the plan report.
   - Run it once more: **Nothing to change**.

## 10. Open both apps

- **WP:**
  - Brokers: each broker's cash and holdings look right, with no warnings;
  - deposits come from Money Tracker, with today's date.
  - A note says how much of the fees/dividends were booked in Money Tracker (C9).
- **MT:**
  - pull to refresh;
  - each linked account shows its WP value **with today's date** and no "stale" warning;
  - the total matches what you expect.

## 11. `reconcile` → `after.json` (MT)

- Run `reconcile` and save the logged line as `after.json`.

## 12. The compare script (laptop)

```
cd money-tracker
node scripts/compare-reconcile.js before.json after.json
```

- **Check:** it ends with **OK**.
  - Every account that isn't linked: ✓, identical to the cent.
  - Receivables ✓.
  - Market-value difference **0.00** (both apps used the same prices).
- **FAIL** lists every difference.
  - An unlinked balance or receivables changed: **stop and undo**.
  - "stale / unknown" value: run `writeExports` in WP, open MT, then redo steps 11–12.
  - Only a market-value difference, because WP refreshed a price or rate in between: check it equals that change. If so, run again with `--max-market=<THB>`.
  - Any other cause: undo.

## 13. Done

- You can make entries again. From now on, investments are added in WP: MT refuses them with a message.
- Remove `MIGRATION_MAPPING` from both projects' Script Properties (undo doesn't need it).
- Keep `before.json`, `after.json` and the backup copy until step 7 of the plan, about a week of using both apps.

---

## Undo

Use it any time before you start making new entries.

1. **MT:** run `undoMigration`.
   - It checks every logged change first. If anything was added or edited since, it changes **nothing** and lists what to fix:
     - an entry you made on a new broker account;
     - an edited transfer.
   - Fix those, then run it again.
   - **Check:** the log says `Migration undone`, the `_MigrationLog` tab is gone, and so is `_Export_LinkedFlows`.
2. **MT Script Properties:** delete `WEALTH_SHEET_ID`, so no Wealth Planner dividend is copied into Income.
3. **WP:**
   - delete the four copied tabs and the Brokers rows the mapping created;
   - delete `MONEY_SHEET_ID`.
   - WP then shows nothing, and MT no longer reads it.
4. **Check:** run `reconcile` (MT) → `undone.json`, then `node scripts/compare-reconcile.js before.json undone.json` → **OK**, with no linked accounts.
5. If `undoMigration` can't be used: restore from the step 2 backup copy. In Drive, make a copy of the backup and point nothing at the old one, or copy its tabs back.
