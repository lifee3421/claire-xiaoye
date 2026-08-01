import test from "node:test";
import assert from "node:assert/strict";
import { projectTrackerDailyOverview, relativeDateLabel } from "./trackerDailyOverview.js";
import { resolveTrackerEvidence } from "./trackerFacts.js";

function tracker(overrides = {}) {
  return { id: "family-a", title: "联系外婆", emoji: "📞", enabled: true, schedule: { kind: "interval", every: 7, unit: "day" }, goal: { aggregation: "occurrence", target: 1, unit: "times" }, evidenceBindings: [{ type: "legacyMaintenanceId", maintenanceId: "family-a" }], ...overrides };
}
function facts(overrides = {}) { return { scheduleStatus: "upcoming", lastCompletedDate: "2026-07-27", nextDueDate: "2026-08-03", requiresSetup: false, ...overrides }; }

test("daily tracker overview: interval trackers show last completion and next due from TrackerFacts", () => {
  const family = projectTrackerDailyOverview({ tracker: tracker(), facts: facts(), today: "2026-08-01" });
  const mask = projectTrackerDailyOverview({ tracker: tracker({ id: "mask", schedule: { kind: "interval", every: 3, unit: "day" } }), facts: facts({ lastCompletedDate: "2026-07-30", nextDueDate: "2026-08-02" }), today: "2026-08-01" });
  assert.deepEqual(family.lines, ["上次：7月27日 · 5天前", "下次：8月3日 · 2天后"]);
  assert.deepEqual(mask.lines, ["上次：7月30日 · 2天前", "下次：8月2日 · 明天"]);
  assert.equal(relativeDateLabel("2026-08-01", "2026-08-01"), "今天");
});

test("daily tracker overview: active days and sum use current period progress without a fabricated due date", () => {
  const exercise = projectTrackerDailyOverview({ tracker: tracker({ id: "exercise-complete", schedule: { kind: "period", period: "week" }, goal: { aggregation: "active_days", target: 4, unit: "days" } }), facts: facts({ scheduleStatus: "on_track", progress: { current: 2, target: 4, remaining: 2, unit: "days" } }), today: "2026-08-01" });
  const reading = projectTrackerDailyOverview({ tracker: tracker({ id: "reading", schedule: { kind: "period", period: "month" }, goal: { aggregation: "sum", target: 720, unit: "minutes" } }), facts: facts({ scheduleStatus: "on_track", progress: { current: 320, target: 720, remaining: 400, unit: "minutes" }, nextDueDate: "2026-08-31" }), today: "2026-08-01" });
  assert.deepEqual(exercise.lines, ["本周：2 / 4 天", "还差：2天"]);
  assert.deepEqual(reading.lines, ["本月：320 / 720 分钟", "还差：400分钟"]);
  assert.equal(reading.lines.some((line) => line.startsWith("下次：")), false);
});

test("daily tracker overview: an empty reading period is visible without inventing a due date", () => {
  const reading = projectTrackerDailyOverview({
    tracker: tracker({ id: "reading", schedule: { kind: "period", period: "month" }, goal: { aggregation: "sum", target: 720, unit: "minutes" } }),
    facts: facts({ scheduleStatus: "on_track", lastCompletedDate: null, progress: { current: 0, target: 720, remaining: 720, unit: "minutes" } }),
    today: "2026-08-01",
  });
  assert.equal(reading.noCurrentPeriodRecords, true);
  assert.equal(reading.lines.some((line) => line.startsWith("下次：")), false);
});

test("daily tracker overview: setup, migration and retracted events do not claim never completed", () => {
  assert.equal(projectTrackerDailyOverview({ tracker: tracker({ requiresSetup: true, schedule: null, goal: null }), facts: facts({ requiresSetup: true }), today: "2026-08-01" }).status, "待设置");
  const notMigrated = projectTrackerDailyOverview({ tracker: tracker(), facts: facts({ lastCompletedDate: null, nextDueDate: null, scheduleStatus: "overdue" }), today: "2026-08-01", hasSavedHistory: true, migrationState: { status: "never_run" } });
  assert.deepEqual(notMigrated, { kind: "history_not_migrated", status: "历史尚未迁移", lines: ["上次：历史尚未迁移"] });
  const retractedFacts = resolveTrackerEvidence(tracker(), { today: "2026-08-01", events: [{ id: "old", trackerId: "family-a", occurredOn: "2026-07-27", state: "retracted" }] });
  const retracted = projectTrackerDailyOverview({ tracker: tracker(), facts: retractedFacts, today: "2026-08-01" });
  assert.deepEqual(retracted.lines, ["上次：暂无记录"]);
});
