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

/** Accept legacy persisted identities, then normalize them back to the stable category. */
export function isMorningRoutineCard(card = {}) {
  return card?.categoryId === LIFE_CATEGORY_IDS.morningRoutine
    || card?.systemRole === "wake_routine"
    || card?.systemRole === "day-start-anchor"
    || card?.id === "wake-prep"
    || card?.taskId === "wake-prep"
    // Compatibility only for pre-category persisted cards; the migration rewrites them above.
    || /^(?:起床[｜|].*洗漱|起床与洗漱)/.test(String(card?.title || ""));
}

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
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  if (Number.isFinite(Number(value))) return Number(value);
  const match = typeof value === "string" ? value.match(/^(\d{1,2}):(\d{2})$/) : null;
  if (!match) return null;
  const result = Number(match[1]) * 60 + Number(match[2]);
  return Number(match[1]) < 24 && Number(match[2]) < 60 ? result : null;
}

function plannerCardStart(card = {}) {
  return minute(card.startMinute ?? card.manualStart ?? card.start);
}

function plannerCardEnd(card = {}, start = plannerCardStart(card)) {
  const explicitEnd = minute(card.endMinute ?? card.end);
  if (Number.isFinite(explicitEnd)) return explicitEnd;
  const duration = Array.isArray(card.segments) ? Number(card.segments[0] || 0) : Number(card.workMinutes || card.duration || 0);
  return Number.isFinite(start) && duration > 0 ? start + duration : null;
}

function isVisiblePlannerCard(card = {}) {
  if (!card || card.transient === true || card.deleted === true) return false;
  return !card.placement || card.placement === "timeline" || card.placement === "history";
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
  const unified = ensureMorningRoutineCard({ ...draft, fixedEvents: [], fixedEventOverrides: {}, todayCustomBlocks: [...byId.values()], todaySegmentOverrides: segmentOverrides });
  const { _morningRoutineMigrationPending, ...persisted } = unified;
  return persisted;
}

/** Restores the durable morning routine card for older drafts without adding duplicates. */
export function ensureMorningRoutineCard(draft = {}) {
  const cards = Array.isArray(draft.todayCustomBlocks) ? draft.todayCustomBlocks.filter(Boolean) : [];
  const overrideFor = (card) => draft.todaySegmentOverrides?.[`${card.id}-1`] || draft.todaySegmentOverrides?.[card.id] || {};
  const morningCards = cards.filter(isMorningRoutineCard)
    .map((card) => {
      const override = overrideFor(card);
      const overrideStart = minute(override.manualStart);
      return {
        ...card,
        categoryId: LIFE_CATEGORY_IDS.morningRoutine,
        ...(Number.isFinite(overrideStart) ? { manualStart: overrideStart } : {}),
        ...(Number.isFinite(Number(override.workMinutes)) && Number(override.workMinutes) > 0 ? { segments: [Number(override.workMinutes)] } : {}),
      };
    });
  const mornings = morningCards
    .filter((card) => Number.isFinite(plannerCardStart(card)) && Number.isFinite(plannerCardEnd(card)) && plannerCardEnd(card) > plannerCardStart(card))
    .sort((left, right) => plannerCardStart(left) - plannerCardStart(right));
  if (mornings.length) {
    const keeper = { ...mornings[0], systemRole: "day-start-anchor", locked: true, manualStart: plannerCardStart(mornings[0]) };
    const duplicateIds = new Set(morningCards.filter((card) => card.id !== keeper.id).map((card) => card.id));
    const nextCards = [...cards.filter((card) => !isMorningRoutineCard(card)), keeper];
    const nextOverrides = Object.fromEntries(Object.entries(draft.todaySegmentOverrides || {}).filter(([id]) => ![...duplicateIds].some((duplicateId) => id === duplicateId || id.startsWith(`${duplicateId}-`))));
    nextOverrides[`${keeper.id}-1`] = { ...(nextOverrides[`${keeper.id}-1`] || {}), placement: "timeline", manualStart: keeper.manualStart, workMinutes: Number(keeper.segments?.[0] || 0), locked: true, status: nextOverrides[`${keeper.id}-1`]?.status || keeper.status || "pending" };
    return { ...draft, todayCustomBlocks: nextCards, todaySegmentOverrides: nextOverrides };
  }
  const start = minute(draft.wakeUpTime);
  const duration = Number(draft.morningPrepMinutes || 0);
  if (!Number.isFinite(start) || start < 0 || duration <= 0) return draft;
  // Broken legacy copies must not remain as invisible/duplicate placeholders.
  const nonMorningCards = cards.filter((card) => !isMorningRoutineCard(card));
  const staleMorningIds = new Set(morningCards.map((card) => card.id).filter(Boolean));
  const usedIds = new Set(nonMorningCards.map((card) => card.id).filter(Boolean));
  const id = usedIds.has("wake-prep") ? `morning-routine-${draft.targetDate || "legacy"}` : "wake-prep";
  return {
    ...draft,
    todayCustomBlocks: [...nonMorningCards, {
      id,
      title: "起床｜洗漱 + 到学习地点",
      category: "晨间洗漱",
      categoryId: LIFE_CATEGORY_IDS.morningRoutine,
      categoryStatGroup: "life",
      segments: [duration],
      breakMinutes: 0,
      manualStart: start,
      locked: true,
      status: "pending",
      systemRole: "day-start-anchor",
      source: "system-life-card",
      note: "从已有起床与晨间准备设置恢复",
    }],
    todaySegmentOverrides: {
      ...Object.fromEntries(Object.entries(draft.todaySegmentOverrides || {}).filter(([overrideId]) => ![...staleMorningIds].some((staleId) => overrideId === staleId || overrideId.startsWith(`${staleId}-`)))),
      [`${id}-1`]: {
        placement: "timeline",
        manualStart: start,
        workMinutes: duration,
        locked: true,
        status: "pending",
      },
    },
    morningRoutineMigrationVersion: 1,
    _morningRoutineMigrationPending: true,
  };
}

export function findDayStartAnchor(cards = []) {
  return (Array.isArray(cards) ? cards : [])
    .filter((card) => isMorningRoutineCard(card) && isVisiblePlannerCard(card))
    .map((card) => ({ ...card, startMinute: plannerCardStart(card), endMinute: plannerCardEnd(card) }))
    .filter((card) => Number.isFinite(card.startMinute) && Number.isFinite(card.endMinute) && card.endMinute > card.startMinute)
    .sort((left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute || String(left.id || "").localeCompare(String(right.id || "")))[0] || null;
}

export function resolvePlannerTimelineStart({ cards = [], wakeUpTime, defaultWakeUpTime, safeDefault = 7 * 60 + 30 } = {}) {
  const visibleCards = (Array.isArray(cards) ? cards : [])
    .filter(isVisiblePlannerCard)
    .map((card) => ({ ...card, startMinute: plannerCardStart(card), endMinute: plannerCardEnd(card) }))
    .filter((card) => Number.isFinite(card.startMinute) && Number.isFinite(card.endMinute) && card.endMinute > card.startMinute);
  const anchor = findDayStartAnchor(visibleCards);
  if (anchor) return anchor.startMinute;
  const earliest = [...visibleCards].sort((left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute)[0];
  if (earliest) return earliest.startMinute;
  const wake = minute(wakeUpTime);
  if (Number.isFinite(wake) && wake > 0) return wake;
  const defaultWake = minute(defaultWakeUpTime);
  if (Number.isFinite(defaultWake) && defaultWake > 0) return defaultWake;
  return safeDefault;
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
