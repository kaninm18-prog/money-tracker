#!/usr/bin/env node
// Lint the app with ESLint, focused on real bugs rather than style.
//
// Apps Script files share one global scope, and so do the browser scripts (index.html loads
// js/*.js as plain <script> tags). So each group is joined in load order and checked as ONE
// program; that way "is this name defined anywhere?" and "is this name defined twice?" are
// answered correctly. Problems are reported against the original file and line.
//
// Usage: npm run lint        Exit code 1 if there are errors (warnings don't fail).
'use strict';
const fs = require('fs');
const path = require('path');
const { Linter } = require('eslint');
const globals = require('globals');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const RULES = {
  // Errors: almost always a bug
  'no-undef': 'error',                 // typo in a name, or something never defined
  'no-redeclare': 'error',             // same function/var defined twice (the later one silently wins)
  'no-dupe-keys': 'error',
  'no-duplicate-case': 'error',
  'no-dupe-else-if': 'error',
  'no-unreachable': 'error',
  'no-func-assign': 'error',
  'no-const-assign': 'error',
  'no-self-assign': 'error',
  'no-unsafe-finally': 'error',
  'no-unsafe-negation': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
  'no-sparse-arrays': 'error',
  'no-loss-of-precision': 'error',
  'getter-return': 'error',
  'no-cond-assign': ['error', 'except-parens'],   // `if (a = b)` where `===` was meant
  // Warnings: worth a look, not always wrong
  'no-unused-vars': ['warn', { vars: 'local', args: 'none', caughtErrors: 'none' }],
  'no-fallthrough': 'warn',
  'no-self-compare': 'warn',
  'no-unmodified-loop-condition': 'warn',
};

const APPS_SCRIPT = ['SpreadsheetApp', 'ContentService', 'Utilities', 'PropertiesService', 'CacheService',
  'LockService', 'Session', 'UrlFetchApp', 'DriveApp', 'ScriptApp', 'Logger', 'MailApp', 'HtmlService', 'console']
  .reduce((o, k) => (o[k] = 'readonly', o), {});

// Each part: { file, code, firstLine } — firstLine is where `code` starts inside `file`.
function backendParts() {
  return fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.gs')).sort()
    .map(f => ({ file: 'src/' + f, code: read('src/' + f), firstLine: 1 }));
}
function frontendParts() {
  const html = read('index.html'), parts = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    const src = (m[1].match(/\bsrc="([^"]+)"/) || [])[1];
    if (src && /^https?:/.test(src)) continue;                 // CDN libraries
    if (src) parts.push({ file: src, code: read(src), firstLine: 1 });
    else {
      const before = html.slice(0, m.index + m[0].indexOf('>') + 1);
      parts.push({ file: 'index.html', code: m[2], firstLine: before.split('\n').length });
    }
  }
  return parts;
}

function lintGroup(name, parts, extraGlobals) {
  let code = '', map = [];                                    // map[i] = {file, line} for bundle line i+1
  for (const p of parts) {
    const text = p.code.endsWith('\n') ? p.code : p.code + '\n';
    text.split('\n').slice(0, -1).forEach((_, i) => map.push({ file: p.file, line: p.firstLine + i }));
    code += text;
  }
  const config = {
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: extraGlobals },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: RULES,
  };
  return new Linter({ configType: 'flat' }).verify(code, config, name + '.js').map(msg => {
    const at = map[(msg.line || 1) - 1] || { file: name, line: msg.line };
    return { file: at.file, line: at.line, col: msg.column, severity: msg.severity, rule: msg.ruleId, text: msg.message };
  });
}

const results = [
  ...lintGroup('backend', backendParts(), APPS_SCRIPT),
  ...lintGroup('frontend', frontendParts(), Object.assign({}, globals.browser, { XLSX: 'readonly' })),
  ...lintGroup('service-worker', [{ file: 'sw.js', code: read('sw.js'), firstLine: 1 }], globals.serviceworker),
].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

let errors = 0, warnings = 0;
for (const r of results) {
  if (r.severity === 2) errors++; else warnings++;
  console.log(`${r.file}:${r.line}:${r.col}  ${r.severity === 2 ? 'error  ' : 'warning'}  ${r.text}  (${r.rule || 'parse'})`);
}
console.log(`\n${errors} error(s), ${warnings} warning(s)`);
process.exit(errors ? 1 : 0);
