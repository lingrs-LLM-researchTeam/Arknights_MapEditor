'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const M = require('./map-model');
const S = require('./schema');

function withSpawn(actionType = 'SPAWN', branch = false) {
  const raw = M.create();
  const action = {...M.action(branch), actionType, key: 'synthetic_unknown_enemy', routeIndex: 0};
  if (branch) {
    raw.extraRoutes = [M.route()];
    raw.branches = {synthetic: {phases: [{...M.fragment(), actions: [action]}]}};
  } else raw.waves[0].fragments[0].actions = [action];
  return raw;
}

for (const [name, invalid] of [['null', null], ['number', 17], ['boolean', false], ['string', 'enemy'], ['array', []]]) {
  test(`enemyDbRefs rejects a ${name} member with an indexed error instead of throwing from validate`, () => {
    for (const branch of [false, true]) {
      for (const index of [0, 1]) {
        const raw = withSpawn(branch ? 0 : 'SPAWN', branch);
        raw.enemyDbRefs = index ? [{id: 'synthetic_unknown_enemy'}, invalid] : [invalid];
        const before = M.clone(raw);
        const message = `enemyDbRefs[${index}] 必须为敌人引用对象`;
        let result;
        assert.doesNotThrow(() => { result = M.validate(raw); });
        assert.deepEqual(result, {errors: [message], warnings: []});
        assert.throws(() => M.assertMap(raw), {message});
        assert.deepEqual(raw, before, 'validation must not repair or discard imported data');
        // Reject malformed entries even when no SPAWN action happens to visit them.
        raw.waves = [];
        raw.branches = null;
        assert.deepEqual(M.validate(raw), {errors: [message], warnings: []});
      }
    }
  });
}

for (const kind of ['missing', 'null', 'empty']) {
  test(`enemyDbRefs ${kind} remains allowed and preserves its export representation`, () => {
    const raw = M.create();
    if (kind === 'missing') delete raw.enemyDbRefs;
    else raw.enemyDbRefs = kind === 'null' ? null : [];
    const before = M.clone(raw);
    assert.doesNotThrow(() => M.assertMap(raw));
    assert.deepEqual(M.validate(raw), {errors: [], warnings: []});
    assert.deepEqual(M.exportMap(raw, M.cells(raw)), before);
    assert.deepEqual(raw, before);
  });
}

test('enemy reference objects retain unknown IDs, fields and nested nulls without schema guessing', () => {
  const raw = withSpawn();
  const reference = {...M.clone(S.enemyReference), id: 'synthetic_unknown_enemy'};
  reference.futureField = {nested: [false, null, 17]};
  // This fix validates only the object boundary, not required ID/override fields.
  raw.enemyDbRefs = [{}, reference, {id: 17, futureField: null}];
  raw.customFutureField = {opaque: null};
  const before = M.clone(raw);
  assert.doesNotThrow(() => M.assertMap(raw));
  assert.deepEqual(M.validate(raw), {errors: [], warnings: []});
  assert.deepEqual(M.exportMap(raw, M.cells(raw)), before);
  assert.deepEqual(raw, before);
});

test('unrecognized enum values still produce warnings and survive export unchanged', () => {
  const raw = M.create();
  raw.enemyDbRefs = [{id: 'synthetic_unknown_enemy', futureField: null}];
  raw.routes[0].motionMode = 'FUTURE_MOTION';
  raw.routes[0].checkpoints = [{...M.checkpoint('FUTURE_CHECKPOINT'), futureField: {nullable: null}}];
  const before = M.clone(raw);
  const result = M.validate(raw);
  assert.deepEqual(result.errors, []);
  assert.equal(result.warnings.length, 2);
  assert.ok(result.warnings.every(warning => warning.includes('含未知枚举，将原样保留')));
  assert.deepEqual(M.exportMap(raw, M.cells(raw)), before);
  assert.deepEqual(raw, before);
});

for (const actionType of ['SPAWN', 0]) {
  test(`unlisted enemy keys for ${JSON.stringify(actionType)} remain warnings rather than errors`, () => {
    const raw = withSpawn(actionType);
    raw.enemyDbRefs = [];
    const before = M.clone(raw);
    assert.deepEqual(M.validate(raw), {
      errors: [],
      warnings: ['waves[0].fragments[0].actions[0] 的敌人 key 未列入 enemyDbRefs：synthetic_unknown_enemy'],
    });
    assert.deepEqual(M.exportMap(raw, M.cells(raw)), before);
  });
}

test('the existing enemyDbRefs container error is unchanged', () => {
  for (const value of [{}, false, 17, 'enemy']) {
    const raw = M.create();
    raw.enemyDbRefs = value;
    assert.deepEqual(M.validate(raw), {errors: ['enemyDbRefs 必须为数组'], warnings: []});
  }
});

// Load the real editor entry point, without browser layout, rendering or native
// file I/O. This verifies that assertMap rejects before replacing editor state.
function createEditor() {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => {
    const element = new EventTarget();
    element.value = '';
    return [id, element];
  }));
  const get = id => {
    assert.ok(elements.has(id), `Missing HTML element: ${id}`);
    return elements.get(id);
  };
  get('routeLibrary').value = 'routes';
  get('editorTileKey').value = 'tile_road';
  get('mapEditorCanvas').getContext = () => ({});
  get('mapEditorCanvas').getClientRects = () => [];
  get('mapEditorCanvas').parentElement = {};
  const window = new EventTarget();
  Object.assign(window, {MapModel: M, MapSchema: S, MapTileRenderer: {}});
  const context = vm.createContext({
    window, Event,
    document: {getElementById: get, querySelectorAll: () => []},
    ResizeObserver: class { observe() {} },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'map-editor.js'), 'utf8'), context, {filename: 'map-editor.js'});
  return {editor: window.MapEditor, window};
}

test('rejecting a malformed import preserves the current editor document and emits no change', () => {
  const {editor, window} = createEditor();
  const current = M.create();
  current.levelId = 'current-unsaved-map';
  current.customFutureField = {nested: [false, null, 17]};
  editor.loadMap(current);
  const state = editor.getState();
  const previousDocument = state.document, previousCells = state.cells, previousRoutes = state.routes;
  const before = editor.buildMapJson();
  let changes = 0;
  window.addEventListener('editor-changed', () => changes++);
  const invalid = withSpawn();
  invalid.levelId = 'malformed-import';
  invalid.enemyDbRefs = [null];
  const invalidBefore = M.clone(invalid);
  assert.throws(() => editor.loadMap(invalid), {message: 'enemyDbRefs[0] 必须为敌人引用对象'});
  assert.equal(state.document, previousDocument);
  assert.equal(state.cells, previousCells);
  assert.equal(state.routes, previousRoutes);
  assert.deepEqual(editor.buildMapJson(), before);
  assert.deepEqual(invalid, invalidBefore);
  assert.equal(changes, 0);
  const valid = M.create();
  valid.levelId = 'next-valid-map';
  editor.loadMap(valid);
  assert.deepEqual(editor.buildMapJson(), valid);
  assert.equal(changes, 1, 'a later valid import still works');
});
