// Regression: consolidation must retain old numeric links and source-level uncertainty.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const src = fs.readFileSync('assets/app.js', 'utf8');
const load = src.slice(src.indexOf('function loadRecords('), src.indexOf('\nfunction buildManagers'));
const context = vm.createContext({DEFAULT_MANAGER: 'Social housing', DATA: [], BY_ID: new Map()});
vm.runInContext(load, context);
const rows = JSON.parse(fs.readFileSync('cities/bologna/addresses.json', 'utf8'));
context.rows = rows;
vm.runInContext('loadRecords(rows)', context);
for (const row of rows) {
  assert.equal(context.BY_ID.get(row.id).id, row.id);
  for (const alias of row.legacy_ids || []) assert.equal(context.BY_ID.get(alias).id, row.id);
}
assert.equal(context.DATA.length, 582);
assert.equal(context.DATA.filter(r=>r.verification_status === 'source_verified').length, 576);
assert.equal(JSON.parse(fs.readFileSync('cities/turin/addresses.json')).length, 1);
console.log('Building records, duplicate aliases and single-building Turin import verified.');
