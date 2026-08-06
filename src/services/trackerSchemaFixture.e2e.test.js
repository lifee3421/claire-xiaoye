// End-to-end fixture test for the multi-schema evidence extraction fix.
// Uses a DailyReviewWorkbench-shaped settlement (real production schema) to
// verify the full chain: settlement → extractEvidenceFromSettlement →
// reconcileTrackerEvidence → CompletionEvents.
// NO Firestore writes — pure in-memory reconciliation with the real
// DEFAULT_TRACKERS bindings.
import test from "node:test";
import assert from "node:assert/strict";
import { extractEvidenceFromSettlement, reconcileTrackerEvidence } from "./completionEvents.js";
import { DEFAULT_TRACKERS } from "../utils/trackerDefaults.js";

// A settlement shaped exactly as DailyReviewWorkbench produces it.
// 外婆: 20 min via categoryReviewEntries
// 运动: 60 min via reviewData.fields AND top-level exerciseMinutes (both paths)
// 面膜: 已敷 via health.maskStatus
// 阅读: 0 min (no event expected)
function workbenchSettlement(id = "wb-s1", reviewDate = "2026-08-05") {
  return {
    id,
    reviewDate,
    settlementRevision: 0,
    updatedAt: `${reviewDate}T14:00:00.000Z`,
    // buildLegacyReviewValues output
    exerciseMinutes: 60,
    health: { maskStatus: "已敷", maintenanceCompleted: [] },
    // buildStructuredReview output
    reviewData: {
      schemaVersion: 2,
      fields: {
        "exercise.today.totalMinutes": { value: 60, autoValue: null, manuallyEdited: true, autoValueSource: null },
        "study.reading.totalMinutes": { value: 0, autoValue: null, manuallyEdited: true, autoValueSource: null },
      },
      categoryReviewEntries: {
        "family.contact.grandmother": {
          duration: { value: 20, autoValue: null, manuallyEdited: true, autoValueSource: null },
          progress: { value: "视频通话", autoValue: null, manuallyEdited: true, autoValueSource: null },
        },
      },
    },
  };
}

const settlement = workbenchSettlement();
const byId = new Map(DEFAULT_TRACKERS.map((t) => [t.id, t]));

test("[E2E fixture] family-a: 外婆 20min via categoryReviewEntries → CompletionEvent created", async () => {
  const tracker = byId.get("family-a");
  const evidence = extractEvidenceFromSettlement(tracker, settlement);
  const categoryEvidence = evidence.find((e) => e.sourceType === "categoryEntry");
  assert.ok(categoryEvidence, "categoryEntry evidence must be present for family-a");
  assert.equal(categoryEvidence.value, 20);
  assert.match(categoryEvidence.sourceFieldKey, /family\.contact\.grandmother/);

  const { toUpsert, toRetract } = await reconcileTrackerEvidence(tracker, settlement, []);
  const familyEvent = toUpsert.find((e) => e.sourceType === "categoryEntry");
  assert.ok(familyEvent, "family-a CompletionEvent must be created");
  assert.equal(familyEvent.trackerId, "family-a");
  assert.equal(familyEvent.occurredOn, "2026-08-05");
  assert.equal(familyEvent.value, 20);
  assert.equal(familyEvent.state, "active");
  assert.equal(toRetract.length, 0);
});

test("[E2E fixture] exercise-complete: 运动 60min via reviewData.fields → CompletionEvent created", async () => {
  const tracker = byId.get("exercise-complete");
  const evidence = extractEvidenceFromSettlement(tracker, settlement);
  assert.ok(evidence.length > 0, "at least one evidence item for exercise-complete");
  const reviewDataEvidence = evidence.find((e) => e.sourceFieldKey === "fields.exercise.today.totalMinutes");
  assert.ok(reviewDataEvidence, "reviewData.fields evidence must be present");
  assert.equal(reviewDataEvidence.value, 60);

  const { toUpsert } = await reconcileTrackerEvidence(tracker, settlement, []);
  const exerciseEvent = toUpsert.find((e) => e.sourceFieldKey === "fields.exercise.today.totalMinutes");
  assert.ok(exerciseEvent, "exercise CompletionEvent must be created");
  assert.equal(exerciseEvent.trackerId, "exercise-complete");
  assert.equal(exerciseEvent.occurredOn, "2026-08-05");
  assert.equal(exerciseEvent.value, 60);
});

test("[E2E fixture] mask: 面膜 已敷 → CompletionEvent created", async () => {
  const tracker = byId.get("mask");
  const evidence = extractEvidenceFromSettlement(tracker, settlement);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].sourceType, "mask");

  const { toUpsert } = await reconcileTrackerEvidence(tracker, settlement, []);
  assert.equal(toUpsert.length, 1);
  assert.equal(toUpsert[0].trackerId, "mask");
  assert.equal(toUpsert[0].occurredOn, "2026-08-05");
});

test("[E2E fixture] reading: 阅读 0min → no evidence, no CompletionEvent", async () => {
  const tracker = byId.get("reading");
  const evidence = extractEvidenceFromSettlement(tracker, settlement);
  assert.deepEqual(evidence, [], "reading with 0 minutes must produce no evidence");

  const { toUpsert, toRetract } = await reconcileTrackerEvidence(tracker, settlement, []);
  assert.deepEqual(toUpsert, []);
  assert.deepEqual(toRetract, []);
});

test("[E2E fixture] legacy maintenanceCompleted=[] does not create spurious events for family-a", () => {
  // The workbench never writes maintenanceCompleted entries, so the
  // legacyMaintenanceId binding must not fire.
  const tracker = byId.get("family-a");
  const evidence = extractEvidenceFromSettlement(tracker, settlement);
  const legacyEvidence = evidence.filter((e) => e.sourceType === "maintenance");
  assert.deepEqual(legacyEvidence, [], "legacyMaintenanceId must not fire for workbench settlements");
});

test("[E2E fixture] idempotent: reconciling the same settlement twice does not create duplicate CompletionEvents", async () => {
  const tracker = byId.get("family-a");
  const first = (await reconcileTrackerEvidence(tracker, settlement, [])).toUpsert;
  assert.ok(first.length > 0);
  const second = await reconcileTrackerEvidence(tracker, settlement, first);
  assert.equal(second.toUpsert.length, first.length);
  assert.equal(second.toRetract.length, 0);
  // Same IDs → same createdAt (existing event preserved)
  for (let i = 0; i < first.length; i++) {
    assert.equal(second.toUpsert[i].id, first[i].id);
    assert.equal(second.toUpsert[i].createdAt, first[i].createdAt);
  }
});
