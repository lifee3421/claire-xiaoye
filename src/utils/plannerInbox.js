import { asRecord, isIsoCalendarDate, normalizeIsoTimestamp } from "./plannerNormalization.js";

// The planner Inbox is the lightweight shared ledger beside the daily
// timeline. Human-created backlog tasks keep the original behaviour, while
// Snow-dust may also store notes/follow-ups here so both sides can see the
// same small piece of state instead of keeping a private duplicate in
// Cyberboss. Existing UI remains backward-compatible because all new fields
// are optional and ordinary items default to kind=task/source=user.
//
// Item lifecycle: active -> scheduled (task placed onto a day) -> active again
// when unscheduled, or archived. Follow-up/note items normally remain active
// until completed/cancelled/archived and are never required to become a task.

export const INBOX_ITEM_STATUSES = ["active", "scheduled", "archived"];
export const INBOX_ITEM_KINDS = ["task", "note", "followup"];
export const INBOX_ITEM_SOURCES = ["user", "snowdust"];
export const INBOX_TRIGGER_TYPES = ["none", "time", "after_block_start", "after_block_end"];
const PRIORITIES = [1, 2, 3];

function normalizeStatus(value) {
  return INBOX_ITEM_STATUSES.includes(value) ? value : "active";
}

function normalizeKind(value) {
  return INBOX_ITEM_KINDS.includes(value) ? value : "task";
}

function normalizeSource(value) {
  return INBOX_ITEM_SOURCES.includes(value) ? value : "user";
}

function normalizeTriggerType(value) {
  return INBOX_TRIGGER_TYPES.includes(value) ? value : "none";
}

function normalizePriority(value) {
  const number = Number(value);
  return PRIORITIES.includes(number) ? number : 2;
}

function normalizeMinutes(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function normalizeNote(value) {
  return typeof value === "string" ? value.slice(0, 500) : "";
}

function normalizeString(value, max = 300) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Compatibility boundary for one persisted inbox/shared-ledger item. */
export function normalizeInboxItem(raw) {
  const source = asRecord(raw);
  if (!source.id) return null;
  const createdAt = normalizeIsoTimestamp(source.createdAt) || new Date(0).toISOString();
  const completedAt = normalizeIsoTimestamp(source.completedAt) || "";
  return {
    id: String(source.id),
    title: (typeof source.title === "string" ? source.title : "").trim() || "待安排事项",
    categoryId: typeof source.categoryId === "string" && source.categoryId ? source.categoryId : "personal",
    estimatedMinutes: normalizeMinutes(source.estimatedMinutes),
    priority: normalizePriority(source.priority),
    deadline: isIsoCalendarDate(source.deadline) ? source.deadline : "",
    note: normalizeNote(source.note),
    status: normalizeStatus(source.status),
    createdAt,
    updatedAt: normalizeIsoTimestamp(source.updatedAt) || createdAt,
    scheduledDate: isIsoCalendarDate(source.scheduledDate) ? source.scheduledDate : "",
    scheduledTaskId: typeof source.scheduledTaskId === "string" ? source.scheduledTaskId : "",

    // Shared-ledger metadata. These fields are deliberately plain JSON so the
    // profile remains Firestore-safe and old clients can ignore them.
    kind: normalizeKind(source.kind),
    source: normalizeSource(source.source),
    targetDate: isIsoCalendarDate(source.targetDate) ? source.targetDate : "",
    dueAt: normalizeIsoTimestamp(source.dueAt) || "",
    triggerType: normalizeTriggerType(source.triggerType),
    boundBlockId: normalizeString(source.boundBlockId, 160),
    reminderId: normalizeString(source.reminderId, 160),
    followupText: normalizeString(source.followupText, 500),
    completedAt,
  };
}

export function normalizeInboxItems(raw) {
  return (Array.isArray(raw) ? raw : []).map(normalizeInboxItem).filter(Boolean);
}

export function createInboxItem(input = {}, { now = new Date() } = {}) {
  const nowIso = now.toISOString();
  return normalizeInboxItem({
    id: input.id || `inbox-${now.getTime()}`,
    title: input.title,
    categoryId: input.categoryId,
    estimatedMinutes: input.estimatedMinutes,
    priority: input.priority,
    deadline: input.deadline,
    note: input.note,
    status: "active",
    createdAt: nowIso,
    updatedAt: nowIso,
    kind: input.kind,
    source: input.source,
    targetDate: input.targetDate,
    dueAt: input.dueAt,
    triggerType: input.triggerType,
    boundBlockId: input.boundBlockId,
    reminderId: input.reminderId,
    followupText: input.followupText,
    completedAt: input.completedAt,
  });
}

export function addInboxItem(items, input, options) {
  return [...normalizeInboxItems(items), createInboxItem(input, options)];
}

export function updateInboxItem(items, id, patch = {}, { now = new Date() } = {}) {
  const list = normalizeInboxItems(items);
  let found = false;
  const next = list.map((item) => {
    if (item.id !== id) return item;
    found = true;
    return normalizeInboxItem({ ...item, ...patch, id: item.id, createdAt: item.createdAt, updatedAt: now.toISOString() });
  });
  return found ? next : list;
}

export function archiveInboxItem(items, id, options) {
  return updateInboxItem(items, id, { status: "archived" }, options);
}

export function restoreInboxItem(items, id, options) {
  return updateInboxItem(items, id, { status: "active" }, options);
}

/** Hard removal — only for an explicit delete. */
export function removeInboxItem(items, id) {
  return normalizeInboxItems(items).filter((item) => item.id !== id);
}

/**
 * Converts a task-kind inbox item into a todayCustomBlocks-shaped entry.
 * Notes/follow-ups intentionally refuse conversion: they are zero-duration
 * shared context, not fake schedule work. Existing legacy items all normalize
 * to kind=task and therefore keep the old behaviour.
 */
export function buildTodayCustomBlockFromInboxItem(item, { taskId, manualOrder = 1, estimatedMinutesOverride, now = new Date(), categoryPatch = {} } = {}) {
  if (!item || (item.kind && item.kind !== "task")) return null;
  const minutes = normalizeMinutes(item?.estimatedMinutes) ?? normalizeMinutes(estimatedMinutesOverride);
  if (!minutes) return null;
  return {
    id: taskId || `custom-${now.getTime()}`,
    title: item.title,
    category: "生活",
    categoryId: item.categoryId || "personal",
    ...categoryPatch,
    segments: [minutes],
    breakMinutes: 0,
    splittable: true,
    priority: normalizePriority(item.priority),
    manualOrder,
    preferredPeriods: ["afternoon"],
    note: item.note || "",
    source: "inbox",
    originInboxItemId: item.id,
  };
}

export function markInboxItemScheduled(items, id, { targetDate, taskId, now = new Date() } = {}) {
  return updateInboxItem(items, id, { status: "scheduled", scheduledDate: targetDate, scheduledTaskId: taskId }, { now });
}

export function unscheduleInboxItem(items, id, options) {
  return updateInboxItem(items, id, { status: "active", scheduledDate: "", scheduledTaskId: "" }, options);
}

export function selectActiveInboxItems(items) {
  return normalizeInboxItems(items).filter((item) => item.status === "active");
}

/** Compact day-aware view used by PlannerContext. Global backlog items have no
 * targetDate; day-specific Snow notes/follow-ups are shown only on that day. */
export function selectSharedLedgerItems(items, targetDate = "") {
  return normalizeInboxItems(items)
    .filter((item) => item.status !== "archived")
    .filter((item) => !item.targetDate || !targetDate || item.targetDate === targetDate)
    .slice(-40);
}
