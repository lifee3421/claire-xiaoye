# Daily 当前状态

## 2026-07-17 定稿复盘 Schema 与排程工作区收敛

- 默认 Markdown 已切换为定稿母版：英语统一为二级分类，五个英语子项使用四空格缩进；不再包含单词数量或旧的“完成情况”模块。
- `reviewData` 是新保存结算中的结构化复盘载体；旧 `subjects` 等兼容字段仍保留，避免历史结算、积分和旧周表断裂。`reviewSchema` 为新复盘字段、追踪器选择器提供同一稳定字段目录。
- 排程右栏已移除“系统状态”；保留学习构成、按二级分类的计划时长目标与只读复盘追踪。时间线有更大的最小宽度，窄屏以横向滚动代替压缩。
- “编辑目标”允许按当前日期勾选多个二级分类并逐项设置分钟；计划分钟仍不作为实际完成记录。
- 完整动态项目管理、分类全层级拖拽、追踪器的自然周期/截止日完整编辑与周表三级可视化仍待后续实现。

- 分类树保留三级节点、稳定 ID、关键词、启用状态与周表标记；旧任务继续通过既有二级 `categoryId` 兼容显示。
- 任务编辑与新增使用一级→二级级联选择；时间线按 `categoryLevel2Id` 汇总计划分钟，不再从标题推断分类。
- 排程草稿新增随目标日期保存的 `categoryTargets`；右栏“计划时长进度”显示已排时长、目标和差额，不把计划写成实际完成。
- “复盘追踪”只读取结算/复盘结构化字段；没有复盘时显示“暂无记录”，没有快捷完成或排程页补记录。
- 当前已验证纯函数和 production build；自然周期/截止日期的完整编辑控件、周大表三级展示、Firebase 真实数据与完整浏览器交互仍待后续回归。

## 2026-07-16 明日排程终版缺口修复

- 任务池卡片的省略号已改为“编辑任务 / 删除任务”菜单；删除仍复用确认交互，菜单指针事件不会启动拖拽。
- 系统状态的上午、下午、晚上容量现在直接读取排程引擎 `segmentFree` 的 `availableMinutes` 与 `scheduledTaskFootprintMinutes`，固定事件已在分母中扣除。
- 右栏“任务块排入进度”按分类容器和任务组两层显示；学习环图图例显示分类、真实已排时长与占比。
- 分类目录合并默认分类、任务池分类、保存顺序和自定义分类；生活维护项目始终逐项显示，并以 `maintenanceItemOrder` 保存仅影响展示的排序。
- 已新增相关 Node 纯函数覆盖；demo 浏览器已验证菜单、编辑入口、固定块扣减后的状态展示、环图空态、层级进度与全部生活维护项。真实 Firebase 登录数据和在线部署仍待验收。

## 1. 状态元信息

- 更新日期：2026-07-16（Asia/Shanghai）
- 当前分支：`main`
- 当前代码基线：`a98022f`（`add planner category ordering and status`）。
- 本次文档基于：`AGENTS.md`、`docs/PROJECT_ATLAS.md`、当前 HEAD 源码和 Git 历史；未读取 `.env` 或真实用户数据。
- 当前工作树在文档更新前已有用户修改 `AGENTS.md` 与未跟踪 `.obsidian/`，本文件不涉及二者。

## 2. 系统当前概况

- 当前有 13 个主要工作区：首页、每日结算、明日排程、商城、目标估算、周总结、英语、日记、图书馆、数学、专业课、历史记录、设置。
- 技术栈是 React + Vite + JavaScript；云端主路径为 Google Auth + Firestore，未配置时使用 localStorage demo store。
- 主业务领域：复盘/结算、积分奖励、学习进度、日记/阅读、周总结/健康、排程。
- 最大技术风险：`src/App.jsx` 单体耦合、排程交互近期高频修正、缺少浏览器 E2E、Firestore 安全规则未纳入仓库。

## 3. 当前已实现的主链路

