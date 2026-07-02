# Daggerheart Marketplace 实现现状

本文档不再记录“理想中的首版方案”，而是记录当前仓库里已经落地的实际实现，并回答三个问题：

- 设计是什么样的
- 功能是如何实现的
- 尚未实现或尚未收口的有哪些

本文件基于以下代码现状整理：

- `frontend/index.html`
- `frontend/admin/index.html`
- `server/app.py`
- `server/tests/test_app.py`

若本文件与更早期的规划文字不一致，以“当前代码现状 + 未收口项说明”为准。

## 1. 当前实现总览

当前项目已经是一个可运行的“静态前台 + 轻量后端管理服务”组合：

- 前台首页是单文件静态页，负责展示资源、搜索、筛选、分区导航、主题切换和点赞
- 管理页是单文件静态页，负责登录、条目增改删、封面上传裁剪、投稿审核、JSON 导入导出
- 后端是一个极小 Flask 服务，负责会话、条目读写、封面存储、点赞写回、投稿审核、驳回邮件和静态文件开发期分发
- 运行期数据使用本地 JSON 与本地封面目录，不依赖数据库

运行期路径约定仍然成立：

- `data/runtime/entries.json`：条目数据
- `data/runtime/submissions.json`：待审核投稿数据
- `data/runtime/submission_reviews.json`：历史审批记录
- `data/runtime/covers/`：封面文件
- `data/runtime/covers/pending/`：投稿封面暂存目录
- `data/runtime/secrets/`：管理口令、会话密钥与可选 SMTP 密钥

## 2. 设计是什么样的

### 2.1 首页视觉设计

首页不是通用资讯站风格，而是明显的“黑暗奇幻手稿 / 目录馆”视觉：

- 默认深色主题，主色是黑褐底、金色描边、少量深红强调
- 顶部使用 `Cinzel` / `Cinzel Decorative` 这一类带仪式感的 serif 字体
- 全页有噪声纹理和暗角 vignette，避免纯平背景
- `Hero` 区居中，只有站名、副标题和装饰线，不塞功能说明
- 功能入口收在 sticky 工具栏里，滚动时保持可用

视觉重点不是“表格感信息密度”，而是“像在翻一个奇幻资源目录”：

- 卡片封面占大头
- 推荐条目有金色徽记
- 标签采用两套样式区分内容标签和风味标签
- 简介不常驻展开，而是通过悬停提示层显示
- 点赞按钮缩在标题区右侧，不让它变成页面主角

### 2.2 首页布局设计

首页结构固定为四层：

1. `Hero` 头图区
2. sticky 工具栏
3. 左侧分区导航
4. 按分区展开的卡片网格

工具栏包含：

- 搜索框
- 内容标签按钮
- 风味标签按钮
- 亮暗主题切换按钮

左侧分区导航只有在“未搜索、未筛选”的浏览态才显示。进入搜索或标签筛选后，会切回单一结果列表，导航隐藏。

### 2.3 首页响应式设计

当前代码确实做了移动端适配，但它是“同一套页面收窄”，不是另一套移动端信息架构。

实际行为如下：

- `1400px` 以下：左侧分区导航缩成 `48px` 窄轨，只显示短标签
- `640px` 以下：工具栏换成两行，搜索框独占第一行，标签按钮与主题按钮落到第二行
- `640px` 以下：卡片网格变成单列，仍给左侧导航预留 `48px` 槽位
- `640px` 以下：活跃筛选标签条隐藏
- 标签弹窗在手机宽度下仍保留双列，只是整体铺满更多宽度

换句话说：首页已经有手机竖屏可用性，但没有针对手机做新的交互范式。

### 2.4 管理页设计

管理页不是 CMS，也不是传统后台模板，而是一个风格统一但偏功能型的暗色 CRUD 页：

