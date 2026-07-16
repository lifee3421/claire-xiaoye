const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const defaultPlannerCategoryOrder = ["math", "economics", "english", "paper", "reading", "exercise", "entertainment", "personal"];

function normalizedIds(values = []) {
  return Array.isArray(values) ? values.filter((id) => typeof id === "string" && id.trim()) : [];
}

export function normalizePlannerCategoryOrder(order = [], categoryIds = []) {
  return [...new Set([...normalizedIds(order), ...defaultPlannerCategoryOrder, ...normalizedIds(categoryIds)])];
}

export function sortCategoriesByOrder(groups = [], categoryOrder = []) {
  const order = normalizePlannerCategoryOrder(categoryOrder);
  const position = new Map(order.map((id, index) => [id, index]));
  return [...(Array.isArray(groups) ? groups : [])].sort((left, right) => {
    const leftPosition = position.has(left?.id) ? position.get(left.id) : Number.MAX_SAFE_INTEGER;
    const rightPosition = position.has(right?.id) ? position.get(right.id) : Number.MAX_SAFE_INTEGER;
    return leftPosition - rightPosition || String(left?.label || left?.id || "").localeCompare(String(right?.label || right?.id || ""), "zh-CN");
  });
}

export const defaultLifeMaintenanceItems = [
  { id: "exercise-complete", name: "完整运动", builtIn: true, hidden: false, intervalDays: 2, remindAheadDays: 0 },
  { id: "light-movement", name: "轻量活动", builtIn: true, hidden: false, intervalDays: 1, remindAheadDays: 0 },
  { id: "family-a", name: "联系家人 A", builtIn: true, hidden: false, intervalDays: 7, remindAheadDays: 1 },
  { id: "family-b", name: "联系家人 B", builtIn: true, hidden: false, intervalDays: 7, remindAheadDays: 1 },
  { id: "reading", name: "阅读", builtIn: true, hidden: false, intervalDays: 2, remindAheadDays: 0 },
  { id: "writing", name: "写作 / 创作", builtIn: true, hidden: false, intervalDays: 7, remindAheadDays: 1 },
  { id: "mask", name: "面膜", builtIn: true, hidden: false, intervalDays: 3, remindAheadDays: 0 },
];

export function mergeLifeMaintenanceItems(items = []) {
  const source = Array.isArray(items) ? items.filter((item) => item && typeof item === "object") : [];
  const byId = new Map(source.map((item) => [item.id, item]));
  return [
    ...defaultLifeMaintenanceItems.map((item) => ({ ...item, ...(byId.get(item.id) || {}) })),
    ...source.filter((item) => item.id && !defaultLifeMaintenanceItems.some((base) => base.id === item.id)),
  ].filter((item) => item.id && String(item.name || "").trim());
}

export function buildTaskPlacementProgress(plan = {}) {
  const groups = Array.isArray(plan.taskGroups) ? plan.taskGroups : [];
  const blocks = Array.isArray(plan.blocks) ? plan.blocks : [];
  const rows = groups.map((group) => {
    const total = Array.isArray(group.segments) ? group.segments.length : 0;
    const inserted = blocks.filter((block) => block?.kind === "task" && block.taskId === group.id).length;
    return {
      id: group.id,
      title: group.title || "未命名任务",
      category: group.category || "其他",
      categoryId: group.categoryId || group.category || "other",
      total,
      inserted: Math.min(total, inserted),
      remaining: Math.max(0, total - inserted),
    };
  }).filter((row) => row.total > 0);
  const categories = Object.values(rows.reduce((result, row) => {
    const current = result[row.categoryId] || { id: row.categoryId, label: row.category, total: 0, inserted: 0, rows: [] };
    current.total += row.total;
    current.inserted += row.inserted;
    current.rows.push(row);
    result[row.categoryId] = current;
    return result;
  }, {}));
  return {
    rows,
    categories,
    total: rows.reduce((sum, row) => sum + row.total, 0),
    inserted: rows.reduce((sum, row) => sum + row.inserted, 0),
  };
}

