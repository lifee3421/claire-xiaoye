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

export function resolveMovableSegments(draft, settings = {}, { books = [], readingSessions = [] } = {}) {
  const { mathTemplate, englishTemplate } = resolvePlannerTemplates(draft, settings);
  const englishSkills = resolveEnglishSkills(draft, settings, [], englishTemplate);
  const autoContext = { recentReadingTitle: resolveRecentReadingTitle({ books, readingSessions }) };
  const taskGroups = buildPlannerTaskGroups({ draft, mathTemplate, englishTemplate, englishSkills, autoContext });
  return flattenPlannerTasks(taskGroups, draft.taskPoolOrder || []);
}

function isProtectedLegacyFixedEvent(segment) {
  return segment?.source === "legacy-fixed-event" && (segment.locked === true || segment.constraint === "hard");
}

export function resolveMovableLiveSegment(segments, blockId) {
  const taskId = taskIdFromBlockId(blockId);
  if (!taskId || PROTECTED_SYSTEM_CARD_IDS.has(taskId)) return null;
  const segment = segments.find((item) => item.blockId === blockId) || null;
  if (segment && isProtectedLegacyFixedEvent(segment)) return null;
  return segment;
}

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
 * Validate new placements against the live plan. `removedBlockIds` are blocks
 * that the SAME atomic patch is returning to the pool/deleting from occupancy;
 * they must not be treated as blockers for a pool->timeline replacement.
 */
export function validatePatchConflicts({ draft, settings = {}, segments, positions, removedBlockIds = [] }) {
  const { timelineStart, timelineEnd } = resolvePlannerTimelineBounds(draft);
  const systemCards = resolveSystemCardIntervals({ draft, timelineStart, timelineEnd, effectiveMorningPrepMinutes: resolveMorningPrepMinutes(draft) });

  const touchedIds = new Set([
    ...positions.map((item) => item.id),
    ...(Array.isArray(removedBlockIds) ? removedBlockIds : []),
  ]);
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

  for (let i = 0; i < positions.length; i += 1) {
    for (let j = i + 1; j < positions.length; j += 1) {
      if (intervalsOverlap(positions[i], positions[j])) {
        conflicts.push({ type: "task_overlap", blockId: positions[i].id, start: positions[i].start, end: positions[i].end, withId: positions[j].id, withStart: positions[j].start, withEnd: positions[j].end });
      }
    }
  }

  return { ok: conflicts.length === 0, conflicts };
}

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
  const conflictCheck = validatePatchConflicts({
    draft: workingDraft,
    settings,
    segments: movableSegments,
    positions: conflictPositions,
    removedBlockIds: replacedDayState ? [] : returnedToPool,
  });
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