- 未登录时先显示居中的口令登录卡片
- 登录后进入单页 dashboard
- Dashboard 通过“已发布 / 待审核”两个 tab 区分条目维护与投稿审核
- 条目列表按“封面 / 标题作者 / 标签 / 链接 / 操作”横向排布
- 新建和编辑都走同一个 modal
- 条目删除走独立确认框，投稿驳回走带审阅意见的专用弹窗
- 成功或失败反馈通过 toast 提示

视觉语言与首页一致：

- 同样使用金色强调和深色底
- 同样支持亮暗主题切换
- 但比首页更克制，重点放在录入效率

### 2.5 管理页录入体验

管理页的录入体验比普通表单多做了两件事：

- 标签不是逗号长文本，而是 chip 输入
- 封面不是直接原图上传，而是前端先裁剪，再上传成统一比例

封面裁剪器的行为是：

- 在前端 canvas 中预览
- 支持拖拽移动
- 支持滚轮缩放
- 固定输出 `3:4` 比例
- 最终导出 `600 x 800` 的 `webp`

## 3. 功能是如何实现的

### 3.1 技术形态

当前实现非常直接，没有额外框架层：

- 前台：原生 `HTML + CSS + JS`
- 管理页：原生 `HTML + CSS + JS`
- 后端：`Flask`
- 发信：Python 标准库 `smtplib`
- 存储：本地 `JSON`

`server/requirements.txt` 里只有 `Flask`，说明项目刻意保持轻量，没有引入 ORM、模板引擎或前端构建系统。

### 3.2 首页启动与数据加载

首页启动时会做两次请求：

- `GET /api/public/bootstrap`
- `GET /api/public/likes`

它们分别负责：

- 拉取全部条目和两套标签计数
- 拉取“当前 IP 已点赞过哪些条目”

前端把状态统一放在一个 `state` 对象里，主要字段包括：

- `entries`
- `tags`
- `searchQuery`
- `selectedContentTags`
- `selectedFlavorTags`
- `pendingContentTags`
- `pendingFlavorTags`
- `likedEntries`

如果页面是直接以 `file://` 打开，前端会把 API 基址切到 `http://localhost:5000`，便于本地静态调试。

### 3.3 搜索与标签筛选

首页搜索是前端本地过滤，不走后端检索。

搜索范围包含：

- 标题
- 作者
- 简介
- 内容标签
- 风味标签

标签筛选逻辑是：

- 内容标签组内 `OR`
- 风味标签组内 `OR`
- 两组之间 `AND`
- 搜索词与标签条件之间也是 `AND`

标签候选列表也不是写死词库，而是由后端根据现有条目实时聚合并返回计数。

标签弹窗有一层“待应用状态”：

- 点击筛选按钮先复制当前选中值到 `pending*`
- 在弹窗里勾选只改 `pending*`
- 点击“应用”后才回写到真正的 `selected*`

这样避免用户每点一次标签就整页重排。

### 3.4 首页分区、排序与导航

未搜索、未筛选时，首页不是一整页统一排序，而是按分区渲染。

当前分区顺序是：

1. 最新收录
2. 编辑推荐
3. 社群匕选
4. 模组
5. 玩家资源
6. GM资源
7. 扩展规则
8. 战役框架
9. 其他

各分区的实际实现规则如下：

- 最新收录：按 `updatedAt` 倒序取前 `8` 个
- 编辑推荐：`recommendValue > 0`，按推荐值倒序，同分按 `updatedAt` 倒序，取前 `4` 个
- 社群匕选：`likeCount >= 5`，按点赞数倒序，同分按 `updatedAt` 倒序，取前 `4` 个
- 其他常规分区：使用加权分 `recommendValue * 10 + likeCount` 倒序，同分按 `updatedAt` 倒序

各分区究竟由哪些标签驱动，直接看 `frontend/index.html` 中 `const CONFIG` 下的分区标签映射数组（`MODULE_TAGS`、`PLAYER_RESOURCE_TAGS`、`GM_RESOURCE_TAGS`、`EXT_RULE_TAGS`、`CAMPAIGN_FRAMEWORK_TAGS`），文档不写死具体标签组合。

分区不是完全互斥的：