export function groupTaskPlacementProgress(plan = {}, categoryOrder = []) {
  const progress = buildTaskPlacementProgress(plan);
  return sortCategoriesByOrder(progress.categories, categoryOrder).map((category) => ({
    categoryId: category.id,
    categoryLabel: category.label,
    insertedBlocks: category.inserted,
    totalBlocks: category.total,
    rows: category.rows,
  }));
}

export function summarizePeriodUsage({ segments = [], timeline = [], dayStart, lunchStart, lunchEnd, eveningStart, dayEnd }) {
  const sourceSegments = Array.isArray(segments) ? segments : [];
  const byKey = Object.fromEntries(sourceSegments.map((segment) => [segment?.key, segment]));
  if (Object.keys(byKey).length) {
    return Object.fromEntries(["morning", "afternoon", "evening"].map((key) => {
      const segment = byKey[key] || {};
      const availableMinutes = Math.max(0, Number(segment.availableMinutes) || 0);
      const scheduledMinutes = Math.max(0, Number(segment.scheduledTaskFootprintMinutes) || 0);
      return [key, { scheduledMinutes, availableMinutes, percent: availableMinutes ? Math.min(100, scheduledMinutes / availableMinutes * 100) : 0 }];
    }));
  }
  const boundaries = [
    ["morning", dayStart, lunchStart],
    ["afternoon", lunchEnd, eveningStart],
    ["evening", eveningStart, dayEnd],
  ];
  const blocks = Array.isArray(timeline) ? timeline : [];
  return Object.fromEntries(boundaries.map(([key, start, end]) => {
    const valid = Number.isFinite(start) && Number.isFinite(end) && end > start;
    const scheduledMinutes = valid ? blocks.reduce((sum, block) => {
      const blockStart = Number(block?.start);
      const blockEnd = Number(block?.end);
      if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return sum;
      return sum + Math.max(0, Math.min(end, blockEnd) - Math.max(start, blockStart));
    }, 0) : 0;
    const availableMinutes = valid ? Math.max(0, end - start) : 0;
    return [key, { scheduledMinutes, availableMinutes, percent: availableMinutes ? Math.min(100, scheduledMinutes / availableMinutes * 100) : 0 }];
  }));
}

export function normalizeMaintenanceItemOrder(order = [], items = []) {
  return [...new Set([...normalizedIds(order), ...normalizedIds((Array.isArray(items) ? items : []).map((item) => item?.id))])];
}

export function sortLifeMaintenanceItems(items = [], order = []) {
  const position = new Map(normalizeMaintenanceItemOrder(order, items).map((id, index) => [id, index]));
  return [...(Array.isArray(items) ? items : [])].sort((left, right) => {
    const leftPosition = position.get(left?.id) ?? Number.MAX_SAFE_INTEGER;
    const rightPosition = position.get(right?.id) ?? Number.MAX_SAFE_INTEGER;
    return leftPosition - rightPosition || String(left?.name || "").localeCompare(String(right?.name || ""), "zh-CN");
  });
}

export function formatDuration(minutes) {
  const safe = Math.max(0, Math.round(Number(minutes) || 0));
  if (safe < 60) return `${safe}min`;
  const hours = Math.floor(safe / 60);
  const remainder = safe % 60;
  return remainder ? `${hours}h${remainder}min` : `${hours}h`;
}

export function buildCategoryTimeProgress({ timelineBlocks = [], categoryTree = [], categoryTargets = {} } = {}) {
  const nodes = flattenCategoryTree(categoryTree).filter((node) => node.level === 2 && node.enabled !== false);
  const byId = new Map(nodes.map((node) => [node.id, { ...node, scheduledMinutes: 0 }]));
  (Array.isArray(timelineBlocks) ? timelineBlocks : []).forEach((block) => {
    if (block?.kind !== "task") return;
    const categoryId = block.categoryLevel2Id || block.categoryId;
    const entry = byId.get(categoryId);
    if (!entry) return;
    entry.scheduledMinutes += Math.max(0, Number(block.studyMinutes ?? (Number(block.end) - Number(block.start))) || 0);
  });
  return [...byId.values()].map((entry) => {
    const targetMinutes = Math.max(0, Number(categoryTargets?.[entry.id]) || 0);
    const differenceMinutes = entry.scheduledMinutes - targetMinutes;
    return {
      categoryId: entry.id,
      categoryLabel: entry.name,
      scheduledMinutes: entry.scheduledMinutes,
      targetMinutes,
      differenceMinutes,
      ratio: targetMinutes ? entry.scheduledMinutes / targetMinutes : 0,
    };
  });
}

