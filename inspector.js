// Read-only views of the live document. Panel and search state stay outside the map JSON.
(function () {
  "use strict";

  const editor = window.MapEditor;
  const model = window.MapModel;
  const state = editor.getState();
  const $ = id => document.getElementById(id);
  const panelNames = {
    paint: "地图尺寸与绘制", routes: "路线与检查点", waves: "波次 / Branch / 动作",
    enemies: "敌人数据库引用", settings: "关卡设置", validation: "格式校验",
    export: "导出选项", canvas: "地图画布", legend: "画布图例", inspector: "地图检查器"
  };
  const defaults = Object.fromEntries(Object.keys(panelNames).map(key => [key, key !== "legend"]));
  const layoutKey = "arkmap.editor.panels.v1";
  const panels = {...defaults};
  try {
    const saved = JSON.parse(localStorage.getItem(layoutKey));
    for (const key of Object.keys(panels)) {
      if (typeof saved?.[key] === "boolean") panels[key] = saved[key];
    }
  } catch { /* The editor also works without browser storage. */ }

  const pageSize = 32;
  const views = {
    tiles: {query: "", filtered: false, filter: "", selection: null, page: 0},
    spawns: {query: "", filtered: false, filter: "", selection: null, page: 0},
    events: {query: "", filtered: false, filter: "", source: "", selection: null, page: 0}
  };
  let mode = "tiles";
  let matches = [];
  let scheduled = false;
  let currentDocument = state.document;
  const blankTile = model.tile();
  const tileAt = (x, y) => state.cells[y][x] || blankTile;
  const coordinate = (x, y) => `(${x}, ${y})`;
  const pointText = point => point ? coordinate(point.col, point.row) : "未设置";

  function element(tag, text, parent) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    parent.append(el);
    return el;
  }

  function applyLayout() {
    for (const el of document.querySelectorAll("[data-panel]")) el.hidden = !panels[el.dataset.panel];
    const sidebar = document.querySelector(".map-editor-controls");
    const workspace = document.querySelector(".map-workspace");
    sidebar.hidden = !sidebar.querySelector("[data-panel]:not([hidden])");
    workspace.hidden = !panels.canvas && !panels.inspector;
    document.querySelector(".map-editor-layout").classList.toggle("one-column", sidebar.hidden || workspace.hidden);
    $("emptyWorkspace").hidden = !(workspace.hidden && sidebar.hidden);
    for (const input of $("panelChoices").querySelectorAll("input")) input.checked = panels[input.value];
  }

  function changeLayout() {
    applyLayout();
    try { localStorage.setItem(layoutKey, JSON.stringify(panels)); } catch { /* Optional preference. */ }
    scheduleRefresh();
  }

  for (const [key, title] of Object.entries(panelNames)) {
    const label = element("label", undefined, $("panelChoices"));
    label.className = "check-field";
    const input = element("input", undefined, label);
    input.type = "checkbox";
    input.value = key;
    element("span", title, label);
    input.onchange = () => {
      panels[key] = input.checked;
      changeLayout();
    };
  }
  $("showWindowOptions").onclick = () => $("windowOptions").showModal();
  $("resetPanels").onclick = () => { Object.assign(panels, defaults); changeLayout(); };
  window.addEventListener("editor-panels-rendered", applyLayout);

  // JSON field names and values are searchable, including nested blackboards and unknown fields.
  function contains(value, query) {
    return JSON.stringify(value)?.toLowerCase().includes(query);
  }

  function tileResults(view) {
    const rows = [];
    const types = new Set();
    const query = view.query.trim().toLowerCase();
    const coord = /^\(?\s*(\d+)\s*[,，]\s*(\d+)\s*\)?$/.exec(query);
    for (let y = state.height - 1; y >= 0; y--) {
      for (let x = 0; x < state.width; x++) {
        const tile = tileAt(x, y);
        types.add(tile.tileKey);
        if (view.filtered && view.filter && tile.tileKey !== view.filter) continue;
        if (coord ? x !== Number(coord[1]) || y !== Number(coord[2]) : query && !contains(tile, query)) continue;
        rows.push({id: y * state.width + x, x, y, tile});
      }
    }
    return {rows, filters: [...types].sort().map(type => [type, type])};
  }

  function actionResults(view) {
    const rows = [];
    const types = new Set();
    const doc = state.document;
    const refs = MapEvents.references(doc);
    const query = view.query.trim().toLowerCase();
    const sources = [["waves", "主波次"], ["branch", "Branch"]];
    for (const location of model.parts(doc)) {
      location.part.actions.forEach((action, actionIndex) => {
        const type = MapEvents.enumName(action.actionType);
        if (mode === "spawns" && type !== "SPAWN") return;
        types.add(type);
        const source = location.branch ? "branch" : "waves";
        if (view.filtered && view.filter && view.filter !== (mode === "events" ? type : source)) return;
        if (view.filtered && view.source && view.source !== source) return;
        const event = MapEvents.resolve(doc, action, location.branch, refs);
        const id = `${location.path}.actions[${actionIndex}]`;
        if (query) {
          const points = event.targets.map(target => target.value.position);
          if (event.route) points.push(event.route.startPosition, ...(event.route.checkpoints || []).map(c => c.position), event.route.endPosition);
          const positions = points.filter(Boolean).map(pointText).join(" ").replace(/, /g, ",");
          if (!positions.includes(query.replace(/\s*[,，]\s*/g, ",")) && !contains([id, event, action], query)) return;
        }
        rows.push({id, action, actionIndex, location, event});
      });
    }
    const filters = mode === "events"
      ? [...types].map(type => [type, type + " · " + (Object.hasOwn(MapEvents.names, type) ? MapEvents.names[type] : "未知动作")])
      : sources;
    return {rows, filters};
  }

  function switchMode(next) {
    mode = next;
    const tiles = mode === "tiles";
    $("tileView").setAttribute("aria-pressed", String(tiles));
    $("spawnView").setAttribute("aria-pressed", String(mode === "spawns"));
    $("eventView").setAttribute("aria-pressed", String(mode === "events"));
    $("inspectSearch").placeholder = tiles ? "查找 (x, y)、地块或配置值" : mode === "events" ? "查找事件类型、key、目标或位置" : "查找敌人 key、路线、坐标或配置值";
    $("inspectSearch").value = views[mode].query;
    $("enableFilter").checked = views[mode].filtered;
    refresh();
  }

  function scheduleRefresh() {
    if (scheduled || !panels.inspector) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; refresh(); });
  }

  function refresh() {
    if (!panels.inspector) return;
    const view = views[mode];
    const {rows, filters} = mode === "tiles" ? tileResults(view) : actionResults(view);
    // Keep an active filter visible even after the last matching tile is erased.
    if (view.filter && !filters.some(([value]) => value === view.filter)) filters.push([view.filter, view.filter]);
    const filter = $("inspectFilter");
    filter.replaceChildren(new Option(mode === "tiles" ? "全部地块类型" : mode === "events" ? "全部动作类型" : "全部出场来源", ""));
    for (const [value, label] of filters) filter.add(new Option(label, value));
    filter.value = view.filter;
    filter.hidden = !view.filtered;
    $("eventSource").hidden = mode !== "events" || !view.filtered;
    $("eventSource").value = views.events.source;
    matches = rows;
    const index = matches.findIndex(row => row.id === view.selection);
    if (index === -1) {
      view.selection = matches[0]?.id ?? null;
      view.page = 0;
    } else {
      view.page = Math.floor(index / pageSize);
    }
    renderPage();
  }

  function renderPage() {
    const view = views[mode];
    const list = $("inspectList");
    list.replaceChildren();
    const start = view.page * pageSize;
    const pageRows = matches.slice(start, start + pageSize);
    const selected = pageRows.find(row => row.id === view.selection);
    for (const row of pageRows) {
      const item = element("button", undefined, list);
      item.className = "inspect-result";
      item.type = "button";
      item.setAttribute("aria-pressed", String(row === selected));
      if (mode === "tiles") {
        element("strong", coordinate(row.x, row.y), item);
        element("span", row.tile.tileKey, item);
      } else {
        element("strong", mode === "events" ? row.event.title : row.action.key || "未指定敌人", item);
        element("span", mode === "events" ? row.action.key || row.event.type : row.event.routePath, item);
        element("small", row.id, item);
      }
      item.onclick = () => {
        view.selection = row.id;
        if (mode === "tiles") editor.selectTile(row.x, row.y);
        for (const option of list.children) option.setAttribute("aria-pressed", String(option === item));
        renderDetail(row);
      };
    }
    const pages = Math.ceil(matches.length / pageSize);
    $("inspectCount").textContent = matches.length ? `${matches.length} 项 · ${view.page + 1} / ${pages}` : "0 项";
    $("inspectPrev").disabled = view.page === 0;
    $("inspectNext").disabled = view.page + 1 >= pages;
    if (mode === "tiles" && selected &&
        (state.selectedTile?.x !== selected.x || state.selectedTile?.y !== selected.y)) {
      editor.selectTile(selected.x, selected.y);
    }
    renderDetail(selected);
  }

  function changePage(delta) {
    const view = views[mode];
    const first = (view.page + delta) * pageSize;
    if (!matches[first]) return;
    view.page += delta;
    view.selection = matches[first].id;
    renderPage();
    $("inspectList").scrollTop = 0;
  }

  function properties(parent, object) {
    const list = element("dl", undefined, parent);
    list.className = "inspect-properties";
    for (const [key, value] of Object.entries(object)) {
      element("dt", key, list);
      const cell = element("dd", undefined, list);
      if (value === null || typeof value !== "object") {
        cell.textContent = value === "" ? '""' : String(value);
      } else if (!Array.isArray(value) && Object.keys(value).length === 2 && "row" in value && "col" in value) {
        cell.textContent = pointText(value);
      } else {
        const count = Object.keys(value).length;
        group(cell, Array.isArray(value) ? `数组 [${count}]` : `对象 {${count}}`, value);
      }
    }
  }

  function group(parent, title, value) {
    const box = element("details", undefined, parent);
    element("summary", title, box);
    box.ontoggle = () => {
      if (!box.open || box.childElementCount > 1) return;
      const block = element("pre", undefined, box);
      block.className = "inspect-json";
      element("code", JSON.stringify(value, null, 2), block);
    };
    return box;
  }

  function renderDetail(row) {
    const detail = $("inspectDetail");
    detail.replaceChildren();
    detail.scrollTop = 0;
    if (!row) {
      const emptySpawns = mode === "spawns" && !views.spawns.query && !views.spawns.filter;
      element("p", emptySpawns ? "暂无 SPAWN 出场动作。在波次或 Branch 中添加后可在此查看路线。" : "没有匹配项，请调整查找或过滤条件。", detail);
      return;
    }
    if (mode === "tiles") {
      element("h3", `${coordinate(row.x, row.y)} · ${row.tile.tileKey}`, detail);
      if (!state.cells[row.y][row.x]) element("p", "空白格按以下配置导出。", detail);
      properties(detail, row.tile);
      return;
    }
    const {action, event, location, actionIndex} = row;
    const {route, routePath} = event;
    element("h3", mode === "events" ? `${event.title} · ${event.type}` : `${action.key || "未指定敌人"} · ${routePath}`, detail);
    element("p", row.id, detail);
    const jump = element("button", "编辑此动作", detail);
    jump.type = "button";
    jump.onclick = () => {
      if (location.part.actions[actionIndex] !== action) { refresh(); return; }
      panels.waves = true;
      applyLayout();
      MapEditorUI.showAction({...location, actionIndex});
    };
    if (mode === "events") properties(detail, event.info);
    else element("p", `出场数量 ${action.count ?? "未设置"}`, detail);
    for (const note of event.notes) element("p", note, detail);
    if (route) {
      const steps = element("ol", undefined, detail);
      steps.className = "route-steps";
      element("li", `出生位置　${pointText(route.startPosition)}`, steps);
      for (const [i, checkpoint] of (route.checkpoints || []).entries()) {
        const type = Object.keys(MapSchema.enums.CheckpointType).find(key => MapSchema.enums.CheckpointType[key] === checkpoint.type) ?? checkpoint.type;
        // Wait checkpoints often serialize (0, 0) even though the enemy waits in place.
        const movesToCell = ["MOVE", "PATROL_MOVE", "APPEAR_AT_POS", "MAP_OFFSET_MOVE"].includes(type);
        const place = movesToCell && checkpoint.position ? "　" + pointText(checkpoint.position) : "";
        const time = type?.toString().startsWith("WAIT") ? ` · ${checkpoint.time ?? 0} s` : "";
        group(element("li", undefined, steps), `检查点 ${i + 1} · ${type}${place}${time}`, checkpoint);
      }
      element("li", `路径终点　${pointText(route.endPosition)}`, steps);
      const {startPosition, endPosition, checkpoints, ...options} = route;
      group(detail, "路线配置 · " + route.motionMode, options).open = true;
    }
    for (const target of event.targets) {
      const point = target.value.position;
      const title = [target.path, target.alias, target.description, point && pointText(point)].filter(Boolean).join(" · ");
      group(detail, title, target.value);
      if (Number.isInteger(point?.col) && Number.isInteger(point?.row) && point.col >= 0 && point.col < state.width && point.row >= 0 && point.row < state.height) {
        const button = element("button", "查看地块 " + pointText(point), detail);
        button.type = "button";
        button.onclick = () => { editor.selectTile(point.col, point.row); showTileInspector(true); };
      }
    }
    group(detail, "完整动作配置", action);
  }

  function showTileInspector(picked) {
    panels.inspector = true;
    applyLayout();
    const view = views.tiles;
    if (picked) {
      const {x, y} = state.selectedTile;
      const tile = tileAt(x, y);
      // A direct canvas pick must reveal the chosen cell even if the previous search excluded it.
      view.query = "";
      if (view.filtered && view.filter && view.filter !== tile.tileKey) view.filter = "";
      view.selection = y * state.width + x;
    }
    switchMode("tiles");
    $("inspectList").querySelector('[aria-pressed="true"]')?.scrollIntoView({block: "nearest"});
  }

  $("tileView").onclick = () => switchMode("tiles");
  $("eventView").onclick = () => switchMode("events");
  $("eventSource").onchange = () => { views.events.source = $("eventSource").value; refresh(); };
  window.addEventListener("editor-inspect-action", ({detail: action}) => {
    for (const {part, path} of model.parts(state.document)) {
      const index = part.actions.indexOf(action);
      if (index < 0) continue;
      panels.inspector = true;
      applyLayout();
      Object.assign(views.events, {query: "", filter: "", source: "", selection: `${path}.actions[${index}]`});
      switchMode("events");
      $("inspectList").querySelector('[aria-pressed="true"]')?.scrollIntoView({block: "nearest"});
      break;
    }
  });
  $("spawnView").onclick = () => switchMode("spawns");
  $("inspectSearch").oninput = () => { views[mode].query = $("inspectSearch").value; scheduleRefresh(); };
  $("enableFilter").onchange = () => { views[mode].filtered = $("enableFilter").checked; refresh(); };
  $("inspectFilter").onchange = () => { views[mode].filter = $("inspectFilter").value; refresh(); };
  $("inspectPrev").onclick = () => changePage(-1);
  $("inspectNext").onclick = () => changePage(1);
  window.addEventListener("editor-tile-picked", () => showTileInspector(true));
  window.addEventListener("editor-inspect-tiles", () => showTileInspector(false));
  window.addEventListener("editor-changed", () => {
    if (currentDocument !== state.document) {
      currentDocument = state.document;
      for (const view of Object.values(views)) view.selection = null;
    }
    scheduleRefresh();
  });
  applyLayout();
  switchMode(mode);
})();
