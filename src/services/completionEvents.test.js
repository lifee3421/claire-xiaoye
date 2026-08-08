import test from "node:test";
import assert from "node:assert/strict";
import { buildCompletionEventId, extractEvidenceFromSettlement, extractEvidenceFromExerciseRecord, planSettlementDeletedEventRetractions, reconcileTrackerEvidence, reconcileExerciseRecordEvidence } from "./completionEvents.js";

const grandmaTracker = {
  id: "family-a",
  title: "联系外婆",
  evidenceBindings: [{ type: "categoryId", categoryId: "cat_9f2a" }],
};

function settlementWithGrandma(overrides = {}) {
  return {
    id: "s1",
    reviewDate: "2026-07-27",
    settlementRevision: 0,
    updatedAt: "2026-07-27T14:00:00Z",
    reviewData: {
      categoryReviewEntries: {
        cat_9f2a: { duration: { value: 30, manuallyEdited: true }, progress: { value: "与外婆通话", manuallyEdited: true } },
      },
    },
    ...overrides,
  };
}

test("extractEvidenceFromSettlement: dynamic category binding reaches categoryReviewEntries", () => {
  const evidence = extractEvidenceFromSettlement(grandmaTracker, settlementWithGrandma());
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].sourceType, "categoryEntry");
  assert.equal(evidence[0].value, 30);
  assert.match(evidence[0].evidenceSummary, /外婆/);
});

test("extractEvidenceFromSettlement: empty category entry produces no evidence", () => {
  const empty = settlementWithGrandma({ reviewData: { categoryReviewEntries: { cat_9f2a: { duration: { value: "" }, progress: { value: "" } } } } });
  assert.deepEqual(extractEvidenceFromSettlement(grandmaTracker, empty), []);
});

test("legacy maintenance and mask bindings", () => {
  const tracker = { id: "family-a", evidenceBindings: [{ type: "legacyMaintenanceId", maintenanceId: "family-a" }] };
  const hit = extractEvidenceFromSettlement(tracker, { health: { maintenanceCompleted: ["family-a", "reading"] } });
  assert.equal(hit.length, 1);
  assert.equal(hit[0].sourceType, "maintenance");

  const miss = extractEvidenceFromSettlement(tracker, { health: { maintenanceCompleted: ["reading"] } });
  assert.deepEqual(miss, []);

  const maskTracker = { id: "mask", evidenceBindings: [{ type: "legacyMaskField" }] };
  assert.equal(extractEvidenceFromSettlement(maskTracker, { health: { maskStatus: "已敷" } }).length, 1);
  assert.deepEqual(extractEvidenceFromSettlement(maskTracker, { health: { maskStatus: "未敷" } }), []);
});

