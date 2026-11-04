// Interpret LevelData actions against this map. External resource keys are kept verbatim.
(function () {
  "use strict";

  const names = {
    SPAWN: "敌人出场", PREVIEW_CURSOR: "路线预览标记", STORY: "剧情", TUTORIAL: "教学剧情",
    PLAY_BGM: "切换音乐", DISPLAY_ENEMY_INFO: "显示敌人资料", ACTIVATE_PREDEFINED: "激活预设",
    PLAY_OPERA: "关卡演出", TRIGGER_PREDEFINED: "触发预设能力", BATTLE_EVENTS: "游戏模式事件",
    WITHDRAW_PREDEFINED: "撤退预设", DIALOG: "战斗对话", SHOW_ALL_HIDDEN_CARDS: "显示隐藏卡牌",
    EMPTY: "空动作"
  };
  const modeEvents = new Map([
    ["LegionDrawNextCard", "保全派驻 · 抽取下一张卡牌"],
    ["LegionStartRedrawCard", "保全派驻 · 开始重新抽卡"],
    ["WaitBase", "生息演算 · 等待基地放置"]
  ]);
  const enumName = value => typeof value === "number"
    ? Object.keys(MapSchema.enums.ActionType).find(key => MapSchema.enums.ActionType[key] === value) ?? String(value)
    : String(value);

  function references(doc) {
    const predefines = [];
    for (const library of ["predefines", "hardPredefines"]) {
      for (const list of ["characterInsts", "tokenInsts", "characterCards", "tokenCards"]) {
        const slots = doc[library]?.[list];
        if (!Array.isArray(slots)) continue;
        slots.forEach((value, index) => {
          if (!value) return;
          predefines.push({
            path: `${library}.${list}[${index}]`, value, card: list.endsWith("Cards"),
            alias: value.alias || value.inst?.characterKey
          });
        });
      }
    }
    const enemies = new Map();
    (doc.enemyDbRefs || []).forEach((value, index) => {
      if (!enemies.has(value.id)) enemies.set(value.id, []);
      enemies.get(value.id).push({path: `enemyDbRefs[${index}]`, value});
    });
    return {predefines, enemies};
  }

  function resolve(doc, action, branch, refs) {
    const type = enumName(action.actionType);
    const key = action.key ?? "";
    const event = {type, title: Object.hasOwn(names, type) ? names[type] : "未知动作", info: {}, targets: [], notes: []};
    const {info, targets, notes} = event;
    switch (type) {
      case "SPAWN":
      case "PREVIEW_CURSOR": {
        const library = MapModel.routeLibrary(action, branch);
        event.route = doc[library]?.[action.routeIndex];
        event.routePath = `${library}[${action.routeIndex}]`;
        info["路线引用"] = event.routePath;
        if (!event.route) notes.push("地图中没有此路线索引。");
        info[type === "SPAWN" ? "敌人 key" : "预览标记 key"] = key;
        targets.push(...(refs.enemies.get(key) || []));
        break;
      }
      case "DISPLAY_ENEMY_INFO":
        info["敌人 key"] = key;
        targets.push(...(refs.enemies.get(key) || []));
        if (!targets.length) notes.push("当前地图的 enemyDbRefs 中没有此 key。");
        break;
      case "WITHDRAW_PREDEFINED":
      case "ACTIVATE_PREDEFINED":
        info["预设别名或单位 ID"] = key;
        targets.push(...refs.predefines.filter(slot => key && slot.alias === key &&
          (type === "ACTIVATE_PREDEFINED" || !slot.card)));
        if (!targets.length) notes.push("当前地图没有匹配的预设。");
        break;
      case "TRIGGER_PREDEFINED": {
        // Scheduler splits with RemoveEmptyEntries, selects one candidate, then reads alias[:ability].
        const candidates = String(key).split("|").filter(Boolean);
        info["候选数"] = candidates.length;
        if (!candidates.length) notes.push("触发 key 为空。");
        candidates.forEach((candidate, index) => {
          const fields = candidate.split(":").filter(Boolean);
          if (!fields.length || fields.length > 2) {
            notes.push(`候选 ${index + 1} 格式无效：${candidate}`);
            return;
          }
          const [alias, ability = "DefaultTrigger"] = fields;
          info[`候选 ${index + 1}`] = `${alias} → ${ability}`;
          const slots = refs.predefines.filter(slot => !slot.card && slot.alias === alias);
          if (!slots.length) notes.push(`当前地图没有匹配的预设实例：${alias}`);
          for (const slot of slots) targets.push({...slot, description: ability});
        });
        break;
      }
      case "SHOW_ALL_HIDDEN_CARDS":
        info["作用范围"] = "活动卡组中的隐藏卡牌";
        targets.push(...refs.predefines.filter(slot => slot.card && slot.value.hidden));
        notes.push("下方列出地图中标记为 hidden 的预设卡牌。");
        break;
      case "STORY":
      case "TUTORIAL":
      case "DIALOG":
        info["脚本资源 key"] = key;
        info["资源类型"] = type === "DIALOG" ? "战斗对话" : "AVG 剧情";
        break;
      case "PLAY_BGM":
        info["播放的音乐 key"] = key;
        info["关卡 bgmEvent"] = doc.bgmEvent ?? "未设置";
        break;
      case "PLAY_OPERA":
        info["关卡 operaConfig"] = doc.operaConfig ?? "未设置";
        info["演出片段 key"] = key;
        break;
      case "BATTLE_EVENTS":
        info["模式事件 key"] = key;
        info["处理方式"] = modeEvents.get(key) ?? "交由当前游戏模式处理";
        break;
      case "EMPTY":
        info["行为"] = "空动作";
        break;
      default:
        notes.push(type === "E_NUM" ? "E_NUM 是枚举计数标记。" : "未识别的动作类型，可查看原始动作字段。");
    }
    return event;
  }

  window.MapEvents = {names, enumName, references, resolve};
})();
