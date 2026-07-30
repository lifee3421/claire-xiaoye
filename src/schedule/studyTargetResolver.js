// Resolves a specific day's study target from default category targets plus
// that day's own overrides, and captures an immutable snapshot of the
// resolved target the first time a day's plan is formally confirmed.
//
// Three distinct values this module deliberately keeps apart (see spec
// section 4): the *default* target (settings-level), the *resolved draft*
// target for today (default + not-yet-confirmed overrides), and the frozen
// *snapshot* for a day whose plan has already been confirmed once. Once a
// snapshot exists for a date, it — not the live defaults/overrides — is the
// authoritative target for that date.

import { resolveStudyTargetDefaultsForTree } from "../taxonomy/studyTargetDefaults.js";

function normalizeOverrides(overrides) {
  const source = overrides && typeof overrides === "object" ? overrides : {};
  const result = {};
  Object.keys(source).forEach((categoryId) => {
    const minutes = Number(source[categoryId]);
    if (Number.isFinite(minutes) && minutes >= 0) {
      result[categoryId] = Math.round(minutes);
    }
  });
  return result;
}

/**
 * Resolve today's draft target: for each eligible category, an explicit
 * per-day override wins; otherwise fall back to the default. An override of
 * 0 is a real, explicit choice (category enabled at 0 minutes for today) and
 * is distinguished from "no override" by key presence, not by truthiness.
 */
export function resolveDailyStudyTargets({ defaults, overrides, categoryTree = [] } = {}) {
  const defaultCategories = resolveStudyTargetDefaultsForTree({ defaults, categoryTree });
  const normalizedOverrides = normalizeOverrides(overrides);

  const byCategory = {};
  let totalMinutes = 0;

  defaultCategories.forEach((category) => {
    const hasOverride = Object.prototype.hasOwnProperty.call(normalizedOverrides, category.categoryId);
    const minutes = hasOverride ? normalizedOverrides[category.categoryId] : (category.enabled ? category.minutes : 0);
    const enabled = hasOverride ? true : category.enabled;
    if (!enabled) return;
    byCategory[category.categoryId] = minutes;
    totalMinutes += minutes;
  });

  // Overrides for categories with no default entry at all (e.g. a category
  // enabled for the first time today, never saved as a default) still count.
  Object.keys(normalizedOverrides).forEach((categoryId) => {
    if (Object.prototype.hasOwnProperty.call(byCategory, categoryId)) return;
    if (!defaultCategories.some((c) => c.categoryId === categoryId)) return;
    byCategory[categoryId] = normalizedOverrides[categoryId];
    totalMinutes += normalizedOverrides[categoryId];
  });

  return { totalMinutes, byCategory };
}

export const STUDY_TARGET_SNAPSHOT_SCHEMA_VERSION = 1;

/**
 * Freeze the resolved target for `targetDate` into an immutable snapshot.
 * Must be called only once, at the moment a day's plan is first formally
 * confirmed (see baselinePlanModel.js) — later default/override edits must
 * never re-derive or overwrite this snapshot for a past/confirmed date.
 */
export function captureStudyTargetSnapshot({ targetDate, resolved, now = () => new Date() } = {}) {
  const capturedAt = typeof now === "function" ? now().toISOString() : new Date().toISOString();
  return {
    schemaVersion: STUDY_TARGET_SNAPSHOT_SCHEMA_VERSION,
    targetDate,
    capturedAt,
    totalMinutes: Number(resolved?.totalMinutes) || 0,
    byCategory: { ...(resolved?.byCategory || {}) },
  };
}

/**
 * The target to use for rendering/comparison purposes for a given date:
 * the frozen snapshot if one exists for that date, otherwise the live
 * resolved draft target (for "today" before its first confirmation).
 */
export function resolveEffectiveTarget({ snapshot, draftResolved } = {}) {
  if (snapshot && typeof snapshot === "object" && snapshot.targetDate) {
    return { source: "snapshot", totalMinutes: snapshot.totalMinutes, byCategory: { ...snapshot.byCategory } };
  }
  return { source: "draft", totalMinutes: draftResolved?.totalMinutes || 0, byCategory: { ...(draftResolved?.byCategory || {}) } };
}
