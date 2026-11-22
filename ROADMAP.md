# Roadmap — Money Tracker, Wealth Planner & learning agents

Two goals run side by side: make the apps easier and safer to develop, and learn to hand work to AI agents. Each stage builds the safety net the next one needs. Tick items off as they are done.

---

## Stage 1 — Automatic deploys (no more pasting Code.gs)

Goal: a push to GitHub updates the Apps Script backend, and the web-app URL never changes.

- [x] Turn on "Google Apps Script API" at script.google.com/home/usersettings *(Arm)*
- [x] Install clasp (`npm install -g @google/clasp`) and run `clasp login` *(Arm — sign-in is yours)*
- [x] Add the contents of `~/.clasprc.json` as the GitHub secret `CLASPRC_JSON` *(Arm)*
- [x] Share the Script ID (Project Settings) and current Deployment ID (Deploy → Manage deployments) *(Arm)*
- [x] Add `.clasp.json` and a GitHub Actions workflow: on push to `main` that changes the backend → `clasp push` → `clasp deploy -i <DeploymentID>`
- [x] Test with a harmless change; confirm the URL in Settings still works

**You learn:** CI/CD basics, secrets, what a deployment is.

## Stage 2 — A backend that's easy to change

Goal: small, tested pieces instead of one big file.

- [x] Split `Code.gs` into 24 feature files under `src/` (`00_config.gs`, `02_api.gs`, `07_accounts.gs`, `10_receivables.gs`, …) — numbered so they load in order
- [x] Turn the in-memory Google Sheets mock into a permanent test suite (`tests/harness.js` + `tests/*.test.js`), run with `npm test`
- [x] Cover the money rules first: account balances, transfers across currencies, receivable repayments, total balance (net-worth history still to add)
- [x] Run the tests in the GitHub workflow — a failing test blocks the deploy

- [x] First catch: deleting the only repayment of a settled receivable left it "settled" — fixed, with a test

**You learn:** unit tests, mocks, why tests make refactoring safe.

## Stage 3 — Guard rails for humans and agents

Goal: mistakes are caught before they reach the phone.

- [x] Add ESLint with bug-focused rules (undefined names, the same function defined twice across files, `if (a = b)`, unreachable code, unused variables) — not style nitpicks
- [x] Run ESLint in the same workflow as tests and deploy (`checks.yml` on every push/PR; `deploy-backend.yml` before deploying)
- [x] Fix the 3 lint warnings — good first task to hand to an agent
- [x] Write `CLAUDE.md`: how the app is structured, how to run tests, how data flows, and the rules:
  - never write to the live Google Sheet
  - every change to money logic needs a test
  - work on a branch and open a pull request; never force-push
- [x] Add a small `CHANGELOG` habit (one line per release) so phone updates are easy to check

**You learn:** linting, writing instructions that make agents reliable.

## Stage 4 — Split out the Wealth Planner

Goal: Money Tracker stays a fast cashflow app; assets and investments get their own app.
Plan: [`docs/stage-4-plan.md`](docs/stage-4-plan.md) (draft, decisions D1–D5 open).

- [ ] Create the new repo + GitHub Pages site + Google Sheet + Apps Script (with Stages 1–3 built in from day one)
- [ ] Move holdings, buy/sell/dividend, live prices, allocation & targets, returns vs index, dividends and the trading journal
- [ ] Rebuild the MTS gold history from `gold_investment.xlsx`, with realized / unrealized P&L in USD
- [ ] Copy existing Holdings, HoldingTxns, trades and portfolio settings to the new sheet
- [ ] In Money Tracker, turn broker accounts into **linked investment accounts**: deposits and withdrawals are transfers; the value is read from the Wealth Planner
- [ ] Check: every account balance and net worth match to the cent before and after
- [ ] Only then remove the investment code and tabs from Money Tracker
- [ ] Add asset-planning features (to be decided)

**You learn:** running a multi-step project with agents — one ports code, one writes tests, one reviews.

## Stage 5 — Agents on a schedule

Goal: routine checks happen without you asking.

- [ ] Weekly health check: prices refreshed, balances add up, nothing failed to deploy
- [ ] Monthly spending summary
- [ ] Reminder when a receivable has had no repayment for a while

Start read-only: scheduled agents report, they don't change records.

---

## How to work with agents (the learning path)

1. **Pair** — Claude Code in the repo on your laptop. Small task → read the diff → approve. Learn to describe tasks and review changes.
2. **Delegate** — give a whole to-do item ("add ESLint and fix what it finds"). The agent works on a branch and opens a pull request; you review the result. Tests + lint make this trustworthy.
3. **Orchestrate** — several agents in parallel on a bigger job (Stage 4).
4. **Automate** — scheduled agents for routine checks (Stage 5).

**Safety rules for financial data:** agents change code, not records. Live Google Sheet stays read-only to agents until you trust the setup. Always review the diff before anything goes live. Git means any change can be undone.

---

## Also noted

- [x] Version number in the app, for faster phone updates (Settings → bottom; `APP_VERSION` in `js/core.js`, kept in step with `CHANGELOG.md` by a test)
- [ ] Add the USD / EUR / GBP accounts (XX1330, XX1342, XX9973) with the currency feature
- [ ] 11 Salary outflows from the Krungthai review still to identify
