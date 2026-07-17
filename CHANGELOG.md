# Daily changelog addendum

## 2026-07-17 - Complete review tracker and taxonomy follow-up

| Change | Files | Verification |
| --- | --- | --- |
| Replaced the tracker field select with a reviewSchema-based hierarchical field tree; added tracker reorder, pause/restore, multi-metric display, interval/range/deadline/period goals, reminder lead time, streak metrics, and correct structured mask path. | src/App.jsx, src/utils/plannerOverview.js, src/styles.css | node --test plannerOverview/reviewParser/plannerDropTarget/weeklySummary passed 27/27; build passed |
| Completed dynamic review project management with add, rename, drag/button order, pause, archive, and delete-with-history-protection semantics. | src/App.jsx | build passed |
| Added level-3 taxonomy drag, order-preserving normalization, and legacy ielts/english compatibility. | src/App.jsx | build passed |
| Added lightweight planner reviewPrefill for daily settlement import with source marker and final confirmation. | src/App.jsx | build passed |
| Extended weekly schema aggregation to all populated schema fields plus active dynamic projects; added weeklySummary unit coverage. | src/utils/weeklySummary.js, src/utils/weeklySummary.test.js, src/App.jsx | weeklySummary test passed |

Browser note: signed-in Firebase interaction could not be completed automatically in this environment; Vite/build and pure-function coverage passed, and the final online deployment remains the acceptance surface.

# Daily 变更日志

## 2026-07-17 — 分类、计划时长与复盘追踪统一

| 变更 | 文件 | 验证 |
| --- | --- | --- |
| 分类树扩展为可保存三级节点、关键词、启用与周表标记；任务选择改为一级→二级级联 | `src/App.jsx`, `src/services/dataService.js`, `src/services/demoStore.js` | production build |
| 计划进度按二级分类的真实时间线分钟汇总，并将目标保存在当天排程草稿 | `src/App.jsx`, `src/utils/plannerOverview.js` | Node 13/13 |
| 生活维护视图替换为只读的“复盘追踪”，新增复盘字段读取、事实和间隔状态纯函数 | `src/App.jsx`, `src/utils/plannerOverview.js` | Node 13/13 |
| 收窄桌面时间线并增大右侧追踪栏 | `src/styles.css` | production build |

### 追加：复盘追踪目标与动态项目

| 变更 | 文件 | 验证 |
| --- | --- | --- |
| 追踪器支持周期、间隔、范围、截止日、提醒、暂停和多指标数据计算 | `src/App.jsx`, `src/utils/plannerOverview.js` | Node 24/24 |
| 动态项目设置、模板注入与 Firebase/demo profile 持久化 | `src/App.jsx`, `src/utils/defaultReviewMarkdown.js`, `src/services/*` | production build |

## 2026-07-16 — 明日排程终版缺口修复（待提交）

| 变更 | 文件 | 已验证范围 |
| --- | --- | --- |
| 任务卡省略号改为非拖拽的“编辑任务 / 删除任务”菜单；删除先走既有确认交互 | `src/App.jsx`, `src/styles.css` | demo 浏览器：菜单打开和编辑入口；未删除示例任务 |
| 三个时段的状态统计复用引擎 `segmentFree`，固定事件从真实可用容量中扣除 | `src/App.jsx`, `src/utils/plannerOverview.js`, `src/utils/plannerOverview.test.js` | Node 固定通勤 fixture |
| 任务排入进度重组为分类容器 → 分类进度 → 任务组；学习环图图例补齐时长与百分比 | `src/App.jsx`, `src/styles.css`, `src/utils/plannerOverview.js` | Node 聚合测试；demo 浏览器结构和空态 |
| 分类排序纳入自定义分类；生活维护持续逐项显示，并可用 `maintenanceItemOrder` 仅排序展示 | `src/App.jsx`, `src/services/dataService.js`, `src/services/demoStore.js`, `src/utils/plannerOverview.js` | Node 排序兼容测试；demo 浏览器全部项目显示 |
| 压缩排程标题、快速调整、模板和工具栏的垂直空间 | `src/styles.css` | demo 浏览器首屏三栏主体 |