- `最新收录`、`编辑推荐`、`社群匕选` 本来就允许和下方分区重复
- `玩家资源` / `GM资源` 只排除了已经归入"战役框架 / 模组"的条目
- `扩展规则` 分区没有做额外排重，因此它可以和别的内容型分区重复

左侧导航也是前端根据最终有内容的分区动态生成，不是静态写死。

导航高亮逻辑是：

- 监听页面滚动
- 用 `requestAnimationFrame` 节流
- 判断哪个 `section-header` 已经进入 sticky 工具栏下方安全区
- 对应导航项加 `active`

### 3.5 首页卡片、简介与外链跳转

每张资源卡片包含：

- 封面图
- 标题
- 作者
- 内容标签
- 风味标签
- 推荐徽记（如果推荐值大于 0）
- 点赞按钮
- 可选简介 tooltip

卡片点击行为很简单：

- 如果点到点赞按钮，阻止事件冒泡，执行点赞 toggle
- 否则直接 `window.open(targetUrl, '_blank', 'noopener')`

简介当前只做了 hover tooltip，没有单独的移动端点击展开交互。

### 3.6 点赞系统

点赞已经落地，不是计划项。

当前规则：

- 纯点赞，没有点踩
- 不需要登录
- 以 IP 为去重单位
- 同一 IP 可以再次点击取消点赞

实现方式：

- 前端初始化时先取 `/api/public/likes`，得到当前 IP 的 `likedEntryIds`
- 点击心形按钮后，发 `POST /api/public/like/<entry_id>`
- 后端根据 IP 哈希判断是新增还是取消
- 更新条目里的 `likedBy` 和 `likeCount`
- 前端只做局部 UI 更新，不强制整页重载

点赞数据不单独存表，而是直接跟着条目存进 `entries.json`：

- `likedBy`：IP 哈希数组
- `likeCount`：数组长度对应的计数

IP 哈希规则也已经固化：

- 优先读 `X-Forwarded-For`
- 退回 `remote_addr`
- 拼接固定盐值后做 `SHA-256`
- 取前 `16` 位作为保存值

### 3.7 管理登录与会话

管理页不是前端假登录，而是后端会话：

- `POST /api/admin/login`：校验共享口令
- `GET /api/admin/session`：判断当前是否已登录
- `POST /api/admin/logout`：清掉 session

后端口令来源：

- 优先环境变量
- 否则读取 `data/runtime/secrets/` 下的文件

会话密钥同样优先环境变量，其次读取密钥文件。

### 3.8 条目增改删

管理页条目维护流程如下：

- 打开 dashboard 时请求 `GET /api/admin/entries`
- 新建条目走 `POST /api/admin/entries`
- 编辑条目走 `PUT /api/admin/entries/<entry_id>`
- 删除条目走 `DELETE /api/admin/entries/<entry_id>`

前端编辑器会动态生成表单，字段包括：

- 封面
- 标题
- 作者
- 内容标签
- 风味标签
- 推荐值
- 跳转链接
- 简介
- 待审核投稿编辑时额外显示反馈邮箱

保存前只做最基础的前端校验：

- 标题不能为空
- 跳转链接不能为空

真正的数据规范化放在后端：

- 文本去首尾空格
- 多空格收敛
- 标签去空、去重
- `recommendValue` 必须是 `>= 0` 的整数
- `targetUrl` 必须是合法 `http/https` URL
- `coverPath` 必须属于本地封面 URL 前缀
- `feedbackEmail` 可为空；非空时必须是邮箱格式，并规范化为小写

### 3.8.1 投稿与审核

首页工具栏提供“提交资源”入口，打开投稿 modal。投稿表单复用管理端资源表单，字段包括：

- 封面
- 标题
- 作者
- 反馈邮箱
- 内容标签
- 风味标签
- 跳转链接
- 简介

投稿接口：

- `POST /api/public/submissions`：写入 `submissions.json`
- `POST /api/public/covers`：写入 `covers/pending/`

管理审核接口：

