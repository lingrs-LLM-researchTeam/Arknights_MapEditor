(function(){
'use strict';
const $=id=>document.getElementById(id), E=window.MapEditor, M=window.MapModel, S=window.MapSchema;
const st=E.getState(); let scope='MAIN',wi=0,fi=0,ai=0,ei=0,ci=0,dirty=false,restoring=false;
let history=[],future=[],last='',jsonApply=null;
const doc=()=>st.document;
function node(tag,text,parent){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(parent)parent.append(el);return el;}
function button(parent,label,fn){const b=node('button',label,parent);b.type='button';b.addEventListener('click',()=>safe(fn));return b;}
function safe(fn){try{return fn();}catch(e){$('editorStatus').textContent=e.message;console.error(e);}}
function modified(){E.notifyChanged();E.renderCheckpoints();}
function opt(select,value,label){const o=node('option',label,select);o.value=value;}
function enums(name){return Object.keys(S.enums[name]||{}).filter(x=>x!=='E_NUM'&&x!=='INVALID');}
function field(parent,obj,key,choices){
 const label=node('label',undefined,parent);label.className='field';node('span',key,label);
 const value=obj[key];let input;
 if(choices){input=node('select',undefined,label);const values=choices.slice();if(!values.some(v=>String(v)===String(value)))values.push(value);values.forEach(v=>opt(input,v,String(v)));input.value=value;}
 else {input=node('input',undefined,label);input.type=typeof value==='boolean'?'checkbox':typeof value==='number'?'number':'text';if(input.type==='number')input.step='any';if(input.type==='checkbox')input.checked=value;else input.value=value??'';}
 if (input.type === 'checkbox') {
   label.classList.add('boolean-field');
   label.prepend(input);
 }
 input.dataset.field=key;
 input.addEventListener('change',()=>safe(()=>{let v=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;
  if(input.type==='number'&&(input.value===''||!Number.isFinite(v)))throw Error(key+' 需要有效数字');
  // Preserve numeric enum serialization when the source uses it.
  if(choices&&typeof value==='number'&&/^[-\d]+$/.test(v))v=Number(v);
  obj[key]=v===''&&value===null?null:v;modified();
 }));return input;
}
function fields(parent,obj,choiceMap={},exclude=[]){const grid=node('div',undefined,parent);grid.className='schema-fields';for(const [k,v] of Object.entries(obj||{})){if(exclude.includes(k)||typeof v==='object'&&v!==null)continue;field(grid,obj,k,choiceMap[k]);}return grid;}
function jsonEditor(title,value,apply){$('jsonTitle').textContent=title;$('jsonText').value=JSON.stringify(value,null,2);$('jsonError').textContent='';jsonApply=apply;$('jsonDialog').showModal();}
$('applyJson').onclick=()=>{try{const v=JSON.parse($('jsonText').value);jsonApply(v);$('jsonDialog').close();modified();render();}catch(e){$('jsonError').textContent=e.message;}};
$('cancelJson').onclick=()=>$('jsonDialog').close();
function section(parent,title,panel){const d=node('details',undefined,parent);d.dataset.panel=panel;d.open=true;node('summary',title,d);const b=node('div',undefined,d);b.className='detail-body editor-section';return b;}
function selectList(parent,title,items,index,change){const l=node('label',undefined,parent);l.className='field';node('span',title,l);const s=node('select',undefined,l);items.forEach((t,i)=>opt(s,i,t));s.value=index;s.onchange=()=>{change(Number(s.value));render();};return s;}
function tools(parent,items,index,setIndex,factory){const row=node('div',undefined,parent);row.className='editor-button-row';
 button(row,'新增',()=>{items.push(factory());setIndex(items.length-1);modified();render();});
 button(row,'复制',()=>{if(!items[index])return;items.splice(index+1,0,M.clone(items[index]));setIndex(index+1);modified();render();});
 for(const [text,delta] of [['↑',-1],['↓',1]])button(row,text,()=>{const to=index+delta;if(to<0||to>=items.length)return;[items[index],items[to]]=[items[to],items[index]];setIndex(to);modified();render();});
 button(row,'删除',()=>{if(!items[index]||!confirm('删除当前项及其内容？'))return;items.splice(index,1);setIndex(Math.max(0,index-1));modified();render();});
}
function renderSchedule(parent){
 const b=section(parent,'波次 / Branch / 动作','waves');
 const row=node('div',undefined,b);row.className='editor-button-row';
 const enable=node('label',undefined,row);const check=node('input',undefined,enable);check.type='checkbox';check.checked=doc().branches!==null;node('span','启用 Branch',enable);
 check.onchange=()=>{if(!check.checked&&Object.keys(doc().branches||{}).length&&!confirm('禁用 Branch 会删除全部分支；可用撤销恢复。')){check.checked=true;return;}doc().branches=check.checked?{}:null;scope='MAIN';modified();render();};
 button(row,'新增 Branch',()=>{const k=prompt('Branch key（由关卡机制或演出脚本触发）','branch_1');if(!k)return;if(k==='MAIN'||Object.hasOwn(doc().branches||{},k))throw Error('Branch key 重复或保留');doc().branches??={};Object.defineProperty(doc().branches,k,{value:{phases:[M.fragment()]},enumerable:true,writable:true,configurable:true});scope=k;fi=ai=0;modified();render();});
 const sel=node('select',undefined,b);opt(sel,'MAIN','主 waves');Object.keys(doc().branches||{}).forEach(k=>opt(sel,k,'Branch · '+k));if(scope!=='MAIN'&&!Object.hasOwn(doc().branches||{},scope))scope='MAIN';sel.value=scope;sel.onchange=()=>{scope=sel.value;wi=fi=ai=0;render();};
 let fragments;
 if(scope==='MAIN'){
  doc().waves??=[];wi=Math.min(wi,Math.max(0,doc().waves.length-1));
  selectList(b,'Wave',doc().waves.map((w,i)=>`Wave ${i} · ${w.fragments.length} fragments`),wi,v=>{wi=v;fi=ai=0;});
  tools(b,doc().waves,wi,v=>{wi=v;fi=ai=0;},M.wave);
  const w=doc().waves[wi];if(!w)return;
  fields(b,w,{},['fragments']);fragments=w.fragments;
 }else{
  const row=node('div',undefined,b);row.className='editor-button-row';
  button(row,'重命名 Branch',()=>{const k=prompt('新的 Branch key',scope);if(!k||k===scope)return;if(k==='MAIN'||Object.hasOwn(doc().branches,k))throw Error('Branch key 已存在或保留');Object.defineProperty(doc().branches,k,{value:doc().branches[scope],enumerable:true,writable:true,configurable:true});delete doc().branches[scope];scope=k;modified();render();});
  button(row,'删除 Branch',()=>{if(!confirm('删除 Branch '+scope+'？'))return;delete doc().branches[scope];scope='MAIN';fi=ai=0;modified();render();});
  node('p','Branch 使用 extraRoutes，由关卡机制或演出脚本按 key 触发。',b).className='muted';
  fragments=doc().branches[scope].phases;
 }
 fi=Math.min(fi,Math.max(0,fragments.length-1));
 selectList(b,scope==='MAIN'?'Fragment':'Phase',fragments.map((f,i)=>`${i} · ${f.actions.length} actions`),fi,v=>{fi=v;ai=0;});
 tools(b,fragments,fi,v=>{fi=v;ai=0;},M.fragment);
 const f=fragments[fi];if(!f)return;fields(b,f,{},['actions']);
 ai=Math.min(ai,Math.max(0,f.actions.length-1));
 selectList(b,'Action',f.actions.map((a,i)=>`${i} · ${a.actionType} · ${a.key??''}`),ai,v=>{ai=v;});
 tools(b,f.actions,ai,v=>{ai=v;},()=>M.action(scope!=='MAIN'));
 const a=f.actions[ai];if(!a)return;
 const actionChoices={actionType:enums('ActionType'),randomType:enums('RandomType'),refreshType:enums('RefreshType')};
 const grid=fields(b,a,actionChoices);
 const keyInput=grid.querySelector('[data-field="key"]');
 function keyHints() {
  const dl = $('actionKeys');
  dl.replaceChildren();
  const type = MapEvents.enumName(a.actionType);
  const keys = new Set(S.actionKeys[type] || []);
  for (const {part} of M.parts(doc())) {
   for (const other of part.actions) {
    if (MapEvents.enumName(other.actionType) === type && other.key) keys.add(other.key);
   }
  }
  const refs = MapEvents.references(doc());
  if (['SPAWN', 'DISPLAY_ENEMY_INFO', 'PREVIEW_CURSOR'].includes(type)) {
   for (const key of refs.enemies.keys()) keys.add(key);
  }
  if (['ACTIVATE_PREDEFINED', 'WITHDRAW_PREDEFINED', 'TRIGGER_PREDEFINED'].includes(type)) {
   for (const slot of refs.predefines) {
    if (slot.alias && (type === 'ACTIVATE_PREDEFINED' || !slot.card)) keys.add(slot.alias);
   }
  }
  for (const key of keys) opt(dl, key, key);
 }
 if(keyInput)keyInput.setAttribute('list','actionKeys');keyHints();grid.querySelector('[data-field="actionType"]')?.addEventListener('change',keyHints);
 if(!Object.hasOwn(a,'useExtraRoute'))button(b,'添加 useExtraRoute（新版字段）',()=>{a.useExtraRoute=false;modified();render();});
 button(b,'查看事件对应',()=>window.dispatchEvent(new CustomEvent('editor-inspect-action',{detail:a})));
 button(b,'编辑动作完整 JSON',()=>jsonEditor('Action（保留扩展字段）',a,v=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Action 必须为对象');const test=M.clone(doc());const source=scope==='MAIN'?test.waves[wi].fragments[fi]:test.branches[scope].phases[fi];source.actions[ai]=v;M.assertMap(test);f.actions[ai]=v;}));
}
function renderEnemies(parent){
 const hints=$('enemyKeys');hints.replaceChildren();new Set([...(S.actionKeys.SPAWN||[]),...(doc().enemyDbRefs||[]).map(r=>r.id)]).forEach(k=>opt(hints,k,k));
 const b=section(parent,'敌人数据库引用 enemyDbRefs','enemies');const refs=doc().enemyDbRefs??=[];ei=Math.min(ei,Math.max(0,refs.length-1));
 selectList(b,'敌人',refs.map((r,i)=>`${i} · ${r.id} · Lv${r.level}`),ei,v=>ei=v);
 tools(b,refs,ei,v=>ei=v,()=>M.clone(S.enemyReference));
 const r=refs[ei];if(!r)return;const grid=fields(b,r,{},['overwrittenData']);grid.querySelector('[data-field="id"]')?.setAttribute('list','enemyKeys');
 function override(parent,obj,key){const v=obj[key];if(!v||!Object.hasOwn(v,'m_defined'))return;const box=node('details',undefined,parent);node('summary',key,box);fields(box,v);if(typeof v.m_value==='object'&&v.m_value!==null)button(box,'编辑 m_value',()=>jsonEditor(key,v.m_value,x=>v.m_value=x));}
 for(const k of ['name','prefabKey','motion','lifePointReduce','notCountInTotal'])override(b,r.overwrittenData||{},k);
 override(b,r.overwrittenData?.attributes||{},'moveSpeed');
 button(b,'编辑完整属性 / 技能 / blackboard',()=>jsonEditor('enemyDbRefs：m_defined 为 true 才覆盖数据库值',r,v=>{if(!v||typeof v.id!=='string')throw Error('需要敌人 id');refs[ei]=v;}));
}
function renderRoutes(){
 const b=$('routeFields');b.replaceChildren();const r=E.activeRoute();if(!r){$('checkpointFields').replaceChildren();return;}
 const lib=$('routeLibrary').value;
 for(const k of ['startPosition','endPosition','spawnOffset','spawnRandomRange']){node('h3',k,b);fields(b,r[k]);}
 fields(b,r,{},['motionMode','allowDiagonalMove','checkpoints','editorId']);
 button(b,'编辑路线完整 JSON',()=>jsonEditor(lib+'['+st.routeIndex+']',r,v=>{const test=M.clone(doc());test[lib][st.routeIndex]=v;M.assertMap(test);st.routes[st.routeIndex]=v;E.renderRouteControls();}));
 renderCheckpoint();
}
function renderCheckpoint(){
 const b=$('checkpointFields');b.replaceChildren();const r=E.activeRoute();if(!r)return;
 const row=node('div',undefined,b);row.className='editor-button-row';const s=node('select',undefined,row);enums('CheckpointType').forEach(t=>opt(s,t,t));
 button(row,'添加检查点',()=>{(r.checkpoints??=[]).push(M.checkpoint(s.value));ci=r.checkpoints.length-1;modified();E.renderCheckpoints();renderCheckpoint();});
 if(!r.checkpoints?.length)return;ci=Math.min(ci,r.checkpoints.length-1);
 selectList(b,'编辑检查点',r.checkpoints.map((c,i)=>`${i} · ${c.type}`),ci,v=>{ci=v;});
 const c=r.checkpoints[ci];fields(b,c,{type:enums('CheckpointType')});for(const k of ['position','reachOffset'])if(c[k]){node('h3',k,b);fields(b,c[k]);}
}
function render(){
 const parent=$('documentControls');parent.replaceChildren();renderSchedule(parent);renderEnemies(parent);
 const meta=section(parent,'关卡设置与扩展字段','settings');const metaGrid=node('div',undefined,meta);metaGrid.className='schema-fields';for(const key of ['levelId','mapId','bgmEvent','environmentSe','operaConfig','cameraPlugin','randomSeed'])field(metaGrid,doc(),key);
 button(meta,'编辑 options',()=>jsonEditor('关卡 options',doc().options,v=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('options 必须为对象');doc().options=v;}));
 for(const k of ['runes','optionalRunes','globalBuffs','predefines','hardPredefines','tilesDisallowToLocate','excludeCharIdList'])button(meta,'编辑 '+k,()=>jsonEditor(k,doc()[k],v=>doc()[k]=v));
 button(meta,'编辑完整地图 JSON',()=>jsonEditor('地图完整 JSON',E.buildMapJson(),v=>E.loadMap(v)));
 const val=section(parent,'格式校验','validation');button(val,'校验当前地图',()=>{const result=M.validate(E.buildMapJson());$('validation').textContent=[...result.errors.map(x=>'错误：'+x),...result.warnings.map(x=>'提示：'+x)].join('\n')||'结构与引用校验通过';});node('pre','尚未校验',val).id='validation';
 renderRoutes();E.draw();
 window.dispatchEvent(new Event("editor-panels-rendered"));
}
function snapshot(){return JSON.stringify(E.buildMapJson());}
function noteChange(){
 if(restoring)return;const now=snapshot();if(now===last)return;if(last){history.push(last);if(history.length>60)history.shift();}last=now;future=[];dirty=true;
 if(window.ipc)window.ipc.postMessage('DIRTY');
 document.title='* 明日方舟地图编辑器';
}
function restore(value){restoring=true;try{E.loadMap(JSON.parse(value));last=value;render();}finally{restoring=false;}dirty=true;window.ipc?.postMessage('DIRTY');}
function undo(){if(!history.length)return;future.push(last);restore(history.pop());}
function redo(){if(!future.length)return;history.push(last);restore(future.pop());}
function load(raw,name){M.assertMap(raw);E.loadMap(raw);scope='MAIN';wi=fi=ai=ei=ci=0;if(name)$('editorExportName').value=name;render();history=[];future=[];last=snapshot();saved();$('editorStatus').textContent='已打开 '+(name||'地图');}
function saved(){dirty=false;document.title='明日方舟地图编辑器';window.ipc?.postMessage('CLEAN');}
function save(){
 const raw=E.buildMapJson(),v=M.validate(raw);if(v.errors.length){$('editorStatus').textContent='无法导出：'+v.errors.slice(0,3).join('；');$('validation').textContent=v.errors.join('\n');return;}
 const name=($('editorExportName').value.trim()||'level_custom.json').replace(/[\\/:*?"<>|]/g,'_').replace(/\.json$/i,'')+'.json';
 const text=JSON.stringify(raw,null,2)+'\n';
 if(window.ipc){window.ipc.postMessage(JSON.stringify({type:'save',name,text}));return;}
 const url=URL.createObjectURL(new Blob([text],{type:'application/json;charset=utf-8'}));const a=node('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);saved();$('editorStatus').textContent='已下载 '+name;
}
function showAction(location) {
 scope = location.branch ? location.branchKey : 'MAIN';
 wi = location.waveIndex ?? 0;
 fi = location.fragmentIndex;
 ai = location.actionIndex;
 render();
 const panel = document.querySelector('[data-panel="waves"]');
 panel.open = true;
 panel.querySelector('[data-field="actionType"]')?.scrollIntoView({block:'center'});
}
window.MapEditorUI={save,load,showAction,editCheckpoint(index){ci=index;renderCheckpoint();},nativeSaved(path){saved();$('editorStatus').textContent='已保存 '+path;},nativeError(message){$('editorStatus').textContent=message;},isDirty:()=>dirty};
$('saveMap').onclick=()=>safe(save);$('openMap').onclick=()=>{if(dirty&&!confirm('放弃尚未保存的修改并打开另一张地图？'))return;if(window.ipc)window.ipc.postMessage('OPEN');else $('mapFile').click();};
$('mapFile').onchange=async()=>{const file=$('mapFile').files[0];if(file)try{load(JSON.parse((await file.text()).replace(/^\uFEFF/,'')),file.name);}catch(e){$('editorStatus').textContent='打开失败：'+e.message;}$('mapFile').value='';};
$('newMap').onclick=()=>{if(dirty&&!confirm('放弃尚未保存的修改并新建地图？'))return;load(M.create(),'level_custom.json');};
$('routeLibrary').onchange=()=>{st.routes=doc()[$('routeLibrary').value]??=([]);st.routeIndex=0;E.renderRouteControls();renderRoutes();E.draw();};
window.addEventListener('editor-route-selected',renderRoutes);window.addEventListener('editor-changed',()=>{noteChange();});
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
window.addEventListener('keydown',event=>{if(event.ctrlKey&&event.key.toLowerCase()==='s'){event.preventDefault();safe(save);}if(event.ctrlKey&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){if(event.key.toLowerCase()==='z'){event.preventDefault();event.shiftKey?redo():undo();}if(event.key.toLowerCase()==='y'){event.preventDefault();redo();}}});
const head=document.querySelector('.map-editor-header .editor-button-row');button(head,'撤销',undo);button(head,'重做',redo);
for(const [id,values] of [['editorRouteMotion',enums('MotionMode')],['editorBuildableType',enums('BuildableType')],['editorPassableMask',enums('MotionMask')],['editorPlayerSideMask',enums('PlayerSideMask')]]){const sel=$(id),value=sel.value;sel.replaceChildren();values.forEach(v=>opt(sel,v,v));sel.value=value;}
$('tileKeys').replaceChildren();Object.keys(S.tiles).forEach(k=>opt($('tileKeys'),k,k));
for(const [id,values] of [['actionKeys',[]],['enemyKeys',[]]]){const dl=node('datalist',undefined,document.body);dl.id=id;values.forEach(v=>opt(dl,v,v));}
const tilePanel=$('editorPaintModeButton').parentElement;
button(tilePanel,'地块 JSON',()=>jsonEditor('当前笔刷（完整地块 / blackboard）',st.brush||M.tile($('editorTileKey').value),v=>{if(!v||typeof v.tileKey!=='string')throw Error('缺少 tileKey');st.brush=v;$('editorTileKey').value=v.tileKey;for(const [id,k] of [['editorHeightType','heightType'],['editorBuildableType','buildableType'],['editorPassableMask','passableMask'],['editorPlayerSideMask','playerSideMask']])$(id).value=v[k];}));
$('editorTileKey').addEventListener('change',()=>{st.brush=M.tile($('editorTileKey').value);});
last=snapshot();render();
})();
