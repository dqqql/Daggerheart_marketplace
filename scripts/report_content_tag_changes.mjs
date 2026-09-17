import { readFile, writeFile } from 'node:fs/promises';
import '../frontend/assets/content-tags.js';

// Usage: node scripts/report_content_tag_changes.mjs bootstrap.json report.md
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Provide input bootstrap JSON and output Markdown paths');
const snapshot = JSON.parse((await readFile(input, 'utf8')).replace(/^\uFEFF/, ''));
const entries = Array.isArray(snapshot) ? snapshot : snapshot.entries;
const changed = entries.map(entry => ({
  ...entry, before: entry.contentTags || [], after: globalThis.ContentTags.canonicalize(entry.contentTags)
})).filter(entry => JSON.stringify(entry.before) !== JSON.stringify(entry.after));
const cell = value => String(value).replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ');
const lines = [
  '# 内容标签调整：受影响资源', '',
  '来源：https://dhvault.top/api/public/bootstrap',
  `统计日期：${new Date().toISOString().slice(0, 10)}；公开资源 ${entries.length} 条，受影响 ${changed.length} 条。`, '',
  '标准标签：' + globalThis.ContentTags.definitions.map(item => item.tag).join('、'), '',
  '合并：转变卡、种族 → 传承；碎心者工具集（含“碎心者”别名）→ 工具书；单人游玩 → 扩展规则；地点设定 → 设定。其余非标准内容标签删除，风味标签不变。', '',
  '此清单仅覆盖公开资源；待审核投稿不在公开 API 中，读取时同样规范化。审核历史保留原始标签。上线时读取旧数据自动规范化，保存时写入标准结果，不要求先批量改写生产 D1。', '',
  '| 资源 | ID | 原内容标签 | 调整后内容标签 |', '|---|---|---|---|',
  ...changed.map(entry => `| ${cell(entry.title)} | ${cell(entry.id)} | ${cell(entry.before.join('、'))} | ${cell(entry.after.join('、') || '（空）')} |`),
  '', '## PbDH专区', '',
  ...entries.filter(globalThis.ContentTags.isPbDH).map(entry => `- ${cell(entry.title)}（${entry.id}）`), ''
];
await writeFile(output, lines.join('\n'));
console.log(`${changed.length}/${entries.length} affected; ${changed.filter(entry => !entry.after.length).length} become untagged`);