- `GET /api/admin/submissions`：读取待审核列表
- `GET /api/admin/submission-reviews`：读取历史审批记录
- `PUT /api/admin/submissions/<submission_id>`：编辑待审核投稿
- `POST /api/admin/submissions/<submission_id>/approve`：通过投稿，生成公开条目
- `DELETE /api/admin/submissions/<submission_id>`：驳回投稿，可接收 `reviewNote`

通过投稿时：

- 从 `submissions.json` 移除该投稿
- 将 pending 封面迁移到正式 `covers/`
- 生成新的 `dhm_` 公开条目
- 初始化 `likeCount: 0` 与 `likedBy: []`
- 不把 `feedbackEmail` 写入公开条目
- 向 `submission_reviews.json` 追加 `approved` 历史记录

驳回投稿时：

- 从 `submissions.json` 移除该投稿
- 清理 pending 封面
- 根据反馈邮箱和邮件服务配置返回通知状态
- 邮件发送失败不回滚驳回操作
- 向 `submission_reviews.json` 追加 `rejected` 历史记录，保存审阅意见与通知状态

通知状态当前包括：

- `sent`：邮件已发送
- `skipped / no_feedback_email`：投稿未留反馈邮箱
- `skipped / not_configured`：邮件服务未配置
- `failed / send_failed`：邮件服务发信失败

### 3.9 封面上传

封面上传是“前端裁剪 + 后端保存文件”的组合。

流程是：

1. 选择本地图片
2. 前端在 canvas 中显示裁剪框
3. 用户拖拽和缩放到合适构图
4. 前端导出 `webp`
5. 通过 `FormData` 发到 `POST /api/admin/covers`
6. 后端生成唯一文件名并写入 `data/runtime/covers/`
7. 后端返回 `coverPath`
8. 前端把这个 `coverPath` 写回当前表单

删除条目时，后端会尝试同步删除对应封面文件，并且先做路径解析，避免删到封面目录之外。

### 3.10 JSON 导入导出

管理页支持“整表级别”的导入导出。

导出：

- 前端直接请求 `/api/admin/entries`
- 在浏览器里生成 JSON 文件下载

导入：

- 用户选择一个 JSON 文件
- 前端要求确认“用该文件替换全部条目”
- 前端把 `entries` 数组发给 `POST /api/admin/entries/import`
- 后端逐条重新做规范化后整体覆盖保存

导入时后端会尽量保留原有的：

- `id`
- `createdAt`
- `updatedAt`

这说明当前导入语义不是“增量合并”，而是“全量替换”。

### 3.11 数据模型

当前条目数据的核心字段已经稳定：

```json
{
  "id": "dhm_xxxxxxxx",
  "title": "资源标题",
  "author": "作者",
  "contentTags": ["模组"],
  "flavorTags": ["武侠"],
  "recommendValue": 1,
  "likeCount": 0,
  "likedBy": [],
  "summary": "简介",
  "coverPath": "/marketplace/covers/cover_xxx.webp",
  "targetUrl": "https://example.com",
  "createdAt": "2026-06-02T10:00:00+00:00",
  "updatedAt": "2026-06-02T10:00:00+00:00"
}
```

当前待审核投稿数据在条目字段基础上额外包含 `feedbackEmail`：

```json
{
  "id": "sub_xxxxxxxx",
  "title": "资源标题",
  "author": "作者",
  "contentTags": ["模组"],
  "flavorTags": ["武侠"],
  "recommendValue": 0,
  "summary": "简介",
  "coverPath": "/the-great-vault/covers/pending/cover_xxx.webp",
  "targetUrl": "https://example.com",
  "feedbackEmail": "creator@example.com",
  "createdAt": "2026-06-02T10:00:00+00:00",
  "updatedAt": "2026-06-02T10:00:00+00:00"
}
```

`feedbackEmail` 只保存在待审核投稿中，审核通过后不会进入 `entries.json` 或公共 API。

SMTP 配置支持环境变量或 `data/runtime/secrets/smtp.json`：

