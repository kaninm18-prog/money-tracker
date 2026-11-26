// ── IMPORT DATA FILE ─────────────────────────────────────────
// One file can add accounts. Safe to import twice: existing accounts (same name) are skipped.
// (Holdings and trades are in the Wealth Planner now.)
function importPack(p) {
  var out = { ok: true, accounts: { added: [], skipped: [] } };
  // accounts
  var have = {};
  sheetToRows(getSheet(SHEET.ACCOUNTS), function(d){ return String(d[0] || "").trim().toLowerCase(); }).forEach(function(n){ have[n] = true; });
  (p.accounts || []).forEach(function(a) {
    var name = String(a.name || "").trim();
    if (!name) return;
    if (have[name.toLowerCase()]) {
      if (a.setStartingBalance) {                  // the file says what the opening balance should be
        var row = resolveByKey(SHEET.ACCOUNTS, { key: name });
        if (row) { getSheet(SHEET.ACCOUNTS).getRange(row, 3).setValue(toFloat(a.startingBalance)); out.accounts.updated = (out.accounts.updated || []).concat([name]); return; }
      }
      out.accounts.skipped.push(name); return;
    }
    JSON.parse(addAccount({ name: name, type: a.type || "bank", startingBalance: a.startingBalance || 0, currency: a.currency || "THB",
      rate: a.rate, creditLimit: a.creditLimit, dueDay: a.dueDay, statementDay: a.statementDay }).getContent());
    have[name.toLowerCase()] = true; out.accounts.added.push(name);
  });
  return jsonResponse(out);
}
