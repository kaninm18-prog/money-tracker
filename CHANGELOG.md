# Changelog

One line per change the user would notice. Newest first.

## 2026-11-22
- Lint (ESLint) and tests run on every push; an error stops the backend deploy.
- Backend split into feature files under `src/`; tests added for balances, currencies, transfers and receivables.
- Fix: deleting the only repayment of a settled receivable now reopens it.
- Backend deploys automatically from GitHub (same web-app URL, backup of the previous version kept).
