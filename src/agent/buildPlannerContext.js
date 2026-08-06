// PlannerContext: a compact, AI-facing view of one day's plan, built for
// Snow-dust to discuss/re-plan the rest of a day over chat.
//
// This is deliberately a SIBLING of AgentDaySnapshot (buildAgentDaySnapshot.js),
// not a merge into it. AgentDaySnapshot answers "what's happening right now /
// what's next / send a reminder for it" — it is optimized for the moment-to-
// moment reminder loop. PlannerContext answers "what's left today, what can't
// move, how much room is there, what should get scheduled" — it is optimized
// for a planning conversation that may run several turns before anything is
// actually written back.
//
// Every number in here is REUSED from data the caller already computed
// (buildAutoSchedulePlan's taskGroups/poolSegments/freeIntervals/metrics/etc,
// buildDailyFacts' Planned/Actual/Unknown layer, resolveTrackerEvidence's
// per-tracker facts, resolveDailyStudyTargets/resolveEffectiveTarget's
// target). This function does not recompute placement, capacity, or
// completion — it only reshapes and trims already-correct data down to what
// an AI planning conversation actually needs, and does so under a fairly
// hard size budget (see truncation helpers below): no full profile, no
// settlement/CompletionEvent history, no baseline blob, no long free text.
//
// Pure function: no fetch, no Firestore, no mutation. `now` is injected so
// tests are deterministic.

import { hasBaseline, isLivePlanBlock } from "../schedule/baselinePlanModel.js";

export const PLANNER_CONTEXT_SCHEMA_VERSION = 1;

const NOTE_MAX_LENGTH = 200;

function truncate(value, max = NOTE_MAX_LENGTH) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function clockFromMinutes(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value)) return null;
  const bounded = Math.max(0, Math.round(value));
  return `${String(Math.floor(bounded / 60) % 24).padStart(2, "0")}:${String(bounded % 60).padStart(2, "0")}`;
}

function asDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoTimestamp(value) {
  return asDate(value)?.toISOString() || null;
}

// Same stable-serialize + FNV-1a hash technique as
// src/agent/reminderPlanRevision.js's fingerprintReminderPlan — kept as an
// independent copy (not imported) because it fingerprints a different,
// PlannerContext-specific slice of content and the two must be free to
// diverge without coupling their schemas together.
function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
}

function hash(value) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
}

/**
 * A short, stable string identifying "this exact plan content, as of this
 * save". Combines the draft's own persisted `updatedAt` with a content hash
 * of the RAW, MUTABLE draft fields that actually decide where every block
 * lives (todaySegmentOverrides, todayCustomBlocks, deletedTodayTaskIds,
 * fixedEventOverrides, taskPoolOrder, and how many planRevisions exist) — so
 * it changes both when the draft was actually re-saved AND (defensively) if
 * the same updatedAt somehow carried different content.
 *
 * Deliberately does NOT depend on `plan` (buildAutoSchedulePlan's computed
 * output: blocks/poolSegments/freeIntervals/etc). Two saves with identical
 * draft content always produce identical computed blocks (given the same
 * templates/settings), so hashing the draft alone is a sufficient fingerprint
 * for write-safety — and, critically, it's the only version of this that the
 * planner-bridge apply endpoint can actually recompute: that endpoint reads
 * the raw Firestore draft document directly and never re-runs
 * buildAutoSchedulePlan (which lives deep in ScheduleAssistant/App.jsx and
 * depends on templates/settings/taxonomy this endpoint has no reason to
 * duplicate) — see src/schedule/plannerPatchApply.js's file header.
 *
 * Intended use (see spec section VIII "Revision / concurrency safety"):
 * Snow-dust reads `baseRevision` when it fetches a PlannerContext to start a
 * planning conversation. When it later asks to apply a change, the apply
 * endpoint recomputes this same fingerprint from the CURRENT persisted draft
 * and rejects the apply (asking Snow-dust to re-fetch context) if it no
 * longer matches — never silently overwrite a plan that moved on since the
 * conversation started.
 */
export function computePlannerContextBaseRevision({ draft = {} } = {}) {
  const content = {
    todaySegmentOverrides: draft.todaySegmentOverrides || {},
    todayCustomBlocks: (Array.isArray(draft.todayCustomBlocks) ? draft.todayCustomBlocks : []).map((task) => ({ id: task.id, segments: task.segments, breakMinutes: task.breakMinutes, manualStart: task.manualStart ?? null, locked: Boolean(task.locked), priority: task.priority })),
    deletedTodayTaskIds: draft.deletedTodayTaskIds || [],
    fixedEventOverrides: draft.fixedEventOverrides || {},
    taskPoolOrder: draft.taskPoolOrder || [],
    revisionCount: Array.isArray(draft.planRevisions) ? draft.planRevisions.length : 0,
  };
  return `v${PLANNER_CONTEXT_SCHEMA_VERSION}:${isoTimestamp(draft.updatedAt) || "0"}:${hash(stableSerialize(content))}`;
}

