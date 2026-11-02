(function () {
  "use strict";

  function normalized(value, fallback) {
    const text = String(value == null ? fallback : value).trim();
    return text || fallback;
  }

  function tileKey(tile) {
    return normalized(tile && tile.tileKey, "tile_empty");
  }

  function proceduralStyle(tile) {
    const key = tileKey(tile);
    if (key === "tile_start") return ["#9a4337", "#ff8b6d"];
    if (key === "tile_flystart") return ["#205a70", "#63d2ff"];
    if (key === "tile_end") return ["#276443", "#6ee7a2"];
    if (key === "tile_hole" || key === "tile_box") return ["#59451f", "#d2a44f"];
    const height = normalized(tile && tile.heightType, "LOWLAND").toUpperCase();
    const passable = normalized(tile && tile.passableMask, "ALL").toUpperCase();
    if (height === "HIGHLAND") return ["#46505d", "#758394"];
    if (passable !== "ALL") return ["#222a33", "#4b5868"];
    return ["#29493d", "#3b6756"];
  }

  function drawTile(ctx, tile, x, y, size) {
    const [fill, edge] = proceduralStyle(tile);
    ctx.fillStyle = fill;
    ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 1.5, y + 1.5, size - 3, size - 3);
    return false;
  }

  function drawTileCoordinate(ctx, text, x, y, size) {
    if (size < 34) return;
    ctx.save();
    ctx.font = `${Math.max(9, size * 0.16)}px ui-monospace, monospace`;
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,.55)";
    ctx.fillText(String(text), x + 4, y + size - 5);
    ctx.restore();
  }

  window.MapTileRenderer = { drawTile, drawTileCoordinate };
})();
