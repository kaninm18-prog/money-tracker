// Records unlinked-golden.json from a folder of .gs files (the code before step 4):
//   node tests/fixtures/make-golden.js <src folder>
'use strict';
const fs = require('fs');
const path = require('path');
const { createBackend } = require('../harness');
const { NOW, build, snapshot } = require('./unlinked');

const src = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'src'));
const b = createBackend({ now: NOW, src });
build(b);
fs.writeFileSync(path.join(__dirname, 'unlinked-golden.json'), JSON.stringify(snapshot(b), null, 1) + '\n');
console.log('wrote unlinked-golden.json from ' + path.relative(process.cwd(), src));
