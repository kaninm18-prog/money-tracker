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

## Features Deferred (from logic doc)

These were reviewed and confirmed non-conflicting — ready to implement in a future session:

- **#5 Split Expenses** — pay full bill, record only your share, track who owes the rest
- **#6 Foreign Currency** — log in JPY/USD with FX rate, store THB equivalent
- **#7 Asset Purchases** — separate from expenses (gold, electronics, property)
- **#8 Investment Transactions** — instrument-level tracking (stocks, ETFs, XAUUSD)
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
git add index.html Code.gs
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
├── personal_finance_tracking_logic.md ← Finance logic reference spec
└── project-progress.md               ← This file
```
