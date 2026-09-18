(function (root) {
  'use strict';

  // 标签名称与介绍的唯一维护入口；替换 description 即可更新悬停说明。
  var definitions = [
    { tag: '战役框架', description: '为一段战役提供主题、世界背景、角色关联、独有机制等要素，帮助整桌建立共同的冒险方向；通常不是按场景展开的完整冒险流程。' },
    { tag: '模组', description: '可供主持人准备和运行的冒险内容，通常包含事件、场景、人物、线索与推进方式，可覆盖一次或多次团期。' },
    { tag: '敌人', description: '可供主持人使用的敌人资料，包括动机、数值与特性，可用于战斗或其他对抗场景。' },
    { tag: '扩展规则', description: '在所适用游戏的基础规则之上新增或调整玩法，例如房规、可选机制或子系统；使用前请与同桌确认。' },
    { tag: '环境', description: '将地点、局势或场景表现为可运行的环境资料，通常包含难度、特性和触发效果；仅有风味性描述、不带有机制性内容的地点请使用“设定”。' },
    { tag: '职业', description: '新增或调整的职业与子职内容，包括职业特性、子职能力及相关角色选项。' },
    { tag: '领域', description: '新增领域或调整已有领域卡内容，为角色提供可选择的能力、法术或其他领域选项。' },
    { tag: '装备物品', description: '可供游戏使用的武器、护甲、消耗品、魔法物品及其他装备资料。' },
    { tag: '传承', description: '与角色身份和出身相关的选项，包括种族、社群与转变卡等内容。' },
    { tag: '遭遇', description: '可嵌入冒险的单个或一组场景，提供参与者、冲突、目标和变化，可能包含战斗、社交或探索。' },
    { tag: 'PbDH', description: '以《匕首心》为基础进行改造、“可独立运行”且“不直接兼容原版”的游戏，以及专为这些游戏制作的配套资源；使用前请确认适用规则，并在风味标签里加入对应的规则名称。' },
    { tag: '设定', description: '世界、地区、地点、组织、人物或文化等背景资料，为创作和跑团提供素材，但不包含完整冒险流程或规则机制与资源。' },
    { tag: '电子工具', description: '辅助准备或进行游戏的网站、软件、插件与数字化工具，例如车卡器、骰娘脚本、跑团工具或素材网站。' },
    { tag: '工具书', description: '供玩家或主持人查阅使用的指南、参考表、素材集与方法汇编，侧重辅助创作或游戏实践。' }
  ].map(function (item) { return Object.freeze(item); });
  var allowed = new Set(definitions.map(function (item) { return item.tag; }));
  var aliases = new Map([
    ['转变卡', '传承'], ['种族', '传承'],
    ['碎心者工具集', '工具书'], ['碎心者', '工具书'], ['单人游玩', '扩展规则'], ['地点设定', '设定']
  ]);

  function canonicalize(tags) {
    return Array.from(new Set((Array.isArray(tags) ? tags : []).map(function (tag) {
      var cleaned = String(tag || '').trim().replace(/\s+/g, ' ');
      return aliases.get(cleaned) || cleaned;
    }).filter(function (tag) { return allowed.has(tag); })));
  }

  root.ContentTags = Object.freeze({
    definitions: Object.freeze(definitions),
    isStandard: function (tag) { return allowed.has(tag); },
    canonicalize: canonicalize,
    migrateFlavor: function (contentTags, flavorTags) {
      var moved = (Array.isArray(contentTags) ? contentTags : []).map(function (tag) {
        return String(tag || '').trim().replace(/\s+/g, ' ');
      }).filter(function (tag) { return tag && !allowed.has(tag) && !aliases.has(tag); });
      return Array.from(new Set((Array.isArray(flavorTags) ? flavorTags : []).concat(moved)));
    },
    description: function (tag) {
      var definition = definitions.find(function (item) { return item.tag === tag; });
      return definition ? definition.description : '「' + tag + '」的标签介绍待补充。';
    },
    isPbDH: function (entry) {
      return (entry.contentTags || []).includes('PbDH') || (entry.flavorTags || []).includes('PbDH');
    }
  });
})(globalThis);
