# Cloudflare 迁移进度

更新时间：2026-07-02

## 当前分支

- `codex/cloudflare-pages-d1-r2-migration`

## 进度

- [x] 阅读 `迁移计划.md`、`PLAN.md`、`CONTEXT.md` 和现有 Flask/API/前端调用点
- [x] 新建迁移分支
- [x] 建立 Cloudflare Pages Functions / D1 / R2 工程骨架
- [x] 迁移公开 API、管理 API、投稿审核流程
- [x] 增加初始数据导入脚本和封面上传脚本
- [x] 修正 Pages 静态资源路径
- [x] 本地验证与文档收口

## 实施记录

### 2026-07-02

- 确认现有前端主要通过相对 `/api/...` 调用后端，适合保持响应形状迁移。
- 确认封面路径统一以 `/the-great-vault/covers` 和 `/the-great-vault/covers/pending` 暴露，迁移后可由 R2 对象代理实现。
- 确认旧 Flask 驳回邮件在 Worker 首版中按计划降级为 `skipped/not_configured`。
- Resend 发信域名 `mail.dhvault.top` 已验证，Worker 驳回邮件改为通过 Resend HTTP API 发送。
- 新增 `frontend/_worker.js`，用 Pages advanced mode 统一处理 API、静态路径兼容和 R2 封面代理。
- 新增 `migrations/0001_initial.sql`，把 entries、entry_likes、submissions、submission_reviews 拆到 D1。
- 新增 `scripts/build_d1_import.mjs`，可把现有 entries JSON 转为 D1 导入 SQL，并迁移 `likedBy`。
- 新增 `scripts/upload_covers_to_r2.ps1`，可从封面 zip 中匹配 JSON 引用的封面并上传到 R2。
- 对 `D:\Dql\Desktop\官方卡图包.zip` 做 dry run：JSON 引用 114 个 `cover_*.webp`，该 zip 匹配 0 个，说明它不是正式封面备份包。
- 对 `D:\Dql\Desktop\Daggerheart_marketplace\covers.rar` 做 dry run：JSON 引用 114 个 `cover_*.webp`，匹配 114 个，缺失 0 个；该 rar 是正确的正式封面包。
- `npm run check:worker` 通过。
- `npm run test:worker` 通过，覆盖 Worker 数据规范化和标签聚合。
- `python scripts/check_python_syntax.py` 通过。
- `python -m unittest discover -s server/tests -v` 通过 25 个原有后端测试。
- `npx wrangler types` 可读取到 `DB`、`COVERS`、`LIKE_HASH_SALT` 绑定，但生成 runtime types 时本机 `workerd` access violation。
- `npx wrangler d1 migrations apply the-great-vault --local` 同样因本机 `workerd` access violation 暂未完成。
- Wrangler OAuth 登录已验证，账号为 `gooole.dql@gmail.com`，Account ID 为 `40b8bf654b8795f253174f579b707f44`。
- 远端 D1 `the-great-vault` 已绑定真实 database id：`7349381f-0e4e-49c4-bf53-889614316eba`。
- 远端 D1 migration `0001_initial.sql` 已执行成功。
- 远端 D1 entries 导入已执行成功：`entries=142`、`entry_likes=860`、`submissions=0`、`submission_reviews=0`。
- R2 CLI 查询返回 `code: 10042`：需要先在 Cloudflare Dashboard 启用 R2。
- R2 已启用，bucket `the-great-vault-covers` 已创建，位置 APAC。
- `scripts/upload_covers_to_r2.ps1` 已改为远端上传、支持 `.rar`、支持 `-StartAt` 续传和重试。
- `covers.rar` 中 JSON 引用的 114 个正式封面已上传到 R2 `covers/` 前缀；抽样读取 3 个对象成功。
- Pages 项目 `the-great-vault` 已创建，production branch 为 `master`。
- Pages production secrets 已设置：`SESSION_SECRET`、`ADMIN_PASSWORD`。
- 已部署首版 Pages：`https://98fb138d.the-great-vault.pages.dev`，生产域 `https://the-great-vault.pages.dev` 健康检查通过。
- 线上冒烟验证通过：`/api/health`、`/api/public/bootstrap`、R2 封面代理、管理员登录/session、点赞 toggle。

## 待确认/后续

- 需要用浏览器人工验收首页和后台主要流程。
- 需要决定是否提交并推送当前迁移分支，以及是否把 Pages production 改为 Git 自动部署。
- 本机 `workerd` local runtime 仍有 access violation；当前已通过 Cloudflare remote 和 Pages production 完成验证。