```json
{
  "host": "smtp.163.com",
  "port": 25,
  "username": "your_163_email@163.com",
  "password": "your_163_smtp_authorization_code",
  "from": "your_163_email@163.com",
  "fromName": "宏伟宝库",
  "security": "none"
}
```

兼容旧版拆分 txt 文件：

- `MARKETPLACE_SMTP_HOST` / `smtp_host.txt`
- `MARKETPLACE_SMTP_PORT` / `smtp_port.txt`
- `MARKETPLACE_SMTP_USERNAME` / `smtp_username.txt`
- `MARKETPLACE_SMTP_PASSWORD` / `smtp_password.txt`
- `MARKETPLACE_MAIL_FROM` / `mail_from.txt`
- `MARKETPLACE_MAIL_FROM_NAME` / `mail_from_name.txt`
- `MARKETPLACE_SMTP_SECURITY` / `smtp_security.txt`

`MARKETPLACE_SMTP_SECURITY` 可取 `starttls`、`ssl` 或 `none`，默认 `starttls`。

Worker 版本使用 Resend HTTP API 发送驳回邮件：

- `RESEND_API_KEY`：Cloudflare Pages Secret，必填
- `RESEND_FROM`：发件人，默认 `宏伟宝库 <review@mail.dhvault.top>`
- `RESEND_REPLY_TO`：回复地址，可选

Resend 发信域名使用 `mail.dhvault.top`，DNS 验证记录由 Resend/Cloudflare 自动配置。

ID 规则：

- 前缀固定 `dhm_`
- 后缀是 `8` 位十六进制字符串
- 待审核投稿使用 `sub_` 前缀和 `8` 位十六进制字符串
- 历史审批记录使用 `rev_` 前缀和 `8` 位十六进制字符串

后端写盘方式：

- 先写 `*.tmp`
- 再 replace 到正式文件
- replace 失败时退回直接写入

这属于轻量级原子写入，不是强事务。

### 3.12 自动化验证

当前自动化验证集中在后端：

- 健康检查
- 登录与 session
- 标签规范化
- 封面上传与删除
- 标签计数聚合
- 点赞 toggle
- 删除条目后点赞数据联动
- bootstrap 是否返回点赞字段
- 投稿反馈邮箱校验与隐私隔离
- 驳回投稿的通知状态与邮件发送分支

前端目前没有自动化测试，主要依赖人工联调。

## 4. 尚未实现或尚未收口的项

### 4.1 明确还没做的产品能力

以下能力当前仍然没有实现：

- `frontend/admin/` 的移动端适配
- 手机横屏与平板的专项适配
- 评论系统
- 账号体系
- 用户评分体系
- 站内资源详情页
- 交易或下载托管能力
- 自建邮箱服务器
- 投稿者查询审核状态
- 通过审核邮件通知

### 4.2 已实现但没有继续深化的部分

以下能力已经有第一版，但明显还停在“够用即可”的阶段：

- 点赞防刷只做到 IP 去重，没有限频、验证码、异常审计或权重修正
- 推荐区阈值、分区标签映射、排序权重全部硬编码在前端，管理页不能配置
- 标签仍然是自由输入，只做最小规范化，没有同义词治理
- 简介只做 hover 提示，没有移动端专门交互
- 导入是整表替换，没有预览 diff、回滚或合并策略
- 驳回邮件只做基础 SMTP 发信，没有退信处理、送达率监控或邮件模板后台配置

### 4.3 文档与实现的未收口

当前仓库里有几处“代码已经这样做了，但项目文档还没统一”的地方：

- 项目级 `AGENTS.md` 仍把“玩家点赞系统”和“首页排序规则”写成待实现，但代码里已经实现
- 项目级 `AGENTS.md` 仍把 `Spotlight` 推荐区写成“明确不做”，但首页代码里已经有“编辑推荐 / 社群匕选”
- 旧版 `PLAN.md` 写过社群匕选阈值 `>= 2`，当前代码实际阈值是 `>= 5`

