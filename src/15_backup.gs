// ── BACKUP ───────────────────────────────────────────────────
// Run setupWeeklyBackup() once from the Apps Script editor (it asks for Drive permission).
// Every Sunday ~3am a copy of this spreadsheet goes to "Money Tracker Backups" in your Drive;
// the newest 12 copies are kept.
var BACKUP_FOLDER = "Money Tracker Backups", BACKUP_KEEP = 12;
function backupNow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var it = DriveApp.getFoldersByName(BACKUP_FOLDER);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(BACKUP_FOLDER);
  var name = ss.getName() + " - backup " + todayStr();
  DriveApp.getFileById(ss.getId()).makeCopy(name, folder);
  var files = [], fi = folder.getFiles();
  while (fi.hasNext()) files.push(fi.next());
  files.sort(function(a, b) { return b.getDateCreated() - a.getDateCreated(); });
  files.slice(BACKUP_KEEP).forEach(function(f) { f.setTrashed(true); });
  PropertiesService.getScriptProperties().setProperty("LAST_BACKUP", todayStr());
  return name;
}
function setupWeeklyBackup() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "backupNow") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("backupNow").timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).create();
  PropertiesService.getScriptProperties().setProperty("BACKUP_WEEKLY", "sunday");
  var name = backupNow();
  Logger.log("Weekly backup is on. First backup made: " + name);
}

