# 明日方舟独立地图编辑器

最开始做来搭测试自己的寻路计算器的算法有没有还原舟的 Bresenham 和 SPFA 算法的一个小工具，因为有人需要所以剥离了这部分实现，并让 CodeX 老师进行了一定修改让其功能没那么简陋。

>注意，此程序设计之初是用于重建官方地图或者自定义地图来完成对现在部署于 [寻路计算器](http://calc.arkplot.cn/#/route) 上的寻路系统的测试，反对利用此程序进行任何盈利、修改第三方程序、对游戏本体进行修改与注入的行为。

## 使用

- 新建或打开本地地图 JSON；
- 绘制地块，右键擦除，Alt+单击拾取地块完整属性；滚轮缩放，Shift+拖动或中键平移。“地块 JSON”可编辑 blackboard、effects 和特殊地块字段。
- 在 `routes` / `extraRoutes` 之间切换。可设置起终点、出生偏移及随机范围、运动方式、寻路标记，并新增、编辑、排序和删除全部有效检查点类型。
- 在“波次 / Branch / 动作”中管理 waves → fragments → actions，或启用 Branch 并管理 branches[key] → phases → actions。每层支持新增、复制、排序及删除；Branch 可重命名。动作可编辑完整 ActionType、key、数量、延迟、间隔、路线索引、调度标记、阻塞标记、隐藏组、随机组和权重等。
- Branch 默认使用 extraRoutes，主波次默认使用 routes；可添加 useExtraRoute。删除被 SPAWN / PREVIEW_CURSOR 使用的路线会被阻止；删除未使用路线会自动调整后续索引。
- enemyDbRefs 支持数据库代号、等级、m_defined 覆盖、完整属性、技能和 blackboard。相同 key 请共用一份引用；动作 key 根据类型提供本地样本建议，SPAWN 会提供内嵌敌人索引。支持直接输入其他有效 key，但此行为不为建议操作
- options、预设、runes、optionalRunes、globalBuffs 等请通过相应 JSON 编辑窗口自行添加

由于部分特殊装置、地块等内容未受支持，可能需要您在生成的json文件中手动修改并填入其 BlackBoard 值

## 格式与依据

以下是通用作战关卡JSON文件中载入的顶层字段结构

~~~text
LevelData
├─ options                  作战设置
├─ levelId                  关卡标识
├─ mapId                    地图／场景标识
├─ bgmEvent                 背景音乐事件
├─ environmentSe            环境
├─ mapData                  地图与地块配置
├─ tilesDisallowToLocate     额外禁止部署的位置
├─ runes[]                  关卡符文
├─ optionalRunes{}           可选符文组
├─ globalBuffs[]             全局效果配置
├─ routes[]                 主路线
├─ extraRoutes[]            附加路线
├─ enemies[]                疑似弃用字段？
├─ enemyDbRefs[]             敌人数据库引用与覆盖
├─ waves[]                  事件控制，支持除出怪调度外关卡内大多数事件的调度 //如您不知道非Enemy对应项在此项中应当填入什么，请尝试使用E_NUM或不要尝试将此项对应到非Enemy对象上
├─ branches{}               不受routes管理的分支
├─ predefines               预放置单位
├─ hardPredefines           未知
├─ excludeCharIdList[]      禁用角色列表
├─ randomSeed               随机种子，用于控制敌人的随机出生位置偏移
├─ operaConfig              演出／关卡脚本配置引用
├─ cameraPlugin             相机插件配置引用
└─ runtimeData              运行时附加数据，此项固定留空
~~~

## 构建与验证

### 模型测试

安装 Node.js 22 或 24 后，在仓库根目录执行（无需 `npm install`）：

~~~sh
node --test map-model.test.js
~~~

默认测试只依赖本仓库文件和 Node.js 内置模块，使用 `tests/fixtures/maps.js` 中手写的最小地图及模型工厂生成的数据，不需要上级目录中的地图样本。测试覆盖导出往返、旧编辑器字段清理、未知字段保留、地块索引、路线引用和枚举校验。CI 在 Ubuntu / Windows、Node.js 22 / 24 上运行同一命令。

这些测试验证编辑器数据模型的约定，不代表官方客户端行为、寻路算法或游戏兼容性验证。

如本地已有 `schema.sources` 记录的完整样本目录，可额外运行原有的外部样本往返检查：

~~~sh
node tools/check-external-maps.js /path/to/sample-root
~~~

`sample-root` 应包含 `Map_Tools`、`Route_Calculator` 等目录；Windows 可传入带引号的本地路径。该检查不会下载样本，缺失文件或断言失败会以非零状态退出，不属于默认测试或 CI。`schema.invalidSources` 仅是 schema 生成时的记录，不作为测试通过数量。

### Windows 桌面构建

通过以下命令执行构建：

~~~powershell
powershell -ExecutionPolicy Bypass -File .\build-exe.ps1
~~~

## 使用许可

本程序采用 [AGPL-v3](LICENSE) 协议开源。有关详细信息，请阅读 LICENSE
