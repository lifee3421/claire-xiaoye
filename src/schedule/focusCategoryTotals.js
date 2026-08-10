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

function buildLevel2CategoryIndex(categoryTree = []) {
  const index = new Map();
  const visit = (items, parentLevel2Id = null, fallbackLevel = 1) => {
    for (const item of Array.isArray(items) ? items : []) {
      if (!item?.id) continue;
      const id = normalizeCategoryId(item.id);
      const level = Number(item.level) || fallbackLevel;
      const level2Id = level === 2 ? id : parentLevel2Id;
      index.set(id, level2Id || (level === 2 ? id : null));
      visit(item.children, level2Id, level + 1);
    }
  };
  visit(categoryTree);
  return index;
}

function resolveTargetCategoryId(categoryId, level2Index) {
  const normalized = normalizeCategoryId(categoryId);
  if (!normalized) return "";
  if (level2Index.has(normalized) && level2Index.get(normalized)) return level2Index.get(normalized);

  // Defensive fallback for a newly-arrived leaf that is not in the browser's
  // taxonomy snapshot yet. Daily study targets use level-2 ids such as
  // study.math / study.english / study.professional, while Focus may carry
  // a more specific leaf such as study.math.calculus.
  const parts = normalized.split(".");
  if (parts[0] === "study" && parts.length >= 2) return parts.slice(0, 2).join(".");
  return normalized;
}

/**
 * Aggregate the day's real, already-settled Focus duration by the level-2
 * category used by daily study targets. Snow-dust may classify a session to a
 * more specific leaf; those minutes still belong to the visible target row.
 * This is intentionally independent of planner-card overlap.
 */
export function aggregateActualFocusMinutesByCategory({ sessions = [], targetDateIso = "", categoryTree = [] } = {}) {
  const totals = new Map();
  const level2Index = buildLevel2CategoryIndex(categoryTree);
  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (!session || typeof session !== "object" || !session.categoryId) continue;
    const categoryId = resolveTargetCategoryId(session.categoryId, level2Index);
    const minutes = Math.max(0, sessionDurationMinutes(session, targetDateIso));
    if (!categoryId || minutes <= 0) continue;
    totals.set(categoryId, (totals.get(categoryId) || 0) + minutes);
  }
  return [...totals.entries()].map(([categoryId, focusMinutes]) => ({ categoryId, focusMinutes }));
}