export function flattenCategoryTree(tree = []) {
  const rows = [];
  const visit = (items, parentId = "", level = 1) => (Array.isArray(items) ? items : []).forEach((item, order) => {
    if (!item?.id) return;
    const row = { ...item, parentId: item.parentId || parentId, level: Number(item.level) || level, order: Number.isFinite(Number(item.order)) ? Number(item.order) : order };
    rows.push(row);
    visit(item.children, row.id, row.level + 1);
  });
  visit(tree);
  return rows;
}

export function readReviewField(source, fieldPath = []) {
  return (Array.isArray(fieldPath) ? fieldPath : []).reduce((value, key) => value && typeof value === "object" ? value[key] : undefined, source);
}

export function buildReviewFacts(review = {}, categoryTree = []) {
  const facts = [];
  const add = (fieldPath, value, valueType = "text") => {
    const numeric = Number(value);
    const useful = valueType === "duration" ? Number.isFinite(numeric) && numeric > 0 : Boolean(Array.isArray(value) ? value.length : String(value || "").trim());
    if (!useful) return;
    facts.push({ reviewDate: review.reviewDate || "", fieldPath, valueType, value: valueType === "duration" ? numeric : value, source: "structured" });
  };
  const subjects = review.subjects || {};
  Object.entries(subjects).forEach(([key, subject]) => add(["subjects", key, "minutes"], subject?.minutes, "duration"));
  add(["health", "maskStatus"], review.health?.maskStatus);
  add(["health", "maintenanceCompleted"], review.health?.maintenanceCompleted);
  add(["sleep", "minutes"], review.sleep?.minutes, "duration");
  add(["entertainment", "minutes"], review.totalEntertainmentMinutes, "duration");
  const visitStructured = (value, path = []) => {
    if (value == null) return;
    if (Array.isArray(value)) return;
    if (typeof value === "object") {
      Object.entries(value).forEach(([key, child]) => visitStructured(child, [...path, key]));
      return;
    }
    const key = path.at(-1) || "";
    const type = /(minutes|duration|totalMinutes)$/i.test(key) ? "duration" : "text";
    add(path, value, type);
  };
  // reviewData is the new canonical structured payload. The legacy facts above
  // remain so existing saved settlements are still trackable.
  visitStructured(review.reviewData || {});
  return facts;
}

export function buildReviewTrackerSummary({ tracker = {}, settlements = [], today = "" } = {}) {
  const path = tracker.fieldPath || [];
  const facts = (Array.isArray(settlements) ? settlements : []).flatMap((settlement) => buildReviewFacts(settlement).filter((fact) => JSON.stringify(fact.fieldPath) === JSON.stringify(path)));
  const active = facts.filter((fact) => fact.valueType === "duration" ? Number(fact.value) > 0 : Boolean(fact.value));
  const last = active.at(-1);
  const actualMinutes = active.reduce((sum, fact) => sum + (fact.valueType === "duration" ? Number(fact.value) || 0 : 0), 0);
  const dates = [...new Set(active.map((fact) => fact.reviewDate).filter(Boolean))];
  return { actualMinutes, completedFromReview: active.length > 0, completedDates: dates, lastCompletedDate: last?.reviewDate || "", facts: active, status: trackerStatus(tracker, dates, actualMinutes, today) };
}

