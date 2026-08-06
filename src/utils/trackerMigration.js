import { extractEvidenceFromSettlement, reconcileTrackerEvidence } from "../services/completionEvents.js";
import { validDate } from "./plannerOverview.js";

const AUTOMATIC_BINDINGS = new Set(["legacyMaintenanceId", "legacyMaskField", "reviewFieldPath", "categoryId"]);

// Bumped when evidence bindings change in a way that may recover previously
// unrecognized history in already-migrated month ranges. Old migration state
// objects that lack this field (or carry a lower version) are treated as
// schema-version 1 and will NOT suppress a re-scan — the migration UI will
// surface "history pending migration" again for those months.
export const TRACKER_EVIDENCE_SCHEMA_VERSION = 2;

function array(value) { return Array.isArray(value) ? value : []; }
function categoryHasEvidence(entry = {}) { return ["duration", "progress", "adjustment"].some((key) => { const value = entry[key]; return value && typeof value === "object" && String(value.value ?? value.autoValue ?? "").trim(); }); }
function bindingKey(binding = {}) { return binding.type === "categoryId" ? `categoryId:${binding.categoryId || ""}` : binding.type === "reviewFieldPath" ? `reviewFieldPath:${array(binding.path).join(".")}` : binding.type === "legacyMaintenanceId" ? `legacyMaintenanceId:${binding.maintenanceId || ""}` : binding.type; }
export function configuredBinding(binding) { return AUTOMATIC_BINDINGS.has(binding?.type) && (binding.type === "legacyMaskField" || binding.type === "legacyMaintenanceId" && !!binding.maintenanceId || binding.type === "categoryId" && !!binding.categoryId || binding.type === "reviewFieldPath" && array(binding.path).length > 0); }
function savedAt(settlement) { const value = settlement?.updatedAt || settlement?.submittedAt || settlement?.createdAt || ""; return typeof value === "string" ? value : value?.toDate?.().toISOString?.() || ""; }

