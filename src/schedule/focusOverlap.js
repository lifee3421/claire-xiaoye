// Single shared implementation of Focus-interval merging and plan-card
// overlap computation (spec section 13: "禁止不同页面分别实现不同算法").
// All times are integer minutes-of-day scoped to one planning date, matching
// the existing timeline convention (see src/utils/plannerMinutes.js).

import { getBlockActiveMinutes } from "../utils/plannerMinutes.js";

const BEIJING_OFFSET_MINUTES = 8 * 60;

/** Convert an ISO timestamp to minutes-of-day for `targetDateIso`, Asia/Shanghai (fixed UTC+8, no DST). */
export function isoToBeijingMinutesOfDay(isoString, targetDateIso) {
  const instant = new Date(isoString);
  if (Number.isNaN(instant.getTime()) || typeof targetDateIso !== "string") return null;
  const beijingMidnightUtcMs = new Date(`${targetDateIso}T00:00:00.000Z`).getTime() - BEIJING_OFFSET_MINUTES * 60000;
  return Math.round((instant.getTime() - beijingMidnightUtcMs) / 60000);
}

/**
 * Normalize a list of {start,end}-shaped (or startedAt/endedAt ISO) Focus
 * sessions into valid, sorted minute-of-day intervals for one date. Invalid
 * (non-finite, zero/negative duration) entries are dropped, never invented.
 */
export function normalizeFocusIntervals(sessions = [], { targetDateIso } = {}) {
  return (Array.isArray(sessions) ? sessions : [])
    .map((session) => {
      if (!session || typeof session !== "object") return null;
      let start = Number(session.start);
      let end = Number(session.end);
      if (!Number.isFinite(start) && session.startedAt && targetDateIso) start = isoToBeijingMinutesOfDay(session.startedAt, targetDateIso);
      if (!Number.isFinite(end) && session.endedAt && targetDateIso) end = isoToBeijingMinutesOfDay(session.endedAt, targetDateIso);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
      return { start, end, sessionId: session.sessionId || null, categoryId: session.categoryId || null };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
}

/**
 * Merge overlapping/touching intervals so the same real minute of Focus
 * time is never counted twice (spec section 13, example 3).
 */
export function mergeIntervals(intervals = []) {
  const sorted = [...(Array.isArray(intervals) ? intervals : [])].sort((a, b) => a.start - b.start);
  const merged = [];
  sorted.forEach((interval) => {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  });
  return merged;
}

export function overlapMinutes(aStart, aEnd, bStart, bEnd) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/**
 * A plan card's effective work segment(s), excluding trailing in-card rest.
 * The existing block model puts rest *after* the active minutes within the
 * card's footprint (see getBlockBreakMinutes), so the work segment always
 * starts at block.start and stops before that rest, not at block.end.
 */
export function planActiveSegments(block = {}) {
  const start = Number(block.start);
  if (!Number.isFinite(start)) return [];
  const activeMinutes = getBlockActiveMinutes(block);
  if (activeMinutes <= 0) return [];
  return [{ start, end: start + activeMinutes }];
}

const SETTLEMENT_BUFFER_MINUTES = 10;

/**
 * Whether a block's Focus coverage can be treated as settled yet. A block
 * that just ended needs a sync buffer before its Focus overlap is final,
 * and stale/unavailable Focus data must never be silently read as 0.
 */
export function resolveBlockSettlementStatus({ block, nowMinutes, focusStatus = "fresh" } = {}) {
  if (focusStatus === "unavailable") return "unavailable";
  if (focusStatus === "stale") return "stale";
  const segments = planActiveSegments(block);
  const segmentEnd = segments.length ? Math.max(...segments.map((s) => s.end)) : Number(block.end);
  if (!Number.isFinite(nowMinutes) || nowMinutes < segmentEnd + SETTLEMENT_BUFFER_MINUTES) return "waiting";
  return "settled";
}

/**
 * Per-card Focus overlap. `mergedFocusIntervals` must already be merged
 * (mergeIntervals) — this function does not re-merge, so callers computing
 * coverage for many cards against the same day's Focus data only pay the
 * merge cost once.
 */
export function computeBlockFocusCoverage({ block, mergedFocusIntervals = [], nowMinutes, focusStatus = "fresh" } = {}) {
  const segments = planActiveSegments(block);
  const plannedWorkMinutes = segments.reduce((sum, s) => sum + (s.end - s.start), 0);

  let focusOverlapMinutes = 0;
  let earliestOverlapStart = null;
  let latestOverlapEnd = null;

  segments.forEach((segment) => {
    mergedFocusIntervals.forEach((interval) => {
      const overlap = overlapMinutes(segment.start, segment.end, interval.start, interval.end);
      if (overlap <= 0) return;
      focusOverlapMinutes += overlap;
      const clippedStart = Math.max(segment.start, interval.start);
      const clippedEnd = Math.min(segment.end, interval.end);
      if (earliestOverlapStart === null || clippedStart < earliestOverlapStart) earliestOverlapStart = clippedStart;
      if (latestOverlapEnd === null || clippedEnd > latestOverlapEnd) latestOverlapEnd = clippedEnd;
    });
  });

  const settlementStatus = resolveBlockSettlementStatus({ block, nowMinutes, focusStatus });

  return {
    blockId: block.id,
    plannedWorkMinutes,
    focusOverlapMinutes,
    coverageRatio: plannedWorkMinutes > 0 ? focusOverlapMinutes / plannedWorkMinutes : 0,
    settlementStatus,
    startOffsetMinutes: earliestOverlapStart === null || !segments.length ? null : earliestOverlapStart - segments[0].start,
    endOffsetMinutes: latestOverlapEnd === null || !segments.length ? null : latestOverlapEnd - segments[segments.length - 1].end,
  };
}

/** Coverage for every task block on the timeline, against one merged Focus interval set. */
export function computeTimelineFocusCoverage({ blocks = [], focusSessions = [], targetDateIso, nowMinutes, focusStatus = "fresh" } = {}) {
  const mergedFocusIntervals = mergeIntervals(normalizeFocusIntervals(focusSessions, { targetDateIso }));
  return (Array.isArray(blocks) ? blocks : [])
    .filter((block) => block.kind === "task" && block.status !== "cancelled")
    .map((block) => computeBlockFocusCoverage({ block, mergedFocusIntervals, nowMinutes, focusStatus }));
}

export function aggregateFocusCoverageByCategory({ blocks = [], coverageByBlockId = new Map() } = {}) {
  const totals = new Map();
  (Array.isArray(blocks) ? blocks : []).forEach((block) => {
    const categoryId = block.categoryLevel2Id || block.categoryId;
    if (!categoryId) return;
    const coverage = coverageByBlockId.get(block.id);
    if (!coverage) return;
    const entry = totals.get(categoryId) || { categoryId, plannedWorkMinutes: 0, focusOverlapMinutes: 0 };
    entry.plannedWorkMinutes += coverage.plannedWorkMinutes;
    entry.focusOverlapMinutes += coverage.focusOverlapMinutes;
    totals.set(categoryId, entry);
  });
  return [...totals.values()];
}
