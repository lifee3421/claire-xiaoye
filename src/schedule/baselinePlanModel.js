// Plan versioning: draft -> baseline (frozen on first confirmation) -> current
// (latest editable timeline) -> revisions (history of what changed and why).
//
// Central rule (spec section 8): once a block's original end time is already
// in the past relative to "now", it must never be silently rewritten in
// place. Moving it forward creates a *new* block linked back via
// originBlockId, while the original block is kept and marked with its real
// outcome (missed/rescheduled/cancelled/partial) instead of disappearing.
//
// Times are represented the same way the existing timeline does: integer
// minutes-of-day (see src/utils/plannerMinutes.js), scoped to a single
// planning date.

export const BASELINE_PLAN_SNAPSHOT_SCHEMA_VERSION = 1;

function defaultIdFactory(prefix) {
  return () => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Recursively strip `undefined` values from an object/array so the payload
 * is safe for Firestore (which rejects `undefined` values without
 * `ignoreUndefinedProperties`).  Preserves null, false, 0, "" and other
 * falsy-but-legal values.
 *
 * Arrays: undefined elements are kept as null so array length/index
 * semantics are preserved.  Sub-objects within arrays are recursively
 * cleaned.
 *
 * Objects: keys whose value is `undefined` are deleted entirely.
 */
export function firestoreSafeNormalize(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => firestoreSafeNormalize(item));
  }
  const result = {};
  for (const [key, val] of Object.entries(value)) {
    if (val === undefined) continue;
    result[key] = firestoreSafeNormalize(val);
  }
  return result;
}

/**
 * Freeze the plan exactly as first confirmed for a date. Callers must only
 * invoke this once per date — guard with `hasBaseline(draft)` before
 * calling; this function itself does not check for an existing baseline
 * because it has no draft to read back from.
 *
 * Blocks are recursively normalized to strip `undefined` values so the
 * payload can survive a Firestore write without `ignoreUndefinedProperties`.
 */
export function createBaselinePlanSnapshot({ targetDate, confirmedAt, targetSnapshot = null, blocks = [] } = {}) {
  return firestoreSafeNormalize({
    schemaVersion: BASELINE_PLAN_SNAPSHOT_SCHEMA_VERSION,
    targetDate,
    confirmedAt,
    targetSnapshot: targetSnapshot ? { ...firestoreSafeNormalize(targetSnapshot) } : null,
    blocks: (Array.isArray(blocks) ? blocks : []).map((block) => firestoreSafeNormalize({ ...block })),
  });
}

export function hasBaseline(draft) {
  return Boolean(draft && draft.baselinePlanSnapshot && draft.baselinePlanSnapshot.targetDate);
}

/**
 * Record one revision entry. `reason` should be one of the spec's suggested
 * categories (状态调整/启动延迟/临时事务/通勤变化/主动缩减/任务延期/其他) or
 * any caller-supplied string — this function does not validate the reason
 * vocabulary, only that the shape is well-formed.
 */
export function createPlanRevision({ createdAt, effectiveFrom, reason = "其他", changedBlockIds = [], idFactory = defaultIdFactory("rev") } = {}) {
  return {
    revisionId: idFactory(),
    createdAt,
    effectiveFrom,
    reason,
    changedBlockIds: Array.isArray(changedBlockIds) ? [...changedBlockIds] : [],
  };
}

/**
 * Has this block already happened (fully or partially) as of `nowMinutes`?
 * A block that hasn't started yet is freely editable in place; once it has
 * started, its past must be preserved.
 */
export function isBlockLockedByNow(block, nowMinutes) {
  const start = Number(block?.start);
  if (!Number.isFinite(start)) return false;
  return nowMinutes >= start;
}

export function classifyPastBlockStatus({ block, nowMinutes, executedMinutes = null }) {
  const start = Number(block?.start);
  const end = Number(block?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "unknown";
  if (nowMinutes < start) return "future";
  if (nowMinutes >= end) return executedMinutes !== null && executedMinutes > 0 && executedMinutes < end - start ? "partial" : "missed";
  return "in-progress";
}

/**
 * Move a block's time. If the block hasn't started yet, it's edited in
 * place (no history split needed — nothing "happened" yet to protect).
 * Otherwise the original block is kept, tagged with `status`, and a new
 * block is created for the new time range, linked back via originBlockId.
 */
export function rescheduleBlock({
  block,
  nowMinutes,
  newStart,
  newEnd,
  revisionId,
  rescheduledAt,
  originStatus = "rescheduled",
  idFactory = defaultIdFactory("block"),
} = {}) {
  if (!isBlockLockedByNow(block, nowMinutes)) {
    return { blocks: [{ ...block, start: newStart, end: newEnd }], created: false };
  }

  const originalBlock = { ...block, status: originStatus };
  const newBlock = {
    ...block,
    id: idFactory(),
    start: newStart,
    end: newEnd,
    originBlockId: block.id,
    rescheduledFrom: { start: block.start, end: block.end },
    rescheduledAt,
    revisionId,
  };
  delete newBlock.status;

  return { blocks: [originalBlock, newBlock], created: true };
}

/**
 * Cancel a block. Future blocks can simply be removed from the timeline;
 * a block that has already started/ended must be kept and marked
 * "cancelled" rather than deleted, so the fact it was (or wasn't) done
 * isn't erased.
 */
export function cancelBlock({ block, nowMinutes }) {
  if (!isBlockLockedByNow(block, nowMinutes)) {
    return { deleted: true, block: null };
  }
  return { deleted: false, block: { ...block, status: "cancelled" } };
}

/**
 * Whether the current timeline is identical to the baseline (so a
 * baseline-vs-current UI strip can safely stay hidden, per spec section 10).
 */
export function isCurrentPlanIdenticalToBaseline({ baselineBlocks = [], currentBlocks = [] } = {}) {
  const normalize = (blocks) => (Array.isArray(blocks) ? blocks : [])
    .filter((b) => b.status !== "cancelled")
    .map((b) => `${b.id}:${b.start}:${b.end}`)
    .sort();
  const a = normalize(baselineBlocks);
  const b = normalize(currentBlocks);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
