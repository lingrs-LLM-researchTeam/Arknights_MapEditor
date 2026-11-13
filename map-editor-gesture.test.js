'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const M = require('./map-model');
const S = require('./schema');

// Execute the real canvas/tool handlers against a small DOM double. Layout,
// browser pointer capture and the editor-ui.js history stack are not simulated.
function createEditor(library = 'routes', hasRoute = true) {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const element = () => Object.assign(new EventTarget(), {
    value: '', style: {}, dataset: {},
    classList: {add() {}, remove() {}, toggle() {}},
    setAttribute() {},
  });
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, element()]));
  const get = id => {
    assert.ok(elements.has(id), `Missing HTML element: ${id}`);
    return elements.get(id);
  };
  const routeTools = [...html.matchAll(/data-editor-tool="([^"]+)"/g)].map(([, tool]) => {
    const button = element();
    button.dataset.editorTool = tool;
    return button;
  });
  get('routeLibrary').value = library;
  get('editorTileKey').value = 'tile_road';
  get('editorPlayerSideMask').value = 'ALL';
  const canvas = get('mapEditorCanvas');
  canvas.getContext = () => ({});
  canvas.getClientRects = () => [];
  canvas.getBoundingClientRect = () => ({left: 0, top: 0});
  canvas.setPointerCapture = () => {};
  canvas.parentElement = {};
  const window = new EventTarget();
  Object.assign(window, {MapModel: M, MapSchema: S, MapTileRenderer: {}});
  const context = vm.createContext({
    window, Event,
    document: {getElementById: get, querySelectorAll: selector => {
      assert.equal(selector, '[data-editor-tool]');
      return routeTools;
    }},
    ResizeObserver: class { observe() {} },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'map-editor.js'), 'utf8'), context, {
    filename: 'map-editor.js',
  });
  const editor = window.MapEditor;
  const raw = M.create();
  raw.extraRoutes = [M.route()];
  if (!hasRoute) raw[library] = [];
  raw.customFutureField = {nested: [false, null, 17]};
  editor.loadMap(raw);
  const state = editor.getState();
  state.view = {left: 0, top: 0, tileSize: 40};
  const changes = [];
  window.addEventListener('editor-changed', () => changes.push(editor.buildMapJson()));
  return {
    editor, state, raw, changes,
    click: id => get(id).dispatchEvent(new Event('click')),
    tool: tool => {
      const button = routeTools.find(button => button.dataset.editorTool === tool);
      assert.ok(button, `Missing route tool: ${tool}`);
      button.dispatchEvent(new Event('click'));
    },
    pointer: (type, x = 2, y = 2, options = {}) => {
      const event = new Event(type, {cancelable: true});
      Object.assign(event, {
        pointerId: 1, clientX: (x + .5) * 40, clientY: (state.height - y - .5) * 40,
        button: type === 'pointermove' ? -1 : 0,
        buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
        ...options,
      });
      canvas.dispatchEvent(event);
    },
  };
}

for (const library of ['routes', 'extraRoutes']) {
  for (const tool of ['START', 'END']) {
    for (const finish of ['pointerup', 'pointercancel']) {
      test(`${library} ${tool}: dragging only sets the endpoint, then ${finish} permits a new paint gesture`, () => {
        const {editor, state, raw, changes, tool: selectTool, pointer} = createEditor(library);
        const before = editor.buildMapJson();
        const expected = M.clone(before);
        expected[library][0][tool === 'START' ? 'startPosition' : 'endPosition'] = {row: 2, col: 2};
        selectTool(tool);
        pointer('pointerdown');
        assert.deepEqual(editor.buildMapJson(), expected);
        assert.equal(state.routeTool, null, 'endpoint tools remain one-shot');
        pointer('pointermove', 3, 2);
        pointer('pointermove', 4, 3);
        pointer('pointermove', -1, 3);
        pointer('pointermove', 5, 3);
        assert.deepEqual(editor.buildMapJson(), expected, 'the whole endpoint gesture must leave tiles unchanged');
        assert.deepEqual(changes, [expected], 'no extra painted snapshots enter dirty/history listeners');
        pointer(finish, 5, 3);
        pointer('pointermove', 6, 3, {buttons: 0});
        assert.deepEqual(editor.buildMapJson(), expected);

        // Preserve the existing one-shot tool behavior: the next press paints.
        pointer('pointerdown', 6, 3);
        pointer('pointermove', 7, 3);
        pointer('pointerup', 7, 3);
        assert.equal(state.cells[3][6].tileKey, 'tile_road');
        assert.equal(state.cells[3][7].tileKey, 'tile_road');
        assert.equal(changes.length, 3);
        assert.deepEqual(raw, before, 'imported data is not mutated');
        const saved = editor.buildMapJson();
        editor.loadMap(saved);
        assert.deepEqual(editor.buildMapJson(), saved, 'export and reload preserve the result');
      });
    }
  }

  test(`${library} MOVE: dragging adds one checkpoint per press and never paints`, () => {
    const {editor, changes, tool, pointer} = createEditor(library);
    const expected = editor.buildMapJson();
    tool('MOVE');
    for (const [x, y] of [[2, 2], [4, 3]]) {
      pointer('pointerdown', x, y);
      pointer('pointermove', x + 1, y);
      pointer('pointerup', x + 1, y);
      expected[library][0].checkpoints.push({...M.checkpoint('MOVE'), position: {row: y, col: x}});
      assert.deepEqual(editor.buildMapJson(), expected);
    }
    assert.equal(changes.length, 2);
  });
}

