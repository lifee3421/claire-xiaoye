// Single gate every real timeline-mutation entry point (drag, TaskMoveSheet,
// gap/compress dialogs, move-to-pool, delete) must route a start-time change
// or removal through, so "a block whose start is already in the past must
// never be silently rewritten" is enforced in exactly one place — never
// re-implemented per handler.
//
// This module stays React/Firestore-free on purpose (like baselinePlanModel.js,
// which it wraps) so the decision logic itself is directly unit-testable.
import { isBlockLockedByNow, createPlanRevision, SUPERSEDED_BLOCK_STATUSES, isSupersededBlockStatus, isLivePlanBlock } from "./baselinePlanModel.js";
import { getBlockActiveMinutes } from "../utils/plannerMinutes.js";

// Re-exported so existing importers (App.jsx, focusOverlap.js,
// plannerOverview.js) keep working after the canonical superseded/live
// definitions moved into baselinePlanModel.js.
export { SUPERSEDED_BLOCK_STATUSES, isSupersededBlockStatus, isLivePlanBlock };

/**
 * Decide how to apply a start-time change for one timeline block.
 *
 * - Not locked yet (hasn't started), or the start isn't actually changing:
 *   `{ split: false }` — caller should just write the new manualStart/
 *   workMinutes onto the SAME block id, exactly as before this feature.
 * - Locked (already started) and the start really is changing: `{ split: true, ... }`
 *   — caller must (a) mark the ORIGINAL block's override `status: "rescheduled"`
 *   without touching its manualStart/placement, and (b) add `newCustomBlock`
 *   as a new entry in `draft.todayCustomBlocks`, and (c) append `revision` to
 *   `draft.planRevisions`. The original block's time/identity is never
 *   mutated in place.
 */
