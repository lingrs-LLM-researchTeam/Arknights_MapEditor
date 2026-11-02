const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const M=require('./map-model'),S=require('./schema');
let maps=0,legacy=0,skipped=[];
for(const relative of S.sources){
 const p=path.join(__dirname,'..',relative),raw=JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
 M.assertMap(raw);const out=M.exportMap(raw,M.cells(raw));const expected=M.clone(raw);
 if(expected.routeCalculatorTest)legacy++;
 const wasLegacy=!!expected.routeCalculatorTest;delete expected.routeCalculatorTest;if(wasLegacy&&Array.isArray(expected.optionalRunes)&&!expected.optionalRunes.length)expected.optionalRunes=null;
 for(const k of ['routes','extraRoutes'])for(const r of expected[k]||[]){delete r.editorId;delete r.visitEveryNodeStably;if(wasLegacy&&r.checkpoints)r.checkpoints=r.checkpoints.map(c=>({...M.checkpoint(c.type),...c}));}
 for(const {part}of M.parts(expected))for(const a of part.actions)delete a.editorEnemyId;
 assert.deepEqual(out,expected,relative);maps++;
}
const d=M.create();d.customFutureField={nested:[false,null,17]};
d.routes.push(M.route(),M.route());d.extraRoutes=[M.route()];
d.enemyDbRefs=[M.clone(S.enemyReference)];
d.waves=[M.wave(),M.wave()];d.waves[0].fragments.push(M.fragment());
d.waves[1].fragments[0].actions=[{...M.action(),routeIndex:2}];
d.branches={summon:{phases:[{preDelay:2,actions:[M.action(true)]},M.fragment()]}};
for(const type of Object.keys(S.enums.CheckpointType).filter(k=>k!=='INVALID'))d.routes[0].checkpoints.push({...M.checkpoint(type),reachOffset:{x:.25,y:-.25},position:{row:1,col:2}});
assert.deepEqual(M.validate(d).errors,[]);
assert.throws(()=>M.deleteRoute(d,'extraRoutes',0),/仍被/);
M.deleteRoute(d,'routes',1);assert.equal(d.waves[1].fragments[0].actions[0].routeIndex,1);assert.equal(d.branches.summon.phases[0].actions[0].routeIndex,0);
const grid=M.cells(d);const original=M.clone(d.mapData);grid[0][0]=M.tile('tile_road');grid[0][0].blackboard=[{key:'test_key',value:1,valueStr:null}];
const out=M.exportMap(d,grid);assert.deepEqual(out.customFutureField,d.customFutureField);assert.deepEqual(out.waves,d.waves);assert.deepEqual(out.branches,d.branches);assert.deepEqual(out.routes[0].checkpoints,d.routes[0].checkpoints);assert.deepEqual(d.mapData,original);assert.deepEqual(out.mapData.tiles.slice(1),original.tiles.slice(1));assert.equal(out.mapData.map.at(-1)[0],0);assert.equal(out.mapData.tiles.length,60);assert.equal(out.mapData.tiles[0].tileKey,"tile_road");
const shared=M.create();shared.mapData.map[0][0]=shared.mapData.map[0][1];const g=M.cells(shared);g.at(-1)[0]=M.tile('tile_start');const painted=M.exportMap(shared,g);assert.notEqual(painted.mapData.map[0][0],painted.mapData.map[0][1]);assert.equal(shared.mapData.tiles[shared.mapData.map[0][1]].tileKey,'tile_forbidden');
const bad=M.clone(d);bad.waves[0].fragments[0].actions=[{...M.action(),routeIndex:99}];assert.match(M.validate(bad).errors.join(),/routeIndex/);
const corrupt=M.create();corrupt.mapData.map[0][0]=-1;assert.throws(()=>M.assertMap(corrupt),/索引/);
const empty=M.create();empty.routes=[];empty.extraRoutes=null;empty.branches=null;M.assertMap(empty);assert.deepEqual(M.exportMap(empty,M.cells(empty)),empty);
for(const type of Object.keys(S.enums.ActionType).filter(k=>k!=='E_NUM')){const t=M.create();t.waves[0].fragments[0].actions=[{...M.action(),actionType:type}];assert.deepEqual(M.validate(t).errors,[],type);}
console.log(JSON.stringify({roundTripMaps:maps,legacyMapsCleaned:legacy,malformedSources:S.invalidSources.length,checks:'waves/branches/checkpoints/unknown fields/nulls/shared tile indices/route deletion/invalid references/all action enums passed'},null,2));