- 每日 Markdown 复盘解析、结算、积分、历史撤回/回滚；结算分钟输入支持 1 分钟精度。默认 Markdown 已固定为“学习→项目→工作→运动→家庭→杂项→昨日睡眠→娱乐→总结收尾”，身体维护和经期仅由网页卡片记录。
- 结算页实时 Today Summary：以未保存表单重算概览、时间结构、目标/状态和积分明细。
- 积分在读取、结算、兑换、回滚、结项奖励、段目标奖励与设置写入中统一归一化到两位小数。
- 奖励商城、商品/分类管理、兑换、开发愿望和 Bug 愿望单。
- 数学进度、专业课进度、英语结算追踪；周总结、二级分类、健康洞悉和 CSV 导出。
- 日记档案、阅读图书馆与结算自动同步主链路。
- Firebase UID 路径隔离与 demo mode 的基础持久化。

“已实现”表示代码中存在可达 UI 与数据读写闭环，不表示跨设备、浏览器交互和生产环境已被全面验证。

## 4. 排程系统当前能力与限制

| 能力 | 当前状态 | 代码事实/限制 |
| --- | --- | --- |
| 任务池 | 已实现 | 可新增、编辑、排序、删除单项或清空当天待安排段；操作仅写当日草稿，不反向改模板。 |
| 时间线与拖拽 | 部分实现 | 任务池拖入时间线使用实时指针坐标；预览与提交复用移动 plan，支持精确放置、交换、插入与顺延；无浏览器 E2E。 |
| 空档压缩 | 部分实现 | 空档不足时可选保留休息或不休息，结果填满当前空档；已有 Node 纯函数/落点边界测试，但无完整交互测试。 |
| 锁定/完成/固定事件 | 已实现，需人工回归 | 锁定任务、锁定固定事件、完成历史与 bedtime 作为硬边界；锁定任务不应被自动排程或普通移动改变。 |
| 日切与今日草稿 | 已实现，需刷新验证 | 跨日或过期草稿先归档到 profile 的 draft archive，再重置当天草稿；未做真实 Firebase/demo 刷新验证。 |
| 模板 | 部分实现 | 支持新建、复制、编辑、默认、应用、删除与恢复系统默认；删除系统模板通过持久化删除标记避免自动回补。模板隔离和新 ID 不变量仍需真实数据验证。 |
| 自动排程/局部重排 | 部分实现 | 有算法、预览、局部清空与恢复模板初始状态；复杂冲突、偏好组合和触屏仍缺自动化覆盖。 |
| 撤销/重做 | 部分实现 | 有会话内 stack；不跨刷新或设备。 |
| 保存与刷新恢复 | 已实现，需浏览器回归 | 修改即时写入按 profile 隔离的本机恢复副本，1 秒防抖同步 profile；手动保存可立即 flush。恢复仅在目标日期仍有效且本机 `updatedAt` 更新时采用，本机较旧时保留云端草稿。 |
| 手动 JXC 上传 | 已实现，需端到端回归 | 排程页可上传当前加载的目标日期；有未保存修改时可取消、直接上传内存计划或先保存再上传。不会改变任务、积分或复盘。 |
| 排程三栏信息收敛 | 已实现，需真实登录数据回归 | 任务池卡片压缩为块数、节奏、连续组和优先级；右栏改为“已排入时间线”的任务组聚合进度与生活维护，不再列空档或完整未排任务。 |
| 生活维护提醒 | 部分实现 | 面膜不再自动加入任务池或时间线；提示读取已保存结算 `health.maskStatus` / `health.maintenanceCompleted`，默认按 3 个日历日计算。完成记录仍须在每日结算页面填写。 |
| 任务池分类顺序 | 已实现，需真实登录数据回归 | profile `plannerCategoryOrder` 只控制任务池、右栏任务进度与学习图例的视觉顺序；不改变 P1/P2/P3 或自动排程。未知分类排最后，可在排程页拖拽、保存或恢复默认。 |
| 排程系统状态/学习构成 | 已实现，需真实计划回归 | 右栏从真实时间线 task blocks 派生总可支配、已排时长、块数和上午/下午/晚上占用；学习构成按已排学习任务的分类与时长绘制。 |

