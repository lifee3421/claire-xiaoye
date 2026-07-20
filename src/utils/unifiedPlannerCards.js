export const LIFE_CATEGORY_IDS = Object.freeze({
  morningRoutine: "life.morning-routine",
  breakfast: "life.breakfast",
  lunch: "life.lunch",
  nap: "life.nap",
  dinner: "life.dinner",
  shower: "life.shower",
  exerciseRecovery: "life.exercise-recovery",
  bedtimeClose: "life.bedtime-close",
  other: "personal",
});

export const DEFAULT_LIFE_CATEGORIES = Object.freeze([
  { id: LIFE_CATEGORY_IDS.morningRoutine, systemKey: "morning_routine", name: "晨间洗漱", keywords: "起床,晨间洗漱", statGroup: "life" },
  { id: LIFE_CATEGORY_IDS.breakfast, systemKey: "breakfast", name: "早餐", keywords: "早餐", statGroup: "life" },
  { id: LIFE_CATEGORY_IDS.lunch, systemKey: "lunch", name: "午餐", keywords: "午餐,午饭", statGroup: "life" },
  { id: LIFE_CATEGORY_IDS.nap, systemKey: "nap", name: "午休", keywords: "午休", statGroup: "life" },
  { id: LIFE_CATEGORY_IDS.dinner, systemKey: "dinner", name: "晚餐", keywords: "晚餐,晚饭", statGroup: "life" },
  { id: LIFE_CATEGORY_IDS.shower, systemKey: "shower", name: "洗澡", keywords: "洗澡", statGroup: "life" },
  { id: LIFE_CATEGORY_IDS.exerciseRecovery, systemKey: "exercise_recovery", name: "运动恢复", keywords: "拉伸,运动恢复", statGroup: "life" },
  { id: LIFE_CATEGORY_IDS.bedtimeClose, systemKey: "bedtime_close", name: "睡前收尾", keywords: "睡前,洗漱,复盘", statGroup: "life" },
]);

export function ensureLifeCategories(taxonomy = []) {
  const tree = (Array.isArray(taxonomy) ? taxonomy : []).map((node) => ({
    ...node,
    children: Array.isArray(node?.children) ? node.children.map((child) => ({ ...child })) : [],
  }));
  let life = tree.find((node) => node?.id === "life");
  if (!life) {
    life = { id: "life", name: "生活", color: "#C58A00", children: [] };
    tree.push(life);
  }
  const existing = new Set(life.children.map((child) => child?.id).filter(Boolean));
  life.children = [
    ...life.children,
    ...DEFAULT_LIFE_CATEGORIES.filter((child) => !existing.has(child.id)).map((child) => ({ ...child, color: life.color || "#C58A00" })),
  ];
  return tree;
}

function minute(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  const match = typeof value === "string" ? value.match(/^(\d{1,2}):(\d{2})$/) : null;
  if (!match) return null;
  const result = Number(match[1]) * 60 + Number(match[2]);
  return Number(match[1]) < 24 && Number(match[2]) < 60 ? result : null;
}