export function resolveMigrationRange({ scope = "current_month", today, start, end } = {}) {
  const month = (today || new Date().toISOString().slice(0, 10)).slice(0, 7);
  const [year, monthNumber] = month.split("-").map(Number);
  if (scope === "all") return { scope, start: "", end: "" };
  if (scope === "previous_month") { const date = new Date(Date.UTC(year, monthNumber - 2, 1)); const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`; return { scope, start: `${key}-01`, end: `${key}-${String(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()).padStart(2, "0")}` }; }
  if (scope === "custom") return { scope, start: validDate(start) ? start : "", end: validDate(end) ? end : "" };
  return { scope: "current_month", start: `${month}-01`, end: `${month}-${String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, "0")}` };
}

export function settlementInMigrationRange(settlement, range) {
  const date = settlement?.reviewDate;
  return validDate(date) && (!range.start || date >= range.start) && (!range.end || date <= range.end);
}

export function migrationRangeCoversMonth(state, monthBounds) {
  if (!state || state.status === "never_run" || !monthBounds) return false;
  return array(state.ranges).some((range) => range?.scope === "all" || range?.start <= monthBounds.start && range?.end >= monthBounds.end);
}

export function nextTrackerMigrationState(previous = {}, { range, failed = 0, now = new Date().toISOString() } = {}) {
  const ranges = [...array(previous.ranges), { scope: range.scope, start: range.start || "", end: range.end || "", completedAt: now }];
  const completed = failed === 0 && range.scope === "all";
  return { status: completed ? "completed" : "partial", ranges, evidenceSchemaVersion: TRACKER_EVIDENCE_SCHEMA_VERSION, updatedAt: now };
}

export async function buildTrackerMigrationDryRun({ trackers = [], settlements = [], existingEvents = [], range } = {}) {
  const scopedSettlements = array(settlements).filter((settlement) => settlementInMigrationRange(settlement, range));
  const existingById = new Map(array(existingEvents).map((event) => [event.id, event]));
  const bindingOwners = new Map();
  array(trackers).forEach((tracker) => array(tracker.evidenceBindings).filter(configuredBinding).forEach((binding) => {
    const key = bindingKey(binding); bindingOwners.set(key, [...(bindingOwners.get(key) || []), tracker.id]);
  }));
  const highConfidence = []; const ambiguous = []; const summaries = new Map(array(trackers).map((tracker) => [tracker.id, { trackerId: tracker.id, title: tracker.title || tracker.id, scannedSettlements: scopedSettlements.length, migratable: 0, existing: 0, ambiguous: 0, noEvidenceDates: 0, configurationIssues: [] }]));
  for (const tracker of trackers) {
    const summary = summaries.get(tracker.id);
    const bindings = array(tracker.evidenceBindings).filter(configuredBinding);
    if (tracker.requiresSetup) { summary.configurationIssues.push("tracker_requires_setup"); continue; }
    if (!bindings.length) { summary.configurationIssues.push("binding_broken"); continue; }
    for (const settlement of scopedSettlements) {
      const usableBindings = bindings.filter((binding) => (bindingOwners.get(bindingKey(binding)) || []).length === 1);
      const evidence = extractEvidenceFromSettlement({ ...tracker, evidenceBindings: usableBindings }, settlement);
      if (!evidence.length) summary.noEvidenceDates += 1;
      const { toUpsert } = await reconcileTrackerEvidence({ ...tracker, evidenceBindings: usableBindings }, settlement, array(existingEvents).filter((event) => event.trackerId === tracker.id && event.sourceDocumentId === settlement.id), { ingestionType: "migration", recordedAt: savedAt(settlement) });
      for (const event of toUpsert) {
        const candidate = { id: event.id, kind: "high_confidence", trackerId: tracker.id, title: tracker.title || tracker.id, occurredOn: event.occurredOn, sourceType: event.sourceType, sourceFieldKey: event.sourceFieldKey, evidenceSummary: event.evidenceSummary, sourceDocumentId: settlement.id, event };
        if (existingById.has(event.id)) { candidate.kind = "existing"; summary.existing += 1; } else { highConfidence.push(candidate); summary.migratable += 1; }
      }
      bindings.filter((binding) => (bindingOwners.get(bindingKey(binding)) || []).length > 1).forEach((binding) => { const evidenceForBinding = extractEvidenceFromSettlement({ ...tracker, evidenceBindings: [binding] }, settlement)[0]; if (evidenceForBinding) { ambiguous.push({ kind: "ambiguous", reason: "binding_matches_multiple_trackers", occurredOn: settlement.reviewDate, sourceDocumentId: settlement.id, sourceType: evidenceForBinding.sourceType, sourceFieldKey: evidenceForBinding.sourceFieldKey, evidenceSummary: evidenceForBinding.evidenceSummary, candidateTrackerIds: bindingOwners.get(bindingKey(binding)) }); summary.ambiguous += 1; } });
    }
  }
  for (const settlement of scopedSettlements) {
    const entries = settlement?.reviewData?.categoryReviewEntries || {};
    for (const [categoryId, entry] of Object.entries(entries)) {
      if (!categoryHasEvidence(entry) || bindingOwners.has(`categoryId:${categoryId}`)) continue;
      ambiguous.push({ kind: "ambiguous", reason: "unbound_category", occurredOn: settlement.reviewDate, sourceDocumentId: settlement.id, sourceType: "categoryEntry", sourceFieldKey: `categoryReviewEntries.${categoryId}`, evidenceSummary: `动态分类「${entry.title || categoryId}」`, categoryId, candidateTrackerIds: array(trackers).filter((tracker) => !tracker.requiresSetup).map((tracker) => tracker.id) });
    }
  }
  const existing = [];
  for (const tracker of trackers) for (const settlement of scopedSettlements) {
    const matches = array(existingEvents).filter((event) => event.trackerId === tracker.id && event.sourceDocumentId === settlement.id);
    matches.forEach((event) => { if (event.state === "active") existing.push({ id: event.id, trackerId: tracker.id, title: tracker.title || tracker.id, occurredOn: event.occurredOn, sourceType: event.sourceType, sourceFieldKey: event.sourceFieldKey, evidenceSummary: event.evidenceSummary || "" }); });
  }
  return { range, scannedSettlements: scopedSettlements.length, highConfidence, ambiguous, summaries: [...summaries.values()], existing };
}

export async function buildConfirmedAmbiguousMigrationEvent({ candidate, tracker, settlement, existingEvents = [] } = {}) {
  if (!candidate || !tracker || candidate.reason !== "unbound_category" || !candidate.categoryId) return null;
  const boundTracker = { ...tracker, evidenceBindings: [{ type: "categoryId", categoryId: candidate.categoryId }] };
  const result = await reconcileTrackerEvidence(boundTracker, settlement, existingEvents.filter((event) => event.trackerId === tracker.id && event.sourceDocumentId === settlement.id), { ingestionType: "migration", recordedAt: savedAt(settlement) });
  return result.toUpsert.find((event) => event.sourceFieldKey === candidate.sourceFieldKey) || null;
}

function monthBoundsForDate(date) {
  if (!validDate(date)) return null;
  const [year, month] = date.split("-").map(Number);
  if (!year || !month) return null;
  const prefix = date.slice(0, 7);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${prefix}-01`, end: `${prefix}-${String(lastDay).padStart(2, "0")}` };
}

