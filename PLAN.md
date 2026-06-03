# Daggerheart Marketplace 实施计划

本文档用于约束 `Daggerheart_market` 项目的首版实现范围、技术方案、数据模型与分阶段落地步骤。

## 1. 项目目标

做一个 Daggerheart 第三方模组与资源的目录站首页，形态参考 `heartofdaggers.com/marketplace/`，但明确简化为：

- 只做展示与跳转
- 不承载资源正文
- 不做交易
- 不做账号系统
- 不做用户评分
- 不做资源详情二级页
- 不做评论系统

首版重点是：

- 把资源卡片展示做出来
- 把标签系统做对
- 把管理员录入链路打通

## 2. 已确认决策

### 2.1 部署与运行形态

- 部署位置：现有 VPS，挂在 `daggerheart.cn/marketplace/`
- 服务器：Oracle Cloud VM.Standard.E2.1.Micro（1 OCPU / 1 GB RAM / Ubuntu 22.04）
- 公网 IP：`151.145.76.60`
- SSH：`ssh -i .ssh/ssh-key-2026-03-20.key ubuntu@151.145.76.60`（密钥位于 `Daggerheart_VPS` 仓库）
- 服务器路径：`/var/www/marketplace`（`git clone` 自 `ZZZZzzzzac/Daggerheart_marketplace`）
- Nginx：`/marketplace/` → alias `frontend/`；`/marketplace/covers/` → alias `data/runtime/covers/`；`/api/` → proxy `127.0.0.1:5090`
- Flask 后端：systemd `daggerheart_marketplace.service`，监听 `127.0.0.1:5090`
- 自动更新：`update_repos.sh`（cron 每日 UTC 04:00 执行 `git pull`）
- 前台：静态页面，使用 `HTML + CSS + JS`
- 管理能力：极小 Python 服务
- 数据存储：服务器本地 `JSON`
- 封面资源：服务器本地存储，不走图床
- 管理入口：独立路径 `/marketplace/admin/`
- 运行期数据放在未跟踪目录，避免与服务器 `git pull` 部署冲突

### 2.2 站点边界

- 首页卡片点击后直接跳到飞书或其他外链
- 不做站内详情页
- 网站本身只是目录站
- 首版优先桌面端体验，并补首页手机竖屏适配

### 2.3 管理与鉴权

- 管理入口通过访问口令进入
- 登录成功后建立短期会话
- 不做账号体系
- 不做权限分级

### 2.4 标签与筛选

- 两套标签体系并行存在：
  - 内容标签：描述资源是什么，如 `模组`、`敌人`、`职业`
  - 风味标签：描述资源风格，如 `西幻`、`科幻`、`武侠`
- 标签由管理员自由输入
- 保存前做最小规范化：
  - 去首尾空格
  - 统一空白形式
  - 同条目内去重
- 内容标签可空
- 风味标签可空
- 当前只有标题与跳转链接必填
- 标签筛选逻辑：
  - 组内 `OR`
  - 组间 `AND`

### 2.5 搜索与简介

- 搜索范围包含：
  - 标题
  - 作者
  - 内容标签
  - 风味标签
  - 简介
- 简介为 JSON 中的可选字段
- 桌面端支持鼠标悬停显示简介

### 2.6 推荐与删除

- 只保留一个管理员数值字段：`推荐值`
- 首版使用 `0/1`
- 后续可扩展为更细的推荐强度
- 条目删除时，对应服务器封面文件允许物理删除

### 2.7 玩家点赞系统 ✅ 已实现

> **实现日期**: 2026-06-03

- 纯点赞，不做踩
- 不做评论
- 无账号体系，使用 IP 记录已点赞状态
- 同一 IP 可以对同一条目取消点赞（toggle），防止误操作或遗忘
- 前端根据当前 IP 的点赞记录显示"已赞/点赞"两种状态
- 点赞计数影响首页排序，与管理员推荐值加权汇总
- 管理员推荐值与玩家点赞分开维护，不互相替代
- 点赞按钮放在卡片标题/作者右侧
- 首版以 IP 为去重单位，不引入复杂防刷票机制
- 点赞数 > 0 时在按钮中显示计数