待本轮最终验证：真实 Firebase 登录数据、拖拽完整操作链和 Vercel 部署可用性不以 build 替代。

本文件只记录 2026-07-13 项目地图建立之后、已进入 Git `main` 的重要变更。实现状态以代码和提交为准；浏览器与生产数据验证不会因 build 通过而视为已完成。

## 2026-07-16 — 明日排程分类顺序与右栏概览（`a98022f`）

| 变更 | 文件 | 已验证范围 |
| --- | --- | --- |
| 增加 profile `plannerCategoryOrder`，可在任务池“调整分类顺序”中拖拽、保存或恢复默认；仅改变任务池、右栏进度/图例的视觉顺序，未知分类置后 | `src/App.jsx`、`src/utils/plannerOverview.js`、`src/services/dataService.js`、`src/services/demoStore.js` | demo 浏览器保存后刷新；纯函数排序测试 |
| 右栏新增系统状态与学习构成环图，按真实时间线 task blocks 与既有时段边界派生 | `src/App.jsx`、`src/styles.css`、`src/utils/plannerOverview.js` | period usage / study composition Node 测试；demo 零数据态浏览器验证 |

本轮 `pnpm.cmd run build` 通过，`node --test src/utils/plannerOverview.test.js` 6/6 通过，`git diff --check` 通过；demo 浏览器 Console error 为 `[]`。

## 2026-07-16 — 明日排程页第二轮 UI 收敛（待提交）

| 变更 | 文件 | 已验证范围 |
| --- | --- | --- |
| 三栏主区收敛为紧凑任务池、真实时间线、任务块排入进度/生活维护；移除右栏空档和完整未排任务清单，低频边界/模板/Prompt 移至高级设置弹窗 | `src/App.jsx`、`src/styles.css` | demo 浏览器首次进入、刷新、管理弹窗；控制台无 error |
| “已排入”按 `taskId` 和真实 timeline task blocks 聚合，与任务 completed 状态分离 | `src/utils/plannerOverview.js` | Node 纯函数测试 |
| 面膜和洗澡不再由排程器自动插入任务池/时间线；面膜从已保存结算 health 的真实结构化字段计算最近记录与 3 天到期日 | `src/App.jsx`、`src/utils/plannerOverview.js` | Node 日历日与无记录测试 |
| 增加生活维护提醒配置弹窗：启用、名称、间隔、提前提醒及自定义项；“今天记录”跳转既有每日结算入口，不创建虚假或局部结算记录 | `src/App.jsx`、`src/styles.css` | demo 浏览器管理入口 |

本轮 `pnpm.cmd run build` 通过，相关 Node 测试 44/44 通过，`git diff --check` 通过。真实登录 Firebase 数据与完整拖拽/撤销回归仍待线上确认。

## 2026-07-16 — 每日复盘 Markdown 与健康快捷卡片（未提交）

| 变更 | 文件 | 已验证范围 |
| --- | --- | --- |
| 固化最终确认的默认 Markdown 模板；新增按 H2/H3/字段/列表解析分支，保留项目与工作分离、雅思分项、专业课未知分项与原始 Markdown | `src/utils/defaultReviewMarkdown.js`、`src/utils/reviewParser.js` | parser Node 测试 5/5 |
| 结算页提供复制/恢复默认模板与结构化预览；重新识别保留既有网页健康数据 | `src/App.jsx` | build 通过 |
| 增加身体维护快捷项和经期进行中状态卡；配置项在 profile，完成项/当天可选症状在结算 health | `src/App.jsx`、`src/services/dataService.js`、`src/services/demoStore.js`、`src/styles.css` | build 通过；未完成浏览器刷新验证 |

本轮未调整积分公式、排程、Cyberboss、商城规则，也未做历史批量迁移。浏览器 E2E 受隔离浏览器无法访问宿主机 Vite 限制，未宣称通过。

## 2026-07-16 — 明日排程保存、边界与手动上传优化（未提交）

