import test from "node:test";
import assert from "node:assert/strict";
import { buildCompletionEventId, extractEvidenceFromSettlement, planSettlementDeletedEventRetractions, reconcileTrackerEvidence } from "./completionEvents.js";

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
