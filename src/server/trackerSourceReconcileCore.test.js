import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TRACKERS } from "../utils/trackerDefaults.js";
import { buildCompletionEventId } from "../services/completionEvents.js";
import { planTrackerSourceReconcile } from "./trackerSourceReconcileCore.js";

function field(value) {
  return { value, autoValue: value, manuallyEdited: true, source: "manual" };
}

const date = "2026-08-08";
const settlement = {
  id: date,
  reviewDate: date,
  settlementRevision: 2,
  updatedAt: "2026-08-08T14:00:00.000Z",
  reviewData: {
    fields: {
      "family.contact.grandmother.duration": field(20),
      "family.contact.parent.duration": field(15),
      "selfcare.today.mask": field("是"),
      "exercise.today.totalMinutes": field(30),
      "study.reading.totalMinutes": field(40),
      "hobby.creativeWriting.duration": field(25),
    },
  },
};
const exerciseRecord = {
  id: date,
  date,
  summary: { sourceDisplayedMinutes: 45, sessionCount: 1 },
  updatedAt: "2026-08-08T13:00:00.000Z",
};

test("canonical source repair recognizes every built-in review source and prefers Keep for exercise", async () => {
  const plan = await planTrackerSourceReconcile({
    trackers: DEFAULT_TRACKERS,
    settlements: [settlement],
    exerciseRecords: [exerciseRecord],
    existingEvents: [],
  });
  const ids = new Set(plan.toUpsert.map((event) => event.trackerId));
  assert.deepEqual(ids, new Set(["family-a", "family-b", "mask", "exercise-complete", "reading", "writing"]));
  assert.equal(plan.toUpsert.filter((event) => event.trackerId === "exercise-complete").length, 1);
  const exercise = plan.toUpsert.find((event) => event.trackerId === "exercise-complete");
  assert.equal(exercise.sourceType, "exerciseRecord");
  assert.equal(exercise.value, 45);
  assert.equal(plan.toUpsert.find((event) => event.trackerId === "family-a").value, 20);
  assert.equal(plan.toUpsert.find((event) => event.trackerId === "reading").value, 40);
});

test("a Keep record retracts an older settlement exercise fallback instead of double-counting the date", async () => {
  const fallbackId = await buildCompletionEventId(
    "exercise-complete",
    date,
    "fields.exercise.today.totalMinutes",
    "reviewField",
  );
  const existingFallback = {
    id: fallbackId,
    trackerId: "exercise-complete",
    occurredOn: date,
    sourceDocumentId: date,
    sourceFieldKey: "fields.exercise.today.totalMinutes",
    sourceType: "reviewField",
    state: "active",
    sourceRevision: 1,
    createdAt: "2026-08-08T12:00:00.000Z",
  };
  const plan = await planTrackerSourceReconcile({
    trackers: DEFAULT_TRACKERS,
    settlements: [settlement],
    exerciseRecords: [exerciseRecord],
    existingEvents: [existingFallback],
  });
  assert.equal(plan.toRetract.some((event) => event.id === fallbackId && event.state === "retracted"), true);
  assert.equal(plan.toUpsert.filter((event) => event.trackerId === "exercise-complete" && event.sourceType === "exerciseRecord").length, 1);
});

test("zero Keep minutes retract an existing exercise completion", async () => {
  const eventId = await buildCompletionEventId(
    "exercise-complete",
    date,
    "summary.sourceDisplayedMinutes",
    "exerciseRecord",
  );
  const existing = {
    id: eventId,
    trackerId: "exercise-complete",
    occurredOn: date,
    sourceDocumentId: date,
    sourceFieldKey: "summary.sourceDisplayedMinutes",
    sourceType: "exerciseRecord",
    state: "active",
    value: 45,
    unit: "minutes",
    sourceRevision: 0,
    createdAt: "2026-08-08T12:00:00.000Z",
  };
  const plan = await planTrackerSourceReconcile({
    trackers: DEFAULT_TRACKERS,
    settlements: [],
    exerciseRecords: [{ ...exerciseRecord, summary: { sourceDisplayedMinutes: 0, sessionCount: 0 } }],
    existingEvents: [existing],
  });
  assert.equal(plan.toUpsert.length, 0);
  assert.equal(plan.toRetract.length, 1);
  assert.equal(plan.toRetract[0].id, eventId);
  assert.equal(plan.toRetract[0].state, "retracted");
});

test("trackers with no source evidence stay empty", async () => {
  const plan = await planTrackerSourceReconcile({
    trackers: DEFAULT_TRACKERS,
    settlements: [{ id: date, reviewDate: date, settlementRevision: 0, reviewData: { fields: {} } }],
    exerciseRecords: [],
    existingEvents: [],
  });
  assert.equal(plan.toUpsert.length, 0);
  assert.equal(plan.toRetract.length, 0);
});
