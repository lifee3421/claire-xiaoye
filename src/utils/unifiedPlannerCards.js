export const MORNING_ROUTINE_CARD_ID = "wake-prep";
export const MORNING_ROUTINE_SYSTEM_ROLE = "wake_routine";

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
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  if (Number.isFinite(Number(value))) return Number(value);
  const match = typeof value === "string" ? value.match(/^(\d{1,2}):(\d{2})$/) : null;
  if (!match) return null;
  const result = Number(match[1]) * 60 + Number(match[2]);
  return Number(match[1]) < 24 && Number(match[2]) < 60 ? result : null;
}

function clock(value) {
  const normalized = Math.max(0, Math.min(24 * 60 - 1, Number(value) || 0));
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

export function isMorningRoutineCard(value = {}) {
  return value?.id === MORNING_ROUTINE_CARD_ID
    || value?.taskId === MORNING_ROUTINE_CARD_ID
    || value?.categoryId === LIFE_CATEGORY_IDS.morningRoutine
    || value?.systemRole === MORNING_ROUTINE_SYSTEM_ROLE;
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

/** Keeps exactly one durable morning routine card and removes stale ghost data. */
export function ensureMorningRoutineCard(draft = {}) {
  const cards = Array.isArray(draft.todayCustomBlocks) ? draft.todayCustomBlocks.filter(Boolean) : [];
  const fixedEvents = Array.isArray(draft.fixedEvents) ? draft.fixedEvents.filter(Boolean) : [];
  const overrides = draft.todaySegmentOverrides && typeof draft.todaySegmentOverrides === "object" ? { ...draft.todaySegmentOverrides } : {};
  const fixedOverrides = draft.fixedEventOverrides && typeof draft.fixedEventOverrides === "object" ? { ...draft.fixedEventOverrides } : {};
  const morningCards = cards.filter(isMorningRoutineCard);

  const timingCandidates = morningCards.map((card) => {
    const override = overrides[`${card.id}-1`] || overrides[card.id] || {};
    const start = minute(override.manualStart ?? card.manualStart);
    const duration = Number(override.workMinutes ?? card.segments?.[0] ?? 0);
    return { card, override, start, duration };
  }).filter((item) => Number.isFinite(item.start) && item.duration > 0)
    .sort((left, right) => left.start - right.start);

  const canonicalOverride = overrides[`${MORNING_ROUTINE_CARD_ID}-1`] || overrides[MORNING_ROUTINE_CARD_ID] || {};
  const overrideStart = minute(canonicalOverride.manualStart);
  const overrideDuration = Number(canonicalOverride.workMinutes || 0);
  const chosen = timingCandidates[0];
  const start = Number.isFinite(overrideStart)
    ? overrideStart
    : Number.isFinite(chosen?.start)
      ? chosen.start
      : minute(draft.wakeUpTime) ?? 7 * 60 + 30;
  const duration = overrideDuration > 0
    ? overrideDuration
    : Number(chosen?.duration || 0) > 0
      ? Number(chosen.duration)
      : Math.max(5, Number(draft.morningPrepMinutes || 20));
  const status = canonicalOverride.status || chosen?.override?.status || chosen?.card?.status || "pending";

  const morningIds = new Set([
    MORNING_ROUTINE_CARD_ID,
    `${MORNING_ROUTINE_CARD_ID}-1`,
    ...morningCards.flatMap((card) => [card.id, `${card.id}-1`]).filter(Boolean),
  ]);
  const nextOverrides = Object.fromEntries(Object.entries(overrides).filter(([id]) => !morningIds.has(id)));
  nextOverrides[`${MORNING_ROUTINE_CARD_ID}-1`] = {
    placement: "timeline",
    manualStart: start,
    workMinutes: duration,
    restMinutes: 0,
    locked: true,
    status,
  };
  const nextFixedOverrides = Object.fromEntries(Object.entries(fixedOverrides).filter(([id, value]) => !morningIds.has(id) && !isMorningRoutineCard({ id, ...value })));
  const canonicalCard = {
    ...(chosen?.card || {}),
    id: MORNING_ROUTINE_CARD_ID,
    title: "晨间洗漱",
    category: "晨间洗漱",
    categoryId: LIFE_CATEGORY_IDS.morningRoutine,
    categoryStatGroup: "life",
    segments: [duration],
    breakMinutes: 0,
    manualStart: start,
    locked: true,
    status,
    systemRole: MORNING_ROUTINE_SYSTEM_ROLE,
    persistent: true,
    transient: false,
    source: "system-life-card",
    note: chosen?.card?.note || "一天从这里开始",
  };
  const normalized = {
    ...draft,
    wakeUpTime: clock(start),
    morningPrepMinutes: duration,
    fixedEvents: fixedEvents.filter((card) => !isMorningRoutineCard(card)),
    fixedEventOverrides: nextFixedOverrides,
    todayCustomBlocks: [canonicalCard, ...cards.filter((card) => !isMorningRoutineCard(card))],
    todaySegmentOverrides: nextOverrides,
    deletedTodayTaskIds: (Array.isArray(draft.deletedTodayTaskIds) ? draft.deletedTodayTaskIds : []).filter((id) => !morningIds.has(id)),
    morningRoutineMigrationVersion: 2,
  };
  const relevantBefore = JSON.stringify({
    wakeUpTime: draft.wakeUpTime,
    morningPrepMinutes: draft.morningPrepMinutes,
    fixedEvents: draft.fixedEvents,
    fixedEventOverrides: draft.fixedEventOverrides,
    todayCustomBlocks: draft.todayCustomBlocks,
    todaySegmentOverrides: draft.todaySegmentOverrides,
    deletedTodayTaskIds: draft.deletedTodayTaskIds,
    morningRoutineMigrationVersion: draft.morningRoutineMigrationVersion,
  });
  const relevantAfter = JSON.stringify({
    wakeUpTime: normalized.wakeUpTime,
    morningPrepMinutes: normalized.morningPrepMinutes,
    fixedEvents: normalized.fixedEvents,
    fixedEventOverrides: normalized.fixedEventOverrides,
    todayCustomBlocks: normalized.todayCustomBlocks,
    todaySegmentOverrides: normalized.todaySegmentOverrides,
    deletedTodayTaskIds: normalized.deletedTodayTaskIds,
    morningRoutineMigrationVersion: normalized.morningRoutineMigrationVersion,
  });
  return draft._morningRoutineMigrationPending || relevantBefore !== relevantAfter
    ? { ...normalized, _morningRoutineMigrationPending: true }
    : normalized;
}

export function updateMorningRoutineDraft(draft = {}, { startMinute, durationMinutes } = {}) {
  const normalized = ensureMorningRoutineCard(draft);
  const start = minute(startMinute);
  const duration = Math.max(5, Number(durationMinutes || 0));
  if (!Number.isFinite(start) || duration <= 0) return normalized;
  const currentStatus = normalized.todaySegmentOverrides?.[`${MORNING_ROUTINE_CARD_ID}-1`]?.status || "pending";
  return ensureMorningRoutineCard({
    ...normalized,
    wakeUpTime: clock(start),
    morningPrepMinutes: duration,
    todayCustomBlocks: (normalized.todayCustomBlocks || []).map((card) => isMorningRoutineCard(card) ? {
      ...card,
      id: MORNING_ROUTINE_CARD_ID,
      segments: [duration],
      manualStart: start,
      locked: true,
      status: currentStatus,
    } : card),
    todaySegmentOverrides: {
      ...(normalized.todaySegmentOverrides || {}),
      [`${MORNING_ROUTINE_CARD_ID}-1`]: {
        placement: "timeline",
        manualStart: start,
        workMinutes: duration,
        restMinutes: 0,
        locked: true,
        status: currentStatus,
      },
    },
  });
}

export function buildMorningRoutineRippleOverrides({ blocks = [], startAt, delta, existingOverrides = {} } = {}) {
  const shift = Math.max(0, Number(delta || 0));
  const result = { ...(existingOverrides || {}) };
  if (!shift) return result;
  (Array.isArray(blocks) ? blocks : [])
    .filter((block) => !isMorningRoutineCard(block))
    .filter((block) => block?.kind === "task")
    .filter((block) => block?.taskGroup?.source !== "system-life-card")
    .filter((block) => Number(block.start) >= Number(startAt))
    .forEach((block) => {
      result[block.id] = {
        ...(result[block.id] || {}),
        placement: "timeline",
        manualStart: Number(block.start) + shift,
        locked: Boolean(block.locked),
      };
    });
  return result;
}

export function findDayStartAnchor(cards = []) {
  return (Array.isArray(cards) ? cards : [])
    .filter((card) => card?.categoryId === LIFE_CATEGORY_IDS.morningRoutine && isVisiblePlannerCard(card))
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