这些差异不影响当前网站运行，但会影响后续判断“哪些是既定范围、哪些是试验实现”。

### 4.4 实现层面的遗留问题

以下属于现在能跑，但还不够收口的工程问题：

- 后端只会为“缺失”的 `likeCount` / `likedBy` 补默认值，没有单独的数据迁移脚本去清洗旧数据里的异常值
- 前端没有自动化测试，首页分区、筛选、点赞和管理页交互主要靠人工回归
- 纯 JSON 存储仍然有并发覆盖风险，当前默认场景仍是低频、单管理员维护

## 5. 后续若继续推进，优先顺序建议

如果后续继续收口，优先级建议如下：

1. 先统一文档边界：把 `AGENTS.md`、`PLAN.md` 和代码现状对齐
2. 再决定推荐区是否保留为正式功能，还是回退到“仅记录方向”
3. 然后补工程兜底：前端回归测试、点赞数据清洗、导入回滚策略
4. 最后再做体验扩展：管理页移动端、标签治理、点赞防刷

## 6. 验证命令

项目当前约定的验证命令仍然是：

- `python -m unittest discover -s server/tests -v`
- `python scripts/check_python_syntax.py`

## 7. Cloudflare 迁移实施记录

当前分支已开始按 `迁移计划.md` 落地 Cloudflare 版本，目标是保留现有前端体验和 `/api/...` 响应形状，同时将运行期存储从本地 JSON/文件迁移到 D1/R2。

新增结构：

- `frontend/_worker.js`：Cloudflare Pages advanced mode Worker，处理公开 API、管理 API、投稿审核、旧 URL 兼容和 R2 封面代理。
- `migrations/0001_initial.sql`：D1 初始 schema，包含 `entries`、`entry_likes`、`submissions`、`submission_reviews`。
- `wrangler.jsonc` / `package.json`：Pages、D1、R2 的本地开发与部署配置骨架。
- `scripts/build_d1_import.mjs`：将现有 entries JSON 转为 D1 SQL，迁移 `likedBy` 为 `entry_likes`。
- `scripts/upload_covers_to_r2.ps1`：按 entries JSON 引用的封面文件名，从 zip 中匹配并上传到 R2。
- `MIGRATION_PROGRESS.md`：本次迁移的实时进度记录。

数据行为变化：

- 公开条目仍返回 `likeCount` 与 `likedBy`，但 D1 内部将点赞拆为 `entry_likes` 表。
- 封面上传改写到 R2，公开路径仍保持 `/the-great-vault/covers/<file>` 和 `/the-great-vault/covers/pending/<file>`。
- Worker 使用 Resend HTTP API 发送驳回邮件；驳回投稿仍写入审核历史，邮件发送失败不回滚驳回操作。

当前验证状态：

- `scripts/build_d1_import.mjs` 已可从 `D:\Dql\Desktop\entries_backup_2026-07-02.json` 生成 SQL，统计到 142 条 entries、860 条历史点赞。
- `scripts/upload_covers_to_r2.ps1` 对 `D:\Dql\Desktop\官方卡图包.zip` dry run 显示：JSON 引用 114 个 `cover_*.webp`，该 zip 匹配 0 个，说明它不是正式封面备份包。
- 本机 Wrangler/Workerd 在 D1 local migration 和 runtime type generation 阶段触发 Windows access violation，Cloudflare 本地运行时验证暂时受阻；JS 语法检查与原 Flask 测试已通过。
- Cloudflare remote 已完成首版上线验证：
  - D1 `the-great-vault` 已执行 migration，并导入 `entries=142`、`entry_likes=860`。
  - R2 `the-great-vault-covers` 已上传 JSON 引用的 114 个正式封面。
  - Pages `the-great-vault` 已创建并部署，预览地址为 `https://98fb138d.the-great-vault.pages.dev`，生产地址为 `https://the-great-vault.pages.dev`。
  - 已验证 `/api/health`、`/api/public/bootstrap`、封面代理、管理员登录/session、点赞 toggle。
