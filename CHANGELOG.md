# Changelog

One line per change the user would notice. Newest first.

## 2026-11-25
- Account groups: the Accounts page shows your accounts under group headings, each with a ฿ subtotal and a count; tap a heading to collapse or expand it. Set an account's group in its form (it starts as Bank accounts, Credit cards, Cash & wallets or Investments, from the type), and rename a group with ✏️ in Edit mode. Grouping is display only: no total changes. Dashboard account cards follow the same order. Needs the backend redeployed (it deploys from `main` automatically).

## 2026-11-24
- PIN lock: the app now asks for a 6-digit PIN every time it opens and after 5 minutes in the background. The first time after this update you set the PIN. Your access token and the data saved on this device (offline copy, unsent entries) are encrypted with it. Settings → Security has Change PIN and Lock now. After 5 wrong PINs there is a growing wait; after 10, or with "Forgot PIN?", this device's saved data is erased and you connect again (your Google Sheet is not touched).

## 2026-11-22
- Accounts can be linked to the Wealth Planner: a linked investment account shows the value the Wealth Planner reports (with its date, and a warning when it can't be reached), and its dividends appear in Income. Nothing changes until you link an account.
- Updating Money Tracker no longer wipes the Wealth Planner's offline copy (both apps share one web address).
- Settings shows the app version at the bottom, so you can check the phone has the latest update.
- Lint (ESLint) and tests run on every push; an error stops the backend deploy.
- Backend split into feature files under `src/`; tests added for balances, currencies, transfers and receivables.
- Fix: deleting the only repayment of a settled receivable now reopens it.
- Backend deploys automatically from GitHub (same web-app URL, backup of the previous version kept).
