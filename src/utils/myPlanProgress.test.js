import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { myPlanProgressGeometry, resolveMyPlanFocusDisplay, formatDuration } from "./plannerOverview.js";

const appSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "App.jsx"),
  "utf8",
);
const cssSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "styles.css"),
  "utf8",
);

// ---------------------------------------------------------------------------
// 验收场景 1：目标 240 / 已排 180 / 完成 60 → 75% 灰 · 25% 彩色
// ---------------------------------------------------------------------------
test("场景1：目标240 已排180 完成60 → 灰层75% 彩色层25%，白底 track 始终 100%", () => {
  const geometry = myPlanProgressGeometry({ targetMinutes: 240, scheduledMinutes: 180, completedMinutes: 60 });
  assert.equal(geometry.hasTarget, true);
  assert.equal(geometry.scheduledPercent, 75);
  assert.equal(geometry.completedPercent, 25);
});

// ---------------------------------------------------------------------------
// 验收场景 2：目标 120 / 已排 90 / 完成 0 且 Focus 已同步 → 可以显示 "已完成 0min"
// ---------------------------------------------------------------------------
test("场景2：Focus fresh 且确实为 0 时，彩色层 0% 且文案明确显示 已完成 0min", () => {
  const geometry = myPlanProgressGeometry({ targetMinutes: 120, scheduledMinutes: 90, completedMinutes: 0 });
  assert.equal(geometry.scheduledPercent, 75);
  assert.equal(geometry.completedPercent, 0);

  const display = resolveMyPlanFocusDisplay({ focusDataStatus: "fresh", entry: null, anyCardWaitingSettlement: false });
  assert.equal(display.known, true);
  assert.equal(display.minutes, 0);
  assert.equal(display.text, "已完成 0min");
});

// ---------------------------------------------------------------------------
// 验收场景 3：Focus 未同步 → 绝不把完成显示成 0，保留现有状态语义
// ---------------------------------------------------------------------------
test("场景3：Focus 未同步/过旧/等待结算时，完成量不可知，彩色层为 0 宽但文案不是 0min", () => {
  const geometry = myPlanProgressGeometry({ targetMinutes: 120, scheduledMinutes: 60, completedMinutes: null });
  assert.equal(geometry.scheduledPercent, 50);
  assert.equal(geometry.completedPercent, 0, "完成量不可知时彩色层不画");

  const unavailable = resolveMyPlanFocusDisplay({ focusDataStatus: "unavailable" });
  assert.equal(unavailable.known, false);
  assert.equal(unavailable.minutes, null);
  assert.equal(unavailable.text, "未同步");

  const stale = resolveMyPlanFocusDisplay({ focusDataStatus: "stale" });
  assert.equal(stale.known, false);
  assert.equal(stale.text, "同步过旧");

  const waiting = resolveMyPlanFocusDisplay({ focusDataStatus: "fresh", entry: null, anyCardWaitingSettlement: true });
  assert.equal(waiting.known, false);
  assert.equal(waiting.text, "等待结算");

  for (const display of [unavailable, stale, waiting]) {
    assert.doesNotMatch(display.text, /0min/, "非同步状态绝不能退化成 已完成 0min");
  }
});

test("等待结算但该分类已有已结算分钟数时，数字照常显示并带上部分等待结算后缀", () => {
  const display = resolveMyPlanFocusDisplay({
    focusDataStatus: "fresh",
    entry: { focusOverlapMinutes: 45 },
    anyCardWaitingSettlement: true,
  });
  assert.equal(display.known, true);
  assert.equal(display.minutes, 45);
  assert.equal(display.text, "已完成 45min（部分等待结算）");
});

// ---------------------------------------------------------------------------
// 验收场景 4：已排/已完成超过目标 → 视觉 clamp 100%，真实数字不许被改写
// ---------------------------------------------------------------------------
test("场景4：目标240 已排300 完成260 → 两层都 clamp 到 100%，但真实分钟数原样保留", () => {
  const geometry = myPlanProgressGeometry({ targetMinutes: 240, scheduledMinutes: 300, completedMinutes: 260 });
  assert.equal(geometry.scheduledPercent, 100);
  assert.equal(geometry.completedPercent, 100);

  // 数据本身绝不能被 clamp 改写——文字仍然显示真实的 5h / 4h20min
  assert.equal(formatDuration(300), "5h");
  assert.equal(formatDuration(260), "4h20min");

  const display = resolveMyPlanFocusDisplay({ focusDataStatus: "fresh", entry: { focusOverlapMinutes: 260 } });
  assert.equal(display.minutes, 260, "显示层不得把超出目标的完成量截断成目标值");
  assert.equal(display.text, "已完成 4h20min");
});

// ---------------------------------------------------------------------------
// 验收场景 5：完成 > 已排 是合法状态，彩色层允许比灰色层长
// ---------------------------------------------------------------------------
test("场景5：目标240 已排60 完成100 → 灰25% 彩色41.67%，不做 completed=min(completed,scheduled)", () => {
  const geometry = myPlanProgressGeometry({ targetMinutes: 240, scheduledMinutes: 60, completedMinutes: 100 });
  assert.equal(geometry.scheduledPercent, 25);
  assert.ok(Math.abs(geometry.completedPercent - 41.6667) < 0.001, `expected ~41.67, got ${geometry.completedPercent}`);
  assert.ok(geometry.completedPercent > geometry.scheduledPercent, "彩色层必须允许超过灰色层");
});

