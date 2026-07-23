# 每日复盘工作台 Phase 1 审计与补修清单

审计基线：`ade9e420f9363524fb29bef9558637186e304fcf`

结论：当前提交完成了可运行的结构化表单雏形，但**尚未达到 Phase 1 可合并标准**。不得合并 `main`，先完成本清单中的 P0/P1 补修。

## P0：会造成数据丢失、重复结算或旧功能失效

### 1. 切换到已有结算日期时没有加载原数据

现状：

- `DailyReviewWorkbench.changeDate()` 只调用 `createReviewDraft(date)`。
- `existingSettlement` 仅用于判断“修订”，没有把 `structuredReview` / `reviewData` / `dailyReviewDraft` 恢复进表单。
- 因此打开已有结算日时表单是空白，但点击保存会进入 `reviseSettlement`，可能用空白结构覆盖原结算并扣回积分。

必须修复：

1. 优先加载该日期的 `dailyReviewDraft`。
2. 没有 draft 时，从已有 `settlement.structuredReview` 恢复。
3. 仅旧 settlement 时，从 `rawReview/reviewData/subjects/health/state` 迁移恢复。
4. 数据加载完成前禁用保存。
5. 增加“打开已有结算日 → 字段完整恢复 → 修订不丢数据”测试。

### 2. 未订阅和读取 `dailyReviewDrafts`

现状：保存时会写 `dailyReviewDrafts/{date}`，但 `subscribeUserData` 没有订阅该集合，页面也没有 draft service。当前 draft 只存在 React 内存中，刷新或离开页面即丢失。

必须修复：

- 新增 `src/services/reviewDraftService.js`。
- 订阅或按日期读取 `dailyReviewDrafts/{date}`。
- 编辑过程中防抖保存草稿；不改变积分。
- 提交后把同一 draft 标为 `submitted` 并写入 `linkedSettlementId`。

### 3. 保存函数未等待异步结果，且没有防重复提交

现状：

- `submit()` 不是 async。
- 调用 `onSubmit()` 后立即把本地状态标为 submitted。
- 没有 saving 状态、按钮禁用和幂等保护。
- Firebase 订阅返回前连续点击可能创建多条同日 settlement。

必须修复：

- `await onSubmit(...)`。
- 保存期间禁用所有保存按钮。
- 保存失败不得标记 submitted。
- Firestore 层按日期幂等：同一日期只能有一个 settlement，不能仅靠前端 `find()`。
- 增加连续双击保存测试。

### 4. 新 schema 路径与现有稳定 schema 不兼容

现状使用了显示中文作为字段路径，例如：

- `study.math.总时长`
- `study.economy.总时长`
- `work.redcross.总时长`
- `health.基础护肤`

但现有 `src/utils/reviewSchema.js` 已定义稳定路径，例如：

- `study.math.totalMinutes`
- `study.professional.corporateFinance.duration`
- `work.redCross.totalMinutes`
- `selfcare.today.basicSkincare`

这会造成追踪器、周总结、旧解析器和后续 TickTick 映射存在两套 schema。

必须修复：

- 复用并扩展现有 `reviewSchema.js`，不要新建中文路径体系。
- label 只用于显示，不能作为持久化 key。
- 提供一次仅针对当前 feature 分支草稿的迁移函数。

### 5. Markdown 导出不完整，不能称为兼容导出

现状 `buildReviewMarkdown()` 只输出：

- 学习总时长
- 娱乐总时长
- 睡眠少数字段
- 日记

缺少原模板绝大部分字段，包括各学科分项、推进、调整、项目、工作、家庭、杂项、运动、个护、状态和评分总结。

必须修复：

- 按 `DEFAULT_REVIEW_MARKDOWN` 的完整结构生成。
- 页面中的每个字段都必须可在 Markdown 中往返。
- `结构化 → Markdown → 旧 parser` 后关键字段不丢失。
- 补完整往返测试。

### 6. 旧日记冲突保护被绕过

现状新页面固定传 `strategy: "overwrite"`，没有检查当天日记是否被手动编辑，可能覆盖日记档案中的人工内容。

必须修复：

- 恢复现有“覆盖 / 只补标签 / 取消”策略。
- 无正文不创建空日记。
- 先保存 settlement，再执行可重试的日记同步；局部失败不回滚 settlement。

### 7. 阅读同步链路断开

现状结构化适配只把阅读数据放在 `subjects.reading`，但 `handleSettlementSubmit` 使用顶层 `settlement.readingMinutes` 与 `readingBookTitle` 判断是否同步，因此阅读不会自动进入图书馆。

必须修复：

- 适配器同时提供兼容顶层字段。
- 复用现有 `buildReadingEntryFromSettlement` 与同步链路。
- 增加阅读填写 → 保存 → 同步调用测试。

### 8. 数学与专业课进度同步入口消失

现状 App 仍传入相关 props，但 `DailyReviewWorkbench` 不接收也不使用，旧页面的进度识别与同步能力实际被移除。

Phase 1 处理方式二选一，必须明确：

