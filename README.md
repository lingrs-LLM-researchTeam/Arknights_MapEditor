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

通过以下命令执行构建：

~~~powershell
powershell -ExecutionPolicy Bypass -File .\build-exe.ps1
~~~

## 使用许可

本程序采用 [AGPL-v3](LICENSE) 协议开源。有关详细信息，请阅读 LICENSE