**实现清单**:

| 层级 | 位置 | 说明 |
|------|------|------|
| 后端 API | `POST /api/public/like/<entry_id>` | `server/app.py:93` — toggle 点赞，返回 `{liked, likeCount}` |
| 后端 API | `GET /api/public/likes` | `server/app.py:87` — 返回当前 IP 已点赞条目 ID 列表 `{likedEntryIds}` |
| 后端函数 | `get_client_ip_hash()` | `server/app.py:358` — 读取 `X-Forwarded-For` 或 `remote_addr`，SHA-256 哈希取前 16 位 |
| 后端函数 | `normalize_entry()` | `server/app.py:398` — 新增 `likeCount: 0` 和 `likedBy: []` 字段 |
| 后端函数 | `load_entries()` | `server/app.py:338` — 加载时自动补全缺失的 `likeCount` / `likedBy` 字段 |
| 数据模型 | `likedBy` 字段 | 每个条目的 IP 哈希数组，直接存储在 `entries.json` 中（不自建 `likes.json`） |
| 前端状态 | `state.likedEntries` | `frontend/index.html:1249` — 当前 IP 已点赞的条目 ID 数组 |
| 前端函数 | `loadLikes()` | `frontend/index.html:1297` — 初始化时调用 `GET /api/public/likes` |
| 前端函数 | `toggleLike(entryId, btnEl)` | `frontend/index.html:1307` — 发送 POST，就地更新 UI |
| 前端函数 | `updateCardLikeUI()` | `frontend/index.html:1337` — 更新心形图标和计数，无需重渲染卡片 |
| 前端函数 | `renderCard()` | `frontend/index.html:1418` — 卡片模板第 1434-1438 行嵌入点赞按钮 |
| 前端 CSS | `.card-likes` | `frontend/index.html:611` — 点赞按钮容器（flex, justify-end） |
| 前端 CSS | `.card-like-btn` | `frontend/index.html:618` — 按钮样式；`.liked` 变体为 ♥ 实心 + 深红色 |
| 前端 CSS | `.card-like-icon` / `.card-like-count` | `frontend/index.html:642` — 心形图标 15px / 计数 11px |
| 前端事件 | 卡片 click 委托 | `frontend/index.html:1545` — 通过 `closest('[data-action="like"]')` 识别点赞点击并 `stopPropagation` |
| 测试 | `test_like_toggle_*` | `server/tests/test_app.py:170-207` — 点赞/取消点赞完整往返测试 |
| 测试 | `test_delete_entry_cleans_up_likes` | `server/tests/test_app.py:213-236` — 删除条目后 bootstrap 中不再出现 |
| 测试 | `test_public_bootstrap_includes_like_count` | `server/tests/test_app.py:238-259` — 验证 `likeCount` 和 `likedBy` 字段存在 |

### 2.8 首页推荐区（Spotlight） ✅ 已实现

> **实现日期**: 2026-06-03

首页顶部设两个并列推荐区，各自展示 4 个资源：

- **编辑推荐**：按 `recommendValue` 降序取前 4（值相同时按更新时间降序）
- **社群匕选**：按 `likeCount` 降序取前 4，且 `likeCount` 必须大于阈值（阈值 ≥ 2）

两个推荐区独立于下方完整列表。

**实现清单**:

| 层级 | 位置 | 说明 |
|------|------|------|
| 前端变量 | `editorPick` | `frontend/index.html:1522` — `state.entries` 中 `recommendValue > 0` 者按值降序取前 4 |
| 前端变量 | `popularPick` | `frontend/index.html:1531` — `state.entries` 中 `likeCount >= 2` 者按点赞数降序取前 4 |
| 前端数组 | `sections` | `frontend/index.html:1539` — 分区顺序：最新收录 → 编辑推荐 → 社群匕选 → 战役框架 → 模组 → 玩家资源 → GM资源 → 扩展规则 → 其他 |
| 前端导航 | `section-nav` | 自动从 `sections` 生成，新增 `推荐` / `热榜` 短标签 |
| 排序函数 | `byScore(arr)` | `frontend/index.html:1502` — 加权排序 `recommendValue * 10 + likeCount` 降序，同分按 `updatedAt` 降序；应用于除"最新收录"外的所有分区 |