## 5. 测试与验证现状

- 现有直接测试：`node --test src/utils/plannerDropTarget.test.js`，覆盖实时指针、滚动偏移、时间线边界与非法输入，共 4 例。
- npm 脚本只有 `dev`、`build`、`preview`；没有 `check`、`test`、lint、typecheck 或 E2E 脚本。
- 历史记录显示：上述 Node 测试与 `pnpm run build` 曾在 2026-07-13/14 的排程改动后通过。
- 本轮排程优化已执行 `pnpm.cmd run build` 成功；Node 直接测试 `buildAgentDaySnapshot` 16/16、`catkeeperSnapshotSender` 15/15、`plannerDraftRecovery` 3/3、`plannerDropTarget` 4/4，共 38/38 通过。build 仍提示单个 JS chunk 超过 500 kB。
- build 与 Node 测试不等于拖拽、刷新持久化、Firebase 或 demo mode 已验证；这些浏览器场景本次未运行。

## 6. 已确认产品决策与未来规划

| 决策/规划 | 当前状态 |
| --- | --- |
| 模板是跨日期长期复用资产 | 部分实现；现有模板不保存执行历史或 Undo/Redo，深拷贝、新 ID 与隔离仍需验证。 |
| 多设备冲突提示“加载云端 / 坚持覆盖” | 已确认待实现；当前无版本检测或冲突选择 UI。 |
| 数学与专业课统一为项目管理 | 未来规划；当前仍为两个页面、两个集合、两个目录模型。 |
| 项目目录导入先预览再原子写入 | 未来规划；尚无接口或实现。 |
| 手工编辑日记受同步保护 | 部分实现；字段和策略存在，但默认保护语义仍需收紧和验证。 |
| 白天即时娱乐日志下线，旧数据保留 | 已确认待清理；当前仍有 `entertainmentLogs`、首页入口、订阅和 service。 |
| Firestore 安全规则、备份与恢复 | 已确认待实现；仓库无规则文件、备份或恢复入口。 |

## 6.1 每日复盘 Markdown 与健康卡片

- 默认模板位于 `src/utils/defaultReviewMarkdown.js`；页面可复制或恢复该模板。解析以标题层级和标题文字为主，不依赖 emoji，兼容列表前的 2–8 个空格或 Tab。
- 学习的稳定内部字段为 `math`、`economy`、`english`、`ielts`、`japanese`、`reading`；项目是独立 `projects[]`，工作仍是 `subjects.work`，因此不会混合。专业课未知分项会保留在 `subjects.economy.courseProgress`，项目 H3 直接是项目名称。
- 空字段不保存为内容；原始 Markdown 保存在 `rawReview`，预览会显示未识别 H3 与分项总时长不一致提示。Markdown 重新识别不会覆盖 `health` 内的身体维护或经期字段。
- 身体维护快捷项保存在 profile 的 `healthMaintenanceItems` 配置；当天已点亮项保存在结算 `health.maintenanceCompleted`。内置项是面膜、基础护肤、拉伸、泡脚，可在设置改名、隐藏、增加/删除自定义项。
- 经期周期状态保存在 profile `periodCycle`（`active/inactive`、开始/结束日期）；当天可选经量、不适与备注保存在结算 `health.period`。周期进行中自动按开始日期计算天数；结束可在当前页面撤销。两者不参与积分口径。

## 7. Agent Day Snapshot 数据层

