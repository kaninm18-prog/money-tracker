# Money Tracker — guide for AI agents (and humans)

Personal finance PWA for one user (Arm). Phone + laptop. Amounts are Thai baht (฿) unless stated.
Read this before changing anything. `ROADMAP.md` has the plan; `project-progress.md` the history.

## Architecture

| Part | Where | Notes |
|---|---|---|
| Front end | `index.html` + `css/app.css` + `js/*.js` | Plain browser scripts, **no build step, no modules, no frameworks**. `index.html` loads `js/*.js` with `<script>` tags; all functions are global so `onclick="…"` works. |
| Offline shell | `sw.js` | Network-first for the app's own files. Bump `CACHE` when you add/rename a cached file. Apps Script calls are never cached. |
| Back end | `src/*.gs` (Google Apps Script) | One web app, `doPost` → `route(p)` in `src/02_api.gs` dispatches on `p.action`. Files are numbered: Apps Script loads them in name order and they share **one global scope**. |
| Database | Google Sheet "Money Tracker" | One tab per data type. Column layout is documented at the top of `src/00_config.gs`. |
| Hosting | GitHub Pages | `https://kaninm18-prog.github.io/money-tracker/` — pushing to `main` publishes the front end. |

Data flow: app → `api(payload)` in `js/core.js` → POST to the Apps Script URL (with the access token) → `route()` → sheet.
Writes made offline are queued and replayed (`QUEUEABLE` in `js/core.js`); adds carry a client id so a replay never duplicates a row.

## Money rules (don't break these — they have tests)

- Expenses and Income `Amount` is always **THB**. Foreign-currency spending also stores `OrigAmount` + `Currency`.
- Accounts have `Currency` (default THB) and `Rate` (THB per 1 unit, set by hand or by the daily price refresh). Balances are in the account's own currency; `balanceThb` / `totalBalance` are THB.
- Transfers: `Amount` is in the **From** account's currency; optional `ReceivedAmount` in the **To** account's currency. A transfer never changes the total.
- Receivables: lending takes the full amount out of the account; each repayment (`ReceivableRepayments`) puts money into the account it was received in. A receivable settles automatically when nothing is left. Old settled receivables without repayments count as fully returned.
- Asset/investment buys move cash into a holding — they are **not** spending. Fees are expenses; dividends are income.

## Working on the code

- Commands (run from the repo root):
  - `npm ci` — install tools (ESLint) once
  - `npm test` — back-end tests: the real `src/*.gs` against a fake Google Sheet (`tests/harness.js`). No network, no real data.
  - `npm run lint` — ESLint, bug-focused. Errors fail CI; warnings don't.
  - `npm run check` — both. **Run it before every commit.**
- Style: match the surrounding code — `var`, `function(){}` callbacks, small helpers, short comments that explain *why*. Keep the front end working on older phones (no syntax newer than what's already used).
- New back-end action: add a `case` in `route()` (`src/02_api.gs`) + the function in the right feature file + a test. The front end should handle `Unknown action` (old backend) with a toast telling the user to redeploy.
- New sheet column: append at the end and add the header with `ensureHeaders(sh, col, [...])` so existing sheets keep working. Never reorder or remove columns.
- Edits/deletes find rows by `Id` via `resolveRow()`; keep that — rows move when another device deletes something.
- Every change to money logic needs a test in `tests/*.test.js`.

## Deploying

- Front end: push to `main` → GitHub Pages.
- Back end: push to `main` → `.github/workflows/deploy-backend.yml` runs lint + tests, backs up the live Apps Script code (artifact, 90 days), uploads `src/*.gs` with clasp and updates the **existing** deployment (URL never changes).
- `.github/workflows/checks.yml` runs lint + tests on every push and pull request.
- **Never edit code in the Apps Script editor** — the next deploy overwrites it. The repo is the only source.

## Rules for agents

1. **Never read or write the live Google Sheet or call the live Apps Script URL.** Test against the fake sheet only.
2. **Never commit personal files.** This folder also holds bank exports, statements and import files (see `.gitignore`). Don't open them unless the task is about them, and never add them to git. Check `git status` before committing.
3. Never put secrets (tokens, deployment IDs, the Apps Script URL) in code, commits or logs.
4. Work on a branch and open a pull request unless told to commit to `main`. Never force-push. Never rewrite pushed history.
5. Keep changes small and focused; one topic per commit. Say what you changed and how you checked it.
6. Don't change the money rules above without being asked — if a task seems to need it, stop and explain.
7. Add a line to `CHANGELOG.md` for anything the user would notice.
8. Commit messages end with the attribution lines given in your session (if any).

## Planned

The investment parts (`src/16_holdings.gs`, `18_prices`, `21_portfolio`, `22_trading_journal`, `js/holdings.js`, `js/portfolio.js`) will move to a separate **Wealth Planner** app (ROADMAP stage 4). Avoid large new features there until the split.