## 3. 暂缓决策

以下内容本轮不定死，只预留扩展空间：

- ~~首页默认排序规则（玩家点赞引入后需重新评估）~~ → 已实现：加权值 `recommendValue * 10 + likeCount` 降序
- ~~首页推荐区（Spotlight）~~ → 已实现：编辑推荐 + 社群匕选各 4 个
- ~~首页是否按内容标签分区~~ → 已实现
- `frontend/admin/` 的移动端适配
- 手机横屏与平板的专项适配
- 推荐值是否演化为更细粒度评分
- 标签同义词治理
- 社群匕选推荐区的点赞阈值（当前 ≥ 2）

## 4. 首页交互方案

### 4.1 页面结构

- 顶部 `Hero` 区：站点标题、副标题、简单说明
- 顶部冻结工具栏：
  - 搜索框
  - 内容标签筛选入口
  - 风味标签筛选入口
- 资源卡片区：
  - 封面
  - 标题
  - 作者
  - 标签
  - 推荐值徽记或视觉强调

### 4.2 标签筛选体验

- 标签候选集从现有条目中自动汇总
- 工具栏中的两套筛选框宽度固定
- 工具栏内只显示按使用数量排序的头部标签
- 标签显示计数，如 `西幻(5)`
- 点击筛选框后弹出完整标签面板，显示全部标签

### 4.3 简介展示

- 桌面端通过 hover 展示简介
- 手机竖屏暂时保留当前 hover 形式

### 4.4 首页手机竖屏适配

- 本轮只聚焦 `360px` 起的手机竖屏
- `Hero` 区保持当前视觉，不做专项压缩
- 顶部**冻结工具栏**在手机竖屏继续保持 sticky
- 手机竖屏下的工具栏改为两行：
  - 第一行只放搜索框
  - 第二行放内容标签筛选、风味标签筛选与主题切换
- 手机竖屏下移除工具栏下方的活跃筛选标签展示
- 手机竖屏下保留左侧分区导航，继续沿用桌面端“未筛选显示、筛选后隐藏”的逻辑
- 手机竖屏左侧分区导航：
  - 保持垂直居中悬浮
  - 位置较桌面端更靠左
  - 使用固定像素宽度的窄左轨，首版按 `48px` 预留
  - 只显示当前有内容的分区
  - 使用短标签显示：
    - `最新收录` → `最新`
    - `战役框架` → `战框`
    - `玩家资源` → `玩家`
    - `GM资源` → `GM`
    - `扩展规则` → `房规`
    - `其他` → `其他`
  - 每项做成整块可点的小按钮，但视觉上保持透明底色，仍然接近桌面端文字导航
  - 上下点击间距加大，优先保证触摸命中
- 左侧分区导航增加当前分区高亮与加粗，桌面端和手机竖屏统一支持
- 当前分区判定采用顶部判定：哪个分区标题先进入工具栏下方安全区，就高亮对应导航项
- 分区锚点跳转需要预留顶部安全距离，避免标题被 sticky 工具栏遮挡；该修正同时作用于桌面端与手机竖屏
- 手机竖屏下工具栏保持居中，不随左侧导航一起右移
- 手机竖屏下只让卡片区为左侧导航让出版心：
  - 卡片区整体向右偏移，不再强制居中
  - 左侧为导航保留固定像素槽位
  - 右侧允许比左侧更贴边
  - 卡片区在剩余宽度内继续自适应伸展，能占多宽占多宽，直到布局上足以容纳第二列卡片
