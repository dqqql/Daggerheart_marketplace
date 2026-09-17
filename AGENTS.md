# Daggerheart_market 工作约定

## 项目目标

本项目用于实现 Daggerheart 第三方资源目录站。

当前阶段已完成：

- 后端管理服务（API 完整）
- 数据存储与运行期文件布局
- 项目目录骨架
- 首页视觉设计（桌面版，黑暗奇幻手稿风格）
- 管理页视觉设计（桌面版，暗色功能性 CRUD 界面）

当前阶段待实现：

- 玩家点赞系统（纯点赞无踩，IP 去重）
- 首页排序规则（推荐值 + 点赞数加权）

当前阶段明确不做：

- `frontend/admin/` 的移动端适配
- 手机横屏与平板的专项适配
- 评论系统
- Spotlight 推荐区（仅做方向记录）

## 目录约定

### 文档

- `CONTEXT.md`：领域词汇与约束
- `PLAN.md`：实施计划
- `AGENTS.md`：本文件，约束目录与执行方式

### 代码与资源

- `server/`：Python 管理服务
- `server/tests/`：后端测试
- `frontend/`：前台静态资源骨架
- `frontend/admin/`：管理入口静态骨架

### 数据

- `data/imports/`：外部来源转换后的中间 JSON
- `data/runtime/entries.json`：运行期条目数据文件
- `data/runtime/covers/`：运行期封面目录
- `data/runtime/secrets/`：运行期口令与会话密钥文件
- `data/runtime/likes.json`：运行期点赞记录文件

### 重要规则

- `data/runtime/` 下的运行期数据默认不纳入 git 跟踪
- 原因：服务器当前通过 `git pull` 更新代码，运行期数据若被跟踪，会与线上管理操作冲突
- 可提交到仓库的是骨架、示例、占位文件，不是线上真实运行数据

## 命名约定

- Python 文件：小写下划线
- API 路径：`/api/...`
- JSON 字段：`camelCase`
- 条目 `id` 前缀：`dhm_`

## 后端约定

- 使用 Python 轻量服务，不引入完整后端框架体系
- 仅实现必要能力：
  - 口令校验
  - 短期会话
  - 条目增改删
  - 封面上传
  - 标签规范化
- 搜索和筛选逻辑主要留给前端读取 JSON 后处理

## 密钥与敏感信息

- 不提交真实口令
- 不提交真实会话密钥
- 运行期密钥放在 `data/runtime/secrets/`
- 若本地开发需要，可通过环境变量注入

## 验证命令

- Worker 语法检查：`npm run check:worker`
- Worker 测试：`npm run test:worker`
- 远端 D1 冒烟：`npx wrangler d1 execute the-great-vault --remote --command "SELECT COUNT(*) AS entries FROM entries;"`
- 线上健康检查：`Invoke-WebRequest -Uri https://dhvault.top/api/health`
- Flask 参考回归：`python -m unittest discover -s server/tests -v`
- Python 语法检查：`python scripts/check_python_syntax.py`

## 生产部署

| 项 | 值 |
|---|---|
| 仓库 | `dqqql/Daggerheart_marketplace` |
| Pages 项目 | `the-great-vault` |
| 生产分支 | `master` |
| 生产域名 | `https://dhvault.top` |
| 备用域名 | `https://the-great-vault.pages.dev` |
| 运行时 | Cloudflare Pages + advanced mode Worker |
| 数据 | D1：`the-great-vault`；R2：`the-great-vault-covers` |

## 推送流程

用户说"推送"时：本地 commit → push 到远端仓库；`master` 分支由 Cloudflare Pages 自动拉取并部署生产。推送后优先检查 Pages 部署状态与线上 API 健康，不再默认走 VPS `git pull + systemd restart` 流程。

建议最小验收顺序：

1. `npx wrangler pages deployment list --project-name the-great-vault`
2. `Invoke-WebRequest -Uri https://dhvault.top/api/health`
3. `Invoke-WebRequest -Uri https://dhvault.top/api/public/bootstrap`

## 旧 Flask 路径

- `server/` 与 `server/tests/` 当前保留为旧实现参考和行为对照，不再视为生产主路径。
- 只有在需要核对历史行为、对比迁移差异、或准备彻底移除 Flask 时，才回看 VPS / systemd 相关信息。

## 改动纪律

- 先保证后端骨架和数据链路成立，再做页面
- 运行期路径、数据结构、API 变更时，同步更新 `PLAN.md`

## Agent skills

### Issue tracker

Issues live in GitHub Issues (`dqqql/Daggerheart_marketplace`). See `docs/agents/issue-tracker.md`.

推送和 PR 的目标均为 `dqqql/Daggerheart_marketplace`。遇到权限不足时先说明阻碍，不得自行切换到上游或其他仓库。

### Triage labels

All five canonical roles use their default label names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo — `CONTEXT.md` at root + `docs/adr/`. See `docs/agents/domain.md`.
