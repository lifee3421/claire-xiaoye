export const CATKEEPER_CATEGORY_CATALOG_SCHEMA_VERSION = 1;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueRows(rows, key) {
  const seen = new Set();
  return rows.filter((row) => row[key] && !seen.has(row[key]) && (seen.add(row[key]) || true));
}

function secondaryCategories(taxonomy) {
  return uniqueRows((Array.isArray(taxonomy) ? taxonomy : []).flatMap((primary) =>
    (Array.isArray(primary?.children) ? primary.children : []).map((category) => ({
      categoryId: text(category?.id),
      name: text(category?.name),
    })).filter((category) => category.categoryId && category.name)
  ), "categoryId");
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
    categoryId: text(task?.categoryId),
  })).filter((task) => task.title && task.categoryId), "taskId");
}

/**
 * Public, low-frequency taxonomy catalog. Deliberately excludes colors,
 * keywords, aliases, targets, plans, and other personal schedule data.
 */
export function buildCatkeeperCategoryCatalog({ taxonomy = [], scheduleSettings = {}, now = new Date() } = {}) {
  const date = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  return {
    schemaVersion: CATKEEPER_CATEGORY_CATALOG_SCHEMA_VERSION,
    generatedAt: date.toISOString(),
    categories: secondaryCategories(taxonomy),
    taskTemplates: catalogTasks(scheduleSettings),
  };
}
