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

function normalizeTimelineBlock(block, index) {
  const startMinute = minuteValue(block?.startMinute ?? block?.start);
  const endMinute = minuteValue(block?.endMinute ?? block?.end);
  if (!block || !Number.isFinite(startMinute) || !Number.isFinite(endMinute) || endMinute <= startMinute) return null;
  const fixed = Boolean(block.fixed ?? block.isFixedEvent ?? block.kind === "fixed");
  const plannedMinutes = Math.max(0, endMinute - startMinute);
  return {
    id: block.id ? String(block.id) : `timeline-${index}`,
    title: String(block.title || "未命名时间块"),
    category: block.category ? String(block.category) : null,
    // The planner already resolves categoryStatGroup from its taxonomy.  Keep
    // this optional so old saved plans stay compatible.
    statGroup: normalizeStatGroup(block.categoryStatGroup || block.statGroup),
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

function publicBlock(block) {
  const { _startMinute, _endMinute, statGroup, ...result } = block;
  return statGroup ? { ...result, statGroup } : result;
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
  now = new Date(),
} = {}) {
  const nowDate = asDate(now) || new Date(0);
  const snapshotDate = isIsoDate(date) ? date : dateForTimezone(nowDate, timezone);
  const normalizedTimeline = (Array.isArray(timeline) ? timeline : [])
    .map(normalizeTimelineBlock)
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
