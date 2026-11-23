# Stage 4 — starting over in the Wealth Planner (runbook)

Arm decided on 2026-11-23 to **start over** instead of migrating. The investment data in Money Tracker was small:
- **one holding**: Gold bar 96.5%, 0.5, cost ฿34,172.77, kept at home (withdrawn from MTS, fee included);
- **29 closed MTS trades**, Apr 2025 – Feb 2026, net **+$946.21**;
- **"USD Acc"**: the MTS Gold (USD) account, $4,958.32.

So we re-enter instead of converting. Do the steps in order, and check each one before going on. Only Arm runs these: agents never touch the live sheets.

**Fixes an existing problem.** The 29 trades point to an account named "MTS Gold (USD)", which doesn't exist; the account is called "USD Acc". So their +$946.21 (about ฿32,100) isn't counted today. After step 9, USD Acc shows **$5,904.53**, the MTS statement balance.

---

## 0. Before you start
- [ ] The Wealth Planner change for opening cash (kaninm18-prog/Wealth-Planner, "Brokers: opening cash") is merged, and its deploy is green.
- [ ] **Check MTS's current cash balance** in the MTS app or on a statement. This runbook expects **$5,904.53**, the statement balance after the last trade (18 Feb 2026). If it's different (later trades, fees, interest), note the difference: you'll adjust the opening cash in step 3.
- [ ] Pick a quiet moment, and **add no new entries in either app until step 10 is done.**

## 1. Fresh "before" snapshot (Money Tracker)
1. Money Tracker's Sheet → Extensions → Apps Script → choose **`backupNow`** → Run.
2. Choose **`reconcile`** → Run. Copy the JSON from the Execution log and save it as **`before-startover.json`**. It must be taken today, so the comparison in step 10 means something.

## 2. Copy the trading journal (Wealth Planner)
1. Open Money Tracker's Sheet. Right-click the **Trades** tab → **Copy to → Existing spreadsheet** → choose **Wealth Planner**.
2. In the Wealth Planner Sheet: if there's already an (empty) **Trades** tab, delete it. Then rename **"Copy of Trades"** to **`Trades`**. The columns are the same in both apps.
3. ✅ Check: open the Wealth Planner app → Portfolio → Trading journal. You should see **29 trades**.

## 3. Add the MTS broker (Wealth Planner app)
Home → Brokers → **+ Add broker**:
- **Name:** `MTS Gold (USD)`. Exactly this; the trades use this name.
- **Currency:** USD. Press **Refresh prices** first, so the USD rate fills in, or type today's rate.
- **Opening cash:** `4958.32`. If step 0 found a different current balance, add the difference to this number.
- **Dividends paid to:** leave empty.

## 4. Add the gold bar (Wealth Planner app)
**+ Add asset / investment** → kind **Gold**:
- **Name:** `Gold bar 96.5%`
- **Unit:** **baht** (baht-weight), so live gold prices work. Check that 0.5 is in baht-weight, as in Money Tracker.
- **Quantity:** 0.5
- **Total paid:** ฿34,172.77
- **Date:** the withdrawal date
- **Broker:** **leave empty.** It's at home, so it appears under **Other assets**.

Then press **Refresh prices**.

## 5. Let the Wealth Planner read Money Tracker
1. Copy Money Tracker's **spreadsheet ID**: the long part of its Sheet URL, between `/d/` and `/edit`.
2. Wealth Planner's Apps Script → ⚙️ Project Settings → **Script properties** → add **`MONEY_SHEET_ID`** = that ID. It's an ID, not a secret, but it still stays out of the repo.
3. ✅ Check: reload the Wealth Planner app. Brokers → **MTS Gold (USD)** should show cash **$5,904.53** (opening $4,958.32 + trades $946.21) with no "deposits unknown" warning. **Other assets** shows the gold bar at today's price.

## 6. Let Money Tracker read the Wealth Planner
1. Copy the **Wealth Planner's spreadsheet ID** the same way.
2. Money Tracker's Apps Script → Project Settings → Script properties → add **`WEALTH_SHEET_ID`** = that ID.

## 7. Link USD Acc (Money Tracker app)
Accounts → edit mode → **USD Acc** → ✏️ Edit → tick **Linked investment account (Wealth Planner)** → name **`MTS Gold (USD)`** → Save.

## 8. Add "Other assets" (Money Tracker app)
**+ Add account**:
- **Name:** `Other assets`
- **Type:** Investment
- **Currency:** THB
- **Starting balance:** 0
- Tick **Linked investment account**, name **`Other assets`**.

## 9. Check in Money Tracker
Reload the app.
- ✅ **USD Acc** shows **$5,904.53**, with "🔗 MTS Gold (USD) · Value from <today>".
- ✅ **Other assets** shows the gold bar's value.
- ✅ Every other account is exactly as before.

## 10. "After" snapshot and compare
1. Money Tracker's Apps Script → **`reconcile`** → Run → save as **`after-startover.json`**.
2. Send both files to Claude to compare. Expected:
   - every account other than USD Acc and Other assets is **identical to the cent**;
   - **USD Acc** goes from $4,958.32 to **$5,904.53**;
   - **net worth** goes up by **$946.21 × the USD rate** (about ฿32,100), plus the gold bar's market value minus ฿34,172.78, which is the cost Money Tracker used for it;
   - nothing else changes.

## If something looks wrong: undo
- In Money Tracker, untick **Linked** on USD Acc, and untick it on Other assets (or delete that account). Then remove **`WEALTH_SHEET_ID`**. Money Tracker is back exactly as before step 6, because nothing else was changed.
- The Wealth Planner side can stay as it is; it doesn't affect Money Tracker until accounts are linked.

## Later (step 7 of the plan)
Money Tracker's own Holdings/HoldingTxns/Trades tabs stay as they are, and hidden from the totals once accounts are linked, until step 7 removes the investment code. Check before step 7: the gold bar's buy entry in Money Tracker. If it has an Account, removing the investment code would change that account's balance, so it must be turned into a transfer first.
