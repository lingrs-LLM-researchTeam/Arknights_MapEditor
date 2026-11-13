'use strict';

// Handwritten editor-model fixtures. These are not game/client samples and do
// not depend on the model factories, schema.sources, or files outside this repo.
function syntheticMap() {
  return {
    levelId: 'synthetic-model-test',
    customFutureField: {nested: [false, null, 17]},
    optionalRunes: null,
    mapData: {
      map: [[0, 1], [2, 0]],
      tiles: [
        {tileKey: 'tile_road', blackboard: null, effects: null},
        {tileKey: 'tile_wall', blackboard: [{key: 'test_key', value: 1, valueStr: null}], effects: []},
        {tileKey: 'tile_start', customTileField: {enabled: false}},
        {tileKey: 'unused_test_tile', customTileField: null},
      ],
      blockEdges: null,
      customMapField: {values: []},
    },
    routes: [{
      motionMode: 'WALK',
      startPosition: {row: 0, col: 0},
      endPosition: {row: 1, col: 1},
      checkpoints: [{type: 'MOVE', position: {row: 1, col: 0}, customCheckpointField: null}],
      customRouteField: false,
    }],
    extraRoutes: [{
      motionMode: 1,
      startPosition: {row: 1, col: 0},
      endPosition: {row: 0, col: 1},
      checkpoints: [],
    }],
    enemyDbRefs: [{id: 'synthetic_enemy', useDb: false, customEnemyField: {values: [0]}}],
    waves: [{
      preDelay: 0,
      postDelay: 0,
      maxTimeWaitingForNextWave: -1,
      fragments: [{preDelay: 0, actions: [{
        actionType: 'SPAWN', key: 'synthetic_enemy', routeIndex: 0,
        preDelay: 0, interval: 1, count: 1, customActionField: null,
      }]}],
    }],
    branches: {
      synthetic_branch: {phases: [{preDelay: 0, actions: [{
        actionType: 1, key: 'synthetic_cursor', routeIndex: 0,
        preDelay: 0, interval: 1, count: 1, customActionField: false,
      }]}]},
    },
  };
}

module.exports = {syntheticMap};
