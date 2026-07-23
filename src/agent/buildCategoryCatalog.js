import { LEGACY_CATEGORY_ALIASES, REVIEW_BINDINGS, normalizeCategoryId } from "../taxonomy/taxonomyContract.js";

export const CATKEEPER_CATEGORY_CATALOG_SCHEMA_VERSION = 2;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueRows(rows, key) {
  const seen = new Set();
  return rows.filter((row) => row[key] && !seen.has(row[key]) && (seen.add(row[key]) || true));
}

function reverseLegacyAliases() {
  const reverse = {};
  Object.entries(LEGACY_CATEGORY_ALIASES).forEach(([legacyId, canonicalId]) => {
    if (!reverse[canonicalId]) reverse[canonicalId] = [];
    reverse[canonicalId].push(legacyId);
  });
  return reverse;
}

/**
 * Flattens the full 1/2/3-level classification tree (unlike the pre-v3 catalog,
 * which deliberately stopped at level 2). Custom/unrecognized categories that
 * don't appear in the canonical v3 taxonomy are still included as-is — this
 * catalog must never silently drop a category it doesn't recognize.
 */
function flattenCategories(taxonomy) {
  const reverseAliases = reverseLegacyAliases();
  const rows = [];
  const visit = (node, level, parentId) => {
    if (!node || typeof node !== "object") return;
    const categoryId = text(node.id);
    const name = text(node.name);
    if (categoryId && name) {
      rows.push({
        categoryId,
        name,
        level,
        parentId: parentId || null,
        keywords: text(node.keywords),
        legacyAliases: reverseAliases[categoryId] || [],
        reviewBinding: REVIEW_BINDINGS[categoryId] || null,
      });
    }
    (Array.isArray(node.children) ? node.children : []).forEach((child) => visit(child, level + 1, categoryId || parentId));
  };
  (Array.isArray(taxonomy) ? taxonomy : []).forEach((node) => visit(node, 1, null));
  return uniqueRows(rows, "categoryId");
}

function catalogTasks(scheduleSettings) {
  const settings = scheduleSettings && typeof scheduleSettings === "object" ? scheduleSettings : {};
  const commonTasks = Array.isArray(settings.commonTasks) ? settings.commonTasks : [];
  const templateTasks = (Array.isArray(settings.dayTemplates) ? settings.dayTemplates : []).flatMap((template) =>
    (Array.isArray(template?.content?.defaultTaskGroups) ? template.content.defaultTaskGroups : [])
  );
  return uniqueRows([...commonTasks, ...templateTasks].map((task, index) => ({
    taskId: text(task?.templateItemId || task?.id) || `catalog-task-${index}`,
    title: text(task?.title || task?.name),
    categoryId: normalizeCategoryId(text(task?.categoryId)),
  })).filter((task) => task.title && task.categoryId), "taskId");
}

/**
 * Public, low-frequency taxonomy catalog (Catkeeper / unified taxonomy v3 contract).
 *
 * v2 (schemaVersion 2) upgrade: emits the full 1/2/3-level category tree (flattened,
 * with level + parentId) instead of level-2-only, plus canonical categoryId,
 * legacyAliases, and reviewBinding per category. `taskTemplates[].categoryId` is
 * now normalized to the canonical id. `categories`/`taskTemplates` array shapes are
 * kept so existing consumers reading `.categoryId`/`.name`/`.taskId`/`.title` keep
 * working; the additional fields (level, parentId, keywords, legacyAliases,
 * reviewBinding) are the new v3 contract surface. Colors and personal targets/plans
 * remain deliberately excluded.
 */
export function buildCatkeeperCategoryCatalog({ taxonomy = [], scheduleSettings = {}, now = new Date() } = {}) {
  const date = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  return {
    schemaVersion: CATKEEPER_CATEGORY_CATALOG_SCHEMA_VERSION,
    generatedAt: date.toISOString(),
    categories: flattenCategories(taxonomy),
    taskTemplates: catalogTasks(scheduleSettings),
    legacyAliases: { ...LEGACY_CATEGORY_ALIASES },
  };
}
