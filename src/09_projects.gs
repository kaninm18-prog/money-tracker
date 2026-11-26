// ── PROJECTS ─────────────────────────────────────────────────

function getProjects() {
  var sh = getSheet(SHEET.PROJECTS);
  var projects = sheetToRows(sh, function(d, ri) {
    return { rowIndex: ri, name: d[0], budget: toFloat(d[1]), startDate: formatDate(d[2]), endDate: formatDate(d[3]) };
  });
  var expSh = getSheet(SHEET.EXPENSES);
  var expRows = sheetToRows(expSh, function(d){ return { amount: toFloat(d[1]), projectId: d[7] || "" }; });
  projects.forEach(function(proj) {
    proj.spent = expRows.filter(function(e){ return e.projectId === proj.name; })
      .reduce(function(s, e){ return s + e.amount; }, 0);
    proj.spent = Math.round(proj.spent * 100) / 100;
  });
  return jsonResponse({ ok: true, projects: projects });
}

// Everything spent on one project, across all months: the expenses (newest first), a breakdown by category
// (biggest first) and by month. The project is matched by name, as getProjects does (Expenses.ProjectId).
function getProjectDetail(p) {
  var name = String(p.name || "");
  if (!name) return jsonResponse({ ok: false, error: "Choose a project" });
  var proj = null;
  sheetToRows(getSheet(SHEET.PROJECTS), function(d, ri) {
    return { rowIndex: ri, name: d[0], budget: toFloat(d[1]), startDate: formatDate(d[2]), endDate: formatDate(d[3]) };
  }).forEach(function(x){ if (String(x.name) === name) proj = x; });
  if (!proj) return staleResponse();
  ensureRowIds(SHEET.EXPENSES);
  var rows = sheetToRows(getSheet(SHEET.EXPENSES), function(d, ri) {
    return { type: "expense", rowIndex: ri, date: formatDate(d[0]), amount: toFloat(d[1]), category: cleanName(d[2]) || "Other",
      note: d[3], account: d[4], isRecurring: toBool(d[5]), recurrencePeriod: d[6] || "", projectId: d[7] || "",
      origAmount: toFloat(d[8]) || 0, currency: d[9] || "", id: String(d[10] || "") };
  }).filter(function(e){ return String(e.projectId) === name; });
  rows.sort(function(a, b){ return a.date === b.date ? b.rowIndex - a.rowIndex : b.date.localeCompare(a.date); });
  var byCat = {}, byMonth = {}, total = 0;
  rows.forEach(function(e) {
    total += e.amount;
    byCat[e.category] = (byCat[e.category] || 0) + e.amount;
    var m = e.date.substring(0, 7);
    byMonth[m] = (byMonth[m] || 0) + e.amount;
  });
  var categories = Object.keys(byCat).map(function(c){ return { category: c, amount: round2(byCat[c]) }; })
    .sort(function(a, b){ return b.amount - a.amount; });
  var months = Object.keys(byMonth).sort().reverse().map(function(m){ return { month: m, amount: round2(byMonth[m]) }; });
  return jsonResponse({ ok: true, project: { name: proj.name, budget: proj.budget, startDate: proj.startDate, endDate: proj.endDate,
    rowIndex: proj.rowIndex, spent: round2(total), count: rows.length }, expenses: rows, categories: categories, months: months });
}

function addProject(p) {
  var name = (p.name || "").trim();
  if (!name) return jsonResponse({ ok: false, error: "Name required" });
  var sh = getSheet(SHEET.PROJECTS);
  sh.appendRow([name, toFloat(p.budget), p.startDate || "", p.endDate || ""]);
  return jsonResponse({ ok: true, rowIndex: sh.getLastRow() });
}

function updateProject(p) {
  var sh  = getSheet(SHEET.PROJECTS);
  var row = resolveByKey(SHEET.PROJECTS, p);
  if (!row) return staleResponse();
  sh.getRange(row, 1, 1, 4).setValues([[p.name || "", toFloat(p.budget), p.startDate || "", p.endDate || ""]]);
  return jsonResponse({ ok: true });
}

function deleteProject(p) {
  var sh  = getSheet(SHEET.PROJECTS);
  var row = resolveByKey(SHEET.PROJECTS, p);
  if (!row) return staleResponse();
  sh.deleteRow(row);
  return jsonResponse({ ok: true });
}

