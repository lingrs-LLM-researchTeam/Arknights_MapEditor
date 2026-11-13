'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const M = require('./map-model');
const S = require('./schema');

// Run the real load/add/delete handlers and export builder without a browser.
// The small DOM double intentionally omits layout, drawing and editor-ui.js:
// these tests cover document binding, not visual or native save behavior.
function createEditor(library) {
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
  get('routeLibrary').value = library;
  get('editorTileKey').value = 'tile_road';
  get('mapEditorCanvas').getContext = () => ({});
  get('mapEditorCanvas').getClientRects = () => [];
  get('mapEditorCanvas').parentElement = {};
  const window = new EventTarget();
  window.MapModel = M;
  window.MapSchema = S;
  window.MapTileRenderer = {};
  const context = vm.createContext({
    window, Event,
    document: {getElementById: get, querySelectorAll: () => []},
    ResizeObserver: class { observe() {} },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'map-editor.js'), 'utf8'), context, {
    filename: 'map-editor.js',
  });
  return {
    editor: window.MapEditor,
    click: id => get(id).dispatchEvent(new Event('click')),
    onChange: fn => window.addEventListener('editor-changed', fn),
  };
}

for (const library of ['routes', 'extraRoutes']) {
  for (const initial of ['null', 'missing', 'empty', 'existing']) {
    test(`${library}: adding routes with initial ${initial} survives export and reload`, () => {
      const {editor, click, onChange} = createEditor(library);
      const raw = M.create();
      raw.customFutureField = {nested: [false, null, 17]};
      if (initial === 'missing') delete raw[library];
      else raw[library] = initial === 'null' ? null : initial === 'empty' ? [] : [M.route()];
      const before = M.clone(raw);
      const expected = M.clone(raw[library] || []);
      editor.loadMap(raw);
      // Loading alone must not change null/missing to an empty array.
      assert.deepEqual(editor.buildMapJson(), before);
      const changes = [];
      onChange(() => changes.push(editor.buildMapJson()));

      for (let i = 0; i < 2; i++) {
        click('editorAddRouteButton');
        expected.push(M.route());
        assert.deepEqual(editor.buildMapJson(), {...before, [library]: expected});
        // History and dirty tracking read the exported document in this event.
        assert.deepEqual(changes.at(-1)[library], expected);
        assert.equal(editor.getState().routes, editor.getState().document[library]);
      }
      assert.equal(changes.length, 2);
      assert.deepEqual(raw, before, 'the imported object must not be mutated');
      const other = library === 'routes' ? 'extraRoutes' : 'routes';
      assert.deepEqual(editor.buildMapJson()[other], before[other]);
      const saved = editor.buildMapJson();
      editor.loadMap(saved);
      assert.deepEqual(editor.buildMapJson(), saved);
      click('editorAddRouteButton');
      expected.push(M.route());
      assert.deepEqual(editor.buildMapJson()[library], expected);
      click('editorDeleteRouteButton');
      expected.pop();
      assert.deepEqual(editor.buildMapJson()[library], expected);
      assert.deepEqual(M.validate(editor.buildMapJson()).errors, []);
    });
  }

  test(`${library}: restoring null and opening another map rebinds new routes`, () => {
    const {editor, click} = createEditor(library);
    const raw = M.create();
    raw[library] = null;
    editor.loadMap(raw);
    const emptySnapshot = editor.buildMapJson();
    click('editorAddRouteButton');
    const populatedSnapshot = editor.buildMapJson();
    assert.deepEqual(populatedSnapshot[library], [M.route()]);
    // Undo/redo restore snapshots via loadMap. Exercise the same load path
    // here, without claiming to test the editor-ui.js history stack itself.
    editor.loadMap(emptySnapshot);
    assert.equal(editor.buildMapJson()[library], null);
    click('editorAddRouteButton');
    assert.deepEqual(editor.buildMapJson()[library], [M.route()]);
    editor.loadMap(populatedSnapshot);
    assert.deepEqual(editor.buildMapJson()[library], [M.route()]);
    const previousDocument = editor.getState().document;
    const another = M.create();
    another.levelId = 'another-map';
    another[library] = null;
    editor.loadMap(another);
    click('editorAddRouteButton');
    assert.deepEqual(editor.buildMapJson()[library], [M.route()]);
    assert.equal(editor.buildMapJson().levelId, 'another-map');
    assert.deepEqual(M.clone(previousDocument[library]), populatedSnapshot[library]);
    assert.equal(another[library], null);
  });
}
