// Pure extraction + reconciliation logic for the unified tracker fact layer.
// Deliberately has zero Firestore/IO dependency so it can be fully unit
// tested — the caller (dataService.js, not yet wired) is responsible for
// reading existing CompletionEvents and persisting the upsert/retract lists
// this module returns.
//
// Per the "settlement is the sole authority" decision: this module only ever
// reads a SAVED settlement (settlement.reviewData / settlement.health). It
// never reads timeline blocks, Focus sync, reading/exercise records, or an
// unsaved draft — those may feed the settlement's own fields during review
// entry, but do not themselves produce CompletionEvents.
import { resolveEffectiveReviewValue } from "../review/effectiveReviewValue.js";
import { buildCompletionEventId, normalizeRevision } from "../utils/trackerIdentity.js";

export { buildCompletionEventId };

function readPath(source, path) {
  return path.reduce((node, key) => (node == null ? undefined : node[key]), source);
}

function categoryEntryEffectiveValue(entry, field) {
  const state = entry?.[field];
  if (state == null) return "";
  // categoryReviewEntries[id][field] uses the same {value, autoValue,
  // manuallyEdited, autoValueSource} shape as draft.fields — same resolver.
  return resolveEffectiveReviewValue(state);
}

function extractLegacyMaintenance(settlement, binding) {
  const completed = Array.isArray(settlement?.health?.maintenanceCompleted) ? settlement.health.maintenanceCompleted : [];
  if (!completed.includes(binding.maintenanceId)) return null;
  return {
    sourceType: "maintenance",
    sourceFieldKey: `health.maintenanceCompleted.${binding.maintenanceId}`,
    value: null,
    unit: "boolean",
    evidenceSummary: `生活维护｜${binding.maintenanceId} 已勾选`,
  };
}

function extractLegacyMask(settlement) {
  const status = settlement?.health?.maskStatus;
  if (status !== "已敷") return null;
  return { sourceType: "mask", sourceFieldKey: "health.maskStatus", value: null, unit: "boolean", evidenceSummary: "面膜｜已敷" };
}

function extractCategoryEntry(settlement, binding) {
  const entry = settlement?.reviewData?.categoryReviewEntries?.[binding.categoryId];
  if (!entry) return null;
  const duration = categoryEntryEffectiveValue(entry, "duration");
  const progress = categoryEntryEffectiveValue(entry, "progress");
  const adjustment = categoryEntryEffectiveValue(entry, "adjustment");
  const hasContent = duration !== "" || String(progress || "").trim() || String(adjustment || "").trim();
  if (!hasContent) return null;
  const numericDuration = Number(duration);
  // threshold: minimum minutes required — only applies when a numeric duration is present
  if (Number.isFinite(numericDuration) && duration !== "") {
    const threshold = Number(binding.threshold);
    if (Number.isFinite(threshold) && threshold > 0 && numericDuration < threshold) return null;
  }
  const summaryParts = [progress, adjustment].map((part) => String(part || "").trim()).filter(Boolean);
  return {
    sourceType: "categoryEntry",
    sourceFieldKey: `categoryReviewEntries.${binding.categoryId}`,
    value: Number.isFinite(numericDuration) && duration !== "" ? numericDuration : null,
    unit: Number.isFinite(numericDuration) && duration !== "" ? "minutes" : "boolean",
    evidenceSummary: summaryParts.length ? summaryParts.join("｜") : `动态分类｜${duration !== "" ? `${duration}min` : "已记录"}`,
  };
}

function extractReviewFieldPath(settlement, binding) {
  const raw = readPath(settlement?.reviewData, binding.path) ?? readPath(settlement, binding.path);
  if (raw == null) return null;
  const resolved = raw && typeof raw === "object" && "value" in raw ? resolveEffectiveReviewValue(raw) : raw;
  const key = binding.path.join(".");
  if (binding.valueType === "duration") {
    const numeric = Number(resolved);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    // threshold: minimum minutes required to count as a completion
    const threshold = Number(binding.threshold);
    if (Number.isFinite(threshold) && threshold > 0 && numeric < threshold) return null;
    return { sourceType: "reviewField", sourceFieldKey: key, value: numeric, unit: "minutes", evidenceSummary: `${key}｜${numeric}min` };
  }
  if (binding.valueType === "select") {
    // Exact value match — used for select fields like selfcare.today.mask = "是"
    const text = String(resolved ?? "").trim();
    if (!text || text !== binding.matcher) return null;
    return { sourceType: "reviewField", sourceFieldKey: key, value: null, unit: "boolean", evidenceSummary: `${key}｜${text}` };
  }
  // Default: any non-empty value counts (backward-compatible)
  const text = String(resolved ?? "").trim();
  if (!text) return null;
  return { sourceType: "reviewField", sourceFieldKey: key, value: null, unit: "boolean", evidenceSummary: `${key}｜${text}` };
}