- 已实现：[src/agent/buildAgentDaySnapshot.js](../src/agent/buildAgentDaySnapshot.js) 提供纯 `AgentDaySnapshot` 构建器及 Daily 内存数据适配器；单测在 [src/agent/buildAgentDaySnapshot.test.js](../src/agent/buildAgentDaySnapshot.test.js)。
- 时间线来自排程组件已生成的 `autoSchedule.blocks`，计划更新时间来自已保存草稿的 `scheduleAssistantDraft.updatedAt`；两种模式均使用同一输入语义，`source.mode` 区分 Firebase/demo。
- 快照包含计划日期、生成时间、计划更新时间、时间线、钟表当前块、下一任务、任务完成统计、复盘状态和来源元数据；不含复盘正文、用户标识、积分写入或网络发送。
- 当前实际只能可靠输出 `pending`/`completed` 任务状态和 `submitted`/`not_started` 复盘状态。`moved`、`skipped`、持久化 review draft、计划 revision 都不存在或不可可靠读取，分别映射为 `null`、不输出或 `null`。
- 开发环境控制台执行 `window.getDailyAgentDaySnapshot()` 可按需查看；生产环境没有该调试出口。

## 8. Cyberboss 手动发送与本机连接

- 已实现：[src/agent/catkeeperSnapshotSender.js](../src/agent/catkeeperSnapshotSender.js) 以及设置页“纪雪尘 / Cyberboss 连接”区域。连接配置仅保存在当前浏览器 `localStorage` 的 `daily_catkeeper_connection_v1`，不写 profile、Firestore 或 demoStore。
- 可手动测试 `GET /events/catkeeper/health`，也可从设置页或排程页手动发送当前已加载排程的 Snapshot 到 `POST /events/catkeeper/day-snapshot`。排程页上传会保留当前 `targetDate`，有未保存修改时提供“取消 / 直接上传 / 先保存再上传”。地址默认 `http://127.0.0.1:4319`，token 为 password 输入且不输出到日志或状态文案。
- sender 有约 5 秒超时、末尾斜杠清理和结果映射；没有无限重试、自动监听保存、任务完成/拖拽/结算联动或后台队列。浏览器关闭后不会发送。
- 当前宿主机 Vite 可访问 `127.0.0.1:5173`，但本次验证时 4319 未监听；隔离浏览器也无法连接宿主机 Vite，因此真实浏览器发送和接收端读取尚未完成验证。

## 9. 外部调用边界

- 当前没有小猫管家对外提供的 Cyberboss 专用工具、REST/GraphQL API、Webhook、CLI、Cloud Function 或入站业务接口；仅新增浏览器到本机 Cyberboss 的手动出站 sender。
- 可经 UI 使用的能力包括：结算、Today Summary、积分/兑换、排程任务池/时间线/模板、学习进度、日记、阅读和周总结。
- `dataService.js` 与 `demoStore.js` 是 React 前端内部持久化模块，不构成外部接口；外部自动化如需操作现有功能，只能使用已登录浏览器 UI。
- 直接读写 Firestore、调用内部 JS 函数、读取本地 demo 数据或操作真实用户数据都不是已暴露接口。

## 10. 最近关键提交

| Commit | 内容 |
| --- | --- |
| `d79dff0` | 修复今日排程任务保存可靠性。 |
| `4cbedf0` | 统一排程分类与锁定模板行为。 |
| `8f75e81` | 每日重置前归档排程草稿。 |
| `881b82a` | 每日排程重置与当前时间展示。 |
| `5501dad` | 将锁定任务作为固定硬边界。 |
| `8ab002c`、`feaf431` | 分类颜色、空档压缩与图表显示对齐。 |
| `7928083`、`cd4f534` | 任务池交互与模板删除/恢复规则改善。 |
| `b73a258`、`afe1c47`、`4f6d419` | 任务池预览/压缩修复，以及结算精度、积分归一化和 Today Summary。 |

## 11. 下一轮开始前检查

1. 阅读 `AGENTS.md`、`docs/PROJECT_ATLAS.md`、本文件和 `CHANGELOG.md`。
2. 查看最新 commit、Git 状态和生产部署版本。
3. 审计当前需求相关的真实实现、数据读写和入口。
4. 排程改动至少运行 build、相关 Node 测试，并分别人工验证拖拽、刷新恢复与 Firebase/demo mode。
5. 不从旧对话、旧按钮文案或旧状态记录假设某项已完成。