export function trackerStatus(tracker = {}, dates = [], actualMinutes = 0, today = "") {
  const goal = tracker.goal || {};
  if (!dates.length) return { kind: "unavailable", label: "暂无记录" };
  if (goal.kind === "deadline" && goal.deadline) {
    const reached = goal.measure === "duration" ? actualMinutes >= Number(goal.targetMinutes || 0) : dates.length >= Number(goal.target || 1);
    return { kind: reached ? "normal" : (today > goal.deadline ? "overdue" : "in_progress"), label: reached ? "目标已达成" : `截止 ${goal.deadline}` };
  }
  if (goal.kind === "interval") {
    const last = dates.at(-1);
    const days = last && today ? Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / 86400000)) : 0;
    const every = Math.max(1, Number(goal.every) || 1);
    return { kind: days >= every ? (days > every ? "overdue" : "due") : "normal", label: `距上次 ${days} 天` };
  }
  return { kind: "normal", label: "已有复盘记录" };
}

export function buildStudyComposition(plan = {}, isStudyBlock = () => false) {
  const rows = Object.values((Array.isArray(plan.blocks) ? plan.blocks : []).reduce((result, block) => {
    if (block?.kind !== "task" || !isStudyBlock(block)) return result;
    const id = block.categoryId || block.category || "other";
    const current = result[id] || { id, label: block.category || "其他", minutes: 0 };
    current.minutes += Math.max(0, Number(block.studyMinutes ?? ((Number(block.end) - Number(block.start)) || 0)));
    result[id] = current;
    return result;
  }, {}));
  return { rows, totalMinutes: rows.reduce((sum, row) => sum + row.minutes, 0) };
}

function validDate(value) {
  return typeof value === "string" && ISO_DATE.test(value) && Number.isFinite(new Date(`${value}T00:00:00`).getTime());
}

function shiftDate(date, offset) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + offset));
  return next.toISOString().slice(0, 10);
}

function diffDays(later, earlier) {
  const parse = (date) => Date.UTC(...date.split("-").map((value, index) => index === 1 ? Number(value) - 1 : Number(value)));
  return Math.round((parse(later) - parse(earlier)) / 86400000);
}

function isCompletedOnSettlement(item, settlement) {
  const health = settlement?.health || {};
  if (item.id === "mask") return health.maskStatus === "已敷" || (Array.isArray(health.maintenanceCompleted) && health.maintenanceCompleted.includes("mask"));
  return Array.isArray(health.maintenanceCompleted) && health.maintenanceCompleted.includes(item.id);
}

export function buildLifeMaintenanceSummary({ items, settlements, today, order = [] }) {
  const safeToday = validDate(today) ? today : "";
  const sourceSettlements = Array.isArray(settlements) ? settlements : [];
  return sortLifeMaintenanceItems(mergeLifeMaintenanceItems(items).filter((item) => item.hidden !== true), order).map((item) => {
    const lastCompletedDate = sourceSettlements
      .filter((settlement) => validDate(settlement?.reviewDate) && isCompletedOnSettlement(item, settlement))
      .map((settlement) => settlement.reviewDate)
      .sort()
      .at(-1) || "";
    const intervalDays = Number.isFinite(Number(item.intervalDays)) && Number(item.intervalDays) > 0 ? Number(item.intervalDays) : null;
    const remindAheadDays = Math.max(0, Number(item.remindAheadDays || 0));
    const dueAt = lastCompletedDate && intervalDays ? shiftDate(lastCompletedDate, intervalDays) : "";
    const daysUntilDue = dueAt && safeToday ? diffDays(dueAt, safeToday) : null;
    const completedToday = Boolean(safeToday && lastCompletedDate === safeToday);
    const due = Boolean(!completedToday && daysUntilDue !== null && daysUntilDue <= 0);
    const nearDue = Boolean(!completedToday && !due && daysUntilDue !== null && daysUntilDue <= remindAheadDays);
    const status = completedToday ? "completed_today" : due ? "due" : nearDue ? "near_due" : lastCompletedDate ? "normal" : "unavailable";
    return { ...item, lastCompletedDate, intervalDays, remindAheadDays, dueAt, daysUntilDue, completedToday, due, nearDue, status };
  });
}
