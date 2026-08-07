import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBedtimeFacts,
  buildExerciseFacts,
  buildReadingMinuteFacts,
  buildStudyMinuteFacts,
  buildTrackerCompletionFacts,
} from "./rewardChallengeFacts.js";

test("study facts use submitted settlement studyMinutes and latest revision", () => {
  const facts = buildStudyMinuteFacts([
    { reviewDate: "2026-08-05", settlementRevision: 1, studyMinutes: 430 },
    { reviewDate: "2026-08-05", settlementRevision: 2, studyMinutes: 460 },
    { reviewDate: "2026-08-06", settlementRevision: 1, studyMinutes: 300 },
  ], { startDate: "2026-08-05", endDate: "2026-08-05" });
  assert.deepEqual(facts, {
    "2026-08-05": { known: true, value: 460, source: "settlement.studyMinutes" },
  });
});

test("reading facts resolve effective review field value", () => {
  const facts = buildReadingMinuteFacts([{
    reviewDate: "2026-08-05",
    reviewData: {
      fields: {
        "study.reading.totalMinutes": {
          value: "20",
          autoValue: "35",
          source: "ticktick_focus",
          manuallyEdited: false,
        },
      },
    },
  }], { startDate: "2026-08-05", endDate: "2026-08-05" });
  assert.equal(facts["2026-08-05"].value, 35);
});

test("bedtime facts put after-midnight time after 24:00", () => {
  const facts = buildBedtimeFacts([{
    reviewDate: "2026-08-05",
    reviewData: {
      fields: {
        "sleep.yesterday.bedtime": { value: "00:15", manuallyEdited: true },
      },
    },
  }], { startDate: "2026-08-05", endDate: "2026-08-05" });
  assert.equal(facts["2026-08-05"].value, 1455);
});

test("exercise session facts are authoritative from exerciseRecords", () => {
  const facts = buildExerciseFacts([
    { date: "2026-08-05", totalMinutes: 40, activity: "健身" },
    { date: "2026-08-06", totalMinutes: 0 },
  ], { startDate: "2026-08-05", endDate: "2026-08-06", sessionOnly: true });
  assert.equal(facts["2026-08-05"].value, 1);
  assert.equal(facts["2026-08-06"].value, 0);
});

test("tracker completion ignores retracted events", () => {
  const facts = buildTrackerCompletionFacts([
    { trackerId: "drink-water", occurredOn: "2026-08-05", state: "active" },
    { trackerId: "drink-water", occurredOn: "2026-08-06", state: "retracted" },
    { trackerId: "other", occurredOn: "2026-08-06", state: "active" },
  ], { trackerId: "drink-water", startDate: "2026-08-05", endDate: "2026-08-06" });
  assert.deepEqual(Object.keys(facts), ["2026-08-05"]);
});
