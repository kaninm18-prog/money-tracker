# Money Tracker — Project Progress

A record of everything built for the personal finance tracking app, from first concept to current state.

---

## Stack Overview

| Layer | Technology |
|---|---|
| Frontend | Single-file PWA (HTML + CSS + JS) |
| Backend | Google Apps Script (doPost REST API) |
| Database | Google Sheets (one sheet per data type) |
| Hosting | GitHub Pages (`https://kaninm18-prog.github.io/money-tracker/`) |
| Storage | localStorage (user settings, script URL) |

---

## Session 1 — Initial Expense Tracker

**Concept:** Same architecture as the Teana Car Tracker app — a mobile-first PWA backed by Google Sheets via Apps Script.

**Files created:**
- `index.html` — single-file PWA app
- `Code.gs` — Google Apps Script backend
- `manifest.json` — PWA installability config

**Features built:**
- Add expense (amount, category, note, date)
- History view grouped by date, searchable, filterable by category
- Dashboard with monthly total, daily average, spending by category bar chart, recent transactions
- 11 default expense categories (Food & Dining, Transport, Shopping, etc.) with ability to add/delete custom ones
- Month navigation (← →) to browse past months
- Edit and delete expenses by tapping any transaction
- Setup screen with Apps Script URL connection flow
- Toast notifications for user feedback
- Installable as PWA on iOS/Android

**Google Sheets schema (v1):**
```
Expenses: Date | Amount | Category | Note
Categories: Name
```

---

## Session 2 — Net Worth, Accounts & Income

**New concept:** Expand from pure expense tracking to full personal finance — know how much you have, where it is, and add income.

**User requirements gathered:**
- Accounts: Cash, multiple bank accounts, Investment/Savings
- Income + Expense + Transfers between accounts
- Total balance + per-account breakdown
- Each transaction linked to an account
- Starting balance per account (set once, tracked from there)
- THB (฿) currency

**Features built:**
- **Dashboard redesign** — Total Net Worth at header (computed), scrollable account cards row, income/expense/net monthly summary row, category breakdown, recent activity feed
- **Accounts page** — add/edit/delete accounts with starting balance setup; account balance computed live from all transactions
- **Income tracking** — full income form (amount, category, account, note, date); income categories: Salary, Investment Returns, Freelance, Bonus, Other Income
- **Transfer tracking** — move money between accounts (bank → cash, bank → credit card payment); does not count as income or expense
- **Add-type chooser** — tapping `+` opens a bottom sheet with Expense / Income / Transfer options
- **Combined transactions history** — all types in one view, grouped by date, filterable by type (All / Income / Expense / Transfer) and by account
- **Balance computation formula:**
  `balance = starting_balance + all_income - all_expenses - transfers_out + transfers_in`

**Google Sheets schema (v2):**
```
Expenses:         Date | Amount | Category | Note | Account
Income:           Date | Amount | Category | Note | Account
Transfers:        Date | Amount | FromAccount | ToAccount | Note
Accounts:         Name | Type | StartingBalance
Categories:       Name
IncomeCategories: Name
```

---

## Session 3 — Credit Card Support

**New concept:** Credit cards are liabilities — balance shown as "owed", paying the bill is a Transfer (not an expense), which prevents double-counting.

**User requirements gathered:**
- Multiple credit cards
- Credit limit display with usage bar
- Statement date tracking
- In-app due date reminder (3 days before)

**Features built:**
- **Credit Card account type** — new `credit` type with 3 extra fields: Credit Limit, Payment Due Day (day of month), Statement Day (day of month)
- **Account cards** — credit cards show "Owed ฿X" in red with usage bar (e.g. 28% of ฿30,000)
- **Accounts page** — credit cards show: amount owed, credit limit, available credit, next due date, statement date
- **Dashboard reminder banner** — red sliding banner appears when any card's due date is ≤ 3 days away; shows card name, amount owed, exact days remaining; dismissible with ✕
- **Balance formula unchanged** — spending on a card goes negative automatically; paying via Transfer brings it back; net worth subtracts card debt correctly