| 变更 | 文件 | 已验证范围 |
| --- | --- | --- |
| 草稿编辑即时写入本机恢复副本、1 秒防抖同步、手动保存；按有效目标日期和 `updatedAt` 选择本机/云端较新草稿 | `src/App.jsx`、`src/utils/plannerDraftRecovery.js`、`src/services/dataService.js` | `plannerDraftRecovery` 3/3；不含真实 Firebase/demo 刷新人工验证 |
| 主页面仅保留排程日期、实际开始、手动保存和 JXC 上传；生活时段移至折叠的固定边界设置 | `src/App.jsx`、`src/styles.css` | production build 通过 |
| JXC 上传当前加载 `targetDate`；未保存时可取消、直接上传或先保存再上传 | `src/App.jsx` | 复用 sender 单测 15/15；未进行接收端浏览器 E2E |
| 清空菜单增加当前时间前/后与任务池入口；局部范围优先使用锁定午间/晚间卡片，失败时显示默认边界依据 | `src/App.jsx` | build 通过；未进行拖拽与菜单浏览器回归 |
| 任务池按现有分类分组并显示真实段数、时长、优先级和偏好；右栏说明洗澡/面膜仅是计划，不等于结算完成 | `src/App.jsx`、`src/styles.css` | build 通过 |

本轮命令：`pnpm.cmd run build` 成功；`node --test src/utils/plannerDraftRecovery.test.js src/utils/plannerDropTarget.test.js src/agent/buildAgentDaySnapshot.test.js src/agent/catkeeperSnapshotSender.test.js` 共 38/38 通过；`git -c safe.directory='E:/Projects/小猫管家' diff --check` 通过。浏览器 E2E、真实 Firebase/demo 刷新持久化及 Cyberboss 接收端读取仍未验证。

## 2026-07-16 — 排程模型与交互稳定化

| Commit | 主要变化 | 文件 | 已记录验证 |
| --- | --- | --- | --- |
| `d79dff0` | 修复今日排程任务保存可靠性 | `src/App.jsx` | 未见本提交单独新增测试记录 |
| `4cbedf0` | 统一排程分类体系，并保留锁定模板行为 | `src/App.jsx` | 未见本提交单独新增测试记录 |
| `8f75e81` | 每日重置前归档旧草稿 | `src/App.jsx` | 未见本提交单独新增测试记录 |
| `881b82a` | 支持每日排程重置与当前时间展示 | `src/App.jsx`、`src/styles.css` | 未见本提交单独新增测试记录 |
| `5501dad` | 将锁定任务纳入固定硬边界 | `src/App.jsx` | 未见本提交单独新增测试记录 |
| `8ab002c` | 同步排程分类颜色 | `src/App.jsx` | 未见本提交单独新增测试记录 |
| `feaf431` | 对齐空档压缩与图表分类颜色 | `src/App.jsx` | 未见本提交单独新增测试记录 |
| `7928083` | 精简任务池交互：清空当天任务池、调整任务池/时间线移动路径与学习构成展示 | `src/App.jsx` | 未见本提交单独新增测试记录 |
| `cd4f534` | 改进模板删除/默认回退/系统模板恢复及分类分钟输入 | `src/App.jsx`、`src/styles.css` | 未见本提交单独新增测试记录 |

## 2026-07-16 — Agent Day Snapshot 数据层

| 变更 | 文件 | 已验证范围 |
| --- | --- | --- |
| 新增纯 AgentDaySnapshot 构建器与 Daily 内存数据适配器；不增加网络、Webhook、HTTP 服务或业务写入 | `src/agent/buildAgentDaySnapshot.js` | 16 项 Node 纯函数场景：时间线、当前/下一任务、完成统计、异常输入、复盘状态、Firebase/demo schema |
| 仅开发环境暴露按需控制台预览 `window.getDailyAgentDaySnapshot()` | `src/App.jsx` | 不在生产环境注册，不持续输出日志 |
| 增加快照测试并记录实际数据边界 | `src/agent/buildAgentDaySnapshot.test.js`、`docs/PROJECT_ATLAS.md`、`docs/STATUS.md` | 构建与 diff 检查见本轮最终验证；浏览器、Firebase/demo 刷新持久化未验证 |