/**
 * Per-tracker, synchronous, client-only check: does THIS tracker still have
 * mechanically identifiable old evidence in the saved settlements that has NOT
 * yet been migrated? Recognition reuses the exact same binding predicate
 * (`configuredBinding`) and extractor (`extractEvidenceFromSettlement`) as the
 * real migration dry-run, so it stays in lockstep with `buildTrackerMigrationDryRun`
 * without re-implementing any title/keyword matching. Only the four high
 * confidence automatic bindings count: legacyMaintenanceId, legacyMaskField,
 * reviewFieldPath, categoryId. Fuzzy titles and unbound categories are NOT
 * counted.
 *
 * Returns a Map<trackerId, boolean> so the sidebar can project each tracker
 * independently — no more account-wide "any settlement exists" flag, and the
 * settlement scan runs once here, never once per tracker.
 *
 * @param {object} options
 * @param {Array} options.trackers - effective unified trackers (resolved config)
 * @param {Array} options.settlements - already-loaded client settlements
 * @param {object} [options.migrationState] - profile.trackerMigrationState
 */
export function computeMigratableHistoryByTracker({ trackers = [], settlements = [], migrationState } = {}) {
  const result = new Map();
  const settlementsArray = Array.isArray(settlements) ? settlements : [];
  // If the stored migration state was produced by an older evidence schema
  // (missing evidenceSchemaVersion or lower than current), skip the
  // "already migrated" guard entirely so new bindings can surface old data.
  const migrationSchemaCurrent = (migrationState?.evidenceSchemaVersion || 1) >= TRACKER_EVIDENCE_SCHEMA_VERSION;
  for (const tracker of Array.isArray(trackers) ? trackers : []) {
    const bindings = (Array.isArray(tracker.evidenceBindings) ? tracker.evidenceBindings : []).filter(configuredBinding);
    let hasMigratable = false;
    if (bindings.length > 0 && !tracker.requiresSetup) {
      for (const settlement of settlementsArray) {
        const evidence = extractEvidenceFromSettlement({ ...tracker, evidenceBindings: bindings }, settlement);
        if (evidence.length === 0) continue;
        const bounds = monthBoundsForDate(settlement?.reviewDate);
        // Only respect the "already migrated" marker when the evidence schema
        // has not changed since the migration ran.
        if (migrationSchemaCurrent && bounds && migrationRangeCoversMonth(migrationState, bounds)) continue;
        hasMigratable = true;
        break;
      }
    }
    result.set(tracker.id, hasMigratable);
  }
  return result;
}
