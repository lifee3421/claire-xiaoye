import { asRecord, isIsoCalendarDate, normalizeIsoTimestamp } from "./plannerNormalization.js";

// "待安排 Inbox": a date-independent backlog of things the user knows they
// need to do eventually but hasn't decided a day for yet. Lives on the
// profile (profile.plannerInbox), NOT inside any per-date scheduleAssistantDraft
// — putting it there would mean every "someday" item silently belongs to
// whichever date happened to be open when it was added.
//
// Item lifecycle: active -> scheduled (once placed onto some day's task pool
// via buildTodayCustomBlockFromInboxItem + markInboxItemScheduled) -> either
// back to active (unscheduleInboxItem, e.g. the day's block was deleted) or
// archived. Nothing here ever deletes a today-custom-block or mutates a
// scheduleAssistantDraft directly — callers own that side of the wire.

export const INBOX_ITEM_STATUSES = ["active", "scheduled", "archived"];
const PRIORITIES = [1, 2, 3];

function normalizeStatus(value) {
  return INBOX_ITEM_STATUSES.includes(value) ? value : "active";
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

/** Compatibility boundary for one persisted inbox item. Unknown/malformed
 * input degrades to safe defaults rather than throwing; a raw value with no
 * usable id is dropped entirely (returns null) by the caller-facing list fns. */
export function normalizeInboxItem(raw) {
  const source = asRecord(raw);
  if (!source.id) return null;
  const createdAt = normalizeIsoTimestamp(source.createdAt) || new Date(0).toISOString();
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

/** Hard removal — only intended for items the user explicitly deletes, not
 * the normal "I'm done with this" path (that's archiveInboxItem). */
export function removeInboxItem(items, id) {
  return normalizeInboxItems(items).filter((item) => item.id !== id);
}

/**
 * Converts an inbox item into a todayCustomBlocks-shaped entry. Pure and
 * side-effect free: does not touch the inbox array, does not pick a task id
 * beyond what's passed in, and refuses to guess a duration — if the item has
 * no estimatedMinutes and none is supplied, returns null so the UI can force
 * the user to fill one in rather than the scheduler silently guessing.
 */
export function buildTodayCustomBlockFromInboxItem(item, { taskId, manualOrder = 1, estimatedMinutesOverride, now = new Date(), categoryPatch = {} } = {}) {
  const minutes = normalizeMinutes(item?.estimatedMinutes) ?? normalizeMinutes(estimatedMinutesOverride);
  if (!item || !minutes) return null;
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

/** Marks the inbox item as scheduled and records where it went. The caller
 * is responsible for actually appending the todayCustomBlocks entry to that
 * date's draft — this only updates the inbox side of the (intentionally
 * loose, not doubly-enforced) link. */
export function markInboxItemScheduled(items, id, { targetDate, taskId, now = new Date() } = {}) {
  return updateInboxItem(items, id, { status: "scheduled", scheduledDate: targetDate, scheduledTaskId: taskId }, { now });
}

export function unscheduleInboxItem(items, id, options) {
  return updateInboxItem(items, id, { status: "active", scheduledDate: "", scheduledTaskId: "" }, options);
}

export function selectActiveInboxItems(items) {
  return normalizeInboxItems(items).filter((item) => item.status === "active");
}
