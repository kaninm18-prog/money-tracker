// ── CATEGORIES ────────────────────────────────────────────────

function getCategories() {
  var sh = getSheet(SHEET.CATEGORIES);
  return jsonResponse({ ok: true, categories: sheetToRows(sh, function(d, ri){ return { rowIndex: ri, name: d[0], icon: String(d[1] || "") }; }) });
}
function categoryExists(sheetName, name) {
  return sheetToRows(getSheet(sheetName), function(d){ return cleanName(d[0]).toLowerCase(); })
    .indexOf(name.toLowerCase()) >= 0;
}
function addCategory(p) {
  var name = cleanName(p.name);
  if (!name) return jsonResponse({ ok: false, error: "Name required" });
  if (categoryExists(SHEET.CATEGORIES, name)) return jsonResponse({ ok: false, error: "That category already exists" });
  var sh = getSheet(SHEET.CATEGORIES); sh.appendRow([name, cleanIcon(p.icon)]);
  if (cleanIcon(p.icon)) ensureHeaders(sh, 2, ["Icon"]);
  return jsonResponse({ ok: true, rowIndex: sh.getLastRow() });
}
function deleteCategory(p) {
  var sh = getSheet(SHEET.CATEGORIES); var row = resolveByKey(SHEET.CATEGORIES, p);
  if (!row) return staleResponse();
  sh.deleteRow(row); return jsonResponse({ ok: true });
}

function getIncomeCategories() {
  var sh = getSheet(SHEET.INCOME_CATS);
  return jsonResponse({ ok: true, categories: sheetToRows(sh, function(d, ri){ return { rowIndex: ri, name: d[0], icon: String(d[1] || "") }; }) });
}
function addIncomeCategory(p) {
  var name = cleanName(p.name);
  if (!name) return jsonResponse({ ok: false, error: "Name required" });
  if (categoryExists(SHEET.INCOME_CATS, name)) return jsonResponse({ ok: false, error: "That category already exists" });
  var sh = getSheet(SHEET.INCOME_CATS); sh.appendRow([name, cleanIcon(p.icon)]);
  if (cleanIcon(p.icon)) ensureHeaders(sh, 2, ["Icon"]);
  return jsonResponse({ ok: true, rowIndex: sh.getLastRow() });
}
function deleteIncomeCategory(p) {
  var sh = getSheet(SHEET.INCOME_CATS); var row = resolveByKey(SHEET.INCOME_CATS, p);
  if (!row) return staleResponse();
  sh.deleteRow(row); return jsonResponse({ ok: true });
}

