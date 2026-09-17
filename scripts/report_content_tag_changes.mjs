import { readFile, writeFile } from 'node:fs/promises';
import '../frontend/assets/content-tags.js';

// Usage: node scripts/report_content_tag_changes.mjs bootstrap.json report.md
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Provide input bootstrap JSON and output Markdown paths');
const snapshot = JSON.parse((await readFile(input, 'utf8')).replace(/^\uFEFF/, ''));
const entries = Array.isArray(snapshot) ? snapshot : snapshot.entries;
const changed = entries.map(entry => ({
  ...entry, before: entry.contentTags || [], after: globalThis.ContentTags.canonicalize(entry.contentTags),
  flavorAfter: globalThis.ContentTags.migrateFlavor(entry.contentTags, entry.flavorTags)
})).filter(entry => JSON.stringify(entry.before) !== JSON.stringify(entry.after));
const cell = value => String(value).replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ');
const pending = changed.filter(entry => !/DNGN CLUB|一条腿|TTTRI|幻方/i.test(entry.author || ''));
const authors = [...new Set(pending.map(entry => entry.author || '未署名'))];
function contact(entry) {
  const qq = (entry.author || '').match(/QQ\s*([0-9]+)/i);
  return qq ? `QQ：${qq[1]}（公开署名）` : '公开数据未提供';
}
const lines = [
  '# 内容标签调整：待通知资源清单', '',
  '来源：https://dhvault.top/api/public/bootstrap',
  `统计日期：${new Date().toISOString().slice(0, 10)}；公开资源 ${entries.length} 条，受影响 ${changed.length} 条。`, '',
  `已从通知清单排除 DNGN CLUB、一条腿、TTTRI制作组、纱彩幻方相关署名，共 ${changed.length - pending.length} 条受影响资源；这些资源仍按统一规则调整。剩余 ${pending.length} 条资源、${authors.length} 个不同作者署名需要通知。`, '',
  '标准标签：' + globalThis.ContentTags.definitions.map(item => item.tag).join('、'), '',
  '合并：转变卡、种族 → 传承；碎心者工具集（含“碎心者”别名）→ 工具书；单人游玩 → 扩展规则；地点设定 → 设定。其余非标准内容标签移入风味标签，与既有风味标签去重；合并和改名的旧标签不额外移入风味。', '',
  '此清单仅覆盖公开资源；待审核投稿不在公开 API 中，读取时同样规范化。审核历史保留原始标签。上线时读取旧数据自动规范化，保存时写入标准结果，不要求先批量改写生产 D1。', '',
  '联系方式仅提取公开署名中明确写出的 QQ；其他标为“公开数据未提供”，未读取生产数据库中的邮箱。', '',
  '| 资源 | 作者 | 联系方式 | ID | 原内容标签 | 调整后内容标签 | 移入风味标签 |', '|---|---|---|---|---|---|---|',
  ...pending.map(entry => `| ${cell(entry.title)} | ${cell(entry.author || '未署名')} | ${contact(entry)} | ${cell(entry.id)} | ${cell(entry.before.join('、'))} | ${cell(entry.after.join('、') || '（空）')} | ${cell(entry.flavorAfter.filter(tag => !(entry.flavorTags || []).includes(tag)).join('、') || '无（仅合并／改名）')} |`), ''
];
await writeFile(output, lines.join('\n'));
console.log(`${changed.length}/${entries.length} affected; ${pending.length} resources / ${authors.length} authors to notify`);
