// Server-safe apply of a PlannerPatch (src/agent/plannerPatch.js) onto a raw
// schedule draft. This is the ONE place a PlannerPatch actually becomes a
// draft mutation — used by both a future client-side apply path and the
// planner-bridge Vercel endpoints (api/planner-apply.js), so there is
// exactly one implementation of "how does an AI-proposed change become a
// real draft edit", not a second engine parallel to ScheduleAssistant's.
//
// Movable scope: every BUILT-IN study/life task group (math/english/thesis/
// professional/exercise/formal-rest/system/reading/weekly-review — see
// BUILTIN_MOVABLE_TASK_IDS in plannerLiveTimeline.js), every
// draft.todayCustomBlocks entry (custom/rescheduled/pool-return/inbox-
// sourced), and every legacy-fixed-event. NEVER the 6 hard system-life cards
// (wake-prep/lunch/startup/dinner/daily-review/bed-prep) — those are
// rejected outright, both because resolveMovableLiveSegment structurally
// never produces them (buildPlannerTaskGroups excludes them by
// construction) and via an explicit PROTECTED_SYSTEM_CARD_IDS check before
// even attempting resolution, so the rejection reason is legible.
//
// Reuses (never reimplements) buildPlannerTaskGroups/flattenPlannerTasks to
// resolve "what tasks exist right now and where" — see
// src/schedule/plannerLiveTimeline.js's file header for why this is safe
// without recomputing buildAutoSchedulePlan's full template/settings-driven
// auto-scheduler. `autoContext` is passed as `{}` here (never fetched) —
// its only structural effect anywhere in buildPlannerTaskGroups is whether
// the `reading` group exists at all (autoContext.recentReadingTitle); every
// other use is display-text-only. That means a patch can never target the
// `reading` group via the bridge today (resolution simply finds nothing,
// same as any other unresolvable id) — a known, documented, fail-closed
// scope limit, not a silent gap. `englishSkills` is resolved with an empty
// settlements array — `resolveEnglishSkills`'s "recommended" rotation only
// reorders WHICH skill each segment nominally represents when settlement
// history is unavailable; the number and duration of `english` segments
// (the only things this module needs to be correct) never depend on it.
//
// Conflict validation (see validatePatchConflicts) runs BEFORE any mutation
// is computed for real: a proposed placement that falls outside today's
// timeline, overlaps a hard system-life card, or overlaps another live task
// is rejected wholesale — draft untouched — with structured conflict details
// the caller can relay back to the user, never silently auto-resolved.
//
// Every actual mutation still goes through the SAME primitives the browser
// uses: resolveSegmentMove/resolveSegmentRemoval (via
// computeTimelinePositionsPatch) and mergeTimelineMutationIntoDraft, both in
// timelineRescheduleGate.js — past-block-lock/history-preservation behavior
// is identical whether the caller is a human dragging a card or an applied
// PlannerPatch.

import { flattenPlannerTasks, buildScheduledTaskBlockFromSegment } from "../utils/plannerTimelineBlocks.js";
import { computeTimelinePositionsPatch, mergeTimelineMutationIntoDraft, isLivePlanBlock, resolveSegmentRemoval } from "./timelineRescheduleGate.js";
import { buildPlannerCreatedTask, buildPlannerEditPatch, consumePlannerEditClearFields, editedOccupiedDuration, buildPlannerDeletePatch } from "./plannerPatchCardOps.js";
import { applySavedDayTemplate } from "./plannerTemplateApply.js";
import { validatePlannerPatchShape } from "../agent/plannerPatch.js";
import { replaceCanonicalDailyState } from "./plannerDailyCanonicalState.js";
import { computePlannerContextBaseRevision } from "../agent/buildPlannerContext.js";
import { createBaselinePlanSnapshot, hasBaseline } from "./baselinePlanModel.js";
import { dateForTimezone, minuteForTimezone } from "../agent/buildAgentDaySnapshot.js";
import {
  PROTECTED_SYSTEM_CARD_IDS,
  buildPlannerTaskGroups,
  resolveEnglishSkills,
  resolveMorningPrepMinutes,
  resolvePlannerTemplates,
  resolvePlannerTimelineBounds,
  resolveRecentReadingTitle,
  resolveSystemCardIntervals,
} from "./plannerLiveTimeline.js";