## 2026-07-16 — Cyberboss 手动快照发送端

| 变更 | 文件 | 已验证范围 |
| --- | --- | --- |
| 新增浏览器 localStorage 连接配置、5 秒超时 sender、健康检查、手动 Snapshot 发送和安全结果映射 | `src/agent/catkeeperSnapshotSender.js` | 18 项要求场景覆盖于 15 项 Node 测试：配置、斜杠、health、授权、结果映射、超时、网络失败、输入不变、当前/明日日期和清除配置 |
| 设置页增加“纪雪尘 / Cyberboss 连接”区域；排程页通过 App 内存暂存当前加载快照供手动发送 | `src/App.jsx` | `npm run build` 通过；不写 profile/Firestore/demoStore |
| 新增 sender 测试并更新数据出口说明 | `src/agent/catkeeperSnapshotSender.test.js`、`docs/PROJECT_ATLAS.md`、`docs/STATUS.md` | sender 15/15、Snapshot 16/16、落点 4/4、diff check 通过；端到端未完成：宿主机 4319 未监听，隔离浏览器不能访问宿主机 Vite |

## 2026-07-14 — 结算精度与任务池拖放

| Commit | 主要变化 | 文件 | 已记录验证 |
| --- | --- | --- | --- |
| `b73a258` | 修复任务池未排入段产生 `NaN` 而无法生成落点/压缩预览的问题 | `src/App.jsx`、`docs/STATUS.md` | `pnpm run build`、`node --test src/utils/plannerDropTarget.test.js` 通过；浏览器未验证 |
| `afe1c47` | 让任务池拖放复用时间线交互计划，支持交换、插入和空档压缩 | `src/App.jsx`、`docs/STATUS.md` | `pnpm run build`、`node --test src/utils/plannerDropTarget.test.js` 通过；浏览器与刷新持久化未验证 |
| `4f6d419` | 结算分钟改为 1 分钟精度；积分两位小数归一化；结算页加入实时 Today Summary | `src/App.jsx`、`src/services/dataService.js`、`src/utils/calculations.js`、`src/styles.css`、`docs/STATUS.md` | `pnpm run build` 通过；浏览器、持久化与生产 Firebase 未验证 |

## 2026-07-13 — 任务池落点基础修复

| Commit | 主要变化 | 文件 | 已记录验证 |
| --- | --- | --- | --- |
| `e02f870` | 统一任务池时间线预览和空档压缩选择 | `src/App.jsx`、`docs/STATUS.md` | `pnpm run build`、`node --test src/utils/plannerDropTarget.test.js` 通过；浏览器未验证 |
| `ed0e426` | 稳定短任务完成命中区与任务池实时落点，并新增落点纯函数测试 | `src/App.jsx`、`src/styles.css`、`src/utils/plannerDropTarget.js`、`src/utils/plannerDropTarget.test.js`、`docs/STATUS.md` | Node 测试 4/4 与 build 通过；无 E2E |

## 未改变的边界

- 本仓库没有对 Cyberboss 或其他外部代理公开的业务 API、CLI、Webhook、Cloud Function 或服务端接口。
- React UI 通过 `src/services/dataService.js`（Firebase）或 `src/services/demoStore.js`（demo mode）执行持久化；它们是前端内部模块，不是可认证、可稳定调用的外部接口。
- 因此外部自动化若要操作现有能力，只能通过已登录浏览器 UI；直接读写 Firestore、调用前端内部函数或访问真实用户数据均不属于已提供的接口能力。
# 2026-07-17 — 定稿复盘母版与排程布局收敛（待提交）

| 范围 | 实际改动 |
| --- | --- |
| 复盘 | 新增共享 `reviewSchema`，默认 Markdown 改为定稿母版，解析器保留结构化 `reviewData` 和旧结算字段兼容。 |
| 排程 | 时间线恢复为优先工作区，右栏收窄并移除系统状态；计划目标可按二级分类勾选并分别设置。 |
| 验证 | `node --test src/utils/reviewParser.test.js` 6/6 与 `pnpm.cmd run build` 通过。 |
