import { extractCanonicalDailyState } from "./plannerDailyCanonicalState.js";

function clockFromMinutes(value) {
  const minutes = Math.max(0, Math.min(23 * 60 + 59, Math.round(Number(value) || 0)));
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function buildSegmentEditChange(blockId, input = {}) {
  if (!blockId) return null;
  const patch = input?.patch && Array.isArray(input.clearOverrideFields) ? input.patch : input;
  const clearOverrideFields = input?.patch && Array.isArray(input.clearOverrideFields) ? input.clearOverrideFields : [];
  if (patch?.manualStart === null || patch?.placement === "pool" || patch?.unscheduled === true) {
    return { type: "return_to_pool", blockId };
  }
  const change = { type: "edit_task", blockId };
  if (Number.isFinite(Number(patch?.manualStart))) change.start = clockFromMinutes(patch.manualStart);
  if (Object.prototype.hasOwnProperty.call(patch || {}, "title")) change.title = patch.title;
  if (Object.prototype.hasOwnProperty.call(patch || {}, "categoryId")) change.categoryId = patch.categoryId;
  ["categoryLevel2Id", "categoryName", "categoryColor", "categoryPrimaryId", "categoryPrimaryName", "categoryStatGroup"].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(patch || {}, key)) change[key] = patch[key];
  });
  if (Number.isFinite(Number(patch?.workMinutes))) change.estimatedMinutes = Number(patch.workMinutes);
  if (Number.isFinite(Number(patch?.restMinutes))) change.breakMinutes = Number(patch.restMinutes);
  if (Object.prototype.hasOwnProperty.call(patch || {}, "locked")) change.locked = Boolean(patch.locked);
  if (Object.prototype.hasOwnProperty.call(patch || {}, "status")) change.status = patch.status;
  if (Object.prototype.hasOwnProperty.call(patch || {}, "priority")) change.priority = patch.priority;
  if (Object.prototype.hasOwnProperty.call(patch || {}, "preferredPeriods")) change.preferredPeriods = patch.preferredPeriods;
  if (Object.prototype.hasOwnProperty.call(patch || {}, "note")) change.note = patch.note;
  if (Object.prototype.hasOwnProperty.call(patch || {}, "snowdustReminder")) change.snowdustReminder = patch.snowdustReminder;
  if (Object.prototype.hasOwnProperty.call(patch || {}, "startVerification")) change.startVerification = patch.startVerification;
  if (Object.prototype.hasOwnProperty.call(patch || {}, "deskVerification")) change.deskVerification = patch.deskVerification;
  if (clearOverrideFields.length) change.clearOverrideFields = clearOverrideFields;
  return Object.keys(change).length > 2 ? change : null;
}

export function buildCreateTaskChange(block = {}) {
  if (!block?.id || !String(block.title || "").trim()) return null;
  return {
    type: "create_task",
    taskId: block.id,
    title: block.title,
    segments: Array.isArray(block.segments) ? block.segments : undefined,
    estimatedMinutes: Array.isArray(block.segments) && block.segments.length ? Number(block.segments[0]) : undefined,
    breakMinutes: Number(block.breakMinutes || 0),
    category: block.category,
    categoryId: block.categoryId,
    categoryLevel2Id: block.categoryLevel2Id,
    categoryName: block.categoryName,
    categoryColor: block.categoryColor,
    categoryPrimaryId: block.categoryPrimaryId,
    categoryPrimaryName: block.categoryPrimaryName,
    categoryStatGroup: block.categoryStatGroup,
    priority: block.priority,
    preferredPeriods: block.preferredPeriods,
    note: block.note,
    source: block.source || "xiaoye-ui",
    sourceId: block.sourceId,
    originInboxItemId: block.originInboxItemId,
    ...(Number.isFinite(Number(block.manualStart)) ? { start: clockFromMinutes(block.manualStart) } : {}),
  };
}

export function buildDeleteTaskChanges(blockIds = []) {
  return [...new Set((blockIds || []).filter(Boolean))].map((blockId) => ({ type: "delete_task", blockId }));
}

export function buildPoolOrderChange(blockIds = []) {
  return { type: "set_pool_order", blockIds: [...new Set((blockIds || []).filter(Boolean))] };
}

export function buildReplaceDayStateChange(nextDraft = {}) {
  return { type: "replace_day_state", state: extractCanonicalDailyState(nextDraft) };
}
