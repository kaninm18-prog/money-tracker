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

