# Changelog

One line per change the user would notice. Newest first.

## 2026-11-26
- Settings → Backup & automation has a **Refresh exchange rates** button again (it was in the Holdings section, which moved to the Wealth Planner). Rates still update by themselves every morning.
- Investments moved out: Money Tracker no longer has its own Holdings, trading journal or portfolio screens, the "Asset / Investment" button, or the Investments dashboard view. They live in the Wealth Planner; link a broker to an account to see its value here. Net worth is now accounts + what people owe you. Old investment rows stay in the hidden tabs of your Sheet, unused. Needs the backend redeployed (it deploys from `main` automatically).
- Projects: tap a project to see everything spent on it, across all months: the total against the budget, a breakdown by category and by month, and every expense (tap one to edit it). Needs the backend redeployed (it deploys from `main` automatically).
- Account groups: a group of only credit cards now shows its subtotal like the cards do ("Owed ฿3,700"). A mixed group in debt keeps the minus sign.
- Group names match without regard to capitals or extra spaces: "Travel", "travel " and "TRAVEL" are one group, shown with the spelling used first. Renaming a group renames every spelling of it. Needs the backend redeployed (it deploys from `main` automatically).

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