**Google Sheets schema (v3):**
```
Accounts: Name | Type | StartingBalance | CreditLimit | DueDay | StatementDay
```
*(All other sheets unchanged)*

**Deployment note:** Requires new Apps Script deployment after each backend update.

---

## Session 4 — Logic Document Review & Feature Expansion

**Source document:** `personal_finance_tracking_logic.md` — a 10-section reference spec for correct financial tracking.

### Conflict Analysis

| Section | Status | Notes |
|---|---|---|
| #1 Advance Payment / Receivable | ✅ No conflict | New sheet required |
| #2 Trip / Project Expenses | ✅ No conflict | Affects dashboard filter behavior |
| #3 Credit Card Double Counting | ✅ Already handled | Transfer = liability settlement, not expense |
| #4 Recurring vs One-Off | ✅ No conflict | New columns on Expenses sheet |
| #5 Split Expenses | ✅ No conflict | Deferred to later |
| #6 Foreign Currency | ✅ No conflict | Deferred to later |
| #7 Asset Purchases | ✅ No conflict | Deferred to later |
| #8 Investment Transactions | ✅ No conflict | Deferred to later |
| #9 Reimbursable Work Expenses | ✅ No conflict | Merged with #1 into Receivables |
| #10 Home Screen Balance Display | ✅ No conflict | localStorage setting |

### Features Implemented This Session

**#4 Recurring Expenses**
- Toggle on expense form: "🔁 Recurring expense" with Monthly/Yearly selector
- Recurring badge shown on transaction items in history
- Stored as `IsRecurring` (TRUE/FALSE) + `RecurrencePeriod` columns on Expenses sheet

**#10 Home Screen Balance Display**
- Three modes: Net Worth / Monthly Balance / Available Cash
- Tap the header balance figure to cycle through modes
- Settings page shows radio list with descriptions
- Preference saved in localStorage
- Labels update in real-time below the amount

**#2 Trip / Project Expenses**
- New **Projects** sheet and **Projects page** (💼 nav tab)
- Each project has: Name, Budget, Start Date, End Date
- Budget vs. actual progress bar (turns red if over budget)
- Expense form has optional "📁 Project" dropdown
- Dashboard monthly stats **exclude** project expenses (regular expenses only)
- Project expenses show a `📁 Project Name` badge in transaction history

**#1 & #9 Receivables** (Advance Payments + Work Reimbursements)
- New **Receivables** sheet and tab within Projects page
- Two types: `🤝 Advance Payment` (you paid for someone) and `💼 Work Expense` (PTTEP reimburses)
- Accessible via `+` → Receivable
- Status: Pending / Settled — tap "✓ Mark Settled" to close it out
- Pending and Settled shown in separate tabs
- Running total shown per tab
- **Not counted as personal expenses** — correct per the logic doc

**Nav change:** Settings nav slot → 💼 Projects; Settings still accessible via ⚙️ header button

**Google Sheets schema (v4 — current):**
```
Expenses:         Date | Amount | Category | Note | Account | IsRecurring | RecurrencePeriod | ProjectId
Income:           Date | Amount | Category | Note | Account
Transfers:        Date | Amount | FromAccount | ToAccount | Note
Accounts:         Name | Type | StartingBalance | CreditLimit | DueDay | StatementDay
Categories:       Name
IncomeCategories: Name
Projects:         Name | Budget | StartDate | EndDate
Receivables:      Date | Amount | Counterparty | Type | Note | ReimbursedBy | Status | SettledDate
```

---

## Session 5 — Bug Fixes & Feature Expansion (Sections 11–15)

### Bug Fixes

| Bug | Root Cause | Fix |
|---|---|---|
| Emoji saved into Account column in Sheets | `getSelectedAcct()` regex `/^.\s/` missing `u` flag — surrogate-pair emoji not stripped | Added `u` flag: `/^.\s/u` |
| Transactions never showing | Apps Script V8 date objects from `getValues()` don't pass `instanceof Date` — `formatDate` fell to `String(val).slice(0,10)` returning `"Tue May 05"` | Changed check to `typeof val === 'object'` |
| Month filter always empty | `new Date(dateStr+"T00:00:00")` timezone-sensitive in Apps Script V8 | Replaced with `dateMatchesMonth()` using direct string `substring` comparison |

