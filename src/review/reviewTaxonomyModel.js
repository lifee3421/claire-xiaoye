// Taxonomy-driven daily-review rendering — the "new category, zero schema
// changes" path. A taxonomy leaf that already has a REVIEW_BINDINGS entry
// (math/english/work.redCross/... — anything wired up before this phase)
// keeps rendering exactly as it always has, through its existing stable
// schema field ids (draft.fields). This module only concerns the OTHER
// leaves: ones with no REVIEW_BINDINGS entry, whose values live in
// draft.categoryReviewEntries[categoryId] instead. Two separate storage
// paths, one shared field-state shape ({value, autoValue, source,
// manuallyEdited}) — see categoryEntryFieldState below.
import { REVIEW_BINDINGS, flattenTaxonomy, isLeafTaxonomyNode, normalizeReviewConfig, shouldShowTaxonomyNode, CATEGORY_ID_TO_STUDY_LEAF_KEY } from "../taxonomy/taxonomyContract.js";

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

// "study"/"project"/"work"/"misc"/"family" are level-1 (primary) nodes in
// CANONICAL_TAXONOMY_V3, but "entertainment" is a level-2 node nested under
// the level-1 "rest" ("休息娱乐"). This anchor lookup must therefore search
// the WHOLE tree by id (findNodeById), never assume the anchor is top-level —
// flattenTaxonomy's own computed `primaryId` would give "rest" for anything
// under entertainment, not "entertainment", which is the wrong bucket for
// the daily-review category cards (whose sectionId is "entertainment").
function flattenLeavesUnderPrimary(taxonomy, primaryId) {
  const primary = findNodeById(taxonomy, primaryId);
  if (!primary) return [];
  return flattenTaxonomy([primary]).filter((row) => row.id !== primaryId);
}

const CATEGORY_ANCHOR_IDS = ["study", "project", "work", "hobby", "entertainment", "family", "misc"];

