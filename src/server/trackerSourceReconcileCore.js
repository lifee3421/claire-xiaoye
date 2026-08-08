import { reconcileExerciseRecordEvidence, reconcileTrackerEvidence } from "../services/completionEvents.js";

function array(value) { return Array.isArray(value) ? value : []; }

function toIso(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return "";
}

function hasExerciseRecordBinding(tracker) {
  return array(tracker?.evidenceBindings).some((binding) => binding?.type === "exerciseRecord");
}

function settlementEventsFor(existingEvents, trackerId, sourceDocumentId) {
  return array(existingEvents).filter((event) =>
    event?.trackerId === trackerId
    && event?.sourceDocumentId === sourceDocumentId
    && event?.sourceType !== "exerciseRecord"
  );
}

function exerciseEventsFor(existingEvents, trackerId, date) {
  return array(existingEvents).filter((event) =>
    event?.trackerId === trackerId
    && event?.sourceDocumentId === date
    && event?.sourceType === "exerciseRecord"
  );
}

function dedupeById(events) {
  return [...new Map(array(events).filter((event) => event?.id).map((event) => [event.id, event])).values()];
}

/**
 * Build one canonical CompletionEvent repair plan from the real source docs.
 *
 * Source policy:
 * - submitted review settlements are authoritative for review-field trackers;
 * - exerciseRecords are authoritative for trackers declaring exerciseRecord;
 * - a settlement exercise fallback is used only when that date has no
 *   exerciseRecord;
 * - zero/removed evidence retracts an existing event instead of leaving a
 *   ghost completion behind;
 * - no fuzzy/title guessing is performed here: only configured bindings are
 *   consumed by completionEvents.js.
 */
export async function planTrackerSourceReconcile({
  trackers = [],
  settlements = [],
  exerciseRecords = [],
  existingEvents = [],
} = {}) {
  const enabledTrackers = array(trackers).filter((tracker) => tracker?.enabled !== false);
  const exerciseByDate = new Map(array(exerciseRecords).filter((record) => record?.date).map((record) => [record.date, record]));
  const upserts = [];
  const retracts = [];

  for (const settlement of array(settlements)) {
    if (!settlement?.id || !settlement?.reviewDate) continue;
    const exerciseRecord = exerciseByDate.get(settlement.reviewDate) || null;

    for (const tracker of enabledTrackers) {
      const existingForSettlement = settlementEventsFor(existingEvents, tracker.id, settlement.id);
      // Keep is the primary exercise source whenever a record exists for the
      // date. Passing no settlement bindings deliberately retracts any old
      // settlement fallback event for that tracker/date without inventing a
      // second completion next to the Keep event.
      const trackerForSettlement = exerciseRecord && hasExerciseRecordBinding(tracker)
        ? { ...tracker, evidenceBindings: [] }
        : tracker;
      const settlementResult = await reconcileTrackerEvidence(
        trackerForSettlement,
        settlement,
        existingForSettlement,
        {
          ingestionType: existingForSettlement[0]?.ingestionType || "live",
          recordedAt: toIso(settlement.updatedAt) || toIso(settlement.submittedAt) || toIso(settlement.createdAt) || new Date().toISOString(),
        },
      );
      upserts.push(...settlementResult.toUpsert);
      retracts.push(...settlementResult.toRetract);
    }
  }

  for (const record of array(exerciseRecords)) {
    if (!record?.date) continue;
    for (const tracker of enabledTrackers.filter(hasExerciseRecordBinding)) {
      const exBindings = array(tracker.evidenceBindings).filter((binding) => binding?.type === "exerciseRecord");
      const existingForRecord = exerciseEventsFor(existingEvents, tracker.id, record.date);
      const exerciseResult = await reconcileExerciseRecordEvidence(
        { ...tracker, evidenceBindings: exBindings },
        record,
        existingForRecord,
        {
          ingestionType: existingForRecord[0]?.ingestionType || "live",
          recordedAt: toIso(record.updatedAt) || new Date().toISOString(),
        },
      );
      upserts.push(...exerciseResult.toUpsert);
      retracts.push(...exerciseResult.toRetract);
    }
  }

  const upsertById = new Map(dedupeById(upserts).map((event) => [event.id, event]));
  const finalRetracts = dedupeById(retracts).filter((event) => !upsertById.has(event.id));
  return { toUpsert: [...upsertById.values()], toRetract: finalRetracts };
}
