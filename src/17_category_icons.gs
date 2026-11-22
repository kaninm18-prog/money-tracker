// ── CATEGORY ICONS ───────────────────────────────────────────
// Any emoji shown next to a category (column B of Categories / IncomeCategories); empty = app default.
function cleanIcon(s) { return String(s == null ? "" : s).trim().slice(0, 16); }
function setCategoryIcon(p) {
  var name = p.type === "income" ? SHEET.INCOME_CATS : SHEET.CATEGORIES;
  var row = resolveByKey(name, p);
  if (!row) return staleResponse();
  var sh = getSheet(name);
  ensureHeaders(sh, 2, ["Icon"]);
  sh.getRange(row, 2).setValue(cleanIcon(p.icon));
  return jsonResponse({ ok: true });
}