test("buildCompletionEventId: hashes the identity into a Firestore-safe id, never embeds the raw sourceFieldKey", async () => {
  const id = await buildCompletionEventId("family-a", "s1", "categoryReviewEntries.cat_9f2a", "categoryEntry");
  assert.doesNotMatch(id, /categoryReviewEntries/);
  assert.doesNotMatch(id, /\//); // a path-like sourceFieldKey (e.g. containing "/") must never leak into the doc id
  assert.equal(id, await buildCompletionEventId("family-a", "s1", "categoryReviewEntries.cat_9f2a", "categoryEntry")); // deterministic
  assert.notEqual(id, await buildCompletionEventId("family-a", "s1", "categoryReviewEntries.cat_other", "categoryEntry"));
  assert.equal(id.length, 64); // full 256-bit SHA-256 as hex
});

test("reconcileTrackerEvidence: idempotent upsert, same event id on repeat reconcile, raw identity fields kept in the doc body", async () => {
  const settlement = settlementWithGrandma();
  const first = await reconcileTrackerEvidence(grandmaTracker, settlement, []);
  assert.equal(first.toUpsert.length, 1);
  assert.equal(first.toRetract.length, 0);
  const eventId = await buildCompletionEventId("family-a", "s1", "categoryReviewEntries.cat_9f2a", "categoryEntry");
  assert.equal(first.toUpsert[0].id, eventId);
  assert.equal(first.toUpsert[0].trackerId, "family-a");
  assert.equal(first.toUpsert[0].sourceDocumentId, "s1");
  assert.equal(first.toUpsert[0].sourceFieldKey, "categoryReviewEntries.cat_9f2a");
  assert.equal(first.toUpsert[0].sourceType, "categoryEntry");
  assert.equal(first.toUpsert[0].occurredOn, "2026-07-27");
  assert.equal(first.toUpsert[0].state, "active");

  // second reconcile against the same settlement, now armed with the
  // previously-persisted event, must not create a duplicate.
  const second = await reconcileTrackerEvidence(grandmaTracker, settlement, first.toUpsert);
  assert.equal(second.toUpsert.length, 1);
  assert.equal(second.toUpsert[0].id, eventId);
  assert.equal(second.toUpsert[0].createdAt, first.toUpsert[0].createdAt);
});

test("reconcileTrackerEvidence: value edited in a revised settlement updates the same event", async () => {
  const original = (await reconcileTrackerEvidence(grandmaTracker, settlementWithGrandma(), [])).toUpsert;
  const revised = settlementWithGrandma({
    settlementRevision: 1,
    updatedAt: "2026-07-28T01:00:00Z",
    reviewData: { categoryReviewEntries: { cat_9f2a: { duration: { value: 20, manuallyEdited: true }, progress: { value: "与外婆通话", manuallyEdited: true } } } },
  });
  const result = await reconcileTrackerEvidence(grandmaTracker, revised, original);
  assert.equal(result.toUpsert.length, 1);
  assert.equal(result.toUpsert[0].value, 20);
  assert.equal(result.toUpsert[0].sourceRevision, 1);
  assert.equal(typeof result.toUpsert[0].sourceRevision, "number");
  assert.equal(result.toRetract.length, 0);
});

test("reconcileTrackerEvidence: deleted evidence on a revised settlement retracts the old event", async () => {
  const original = (await reconcileTrackerEvidence(grandmaTracker, settlementWithGrandma(), [])).toUpsert;
  const revised = settlementWithGrandma({ settlementRevision: 1, updatedAt: "2026-07-28T01:00:00Z", reviewData: { categoryReviewEntries: {} } });
  const result = await reconcileTrackerEvidence(grandmaTracker, revised, original);
  assert.equal(result.toUpsert.length, 0);
  assert.equal(result.toRetract.length, 1);
  assert.equal(result.toRetract[0].state, "retracted");
  assert.equal(result.toRetract[0].retractionReason, "source_removed_on_revision");
});

test("planSettlementDeletedEventRetractions: retracts every active event and is idempotent for an already-retracted event", () => {
  const active = { id: "event-active", state: "active", sourceDocumentId: "s1", sourceRevision: 2 };
  const retracted = { id: "event-retracted", state: "retracted", sourceDocumentId: "s1", retractionReason: "settlement_deleted" };
  const first = planSettlementDeletedEventRetractions([active, retracted], { recordedAt: "2026-08-01T08:00:00.000Z" });
  assert.deepEqual(first, [{
    ...active,
    state: "retracted",
    retractedAt: "2026-08-01T08:00:00.000Z",
    retractionReason: "settlement_deleted",
    updatedAt: "2026-08-01T08:00:00.000Z",
  }]);
  assert.deepEqual(planSettlementDeletedEventRetractions(first, { recordedAt: "2026-08-01T09:00:00.000Z" }), []);
});

test("reconcileTrackerEvidence: migration ingestionType is preserved, not overwritten by a later live reconcile", async () => {
  const settlement = settlementWithGrandma();
  const migrated = (await reconcileTrackerEvidence(grandmaTracker, settlement, [], { ingestionType: "migration" })).toUpsert;
  assert.equal(migrated[0].ingestionType, "migration");
  assert.equal(migrated[0].sourceType, "categoryEntry"); // sourceType is never "migration"

  const reconciledAgain = (await reconcileTrackerEvidence(grandmaTracker, settlement, migrated, { ingestionType: "live" })).toUpsert;
  assert.equal(reconciledAgain[0].ingestionType, "migration");
});

test("migration event remains one fact on live reconcile, then retracts when its saved evidence is removed", async () => {
  const settlement = settlementWithGrandma();
  const migrated = (await reconcileTrackerEvidence(grandmaTracker, settlement, [], { ingestionType: "migration" })).toUpsert;
  const live = await reconcileTrackerEvidence(grandmaTracker, settlement, migrated, { ingestionType: "live" });
  assert.equal(live.toUpsert.length, 1);
  assert.equal(live.toUpsert[0].id, migrated[0].id);
  assert.equal(live.toUpsert[0].ingestionType, "migration");
  const removed = await reconcileTrackerEvidence(grandmaTracker, settlementWithGrandma({ settlementRevision: 1, reviewData: { categoryReviewEntries: {} } }), live.toUpsert);
  assert.equal(removed.toRetract.length, 1);
  assert.equal(removed.toRetract[0].id, migrated[0].id);
  assert.equal(removed.toRetract[0].state, "retracted");
});

// --- Schema mismatch fix: family-a categoryId binding ---

test("family-a: categoryId binding extracts from reviewData.categoryReviewEntries['family.contact.grandmother']", () => {
  const tracker = {
    id: "family-a",
    evidenceBindings: [
      { type: "categoryId", categoryId: "family.contact.grandmother" },
      { type: "legacyMaintenanceId", maintenanceId: "family-a" },
    ],
  };
  const settlement = {
    id: "s-gma",
    reviewDate: "2026-08-05",
    reviewData: {
      categoryReviewEntries: {
        "family.contact.grandmother": { duration: { value: 20, manuallyEdited: true }, progress: { value: "视频通话", manuallyEdited: true } },
      },
    },
  };
  const evidence = extractEvidenceFromSettlement(tracker, settlement);
  // categoryId fires; legacyMaintenanceId does not (no maintenanceCompleted)
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].sourceType, "categoryEntry");
  assert.equal(evidence[0].value, 20);
  assert.equal(evidence[0].sourceFieldKey, "categoryReviewEntries.family.contact.grandmother");
});

