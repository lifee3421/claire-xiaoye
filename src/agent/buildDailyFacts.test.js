import assert from "node:assert/strict";
import test from "node:test";
import { buildDailyFacts } from "./buildDailyFacts.js";

const now = new Date("2026-07-29T10:00:00.000Z");

function studyBlock(overrides = {}) {
  return { id: "b1", plannedMinutes: 60, status: "pending", statGroup: "study", ...overrides };
}

// Case 1: plan 540 / actual 0 (nothing completed, no settlement)
test("case1: planned-only day never reports actual minutes", () => {
  const taskBlocks = Array.from({ length: 9 }, (_, i) => studyBlock({ id: `b${i}`, plannedMinutes: 60, status: "pending" }));
  const facts = buildDailyFacts({ localDate: "2026-07-29", taskBlocks, settlement: null, now });
  assert.equal(facts.plan.scheduledStudyMinutes, 540);
  assert.equal(facts.plan.scheduledBlockCount, 9);
  assert.equal(facts.actual.completedTimelineMinutes, 0);
  assert.equal(facts.actual.pureStudyMinutes, null);
  assert.equal(facts.actual.reviewReportedMinutes, null);
  assert.equal(facts.actualStatus, "unknown");
  assert.equal(facts.evidenceStatus.actualStudyKnown, false);
});

// Case 8: settlement (authoritative) 60, provisional evidence (completed cards) would suggest more — settlement wins
test("case8: submitted settlement is authoritative and is not overridden by timeline completion", () => {
  const taskBlocks = [studyBlock({ id: "b1", plannedMinutes: 120, status: "completed" })];
  const settlement = { studyMinutes: 60, reviewDate: "2026-07-29" };
  const facts = buildDailyFacts({ localDate: "2026-07-29", taskBlocks, settlement, now });
  assert.equal(facts.actualStatus, "authoritative");
  assert.equal(facts.actual.reviewReportedMinutes, 60);
  assert.equal(facts.actual.pureStudyMinutes, 60);
  assert.equal(facts.actual.completedTimelineMinutes, 120);
  assert.deepEqual(facts.evidenceStatus.sources, ["settlement", "completedTimelineCards"]);
});

// Case 9 / case 2: no settlement, completed timeline cards only -> provisional
test("case9: unsubmitted day with completed cards is provisional, not final", () => {
  const taskBlocks = [studyBlock({ id: "b1", plannedMinutes: 90, status: "completed" })];
  const facts = buildDailyFacts({ localDate: "2026-07-29", taskBlocks, settlement: null, now });
  assert.equal(facts.actualStatus, "provisional");
  assert.equal(facts.actual.completedTimelineMinutes, 90);
  assert.equal(facts.actual.pureStudyMinutes, 90);
  assert.equal(facts.actual.reviewReportedMinutes, null);
});

// Case 10: completed card minutes must not be zeroed by absent focus data
test("case10: completedTimelineMinutes is independent of focus availability", () => {
  const taskBlocks = [studyBlock({ id: "b1", plannedMinutes: 120, status: "completed" })];
  const facts = buildDailyFacts({ localDate: "2026-07-29", taskBlocks, settlement: null, now });
  assert.equal(facts.actual.completedTimelineMinutes, 120);
  assert.equal(facts.actual.focusMinutes, null);
  assert.equal(facts.actualStatus, "provisional");
});

// Case 3: scheduled-but-not-completed blocks never enter actual.*
test("case3: uncompleted timeline blocks stay out of actual", () => {
  const taskBlocks = [studyBlock({ id: "b1", plannedMinutes: 60, status: "pending" }), studyBlock({ id: "b2", plannedMinutes: 60, status: "completed" })];
  const facts = buildDailyFacts({ localDate: "2026-07-29", taskBlocks, settlement: null, now });
  assert.equal(facts.plan.scheduledStudyMinutes, 120);
  assert.equal(facts.actual.completedTimelineMinutes, 60);
  assert.equal(facts.actual.completedBlockCount, 1);
});

// Case 12: legacy/older callers passing no statGroup info shouldn't crash and should resolve to unknown
test("case12: empty/legacy input resolves to a safe unknown state", () => {
  const facts = buildDailyFacts({ localDate: "2026-07-29", taskBlocks: [], settlement: null, now });
  assert.equal(facts.actualStatus, "unknown");
  assert.equal(facts.plan.scheduledStudyMinutes, 0);
  assert.deepEqual(facts.evidenceStatus.conflicts, []);
});

test("sourceMap always explains every actual.* field", () => {
  const facts = buildDailyFacts({ localDate: "2026-07-29", taskBlocks: [studyBlock({ status: "completed" })], settlement: null, now });
  for (const key of Object.keys(facts.actual)) {
    assert.ok(facts.sourceMap[`actual.${key}`], `missing sourceMap entry for actual.${key}`);
  }
  for (const key of Object.keys(facts.plan)) {
    assert.ok(facts.sourceMap[`plan.${key}`], `missing sourceMap entry for plan.${key}`);
  }
});
