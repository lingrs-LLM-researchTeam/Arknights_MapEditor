(function () {
  "use strict";

  const TileRenderer = window.MapTileRenderer;
  const Model = window.MapModel;
  const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "'":"&#39;"}[c]));
  const $ = id => document.getElementById(id);
  const TILE_DEFAULTS = {
    tile_road: ["LOWLAND", "MELEE", "ALL"],
    tile_floor: ["LOWLAND", "NONE", "ALL"],
    tile_wall: ["HIGHLAND", "RANGED", "FLY_ONLY"],
    tile_forbidden: ["HIGHLAND", "NONE", "FLY_ONLY"],
    tile_start: ["LOWLAND", "NONE", "ALL"],
    tile_end: ["LOWLAND", "NONE", "ALL"],
    tile_telin: ["LOWLAND", "NONE", "ALL"],
    tile_telout: ["LOWLAND", "NONE", "ALL"]
  };
  const e = {
    dialog: $("mapEditorDialog"),
    width: $("editorMapWidth"), height: $("editorMapHeight"), resize: $("editorResizeMapButton"), clear: $("editorClearMapButton"), fill: $("editorFillMapButton"),
    tileKey: $("editorTileKey"), heightType: $("editorHeightType"), buildableType: $("editorBuildableType"), passableMask: $("editorPassableMask"), playerSideMask: $("editorPlayerSideMask"),
    paintMode: $("editorPaintModeButton"), eraseMode: $("editorEraseModeButton"),
    routeSelect: $("editorRouteSelect"), addRoute: $("editorAddRouteButton"), deleteRoute: $("editorDeleteRouteButton"), routeMotion: $("editorRouteMotion"), allowDiagonal: $("editorAllowDiagonal"),
    waitSeconds: $("editorWaitSeconds"), addWait: $("editorAddWaitButton"), checkpointList: $("editorCheckpointList"),
    export: $("editorExportButton"),
    canvas: $("mapEditorCanvas"), tooltip: $("mapEditorTooltip"), status: $("editorStatus"),
    zoomOut: $("editorZoomOutButton"), fit: $("editorFitButton"), zoomIn: $("editorZoomInButton")
  };
  if (!e.dialog || !e.canvas) return;

  const ctx = e.canvas.getContext("2d");
  const state = {
    width: 10,
    height: 6,
    cells: [],
    paintMode: "PAINT",
    routeTool: null,
    routes: [],
    routeIndex: 0,
    view: null,
    dragging: false,
    mapView: { zoom: 1, panX: 0, panY: 0 }, mapPanning: null
  };

  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function integer(value, minimum, maximum, fallback) {
    return Math.min(maximum, Math.max(minimum, Math.round(finite(value, fallback))));
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function currentTile() {
    return {
      ...clone(state.brush || Model.tile(e.tileKey.value)),
      tileKey: e.tileKey.value,
      heightType: e.heightType.value,
      buildableType: e.buildableType.value,
      passableMask: e.passableMask.value,
      playerSideMask: e.playerSideMask.value
    };
  }

  function makeRoute() { return Model.route(); }

  function resetCells(width, height, preserve) {
    const previous = state.cells;
    const oldWidth = state.width, oldHeight = state.height;
    state.width = width;
    state.height = height;
    state.mapView = { zoom: 1, panX: 0, panY: 0 };
    state.cells = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => {
      return preserve && y < oldHeight && x < oldWidth && previous[y] ? previous[y][x] : null;
    }));
    for (const route of state.routes) {
      route.startPosition.row = Math.min(height - 1, Math.max(0, route.startPosition.row));
      route.startPosition.col = Math.min(width - 1, Math.max(0, route.startPosition.col));
      route.endPosition.row = Math.min(height - 1, Math.max(0, route.endPosition.row));
      route.endPosition.col = Math.min(width - 1, Math.max(0, route.endPosition.col));
      for (const checkpoint of route.checkpoints || []) {
        if (!checkpoint.position) continue;
        checkpoint.position.row = Math.min(height - 1, Math.max(0, checkpoint.position.row));
        checkpoint.position.col = Math.min(width - 1, Math.max(0, checkpoint.position.col));
      }
    }
    e.width.value = String(width);
    e.height.value = String(height);
    notifyChanged();
  }

  function activeRoute() {
    return state.routes[state.routeIndex];
  }

  function setTileDefaults() {
    const sample = window.MapSchema.tiles[e.tileKey.value];
    const defaults = sample ? [sample.heightType, sample.buildableType, sample.passableMask] : TILE_DEFAULTS[e.tileKey.value] || TILE_DEFAULTS.tile_forbidden;
    e.heightType.value = defaults[0];
    e.buildableType.value = defaults[1];
    e.passableMask.value = defaults[2];
  }

  function setPaintMode(mode) {
    state.paintMode = mode;
    state.routeTool = null;
    e.paintMode.classList.toggle("active", mode === "PAINT");
    e.eraseMode.classList.toggle("active", mode === "ERASE");
    document.querySelectorAll("[data-editor-tool]").forEach(button => button.classList.remove("active"));
    e.status.textContent = mode === "ERASE" ? "在画布上拖动可将地块恢复为空白。" : `正在绘制 ${e.tileKey.value}。`;
  }

  function setRouteTool(tool) {
    state.routeTool = tool;
    document.querySelectorAll("[data-editor-tool]").forEach(button => button.classList.toggle("active", button.dataset.editorTool === tool));
    e.paintMode.classList.remove("active");
    e.eraseMode.classList.remove("active");
    e.status.textContent = tool === "START" ? "点击地图设置当前路线的入侵坐标。" : tool === "END" ? "点击地图设置当前路线的目标坐标。" : "依次点击地图添加 MOVE 路径点。";
  }

  function renderRouteControls() {
    e.routeSelect.innerHTML = state.routes.map((route, index) => `<option value="${index}">路线 ${index} · ${escapeHtml(route.motionMode)}</option>`).join("");
    e.routeSelect.value = String(state.routeIndex);
    const route = activeRoute();
    if (!route) { e.checkpointList.textContent = "暂无路线，点击新增。"; return; }
    e.routeMotion.value = route.motionMode;
    e.allowDiagonal.checked = !!route.allowDiagonalMove;
    window.dispatchEvent(new Event("editor-route-selected"));
    renderCheckpoints();
  }

  function checkpointLabel(checkpoint, index) {
    return escapeHtml(`${index + 1}. ${checkpoint.type} · (${checkpoint.position?.col ?? 0}, ${checkpoint.position?.row ?? 0}) · ${checkpoint.time ?? 0}s`);
  }

  function renderCheckpoints() {
    const route = activeRoute();
    if (!route || !route.checkpoints?.length) {
      e.checkpointList.innerHTML = '<li class="empty-cell">尚无路径点或停驻点</li>';
      return;
    }
    e.checkpointList.innerHTML = route.checkpoints.map((checkpoint, index) => `<li>
      <span>${checkpointLabel(checkpoint, index)}</span>
      <span class="checkpoint-actions"><button type="button" data-checkpoint-action="EDIT" data-index="${index}">编辑</button>
        <button type="button" data-checkpoint-action="UP" data-index="${index}" ${index === 0 ? "disabled" : ""}>↑</button>
        <button type="button" data-checkpoint-action="DOWN" data-index="${index}" ${index === route.checkpoints.length - 1 ? "disabled" : ""}>↓</button>
        <button type="button" data-checkpoint-action="DELETE" data-index="${index}">删除</button>
      </span>
    </li>`).join("");
  }

  function buildMapJson() { return Model.exportMap(state.document, state.cells); }

  function notifyChanged() {
    window.dispatchEvent(new Event("editor-changed"));
    draw();
  }

  function resizeCanvas() {
    const rect = e.canvas.parentElement.getBoundingClientRect();
    const cssWidth = Math.max(1, rect.width || 1100);
    const cssHeight = Math.max(180, rect.height || Math.min(640, window.innerHeight * 0.62));
    const dpr = window.devicePixelRatio || 1;
    if (e.canvas.width !== Math.round(cssWidth * dpr) || e.canvas.height !== Math.round(cssHeight * dpr)) {
      e.canvas.width = Math.round(cssWidth * dpr);
      e.canvas.height = Math.round(cssHeight * dpr);
      e.canvas.style.width = `${cssWidth}px`;
      e.canvas.style.height = `${cssHeight}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pad = 56;
    const baseTileSize = Math.min((cssWidth - pad * 2) / state.width, (cssHeight - pad * 2) / state.height);
    const tileSize = baseTileSize * state.mapView.zoom;
    const mapWidth = tileSize * state.width, mapHeight = tileSize * state.height;
    state.view = {
      cssWidth, cssHeight, tileSize, baseTileSize,
      left: (cssWidth - mapWidth) / 2 + state.mapView.panX,
      top: (cssHeight - mapHeight) / 2 + state.mapView.panY,
      mapWidth, mapHeight
    };
    return state.view;
  }

  function resetMapView(redraw) {
    state.mapView = { zoom: 1, panX: 0, panY: 0 };
    if (redraw !== false) draw();
  }

  function setMapZoom(value, focusX, focusY) {
    if (!state.view) return;
    const current = state.view;
    const nextZoom = Math.min(5, Math.max(0.35, Number(value) || 1));
    if (Math.abs(nextZoom - state.mapView.zoom) < 1e-9) return;
    const x = Number.isFinite(focusX) ? focusX : current.cssWidth / 2;
    const y = Number.isFinite(focusY) ? focusY : current.cssHeight / 2;
    const mapX = (x - current.left) / current.tileSize;
    const mapY = (y - current.top) / current.tileSize;
    const nextTileSize = current.baseTileSize * nextZoom;
    state.mapView.zoom = nextZoom;
    state.mapView.panX = x - mapX * nextTileSize - (current.cssWidth - nextTileSize * state.width) / 2;
    state.mapView.panY = y - mapY * nextTileSize - (current.cssHeight - nextTileSize * state.height) / 2;
    draw();
  }

  function beginMapPan(event) {
    if (!(event.button === 1 || (event.button === 0 && event.shiftKey))) return false;
    event.preventDefault();
    state.dragging = false;
    state.mapPanning = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    e.canvas.classList.add("map-panning");
    e.canvas.setPointerCapture(event.pointerId);
    return true;
  }

  function continueMapPan(event) {
    const pan = state.mapPanning;
    if (!pan || pan.pointerId !== event.pointerId) return false;
    const dx = event.clientX - pan.x, dy = event.clientY - pan.y;
    if (dx || dy) {
      state.mapView.panX += dx; state.mapView.panY += dy;
      pan.x = event.clientX; pan.y = event.clientY;
      e.tooltip.hidden = true;
      draw();
    }
    return true;
  }

  function finishMapPan(event) {
    if (!state.mapPanning || (event && state.mapPanning.pointerId !== event.pointerId)) return;
    state.mapPanning = null;
    e.canvas.classList.remove("map-panning");
  }

  function screenPoint(position) {
    const v = state.view;
    return [v.left + (position[0] + 0.5) * v.tileSize, v.top + (state.height - position[1] - 0.5) * v.tileSize];
  }

  function drawGrid() {
    const v = state.view;
    for (let y = 0; y < state.height; y += 1) {
      for (let x = 0; x < state.width; x += 1) {
        const tile = state.cells[y][x];
        const sx = v.left + x * v.tileSize;
        const sy = v.top + (state.height - 1 - y) * v.tileSize;
        TileRenderer.drawTile(ctx, tile, sx, sy, v.tileSize);
        if (v.tileSize >= 34) {
          TileRenderer.drawTileCoordinate(ctx, `${x},${y}`, sx, sy, v.tileSize);
        }
      }
    }
  }

  function routeCoordinates(route) {
    const points = [[route.startPosition.col, route.startPosition.row]];
    for (const checkpoint of route.checkpoints || []) if (["MOVE", "PATROL_MOVE", "APPEAR_AT_POS", "MAP_OFFSET_MOVE",0,6,8,10].includes(checkpoint.type) && checkpoint.position) points.push([checkpoint.position.col, checkpoint.position.row]);
    points.push([route.endPosition.col, route.endPosition.row]);
    return points;
  }

  function drawRoutes() {
    state.routes.forEach((route, index) => {
      const points = routeCoordinates(route);
      ctx.save();
      ctx.strokeStyle = index === state.routeIndex ? "#69ccee" : "rgba(105,204,238,.28)";
      ctx.lineWidth = index === state.routeIndex ? 2.4 : 1.2;
      ctx.setLineDash(index === state.routeIndex ? [] : [5, 5]);
      ctx.beginPath();
      points.forEach((position, pointIndex) => {
        const point = screenPoint(position);
        if (!pointIndex) ctx.moveTo(point[0], point[1]); else ctx.lineTo(point[0], point[1]);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      points.forEach((position, pointIndex) => {
        const point = screenPoint(position);
        ctx.fillStyle = pointIndex === 0 ? "#56ddb1" : pointIndex === points.length - 1 ? "#ff6e83" : "#ffd166";
        ctx.beginPath();
        ctx.arc(point[0], point[1], pointIndex === 0 || pointIndex === points.length - 1 ? 7 : 5, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    });
  }

  function draw() {
    const view = resizeCanvas();
    ctx.clearRect(0, 0, view.cssWidth, view.cssHeight);
    ctx.fillStyle = "#10161c";
    ctx.fillRect(0, 0, view.cssWidth, view.cssHeight);
    drawGrid();
    drawRoutes();
  }

  function canvasTile(event) {
    const rect = e.canvas.getBoundingClientRect();
    const px = event.clientX - rect.left, py = event.clientY - rect.top;
    const x = Math.floor((px - state.view.left) / state.view.tileSize);
    const y = state.height - 1 - Math.floor((py - state.view.top) / state.view.tileSize);
    return x >= 0 && x < state.width && y >= 0 && y < state.height ? [x, y, px, py] : null;
  }

  function applyCanvasAction(event) {
    const picked = canvasTile(event);
    if (!picked) return;
    const [x, y] = picked;
    const route = activeRoute();
    if (state.routeTool && !route) return;
    if (state.routeTool === "START") {
      route.startPosition = { row: y, col: x };
      state.routeTool = null;
      document.querySelectorAll("[data-editor-tool]").forEach(button => button.classList.remove("active"));
      e.status.textContent = `路线 ${state.routeIndex} 入侵坐标已设为 (${x}, ${y})。`;
    } else if (state.routeTool === "END") {
      route.endPosition = { row: y, col: x };
      state.routeTool = null;
      document.querySelectorAll("[data-editor-tool]").forEach(button => button.classList.remove("active"));
      e.status.textContent = `路线 ${state.routeIndex} 目标坐标已设为 (${x}, ${y})。`;
    } else if (state.routeTool === "MOVE") {
      (route.checkpoints ??= []).push({
        type: "MOVE",
        time: 0,
        position: { row: y, col: x },
        reachOffset: { x: 0, y: 0 },
        randomizeReachOffset: false,
        reachDistance: 0
      });
      e.status.textContent = `已向路线 ${state.routeIndex} 添加 MOVE (${x}, ${y})。`;
      renderCheckpoints();
    } else {
      state.cells[y][x] = state.paintMode === "ERASE" || event.button === 2 ? null : currentTile();
    }
    notifyChanged();
  }

  function loadMap(raw) {
    Model.assertMap(raw);
    state.document = clone(raw);
    state.routes = state.document[$("routeLibrary").value || "routes"] || [];
    state.width = raw.mapData.map[0].length; state.height = raw.mapData.map.length;
    state.cells = Model.cells(raw);
    state.routeIndex = 0;
    e.width.value = state.width; e.height.value = state.height;
    state.mapView = {zoom:1,panX:0,panY:0};
    renderRouteControls(); notifyChanged();
  }

  e.tileKey.addEventListener("change", () => { setTileDefaults(); setPaintMode("PAINT"); });
  e.paintMode.addEventListener("click", () => setPaintMode("PAINT"));
  e.eraseMode.addEventListener("click", () => setPaintMode("ERASE"));
  e.resize.addEventListener("click", () => resetCells(integer(e.width.value, 1, 256, state.width), integer(e.height.value, 1, 256, state.height), true));
  e.clear.addEventListener("click", () => {
    if (!window.confirm("确认清空当前地图的全部地块？路线和敌人配置会保留。")) return;
    resetCells(state.width, state.height, false);
  });
  e.fill.addEventListener("click", () => {
    const tile = currentTile();
    state.cells = Array.from({ length: state.height }, () => Array.from({ length: state.width }, () => clone(tile)));
    notifyChanged();
  });
  document.querySelectorAll("[data-editor-tool]").forEach(button => button.addEventListener("click", () => setRouteTool(button.dataset.editorTool)));

  e.routeSelect.addEventListener("change", () => { state.routeIndex = integer(e.routeSelect.value, 0, state.routes.length - 1, 0); renderRouteControls(); draw(); });
  e.addRoute.addEventListener("click", () => {
    state.routes.push(makeRoute());
    state.routeIndex = state.routes.length - 1;
    renderRouteControls();
    notifyChanged();
  });
  e.deleteRoute.addEventListener("click", () => {
    if (!state.routes.length) return;
    try { Model.deleteRoute(state.document, $("routeLibrary").value, state.routeIndex); } catch(error) { e.status.textContent = error.message; return; }

    state.routeIndex = Math.max(0, Math.min(state.routeIndex, state.routes.length - 1));
    renderRouteControls();
    notifyChanged();
  });
  e.routeMotion.addEventListener("change", () => { if (!activeRoute()) return; activeRoute().motionMode = e.routeMotion.value; renderRouteControls(); notifyChanged(); });
  e.allowDiagonal.addEventListener("change", () => { if (!activeRoute()) return; activeRoute().allowDiagonalMove = e.allowDiagonal.checked; notifyChanged(); });
  e.addWait.addEventListener("click", () => {
    if (!activeRoute()) return;
    (activeRoute().checkpoints ??= []).push({...Model.checkpoint("WAIT_FOR_SECONDS"), time: Math.max(0, finite(e.waitSeconds.value, 0))});
    renderCheckpoints();
    notifyChanged();
  });
  e.checkpointList.addEventListener("click", event => {
    const button = event.target.closest("[data-checkpoint-action]");
    if (!button) return;
    const route = activeRoute(), index = integer(button.dataset.index, 0, route.checkpoints.length - 1, 0);
    if (button.dataset.checkpointAction === "EDIT") window.MapEditorUI.editCheckpoint(index);
    if (button.dataset.checkpointAction === "DELETE") route.checkpoints.splice(index, 1);
    if (button.dataset.checkpointAction === "UP" && index > 0) [route.checkpoints[index - 1], route.checkpoints[index]] = [route.checkpoints[index], route.checkpoints[index - 1]];
    if (button.dataset.checkpointAction === "DOWN" && index < route.checkpoints.length - 1) [route.checkpoints[index + 1], route.checkpoints[index]] = [route.checkpoints[index], route.checkpoints[index + 1]];
    renderCheckpoints();
    notifyChanged();
  });

  e.export.addEventListener("click", () => window.MapEditorUI.save());

  e.canvas.addEventListener("contextmenu", event => event.preventDefault());
  e.canvas.addEventListener("pointerdown", event => {
    if (event.altKey) { const p=canvasTile(event); if(p) {state.brush=clone(state.cells[p[1]][p[0]] || Model.tile()); e.tileKey.value=state.brush.tileKey; e.heightType.value=state.brush.heightType; e.buildableType.value=state.brush.buildableType; e.passableMask.value=state.brush.passableMask; e.playerSideMask.value=state.brush.playerSideMask; e.status.textContent="已拾取地块完整属性";} return; }
    if (beginMapPan(event)) return;
    state.dragging = true;
    e.canvas.setPointerCapture(event.pointerId);
    applyCanvasAction(event);
  });
  e.canvas.addEventListener("pointermove", event => {
    if (continueMapPan(event)) return;
    const picked = canvasTile(event);
    if (picked) {
      e.tooltip.hidden = false;
      e.tooltip.style.left = `${picked[2] + 14}px`;
      e.tooltip.style.top = `${picked[3] + 14}px`;
      const tile = state.cells[picked[1]][picked[0]];
      e.tooltip.textContent = `(${picked[0]}, ${picked[1]}) · ${tile ? tile.tileKey : "空白（导出时补 forbidden）"}`;
    } else {
      e.tooltip.hidden = true;
    }
    if (state.dragging && !state.routeTool && (event.buttons & 1 || event.buttons & 2)) applyCanvasAction(event);
  });
  e.canvas.addEventListener("pointerup", event => { finishMapPan(event); state.dragging = false; });
  e.canvas.addEventListener("pointercancel", event => { finishMapPan(event); state.dragging = false; });
  e.canvas.addEventListener("pointerleave", () => { e.tooltip.hidden = true; });
  e.canvas.addEventListener("wheel", event => {
    if (!state.view) return;
    event.preventDefault();
    const rect = e.canvas.getBoundingClientRect();
    setMapZoom(state.mapView.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12), event.clientX - rect.left, event.clientY - rect.top);
  }, { passive: false });
  e.zoomOut.addEventListener("click", () => setMapZoom(state.mapView.zoom / 1.2));
  e.zoomIn.addEventListener("click", () => setMapZoom(state.mapView.zoom * 1.2));
  e.fit.addEventListener("click", () => resetMapView());

  window.addEventListener("resize", () => { draw(); });

  window.MapEditor = {
    buildMapJson, loadMap, draw, notifyChanged, renderRouteControls, renderCheckpoints, activeRoute,
    getState: () => state
  };
  setTileDefaults();
  state.brush = Model.tile(e.tileKey.value);
  loadMap(Model.create());
})();
