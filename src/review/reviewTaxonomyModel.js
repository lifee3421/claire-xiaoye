// Taxonomy-driven daily-review rendering — the "new category, zero schema
// changes" path. A taxonomy leaf that already has a REVIEW_BINDINGS entry
// (math/english/work.redCross/... — anything wired up before this phase)
// keeps rendering exactly as it always has, through its existing stable
// schema field ids (draft.fields). This module only concerns the OTHER
// leaves: ones with no REVIEW_BINDINGS entry, whose values live in
// draft.categoryReviewEntries[categoryId] instead. Two separate storage
// paths, one shared field-state shape ({value, autoValue, source,
// manuallyEdited}) — see categoryEntryFieldState below.
import { REVIEW_BINDINGS, flattenTaxonomy, isLeafTaxonomyNode, normalizeReviewConfig, shouldShowTaxonomyNode } from "../taxonomy/taxonomyContract.js";

export function categoryEntryFieldState(value = "") {
  return { value, autoValue: value, source: "default", manuallyEdited: false };
}

export function defaultCategoryReviewEntries() {
  return {};
}

function entryFieldState(draft, categoryId, field) {
  return draft?.categoryReviewEntries?.[categoryId]?.[field] || categoryEntryFieldState("");
}

export function categoryEntryValue(draft, categoryId, field) {
  const state = entryFieldState(draft, categoryId, field);
  return state.value !== "" && state.value !== null && state.value !== undefined ? state.value : (state.autoValue ?? "");
}

export function categoryEntryNumericValue(draft, categoryId, field) {
  const value = Number(categoryEntryValue(draft, categoryId, field));
  return Number.isFinite(value) ? value : 0;
}

// Pure updater — returns a NEW draft with categoryReviewEntries[categoryId][field]
// set, reusing the exact same field-state shape draft.fields already uses
// (value/autoValue/source/manuallyEdited) rather than inventing a second one.
export function setCategoryEntryField(draft, categoryId, field, value) {
  const entries = draft.categoryReviewEntries || {};
  const entry = entries[categoryId] || {};
  return {
    ...draft,
    categoryReviewEntries: {
      ...entries,
      [categoryId]: {
        ...entry,
        [field]: { value, autoValue: value, source: "manual", manuallyEdited: true },
      },
    },
  };
}

export function hasCategoryEntryContent(draft, categoryId) {
  return ["duration", "progress", "adjustment"].some((field) => {
    const value = categoryEntryValue(draft, categoryId, field);
    return typeof value === "number" ? value > 0 : String(value || "").trim().length > 0;
  });
}

// A leaf is "dynamic" (goes through categoryReviewEntries) when it has no
// static REVIEW_BINDINGS entry at all. Leaves that DO have a binding keep
// using draft.fields via their existing stable field ids — never both.
function isDynamicLeaf(node) {
  return isLeafTaxonomyNode(node) && !REVIEW_BINDINGS[node.id];
}

function flattenLeavesUnderPrimary(taxonomy, primaryId) {
  const primary = (Array.isArray(taxonomy) ? taxonomy : []).find((node) => node.id === primaryId);
  if (!primary) return [];
  return flattenTaxonomy([primary]).filter((row) => row.id !== primaryId);
}

export function findNodeById(taxonomy, id) {
  let found = null;
  const visit = (node) => {
    if (found) return;
    if (node?.id === id) { found = node; return; }
    (Array.isArray(node?.children) ? node.children : []).forEach(visit);
  };
  (Array.isArray(taxonomy) ? taxonomy : []).forEach(visit);
  return found;
}

// today-only add/remove for dynamic (non-study) categories lives at
// draft.ui.categoryVisibility — separate from draft.ui.studyLeafVisibility
// (study keeps its existing key/shape for backward compatibility with
// already-saved drafts and the existing StudyLeafManager UI).
export function getCategoryVisibility(draft) {
  return draft?.ui?.categoryVisibility || { added: [], hidden: [] };
}

function isDynamicLeafVisible(categoryId, draft, draftAdded, draftHidden) {
  if (draftHidden.includes(categoryId)) return false;
  if (draftAdded.includes(categoryId)) return true;
  return hasCategoryEntryContent(draft, categoryId);
}

/**
 * All dynamic (unbound) leaves under one primary category id that should
 * currently render as a row: has real content today, OR the user added it
 * today. Archived nodes are excluded unless this is a historical date that
 * already has a record for them (shouldShowTaxonomyNode).
 */
