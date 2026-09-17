(function (root) {
  'use strict';
  var priorities = new Map([['PbDH', 0], ['设定', 1], ['战役框架', 2]]);
  function tags(items, getTag) {
    getTag = getTag || function (item) { return item; };
    return items.slice().sort(function (a, b) {
      return (priorities.get(getTag(a)) ?? 3) - (priorities.get(getTag(b)) ?? 3);
    });
  }
  function timestamp(entry) { return Date.parse(entry.updatedAt) || 0; }
  function idOrder(a, b) { return String(a.id).localeCompare(String(b.id), 'en'); }
  function latest(a, b) { return timestamp(b) - timestamp(a) || idOrder(a, b); }
  function entries(items, mode) {
    return items.slice().sort(function (a, b) {
      if (mode === 'hot') {
        var delta = (Number(b.likeCount) || 0) + (Number(b.recommendValue) || 0) * 10
          - (Number(a.likeCount) || 0) - (Number(a.recommendValue) || 0) * 10;
        if (delta) return delta;
      }
      return latest(a, b);
    });
  }
  function dayKey(now) {
    return new Date(new Date(now === undefined ? Date.now() : now).getTime() + 8 * 3600000).toISOString().slice(0, 10);
  }
  function hash(text) {
    var value = 2166136261;
    for (var i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
    value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
    value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
    return (value ^ (value >>> 16)) >>> 0;
  }
  function daily(items, day, section) {
    return items.map(function (entry) {
      return { entry: entry, rank: hash(day + ':' + section + ':' + entry.id) };
    }).sort(function (a, b) { return a.rank - b.rank || idOrder(a.entry, b.entry); })
      .map(function (item) { return item.entry; });
  }
  function highlights(items, day, config) {
    var editor = daily(items.filter(function (entry) { return entry.recommendValue > 0; }), day, 'editor')
      .slice(0, config.EDITOR_PICK_COUNT);
    var editorIds = new Set(editor.map(function (entry) { return entry.id; }));
    var popular = daily(items.filter(function (entry) {
      return !editorIds.has(entry.id) && entry.likeCount >= config.POPULAR_LIKE_THRESHOLD;
    }), day, 'popular').slice(0, config.POPULAR_PICK_COUNT);
    return { editor: editor, popular: popular };
  }
  root.CatalogOrder = Object.freeze({ tags: tags, entries: entries, dayKey: dayKey, highlights: highlights });
})(globalThis);