export function resolveSegmentMove({ block, newStart, newWorkMinutes, nowMinutes, reason = "手动调整", idFactory, nowIso = new Date().toISOString() } = {}) {
  if (!block || !Number.isFinite(Number(newStart))) return { split: false };
  const start = Number(newStart);
  if (Number(block.start) === start) return { split: false };
  if (!isBlockLockedByNow(block, nowMinutes)) return { split: false };

  const workMinutes = Math.max(1, Number.isFinite(Number(newWorkMinutes)) ? Number(newWorkMinutes) : Number(block.studyMinutes ?? (block.end - block.start)));
  const revision = createPlanRevision({ createdAt: nowIso, effectiveFrom: nowIso, reason, changedBlockIds: [block.id], idFactory });
  const newBlockId = idFactory ? idFactory() : `resched-${block.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  return {
    split: true,
    originBlockId: block.id,
    revision,
    newCustomBlock: {
      id: newBlockId,
      title: block.title,
      category: block.category,
      categoryId: block.categoryId,
      categoryStatGroup: block.categoryStatGroup,
      segments: [workMinutes],
      breakMinutes: Number(block.breakMinutes || 0),
      manualStart: start,
      locked: false,
      priority: Number(block.priority || 2),
      preferredPeriods: block.preferredPeriods || [],
      note: block.note || "",
      source: "rescheduled",
      originBlockId: block.id,
      rescheduledFrom: { start: block.start, end: block.end },
      rescheduledAt: nowIso,
      revisionId: revision.revisionId,
    },
  };
}

/**
 * Decide how to apply a removal (delete, or "move back to pool") for one
 * timeline block. Not locked: `{ cancel: false }` — free to delete/pool as
 * before. Locked: `{ cancel: true }` — caller must mark the block
 * `status: "cancelled"` in place and must NOT physically delete it or move
 * it back to the pool.
 */
export function resolveSegmentRemoval({ block, nowMinutes } = {}) {
  if (!block) return { cancel: false };
  if (!isBlockLockedByNow(block, nowMinutes)) return { cancel: false };
  return { cancel: true };
}

/**
 * Decide how to apply a "return to pool" (放回任务池) for one timeline block.
 *
 * - Not started yet (future): `{ split: false }` — the caller writes
 *   placement:pool / manualStart:null and the segment simply leaves the
 *   timeline (no history copy is needed because nothing "happened" yet).
 * - Already started / partial / past: `{ split: true, ... }` — the caller
 *   MUST (a) keep the ORIGINAL block as a historical superseded record
 *   (status set by the caller; it stays in plan.allBlocks but no longer
 *   occupies the live timeline) and (b) add `newPoolBlock` as a brand-new
 *   live `todayCustomBlock` (placement pool) the user can re-schedule, with
 *   `originBlockId` pointing back to the original so the relationship survives
 *   a reload. The original is never physically deleted.
 *
 * This replaces the old behaviour where "protect past history" silently
 * cancelled the block in place without ever returning a live task to the pool
 * — the source of the "ghost block" bug (spec section 7 + 10).
 */
export function resolveSegmentReturnToPool({ block, nowMinutes, reason = "放回任务池", idFactory, nowIso = new Date().toISOString() } = {}) {
  if (!block) return { split: false };
  if (!isBlockLockedByNow(block, nowMinutes)) {
    return { split: false };
  }
  const revision = createPlanRevision({ createdAt: nowIso, effectiveFrom: nowIso, reason, changedBlockIds: [block.id], idFactory });
  const newPoolBlockId = idFactory ? idFactory() : `pool-${block.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const workMinutes = Math.max(1, getBlockActiveMinutes(block));
  return {
    split: true,
    originBlockId: block.id,
    revision,
    newPoolBlock: {
      id: newPoolBlockId,
      placement: "pool",
      title: block.title,
      category: block.category,
      categoryId: block.categoryId,
      categoryStatGroup: block.categoryStatGroup,
      segments: [workMinutes],
      breakMinutes: Number(block.breakMinutes || 0),
      manualStart: null,
      locked: false,
      priority: Number(block.priority || 2),
      preferredPeriods: block.preferredPeriods || [],
      note: block.note || "",
      source: "pool-return",
      originBlockId: block.id,
      revisionId: revision.revisionId,
      poolReturnedAt: nowIso,
    },
  };
}

/**
 * Pure extraction of App.jsx's `commitTimelinePositions` decision body — the
 * "single choke point every real timeline-mutation entry point routes a
 * batch of {id,start,end} position writes through" (see that function's own
 * comment). Takes the live block list as a plain argument instead of closing
 * over React state, and RETURNS the resulting patch pieces instead of
 * calling setState, so the exact same decision logic is usable both from
 * ScheduleAssistant (passing `autoSchedule.blocks`, the full computed plan)
 * and from the server-side planner-bridge apply endpoint (passing a small
 * synthesized list containing just the specific segments a PlannerPatch
 * references — see src/schedule/plannerPatchApply.js). `blocks` only needs
 * to be "the current live block for each id the caller is about to touch";
 * neither this function nor resolveSegmentMove/resolveSegmentRemoval care
 * how that list was assembled.
 *
 * Returns `{ overridePatches, newCustomBlocks, revisions }` — merge into a
 * draft with `mergeTimelineMutationIntoDraft` below.
 */
export function computeTimelinePositionsPatch({ blocks = [], positions = [], returnedToPool = [], nowMinutes, nowIso = new Date().toISOString(), reason = "拖拽/排程调整", idFactory, extraForId = {} } = {}) {
  const blocksById = new Map(blocks.map((item) => [item.id, item]));
  const overridePatches = {};
  const newCustomBlocks = [];
  const revisions = [];

  (positions || []).forEach((item) => {
    const block = blocksById.get(item.id);
    const result = resolveSegmentMove({ block, newStart: item.start, newWorkMinutes: Number.isFinite(item.end - item.start) ? item.end - item.start - Number(block?.breakMinutes || 0) : undefined, nowMinutes, reason, idFactory, nowIso });
    if (result.split) {
      overridePatches[result.originBlockId] = { ...(overridePatches[result.originBlockId] || {}), status: "rescheduled" };
      newCustomBlocks.push(result.newCustomBlock);
      revisions.push(result.revision);
      return;
    }
    overridePatches[item.id] = { ...(overridePatches[item.id] || {}), placement: "timeline", manualStart: item.start, locked: false, status: "pending", ...(extraForId[item.id] || {}) };
  });

  (returnedToPool || []).forEach((segmentId) => {
    const block = blocksById.get(segmentId);
    const removal = resolveSegmentRemoval({ block, nowMinutes });
    overridePatches[segmentId] = removal.cancel
      ? { ...(overridePatches[segmentId] || {}), status: "cancelled" }
      : { ...(overridePatches[segmentId] || {}), placement: "pool", manualStart: null, locked: false, status: "pending" };
  });

  return { overridePatches, newCustomBlocks, revisions };
}

/**
 * Merges a `computeTimelinePositionsPatch` result into a draft object,
 * returning a NEW draft (never mutates `draft`) — the exact merge shape
 * App.jsx's commitTimelinePositions passed to commitDraftChange.
 */
export function mergeTimelineMutationIntoDraft(draft, { overridePatches = {}, newCustomBlocks = [], revisions = [] } = {}) {
  return {
    ...draft,
    todaySegmentOverrides: {
      ...(draft.todaySegmentOverrides || {}),
      ...Object.fromEntries(Object.entries(overridePatches).map(([id, patch]) => [id, { ...(draft.todaySegmentOverrides?.[id] || {}), ...patch }])),
    },
    ...(newCustomBlocks.length ? { todayCustomBlocks: [...(draft.todayCustomBlocks || []), ...newCustomBlocks] } : {}),
    ...(revisions.length ? { planRevisions: [...(draft.planRevisions || []), ...revisions] } : {}),
  };
}