- 首版实现中，即使筛选生效且左侧导航隐藏，卡片区仍先保持右移版心，后续再按效果决定是否回中
- 手机竖屏下卡片继续展示全部标签，不做 `+N` 折叠
- 标签弹窗在手机竖屏下暂时维持当前双栏结构

## 5. 管理入口方案

### 5.1 管理入口职责

- 登录管理入口
- 新增资源条目
- 编辑资源条目
- 删除资源条目
- 上传封面图片

### 5.2 管理表单字段

- 封面图片
- 标题（必填）
- 作者
- 内容标签（选填）
- 风味标签
- 推荐值
- 跳转链接（必填）
- 简介（选填）

### 5.3 标签录入交互

- 内容标签与风味标签分成两个独立输入区域
- 每个区域采用 chip 输入方式
- 输入词语后按 `Enter` 或分隔符生成 chip
- 每个 chip 可单独删除

## 6. 数据模型草案

首版使用单文件 JSON 保存条目列表。

注意：

- 运行期使用的真实数据文件不应纳入 git 跟踪
- 推荐把运行期条目文件放在 `data/runtime/entries.json`
- 推荐把运行期封面文件放在 `data/runtime/covers/`
- 仓库中保留骨架与占位目录，不保留线上真实数据

建议字段：

```json
{
  "entries": [
    {
      "id": "dhm_001",
      "title": "黑潮边境",
      "author": "某作者",
      "contentTags": ["模组", "敌人"],
      "flavorTags": ["西幻", "黑暗"],
      "recommendValue": 1,
      "likeCount": 3,
      "likedBy": ["a1b2c3d4e5f6g7h8", "i9j0k1l2m3n4o5p6"],
      "summary": "适合短团的边境探索模组。",
      "coverPath": "/marketplace/covers/dhm_001.webp",
      "targetUrl": "https://example.com/feishu-link",
      "createdAt": "2026-06-02T10:00:00+08:00",
      "updatedAt": "2026-06-02T10:00:00+08:00"
    }
  ]
}
```

字段说明：

- `id`：条目唯一标识
- `title`：标题
- `author`：作者
- `contentTags`：内容标签数组，至少一个
- `flavorTags`：风味标签数组，可空
- `recommendValue`：管理员数值字段，首版使用 `0/1`
- `likeCount`：玩家点赞数，非负整数，由服务端自动维护（= `len(likedBy)`）
- `likedBy`：已点赞的 IP 哈希数组，如 `["abc123...", "def456..."]`。直接存储在条目中，无独立 `likes.json`。
- `summary`：简介，可空
- `coverPath`：封面访问路径
- `targetUrl`：点击卡片后的外链
- `createdAt` / `updatedAt`：用于后续排序或审计

> **2026-06-03 修正**：点赞记录不再使用独立的 `data/runtime/likes.json`，改为直接存入条目的 `likedBy` 字段。点赞数据随条目增删自动保持一致，无需额外清理逻辑。

## 7. 推荐目录结构

首版建议结构如下：

```text
/
├── AGENTS.md
├── CONTEXT.md
├── PLAN.md
├── frontend/
│   ├── index.html
│   └── admin/
│       └── index.html
├── server/
│   ├── __init__.py
│   ├── app.py
│   ├── requirements.txt
│   └── tests/
│       └── test_app.py
├── scripts/
│   └── check_python_syntax.py
└── data/
    ├── imports/                     # 外部导入的图片 + 备份 JSON
    └── runtime/
        ├── entries.json             # 运行期条目（含 likedBy）
        ├── covers/                  # 运行期封面
        └── secrets/                 # 口令与会话密钥
```

说明：

- `frontend/` 只放静态页面与前端逻辑
- `server/` 只放极小管理服务
- `data/runtime/` 放运行期条目数据、封面与密钥文件
- 若后续新增脚本，再单独评估是否建立 `scripts/`

## 8. 管理服务职责边界

Python 服务只负责最小必要功能：

- 校验访问口令
- 建立短期会话
- 返回当前条目数据
- 保存条目数据
- 上传封面文件
- 删除条目时同步删除服务器封面文件
- 玩家点赞计数与 IP 去重（`likedBy` 存储在条目 JSON 中，`likeCount = len(likedBy)`）