for (const tool of ['START', 'END']) {
  test(`${tool}: no active route leaves the map unchanged`, () => {
    const {editor, changes, tool: selectTool, pointer} = createEditor('routes', false);
    const before = editor.buildMapJson();
    selectTool(tool);
    pointer('pointerdown');
    pointer('pointermove', 3, 2);
    pointer('pointerup', 3, 2);
    assert.deepEqual(editor.buildMapJson(), before);
    assert.equal(changes.length, 0);
  });
}

for (const [mode, id] of [['PAINT', 'editorPaintModeButton'], ['ERASE', 'editorEraseModeButton']]) {
  test(`${mode}: ordinary dragging still edits multiple cells and stops on cancel`, () => {
    const {state, changes, click, pointer} = createEditor();
    click(id);
    pointer('pointerdown');
    pointer('pointermove', 3, 2);
    pointer('pointercancel', 3, 2);
    const untouched = M.clone(state.cells[2][4]);
    pointer('pointermove', 4, 2);
    assert.equal(changes.length, 2);
    for (const x of [2, 3]) {
      if (mode === 'ERASE') assert.equal(state.cells[2][x], null);
      else assert.equal(state.cells[2][x].tileKey, 'tile_road');
    }
    assert.deepEqual(M.clone(state.cells[2][4]), untouched);
  });
}

for (const [name, options] of [['Shift', {shiftKey: true}], ['middle button', {button: 1, buttons: 4}]]) {
  test(`${name}: panning with an endpoint tool armed does not edit the map`, () => {
    const {editor, state, changes, tool, pointer} = createEditor();
    const before = editor.buildMapJson();
    tool('START');
    pointer('pointerdown', 2, 2, options);
    pointer('pointermove', 3, 3, options);
    pointer('pointerup', 3, 3, {buttons: 0});
    assert.equal(state.mapView.panX, 40);
    assert.equal(state.mapView.panY, -40);
    assert.equal(state.mapPanning, null);
    assert.equal(state.routeTool, 'START');
    assert.deepEqual(editor.buildMapJson(), before);
    assert.equal(changes.length, 0);
  });
}

test('inspect and Alt-pick gestures do not paint', () => {
  const {editor, state, changes, click, tool, pointer} = createEditor();
  const before = editor.buildMapJson();
  click('inspectTileTool');
  pointer('pointerdown');
  pointer('pointermove', 3, 2);
  pointer('pointerup', 3, 2);
  assert.deepEqual(M.clone(state.selectedTile), {x: 2, y: 2});
  tool('END');
  pointer('pointerdown', 2, 2, {altKey: true});
  pointer('pointermove', 3, 2, {altKey: true});
  pointer('pointerup', 3, 2);
  assert.equal(state.routeTool, 'END');
  assert.deepEqual(M.clone(state.brush), before.mapData.tiles[before.mapData.map[3][2]]);
  assert.deepEqual(editor.buildMapJson(), before);
  assert.equal(changes.length, 0);
});

test('an endpoint press outside the grid does not become painting on re-entry', () => {
  const {editor, state, changes, tool, pointer} = createEditor();
  const before = editor.buildMapJson();
  tool('START');
  pointer('pointerdown', -1, 2);
  pointer('pointermove', 2, 2);
  pointer('pointerup', 2, 2);
  assert.equal(state.routeTool, 'START');
  assert.deepEqual(editor.buildMapJson(), before);
  assert.equal(changes.length, 0);
});
