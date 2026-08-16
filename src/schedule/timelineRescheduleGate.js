import { isBlockLockedByNow, createPlanRevision, SUPERSEDED_BLOCK_STATUSES, isSupersededBlockStatus, isLivePlanBlock } from "./baselinePlanModel.js";
import { getBlockActiveMinutes } from "../utils/plannerMinutes.js";
import { computePlannerContextBaseRevision } from "../agent/buildPlannerContext.js";

export { SUPERSEDED_BLOCK_STATUSES, isSupersededBlockStatus, isLivePlanBlock };

const CANONICAL_MUTATION_QUEUE_FIELD = "__canonicalPlannerMutations";

function copyCategoryMetadata(source = {}) {
  return {
    category: source.category,
    categoryId: source.categoryId,
    categoryLevel2Id: source.categoryLevel2Id,
    categoryName: source.categoryName,
    categoryColor: source.categoryColor,
    categoryPrimaryId: source.categoryPrimaryId,
    categoryPrimaryName: source.categoryPrimaryName,
    categoryStatGroup: source.categoryStatGroup,
  };
}

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
      ...copyCategoryMetadata(block),
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

export function resolveSegmentRemoval({ block, nowMinutes } = {}) {
  if (!block) return { cancel: false };
  if (!isBlockLockedByNow(block, nowMinutes)) return { cancel: false };
  return { cancel: true };
}

export function resolveSegmentReturnToPool({ block, nowMinutes, reason = "放回任务池", idFactory, nowIso = new Date().toISOString() } = {}) {
  if (!block) return { split: false };
  if (!isBlockLockedByNow(block, nowMinutes)) return { split: false };
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
      ...copyCategoryMetadata(block),
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
 * Pure planner position calculation shared by the browser and server kernel.
 * Browser drag calls are additionally annotated with a transient canonical
 * mutation intent; server-side PlannerPatch calls use a different reason and
 * therefore never produce that client-only marker.
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

  const canonicalUiIntent = shouldStageCanonicalUiIntent(reason, extraForId)
    ? buildCanonicalUiIntent({ blocksById, positions, returnedToPool, nowIso })
    : null;
  return { overridePatches, newCustomBlocks, revisions, canonicalUiIntent };
}

/**
 * Merge a calculated timeline mutation into the local draft. A normal browser
 * drag carries a durable local queue item containing the PRE-mutation revision
 * and the semantic PlannerPatch changes. The queue is not part of the planner
 * revision fingerprint and is stripped before any Firestore persistence; it
 * only lets the existing autosave hand the gesture to the canonical API.
 */
export function mergeTimelineMutationIntoDraft(draft, { overridePatches = {}, newCustomBlocks = [], revisions = [], canonicalUiIntent = null } = {}) {
  const next = {
    ...draft,
    todaySegmentOverrides: {
      ...(draft.todaySegmentOverrides || {}),
      ...Object.fromEntries(Object.entries(overridePatches).map(([id, patch]) => [id, { ...(draft.todaySegmentOverrides?.[id] || {}), ...patch }])),
    },
    ...(newCustomBlocks.length ? { todayCustomBlocks: [...(draft.todayCustomBlocks || []), ...newCustomBlocks] } : {}),
    ...(revisions.length ? { planRevisions: [...(draft.planRevisions || []), ...revisions] } : {}),
  };
  if (!canonicalUiIntent?.changes?.length || !draft?.targetDate) return next;

  const baseRevision = computePlannerContextBaseRevision({ draft });
  const afterRevision = computePlannerContextBaseRevision({ draft: next });
  const pending = Array.isArray(draft[CANONICAL_MUTATION_QUEUE_FIELD]) ? draft[CANONICAL_MUTATION_QUEUE_FIELD] : [];
  return {
    ...next,
    [CANONICAL_MUTATION_QUEUE_FIELD]: [
      ...pending,
      {
        ...canonicalUiIntent,
        date: draft.targetDate,
        baseRevision,
        afterRevision,
      },
    ],
  };
}

function shouldStageCanonicalUiIntent(reason, extraForId) {
  // Only the browser's ordinary drag/drop choke point uses this exact reason.
  // Resize/edit flows supply extraForId and remain on their existing path in
  // this phase; server PlannerPatch uses "雪尘排程调整" and never stages UI work.
  return reason === "拖拽/排程调整" && Object.keys(extraForId || {}).length === 0 && typeof window !== "undefined";
}

export function buildCanonicalUiIntent({ blocksById = new Map(), positions = [], returnedToPool = [], nowIso = new Date().toISOString(), operationId = "" } = {}) {
  const returned = new Set(returnedToPool || []);
  const changes = [];
  for (const item of positions || []) {
    if (!item?.id || returned.has(item.id) || !Number.isFinite(Number(item.start))) continue;
    changes.push({
      type: blocksById.has(item.id) ? "move" : "schedule_from_pool",
      blockId: item.id,
      start: clockFromMinutes(item.start),
    });
  }
  for (const blockId of returned) if (blockId) changes.push({ type: "return_to_pool", blockId });
  if (!changes.length) return null;
  return {
    operationId: operationId || createUiOperationId(nowIso, changes),
    changes,
  };
}

function clockFromMinutes(value) {
  const minutes = Math.max(0, Math.min(23 * 60 + 59, Math.round(Number(value) || 0)));
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function createUiOperationId(nowIso, changes) {
  const randomId = typeof globalThis?.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : "";
  if (randomId) return `xiaoye:drag:${randomId}`;
  return `xiaoye:drag:${hashText(`${nowIso}:${stableSerialize(changes)}`)}:${hashText(stableSerialize(changes))}`;
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
}

function hashText(value) {
  let result = 2166136261;
  for (let index = 0; index < String(value).length; index += 1) {
    result ^= String(value).charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
}
