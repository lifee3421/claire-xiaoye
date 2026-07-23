import { normalizeCategoryId } from "../taxonomy/taxonomyContract.js";

export const AGENT_DAY_SNAPSHOT_SCHEMA_VERSION = 1;

function asDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value?.toDate) return asDate(value.toDate());
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoTimestamp(value) {
  return asDate(value)?.toISOString() || null;
}

function zonedParts(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function dateForTimezone(date, timezone) {
  const parts = zonedParts(date, timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function minuteForTimezone(date, timezone) {
  const parts = zonedParts(date, timezone);
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function minuteValue(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  if (typeof value !== "string" || !/^\d{1,2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function clock(minutes) {
  const value = Math.max(0, Math.round(minutes));
  return `${String(Math.floor(value / 60) % 24).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function taskStatus(value) {
  return value === "completed" || value === "pending" ? value : null;
}

function normalizeTimelineBlock(block, index, resolveCategoryStatGroup) {
  const startMinute = minuteValue(block?.startMinute ?? block?.start);
  const endMinute = minuteValue(block?.endMinute ?? block?.end);
  if (!block || !Number.isFinite(startMinute) || !Number.isFinite(endMinute) || endMinute <= startMinute) return null;
  const fixed = Boolean(block.fixed ?? block.isFixedEvent ?? block.kind === "fixed");
  const plannedMinutes = Math.max(0, endMinute - startMinute);
  return {
    id: block.id ? String(block.id) : `timeline-${index}`,
    title: String(block.title || "未命名时间块"),
    category: block.category ? String(block.category) : null,
    categoryId: typeof (block.categoryId ?? block.categoryLevel2Id) === "string" && String(block.categoryId ?? block.categoryLevel2Id).trim()
      ? String(block.categoryId ?? block.categoryLevel2Id).trim()
      : null,
    statGroup: normalizeStatGroup(block.categoryStatGroup)
      || normalizeStatGroup(block.statGroup)
      || resolveCategoryStatGroup(block),
    systemRole: normalizeSystemRole(block.systemRole),
    start: clock(startMinute),
    end: clock(endMinute),
    plannedMinutes,
    status: fixed ? null : taskStatus(block.status),
    fixed,
    locked: Boolean(block.locked),
    _startMinute: startMinute,
    _endMinute: endMinute,
  };
}

function normalizeStatGroup(value) {
  return ["study", "reading", "exercise", "work", "entertainment", "life", "other"].includes(value)
    ? value
    : null;
}

const systemCategoryStatGroups = new Map([
  ["study", "study"], ["math", "study"], ["english", "study"], ["japanese", "study"], ["economics", "study"], ["professional", "study"], ["paper", "study"], ["thesis", "study"],
  // "reading" has its own stat bucket, distinct from the generic "study" prefix
  // fallback — the canonical id "study.reading" needs its own exact entry too,
  // otherwise normalizing "reading" -> "study.reading" before lookup would
  // incorrectly fall through to the coarser "study" bucket via prefix matching.
  ["reading", "reading"], ["study.reading", "reading"],
  ["exercise", "exercise"],
  ["work", "work"],
  ["entertainment", "entertainment"], ["rest", "entertainment"],
  ["life", "life"], ["personal", "life"],
  ["other", "other"],
]);

function statGroupForCategoryId(categoryId) {
  const id = typeof categoryId === "string" ? categoryId.trim().toLowerCase() : "";
  if (!id) return null;
  return systemCategoryStatGroups.get(id)
    || systemCategoryStatGroups.get(id.split(".")[0])
    || null;
}

function categoryStatGroupResolver(classificationTaxonomy) {
  const byId = new Map();
  const visit = (node, inheritedStatGroup = null) => {
    if (!node || typeof node !== "object") return;
    const nodeId = typeof node.id === "string" ? node.id.trim() : "";
    const statGroup = normalizeStatGroup(node.statGroup)
      || statGroupForCategoryId(nodeId)
      || inheritedStatGroup;
    if (nodeId && statGroup) byId.set(nodeId.toLowerCase(), statGroup);
    (Array.isArray(node.children) ? node.children : []).forEach((child) => visit(child, statGroup));
  };
  (Array.isArray(classificationTaxonomy) ? classificationTaxonomy : []).forEach((node) => visit(node));
  // `classificationTaxonomy` is normalized to canonical ids by the time it reaches
  // here, but a scheduled block's own stored categoryId may still be a pre-v3 legacy
  // id (e.g. "math") if it hasn't been re-saved since the taxonomy migration.
  // Normalize the block's id before both lookups so it still resolves.
  return (block) => {
    const canonicalId = normalizeCategoryId(block?.categoryId || block?.categoryLevel2Id);
    return byId.get(canonicalId.toLowerCase())
      || statGroupForCategoryId(canonicalId)
      || null;
  };
}

function publicBlock(block) {
  const { _startMinute, _endMinute, statGroup, systemRole, categoryId, ...result } = block;
  return { ...result, ...(categoryId ? { categoryId } : {}), ...(statGroup ? { statGroup } : {}), ...(systemRole ? { systemRole } : {}) };
}

function normalizeReview(review = {}) {
  const status = ["not_started", "draft", "submitted"].includes(review.status) ? review.status : "not_started";
  return {
    status,
    submittedAt: status === "submitted" ? isoTimestamp(review.submittedAt) : null,
  };
}

/**
 * Pure AgentDaySnapshot transformer. It accepts only already-read data and never
 * persists, fetches, mutates, or infers task completion from wall-clock time.
 */
export function buildAgentDaySnapshot({
  date,
  timezone = "Asia/Shanghai",
  timeline = [],
  review = {},
  metadata = {},
  classificationTaxonomy = [],
  now = new Date(),
} = {}) {
  const nowDate = asDate(now) || new Date(0);
  const snapshotDate = isIsoDate(date) ? date : dateForTimezone(nowDate, timezone);
  const resolveCategoryStatGroup = categoryStatGroupResolver(classificationTaxonomy);
  const normalizedTimeline = (Array.isArray(timeline) ? timeline : [])
    .map((block, index) => normalizeTimelineBlock(block, index, resolveCategoryStatGroup))
    .filter(Boolean)
    .sort((a, b) => a._startMinute - b._startMinute || a._endMinute - b._endMinute || a.id.localeCompare(b.id));
  const isCurrentDate = snapshotDate === dateForTimezone(nowDate, timezone);
  const nowMinute = minuteForTimezone(nowDate, timezone);
  const current = isCurrentDate
    ? normalizedTimeline.find((block) => block._startMinute <= nowMinute && nowMinute < block._endMinute) || null
    : null;
  const taskBlocks = normalizedTimeline.filter((block) => !block.fixed);
  const next = snapshotDate > dateForTimezone(nowDate, timezone)
    ? taskBlocks[0] || null
    : isCurrentDate
      ? taskBlocks.find((block) => block._startMinute > nowMinute) || null
      : null;
  const completed = taskBlocks.filter((block) => block.status === "completed");

  return {
    schemaVersion: AGENT_DAY_SNAPSHOT_SCHEMA_VERSION,
    available: metadata.available !== false,
    date: snapshotDate,
    timezone,
    generatedAt: nowDate.toISOString(),
    planUpdatedAt: isoTimestamp(metadata.planUpdatedAt),
    wakeTime: wakeTimeFromTimeline(normalizedTimeline),
    source: {
      mode: metadata.sourceMode === "firebase" || metadata.sourceMode === "demo" ? metadata.sourceMode : null,
      revision: metadata.revision ?? null,
      reason: ["manual_confirmed", "plan_updated", "completion_changed", "review_submitted"].includes(metadata.reason)
        ? metadata.reason
        : null,
    },
    stageBoundaries: normalizeStageBoundaries(metadata.stageBoundaries),
    timeline: normalizedTimeline.map(publicBlock),
    currentByClock: current ? publicBlock(current) : null,
    nextTask: next ? publicBlock(next) : null,
    progress: {
      completedBlocks: completed.length,
      totalBlocks: taskBlocks.length,
      completedPlannedMinutes: completed.reduce((sum, block) => sum + block.plannedMinutes, 0),
      totalPlannedMinutes: taskBlocks.reduce((sum, block) => sum + block.plannedMinutes, 0),
    },
    review: normalizeReview(review),
  };
}

function normalizeStageBoundaries(value) {
  const fallback = { morning: { start: "00:00", end: "12:00" }, afternoon: { start: "12:00", end: "18:00" }, evening: { start: "18:00", end: "23:59" } };
  if (!value || typeof value !== "object") return undefined;
  const result = {};
  for (const [name, fallbackValue] of Object.entries(fallback)) {
    const item = value[name];
    if (minuteValue(item?.start) === null || minuteValue(item?.end) === null) return undefined;
    result[name] = { start: clock(minuteValue(item.start)), end: clock(minuteValue(item.end)) };
  }
  return result;
}

function latestSettlementForDate(settlements, date) {
  return (Array.isArray(settlements) ? settlements : [])
    .filter((item) => item?.reviewDate === date)
    .map((item) => ({ item, createdAt: asDate(item.createdAt)?.getTime() || 0 }))
    .sort((a, b) => b.createdAt - a.createdAt)[0]?.item || null;
}

/** Thin adapter for the existing in-memory Daily data shape. */
export function buildAgentDaySnapshotFromDailyData({
  plan,
  profile = {},
  classificationTaxonomy = profile?.classificationTaxonomy || [],
  settlements = [],
  sourceMode,
  now = new Date(),
} = {}) {
  const timezone = "Asia/Shanghai";
  const snapshotDate = isIsoDate(plan?.targetDate) ? plan.targetDate : dateForTimezone(asDate(now) || new Date(), timezone);
  const settlement = latestSettlementForDate(settlements, snapshotDate);
  return buildAgentDaySnapshot({
    date: snapshotDate,
    timezone,
    timeline: plan?.blocks || [],
    classificationTaxonomy,
    review: settlement
      ? { status: "submitted", submittedAt: settlement.createdAt }
      : { status: "not_started" },
    metadata: {
      available: Boolean(plan && Array.isArray(plan.blocks)),
      planUpdatedAt: profile?.scheduleAssistantDraft?.updatedAt || null,
      sourceMode,
      revision: null,
    },
    now,
  });
}

function normalizeSystemRole(value) { return ["wake_routine", "day-start-anchor"].includes(value) ? value : null; }
function wakeTimeFromTimeline(timeline) {
  const wake = timeline.find((block) => block.categoryId === "life.morning-routine")
    || timeline.find((block) => ["wake_routine", "day-start-anchor"].includes(block.systemRole))
    || timeline.find((block) => block.id === "wake-prep")
    || timeline.find((block) => block.fixed && /^(?:起床[｜|].*洗漱|起床与洗漱)/.test(block.title));
  return wake ? wake.start : null;
}