function trimTimelineBlock(block) {
  if (!block || block.kind !== "task" || !isLivePlanBlock(block)) return null;
  return {
    id: block.id,
    title: block.title,
    categoryId: block.categoryId || null,
    statGroup: block.categoryStatGroup || null,
    start: clockFromMinutes(block.start),
    end: clockFromMinutes(block.end),
    plannedMinutes: Number.isFinite(Number(block.end)) && Number.isFinite(Number(block.start)) ? Math.max(0, Number(block.end) - Number(block.start)) : null,
    status: block.status || "pending",
    locked: Boolean(block.locked),
    breakMinutes: Number(block.breakMinutes) > 0 ? Number(block.breakMinutes) : 0,
  };
}

function trimPoolSegment(segment) {
  return {
    blockId: segment.blockId,
    taskId: segment.id,
    title: segment.segmentTitle || segment.title,
    categoryId: segment.categoryId || null,
    duration: segment.duration,
    occupiedDuration: segment.occupiedDuration,
    breakMinutes: segment.breakAfter || 0,
    priority: segment.priority,
    preferredPeriods: Array.isArray(segment.preferredPeriods) ? segment.preferredPeriods : [],
    splittable: segment.splittable !== false,
  };
}

function trimTrackerFact(def, fact, factsStatus) {
  const base = {
    id: def.id || fact?.trackerId,
    title: def.title || fact?.title || "",
    factsStatus,
  };
  if (factsStatus !== "ready" || !fact) {
    return { ...base, scheduleStatus: null, todayReviewStatus: null, lastCompletedDate: null, nextDueDate: null, progress: null };
  }
  return {
    ...base,
    scheduleStatus: fact.scheduleStatus,
    todayReviewStatus: fact.todayReviewStatus,
    lastCompletedDate: fact.lastCompletedDate || null,
    nextDueDate: fact.nextDueDate || null,
    progress: fact.progress ? { current: fact.progress.current, target: fact.progress.target, unit: fact.progress.unit, remaining: fact.progress.remaining } : null,
  };
}

function trimTargetProgress(entry) {
  return {
    categoryId: entry.categoryId,
    label: entry.categoryLabel,
    targetMinutes: entry.targetMinutes,
    scheduledMinutes: entry.scheduledMinutes,
    differenceMinutes: entry.differenceMinutes,
  };
}

// Emits a diagnostic warning (never auto-fills tasks) when the current plan
// schedules significantly fewer minutes than the effective target for a
// category — indicating the day template is "light" relative to today's goal.
// Threshold: scheduled < 60% of target AND gap >= 30 min.
// Snow-dust can then ask the user: "按模板走？还是补任务到 target？"
function buildTemplateUnderCoversWarnings(studyTargetProgress = []) {
  return (Array.isArray(studyTargetProgress) ? studyTargetProgress : [])
    .filter((entry) => {
      const target = Number(entry.targetMinutes);
      const scheduled = Number(entry.scheduledMinutes);
      return target > 0 && scheduled < target * 0.6 && (target - scheduled) >= 30;
    })
    .map((entry) => ({
      type: "template_under_covers_target",
      categoryId: entry.categoryId,
      categoryLabel: entry.categoryLabel || entry.label || entry.categoryId,
      targetMinutes: Number(entry.targetMinutes),
      scheduledMinutes: Number(entry.scheduledMinutes),
      gapMinutes: Number(entry.targetMinutes) - Number(entry.scheduledMinutes),
    }));
}

/**
 * @param {object} params
 * @param {string} params.date - target date, "YYYY-MM-DD"
 * @param {string} [params.timezone]
 * @param {Date} [params.now]
 * @param {object} params.draft - the schedule draft for `date` (makeScheduleDraft output)
 * @param {object} params.plan - buildAutoSchedulePlan(...) output for `date` — REUSED wholesale, never recomputed here
 * @param {object} [params.effectiveStudyTarget] - resolveEffectiveTarget(...) output ({source, totalMinutes, byCategory})
 * @param {Array} [params.studyTargetProgress] - buildCategoryTimeProgress(...) output
 * @param {object|null} [params.dailyFacts] - buildDailyFacts(...) output; when omitted, `actual` degrades to unknown rather than guessing
 * @param {Array} [params.trackerDefs] - tracker definition objects (id, title) — used to populate trackers even when facts are still loading
 * @param {Array} [params.trackerFacts] - resolveTrackerEvidence(...) results, one per tracker
 * @param {"loading"|"ready"|"error"} [params.trackerFactsStatus] - loading state of trackerFacts; "loading"/"error" causes placeholders instead of real data
 * @param {object} [params.reviewContext] - {sourceReviewDate, biggestBlocker, tomorrowAdjustment, oneSentenceSummary} — already-extracted short strings, e.g. from buildScheduleAutoContext(); never a full settlement/markdown dump
 */
