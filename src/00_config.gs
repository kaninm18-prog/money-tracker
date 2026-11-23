// ============================================================
//  Money Tracker — Google Apps Script Backend v6
//
//  Sheets:
//    Expenses         → Date | Amount(THB) | Category | Note | Account | IsRecurring | RecurrencePeriod | ProjectId | OrigAmount | Currency | Id | CreatedAt (ms)
//    Income           → Date | Amount(THB) | Category | Note | Account | OrigAmount | Currency | Id
//    Transfers        → Date | Amount (in From currency) | FromAccount | ToAccount | Note | ReceivedAmount (in To currency, optional) | Id
//    Accounts         → Name | Type | StartingBalance | CreditLimit | DueDay | StatementDay | Currency | Rate (THB per 1 unit) | LinkedTo
//                       (LinkedTo: the account's name in the Wealth Planner; non-empty = a linked investment account)
//    Categories       → Name | Icon
//    IncomeCategories → Name | Icon
//    Projects         → Name | Budget | StartDate | EndDate
//    Receivables      → Date | Amount | Counterparty | Type | Note | ReimbursedBy | Status | SettledDate | Account | Id
//    ReceivableRepayments → Id | ReceivableId | Date | Amount | Account | Note
//    InstallmentPlans → Description | PurchaseDate | Merchant | TotalAmount | InstallmentCount | InstallmentAmount | FirstInstallmentDate | Account | Category | ProjectId | Status | InstallmentsPaid
//    CategoryBudgets  → Category | MonthlyLimit | AlertThreshold | IsActive | AppliesToProjects
//    RecurringExpenses→ Description | Amount | Category | Account | DayOfMonth | StartDate | Status | LastGenerated | ProjectId | Frequency | MonthOfYear
//    Holdings         → Id | Name | Kind | Symbol | Unit | CurrentPrice (THB/unit) | PriceDate | Note | Status | QuoteCurrency | NextXD | NextDividend (per unit)
//    Trades           → Id | Ticket | Symbol | Side | Volume | OpenTime | OpenPrice | CloseTime | ClosePrice | Commission | Swap | Profit | Account | Note | Currency
//    AllocationTargets→ Class | TargetPct
//    HoldingTxns      → Id | HoldingId | Date | Type (buy/sell/dividend) | Quantity | Price | Amount (THB) | Fee (dividends: tax withheld) | Account | Note | LinkedId | OrigAmount | Currency
//                       (OrigAmount/Currency: the exact amount in a foreign-currency account, e.g. USD paid/received)
//    NetWorthHistory  → Month (yyyy-MM) | Date | Accounts | Investments | Assets | NetWorth | Receivables  (one snapshot per month, latest wins)
//    _Prices          → scratch sheet (hidden) where GOOGLEFINANCE formulas are evaluated
//    _Export_LinkedFlows → Id | Date | Account | Amount | Currency | Kind  (hidden; rebuilt whole, read by the Wealth Planner)
//                       one row per transfer into (+) or out of (−) a linked account; Account = its LinkedTo name.
//                       C9: also its opening balance (Id OPENING), Income/Expense rows and receivables. Kind = transfer,
//                       opening, income, expense, receivable or repayment (the Wealth Planner reads columns 1–5 only)
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
  HOLDINGS:     "Holdings",
  HOLDING_TXNS: "HoldingTxns",
  NETWORTH:     "NetWorthHistory",
  TRADES:       "Trades",
  TARGETS:      "AllocationTargets",
  PRICES:       "_Prices",
  LINKED_FLOWS: "_Export_LinkedFlows"
};

