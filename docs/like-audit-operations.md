# 点赞审计运维手册

点赞审计记录在 D1 数据库 `the-great-vault` 的私有表 `like_audit_events`。浏览器匿名凭据 Cookie 固定保留 90 天；审计明细采用 90 天保留阈值，日志不进入公开 API、静态目录或管理页。

## 初始化与密钥

在 Cloudflare Pages 控制台的项目设置中，把 `VISITOR_ID_SECRET` 配置为 Secret。不要将其写入 `wrangler.jsonc`、`vars`、导出文件或版本库，也不要在命令行中传入其值。

应用审计表 migration：

```powershell
npm run d1:migrate:local
npm run d1:migrate:remote
```

先在本地确认 migration，再由有生产 D1 权限的管理员执行远端命令。

## 离线导出

导出日期区间是半开区间 `[from, to)`，两个时间都必须是带时区的 ISO 8601 instant。默认目标为远端；`--local` 和 `--remote` 不能同时使用。

```powershell
npm run audit:export -- --from 2026-09-01T00:00:00Z --to 2026-10-01T00:00:00Z --out .\data\runtime\audit-exports\20260901T000000Z --remote
npm run audit:export -- --from 2026-09-01T00:00:00Z --to 2026-10-01T00:00:00Z --out .\data\runtime\audit-exports\20260901T000000Z-local --local
```

输出目录包含：

- `events.jsonl`：按 `occurredAt,eventId` 稳定排序的审计事件；`countDelta` 的 `null` 与 `0` 保持可区分。
- `entries.json`：仅含 `id`、`title`、`author`；优先读取当前条目，已删除或改名条目可回退至最新历史审核记录。
- `manifest.json`：请求范围、实际覆盖范围、条目数、目标和已知缺口说明。

导出不包含 `feedbackEmail`、密钥、原始 IP、Cookie 或完整 User-Agent。导出仅应存放在授权管理员可访问的位置。示例目录由 `.gitignore` 忽略；每次使用新的无冒号 UTC 时间戳目录。工具拒绝覆盖任何已存在的 `events.jsonl`、`entries.json` 或 `manifest.json`，请不要复用旧导出目录。

## 保留期清理

90 天保留阈值不等于在第 90 天自动删除：目前没有已配置的自动清理。建议授权管理员每天先执行 dry run，核对行数和 UTC cutoff；确认无误后才执行删除。若维护未运行或失败，记录可能超过 90 天才会在下一次成功维护时删除。默认命令目标仍是远端，因此生产操作需要有 D1 权限的管理员明确加上 `--confirm`。

```powershell
npm run audit:prune -- --days 90 --remote
npm run audit:prune -- --days 90 --remote --confirm
```

未带 `--confirm` 时工具只运行 `COUNT(*)`，不会发出 `DELETE`。本轮开发不执行远端清理。

## 可靠性、访问与回滚边界

Worker 用 `waitUntil` 尽力异步写审计事件：点赞结果不会因日志写入失败而失败，因此导出可能存在缺口，不能把日志视为完整取证或自动处罚依据。失败会以不含身份明细的结构化 `console.error` 写入 Pages Functions 日志；本仓库不配置 Worker observability。审计插入错误已在正常响应中捕获，不能使用 `--status error`，否则会漏掉这些调用。授权管理员可使用当前 Wrangler 支持的消息筛选实时查看命令排查：

```powershell
npx wrangler pages deployment tail --project-name the-great-vault --search "like audit insert failed"
```

平台日志的可用性与保留期由 Cloudflare Pages 决定，不能作为审计事件的完整、长期副本。

审计表不提供公开读取接口；仅授权管理员可用本工具访问。D1 的时间旅行或数据库恢复由 Cloudflare 保留策略决定，不能保证能恢复已按 90 天规则删除的明细。恢复数据库也不能补回未成功执行的 `waitUntil` 写入。

## 验证

```powershell
node --test tests/like-audit-tools.test.mjs
npm run check:worker
npm run test:worker
npx wrangler pages functions build --build-output-directory frontend --outfile .wrangler-audit-worker.js
npx wrangler types .wrangler-audit-types.d.ts
```

检查完后删除 `.wrangler-audit-worker.js` 和 `.wrangler-audit-types.d.ts` 临时文件。