test("family-a: empty categoryReviewEntry produces no evidence", () => {
  const tracker = { id: "family-a", evidenceBindings: [{ type: "categoryId", categoryId: "family.contact.grandmother" }] };
  const settlement = {
    reviewData: { categoryReviewEntries: { "family.contact.grandmother": { duration: { value: "" }, progress: { value: "" } } } },
  };
  assert.deepEqual(extractEvidenceFromSettlement(tracker, settlement), []);
});

test("family-a: legacy maintenanceCompleted still fires as fallback", () => {
  const tracker = {
    id: "family-a",
    evidenceBindings: [
      { type: "categoryId", categoryId: "family.contact.grandmother" },
      { type: "legacyMaintenanceId", maintenanceId: "family-a" },
    ],
  };
  const legacySettlement = { id: "s-legacy", reviewDate: "2026-01-10", health: { maintenanceCompleted: ["family-a"] } };
  const evidence = extractEvidenceFromSettlement(tracker, legacySettlement);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].sourceType, "maintenance");
});

// --- Schema mismatch fix: exercise-complete bindings ---

test("exercise-complete: reviewFieldPath extracts from reviewData.fields['exercise.today.totalMinutes'] (new schema)", () => {
  const tracker = {
    id: "exercise-complete",
    evidenceBindings: [
      { type: "reviewFieldPath", path: ["fields", "exercise.today.totalMinutes"], valueType: "duration" },
      { type: "reviewFieldPath", path: ["exerciseMinutes"], valueType: "duration" },
    ],
  };
  const newSchemaSettlement = {
    id: "s-ex-new",
    reviewDate: "2026-08-05",
    exerciseMinutes: 60,
    reviewData: { fields: { "exercise.today.totalMinutes": { value: 60, manuallyEdited: true } } },
  };
  const evidence = extractEvidenceFromSettlement(tracker, newSchemaSettlement);
  // Short-circuit OR: first matching binding wins; reviewData.fields takes priority over exerciseMinutes
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].sourceFieldKey, "fields.exercise.today.totalMinutes");
  assert.equal(evidence[0].value, 60);
});

