# Changelog

One line per change the user would notice. Newest first.

## 2026-11-23
- Linked investment accounts: their starting balance, the income and spending you record on them, and money lent from or repaid into them now reach the Wealth Planner. Before, they were left out of the linked value.
- Tools to move your investments to the Wealth Planner (`migrationPlan`, `migrateToLinked`, `undoMigration`, and a compare script), with a step-by-step runbook in `docs/stage-4-migration-runbook.md`. Nothing changes until you run them.
- After the migration, adding or changing investments in Money Tracker is refused with a message: they are in the Wealth Planner now.

## 2026-11-22
- Accounts can be linked to the Wealth Planner: a linked investment account shows the value the Wealth Planner reports (with its date, and a warning when it can't be reached), and its dividends appear in Income. Nothing changes until you link an account.
- Updating Money Tracker no longer wipes the Wealth Planner's offline copy (both apps share one web address).
- Settings shows the app version at the bottom, so you can check the phone has the latest update.
- Lint (ESLint) and tests run on every push; an error stops the backend deploy.
- Backend split into feature files under `src/`; tests added for balances, currencies, transfers and receivables.
- Fix: deleting the only repayment of a settled receivable now reopens it.
- Backend deploys automatically from GitHub (same web-app URL, backup of the previous version kept).
