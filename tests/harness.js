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
    clearContents() { rows.length = 0; return sheet; },
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

function makeSpreadsheet(name, id) {
  const sheets = {};
  return {
    sheets,
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => (sheets[n] = makeSheet(n)),
    getName: () => name,
    getId: () => id,
  };
}

// The Wealth Planner's spreadsheet, as SpreadsheetApp.openById() sees it from Money Tracker.
// A test fills its export tabs with setTab(); `broken = true` makes openById throw.
const WEALTH_ID = 'wealth-test-id';
function makeWealth() {
  const ss = makeSpreadsheet('Wealth Planner (test)', WEALTH_ID);
  const wealth = {
    ss, sheets: ss.sheets, broken: false, opened: 0,
    setTab(name, header, rows) { const sh = makeSheet(name); sh.appendRow(header); rows.forEach(r => sh.appendRow(r)); ss.sheets[name] = sh; },
    removeTab(name) { delete ss.sheets[name]; },
  };
  return wealth;
}

// Returns a fresh backend with an empty spreadsheet.
// opts.now: a fixed clock (ISO string) so results don't depend on today; opts.src: another folder of .gs files.
function createBackend(opts) {
  opts = opts || {};
  const ss = makeSpreadsheet('Money Tracker (test)', 'test-sheet-id');
  const sheets = ss.sheets;
  const props = { API_TOKEN: TOKEN };
  const wealth = makeWealth();
  let uuid = 0;
  const context = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss, flush() {},
      openById(id) {
        wealth.opened++;
        if (wealth.broken || id !== WEALTH_ID) throw new Error('Spreadsheet not found');
        return wealth.ss;
      },
    },
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
  if (opts.now) {
    context.__NOW = Date.parse(opts.now);
    vm.runInContext('(function(R){ function D(){ return arguments.length ? new (Function.prototype.bind.apply(R, [null].concat([].slice.call(arguments))))() : new R(__NOW); }' +
      ' D.prototype = R.prototype; D.UTC = R.UTC; D.parse = R.parse; D.now = function(){ return __NOW; }; Date = D; })(Date);', context);
  }
  const src = opts.src || SRC;
  const files = fs.readdirSync(src).filter(f => f.endsWith('.gs')).sort();
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(src, f), 'utf8'), context, { filename: f });

  // Like the app: one POST per call. Memo/caches are per request in Apps Script, so reset them.
  function reset() {
    vm.runInContext('_ss = null; _sheetMemo = {}; _fmtMemo = {}; _readCache = null; _idsDone = {}; _recvIds = false; _wealthSS = undefined; _wealthValues = undefined;', context);
  }
  // A time-based trigger (e.g. dailyRefresh) is its own execution too
  function run(fn) { reset(); return context[fn](); }
  function api(payload) {
    reset();
    const body = JSON.stringify(Object.assign({ token: TOKEN }, payload));
    return JSON.parse(context.doPost({ postData: { contents: body } }).getContent());
  }
  return { api, run, sheets, context, makeSheet, props, wealth };
}

module.exports = { createBackend, TOKEN, WEALTH_ID };
