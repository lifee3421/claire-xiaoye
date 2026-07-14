# Daily 当前状态

## 1. 状态元信息

- 更新日期：2026-07-13（Asia/Shanghai）
- 当前分支：`main`
- 当前 commit：本轮“统一任务池目标预览与空档压缩选择”提交（提交后以 Git 记录为准）。
- 最近产品代码提交：`ed0e426`，用户已推送；本轮尚未推送或触发部署。
- 文档依据：`AGENTS.md`、`docs/PROJECT_ATLAS.md`、当前源码与 Git 历史。

## 2. 系统当前概况

- 当前有 13 个主要工作区：首页、每日结算、明日排程、商城、目标估算、周总结、英语、日记、图书馆、数学、专业课、历史记录、设置。
- 技术栈是 React + Vite + JavaScript；云端主路径为 Google Auth + Firestore，未配置时使用 localStorage demo store。
- 主业务领域：复盘/结算、积分奖励、学习进度、日记/阅读、周总结/健康、排程。
- 最大技术风险：`src/App.jsx` 单体耦合、排程交互近期高频修正、缺少自动化测试、Firestore 安全规则未纳入仓库。

## 3. 当前稳定模块

下列模块具备可达 UI、数据读写闭环和当前代码证据：

- 每日 Markdown 复盘解析、结算、积分、历史撤回/回滚。
- 奖励商城、商品/分类管理、兑换、开发愿望和 Bug 愿望单。
- 数学进度、专业课进度、英语结算追踪。
- 周总结、二级分类、健康洞悉、CSV 导出。
- 日记档案、阅读图书馆、结算自动同步的主链路。
- 首页目标、段目标、结项奖励、自由娱乐积分规则。
- Firebase 用户隔离路径和 demo mode 的基础持久化。

“稳定”仅代表代码闭环已存在，不代表已经完成全面跨设备或自动化测试。

## 4. 当前部分实现或高风险模块

| 模块 | 当前状态 | 风险/限制 |
| --- | --- | --- |
| 明日排程 | 部分实现 | 有任务池、时间线、拖拽、压缩、锁定、Undo/Redo；短任务完成框已改为独立高层命中区，任务池落点改用实时指针坐标，仍需持续桌面/触屏人工验证。 |
| 时间线拖拽 | 部分实现 | 预览与提交复用同一 preview plan；任务池落点有 Node 纯函数边界测试，但仍没有 E2E 覆盖。 |
| 模板 | 部分实现 | 有模板管理、应用与兼容转换；尚未确认是否完整共享 PlannerWorkspace 的所有能力。 |
| 自动排程 | 部分实现 | 有算法和恢复预览；复杂冲突/偏好组合缺少自动测试。 |
| 日记同步保护 | 部分实现 | `manuallyEdited`、覆盖/补标签/取消策略和重同步提示存在；结算页默认策略仍为 `overwrite`，不等于默认保护。 |
| 状态管理 | 高风险 | 大量领域状态集中在 `src/App.jsx`；profile 还承载排程草稿，跨设备并发可能最后写入胜出。 |
| 测试 | 部分实现 | 新增 `node --test src/utils/plannerDropTarget.test.js` 覆盖任务池落点坐标、滚动、边界和非法值；仍无 lint、typecheck 或 E2E 脚本。 |

### 本轮轻量修复

- 任务池仅在真实命中时间线时生成统一的时间线目标预览；有效预览出现后隐藏外层任务池 DragOverlay，避免顶部第二张幽灵卡。
- 当任务池任务拖入真实空档且空档不足时，弹出两键选择：保留原休息（工作压缩为“空档-休息”）或不休息（全部空档为工作）；两种结果都严格填满当前空档，只写入当天当前 segment。
- 已验证：`node --test src/utils/plannerDropTarget.test.js` 4/4 通过，`pnpm run build` 通过。
- 尚未验证：浏览器没有当前用户登录会话，未以真实排程数据完成拖入、取消和持久化人工测试；仍无 E2E 覆盖。

## 5. 已确认产品决策

| 决策 | 状态 | 当前落点 |
| --- | --- | --- |
| 模板是跨日期长期复用资产 | 部分实现 | 当前有模板和“应用到今天”机制；完整隔离与新 ID 不变量应继续核验。 |
| 多设备冲突提示加载或覆盖 | 已确认待实现 | 当前无版本检测/冲突选择 UI。 |
| 数学与专业课统一为项目管理 | 已确认待实现 | 当前仍为两个页面、两个集合、两个目录模型。 |
| 项目目录快捷导入须预览确认后写入 | 已确认待实现 | 后续支持格式待定：Markdown、纯文本、CSV、JSON。 |
| 手工编辑日记受同步保护 | 部分实现 | 字段和策略存在，但默认保护语义仍需收紧并验证。 |
| 白天即时娱乐日志下线，旧数据暂留 | 已确认下线，待清理 | 当前仍有 `entertainmentLogs`、首页快捷入口、订阅和 service。 |
| Firestore 安全规则、手动备份、恢复说明/入口 | 已确认待实现 | 仓库无规则文件；无备份与恢复产品入口。 |