### Features Implemented

**#12 — Account Edit Mode Toggle** — "Edit"/"Done" toggle on Accounts page; Edit/Delete buttons hidden by default; purple header tint in edit mode; mode resets on navigation.

**#11 — Installment Plans** — New `InstallmentPlans` sheet; 3rd tab (📅 Installments) on Projects page; plan cards with progress, monthly amount, X/Y paid, remaining balance, next date; `checkInstallments()` auto-generates due expense rows on each app load.

**#13 — Budget Planner** — New `CategoryBudgets` sheet; 4th tab (📊 Budget) on Projects page; per-category progress bars (green/amber/red); Set Budget modal with threshold setting.

**#14 — Annual Summary** — "📊 Year in Review" button on Dashboard; full-screen modal with savings rate hero, income/expense grid, CSS month-by-month bars, category breakdown; year navigation.

**#15 — Export to Excel** — SheetJS from CDN; Export This Month → `MoneyTracker_YYYY_MM.xlsx`; Export Full Year → `MoneyTracker_YYYY.xlsx`; Transactions + Monthly Summary sheets.

### Google Sheets schema (v5 — current)
```
Expenses:         Date | Amount | Category | Note | Account | IsRecurring | RecurrencePeriod | ProjectId
Income:           Date | Amount | Category | Note | Account
Transfers:        Date | Amount | FromAccount | ToAccount | Note
Accounts:         Name | Type | StartingBalance | CreditLimit | DueDay | StatementDay
Categories:       Name
IncomeCategories: Name
Projects:         Name | Budget | StartDate | EndDate
Receivables:      Date | Amount | Counterparty | Type | Note | ReimbursedBy | Status | SettledDate
InstallmentPlans: Description | PurchaseDate | Merchant | TotalAmount | InstallmentCount | InstallmentAmount | FirstInstallmentDate | Account | Category | ProjectId | Status | InstallmentsPaid
CategoryBudgets:  Category | MonthlyLimit | AlertThreshold | IsActive | AppliesToProjects
```

---

## Session 7 — Safety, Offline & Trends

### Data safety
- **Access token** — every request must carry a secret token. Run `setupToken()` once in Apps Script, paste the token into the app (setup screen or Settings → Script Connection). Requests without it are refused.
- **Stable row IDs** — Expenses (col 11), Income (col 8) and Transfers (col 7) get an `Id` column, filled in automatically for old rows. Edits/deletes find rows by Id, so a delete on the phone can't make the laptop edit the wrong row. Receivables/repayments use their existing Ids; accounts, categories, projects, budgets, installments and recurring items are checked by name.
- **One request at a time** — `LockService` around every call, so recurring/installment rows can't be created twice when two devices open together.
- **Category clean-up** — removed the invisible U+FE0F character that split "Shopping"/"Travel" in two (cause: the category picker stripped the emoji but left its variation selector). Existing data is repaired once automatically; duplicate category names are refused.

### Offline
- `sw.js` service worker: the app opens without signal (page fetched fresh when online, cached copy when offline).
- New expenses / income / transfers made offline are queued on the device and sent when back online; each has its own Id, so a resend never creates a duplicate.

### Spending trend (dashboard)
- Last 12 months of regular spending with the 6-month average; current month is compared with the usual amount by the same day. Top categories vs their average. New backend action `getTrends` (also returned by `bootstrap`).

### Bug fixes
- Year in Review: expense bars and category breakdown were empty (field-name mismatch); Export Full Year expenses were 0.
- Installments "Monthly Commitment" always showed ฿0; Budget overview total limit always ฿0.
- Cancelling an installment plan wiped its merchant, purchase date and project.
- Saving a receivable / marking an installment paid threw an error while refreshing balances.

**Deploy:** paste new `Code.gs` → run `setupToken()` → Deploy → Manage deployments → edit → New version. Push `index.html` and `sw.js` to GitHub.

---

## Session 8 — Speed, Search, Statements, Bills & Backup

