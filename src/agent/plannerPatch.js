// PlannerPatch is Snow-dust/Xiaoye's typed request to mutate the authoritative
// daily planner. The server apply endpoint validates the current baseRevision
// before every commit, so no client can silently overwrite a newer plan.
import { validateCanonicalDailyStatePayload } from "../schedule/plannerDailyCanonicalState.js";

export const PLANNER_PATCH_SCHEMA_VERSION = 1;
export const PLANNER_PATCH_CHANGE_TYPES = [
  "apply_template",
  "move",
  "return_to_pool",
  "schedule_from_pool",
  "create_from_tracker",
  "create_task",
  "edit_task",
  "delete_task",
  "set_pool_order",
  // Proposal-only escape hatch for an already-previewed/confirmed macro
  // (clear/replan/fixed-boundary/undo). /api/planner-mutate never accepts it.
  "replace_day_state",
];

function validClock(value) {
  if (typeof value !== "string" || !/^\d{1,2}:\d{2}$/.test(value)) return false;
  const [hours, minutes] = value.split(":").map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function positiveMinutes(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function nonNegativeMinutes(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0;
}

/** Structural validation only. A well-formed patch is still checked against
 * the live draft for staleness, protected cards and time conflicts at apply. */
export function validatePlannerPatchShape(patch) {
  const problems = [];
  if (!patch || typeof patch !== "object") return ["patch must be an object"];
  if (patch.schemaVersion !== PLANNER_PATCH_SCHEMA_VERSION) problems.push(`unsupported schemaVersion: ${patch.schemaVersion}`);
  if (typeof patch.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(patch.date)) problems.push("date must be an ISO calendar date string");
  if (typeof patch.baseRevision !== "string" || !patch.baseRevision) problems.push("baseRevision is required");
  if (!Array.isArray(patch.changes) || patch.changes.length === 0) problems.push("changes must be a non-empty array");

  const changes = Array.isArray(patch.changes) ? patch.changes : [];
  if (changes.some((change) => change?.type === "replace_day_state") && changes.length !== 1) {
    problems.push("replace_day_state must be the only change in its proposal");
  }

  changes.forEach((change, index) => {
    if (!PLANNER_PATCH_CHANGE_TYPES.includes(change?.type)) {
      problems.push(`changes[${index}]: unknown type "${change?.type}"`);
      return;
    }
    if (change.type === "apply_template" && (typeof change.templateId !== "string" || !change.templateId.trim())) {
      problems.push(`changes[${index}]: templateId is required for "apply_template"`);
    }
    if (["move", "return_to_pool", "schedule_from_pool", "edit_task", "delete_task"].includes(change.type) && !change.blockId) {
      problems.push(`changes[${index}]: blockId is required for "${change.type}"`);
    }
    if ((change.type === "move" || change.type === "schedule_from_pool") && !validClock(change.start)) {
      problems.push(`changes[${index}]: start must be HH:MM for "${change.type}"`);
    }
    if (change.type === "create_from_tracker") {
      if (!change.trackerId) problems.push(`changes[${index}]: trackerId is required for "create_from_tracker"`);
      if (!positiveMinutes(change.estimatedMinutes)) problems.push(`changes[${index}]: estimatedMinutes must be positive for "create_from_tracker"`);
    }
    if (change.type === "create_task") {
      if (typeof change.title !== "string" || !change.title.trim()) problems.push(`changes[${index}]: title is required for "create_task"`);
      const hasSegments = Array.isArray(change.segments) && change.segments.length > 0 && change.segments.every(positiveMinutes);
      if (!positiveMinutes(change.estimatedMinutes) && !hasSegments) problems.push(`changes[${index}]: estimatedMinutes or positive segments are required for "create_task"`);
      if (change.start !== undefined && change.start !== null && change.start !== "" && !validClock(change.start)) problems.push(`changes[${index}]: start must be HH:MM when supplied for "create_task"`);
      if (change.breakMinutes !== undefined && !nonNegativeMinutes(change.breakMinutes)) problems.push(`changes[${index}]: breakMinutes must be non-negative for "create_task"`);
      if (change.taskId !== undefined && (typeof change.taskId !== "string" || !change.taskId.trim())) problems.push(`changes[${index}]: taskId must be a non-empty string when supplied`);
    }
    if (change.type === "edit_task") {
      const editable = [
        "title", "categoryId", "estimatedMinutes", "breakMinutes", "priority", "preferredPeriods", "note",
        "start", "locked", "status", "snowdustReminder", "startVerification", "deskVerification", "clearOverrideFields",
      ];
      if (!editable.some((key) => Object.prototype.hasOwnProperty.call(change, key))) problems.push(`changes[${index}]: edit_task needs at least one editable field`);
      if (Object.prototype.hasOwnProperty.call(change, "estimatedMinutes") && !positiveMinutes(change.estimatedMinutes)) problems.push(`changes[${index}]: estimatedMinutes must be positive when editing duration`);
      if (Object.prototype.hasOwnProperty.call(change, "breakMinutes") && !nonNegativeMinutes(change.breakMinutes)) problems.push(`changes[${index}]: breakMinutes must be non-negative`);
      if (Object.prototype.hasOwnProperty.call(change, "start") && !validClock(change.start)) problems.push(`changes[${index}]: start must be HH:MM when editing time`);
      if (Object.prototype.hasOwnProperty.call(change, "status") && !["pending", "completed", "cancelled", "rescheduled"].includes(change.status)) problems.push(`changes[${index}]: unsupported task status`);
      if (Object.prototype.hasOwnProperty.call(change, "clearOverrideFields") && !Array.isArray(change.clearOverrideFields)) problems.push(`changes[${index}]: clearOverrideFields must be an array`);
    }
    if (change.type === "set_pool_order") {
      if (!Array.isArray(change.blockIds) || change.blockIds.some((id) => typeof id !== "string" || !id)) problems.push(`changes[${index}]: blockIds must be a string array for "set_pool_order"`);
    }
    if (change.type === "replace_day_state") {
      validateCanonicalDailyStatePayload(change.state).forEach((problem) => problems.push(`changes[${index}]: ${problem}`));
    }
  });
  return problems;
}

export function isPlannerPatchStale(patch, currentBaseRevision) {
  return patch?.baseRevision !== currentBaseRevision;
}
