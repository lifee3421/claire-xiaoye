import { normalizeCategoryId } from "../taxonomy/taxonomyContract.js";
import { isoToBeijingMinutesOfDay } from "./focusOverlap.js";

function sessionDurationMinutes(session = {}, targetDateIso = "") {
  const explicit = Number(session.durationMinutes);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;

  let start = Number(session.start);
  let end = Number(session.end);
  if (!Number.isFinite(start) && session.startedAt && targetDateIso) {
    start = isoToBeijingMinutesOfDay(session.startedAt, targetDateIso);
  }
  if (!Number.isFinite(end) && session.endedAt && targetDateIso) {
    end = isoToBeijingMinutesOfDay(session.endedAt, targetDateIso);
  }
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? end - start : 0;
}

/**
 * Aggregate the day's real, already-settled Focus duration by the category
 * Snow-dust assigned to each session. This is intentionally independent of
 * planner-card overlap: a study session still counts toward the user's daily
 * study target when it starts late, runs overtime, or happens outside the
 * originally scheduled card window.
 */
export function aggregateActualFocusMinutesByCategory({ sessions = [], targetDateIso = "" } = {}) {
  const totals = new Map();
  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (!session || typeof session !== "object" || !session.categoryId) continue;
    const categoryId = normalizeCategoryId(session.categoryId);
    const minutes = Math.max(0, sessionDurationMinutes(session, targetDateIso));
    if (!categoryId || minutes <= 0) continue;
    totals.set(categoryId, (totals.get(categoryId) || 0) + minutes);
  }
  return [...totals.entries()].map(([categoryId, focusMinutes]) => ({ categoryId, focusMinutes }));
}
