function normalizePriority(value, fallback = 2) {
  const number = Number(value);
  return [1, 2, 3].includes(number) ? number : fallback;
}

function normalizePeriods(value, fallback = ["afternoon"]) {
  const allowed = new Set(["morning", "midday", "afternoon", "evening"]);
  const rows = Array.isArray(value) ? value.filter((item) => allowed.has(item)) : [];
  return rows.length ? rows : fallback;
}

export function minutesFromPlannerClock(value) {
  if (typeof value !== "string" || !/^\d{1,2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function buildPlannerCreatedTask(change, { taskId, manualOrder = 0 } = {}) {
  const fallbackMinutes = Number(change?.estimatedMinutes);
  const segments = Array.isArray(change?.segments) && change.segments.length
    ? change.segments.map(Number).filter((value) => Number.isFinite(value) && value > 0)
    : (Number.isFinite(fallbackMinutes) && fallbackMinutes > 0 ? [fallbackMinutes] : []);
  if (!taskId || !segments.length || !String(change?.title || "").trim()) return null;
  const start = change.start ? minutesFromPlannerClock(change.start) : null;
  const source = String(change.source || "planner-bridge").trim() || "planner-bridge";
  const sourceId = typeof change.sourceId === "string" && change.sourceId.trim() ? change.sourceId.trim() : "";
  const originInboxItemId = typeof change.originInboxItemId === "string" && change.originInboxItemId.trim() ? change.originInboxItemId.trim() : "";
  return {
    id: taskId,
    title: String(change.title).trim(),
    category: change.category || "个人",
    categoryId: change.categoryId || "personal",
    ...(change.categoryLevel2Id ? { categoryLevel2Id: change.categoryLevel2Id } : {}),
    ...(change.categoryName ? { categoryName: change.categoryName } : {}),
    ...(change.categoryColor ? { categoryColor: change.categoryColor } : {}),
    ...(change.categoryPrimaryId ? { categoryPrimaryId: change.categoryPrimaryId } : {}),
    ...(change.categoryPrimaryName ? { categoryPrimaryName: change.categoryPrimaryName } : {}),
    ...(change.categoryStatGroup ? { categoryStatGroup: change.categoryStatGroup } : {}),
    segments,
    breakMinutes: Math.max(0, Number(change.breakMinutes || 0)),
    splittable: change.splittable !== false,
    priority: normalizePriority(change.priority),
    manualOrder,
    preferredPeriods: normalizePeriods(change.preferredPeriods),
    ...(Number.isFinite(start) ? { manualStart: start, placement: "timeline" } : { placement: "pool" }),
    note: change.note || "",
    source,
    ...(sourceId ? { sourceId } : {}),
    ...(originInboxItemId ? { originInboxItemId } : {}),
    status: "pending",
  };
}

export function buildPlannerEditPatch(change, segment) {
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(change, "title")) patch.title = String(change.title || "").trim() || segment.title;
  if (Object.prototype.hasOwnProperty.call(change, "categoryId")) patch.categoryId = change.categoryId || "personal";
  ["categoryLevel2Id", "categoryName", "categoryColor", "categoryPrimaryId", "categoryPrimaryName", "categoryStatGroup"].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(change, key) && change[key] != null) patch[key] = change[key];
  });
  if (Object.prototype.hasOwnProperty.call(change, "estimatedMinutes")) patch.workMinutes = Math.max(1, Number(change.estimatedMinutes));
  if (Object.prototype.hasOwnProperty.call(change, "breakMinutes")) patch.restMinutes = Math.max(0, Number(change.breakMinutes));
  if (Object.prototype.hasOwnProperty.call(change, "priority")) patch.priority = normalizePriority(change.priority, segment.priority || 2);
  if (Object.prototype.hasOwnProperty.call(change, "preferredPeriods")) patch.preferredPeriods = normalizePeriods(change.preferredPeriods, segment.preferredPeriods || []);
  if (Object.prototype.hasOwnProperty.call(change, "note")) patch.note = String(change.note || "");
  if (Object.prototype.hasOwnProperty.call(change, "locked")) patch.locked = Boolean(change.locked);
  if (Object.prototype.hasOwnProperty.call(change, "status")) patch.status = change.status;
  if (Object.prototype.hasOwnProperty.call(change, "snowdustReminder")) patch.snowdustReminder = change.snowdustReminder ?? null;
  if (Object.prototype.hasOwnProperty.call(change, "startVerification")) patch.startVerification = change.startVerification ?? null;
  if (Object.prototype.hasOwnProperty.call(change, "deskVerification")) patch.deskVerification = change.deskVerification ?? null;
  const clear = Array.isArray(change.clearOverrideFields) ? change.clearOverrideFields : [];
  clear.forEach((field) => { delete patch[field]; patch[`__clear__${field}`] = true; });
  return patch;
}

export function consumePlannerEditClearFields(patch = {}) {
  const cleaned = { ...patch };
  const clearOverrideFields = [];
  Object.keys(cleaned).forEach((key) => {
    if (!key.startsWith("__clear__")) return;
    clearOverrideFields.push(key.slice("__clear__".length));
    delete cleaned[key];
  });
  return { patch: cleaned, clearOverrideFields };
}

export function editedOccupiedDuration(segment, patch = {}) {
  const work = Number.isFinite(Number(patch.workMinutes)) ? Number(patch.workMinutes) : Number(segment.duration || 0);
  const rest = Number.isFinite(Number(patch.restMinutes)) ? Number(patch.restMinutes) : Number(segment.breakAfter || 0);
  return Math.max(1, work + rest);
}

export function buildPlannerDeletePatch({ alreadyStarted = false } = {}) {
  return alreadyStarted
    ? { status: "cancelled" }
    : { deleted: true, placement: "deleted", status: "cancelled", locked: false };
}