export function buildPlannerContext({
  date,
  timezone = "Asia/Shanghai",
  now = new Date(),
  draft = {},
  plan = {},
  effectiveStudyTarget = null,
  studyTargetProgress = [],
  dailyFacts = null,
  trackerDefs = [],
  trackerFacts = [],
  trackerFactsStatus = "ready",
  reviewContext = {},
} = {}) {
  const nowDate = asDate(now) || new Date(0);
  const targetDate = typeof date === "string" && date ? date : draft.targetDate || "";
  const liveBlocks = (Array.isArray(plan.blocks) ? plan.blocks : []).map(trimTimelineBlock).filter(Boolean);
  const lockedBlockIds = liveBlocks.filter((block) => block.locked).map((block) => block.id);
  const metrics = plan.metrics || {};

  return {
    schemaVersion: PLANNER_CONTEXT_SCHEMA_VERSION,
    date: targetDate,
    timezone,
    generatedAt: nowDate.toISOString(),
    planUpdatedAt: isoTimestamp(draft.updatedAt),
    baseRevision: computePlannerContextBaseRevision({ draft }),

    day: {
      wakeTime: plan.wakeUpTime || draft.wakeUpTime || null,
      bedTime: draft.targetBedTime || null,
      scene: draft.scene || null,
    },

    constraints: {
      lockedBlockIds,
      hasBaseline: hasBaseline(draft),
    },

    targets: effectiveStudyTarget ? {
      source: effectiveStudyTarget.source,
      totalMinutes: effectiveStudyTarget.totalMinutes || 0,
      byCategory: { ...(effectiveStudyTarget.byCategory || {}) },
      progress: (Array.isArray(studyTargetProgress) ? studyTargetProgress : []).map(trimTargetProgress),
    } : null,

    timeline: liveBlocks,

    taskPool: (Array.isArray(plan.poolSegments) ? plan.poolSegments : []).map(trimPoolSegment),

    capacity: {
      freeIntervals: Array.isArray(plan.freeIntervals) ? plan.freeIntervals : [],
      segmentFree: plan.segmentFree || {},
      freeMinutes: Number.isFinite(Number(metrics.freeMinutes)) ? Number(metrics.freeMinutes) : null,
      loadStatus: plan.loadStatus || null,
      warnings: [
        ...(Array.isArray(plan.warnings) ? plan.warnings : []),
        ...buildTemplateUnderCoversWarnings(studyTargetProgress),
      ],
      conflicts: Array.isArray(plan.conflicts) ? plan.conflicts : [],
    },

    // Reuses buildDailyFacts' own Planned/Actual/Unknown verdict verbatim —
    // never fabricates a completed-minutes number when dailyFacts wasn't
    // supplied or says "unknown".
    actual: dailyFacts ? {
      status: dailyFacts.actualStatus,
      scheduledStudyMinutes: dailyFacts.plan?.scheduledStudyMinutes ?? null,
      pureStudyMinutes: dailyFacts.actual?.pureStudyMinutes ?? null,
    } : { status: "unknown", scheduledStudyMinutes: null, pureStudyMinutes: null },

    trackers: (() => {
      const factsById = new Map((Array.isArray(trackerFacts) ? trackerFacts : []).map((f) => [f.trackerId, f]));
      const defs = Array.isArray(trackerDefs) ? trackerDefs : [];
      if (defs.length > 0) {
        // Defs-first path: emit one entry per definition even when facts are
        // loading/errored, so Snow-dust always sees the full tracker list.
        return defs.map((def) => trimTrackerFact(def, factsById.get(def.id) ?? null, trackerFactsStatus));
      }
      // Backward-compat path: no defs supplied → use raw facts (always "ready")
      return (Array.isArray(trackerFacts) ? trackerFacts : []).map((f) => trimTrackerFact({ id: f.trackerId, title: f.title }, f, "ready"));
    })(),

    reviewContext: {
      sourceReviewDate: reviewContext.sourceReviewDate || null,
      biggestBlocker: truncate(reviewContext.biggestBlocker),
      tomorrowAdjustment: truncate(reviewContext.tomorrowAdjustment),
      oneSentenceSummary: truncate(reviewContext.oneSentenceSummary),
    },
  };
}
