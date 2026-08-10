// PlannerPatch is Snow-dust's typed request to mutate the authoritative daily
// planner. The server apply endpoint validates the current baseRevision before
// every commit, so chat discussion can never silently overwrite a newer plan.

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
];

function validClock(value) {
  if (typeof value !== "string" || !/^\d{1,2}:\d{2}$/.test(value)) return false;
  const [hours, minutes] = value.split(":").map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function positiveMinutes(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
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

  (Array.isArray(patch.changes) ? patch.changes : []).forEach((change, index) => {
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
      if (!positiveMinutes(change.estimatedMinutes)) problems.push(`changes[${index}]: estimatedMinutes must be positive for "create_task"`);
      if (change.start !== undefined && change.start !== null && change.start !== "" && !validClock(change.start)) problems.push(`changes[${index}]: start must be HH:MM when supplied for "create_task"`);
    }
    if (change.type === "edit_task") {
      const editable = ["title", "categoryId", "estimatedMinutes", "breakMinutes", "priority", "preferredPeriods", "note"];
      if (!editable.some((key) => Object.prototype.hasOwnProperty.call(change, key))) problems.push(`changes[${index}]: edit_task needs at least one editable field`);
      if (Object.prototype.hasOwnProperty.call(change, "estimatedMinutes") && !positiveMinutes(change.estimatedMinutes)) problems.push(`changes[${index}]: estimatedMinutes must be positive when editing duration`);
      if (Object.prototype.hasOwnProperty.call(change, "breakMinutes") && (!Number.isFinite(Number(change.breakMinutes)) || Number(change.breakMinutes) < 0)) problems.push(`changes[${index}]: breakMinutes must be non-negative`);
    }
  });
  return problems;
}

export function isPlannerPatchStale(patch, currentBaseRevision) {
  return patch?.baseRevision !== currentBaseRevision;
}
