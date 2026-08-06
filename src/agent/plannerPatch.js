// PlannerPatch: the data shape a future "commit this plan change" step will
// use once Snow-dust's chat-driven re-planning is wired up for real (see
// buildPlannerContext.js's file header for the read side of that flow).
//
// THIS FILE INTENTIONALLY CONTAINS NO APPLY/MUTATION LOGIC. It only defines
// the shape and the staleness check, so the interface is settled now without
// building a second mutation engine. When the apply step is actually built,
// it must translate each PlannerPatch change into calls on the EXISTING
// timeline-mutation choke points — never re-implement move/cancel/return-to-
// pool logic here:
//
//   - "move"                -> App.jsx's commitTimelinePositions([{id, start, end}])
//                              (which itself calls schedule/timelineRescheduleGate.js's
//                              resolveSegmentMove — the one place that decides whether
//                              an already-started block gets edited in place or split
//                              into a history record + a new linked block)
//   - "return_to_pool"      -> commitTimelinePositions({ returnedToPool: [id] })
//                              (-> resolveSegmentRemoval / resolveSegmentReturnToPool)
//   - "schedule_from_pool"  -> commitTimelinePositions([{id, start, end}]) — a pool
//                              segment being given a manualStart is the same
//                              "move" call as timeline-to-timeline moves; the gate
//                              doesn't distinguish the two.
//   - "create_from_tracker" -> the existing "新增当天任务块"/addTodayCustomTask path
//                              (todayCustomBlocks), NOT a new tracker-to-block writer.
//
// Every real mutation still goes through commitDraftChange's plannerPast/
// planRevisions bookkeeping (undo history, revision log) exactly as it does
// today for a human dragging a card — a PlannerPatch is just an alternate
// *source* of the same {id, start, end} / returnedToPool inputs those
// functions already accept, not a parallel code path.

/**
 * @typedef {object} PlannerPatchChange
 * @property {"move"|"return_to_pool"|"schedule_from_pool"|"create_from_tracker"} type
 * @property {string} [blockId] - required for move/return_to_pool/schedule_from_pool;
 *   the segment/block id as it appears in PlannerContext.timeline[].id or
 *   PlannerContext.taskPool[].blockId
 * @property {string} [start] - "HH:MM", required for move/schedule_from_pool
 * @property {string} [trackerId] - required for create_from_tracker
 * @property {string} [reason] - short human-readable reason, surfaced into the
 *   resulting planRevisions entry (see baselinePlanModel.js's createPlanRevision)
 */

/**
 * @typedef {object} PlannerPatch
 * @property {number} schemaVersion
 * @property {string} date - the plan date this patch applies to, "YYYY-MM-DD"
 * @property {string} baseRevision - MUST equal the `baseRevision` of the
 *   PlannerContext the proposal was built from (see
 *   buildPlannerContext.js's computePlannerContextBaseRevision). The future
 *   apply step recomputes baseRevision from the CURRENT plan/draft at commit
 *   time and rejects the patch outright if it no longer matches — the plan
 *   moved on (e.g. the user edited it manually mid-conversation) and Snow-dust
 *   must re-fetch a fresh PlannerContext and re-propose, never silently
 *   overwrite. This is the "discussion state never writes, only an explicit
 *   commit with a matching baseRevision may" rule from spec section VII/VIII.
 * @property {PlannerPatchChange[]} changes
 */

export const PLANNER_PATCH_SCHEMA_VERSION = 1;
export const PLANNER_PATCH_CHANGE_TYPES = ["move", "return_to_pool", "schedule_from_pool", "create_from_tracker"];

/**
 * Structural validation only — does NOT check the patch against a live plan
 * (that's the future apply step's job, using a freshly recomputed
 * baseRevision). Returns a list of human-readable problems; empty means
 * "well-formed", not "safe to apply".
 */
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
    if (change.type !== "create_from_tracker" && !change.blockId) problems.push(`changes[${index}]: blockId is required for "${change.type}"`);
    if ((change.type === "move" || change.type === "schedule_from_pool") && !change.start) problems.push(`changes[${index}]: start is required for "${change.type}"`);
    if (change.type === "create_from_tracker" && !change.trackerId) problems.push(`changes[${index}]: trackerId is required for "create_from_tracker"`);
  });
  return problems;
}

/**
 * The staleness check itself: does `patch.baseRevision` still match the plan
 * as it stands right now? Pass the SAME `computePlannerContextBaseRevision`
 * inputs (draft/plan) the caller would use to build a fresh PlannerContext.
 * True means the patch may proceed to whatever real apply step exists;
 * false means reject it and ask for a re-propose against fresh context.
 */
export function isPlannerPatchStale(patch, currentBaseRevision) {
  return patch?.baseRevision !== currentBaseRevision;
}
