'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const M = require('./map-model');
const S = require('./schema');
const {syntheticMap} = require('./tests/fixtures/maps');

// Default tests are entirely self-contained. Optional local sample checks live
// in tools/check-external-maps.js and must be requested explicitly.
test('synthetic map round-trip preserves unknown fields, nulls, shared and unused tiles', () => {
  const raw = syntheticMap();
  const before = M.clone(raw);
  M.assertMap(raw);
  assert.deepEqual(M.validate(raw), {errors: [], warnings: []});
  assert.deepEqual(M.exportMap(raw, M.cells(raw)), before);
  assert.deepEqual(raw, before);
});

test('legacy export cleans known editor fields in both route libraries and action containers', () => {
  const raw = syntheticMap();
  raw.routeCalculatorTest = {synthetic: true};
  raw.optionalRunes = [];
  for (const key of ['routes', 'extraRoutes']) {
    raw[key][0].editorId = 'synthetic-editor-id';
    raw[key][0].visitEveryNodeStably = true;
    raw[key][0].checkpoints = [{type: 'MOVE', position: {row: 1, col: 0}, customCheckpointField: null}];
  }
  raw.waves[0].fragments[0].actions[0].editorEnemyId = 'wave-editor-id';
  raw.branches.synthetic_branch.phases[0].actions[0].editorEnemyId = 'branch-editor-id';
  const before = M.clone(raw);
  const expected = M.clone(raw);
  delete expected.routeCalculatorTest;
  expected.optionalRunes = null;
  for (const key of ['routes', 'extraRoutes']) {
    delete expected[key][0].editorId;
    delete expected[key][0].visitEveryNodeStably;
    // Explicit expectations keep a broken checkpoint factory from masking an
    // export regression by generating the same broken expected value.
    expected[key][0].checkpoints = [{
      type: 'MOVE', time: 0, position: {row: 1, col: 0},
      reachOffset: {x: 0, y: 0}, randomizeReachOffset: false,
      reachDistance: 0, customCheckpointField: null,
    }];
  }
  delete expected.waves[0].fragments[0].actions[0].editorEnemyId;
  delete expected.branches.synthetic_branch.phases[0].actions[0].editorEnemyId;
  assert.deepEqual(M.exportMap(raw, M.cells(raw)), expected);
  assert.deepEqual(raw, before);
});

test('non-legacy exports retain empty optionalRunes and partial checkpoints', () => {
  const raw = syntheticMap();
  raw.optionalRunes = [];
  raw.routes[0].editorId = 'synthetic-editor-id';
  raw.routes[0].visitEveryNodeStably = true;
  raw.waves[0].fragments[0].actions[0].editorEnemyId = 'synthetic-editor-enemy';
  const expected = M.clone(raw);
  delete expected.routes[0].editorId;
  delete expected.routes[0].visitEveryNodeStably;
  delete expected.waves[0].fragments[0].actions[0].editorEnemyId;
  assert.deepEqual(M.exportMap(raw, M.cells(raw)), expected);
});

test('generated maps support waves, branches and every non-sentinel checkpoint type', () => {
  const d = M.create();
  d.customFutureField = {nested: [false, null, 17]};
  d.routes.push(M.route(), M.route());
  d.extraRoutes = [M.route()];
  d.enemyDbRefs = [M.clone(S.enemyReference)];
  d.waves = [M.wave(), M.wave()];
  d.waves[0].fragments.push(M.fragment());
  d.waves[1].fragments[0].actions = [{...M.action(), routeIndex: 2}];
  d.branches = {summon: {phases: [{preDelay: 2, actions: [M.action(true)]}, M.fragment()]}};
  for (const type of Object.keys(S.enums.CheckpointType).filter(key => key !== 'INVALID')) {
    d.routes[0].checkpoints.push({
      ...M.checkpoint(type), reachOffset: {x: .25, y: -.25}, position: {row: 1, col: 2},
    });
  }
  assert.deepEqual(M.validate(d).errors, []);
  assert.throws(() => M.deleteRoute(d, 'extraRoutes', 0), /仍被/);
  M.deleteRoute(d, 'routes', 1);
  assert.equal(d.waves[1].fragments[0].actions[0].routeIndex, 1);
  assert.equal(d.branches.summon.phases[0].actions[0].routeIndex, 0);
  assert.deepEqual(M.exportMap(d, M.cells(d)), d);
});

test('painting a unique tile preserves its index and does not mutate the source map', () => {
  const d = M.create();
  const before = M.clone(d);
  const grid = M.cells(d);
  grid[0][0] = M.tile('tile_road');
  grid[0][0].blackboard = [{key: 'test_key', value: 1, valueStr: null}];
  const out = M.exportMap(d, grid);
  assert.deepEqual(d, before);
  assert.deepEqual(out.mapData.tiles.slice(1), before.mapData.tiles.slice(1));
  assert.equal(out.mapData.map.at(-1)[0], 0);
  assert.equal(out.mapData.tiles.length, 60);
  assert.deepEqual(out.mapData.tiles[0], grid[0][0]);
});