- **Faster startup** — opening the app is now one request: `bootstrap` creates due recurring/installment rows itself (`runChecks`), then reads every sheet once and shares it between all getters (Expenses was read ~5 times).
- **Search all months** — "This month / All months" toggle in the Transactions search box. New action `searchTransactions` (category, note, account, project, amount; newest 200). Results can be opened and edited.
- **App icon** — own charcoal ฿-coin icons (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`) instead of a stretched 72px emoji from GitHub; cached for offline.
- **Weekly backup** — run `setupWeeklyBackup()` once in Apps Script (asks for Drive permission). Every Sunday ~3am a copy goes to "Money Tracker Backups" in Drive, newest 12 kept. Settings shows the last backup and has a "Back up now" button (`backupNow` action).
- **Credit card statements** — each card with a statement day shows the last statement period, amount billed, paid since, left to pay with due date, and this cycle so far. The due-soon banner uses the statement amount and disappears once it's paid.
- **Upcoming bills** — dashboard card listing recurring expenses, installments and card bills due in the next 30 days, with the total.
- **Fix** — card "Next Due Date" showed one day early (UTC conversion).

**Deploy:** paste `Code.gs` → run `setupWeeklyBackup()` (approve Drive access) → Manage deployments → New version. Push `index.html`, `sw.js`, `manifest.json` and the 4 icon PNGs.

---

## Session 9 — Duplicates, Assets & Investments, Yearly Recurring, Offline Edits

- **Duplicate warning** — adding an expense, income or transfer with the same date, amount and account (from/to for transfers) as an existing one asks "Save it anyway?". Checked on the server across all months (`checkDup`); offline it checks what's on screen.
- **Assets & investments** (logic doc #7, #8) — new sheets `Holdings` and `HoldingTxns`. Buy / sell / dividend from the + button or Accounts page. Buying moves cash out of an account but is **not** an expense; fees are saved as expenses ("Investment Fees"); dividends as income ("Investment Returns"). Average-cost P/L (unrealised, realised), manual price/value updates, "already owned" option (no cash moves) for things like a car. Net worth = accounts + holdings; new home balance option "Investments". Buys/sells appear in the transaction list.
- **Yearly recurring** — recurring items can repeat every month or every year (new columns `Frequency`, `MonthOfYear`). The "🔁 Repeat automatically" switch on a new expense now actually creates the recurring item (this entry counts as the first one).
- **Offline edits & deletes** — expenses, income and transfers can be edited or deleted offline; entries still waiting to sync can be edited or removed too. Changes are sent in order when back online; a change to something modified on another device meanwhile is skipped with a message.

**Deploy:** paste `Code.gs` → Manage deployments → New version. Push `index.html` and `sw.js`.

---

## Features Deferred (from logic doc)

These were reviewed and confirmed non-conflicting — ready to implement in a future session:

- **#5 Split Expenses** — pay full bill, record only your share, track who owes the rest
- **#6 Foreign Currency** — log in JPY/USD with FX rate, store THB equivalent
- **Home balance modes not yet implemented:** Savings Balance, Investment Portfolio Value, Bonus Reserve Remaining (require additional data not yet tracked)

---

## GitHub Deployment

- **Repo:** `https://github.com/kaninm18-prog/money-tracker`
- **Live URL:** `https://kaninm18-prog.github.io/money-tracker/`
- **GitHub username:** kaninm18-prog
- **Email:** matangkapong.k@gmail.com

**To push updates:**
```bash
cd C:\Users\Admin\OneDrive\Financial\expense_app
git add index.html Code.gs sw.js manifest.json *.png
git commit -m "describe what changed"
git push
```

**After any Code.gs change:** Create a **new deployment** in Apps Script (not just save), paste the new URL in app Settings.

---

## File Structure

```
expense_app/
├── index.html                        ← Main PWA app (all UI + JS)
├── Code.gs                           ← Google Apps Script backend
├── manifest.json                     ← PWA manifest
├── sw.js                             ← Service worker (offline support)
├── icon-192.png / icon-512.png / icon-maskable-512.png / apple-touch-icon.png  ← App icons
├── personal_finance_tracking_logic.md ← Finance logic reference spec
└── project-progress.md               ← This file
```