## 6. 已确认待实现事项

1. 多设备版本冲突检测与“加载云端 / 坚持覆盖”选择。
2. 统一项目管理数据模型：分类 -> 项目 -> 分组/章节/阶段 -> 条目。
3. 项目分类、项目、层级条目的快速新增、编辑、隐藏、排序和完成日期。
4. 目录/大纲拖拽导入：解析预览、用户修订、确认后原子写入、失败不留半成品。
5. 日记手工编辑保护：默认不静默覆盖，并补充完整验证场景。
6. 白天娱乐日志的引用审计和独立下线清理；旧 Firestore 数据只保留，不物理删除。
7. Firestore 安全规则纳入仓库并明确 UID 路径访问策略。
8. 手动导出备份、恢复说明和基础恢复入口。
9. 模板是否已完整共享 PlannerWorkspace，若否补足隔离、深拷贝和 ID 规则。

## 7. 当前不应继续投入的旧路径

- 不再把白天即时娱乐日志发展为娱乐总量的权威来源。
- 不继续把数学和专业课发展为两套完全独立的长期框架；新增长期进度需求应先考虑统一项目管理方向。
- 不未经审计继续扩大重复 Firebase 初始化；`src/lib/firebase.js` 当前疑似未引用，`src/services/firebase.js` 是主路径。
- 不以旧需求文档或旧按钮文案判断当前功能状态。

## 8. 推荐开发顺序

这是风险与依赖导向的建议，不是固定路线，后续由用户按需求调整。

1. 当前排程交互稳定与真实浏览器验证。
2. 模板完整共享 PlannerWorkspace 与隔离规则核验。
3. 数据安全基础层：Firestore 规则、手动备份、恢复说明/入口。
4. 统一项目管理的数据模型设计，先不迁移历史数据。
5. 数学/专业课数据迁移方案与兼容验证。
6. 目录快捷导入的预览确认流程。
7. 白天娱乐日志下线清理。
8. 拆分 `src/App.jsx` 与补充自动化测试。

## 9. 最近关键提交

| Commit | 内容 | 备注 |
| --- | --- | --- |
| `ed0e426` | fix: stabilize short planner tasks and pool drops | 短任务完成框与任务池真实落点修复，用户已推送。 |
| 本轮提交 | unify pool timeline preview and gap compression choices | 尚未推送。 |
| `9cbc6eb` | refine timeline drop interactions | 最近产品代码提交，已推送。 |
| `93f1424` | rebuild planner template isolation | 模板隔离重构基线。 |
| `24cc50e` | add automatic schedule timeline | 自动时间线主干。 |
| `c993dc6` | redesign weekly review dashboard | 当前周总结布局演化节点。 |
| `c9ba7da` | sync diary entries from settlements | 结算同步日记主链路。 |
| `1831f9a` | initial xiaoye reward app | 初始奖励银行。 |

## 10. 下一轮开始前检查

1. 阅读 `AGENTS.md`、`docs/PROJECT_ATLAS.md`、本文件。
2. 查看最新 commit、Git 状态和生产部署版本。
3. 审计当前需求相关的真实实现、数据读写和入口。
4. 不从旧对话假设某项已完成。
5. 有代码改动时，按 `AGENTS.md` 运行 build、相关测试和针对性浏览器验证。

## Latest: Daily settlement precision and summary

- Settlement actual-minute inputs for effective study, exercise, and actual entertainment now use `min=0` and `step=1`; planner inputs keep their existing 5-minute behavior.
- Added shared two-decimal point normalization for displayed balances, demo-store writes, and Firebase settlement, redemption, rollback, project reward, schedule reward, and settings writes. Existing balances are normalized when read; historical collections are not batch-migrated.
- Replaced the settlement right rail with a live Today Summary: overview, weekly-summary-backed primary/secondary time breakdown, goal/status, and collapsed point details. It recomputes from the unsaved settlement form.
- Verified: `cmd.exe /d /c pnpm run build` passes after the implementation. The previous direct planner drop target test is unrelated and was not rerun.
- Not verified: browser interaction and persistence scenarios could not be run because this execution environment could not reach the local Vite port; no production Firebase data was written. No new E2E coverage was added.
- Latest commit: `fix: improve settlement precision and live summary` (this change).

## Latest: Pool-to-timeline drop parity and gap compression

- Pool drags now reuse the existing timeline interaction plan and preview surface for exact placement, conflicts, before/after insertion, ripple, and same-length replacement.
- A same-length pool replacement places the pool segment on the timeline and returns the displaced timeline segment to the task pool in one draft update.
- Pool drags into a too-short real gap, including one ending at a fixed or locked boundary, now enter the existing compression flow with keep-rest and no-rest choices.
- Verified: `pnpm run build` and `node --test src/utils/plannerDropTarget.test.js` pass.
- Not verified: browser drag interactions and persistence refresh were not run; the local Vite server did not become reachable in this execution environment. No production data was written.
- Latest commit: `fix: complete pool timeline drop preview` (this change).