test("exercise-complete: only exerciseMinutes fires for old settlements without reviewData.fields", () => {
  const tracker = {
    id: "exercise-complete",
    evidenceBindings: [
      { type: "reviewFieldPath", path: ["fields", "exercise.today.totalMinutes"], valueType: "duration" },
      { type: "reviewFieldPath", path: ["exerciseMinutes"], valueType: "duration" },
    ],
  };
  const oldSettlement = { id: "s-ex-old", reviewDate: "2026-07-01", exerciseMinutes: 45 };
  const evidence = extractEvidenceFromSettlement(tracker, oldSettlement);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].sourceFieldKey, "exerciseMinutes");
  assert.equal(evidence[0].value, 45);
});

test("exercise-complete: 0 minutes produces no evidence (duration must be > 0)", () => {
  const tracker = {
    id: "exercise-complete",
    evidenceBindings: [
      { type: "reviewFieldPath", path: ["fields", "exercise.today.totalMinutes"], valueType: "duration" },
      { type: "reviewFieldPath", path: ["exerciseMinutes"], valueType: "duration" },
    ],
  };
  const zeroSettlement = {
    exerciseMinutes: 0,
    reviewData: { fields: { "exercise.today.totalMinutes": { value: 0 } } },
  };
  assert.deepEqual(extractEvidenceFromSettlement(tracker, zeroSettlement), []);
});

// --- Mask (already correct, regression guard) ---

test("mask: 已敷 → evidence; any other value → no evidence", () => {
  const tracker = { id: "mask", evidenceBindings: [{ type: "legacyMaskField" }] };
  assert.equal(extractEvidenceFromSettlement(tracker, { health: { maskStatus: "已敷" } }).length, 1);
  assert.deepEqual(extractEvidenceFromSettlement(tracker, { health: { maskStatus: "未敷" } }), []);
  assert.deepEqual(extractEvidenceFromSettlement(tracker, { health: {} }), []);
});

// --- Reading (already correct, regression guard for 0/empty) ---

test("reading: 0 or empty minutes → no evidence; positive minutes → evidence", () => {
  const tracker = { id: "reading", evidenceBindings: [{ type: "reviewFieldPath", path: ["fields", "study.reading.totalMinutes"], valueType: "duration" }] };
  assert.deepEqual(extractEvidenceFromSettlement(tracker, { reviewData: { fields: { "study.reading.totalMinutes": { value: 0 } } } }), []);
  assert.deepEqual(extractEvidenceFromSettlement(tracker, { reviewData: { fields: { "study.reading.totalMinutes": { value: "" } } } }), []);
  assert.deepEqual(extractEvidenceFromSettlement(tracker, {}), []);
  const hit = extractEvidenceFromSettlement(tracker, { reviewData: { fields: { "study.reading.totalMinutes": { value: 30 } } } });
  assert.equal(hit.length, 1);
  assert.equal(hit[0].value, 30);
});

// --- exerciseRecord source ---

const exerciseTracker = {
  id: "exercise-complete",
  evidenceBindings: [{ type: "exerciseRecord", minMinutes: 1 }],
};

test("extractEvidenceFromExerciseRecord: positive minutes yields one evidence item", () => {
  const record = { date: "2026-08-05", summary: { sourceDisplayedMinutes: 45 } };
  const evidence = extractEvidenceFromExerciseRecord(exerciseTracker, record);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].sourceType, "exerciseRecord");
  assert.equal(evidence[0].sourceFieldKey, "summary.sourceDisplayedMinutes");
  assert.equal(evidence[0].value, 45);
  assert.equal(evidence[0].unit, "minutes");
});

