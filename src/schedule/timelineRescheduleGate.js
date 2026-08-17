// Single gate every real timeline-mutation entry point (drag, TaskMoveSheet,
// gap/compress dialogs, move-to-pool, delete) must route a start-time change
// or removal through, so "a block whose start is already in the past must
// never be silently rewritten" is enforced in exactly one place — never
// re-implemented per handler.
//
// This module stays React/Firestore-free on purpose (like baselinePlanModel.js,
// which it wraps) so the decision logic itself is directly unit-testable.
import { isBlockLockedByNow, createPlanRevision } from "./baselinePlanModel.js";

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

// Status values that mean "this is a historical record of a block that no
// longer represents live, executable work" — shared by every place that
// must exclude them from "already scheduled" minute counts / Focus overlap,
// so that list is defined exactly once.
export const SUPERSEDED_BLOCK_STATUSES = new Set(["rescheduled", "cancelled"]);

export function isSupersededBlockStatus(status) {
  return SUPERSEDED_BLOCK_STATUSES.has(status);
}
