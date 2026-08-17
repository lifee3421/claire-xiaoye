import test from "node:test";
import assert from "node:assert/strict";
import { projectTrackerMonthlyOverview, shiftMonth } from "./trackerMonthlyOverview.js";

function tracker(overrides = {}) {
  return { id: "family-a", title: "联系外婆", enabled: true, schedule: { kind: "interval", every: 7, unit: "day" }, goal: { aggregation: "occurrence", target: 1, unit: "times" }, evidenceBindings: [{ type: "legacyMaintenanceId", maintenanceId: "family-a" }], ...overrides };
}
function event(overrides = {}) { return { id: "e1", trackerId: "family-a", occurredOn: "2026-08-03", recordedAt: "2026-08-20T12:00:00Z", state: "active", sourceType: "maintenance", evidenceSummary: "已联系外婆", value: null, unit: "boolean", ...overrides }; }

test("monthly overview: occurrence events on one date count as one completion day and retain day evidence", () => {
  const overview = projectTrackerMonthlyOverview({ tracker: tracker(), monthKey: "2026-08", today: "2026-08-20", events: [event(), event({ id: "e2", sourceType: "reviewField", evidenceSummary: "补充记录" })] });
  assert.deepEqual(overview.completionDates, ["2026-08-03"]);
  assert.equal(overview.monthlyCount, 1);
  assert.equal(overview.evidenceByDate.get("2026-08-03").length, 2);
});

test("monthly overview: active_days counts distinct occurredOn dates and sum adds event values", () => {
  const days = projectTrackerMonthlyOverview({ tracker: tracker({ id: "exercise", schedule: { kind: "period", period: "week" }, goal: { aggregation: "active_days", target: 4, unit: "days" } }), monthKey: "2026-08", today: "2026-08-10", events: [event({ trackerId: "exercise", occurredOn: "2026-08-01" }), event({ id: "e2", trackerId: "exercise", occurredOn: "2026-08-01" }), event({ id: "e3", trackerId: "exercise", occurredOn: "2026-08-02" })] });
  assert.equal(days.monthlyCount, 2);
  const reading = projectTrackerMonthlyOverview({ tracker: tracker({ id: "reading", schedule: { kind: "period", period: "month" }, goal: { aggregation: "sum", target: 720, unit: "minutes" } }), monthKey: "2026-08", today: "2026-08-10", events: [event({ trackerId: "reading", value: 30 }), event({ id: "e2", trackerId: "reading", occurredOn: "2026-08-04", value: 45 })] });
  assert.equal(reading.monthlyValue, 75);
  assert.equal(reading.monthlyCount, 2);
});

test("monthly overview: interval last completion and next due use occurredOn, not recordedAt", () => {
  const overview = projectTrackerMonthlyOverview({ tracker: tracker(), monthKey: "2026-08", today: "2026-08-08", events: [event({ occurredOn: "2026-08-01", recordedAt: "2026-08-08T23:00:00Z" })] });
  assert.equal(overview.lastCompletedDate, "2026-08-01");
  assert.equal(overview.nextDueDate, "2026-08-08");
});

test("monthly overview: retracted events and cross-month events never count", () => {
  const overview = projectTrackerMonthlyOverview({ tracker: tracker(), monthKey: "2026-08", today: "2026-08-20", events: [event({ occurredOn: "2026-07-31" }), event({ id: "retracted", state: "retracted", occurredOn: "2026-08-04" }), event({ id: "active", occurredOn: "2026-08-05" })] });
  assert.deepEqual(overview.completionDates, ["2026-08-05"]);
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
});

test("monthly overview: requires setup and empty/history states do not fabricate zero-completion facts", () => {
  const setup = projectTrackerMonthlyOverview({ tracker: tracker({ requiresSetup: true, schedule: null, goal: null }), monthKey: "2026-08", today: "2026-08-20", events: [] });
  assert.equal(setup.state, "requires_setup");
  assert.equal(setup.facts.scheduleStatus, "requires_setup");
  assert.equal(projectTrackerMonthlyOverview({ tracker: tracker(), monthKey: "2026-08", today: "2026-08-20", events: [] }).state, "empty");
  assert.equal(projectTrackerMonthlyOverview({ tracker: tracker(), monthKey: "2026-08", today: "2026-08-20", events: [], hasSavedHistory: true }).state, "history_not_migrated");
});

test("monthly overview: settlement revision, deletion and rollback retractions remove only affected calendar dates", () => {
  const initial = [event({ id: "s1", occurredOn: "2026-08-02" }), event({ id: "s2", occurredOn: "2026-08-05" }), event({ id: "s3", occurredOn: "2026-08-08" })];
  const dates = (events) => projectTrackerMonthlyOverview({ tracker: tracker(), monthKey: "2026-08", today: "2026-08-20", events }).completionDates;
  assert.deepEqual(dates(initial), ["2026-08-02", "2026-08-05", "2026-08-08"]);
  assert.deepEqual(dates(initial.map((item) => item.id === "s1" ? { ...item, state: "retracted", retractionReason: "source_removed_on_revision" } : item)), ["2026-08-05", "2026-08-08"]);
  assert.deepEqual(dates(initial.map((item) => item.id === "s2" ? { ...item, state: "retracted", retractionReason: "settlement_deleted" } : item)), ["2026-08-02", "2026-08-08"]);
  assert.deepEqual(dates(initial.map((item) => item.id === "s3" ? { ...item, state: "retracted", retractionReason: "settlement_deleted" } : item)), ["2026-08-02", "2026-08-05"]);
});