test("extractEvidenceFromExerciseRecord: zero minutes yields no evidence", () => {
  assert.deepEqual(extractEvidenceFromExerciseRecord(exerciseTracker, { date: "2026-08-05", summary: { sourceDisplayedMinutes: 0 } }), []);
});

test("extractEvidenceFromExerciseRecord: missing or non-numeric minutes yields no evidence", () => {
  assert.deepEqual(extractEvidenceFromExerciseRecord(exerciseTracker, { date: "2026-08-05" }), []);
  assert.deepEqual(extractEvidenceFromExerciseRecord(exerciseTracker, {}), []);
  assert.deepEqual(extractEvidenceFromExerciseRecord(exerciseTracker, { date: "2026-08-05", summary: { sourceDisplayedMinutes: null } }), []);
});

test("extractEvidenceFromExerciseRecord: settlement-type bindings are ignored (exerciseRecord source only)", () => {
  const mixedTracker = {
    id: "exercise-complete",
    evidenceBindings: [
      { type: "reviewFieldPath", path: ["fields", "exercise.today.totalMinutes"], valueType: "duration" },
      { type: "exerciseRecord", minMinutes: 1 },
    ],
  };
  const record = { date: "2026-08-05", summary: { sourceDisplayedMinutes: 45 } };
  const evidence = extractEvidenceFromExerciseRecord(mixedTracker, record);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].sourceType, "exerciseRecord");
});

test("reconcileExerciseRecordEvidence: creates a new event from an exerciseRecord", async () => {
  const record = { date: "2026-08-05", summary: { sourceDisplayedMinutes: 45 }, updatedAt: "2026-08-05T10:00:00Z" };
  const { toUpsert, toRetract } = await reconcileExerciseRecordEvidence(exerciseTracker, record, []);
  assert.equal(toUpsert.length, 1);
  assert.equal(toRetract.length, 0);
  const event = toUpsert[0];
  assert.equal(event.trackerId, "exercise-complete");
  assert.equal(event.occurredOn, "2026-08-05");
  assert.equal(event.sourceDocumentId, "2026-08-05");
  assert.equal(event.sourceType, "exerciseRecord");
  assert.equal(event.sourceRevision, 0);
  assert.equal(event.value, 45);
  assert.equal(event.state, "active");
});

test("reconcileExerciseRecordEvidence: idempotent — createdAt preserved on re-reconcile", async () => {
  const record = { date: "2026-08-05", summary: { sourceDisplayedMinutes: 45 }, updatedAt: "2026-08-05T10:00:00Z" };
  const { toUpsert: first } = await reconcileExerciseRecordEvidence(exerciseTracker, record, []);
  const { toUpsert: second, toRetract } = await reconcileExerciseRecordEvidence(exerciseTracker, record, first);
  assert.equal(second.length, 1);
  assert.equal(toRetract.length, 0);
  assert.equal(second[0].id, first[0].id);
  assert.equal(second[0].createdAt, first[0].createdAt);
});

test("reconcileExerciseRecordEvidence: empty exerciseRecord (no minutes) retracts an existing event", async () => {
  const record = { date: "2026-08-05", summary: { sourceDisplayedMinutes: 45 }, updatedAt: "2026-08-05T10:00:00Z" };
  const { toUpsert: existing } = await reconcileExerciseRecordEvidence(exerciseTracker, record, []);
  const emptyRecord = { date: "2026-08-05", summary: { sourceDisplayedMinutes: 0 }, updatedAt: "2026-08-05T11:00:00Z" };
  const { toUpsert, toRetract } = await reconcileExerciseRecordEvidence(exerciseTracker, emptyRecord, existing);
  assert.equal(toUpsert.length, 0);
  assert.equal(toRetract.length, 1);
  assert.equal(toRetract[0].state, "retracted");
});
