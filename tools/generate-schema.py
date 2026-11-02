from pathlib import Path
import json,re
ROOT=Path(__file__).resolve().parents[1]; WORK=ROOT.parent
dump=(WORK/'Arkntools/2.7.91 dump.cs').read_text(encoding='utf-8')
enums={}
for name in ['ActionType','RandomType','RefreshType','MotionMode','MotionMask','BuildableType','PlayerSideMask','CheckpointType','TileHeightType']:
 m=re.search(r'public enum (?:[\w.]+\.)?'+name+r'\s[^\n]*\n\{(.*?)\n\}',dump,re.S)
 if m: enums[name]={k:int(v) for k,v in re.findall(r'public const [\w.]+ (\w+) = (-?\d+);',m[1])}
tiles={}; keys={}; sources=[]; invalid=[]; template=None; enemy=None; action=None
paths=set()
for folder in [WORK/'Map_Tools/map_jsons',WORK/'Route_Calculator/dist/Map_Tools/map_jsons',WORK/'Route_Calculator_Test_Release/Map_Tools/map_jsons']:
 paths.update(folder.glob('*.json'))
for p in sorted(paths):
 try: d=json.loads(p.read_text(encoding='utf-8-sig'))
 except (ValueError,OSError): invalid.append(str(p.relative_to(WORK)));continue
 if 'mapData' not in d: continue
 sources.append(str(p.relative_to(WORK)))
 if template is None: template=d
 for t in d['mapData']['tiles']: tiles.setdefault(t['tileKey'],t)
 for e in d.get('enemyDbRefs') or []:
  if enemy is None: enemy=e
 containers=[f for w in d.get('waves') or [] for f in w.get('fragments') or []]+[p for b in (d.get('branches') or {}).values() for p in b.get('phases') or []]
 for f in containers:
  for a in f.get('actions') or []:
   if action is None: action=a
   if a.get('key'): keys.setdefault(a['actionType'],set()).add(a['key'])
# Retain the complete observed serialized key shape, reset all undefinable fields.
def reset(v):
 if isinstance(v,dict):
  if 'm_defined' in v:
   x=v['m_value'];return {'m_defined':False,'m_value':False if isinstance(x,bool) else 0 if isinstance(x,(int,float)) else 'WALK' if x=='WALK' else 'NORMAL' if x=='NORMAL' else 'NONE' if x=='NONE' else None}
  return {k:reset(x) for k,x in v.items()}
 return None
ref={'useDb':True,'id':'enemy_10001_trslim','level':0,'overwrittenData':reset(enemy['overwrittenData'])}
base={k:None for k in template};base.update(options=template['options'].copy(),levelId=None,mapId=None,bgmEvent=None,environmentSe=None,mapData={'map':[],'tiles':[],'blockEdges':None,'tags':None,'effects':None,'layerRects':None},tilesDisallowToLocate=[],runes=[],optionalRunes=None,globalBuffs=None,routes=[],extraRoutes=[],enemies=[],enemyDbRefs=[],waves=[],branches=None,predefines={k:[] for k in template['predefines']},hardPredefines={k:[] for k in template['hardPredefines']},excludeCharIdList=None,randomSeed=0,operaConfig=None,cameraPlugin='')
base['options'].update(characterLimit=8,maxLifePoint=3,initialCost=10)
a={k:v for k,v in action.items()};a.update(actionType='SPAWN',managedByScheduler=True,key='enemy_10001_trslim',count=1,preDelay=0,interval=1,routeIndex=0,blockFragment=False,autoPreviewRoute=True,autoDisplayEnemyInfo=False,isUnharmfulAndAlwaysCountAsKilled=False,hiddenGroup=None,randomSpawnGroupKey=None,randomSpawnGroupPackKey=None,randomType='ALWAYS',refreshType='ALWAYS',weight=0,dontBlockWave=False,forceBlockWaveInBranch=False)
result={'enums':enums,'tiles':tiles,'actionKeys':{k:sorted(v) for k,v in keys.items()},'base':base,'enemyReference':ref,'action':a,'sources':sources,'invalidSources':invalid}
(ROOT/'schema.js').write_text('(function(g){const schema='+json.dumps(result,ensure_ascii=False,separators=(',',':'))+';if(typeof module!=="undefined")module.exports=schema;else g.MapSchema=schema;})(globalThis);\n',encoding='utf-8')
print(json.dumps({'maps':len(sources),'invalid':invalid,'tiles':len(tiles),'keys':{k:len(v) for k,v in keys.items()},'enums':enums},ensure_ascii=False))
