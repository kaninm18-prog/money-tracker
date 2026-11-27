// ============================================================
//  Money Tracker — Google Apps Script Backend v6
//
//  Sheets:
//    Expenses         → Date | Amount(THB) | Category | Note | Account | IsRecurring | RecurrencePeriod | ProjectId | OrigAmount | Currency | Id | CreatedAt (ms)
//    Income           → Date | Amount(THB) | Category | Note | Account | OrigAmount | Currency | Id
//    Transfers        → Date | Amount (in From currency) | FromAccount | ToAccount | Note | ReceivedAmount (in To currency, optional) | Id
//    Accounts         → Name | Type | StartingBalance | CreditLimit | DueDay | StatementDay | Currency | Rate (THB per 1 unit) | LinkedTo
//                       | Group
//                       (LinkedTo: the account's name in the Wealth Planner; non-empty = a linked investment account)
//                       (Group: heading on the Accounts page; empty = the type's default, see defaultAccountGroup)
//    Categories       → Name | Icon
//    IncomeCategories → Name | Icon
//    Projects         → Name | Budget | StartDate | EndDate | Status ("" active / completed) | CompletedDate
//    Receivables      → Date | Amount | Counterparty | Type | Note | ReimbursedBy | Status | SettledDate | Account | Id
//    ReceivableRepayments → Id | ReceivableId | Date | Amount | Account | Note
//    InstallmentPlans → Description | PurchaseDate | Merchant | TotalAmount | InstallmentCount | InstallmentAmount | FirstInstallmentDate | Account | Category | ProjectId | Status | InstallmentsPaid
//    CategoryBudgets  → Category | MonthlyLimit | AlertThreshold | IsActive | AppliesToProjects
//    RecurringExpenses→ Description | Amount | Category | Account | DayOfMonth | StartDate | Status | LastGenerated | ProjectId | Frequency | MonthOfYear
//    AllocationTargets→ Class | TargetPct
//    NetWorthHistory  → Month (yyyy-MM) | Date | Accounts | Investments | Assets | NetWorth | Receivables  (one snapshot per month, latest wins)
//    _Prices          → scratch sheet (hidden) where GOOGLEFINANCE formulas are evaluated
//    _Export_LinkedFlows → Id | Date | Account | Amount | Currency  (hidden; rebuilt whole, read by the Wealth Planner)
//                       one row per transfer into (+) or out of (−) a linked account; Account = its LinkedTo name
//  Wealth Planner tabs read (spreadsheet id in Script Property WEALTH_SHEET_ID, see 25_linked_accounts.gs):
//    _Export_Values    → Account | Currency | Value | ValueTHB | AsOf
//    _Export_Dividends → Id | Date | Holding | Amount (THB) | OrigAmount | Currency | Tax | Account
// ============================================================

var SHEET = {
  EXPENSES:     "Expenses",
  INCOME:       "Income",
  TRANSFERS:    "Transfers",
  ACCOUNTS:     "Accounts",
  CATEGORIES:   "Categories",
  INCOME_CATS:  "IncomeCategories",
  PROJECTS:     "Projects",
  RECEIVABLES:  "Receivables",
  INSTALLMENTS: "InstallmentPlans",
  BUDGETS:      "CategoryBudgets",
  RECURRING:    "RecurringExpenses",
  REPAYMENTS:   "ReceivableRepayments",
  NETWORTH:     "NetWorthHistory",
  PRICES:       "_Prices",
  LINKED_FLOWS: "_Export_LinkedFlows"
};

