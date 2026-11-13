'use strict';

// Opt-in regression checks for a locally available corpus. Never download,
// generate, or silently skip missing samples as part of the default test suite.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../map-model');
const S = require('../schema');

if (process.argv.length !== 3) {
  console.error('Usage: node tools/check-external-maps.js <sample-root>');
  process.exit(1);
}
const root = path.resolve(process.argv[2]);
let maps = 0;
let legacy = 0;
for (const relative of S.sources) {
  // schema.js may have been generated on Windows; resolve either separator on
  // the host OS while keeping all corpus paths relative to the explicit root.
  const filename = path.join(root, ...relative.split(/[\\/]/));
  const raw = JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
  M.assertMap(raw);
  const expected = M.clone(raw);
  const wasLegacy = !!expected.routeCalculatorTest;
  if (wasLegacy) legacy++;
  delete expected.routeCalculatorTest;
  if (wasLegacy && Array.isArray(expected.optionalRunes) && !expected.optionalRunes.length) expected.optionalRunes = null;
  for (const key of ['routes', 'extraRoutes']) {
    for (const route of expected[key] || []) {
      delete route.editorId;
      delete route.visitEveryNodeStably;
      if (wasLegacy && route.checkpoints) route.checkpoints = route.checkpoints.map(c => ({...M.checkpoint(c.type), ...c}));
    }
  }
  for (const {part} of M.parts(expected)) for (const action of part.actions) delete action.editorEnemyId;
  assert.deepEqual(M.exportMap(raw, M.cells(raw)), expected, relative);
  maps++;
}
console.log(JSON.stringify({roundTripMaps: maps, legacyMapsCleaned: legacy}, null, 2));