export function migrateLegacyFixedEvents(fixedEvents = [], fixedEventOverrides = {}, targetDate = "") {
  return (Array.isArray(fixedEvents) ? fixedEvents : []).flatMap((event, index) => {
    if (!event || typeof event !== "object") return [];
    const override = fixedEventOverrides?.[event.id] || {};
    if (override.deleted) return [];
    const start = minute(override.startTime ?? event.startTime);
    const end = minute(override.endTime ?? event.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    const id = String(event.id || `legacy-card-${index + 1}`);
    return [{
      ...event,
      ...override,
      id,
      date: event.date || targetDate || "",
      title: override.title || event.title || "未命名卡片",
      categoryId: override.categoryId || event.categoryId || LIFE_CATEGORY_IDS.other,
      category: override.category || event.category || "个人 / 生活",
      segments: [end - start],
      breakMinutes: 0,
      manualStart: start,
      locked: override.locked ?? event.locked ?? true,
      status: override.status || event.status || "pending",
      note: override.note ?? event.note ?? "",
      source: "legacy-fixed-event",
    }];
  });
}

export function unifyPlannerDraftCards(draft = {}) {
  const migrated = migrateLegacyFixedEvents(draft.fixedEvents, draft.fixedEventOverrides, draft.targetDate);
  const byId = new Map((Array.isArray(draft.todayCustomBlocks) ? draft.todayCustomBlocks : []).filter(Boolean).map((card) => [card.id, { ...card }]));
  const segmentOverrides = { ...(draft.todaySegmentOverrides || {}) };
  for (const card of migrated) {
    if (!byId.has(card.id)) byId.set(card.id, card);
    segmentOverrides[card.id] = {
      ...(segmentOverrides[card.id] || {}),
      placement: "timeline",
      manualStart: card.manualStart,
      workMinutes: card.segments[0],
      locked: card.locked,
      status: card.status,
    };
  }
  for (const [id, override] of Object.entries(draft.fixedEventOverrides || {})) {
    if (!override || override.deleted || migrated.some((card) => card.id === id)) continue;
    const start = minute(override.startTime);
    const end = minute(override.endTime);
    if (!Number.isFinite(start)) continue;
    segmentOverrides[id] = {
      ...(segmentOverrides[id] || {}),
      placement: "timeline",
      manualStart: start,
      ...(Number.isFinite(end) && end > start ? { workMinutes: end - start } : {}),
      ...(typeof override.locked === "boolean" ? { locked: override.locked } : {}),
    };
  }
  return { ...draft, fixedEvents: [], fixedEventOverrides: {}, todayCustomBlocks: [...byId.values()], todaySegmentOverrides: segmentOverrides };
}

export function findDayStartAnchor(cards = []) {
  return (Array.isArray(cards) ? cards : [])
    .filter((card) => card?.categoryId === LIFE_CATEGORY_IDS.morningRoutine)
    .map((card) => ({ ...card, startMinute: minute(card.startMinute ?? card.start), endMinute: minute(card.endMinute ?? card.end) }))
    .filter((card) => Number.isFinite(card.startMinute) && Number.isFinite(card.endMinute) && card.endMinute > card.startMinute)
    .sort((left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute || String(left.id || "").localeCompare(String(right.id || "")))[0] || null;
}

export function allocateTasksAcrossDates(tasks = [], dates = []) {
  const validDates = [...new Set((Array.isArray(dates) ? dates : []).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))];
  const result = Object.fromEntries(validDates.map((date) => [date, []]));
  if (!validDates.length) return result;
  const consumed = new Set();
  let cursor = 0;
  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (!task?.id || consumed.has(task.id)) continue;
    const explicitDate = /^\d{4}-\d{2}-\d{2}$/.test(task.targetDate || "") ? task.targetDate : "";
    const date = explicitDate && result[explicitDate] ? explicitDate : explicitDate ? "" : validDates[cursor++ % validDates.length];
    if (!date) continue;
    consumed.add(task.id);
    result[date].push({ ...task, id: `${date}:${task.id}`, sourceTaskId: task.id, targetDate: date });
  }
  return result;
}

export function categoryCompletionFacts(dayPlans = [], categoryId = "") {
  return (Array.isArray(dayPlans) ? dayPlans : []).flatMap((plan) => {
    const blocks = (Array.isArray(plan?.blocks) ? plan.blocks : []).filter((block) => block?.categoryId === categoryId);
    if (!blocks.length) return [];
    const completed = blocks.filter((block) => block.status === "completed").length;
    return [{
      reviewDate: plan.date || plan.targetDate || "",
      categoryId,
      completed,
      total: blocks.length,
      completionRate: blocks.length ? completed / blocks.length : 0,
    }];
  });
}
