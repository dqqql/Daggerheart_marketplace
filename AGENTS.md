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

- 后端测试：`python -m unittest discover -s server/tests -v`
- 语法检查：`python scripts/check_python_syntax.py`

## 改动纪律

- 先保证后端骨架和数据链路成立，再做页面
- 运行期路径、数据结构、API 变更时，同步更新 `PLAN.md`