// Walks a categoryId's ancestor chain (via the whole-tree flatten's parentId,
// never a possibly-anchor-relative one) until it hits one of the known
// review/scheduler anchor ids. Returns null if the id isn't under any of them
// (e.g. a custom top-level category with no daily-review card of its own).
function findAnchorAncestorId(flatById, categoryId) {
  let current = flatById.get(categoryId);
  const seen = new Set();
  while (current) {
    if (CATEGORY_ANCHOR_IDS.includes(current.id)) return current.id;
    if (seen.has(current.id) || !current.parentId) return null;
    seen.add(current.id);
    current = flatById.get(current.parentId);
  }
  return null;
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

/**
 * Total dynamic (categoryReviewEntries) duration minutes, grouped by the same
 * review/scheduler anchor id used everywhere else in this module
 * (CATEGORY_ANCHOR_IDS: study/project/work/hobby/entertainment/family/misc)
 * — so the "今日时间分布" overview and each category card's own total can
 * include duration recorded on a leaf that has no static schema field, not
 * just draft.fields totals. Walks each entry's real ancestor chain
 * (findAnchorAncestorId) rather than trusting flattenTaxonomy's own
 * top-level primaryId, since "entertainment" itself is level-2 (nested under
 * "rest" in CANONICAL_TAXONOMY_V3), not level-1.
 */
export function sumDynamicDurationByPrimary(taxonomy, draft) {
  const flatById = new Map(flattenTaxonomy(taxonomy).map((row) => [row.id, row]));
  const totals = {};
  Object.keys(draft?.categoryReviewEntries || {}).forEach((categoryId) => {
    const anchorId = findAnchorAncestorId(flatById, categoryId);
    if (!anchorId) return;
    const minutes = categoryEntryNumericValue(draft, categoryId, "duration");
    if (!minutes) return;
    totals[anchorId] = (totals[anchorId] || 0) + minutes;
  });
  return totals;
}

export function sumDynamicDurationForPrimary(taxonomy, draft, primaryId) {
  return sumDynamicDurationByPrimary(taxonomy, draft)[primaryId] || 0;
}

// ---------------------------------------------------------------------------
// Taxonomy-authoritative study groups (2026-07-24 audit round).
//
// classificationTaxonomy decides which study leaves exist, their display
// order, name, color, archived/enabled state, and reviewConfig — for BOTH
// already-bound leaves (math.calculus, english.ieltsWriting, ...) and brand
// new ones added purely through TaxonomyManager. REVIEW_BINDINGS only
// answers "does this categoryId have a stable schema field, and which one" —
// it never decides whether/where/in-what-order a leaf renders.
//
// Storage stays split exactly as it already was: a bound leaf's value lives
// in draft.fields via its REVIEW_BINDINGS field ids; an unbound leaf's value
// lives in draft.categoryReviewEntries[categoryId]. Visibility bookkeeping
// stays split too, for backward compatibility: a bound leaf's pin/today-add/
// today-hide state is still profile.dailyReviewUi.defaultStudyLeaves /
// draft.ui.studyLeafVisibility, keyed by the EXISTING legacy leafKey
// (CATEGORY_ID_TO_STUDY_LEAF_KEY translates categoryId -> legacy leafKey so
// already-saved prefs keep working without migration); an unbound leaf's
// today-add/hide state is draft.ui.categoryVisibility, keyed by categoryId
// (the same system every other dynamic category already uses).
// ---------------------------------------------------------------------------

const STUDY_GROUP_ICONS = {
  "study.math": "📐",
  "study.professional": "💰",
  "study.english": "Aa",
  "study.japanese": "あ",
  "study.reading": "📖",
};
const DEFAULT_STUDY_GROUP_ICON = "📚";

function resolveBoundFieldIds(categoryId) {
  const binding = REVIEW_BINDINGS[categoryId];
  if (!binding) return null;
  return {
    durationId: binding.duration || binding.totalMinutes || null,
    progressId: binding.progress || binding.content || null,
    adjustmentId: binding.adjustment || null,
  };
}

function fieldEffectiveValue(draft, fieldId) {
  if (!fieldId) return "";
  const state = draft?.fields?.[fieldId];
  if (!state) return "";
  const value = state.value !== "" && state.value !== null && state.value !== undefined ? state.value : state.autoValue;
  return value ?? "";
}

function hasRealContent(value) {
  return typeof value === "number" ? value > 0 : String(value || "").trim().length > 0;
}

function hasBoundLeafContent(draft, fieldIds) {
  return [fieldIds.durationId, fieldIds.progressId, fieldIds.adjustmentId].some((id) => hasRealContent(fieldEffectiveValue(draft, id)));
}

/**
 * Builds one taxonomy leaf's render descriptor: which storage it uses
 * (bound draft.fields vs dynamic categoryReviewEntries), its resolved field
 * ids (bound only), and whether it currently has real content.
 */
function buildStudyLeafDescriptor(node, draft) {
  const boundFieldIds = resolveBoundFieldIds(node.id);
  if (boundFieldIds) {
    return {
      id: node.id,
      title: node.name,
      dynamic: false,
      // legacyKey: the OLD short id (e.g. "math.linearAlgebra") that
      // profile.dailyReviewUi.defaultStudyLeaves/studyLeafDefaults and
      // draft.ui.studyLeafVisibility are keyed by. null for a bound leaf
      // that predates this leafKey scheme having an entry for it (still
      // renders fine, just can't be pinned/given a legacy default duration).
      legacyKey: CATEGORY_ID_TO_STUDY_LEAF_KEY[node.id] || null,
      durationId: boundFieldIds.durationId,
      progressId: boundFieldIds.progressId,
      adjustmentId: boundFieldIds.adjustmentId,
      hasContent: hasBoundLeafContent(draft, boundFieldIds),
      node,
    };
  }
  return {
    id: node.id,
    title: node.name,
    dynamic: true,
    legacyKey: null,
    durationId: null,
    progressId: null,
    adjustmentId: null,
    hasContent: hasCategoryEntryContent(draft, node.id),
    node,
  };
}

function isStudyLeafCurrentlyVisible(descriptor, { defaultLeafIds, draftAdded, draftHidden, categoryDraftAdded, categoryDraftHidden }) {
  if (descriptor.dynamic) {
    if (categoryDraftHidden.includes(descriptor.id)) return false;
    if (categoryDraftAdded.includes(descriptor.id)) return true;
    return descriptor.hasContent;
  }
  const legacyKey = CATEGORY_ID_TO_STUDY_LEAF_KEY[descriptor.id];
  if (legacyKey && draftHidden.includes(legacyKey)) return false;
  if (legacyKey && defaultLeafIds.includes(legacyKey)) return true;
  if (legacyKey && draftAdded.includes(legacyKey)) return true;
  return descriptor.hasContent;
}

/**
 * Study leaves and groups, entirely derived from classificationTaxonomy —
 * order, name, color, archived/enabled/reviewConfig come from the taxonomy
 * node; REVIEW_BINDINGS only supplies field ids for already-bound leaves.
 * A level-2 node with tertiary children is a group; a level-2 node with no
 * children (study.japanese, study.reading) is its own single-item group,
 * matching the pre-existing STUDY_LEAF_GROUPS shape.
 */
export function buildStudyGroupsFromTaxonomy({
  taxonomy = [],
  draft,
  defaultLeafIds = [],
  draftAdded = [],
  draftHidden = [],
  isHistoricalDate = false,
} = {}) {
  const studyPrimary = (Array.isArray(taxonomy) ? taxonomy : []).find((node) => node.id === "study");
  if (!studyPrimary) return [];
  const categoryDraftAdded = getCategoryVisibility(draft).added;
  const categoryDraftHidden = getCategoryVisibility(draft).hidden;

  const secondaries = (Array.isArray(studyPrimary.children) ? studyPrimary.children : [])
    .slice()
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

  return secondaries
    .map((secondary) => {
      const isSingleLeafGroup = !Array.isArray(secondary.children) || secondary.children.length === 0;
      const leafNodes = isSingleLeafGroup
        ? [secondary]
        : secondary.children.slice().sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

      const items = leafNodes
        .map((node) => buildStudyLeafDescriptor(node, draft))
        .filter((descriptor) => shouldShowTaxonomyNode({ node: descriptor.node, isHistoricalDate, hasCurrentRecord: descriptor.hasContent }))
        .filter((descriptor) => isStudyLeafCurrentlyVisible(descriptor, { defaultLeafIds, draftAdded, draftHidden, categoryDraftAdded, categoryDraftHidden }));

      return {
        id: secondary.id,
        title: secondary.name,
        icon: STUDY_GROUP_ICONS[secondary.id] || DEFAULT_STUDY_GROUP_ICON,
        color: secondary.color || "",
        archived: secondary.archived === true,
        items,
      };
    })
    .filter((group) => group.items.length > 0);
}

/**
 * All taxonomy study leaves (visible or not) that are currently hidden,
 * mirroring getHiddenStudyLeaves — used for the "学习项管理 (N)" hidden-count
 * badge and the management panel's full leaf list.
 */
export function listAllStudyLeavesFromTaxonomy({ taxonomy = [], draft, defaultLeafIds = [], draftAdded = [], draftHidden = [], isHistoricalDate = false } = {}) {
  const studyPrimary = (Array.isArray(taxonomy) ? taxonomy : []).find((node) => node.id === "study");
  if (!studyPrimary) return [];
  const categoryDraftAdded = getCategoryVisibility(draft).added;
  const categoryDraftHidden = getCategoryVisibility(draft).hidden;
  const secondaries = (Array.isArray(studyPrimary.children) ? studyPrimary.children : []).slice().sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

  return secondaries.flatMap((secondary) => {
    const isSingleLeafGroup = !Array.isArray(secondary.children) || secondary.children.length === 0;
    const leafNodes = isSingleLeafGroup ? [secondary] : secondary.children;
    return leafNodes.map((node) => {
      const descriptor = buildStudyLeafDescriptor(node, draft);
      const visible = shouldShowTaxonomyNode({ node, isHistoricalDate, hasCurrentRecord: descriptor.hasContent })
        && isStudyLeafCurrentlyVisible(descriptor, { defaultLeafIds, draftAdded, draftHidden, categoryDraftAdded, categoryDraftHidden });
      return { ...descriptor, groupId: secondary.id, groupTitle: secondary.name, visible };
    });
  });
}

// A leaf's own duration value, regardless of whether it's currently visible —
// deliberately mirrors the pre-taxonomy behavior of the old parts-based
// study.math.totalMinutes field (which summed calculus+linearAlgebra
// unconditionally, never caring whether either row was shown/hidden in the
// UI that day). Group/overview totals must keep that same semantic: a leaf
// hidden today still counts toward the day's recorded total.
function studyLeafDurationValue(descriptor, draft) {
  if (descriptor.dynamic) return categoryEntryNumericValue(draft, descriptor.id, "duration");
  return descriptor.durationId ? Number(fieldEffectiveValue(draft, descriptor.durationId)) || 0 : 0;
}

/**
 * One shared computation source for study time totals — used by the
 * "学习总时长" metric, the "学习内部构成" bar chart, and each study group's
 * own header total, so the three never diverge. Sums EVERY leaf under each
 * group (visible or hidden today), keyed by group id (e.g. "study.math").
 */
export function buildStudyGroupTotals({ taxonomy = [], draft } = {}) {
  const allLeaves = listAllStudyLeavesFromTaxonomy({ taxonomy, draft });
  const totals = {};
  allLeaves.forEach((leaf) => {
    totals[leaf.groupId] = (totals[leaf.groupId] || 0) + studyLeafDurationValue(leaf, draft);
  });
  return totals;
}

/** Total study minutes across every group — same source as buildStudyGroupTotals. */
export function sumAllStudyMinutes({ taxonomy = [], draft } = {}) {
  return Object.values(buildStudyGroupTotals({ taxonomy, draft })).reduce((sum, value) => sum + value, 0);
}

/** A single group's total, computed from the SAME source as sumAllStudyMinutes — never independently re-summed from a (possibly visibility-filtered) items list. */
export function sumStudyGroupMinutes(groupId, { taxonomy = [], draft } = {}) {
  return buildStudyGroupTotals({ taxonomy, draft })[groupId] || 0;
}