// ---------------------------------------------------------------------------
// 验收场景 6：没有今日目标 → 不伪造 0% 进度条
// ---------------------------------------------------------------------------
test("场景6：没有今日目标时 hasTarget=false，调用方据此不渲染假的 0% 进度条", () => {
  for (const targetMinutes of [0, null, undefined, -30, "abc"]) {
    const geometry = myPlanProgressGeometry({ targetMinutes, scheduledMinutes: 90, completedMinutes: 30 });
    assert.equal(geometry.hasTarget, false, `targetMinutes=${targetMinutes} 必须判定为未设置目标`);
    assert.equal(geometry.scheduledPercent, 0);
    assert.equal(geometry.completedPercent, 0);
  }
});

test("负数/脏数据不会产生负宽度", () => {
  const geometry = myPlanProgressGeometry({ targetMinutes: 120, scheduledMinutes: -50, completedMinutes: -10 });
  assert.equal(geometry.scheduledPercent, 0);
  assert.equal(geometry.completedPercent, 0);
});

// ---------------------------------------------------------------------------
// 组件接线：确认 App.jsx 真的用了 overlay 三层结构而不是三段 flex，且复用现有数据源
// ---------------------------------------------------------------------------
test("MyPlanSummary 渲染三层叠加进度条，并复用既有 target/scheduled/focusOverlap 数据源", () => {
  const component = appSource.slice(appSource.indexOf("function MyPlanSummary("), appSource.indexOf("function PlannerOverview("));

  assert.match(component, /myPlanProgressGeometry\(/, "必须复用共享的进度几何函数，而不是在组件里另写一套百分比计算");
  assert.match(component, /resolveMyPlanFocusDisplay\(/, "Focus 状态文案必须走共享函数，保留现有语义");
  assert.match(component, /mpl-track/);
  assert.match(component, /mpl-scheduled/);
  assert.match(component, /mpl-completed/);

  // 复用现有字段名，不新造重复字段
  assert.match(component, /row\.targetMinutes/);
  assert.match(component, /row\.scheduledMinutes/);
  assert.match(component, /focusOverlapMinutes/);
  assert.match(component, /formatDuration\(/, "时长必须复用项目已有 formatter");

  // 旧的四列表格必须真的消失
  assert.doesNotMatch(component, /my-plan-summary-table/, "旧四列表格结构必须移除");
  assert.doesNotMatch(component, /时间线已排<\/span>/, "旧表头必须移除");

  // 保留标题与目标草稿/锁定状态、两个入口按钮背后的逻辑不动
  assert.match(component, /我的计划/);
  assert.match(component, /目标已锁定|目标（草稿）/);

  // 未设置目标不画假进度条
  assert.match(component, /未设置今日目标/);
  assert.match(component, /geometry\.hasTarget\s*&&/, "无目标时必须跳过进度条渲染");

  // 合计保留且同样是三层叠加
  assert.match(component, /今日总目标/);
  assert.match(component, /totalGeometry/);
});

test("三层叠加靠 overlay 定位实现，彩色层压在灰层之上，track 为白底浅描边 pill", () => {
  const track = cssSource.slice(cssSource.indexOf(".mpl-track {"), cssSource.indexOf(".mpl-row-foot"));

  assert.match(track, /position:\s*relative/);
  assert.match(track, /background:\s*#ffffff/, "track 必须是白底代表今日目标总量");
  assert.match(track, /border:\s*1px solid/, "白卡片上必须有浅描边，否则未安排区域看不出来");
  assert.match(track, /border-radius:\s*999px/);
  assert.match(track, /overflow:\s*hidden/);
  assert.match(track, /height:\s*9px/, "进度条保持 8-10px 的紧凑高度");

  const scheduled = cssSource.slice(cssSource.indexOf(".mpl-scheduled {"), cssSource.indexOf(".mpl-completed {"));
  const completed = cssSource.slice(cssSource.indexOf(".mpl-completed {"), cssSource.indexOf(".mpl-row-foot"));

  for (const layer of [scheduled, completed]) {
    assert.match(layer, /position:\s*absolute/);
    assert.match(layer, /left:\s*0/);
  }
  const scheduledZ = Number(/z-index:\s*(\d+)/.exec(scheduled)?.[1]);
  const completedZ = Number(/z-index:\s*(\d+)/.exec(completed)?.[1]);
  assert.ok(completedZ > scheduledZ, "彩色完成层必须叠在灰色已排层之上");

  // 视觉约束：不引入渐变/3D/重阴影
  const block = cssSource.slice(cssSource.indexOf(".my-plan-rows {"), cssSource.indexOf(".mpl-total-cat"));
  assert.doesNotMatch(block, /gradient|box-shadow|transform:\s*perspective/, "不使用渐变/重阴影/3D");
});