test('editing a shared tile allocates a new index without changing its other cells', () => {
  const d = syntheticMap();
  const before = M.clone(d);
  const grid = M.cells(d);
  grid[1][0] = M.tile('tile_end');
  const out = M.exportMap(d, grid);
  assert.deepEqual(d, before);
  assert.equal(out.mapData.map[0][0], 4);
  assert.equal(out.mapData.map[1][1], 0);
  assert.deepEqual(out.mapData.tiles.slice(0, 4), before.mapData.tiles);
  assert.deepEqual(out.mapData.tiles[4], grid[1][0]);
});

test('resizing rebuilds indices with the editor-to-map row orientation intact', () => {
  const d = syntheticMap();
  const before = M.clone(d);
  const grid = [[M.tile('tile_start')], [M.tile('tile_road')], [M.tile('tile_end')]];
  const out = M.exportMap(d, grid);
  assert.deepEqual(out.mapData.map, [[2], [1], [0]]);
  assert.deepEqual(out.mapData.tiles, grid.flat());
  assert.deepEqual(out.mapData.customMapField, d.mapData.customMapField);
  assert.deepEqual(d, before);
});

test('null optional containers and empty route lists survive round-trip', () => {
  const empty = M.create();
  empty.routes = [];
  empty.extraRoutes = null;
  empty.branches = null;
  M.assertMap(empty);
  assert.deepEqual(M.exportMap(empty, M.cells(empty)), empty);
});

test('route deletion protects string and numeric spawn/cursor references in both libraries', () => {
  for (const actionType of ['SPAWN', 'PREVIEW_CURSOR', 0, 1]) {
    for (const location of ['wave', 'wave-extra', 'branch']) {
      const d = M.create();
      d.extraRoutes = [M.route()];
      const action = {...M.action(), actionType};
      if (location === 'branch') d.branches = {test: {phases: [{preDelay: 0, actions: [action]}]}};
      else d.waves[0].fragments[0].actions = [action];
      if (location === 'wave-extra') action.useExtraRoute = true;
      const before = M.clone(d);
      const library = location === 'wave' ? 'routes' : 'extraRoutes';
      assert.throws(() => M.deleteRoute(d, library, 0), /仍被/, `${actionType}/${location}`);
      assert.deepEqual(d, before);
    }
  }
});

test('deleting an unused route adjusts only later references to the same library', () => {
  const d = M.create();
  d.routes.push(M.route(), M.route());
  d.extraRoutes = [M.route(), M.route(), M.route()];
  const main = {...M.action(), routeIndex: 2};
  const earlier = {...M.action(), routeIndex: 0};
  const extra = {...M.action(), actionType: 1, useExtraRoute: true, routeIndex: 2};
  const unrelated = {...M.action(), actionType: 'EMPTY', routeIndex: 2};
  const branch = {...M.action(true), routeIndex: 2};
  d.waves[0].fragments[0].actions = [main, earlier, extra, unrelated];
  d.branches = {test: {phases: [{preDelay: 0, actions: [branch]}]}};
  M.deleteRoute(d, 'routes', 1);
  assert.deepEqual([main, earlier, extra, unrelated, branch].map(a => a.routeIndex), [1, 0, 2, 2, 2]);
  M.deleteRoute(d, 'extraRoutes', 1);
  assert.deepEqual([main, earlier, extra, unrelated, branch].map(a => a.routeIndex), [1, 0, 1, 2, 1]);
  assert.deepEqual(M.validate(d).errors, []);
});

test('malformed tile indices and non-rectangular maps are rejected', () => {
  for (const index of [-1, .5, '0', 60]) {
    const corrupt = M.create();
    corrupt.mapData.map[0][0] = index;
    assert.throws(() => M.assertMap(corrupt), /索引/);
    assert.match(M.validate(corrupt).errors.join(), /索引/);
  }
  const ragged = M.create();
  ragged.mapData.map[0].pop();
  assert.throws(() => M.assertMap(ragged), /矩形/);
});

test('validation reports invalid route references', () => {
  for (const branch of [false, true]) {
    const d = M.create();
    const part = {preDelay: 0, actions: [{...M.action(branch), routeIndex: 99}]};
    if (branch) d.branches = {test: {phases: [part]}};
    else d.waves[0].fragments = [part];
    assert.match(M.validate(d).errors.join(), /routeIndex/);
  }
});

test('all known non-sentinel action enums validate in string and numeric form', () => {
  for (const [name, value] of Object.entries(S.enums.ActionType).filter(([key]) => key !== 'E_NUM')) {
    for (const actionType of [name, value]) {
      const d = M.create();
      d.waves[0].fragments[0].actions = [{...M.action(), actionType}];
      assert.deepEqual(M.validate(d).errors, [], String(actionType));
    }
  }
});

test('unknown enums are warnings and remain unchanged on export', () => {
  const d = syntheticMap();
  d.routes[0].motionMode = 'SYNTHETIC_FUTURE_MOTION';
  d.waves[0].fragments[0].actions[0].actionType = 'SYNTHETIC_FUTURE_ACTION';
  const result = M.validate(d);
  assert.deepEqual(result.errors, []);
  assert.equal(result.warnings.length, 2);
  assert.ok(result.warnings.every(warning => warning.includes('未知枚举')));
  assert.deepEqual(M.exportMap(d, M.cells(d)), d);
});