Python 服务不负责：

- 渲染首页 HTML
- 模板引擎页面系统
- 用户系统
- 评论系统
- 复杂数据库逻辑

## 9. 分阶段实施步骤

### 阶段 1：落规则与项目骨架 ✅ 已完成

### 阶段 2：定义 JSON schema 与样例数据 ✅ 已完成

### 阶段 3：实现首页桌面版 ✅ 已完成

### 阶段 4：实现搜索与标签筛选 ✅ 已完成

### 阶段 5：实现 admin 登录与会话 ✅ 已完成

### 阶段 6：实现条目增改删与封面上传 ✅ 已完成

### 阶段 7：接入 VPS 部署 ✅ 已完成

### 阶段 8：玩家点赞系统 ✅ 已完成 (2026-06-03)

目标：

- 实现纯点赞/取消点赞 toggle
- IP 哈希去重，无需登录
- 前端显示"已赞/点赞"状态
- 点赞计数写入 `entries.json` 的 `likeCount` / `likedBy` 字段
- 排序加权值 `recommendValue * 10 + likeCount`

验证：

- 后端 3 个新测试（`test_like_toggle_*`、`test_delete_entry_cleans_up_likes`、`test_public_bootstrap_includes_like_count`）全部通过
- 前端点击心形按钮可 toggle 状态，计数实时更新

### 阶段 9：首页推荐区（Spotlight） ✅ 已完成 (2026-06-03)

目标：

- 编辑推荐：`recommendValue > 0` 降序取前 4
- 社群匕选：`likeCount >= 2` 降序取前 4
- 分区重排 + 导航栏同步更新

验证：

- 编辑推荐区出现在最新收录下方
- 社群匕选区在编辑推荐下方
- 点赞后达到 2 个以上时社群匕选区出现该条目

## 10. 验证策略

每阶段都做可验证目标，不接受“只改代码不验证”。

建议验证方式：

- 前端：
  - 本地打开页面检查静态渲染
  - 检查搜索与筛选组合结果
- 服务端：
  - 用接口请求验证登录、保存、上传、删除
- 集成：
  - 增加一个样例条目，确认首页出现
  - 删除该条目，确认首页消失且封面文件删除

## 11. 风险与控制

### 11.1 标签自由输入带来的语义漂移

风险：

- 可能出现近义词并存，如 `西幻` 与 `西方奇幻`

控制：

- 首版先接受
- 后续如出现明显混乱，再追加同义词治理或标签整理工具

### 11.2 纯 JSON 的并发写入风险

风险：

- 多人同时编辑时可能覆盖

控制：

- 首版按低频单管理员维护场景设计
- 保存时尽量采用原子写入

### 11.3 首页编排未定 → 已解决 (2026-06-03)

风险已消除：

- 分区顺序已固定：最新收录 → 编辑推荐 → 社群匕选 → 战役框架 → 模组 → 玩家资源 → GM资源 → 扩展规则 → 其他
- 排序规则已确定：最新收录按 `updatedAt`，其余按 `recommendValue * 10 + likeCount` 加权

### 11.4 IP 去重的局限性

风险：

- IP 可能被更换、共享，或通过代理绕过
- 群友熟人圈刷票难以识别

控制：

- 首版不做复杂防刷票
- 发现明显刷票后再改算法（如引入衰减、权重修正）

## 12. 当前状态 (2026-06-03)

已实现：

1. ✅ 项目骨架与运行环境（Flask + Nginx + systemd）
2. ✅ 首页桌面版（卡片渲染、hover 简介、标签筛选、搜索）
3. ✅ 手机竖屏适配（360px+）
4. ✅ 管理入口（登录/会话、条目增改删、封面上传裁剪）
5. ✅ 玩家点赞系统（IP 哈希 toggle、`likedBy` 字段、加权排序）
6. ✅ 首页推荐区（编辑推荐 + 社群匕选）

待实现：

- 无