A. 保留兼容入口：从结构化“今日推进”提取并显示确认后同步；或
B. 暂时提供“本轮尚未迁移，返回旧入口”明确入口，不能静默删除功能。

推荐 A，复用现有提取与保存函数，不重写课程目录逻辑。

## P1：积分与业务规则不完整

### 9. 出游日被硬编码为 false

`reviewPointsAdapter` 中 `classifyDay({ ..., isTravelDay: false })` 且返回值也固定 `isTravelDay: false`，导致原有出游日手动奖励消失。

必须：

- 在评分/总结或结算区保留“今天是出游日”开关。
- 使用 profile 中现有 `travelDayBonusPoints`。
- 不得默认为 true。

### 10. 复盘及时奖励被重新硬编码

现状使用：

```js
draft.date === today ? 1 : 0.5
```

必须复用现有 `reviewTimelinessScore`，不得在适配器重写规则。

### 11. 修订 settlement 时没有同步全部 profile 派生状态

`createSettlement` 会更新：

- nextDay entertainment 字段
- maskCycle
- lastMaskDate
- todayBalanceMinutes

但 `reviseSettlement` 目前只更新 points、todayBalanceMinutes。修改娱乐、日型、面膜后 profile 可能与结算不一致。

必须：

- 抽取共享 `buildSettlementProfilePatch()`。
- create 与 revise 共用。
- revision 只将 points 改为“当前 points + delta”，其余派生状态按新结算覆盖。

### 12. 个护字段兼容映射错误/不足

现状输出 `health.baseSkincare`，旧逻辑使用 `basicSkincareDone`；经期也没有生成现有 period 结构。

必须：

- 使用现有 `mergeHealthForm` 兼容字段。
- 基础护肤、面膜、经期、喝水字段与旧 settlement/周总结保持兼容。
- 保留面膜周期计算。

### 13. 积分预览被过度简化

当前仅显示一行合计，原有结算页已有完整积分明细。必须恢复：

- 学习入账
- 运动入账
- 时间价值转分
- 睡眠积分
- 运动额外积分
- 工作积分
- 日型额外奖励
- 自由娱乐积分
- 复盘归档奖励

公式只能来自现有函数。

### 14. 缺少底部冻结结算条

规格要求底部轻量冻结条，当前只有普通静态 section。

必须显示：

- 预计积分
- 保存后余额
- 查看明细
- 保存/修订按钮

不得遮挡输入区。

## P1：表单规则与交互缺口

### 15. 空字段被初始化为 0

用户要求所有字段默认展开但允许不填。当前 duration、ml、score 都初始化为 0，视觉上等于“已填写 0”。

必须：

- 未填写数值使用 `null` 或 `""`。
- 仅在计算适配时转为 0。
- 评分空值和真实 0 分必须可区分。

### 16. 分项与总时长没有聚合/覆盖规则

当前分项变化不会更新总时长，也没有差异提示。

必须：

- 未手改总时长时，总时长自动等于分项合计。
- 手改总时长后不覆盖，并显示与分项合计的差异。
- 提供“恢复按分项合计”。

### 17. 动态项目只有展示，没有当天新增/删除

必须支持：

- profile 项目正常展示。
- 新增当天临时项目。
- 删除当天临时项目。
- 不修改全局项目模板。

### 18. 字段组件缺少来源与恢复自动值接口

即使 Phase 1 尚无 TickTick，也应完成字段状态模型的可视接口：

- 来源徽标
- 手动修改标识
- 恢复自动值
- 新自动内容待合并提示预留

### 19. 页面状态显示不准确

新建空白草稿也显示“已修改”。必须按真实状态显示：

- 未生成
- 草稿
- 已修改
- 保存中
- 已保存，可修订
- 保存失败

### 20. Phase 1 组件拆分未执行

`DailyReviewWorkbench.jsx` 虽只有 40 行，但通过极长单行 JSX 和压缩函数把全部逻辑塞在一个组件中，不利于审计和后续 Phase。

必须按原规格拆分：

- Toolbar
- FocusOverviewPanel
- CategoryColumn
- OtherColumn
- ReviewField
- PointsSettlementPreview
- PointsSettlementBar

不得以压缩成一行代替模块化。

## P2：浏览器验收补充

原报告中的“本地演示保存成功”不能证明真实 Firestore 路径正确。

补修后必须验证：

1. Firebase 登录后的真实保存。
2. 刷新后草稿恢复。
3. 打开已有结算日完整恢复。
4. 连续点击保存不重复创建。
5. 修订增分与减分均正确。
6. 修订娱乐/面膜后 profile 派生状态正确。
7. 手动日记冲突不会被静默覆盖。
8. 阅读同步可重试。
9. 旧结算仍可查看和撤销。
10. 1366×768 双栏、顶部 sticky、底部结算条均正常。

## 本轮补修边界

本轮仍不实现：

- TickTick Focus 拉取
- 22:45 自动草稿
- 次日自动校准
- 华为健康 API

先把 Phase 1 的结构化表单、持久化、旧功能兼容和积分闭环做正确，再进入 Phase 2。
