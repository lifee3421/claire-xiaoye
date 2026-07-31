// Default per-category study-target configuration.
//
// A category is eligible for a default study target when its normalized
// taxonomy node has statGroup "study" or "reading" (see taxonomyContract.js
// for why those are two distinct statGroups). Eligibility is always derived
// live from the current taxonomy tree — this module never hardcodes a fixed
// category list or a fixed total (e.g. "7 hours/day"), so newly added study
// categories automatically become configurable and archived ones drop out
// for future dates while historical snapshots (captured elsewhere) keep
// reading whatever was true on their date.

import { normalizeCategoryId } from "./taxonomyContract.js";
import { flattenCategoryTree } from "../utils/plannerOverview.js";

export const STUDY_TARGET_DEFAULTS_SCHEMA_VERSION = 1;

const ELIGIBLE_STAT_GROUPS = new Set(["study", "reading"]);

/**
 * List the level-2 taxonomy categories eligible for a default study target,
 * given an already-normalized category tree (normalizeClassificationTaxonomy
 * output). Archived or disabled categories are excluded from future
 * configuration, but callers keeping historical snapshots are unaffected —
 * this function only decides what's editable *now*.
 */
export function listStudyTargetCategories(categoryTree = []) {
  return flattenCategoryTree(categoryTree)
    .filter(
      (node) =>
        node.level === 2 &&
        node.enabled !== false &&
        node.archived !== true &&
        ELIGIBLE_STAT_GROUPS.has(node.statGroup),
    )
    .map((node) => ({
      categoryId: normalizeCategoryId(node.id),
      label: node.name || node.id,
      statGroup: node.statGroup,
    }));
}

function normalizeEntry(raw) {
  if (!raw || typeof raw !== "object") {
    return { enabled: false, minutes: 0 };
  }
  const minutes = Number(raw.minutes);
  return {
    enabled: raw.enabled === true,
    // 0 is an explicitly allowed value (spec: "允许设置为 0"), only reject
    // negative/non-finite input.
    minutes: Number.isFinite(minutes) && minutes >= 0 ? Math.round(minutes) : 0,
  };
}

/**
 * Safely normalize a possibly-missing/legacy studyTargetDefaults blob from
 * settings. Unknown categoryIds already stored in `entries` are preserved
 * as-is (e.g. an archived category's old value isn't deleted here — only
 * listStudyTargetCategories() decides what's *shown* for editing).
 */
export function normalizeStudyTargetDefaults(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const rawEntries = source.entries && typeof source.entries === "object" ? source.entries : {};
  const entries = {};
  Object.keys(rawEntries).forEach((categoryId) => {
    const normalizedId = normalizeCategoryId(categoryId);
    entries[normalizedId] = normalizeEntry(rawEntries[categoryId]);
  });
  return { schemaVersion: STUDY_TARGET_DEFAULTS_SCHEMA_VERSION, entries };
}

/**
 * Resolve the current default target (enabled + minutes) for every eligible
 * category in the tree, filling in {enabled:false, minutes:0} for any
 * eligible category that has no stored entry yet. This is the list the
 * defaults-editor UI should render, and what a new day's draft should seed
 * its per-day overrides from.
 */
export function resolveStudyTargetDefaultsForTree({ defaults, categoryTree = [] } = {}) {
  const normalizedDefaults = normalizeStudyTargetDefaults(defaults);
  return listStudyTargetCategories(categoryTree).map((category) => ({
    ...category,
    ...normalizeEntry(normalizedDefaults.entries[category.categoryId]),
  }));
}

export function totalEnabledMinutes(resolvedCategories = []) {
  return (Array.isArray(resolvedCategories) ? resolvedCategories : [])
    .filter((entry) => entry.enabled)
    .reduce((sum, entry) => sum + (Number(entry.minutes) || 0), 0);
}
