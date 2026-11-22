// The version shown in Settings must match the newest CHANGELOG.md date, so a release can't forget to bump it.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

test('APP_VERSION matches the newest CHANGELOG date', () => {
  const core = fs.readFileSync(path.join(root, 'js', 'core.js'), 'utf8');
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const version = (core.match(/var APP_VERSION = '([^']+)'/) || [])[1];
  const newest = (changelog.match(/^## (\d{4})-(\d{2})-(\d{2})/m) || []).slice(1).join('.');
  assert.ok(version, 'APP_VERSION not found in js/core.js');
  assert.ok(newest, 'no "## YYYY-MM-DD" heading in CHANGELOG.md');
  assert.match(version, /^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/, 'APP_VERSION should look like 2026.11.22 or 2026.11.22.2');
  assert.equal(version.split('.').slice(0, 3).join('.'), newest,
    'bump APP_VERSION in js/core.js to the newest CHANGELOG date');
});
