(function (root) {
  'use strict';

  // 标签名称与介绍的唯一维护入口；替换 description 即可更新悬停说明。
  var definitions = [
    { tag: '战役框架', description: '「战役框架」的标签介绍待补充。' },
    { tag: '模组', description: '「模组」的标签介绍待补充。' },
    { tag: '敌人', description: '「敌人」的标签介绍待补充。' },
    { tag: '扩展规则', description: '「扩展规则」的标签介绍待补充。' },
    { tag: '环境', description: '「环境」的标签介绍待补充。' },
    { tag: '职业', description: '「职业」的标签介绍待补充。' },
    { tag: '领域', description: '「领域」的标签介绍待补充。' },
    { tag: '装备物品', description: '「装备物品」的标签介绍待补充。' },
    { tag: '传承', description: '「传承」的标签介绍待补充。' },
    { tag: '遭遇', description: '「遭遇」的标签介绍待补充。' },
    { tag: 'PbDH', description: '「PbDH」的标签介绍待补充。' },
    { tag: '设定', description: '「设定」的标签介绍待补充。' },
    { tag: '电子工具', description: '「电子工具」的标签介绍待补充。' },
    { tag: '工具书', description: '「工具书」的标签介绍待补充。' }
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
