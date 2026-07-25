// Pure preview of what Cyberboss's Focus mapping pipeline would do for a
// simulated (title, listName) pair — used by the "映射预览" widget in
// TaxonomyManager settings (App.jsx). Never reads or writes real TickTick
// data; only reads the taxonomy/focusSyncSettings already in the settings
// form. Mirrors the title_exact/title_alias_exact -> project_bucket ->
// misc_unclassified tiers of Cyberboss's real 6-tier pipeline
// (src/services/focus-category-mapping-service.js on the Cyberboss side).
// Deliberately omits the taskId_binding/confirmed_override/canonical_tag
// tiers: those depend on real TickTick data (taskId, tags) this preview
// never has, and the taskId tier is intentionally invisible to users here
// per "不允许用户看到或维护 taskId".

// Mirrors Cyberboss's own normalizeFocusMatchText exactly (trim + NFKC +
// whitespace-collapse + lowercase).
export function normalizeFocusMatchTextForUi(value) {
  return String(value || "").trim().normalize("NFKC").replace(/\s+/g, " ").toLowerCase();
}

// Flattens taxonomy leaves into a title-match index, the same shape as
// Cyberboss's own buildTitleIndex. Archived leaves are excluded, matching
// Cyberboss's "archived leaves keep existing aliases but don't participate
// in ordinary matching" rule.
export function flattenFocusMatchLeaves(taxonomy) {
  const leaves = [];
  const visit = (node, topLevelId) => {
    if (!node || typeof node !== "object") return;
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    const nextTopLevelId = topLevelId || node.id;
    if (!hasChildren && !node.archived) {
      const matchTexts = [
        { text: normalizeFocusMatchTextForUi(node.name), source: "title_exact" },
        ...((Array.isArray(node.focusAliases) ? node.focusAliases : []).map((alias) => ({ text: normalizeFocusMatchTextForUi(alias), source: "title_alias_exact" }))),
      ].filter((entry) => entry.text);
      leaves.push({ categoryId: node.id, name: node.name, topLevelId: nextTopLevelId, matchTexts });
    }
    (Array.isArray(node.children) ? node.children : []).forEach((child) => visit(child, nextTopLevelId));
  };
  (Array.isArray(taxonomy) ? taxonomy : []).forEach((node) => visit(node, null));
  return leaves;
}

// Every node's display name by id, regardless of level (leaf or group
// heading) — the FocusSyncSettingsPanel's "小猫复盘篮子" dropdown targets
// TOP-LEVEL nodes like "misc" (杂项), which have children and are never in
// flattenFocusMatchLeaves()'s leaf-only list. Looking up a bucket's name
// only against leaves would silently fall back to the raw canonical id
// (e.g. showing "misc" instead of "杂项"), which is exactly the internal
// id exposure the preview must never show.
function nodeNameById(taxonomy) {
  const names = new Map();
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.id && node.name) names.set(node.id, node.name);
    (Array.isArray(node.children) ? node.children : []).forEach(visit);
  };
  (Array.isArray(taxonomy) ? taxonomy : []).forEach(visit);
  return names;
}

export function previewFocusMapping({ title, listName, taxonomy, projectBucketMap }) {
  const titleKey = normalizeFocusMatchTextForUi(title);
  if (!titleKey) return null;
  const listKey = normalizeFocusMatchTextForUi(listName);
  const leaves = flattenFocusMatchLeaves(taxonomy);
  const namesById = nodeNameById(taxonomy);
  const candidates = [];
  for (const leaf of leaves) {
    const match = leaf.matchTexts.find((entry) => entry.text === titleKey);
    if (match) candidates.push({ categoryId: leaf.categoryId, name: leaf.name, topLevelId: leaf.topLevelId, mappingSource: match.source });
  }
  const distinctIds = [...new Set(candidates.map((c) => c.categoryId))];

  if (distinctIds.length === 1) {
    const match = candidates[0];
    return { categoryId: match.categoryId, categoryName: match.name, mappingSource: match.mappingSource, ambiguous: false };
  }

  const bucketId = listKey ? projectBucketMap?.[listKey] : null;

  if (distinctIds.length > 1) {
    const narrowed = candidates.filter((c) => c.categoryId === bucketId || c.topLevelId === bucketId);
    const narrowedIds = [...new Set(narrowed.map((c) => c.categoryId))];
    if (narrowedIds.length === 1) {
      const match = narrowed[0];
      return { categoryId: match.categoryId, categoryName: match.name, mappingSource: match.mappingSource, ambiguous: false };
    }
    return { categoryId: null, categoryName: null, mappingSource: "ambiguous_title", ambiguous: true, ambiguousCandidateNames: candidates.map((c) => c.name) };
  }

  if (bucketId) {
    return { categoryId: bucketId, categoryName: namesById.get(bucketId) || bucketId, mappingSource: "project_bucket", ambiguous: false };
  }

  return { categoryId: null, categoryName: "杂项（未匹配）", mappingSource: "misc_unclassified", ambiguous: false };
}

export const FOCUS_MAPPING_SOURCE_LABELS = {
  title_exact: "名称精确匹配",
  title_alias_exact: "别名精确匹配",
  project_bucket: "按清单归入篮子",
  misc_unclassified: "未匹配，落入杂项",
  ambiguous_title: "同名歧义，未自动判定",
};