const TIMEZONE = "Asia/Shanghai";

function minutesFromClock(value) {
  if (typeof value !== "string" || !/^\d{1,2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function taskIdFromBlockId(blockId) {
  const match = typeof blockId === "string" ? /^(.*)-(\d+)$/.exec(blockId) : null;
  return match ? match[1] : null;
}

/**
 * Builds every movable task group for `draft` (built-ins resolved from
 * `settings`'s templates, plus todayCustomBlocks/legacy-fixed-events),
 * flattened into segments. This is the single place both
 * resolveMovableLiveSegment and validatePatchConflicts get "what's
 * currently live" from — computed once per applyPlannerPatch call, not per
 * change.
 *
 * `books`/`readingSessions` are optional and ONLY feed
 * resolveRecentReadingTitle (the one autoContext field that's structurally
 * load-bearing for whether the `reading` group exists at all — see
 * plannerLiveTimeline.js's comment on that function). Omitting them simply
 * means `reading` won't resolve today, same as before this fix — never a
 * crash, never a guessed title.
 */
export function resolveMovableSegments(draft, settings = {}, { books = [], readingSessions = [] } = {}) {
  const { mathTemplate, englishTemplate } = resolvePlannerTemplates(draft, settings);
  const englishSkills = resolveEnglishSkills(draft, settings, [], englishTemplate);
  const autoContext = { recentReadingTitle: resolveRecentReadingTitle({ books, readingSessions }) };
  const taskGroups = buildPlannerTaskGroups({ draft, mathTemplate, englishTemplate, englishSkills, autoContext });
  return flattenPlannerTasks(taskGroups, draft.taskPoolOrder || []);
}

/**
 * A legacy fixed event (source: "legacy-fixed-event", from
 * draft.fixedEvents/fixedEventOverrides) is a REAL calendar commitment the
 * user entered — not a system structural card, but not automatically safe
 * for AI apply either just because buildPlannerTaskGroups happens to
 * produce it alongside ordinary movable tasks. One that's `locked` (which
 * migrateLegacyFixedEvents defaults to `true` unless the user explicitly
 * unlocked it) or explicitly marked `constraint: "hard"` (set via the
 * EditFixedEventModal's 约束 field) is treated the same as a protected
 * system card: never movable via PlannerPatch. An ordinary, unlocked/soft
 * legacy fixed event (or any todayCustomBlocks/built-in task) is unaffected.
 */
function isProtectedLegacyFixedEvent(segment) {
  return segment?.source === "legacy-fixed-event" && (segment.locked === true || segment.constraint === "hard");
}

/**
 * Resolves the CURRENT live state of one movable segment by blockId.
 * Returns null if blockId doesn't resolve to anything in `segments` (a
 * built-in/system card typo, a stale id from a superseded proposal), if it
 * names one of the 6 protected system-life cards (which
 * buildPlannerTaskGroups structurally never produces anyway), or if it
 * names a locked/hard-constraint legacy fixed event (see
 * isProtectedLegacyFixedEvent above).
 */
export function resolveMovableLiveSegment(segments, blockId) {
  const taskId = taskIdFromBlockId(blockId);
  if (!taskId || PROTECTED_SYSTEM_CARD_IDS.has(taskId)) return null;
  const segment = segments.find((item) => item.blockId === blockId) || null;
  if (segment && isProtectedLegacyFixedEvent(segment)) return null;
  return segment;
}

/**
 * Human-legible reason a blockId was rejected, for building clearer problem
 * messages than a flat "does not resolve" — lets the caller (and eventually
 * Snow-dust) explain WHY something can't move, per the product requirement
 * that a protected/invalid rejection must say why, not just fail silently.
 * Returns null when the block IS resolvable (nothing to explain).
 */
export function describeBlockRejection(segments, blockId) {
  const taskId = taskIdFromBlockId(blockId);
  if (!taskId) return "invalid_block_id";
  if (PROTECTED_SYSTEM_CARD_IDS.has(taskId)) return "protected_system_card";
  const segment = segments.find((item) => item.blockId === blockId) || null;
  if (!segment) return "not_found";
  if (isProtectedLegacyFixedEvent(segment)) return "protected_fixed_event";
  return null;
}

const REJECTION_MESSAGES = {
  invalid_block_id: "is not a valid blockId",
  not_found: "does not resolve to any movable segment",
  protected_system_card: "is a protected system-life card (wake/meal/rest/sleep anchor) and can never be moved via apply",
  protected_fixed_event: "is a locked/hard-constraint fixed event — a real calendar commitment, not an ordinary task — and can never be moved via apply",
};

function describeRejectionMessage(segments, blockId) {
  return REJECTION_MESSAGES[describeBlockRejection(segments, blockId)] || REJECTION_MESSAGES.not_found;
}

/**
 * Turns a resolved segment into the minimal "live block" shape
 * resolveSegmentMove/resolveSegmentRemoval need (id/start/end/status/locked/
 * etc). A segment with no manualStart yet (still in the pool) gets a stub
 * with no `start` field — isBlockLockedByNow treats a missing/non-finite
 * start as "not locked", which is exactly correct: a pool item was never
 * started, so it's always freely movable.
 */
function liveBlockStubFromSegment(segment) {
  const manualStart = Number(segment.manualStart);
  if (Number.isFinite(manualStart)) return buildScheduledTaskBlockFromSegment(segment, { start: manualStart });
  return {
    id: segment.blockId,
    title: segment.segmentTitle,
    category: segment.category,
    categoryId: segment.categoryId,
    categoryStatGroup: segment.categoryStatGroup,
    breakMinutes: segment.breakAfter,
    priority: segment.priority,
    preferredPeriods: segment.preferredPeriods,
    locked: Boolean(segment.locked),
    status: segment.status,
    studyMinutes: segment.duration,
  };
}

function normalizePriority(value, fallback = 2) {
  const number = Number(value);
  return [1, 2, 3].includes(number) ? number : fallback;
}

/** Builds a brand-new todayCustomBlocks entry for a "create_from_tracker"
 * change. Mirrors src/utils/plannerInbox.js's buildTodayCustomBlockFromInboxItem
 * (same todayCustomBlocks shape, same "never guess a duration" rule) rather
 * than importing it directly — the input shape here is a PlannerPatchChange,
 * not an InboxItem, and the two are unrelated enough that forcing one
 * function to serve both would mean the "which caller shape is this" checks
 * outweigh the ~10 lines actually shared. */
function buildTodayCustomBlockFromTrackerChange(change, { taskId, manualOrder }) {
  const minutes = Number(change.estimatedMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return {
    id: taskId,
    title: change.title || change.trackerId,
    category: "生活",
    categoryId: change.categoryId || "personal",
    segments: [minutes],
    breakMinutes: 0,
    splittable: true,
    priority: normalizePriority(change.priority),
    manualOrder,
    preferredPeriods: ["afternoon"],
    note: change.note || "",
    source: "planner-bridge",
    originTrackerId: change.trackerId,
  };
}

function intervalsOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

/**
 * Deterministic conflict check for a batch of proposed {id, start, end}
 * placements, run BEFORE any draft mutation is computed. Checks, per
 * proposal:
 *   - timeline boundary (start/end must fall within [timelineStart, timelineEnd])
 *   - overlap against a hard system-life card (wake/lunch/nap/dinner/review/bed)
 *   - overlap against any OTHER currently-live movable block (excluding the
 *     ones THIS patch is itself moving/returning-to-pool, and excluding
 *     already-superseded history)
 *   - basic duration/start sanity (non-finite or non-positive duration)
 * Returns `{ ok, conflicts }` — `conflicts` is always an array (possibly
 * containing more than one problem); the caller must reject the WHOLE patch
 * if `conflicts.length > 0`, never partially apply or auto-resolve.
 */
export function validatePatchConflicts({ draft, settings = {}, segments, positions }) {
  const { timelineStart, timelineEnd } = resolvePlannerTimelineBounds(draft);
  const systemCards = resolveSystemCardIntervals({ draft, timelineStart, timelineEnd, effectiveMorningPrepMinutes: resolveMorningPrepMinutes(draft) });

  const touchedIds = new Set(positions.map((item) => item.id));
  const otherLiveBlocks = segments
    .filter((segment) => segment.placement === "timeline")
    .filter((segment) => Number.isFinite(Number(segment.manualStart)))
    .filter((segment) => isLivePlanBlock({ status: segment.status }))
    .filter((segment) => !touchedIds.has(segment.blockId))
    .map((segment) => ({ id: segment.blockId, title: segment.segmentTitle, start: Number(segment.manualStart), end: Number(segment.manualStart) + segment.occupiedDuration }));

  const conflicts = [];

  positions.forEach((position) => {
    if (!Number.isFinite(position.start) || !Number.isFinite(position.end) || position.end <= position.start) {
      conflicts.push({ type: "invalid_duration", blockId: position.id, start: position.start, end: position.end });
      return;
    }
    if (position.start < timelineStart || position.end > timelineEnd) {
      conflicts.push({ type: "out_of_bounds", blockId: position.id, start: position.start, end: position.end, timelineStart, timelineEnd });
      return;
    }
    const fixedHit = systemCards.find((card) => intervalsOverlap(position, card));
    if (fixedHit) {
      conflicts.push({ type: "fixed_block_overlap", blockId: position.id, start: position.start, end: position.end, withId: fixedHit.id, withTitle: fixedHit.title, withStart: fixedHit.start, withEnd: fixedHit.end });
      return;
    }
    const taskHit = otherLiveBlocks.find((block) => intervalsOverlap(position, block));
    if (taskHit) {
      conflicts.push({ type: "task_overlap", blockId: position.id, start: position.start, end: position.end, withId: taskHit.id, withTitle: taskHit.title, withStart: taskHit.start, withEnd: taskHit.end });
    }
  });

  // Two blocks THIS SAME patch is placing must not land on top of each other either.
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = i + 1; j < positions.length; j += 1) {
      if (intervalsOverlap(positions[i], positions[j])) {
        conflicts.push({ type: "task_overlap", blockId: positions[i].id, start: positions[i].start, end: positions[i].end, withId: positions[j].id, withStart: positions[j].start, withEnd: positions[j].end });
      }
    }
  }

  return { ok: conflicts.length === 0, conflicts };
}

/**
 * @param {object} params
 * @param {object} params.draft - the raw, currently-persisted schedule draft
 * @param {object} [params.settings] - profile.scheduleAssistantSettings (for resolving math/english templates)
 * @param {object[]} [params.books] - profile's books collection (only for resolveRecentReadingTitle)
 * @param {object[]} [params.readingSessions] - profile's readingSessions collection (only for resolveRecentReadingTitle)
 * @param {object} params.patch - a PlannerPatch (see src/agent/plannerPatch.js)
 * @param {Date} [params.now]
 * @param {function} [params.idFactory] - injectable for deterministic tests
 * @returns {object} one of:
 *   { ok: false, reason: "invalid_shape", problems }
 *   { ok: false, reason: "wrong_date", expected, received }
 *   { ok: false, reason: "stale", currentRevision }
 *   { ok: false, reason: "unresolvable_changes", problems, rejections }
 *   { ok: false, reason: "conflict", conflicts }
 *   { ok: true, nextDraft, changedBlockIds, summary }
 */
export function applyPlannerPatch({ draft = {}, settings = {}, books = [], readingSessions = [], patch, now = new Date(), idFactory } = {}) {
  const shapeProblems = validatePlannerPatchShape(patch);
  if (shapeProblems.length) return { ok: false, reason: "invalid_shape", problems: shapeProblems };

  if (patch.date !== draft.targetDate) {
    return { ok: false, reason: "wrong_date", expected: draft.targetDate, received: patch.date };
  }

  const currentRevision = computePlannerContextBaseRevision({ draft });
  if (patch.baseRevision !== currentRevision) {
    return { ok: false, reason: "stale", currentRevision };
  }

  const nowDate = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const nowIso = nowDate.toISOString();
  const nowMinutes = draft.targetDate === dateForTimezone(nowDate, TIMEZONE) ? minuteForTimezone(nowDate, TIMEZONE) : -Infinity;

  // Apply a saved day template first. It is one explicit operation, so Snow can
  // start from a known routine without re-creating every card in chat. Other
  // changes in the same patch are then resolved against that materialized day.
  let workingDraft = draft;
  let replacedDayState = false;
  const replacement = patch.changes.find((change) => change.type === "replace_day_state");
  if (replacement) {
    const resolved = replaceCanonicalDailyState(workingDraft, replacement.state);
    if (!resolved.ok) return { ok: false, reason: "invalid_shape", problems: resolved.problems };
    workingDraft = resolved.draft;
    replacedDayState = true;
  }
  const templateCreatedTaskIds = [];
  let appliedTemplateCount = 0;
  for (const change of patch.changes) {
    if (change.type !== "apply_template") continue;
    const result = applySavedDayTemplate({
      draft: workingDraft,
      settings,
      templateId: change.templateId,
      scopes: change.scopes || {},
      now: nowDate,
    });
    if (!result.ok) {
      return { ok: false, reason: "unresolvable_changes", problems: [`template "${change.templateId}" could not be applied: ${result.reason}`], rejections: [{ templateId: change.templateId, reason: result.reason }] };
    }
    workingDraft = result.nextDraft;
    templateCreatedTaskIds.push(...(result.createdTaskIds || []));
    appliedTemplateCount += 1;
  }

  const movableSegments = resolveMovableSegments(workingDraft, settings, { books, readingSessions });

  const liveBlocks = [];
  const positions = [];
  const returnedToPool = [];
  const trackerBlocks = [];
  const createdTaskBlocks = [];
  const directOverridePatches = {};
  const directOverrideClearFields = {};
  const extraForId = {};
  let requestedPoolOrder = null;
  const problems = [];
  const rejections = [];
  let trackerTaskCounter = 0;
  let createdTaskCounter = 0;

  patch.changes.forEach((change, index) => {
    if (change.type === "apply_template" || change.type === "replace_day_state") return;
    if (change.type === "move" || change.type === "schedule_from_pool") {
      const segment = resolveMovableLiveSegment(movableSegments, change.blockId);
      if (!segment) {
        problems.push(`changes[${index}]: blockId "${change.blockId}" ${describeRejectionMessage(movableSegments, change.blockId)}`);
        rejections.push({ index, blockId: change.blockId, reason: describeBlockRejection(movableSegments, change.blockId) });
        return;
      }
      const startMinutes = minutesFromClock(change.start);
      if (startMinutes === null) {
        problems.push(`changes[${index}]: "${change.start}" is not a valid HH:MM start time`);
        return;
      }
      liveBlocks.push(liveBlockStubFromSegment(segment));
      positions.push({ id: change.blockId, start: startMinutes, end: startMinutes + segment.occupiedDuration });
      return;
    }
    if (change.type === "return_to_pool") {
      const segment = resolveMovableLiveSegment(movableSegments, change.blockId);
      if (!segment) {
        problems.push(`changes[${index}]: blockId "${change.blockId}" ${describeRejectionMessage(movableSegments, change.blockId)}`);
        rejections.push({ index, blockId: change.blockId, reason: describeBlockRejection(movableSegments, change.blockId) });
        return;
      }
      liveBlocks.push(liveBlockStubFromSegment(segment));
      returnedToPool.push(change.blockId);
      return;
    }
    if (change.type === "create_task") {
      createdTaskCounter += 1;
      const taskId = change.taskId || (idFactory ? idFactory() : `bridge-task-${Date.parse(nowIso)}-${createdTaskCounter}`);
      const block = buildPlannerCreatedTask(change, { taskId, manualOrder: (workingDraft.todayCustomBlocks || []).length + trackerBlocks.length + createdTaskCounter });
      if (!block) {
        problems.push(`changes[${index}]: create_task needs a title and positive estimatedMinutes`);
        rejections.push({ index, reason: "invalid_create_task" });
        return;
      }
      createdTaskBlocks.push(block);
      if (Number.isFinite(Number(block.manualStart))) {
        const blockId = `${taskId}-1`;
        positions.push({ id: blockId, start: Number(block.manualStart), end: Number(block.manualStart) + Number(block.segments[0]) + Number(block.breakMinutes || 0) });
      }
      return;
    }
    if (change.type === "edit_task") {
      const segment = resolveMovableLiveSegment(movableSegments, change.blockId);
      if (!segment) {
        problems.push(`changes[${index}]: blockId "${change.blockId}" ${describeRejectionMessage(movableSegments, change.blockId)}`);
        rejections.push({ index, blockId: change.blockId, reason: describeBlockRejection(movableSegments, change.blockId) });
        return;
      }
      const rawEditPatch = buildPlannerEditPatch(change, segment);
      const { patch: editPatch, clearOverrideFields } = consumePlannerEditClearFields(rawEditPatch);
      directOverridePatches[change.blockId] = { ...(directOverridePatches[change.blockId] || {}), ...editPatch };
      if (clearOverrideFields.length) directOverrideClearFields[change.blockId] = clearOverrideFields;
      const requestedStart = Object.prototype.hasOwnProperty.call(change, "start") ? minutesFromClock(change.start) : Number(segment.manualStart);
      const editsPlacement = Object.prototype.hasOwnProperty.call(change, "start") || Object.prototype.hasOwnProperty.call(editPatch, "workMinutes") || Object.prototype.hasOwnProperty.call(editPatch, "restMinutes");
      if (editsPlacement && Number.isFinite(requestedStart)) {
        liveBlocks.push(liveBlockStubFromSegment(segment));
        positions.push({ id: change.blockId, start: requestedStart, end: requestedStart + editedOccupiedDuration(segment, editPatch) });
        extraForId[change.blockId] = editPatch;
      }
      return;
    }
    if (change.type === "delete_task") {
      const segment = resolveMovableLiveSegment(movableSegments, change.blockId);
      if (!segment) {
        problems.push(`changes[${index}]: blockId "${change.blockId}" ${describeRejectionMessage(movableSegments, change.blockId)}`);
        rejections.push({ index, blockId: change.blockId, reason: describeBlockRejection(movableSegments, change.blockId) });
        return;
      }
      const live = liveBlockStubFromSegment(segment);
      const removal = resolveSegmentRemoval({ block: live, nowMinutes });
      directOverridePatches[change.blockId] = buildPlannerDeletePatch({ alreadyStarted: removal.cancel });
      return;
    }
    if (change.type === "set_pool_order") {
      requestedPoolOrder = [...change.blockIds];
      return;
    }
    if (change.type === "create_from_tracker") {
      trackerTaskCounter += 1;
      const taskId = idFactory ? idFactory() : `bridge-${Date.parse(nowIso)}-${trackerTaskCounter}`;
      const block = buildTodayCustomBlockFromTrackerChange(change, { taskId, manualOrder: (workingDraft.todayCustomBlocks || []).length + trackerTaskCounter });
      if (!block) {
        problems.push(`changes[${index}]: create_from_tracker requires a positive estimatedMinutes (never guessed) for tracker "${change.trackerId}"`);
        rejections.push({ index, trackerId: change.trackerId, reason: "missing_estimated_minutes" });
        return;
      }
      trackerBlocks.push(block);
    }
  });

  if (problems.length) return { ok: false, reason: "unresolvable_changes", problems, rejections };

  const conflictPositions = replacedDayState
    ? movableSegments.filter((segment) => segment.placement === "timeline" && Number.isFinite(Number(segment.manualStart)) && isLivePlanBlock({ status: segment.status })).map((segment) => ({ id: segment.blockId, start: Number(segment.manualStart), end: Number(segment.manualStart) + segment.occupiedDuration }))
    : positions;
  const conflictCheck = validatePatchConflicts({ draft: workingDraft, settings, segments: movableSegments, positions: conflictPositions });
  if (!conflictCheck.ok) return { ok: false, reason: "conflict", conflicts: conflictCheck.conflicts };

  const timelinePatch = computeTimelinePositionsPatch({
    blocks: liveBlocks,
    positions,
    returnedToPool,
    nowMinutes,
    nowIso,
    reason: patch.changes.find((change) => change.reason)?.reason || "雪尘排程调整",
    idFactory,
    extraForId,
  });

  let nextDraft = mergeTimelineMutationIntoDraft(workingDraft, timelinePatch);
  if (Object.keys(directOverridePatches).length) {
    const nextOverrides = { ...(nextDraft.todaySegmentOverrides || {}) };
    Object.entries(directOverridePatches).forEach(([id, editPatch]) => {
      const merged = { ...(nextOverrides[id] || {}), ...editPatch };
      (directOverrideClearFields[id] || []).forEach((field) => { delete merged[field]; });
      nextOverrides[id] = merged;
    });
    nextDraft = { ...nextDraft, todaySegmentOverrides: nextOverrides };
  }
  if (trackerBlocks.length || createdTaskBlocks.length) {
    nextDraft = { ...nextDraft, todayCustomBlocks: [...(nextDraft.todayCustomBlocks || []), ...trackerBlocks, ...createdTaskBlocks] };
  }
  if (requestedPoolOrder) nextDraft = { ...nextDraft, taskPoolOrder: requestedPoolOrder };

  // An applied PlannerProposal is already an explicit confirmation. Capture the
  // first confirmed Snow-dust-written plan as the day baseline so the user does
  // not have to reopen the planner just to press “保存初版”. Never overwrite an
  // existing baseline here.
  if (!hasBaseline(nextDraft)) {
    const baselineSegments = resolveMovableSegments(nextDraft, settings, { books, readingSessions });
    const baselineBlocks = baselineSegments
      .filter((segment) => segment.placement === "timeline" && Number.isFinite(Number(segment.manualStart)))
      .map((segment) => buildScheduledTaskBlockFromSegment(segment, { start: Number(segment.manualStart) }))
      .filter(isLivePlanBlock);
    nextDraft = {
      ...nextDraft,
      baselinePlanSnapshot: createBaselinePlanSnapshot({
        targetDate: nextDraft.targetDate,
        confirmedAt: nowIso,
        targetSnapshot: nextDraft.studyTargetSnapshot || null,
        blocks: baselineBlocks,
      }),
    };
  }

  const changedBlockIds = [
    ...templateCreatedTaskIds,
    ...(replacedDayState ? resolveMovableSegments(nextDraft, settings, { books, readingSessions }).map((segment) => segment.blockId) : []),
    ...positions.map((item) => item.id),
    ...returnedToPool,
    ...timelinePatch.newCustomBlocks.map((block) => block.id),
    ...trackerBlocks.map((block) => block.id),
    ...createdTaskBlocks.map((block) => block.id),
    ...Object.keys(directOverridePatches),
  ];

  const movedCount = positions.length;
  const returnedCount = returnedToPool.length;
  const createdCount = trackerBlocks.length + createdTaskBlocks.length;
  const editedCount = patch.changes.filter((change) => change.type === "edit_task").length;
  const deletedCount = patch.changes.filter((change) => change.type === "delete_task").length;
  const summaryParts = [];
  if (replacedDayState) summaryParts.push("替换当天排程状态");
  if (requestedPoolOrder) summaryParts.push("调整任务池顺序");
  if (appliedTemplateCount) summaryParts.push(`套用模板 ${appliedTemplateCount} 个`);
  if (movedCount) summaryParts.push(`移动 ${movedCount} 项`);
  if (returnedCount) summaryParts.push(`放回任务池 ${returnedCount} 项`);
  if (createdCount) summaryParts.push(`新增 ${createdCount} 项`);
  if (editedCount) summaryParts.push(`编辑 ${editedCount} 项`);
  if (deletedCount) summaryParts.push(`删除/取消 ${deletedCount} 项`);
  const summary = summaryParts.length ? summaryParts.join("，") : "无实际变更";

  return { ok: true, nextDraft, changedBlockIds, summary };
}
