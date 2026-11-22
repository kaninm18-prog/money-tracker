// Test harness: runs the real backend (src/*.gs, in file order) against an in-memory
// fake of Google Sheets and the other Apps Script services. No network, no real sheet.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');
const TOKEN = 'test-token';

function pad(n, w) { return String(n).padStart(w || 2, '0'); }
function formatDate(d, tz, fmt) {
  const x = d instanceof Date ? d : new Date(d);
  // Tests treat all dates as UTC so results don't depend on the machine's time zone.
  return fmt.replace('yyyy', x.getUTCFullYear()).replace('MM', pad(x.getUTCMonth() + 1)).replace('dd', pad(x.getUTCDate()))
    .replace('HH', pad(x.getUTCHours())).replace('mm', pad(x.getUTCMinutes())).replace('ss', pad(x.getUTCSeconds()));
}

function makeSheet(name) {
  const rows = [];
  const sheet = {
    name, rows, hidden: false,
    getName: () => name,
    appendRow(r) { rows.push(r.slice()); return sheet; },
    getLastRow: () => rows.length,
    getLastColumn: () => Math.max(1, ...rows.map(r => r.length)),
    getDataRange: () => sheet.getRange(1, 1, Math.max(1, rows.length), sheet.getLastColumn()),
    deleteRow(n) { rows.splice(n - 1, 1); },
    hideSheet() { sheet.hidden = true; },
    getRange(r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      const rng = {
        getValues() {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = [];
            for (let j = 0; j < nc; j++) { const v = (rows[r - 1 + i] || [])[c - 1 + j]; row.push(v === undefined ? '' : v); }
            out.push(row);
          }
          return out;
        },
        getValue: () => rng.getValues()[0][0],
        setValues(v) {
          for (let i = 0; i < v.length; i++) {
            while (rows.length < r + i) rows.push([]);
            for (let j = 0; j < v[i].length; j++) rows[r - 1 + i][c - 1 + j] = v[i][j];
          }
          return rng;
        },
        setValue: v => rng.setValues([[v]]),
        clearContent() { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (rows[r - 1 + i]) rows[r - 1 + i][c - 1 + j] = ''; return rng; },
        setFormula: () => rng, setFormulas: () => rng,
        setNumberFormat: () => rng, setNumberFormats: () => rng, setFontWeight: () => rng,
      };
      return rng;
    },
  };
  return sheet;
}

// Returns a fresh backend with an empty spreadsheet.
function createBackend() {
  const sheets = {};
  const props = { API_TOKEN: TOKEN };
  let uuid = 0;
  const ss = {
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => (sheets[n] = makeSheet(n)),
    getName: () => 'Money Tracker (test)',
    getId: () => 'test-sheet-id',
  };
  const context = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush() {} },
    ContentService: { createTextOutput: t => ({ setMimeType() { return this; }, getContent: () => t }), MimeType: { JSON: 'json' } },
    Utilities: {
      getUuid: () => pad(++uuid, 8) + '-aaaa-bbbb-cccc-dddddddddddd',
      formatDate, sleep() {},
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: k => { delete props[k]; },
      getProperties: () => Object.assign({}, props),
    }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    Logger: { log() {} },
    ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: () => { throw new Error('triggers not available in tests'); }, WeekDay: {} },
    DriveApp: { getFoldersByName() { throw new Error('Drive not available in tests'); } },
    UrlFetchApp: { fetch() { throw new Error('network not available in tests'); } },
  };
  vm.createContext(context);
  const files = fs.readdirSync(SRC).filter(f => f.endsWith('.gs')).sort();
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), context, { filename: f });

  // Like the app: one POST per call. Memo/caches are per request in Apps Script, so reset them.
  function api(payload) {
    vm.runInContext('_ss = null; _sheetMemo = {}; _fmtMemo = {}; _readCache = null; _idsDone = {}; _recvIds = false;', context);
    const body = JSON.stringify(Object.assign({ token: TOKEN }, payload));
    return JSON.parse(context.doPost({ postData: { contents: body } }).getContent());
  }
  return { api, sheets, context, makeSheet };
}

module.exports = { createBackend, TOKEN };