export function getVisibleDynamicLeaves(taxonomy, primaryId, draft, { isHistoricalDate = false } = {}) {
  const draftAdded = getCategoryVisibility(draft).added;
  const draftHidden = getCategoryVisibility(draft).hidden;
  return flattenLeavesUnderPrimary(taxonomy, primaryId)
    .map((row) => {
      const node = findNodeById(taxonomy, row.id);
      return node ? { ...node, parentId: row.parentId } : null;
    })
    .filter(Boolean)
    .filter((node) => isDynamicLeaf(node))
    .filter((node) => isDynamicLeafVisible(node.id, draft, draftAdded, draftHidden))
    .filter((node) => shouldShowTaxonomyNode({ node, isHistoricalDate, hasCurrentRecord: hasCategoryEntryContent(draft, node.id) }));
}

/**
 * Candidates for "添加今日项目": reviewConfig.enabled, not archived, not
 * already visible. Never includes anything already covered by
 * REVIEW_BINDINGS (those aren't added this way — they're part of the fixed
 * study/work/etc. cards already).
 */
export function getAddableDynamicLeaves(taxonomy, primaryId, draft) {
  const draftAdded = getCategoryVisibility(draft).added;
  const draftHidden = getCategoryVisibility(draft).hidden;
  return flattenLeavesUnderPrimary(taxonomy, primaryId)
    .map((row) => findNodeById(taxonomy, row.id))
    .filter(Boolean)
    .filter((node) => isDynamicLeaf(node))
    .filter((node) => !node.archived)
    .filter((node) => normalizeReviewConfig(node).enabled)
    .filter((node) => !isDynamicLeafVisible(node.id, draft, draftAdded, draftHidden));
}

// Applies reviewConfig.defaultMinutes exactly once, only when the duration
// entry is currently empty — mirrors resolveDefaultMinutesForAdd for study
// leaves (reviewStudyLeafDefaults.js), generalized to any taxonomy node.
export function resolveDynamicDefaultMinutesForAdd(node, draft, categoryId) {
  const config = normalizeReviewConfig(node);
  if (!config.recordDuration || !config.defaultMinutes) return null;
  const current = entryFieldState(draft, categoryId, "duration").value;
  const isEmpty = current === "" || current === null || current === undefined;
  return isEmpty ? config.defaultMinutes : null;
}

const CATEGORY_GROUP_PRIMARY_IDS = { project: "project", work: "work", hobby: "hobby", entertainment: "entertainment", family: "family", misc: "misc" };

/**
 * {studyGroups, categoryGroups: {project,work,hobby,entertainment,family,misc}, archivedWithHistory}
 * studyGroups/categoryGroups only carry the DYNAMIC (unbound) leaves — callers
 * merge these with their existing static (REVIEW_BINDINGS-backed) rendering,
 * they don't replace it. archivedWithHistory lists every archived node
 * (across the whole taxonomy) that still has a record for this reviewDate,
 * for historical display purposes.
 */
export function buildReviewTaxonomyModel({ taxonomy = [], draft, reviewDate, isHistoricalDate = false } = {}) {
  const categoryGroups = {};
  Object.entries(CATEGORY_GROUP_PRIMARY_IDS).forEach(([key, primaryId]) => {
    categoryGroups[key] = getVisibleDynamicLeaves(taxonomy, primaryId, draft, { isHistoricalDate });
  });
  const studyGroups = getVisibleDynamicLeaves(taxonomy, "study", draft, { isHistoricalDate });

  const archivedWithHistory = flattenTaxonomy(taxonomy)
    .map((row) => findNodeById(taxonomy, row.id))
    .filter(Boolean)
    .filter((node) => node.archived === true)
    .filter((node) => hasCategoryEntryContent(draft, node.id) || Boolean(draft?.fields?.[REVIEW_BINDINGS[node.id]?.duration]?.value))
    .map((node) => ({ categoryId: node.id, name: node.name, color: node.color, parentId: node.parentId || "" }));

  return { studyGroups, categoryGroups, archivedWithHistory, reviewDate };
}

/**
 * The day's taxonomySnapshot: only nodes actually used today (has a dynamic
 * categoryReviewEntries record OR is one of the day's addable/visible dynamic
 * leaves with content) — never the whole taxonomy copied daily. Shape:
 * {categoryId, name, parentId, color, archived}.
 */
export function buildTaxonomySnapshot(taxonomy, draft) {
  const usedCategoryIds = new Set(Object.keys(draft?.categoryReviewEntries || {}).filter((id) => hasCategoryEntryContent(draft, id)));
  // parentId must come from a tree walk (flattenTaxonomy), not node.parentId —
  // App.jsx only stores an explicit parentId field on level-3 (tertiary) nodes;
  // level-1/level-2 nodes' parent is implicit in nesting and has no such field.
  const flatById = new Map(flattenTaxonomy(taxonomy).map((row) => [row.id, row]));
  return [...usedCategoryIds]
    .map((id) => ({ node: findNodeById(taxonomy, id), row: flatById.get(id) }))
    .filter(({ node }) => Boolean(node))
    .map(({ node, row }) => ({ categoryId: node.id, name: node.name, parentId: row?.parentId || "", color: node.color || "", archived: node.archived === true }));
}