function extractManualReviewField(settlement, binding) {
  const state = readPath(settlement?.reviewData?.fields, [binding.fieldId]);
  const resolved = resolveEffectiveReviewValue(state || {});
  const text = String(resolved ?? "").trim();
  if (!text) return null;
  return { sourceType: "manualReviewField", sourceFieldKey: `fields.${binding.fieldId}`, value: null, unit: "boolean", evidenceSummary: `手动确认｜${text}` };
}

const EXTRACTORS = {
  legacyMaintenanceId: extractLegacyMaintenance,
  legacyMaskField: extractLegacyMask,
  categoryId: extractCategoryEntry,
  reviewFieldPath: extractReviewFieldPath,
  manualReviewField: extractManualReviewField,
};

export function extractEvidenceFromSettlement(tracker = {}, settlement = {}) {
  const bindings = Array.isArray(tracker.evidenceBindings) ? tracker.evidenceBindings : [];
  return bindings
    .map((binding) => EXTRACTORS[binding.type]?.(settlement, binding))
    .filter(Boolean);
}

/**
 * Pure reconciliation: given a tracker, its freshly-saved settlement, and the
 * existing CompletionEvents already on file for this trackerId+settlement,
 * returns what to upsert and what to retract. Does not touch storage.
 *
 * @param {object} tracker
 * @param {object} settlement - must have .id, .reviewDate, .settlementRevision
 * @param {Array} existingEvents - prior events for this trackerId scoped to settlement.id
 * @param {object} [options]
 * @param {"live"|"migration"} [options.ingestionType="live"]
 * @param {string} [options.recordedAt] - defaults to settlement.updatedAt, then now
 */
export async function reconcileTrackerEvidence(tracker, settlement, existingEvents = [], { ingestionType = "live", recordedAt } = {}) {
  const extracted = extractEvidenceFromSettlement(tracker, settlement);
  const recordedAtValue = recordedAt || settlement.updatedAt || settlement.submittedAt || new Date().toISOString();
  const occurredOn = settlement.reviewDate;

  const toUpsert = await Promise.all(extracted.map(async (item) => {
    const id = await buildCompletionEventId(tracker.id, settlement.id, item.sourceFieldKey, item.sourceType);
    const existing = existingEvents.find((event) => event.id === id);
    return {
      id,
      trackerId: tracker.id,
      occurredOn,
      occurredAt: settlement.reviewOccurredAt || null,
      recordedAt: recordedAtValue,
      value: item.value,
      unit: item.unit,
      sourceType: item.sourceType,
      ingestionType: existing?.ingestionType || ingestionType,
      sourceDocumentId: settlement.id,
      sourceFieldKey: item.sourceFieldKey,
      sourceRevision: normalizeRevision(settlement.settlementRevision),
      evidenceSummary: item.evidenceSummary,
      state: "active",
      retractedAt: null,
      retractionReason: null,
      createdAt: existing?.createdAt || recordedAtValue,
      updatedAt: recordedAtValue,
    };
  }));

  const keptIds = new Set(toUpsert.map((event) => event.id));
  const toRetract = existingEvents
    .filter((event) => event.state === "active" && event.sourceDocumentId === settlement.id && !keptIds.has(event.id))
    .map((event) => ({ ...event, state: "retracted", retractedAt: recordedAtValue, retractionReason: "source_removed_on_revision", updatedAt: recordedAtValue }));

  return { toUpsert, toRetract };
}

// Deleting a settlement has no source document left for the normal
// reconciliation extractor to read. This is therefore deliberately a
// separate, narrow projection: the caller first finds CompletionEvents by
// sourceDocumentId, then writes these state-only patches in the SAME batch as
// the settlement deletion. Already-retracted events are omitted so retrying a
// delete/rollback operation is idempotent.
export function planSettlementDeletedEventRetractions(events = [], { recordedAt = new Date().toISOString() } = {}) {
  return (Array.isArray(events) ? events : [])
    .filter((event) => event?.state === "active")
    .map((event) => ({
      ...event,
      state: "retracted",
      retractedAt: recordedAt,
      retractionReason: "settlement_deleted",
      updatedAt: recordedAt,
    }));
}
