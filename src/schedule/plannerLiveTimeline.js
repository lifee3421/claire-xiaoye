// The pure, React-free slice of "what are today's task groups, and where do
// they currently sit" — extracted from App.jsx so the SAME logic that builds
// ScheduleAssistant's task pool/timeline is importable server-side (the
// planner-bridge apply endpoint) without a second implementation.
//
// Deliberately does NOT include the auto-scheduling/placement algorithm
// (choosePlannerPlacement, the free-interval search that decides where an
// UNPLACED pool segment should land) — that stays client-only. Everything
// here only needs an EXPLICIT position (either already stored on the draft,
// or proposed by an apply request) to answer "does this block exist, and
// does a proposed time conflict with anything already placed" — which is
// exactly what buildPlannerTaskGroups/buildPlannerFixedBlocks/interval-math
// already are: plain data shaping over (draft, templates, autoContext), not
// scheduling. See buildAutoSchedulePlan in App.jsx for how the full pipeline
// (this module's output + choosePlannerPlacement) fits together client-side.
import { legacyIdsFor } from "../taxonomy/taxonomyContract.js";
import { LIFE_CATEGORY_IDS, isMorningRoutineCard, migrateLegacyFixedEvents } from "../utils/unifiedPlannerCards.js";
import { hasExplicitFiniteMinute } from "../utils/nullableMinutes.js";

// --- category resolution (moved from App.jsx, unchanged) -------------------

export const ENGLISH_SKILL_TEXT = {
  writing: "写作",
  speaking: "口语",
  reading: "阅读",
  listening: "听力",
};

export const DEFAULT_MATH_TEMPLATES = [
  { id: "standard-math-day", name: "标准数学日", lectureBlocks50: 3, exerciseBlocks50: 2, reviewBlocks30: 1, errorReviewBlocks50: 0, summaryBlocks30: 0, note: "适合普通学习日：3×50网课 + 2×50习题 + 30min复习" },
  { id: "exercise-catch-up", name: "习题补账日", lectureBlocks50: 1, exerciseBlocks50: 3, reviewBlocks30: 1, errorReviewBlocks50: 1, summaryBlocks30: 0, note: "适合网课进度够但题少的日子" },
  { id: "low-state-keep-line", name: "低状态保线日", lectureBlocks50: 0, exerciseBlocks50: 1, reviewBlocks30: 1, errorReviewBlocks50: 0, summaryBlocks30: 0, note: "适合低状态：习题 1×50 + 复习 30min" },
  { id: "high-intensity-math", name: "高强度数学日", lectureBlocks50: 4, exerciseBlocks50: 3, reviewBlocks30: 1, errorReviewBlocks50: 1, summaryBlocks30: 0, note: "适合数学主攻日" },
  { id: "review-organize-day", name: "复习整理日", lectureBlocks50: 0, exerciseBlocks50: 2, reviewBlocks30: 1, errorReviewBlocks50: 2, summaryBlocks30: 1, note: "适合阶段复盘，不推进新课" },
];

export const DEFAULT_ENGLISH_TEMPLATES = [
  { id: "english-one-skill", name: "标准英语日", wordMinutes: 30, skillCount: 1, skillMinutes: 50, skillMode: "recommended", note: "单词固定 + 推荐专项 1 项" },
  { id: "english-two-skills", name: "双专项推进日", wordMinutes: 30, skillCount: 2, skillMinutes: 40, skillMode: "recommended", note: "适合一天推两项：单词 + 两个雅思专项" },
  { id: "english-light", name: "低状态保线日", wordMinutes: 20, skillCount: 1, skillMinutes: 25, skillMode: "recommended", note: "只保英语出现，不压主线精力" },
  { id: "english-writing-focus", name: "写作主攻日", wordMinutes: 30, skillCount: 1, skillMinutes: 60, skillMode: "manual", manualSkills: ["writing"], note: "适合专门打磨作文逻辑链" },
];

export const plannerCategoryDefinitions = [
  { id: "math", name: "数学", shortName: "数学", foreground: "#60A5FA", background: "#EAF2FF", statGroup: "study" },
  { id: "english", name: "英语 / 雅思", shortName: "英语", foreground: "#A78BFA", background: "#F1EAFE", statGroup: "study" },
  { id: "economics", name: "经济 / 专业课", shortName: "专业课", foreground: "#34D399", background: "#E8F7ED", statGroup: "study" },
  { id: "paper", name: "论文", shortName: "论文", foreground: "#FB923C", background: "#FFF0E2", statGroup: "study" },
  { id: "personal", name: "个人 / 生活", shortName: "生活", foreground: "#C58A00", background: "#FFF7D8", statGroup: "life" },
  { id: "exercise", name: "运动", shortName: "运动", foreground: "#D95050", background: "#FFE8E8", statGroup: "exercise" },
  { id: "reading", name: "阅读", shortName: "阅读", foreground: "#34D399", background: "#E4F7F3", statGroup: "reading" },
  { id: "entertainment", name: "娱乐 / 休息", shortName: "娱乐", foreground: "#CF5B96", background: "#FCE8F3", statGroup: "entertainment" },
];

const legacyPlannerCategoryIds = {
  "数学": "math", "英语/雅思": "english", "英语 / 雅思": "english", "论文": "paper",
  "专业课": "economics", "经济/金融": "economics", "经济类": "economics", "运动": "exercise",
  "娱乐": "entertainment", "休息": "entertainment", "阅读": "reading", "生活": "personal", "固定": "personal",
  ielts: "english", IELTS: "english", english: "english", English: "english",
};

export function plannerCategoryFor(value, fallback = "personal") {
  const id = value?.categoryId || value;
  const found = plannerCategoryDefinitions.find((item) => item.id === id)
    || legacyIdsFor(id).map((legacyId) => plannerCategoryDefinitions.find((item) => item.id === legacyId)).find(Boolean)
    || plannerCategoryDefinitions.find((item) => item.id === legacyPlannerCategoryIds[value?.category || value]);
  if (found) {
    return { ...found, name: value?.categoryName || found.name, shortName: value?.categoryName || found.shortName, foreground: value?.categoryColor || found.foreground, statGroup: value?.categoryStatGroup || found.statGroup };
  }
  if (!found && value?.categoryName) {
    return { id: value.categoryId || fallback, name: value.categoryName, shortName: value.categoryName, foreground: value.categoryColor || plannerCategoryDefinitions.find((item) => item.id === fallback)?.foreground || "#94a3b8", background: "#F8FAFC", statGroup: value.categoryStatGroup || "life" };
  }
  return plannerCategoryDefinitions.find((item) => item.id === fallback) || plannerCategoryDefinitions[0];
}

export function plannerCategoryId(value, fallback = "personal") {
  return plannerCategoryFor(value, fallback).id;
}

export function normalizePlannerCategorizedItem(item, fallback = "personal") {
  const category = plannerCategoryFor(item, fallback);
  return { ...item, categoryId: category.id, category: item.category || category.shortName };
}

// --- misc pure helpers (moved from App.jsx, unchanged) ----------------------

export function summarizeItems(items = []) {
  return (Array.isArray(items) ? items : []).filter(Boolean).slice(0, 5).join("；");
}

export function splitLongPlannerMinutes(minutes) {
  const value = Number(minutes || 0);
  if (value <= 0) return [];
  if (value <= 60) return [value];
  if (value === 90) return [90];
  const segments = [];
  let rest = value;
  while (rest > 60) {
    segments.push(rest >= 100 ? 50 : rest - 50);
    rest -= segments[segments.length - 1];
  }
  if (rest > 0) segments.push(rest);
  return segments;
}

export function periodKeyForPlannerMinute(minute) {
  const normalized = ((minute % (24 * 60)) + 24 * 60) % (24 * 60);
  if (normalized < 12 * 60 + 30) return "morning";
  if (normalized < 14 * 60) return "midday";
  if (normalized < 18 * 60) return "afternoon";
  return "evening";
}

// `new Date(\`${value}T00:00:00\`)` parses as LOCAL time, and .getDay() below
// reads the SAME local frame — the two are always self-consistent regardless
// of the running process's own timezone (there is no UTC/local mixing here),
// so this needs no Asia/Shanghai-specific handling despite superficially
// looking like the classic naive-timestamp timezone bug.
export function isSundayDate(value) {
  if (!value) return false;
  const date = new Date(`${value}T00:00:00`);
  return Number.isFinite(date.getTime()) && date.getDay() === 0;
}

export function clockToDayMinutes(value) {
  const match = String(value || "").match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function normalizePlannerMinute(minutes, timelineStart) {
  if (minutes === null || minutes === undefined) return null;
  let value = Number(minutes);
  while (value < timelineStart) value += 24 * 60;
  return value;
}

export function blockToInterval(block) {
  return { start: block.start, end: block.end };
}

export function mergeIntervals(intervals = []) {
  return intervals
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
    .sort((a, b) => a.start - b.start)
    .reduce((merged, interval) => {
      const last = merged[merged.length - 1];
      if (!last || interval.start > last.end) merged.push({ ...interval });
      else last.end = Math.max(last.end, interval.end);
      return merged;
    }, []);
}

export function findPlannerOverlaps(blocks = []) {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || a.end - b.end);
  const conflicts = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (current.start < previous.end) conflicts.push({ first: previous, second: current });
  }
  return conflicts;
}

/** Same fallback resolveWakeRoutineStart in App.jsx uses to seed the
 * timeline's start-of-day minute before resolvePlannerTimelineStart (from
 * utils/unifiedPlannerCards.js) considers any custom day-start anchor card. */
export function resolveWakeRoutineStart(draft = {}) {
  const cardOverride = draft.todaySegmentOverrides?.["wake-prep"] || draft.todaySegmentOverrides?.["wake-prep-1"];
  const legacyOverride = draft.fixedEventOverrides?.["wake-prep"];
  const candidate = Number.isFinite(Number(cardOverride?.manualStart))
    ? Number(cardOverride.manualStart)
    : clockToDayMinutes(legacyOverride?.startTime) ?? clockToDayMinutes(draft.wakeUpTime);
  return Number.isFinite(candidate) && candidate > 0 ? candidate : 7 * 60 + 30;
}

// --- task group / fixed block construction (moved from App.jsx, unchanged) -

/**
 * Resolves today's english-skill rotation. Deterministic given (draft,
 * settings, settlements, template) — no Date.now()/Math.random(). `settlements`
 * must be the SAME array the caller used when building the proposal this is
 * validating against, or the resolved skills (and therefore the `english`
 * group's segment count/order) can disagree between client and server.
 */
export function resolveEnglishSkills(draft, settings, settlements = [], template = {}) {
  const count = Math.max(1, Math.min(4, Number(template.skillCount || 1)));
  if (template.skillMode === "manual") {
    const manual = [draft.englishSkill, draft.englishSecondSkill, ...(template.manualSkills || [])].filter((skill, index, all) => skill && all.indexOf(skill) === index);
    return manual.slice(0, count);
  }
  const enabled = settings.englishRotationSettings?.enabledSkills || ["writing", "speaking", "reading", "listening"];
  const lastSeen = Object.fromEntries(enabled.map((skill) => [skill, -1]));
  (Array.isArray(settlements) ? settlements : []).forEach((settlement, index) => {
    const text = summarizeItems(settlement.subjects?.ielts?.progress || []);
    enabled.forEach((skill) => {
      if (lastSeen[skill] >= 0) return;
      if (text.includes(ENGLISH_SKILL_TEXT[skill])) lastSeen[skill] = index;
    });
  });
  const score = (skill) => (lastSeen[skill] < 0 ? 999 : lastSeen[skill]);
  return [...enabled].sort((a, b) => score(b) - score(a)).slice(0, count);
}

/** Resolves the math/english template objects a draft currently points at,
 * from the settings' template arrays (or the static defaults if the settings
 * arrays are empty) — the exact lookup ScheduleAssistant's render body does. */
export function resolvePlannerTemplates(draft, settings = {}) {
  const mathTemplates = Array.isArray(settings.mathTemplates) && settings.mathTemplates.length ? settings.mathTemplates : DEFAULT_MATH_TEMPLATES;
  const englishTemplates = Array.isArray(settings.englishTemplates) && settings.englishTemplates.length ? settings.englishTemplates : DEFAULT_ENGLISH_TEMPLATES;
  const mathTemplate = mathTemplates.find((item) => item.id === draft.mathTemplateId) || mathTemplates[0] || {};
  const englishTemplate = englishTemplates.find((item) => item.id === draft.englishTemplateId) || englishTemplates[0] || {};
  return { mathTemplate, englishTemplate };
}

/**
 * The 13 built-in study/life task group ids buildPlannerTaskGroups can
 * produce. Anything with one of these ids (or a todayCustomBlocks /
 * legacy-fixed-event id) is a MOVABLE task safe for AI apply. See
 * PROTECTED_SYSTEM_CARD_IDS below for the deny list.
 */
export const BUILTIN_MOVABLE_TASK_IDS = new Set([
  "math-lecture", "math-exercise", "math-review", "math-error", "math-summary",
  "english", "thesis", "professional", "exercise", "formal-rest", "system", "reading", "weekly-review",
]);

/** The 6 hard, structural system-life-card ids (wake/meal/rest/sleep
 * anchors) buildPlannerFixedBlocks produces. NEVER movable via AI apply —
 * see resolveMovableLiveSegment in plannerPatchApply.js, which denies by
 * BOTH id membership here AND `source === "system-life-card"` (the latter
 * catches the card even if a future change ever renames one of these ids). */
export const PROTECTED_SYSTEM_CARD_IDS = new Set(["wake-prep", "lunch", "startup", "dinner", "daily-review", "bed-prep"]);

/**
 * Pure port of App.jsx's buildPlannerTaskGroups — builds every BUILT-IN
 * study/life task group (movable) for a draft. Does NOT include the fixed
 * system-life cards (see buildPlannerFixedBlocks) or auto-placement.
 */
export function buildPlannerTaskGroups({ draft, mathTemplate = {}, englishTemplate = {}, englishSkills = [], autoContext = {} }) {
  const groups = [];
  const pushGroup = (group) => {
    if (draft.deletedTodayTaskIds?.includes(group.id) && !isMorningRoutineCard(group)) return;
    const segments = (group.segments || []).map((value) => Number(value || 0)).filter((value) => value > 0);
    if (!segments.length) return;
    const override = draft.todayTaskOverrides?.[group.id] || {};
    groups.push(normalizePlannerCategorizedItem({ ...group, ...override, segments: override.segments || segments, segmentOverrides: draft.todaySegmentOverrides || {} }, "personal"));
  };
  const addRepeated = (count, minutes) => Array.from({ length: Number(count || 0) }, () => minutes);

  pushGroup({ id: "math-lecture", title: `数学｜网课 ${Number(mathTemplate.lectureBlocks50 || 0)}×50`, category: "数学", segments: addRepeated(mathTemplate.lectureBlocks50, 50), breakMinutes: 10, splittable: true, priority: 1, preferredPeriods: ["morning", "afternoon"], note: autoContext.mathProgressText || "" });
  pushGroup({ id: "math-exercise", title: `数学｜习题 ${Number(mathTemplate.exerciseBlocks50 || 0)}×50`, category: "数学", segments: addRepeated(mathTemplate.exerciseBlocks50, 50), breakMinutes: 10, splittable: true, priority: 1, preferredPeriods: ["afternoon", "evening"], note: autoContext.mathBlockers || "" });
  pushGroup({ id: "math-review", title: "数学｜复习", category: "数学", segments: addRepeated(mathTemplate.reviewBlocks30, 30), breakMinutes: 5, splittable: true, priority: 2, preferredPeriods: ["evening", "afternoon"] });
  pushGroup({ id: "math-error", title: "数学｜错题", category: "数学", segments: addRepeated(mathTemplate.errorReviewBlocks50, 50), breakMinutes: 10, splittable: true, priority: 1, preferredPeriods: ["afternoon", "evening"] });
  pushGroup({ id: "math-summary", title: "数学｜总结", category: "数学", segments: addRepeated(mathTemplate.summaryBlocks30, 30), breakMinutes: 5, splittable: true, priority: 2, preferredPeriods: ["evening"] });
  pushGroup({ id: "english", title: `英语/雅思｜单词 + ${englishSkills.map((skill) => ENGLISH_SKILL_TEXT[skill]).join(" + ")}`, category: "英语/雅思", segments: [Number(englishTemplate.wordMinutes || 0), ...englishSkills.map(() => Number(englishTemplate.skillMinutes || 0))], breakMinutes: 5, splittable: true, priority: 2, preferredPeriods: ["afternoon", "evening"], note: autoContext.ieltsAdjustment || "" });
  pushGroup({ id: "thesis", title: "论文｜可见产出", category: "论文", segments: splitLongPlannerMinutes(Number(draft.thesisMinutes || 0)), breakMinutes: 10, splittable: true, priority: 1, preferredPeriods: ["afternoon", "evening"], note: draft.thesisNote || autoContext.thesisAdjustmentText || "" });
  pushGroup({ id: "professional", title: "专业课｜经济金融", category: "专业课", segments: splitLongPlannerMinutes(Number(draft.professionalMinutes || 0)), breakMinutes: 10, splittable: true, priority: 2, preferredPeriods: ["afternoon", "morning"], note: draft.professionalNote || "" });
  pushGroup({ id: "exercise", title: `运动/恢复｜${draft.exerciseType || "运动"}`, category: "运动", segments: [Number(draft.exerciseMinutes || 0)], breakMinutes: 10, splittable: false, priority: 2, preferredPeriods: ["afternoon", "evening"] });
  pushGroup({ id: "formal-rest", title: "正式休息娱乐", category: "娱乐", segments: addRepeated(draft.formalRestBlocks ?? 1, Number(draft.formalRestMinutes || 0)), breakMinutes: 0, splittable: true, priority: 3, preferredPeriods: ["midday", "evening"] });
  pushGroup({ id: "system", title: "系统开发 / 轻维护", category: "生活", segments: [{ none: 0, max_30: 30, max_50: 50, only_if_mainlines_done: 30 }[draft.systemDevelopmentLimit] || 0], breakMinutes: 0, splittable: false, priority: 3, preferredPeriods: ["evening"] });
  pushGroup({ id: "reading", title: autoContext.recentReadingTitle ? `阅读｜${autoContext.recentReadingTitle}` : "阅读｜低风险休息", category: "阅读", segments: autoContext.recentReadingTitle ? [30] : [], breakMinutes: 0, splittable: false, priority: 3, preferredPeriods: ["evening", "midday"] });
  pushGroup({ id: "weekly-review", title: "周总复盘", category: "生活", segments: isSundayDate(draft.targetDate) ? [30] : [], breakMinutes: 0, splittable: false, priority: 2, preferredPeriods: ["evening"] });

  migrateLegacyFixedEvents(draft.fixedEvents, draft.fixedEventOverrides, draft.targetDate).forEach((eventItem) => {
    const start = Number(eventItem.manualStart);
    pushGroup({ ...eventItem, id: eventItem.id, title: eventItem.title, category: eventItem.category, categoryId: plannerCategoryId(eventItem), segments: eventItem.segments, breakMinutes: 0, splittable: false, priority: 1, preferredPeriods: [periodKeyForPlannerMinute(start)], manualStart: start, source: "legacy-fixed-event", note: [eventItem.location, eventItem.note].filter(Boolean).join(" ") });
  });
  (draft.todayCustomBlocks || []).forEach((task) => pushGroup(task));
  return groups;
}

/**
 * A NARROW, conflict-checking-only view of the 6 hard system-life cards
 * (wake/lunch/nap/dinner/review/bed). This is NOT a drop-in replacement for
 * App.jsx's own `buildPlannerFixedBlocks` (which stays exactly where it is,
 * unchanged) — that one also builds the full UI-facing `taskGroup`/`note`/
 * `type`/`specialRole`/`editable` shape ScheduleAssistant renders, which the
 * server has no use for. This function reuses the SAME placement arithmetic
 * (identical start/end/override resolution per card) but returns only what
 * conflict validation actually needs: {id, title, start, end, categoryId,
 * locked, status, constraint, source}. Two call sites computing the same
 * six clock times is unavoidable without forcing the client's richer output
 * through this narrower shape too — but the arithmetic itself (the part
 * that could actually drift and cause client/server disagreement) is
 * identical line-for-line, so this and App.jsx's buildPlannerFixedBlocks
 * will always agree on WHERE each card sits.
 */
export function resolveSystemCardIntervals({ draft, timelineStart, timelineEnd, effectiveMorningPrepMinutes = 0, hasCustomMorningAnchor = false }) {
  const blocks = [];
  const add = (id, title, start, end, category = "固定", note = "", extra = {}) => {
    const isMorningRoutine = id === "wake-prep" || extra.categoryId === LIFE_CATEGORY_IDS.morningRoutine;
    if (draft.deletedTodayTaskIds?.includes(id) && !isMorningRoutine) return;
    const override = draft.fixedEventOverrides?.[id] || {};
    const cardOverride = draft.todaySegmentOverrides?.[id] || draft.todaySegmentOverrides?.[`${id}-1`] || {};
    if (!isMorningRoutine && (override.deleted || cardOverride.deleted || cardOverride.placement === "deleted")) return;
    const overrideStart = hasExplicitFiniteMinute(cardOverride.manualStart) ? Number(cardOverride.manualStart) : override.startTime ? clockToDayMinutes(override.startTime) : start;
    const overrideEnd = hasExplicitFiniteMinute(cardOverride.workMinutes) ? overrideStart + Number(cardOverride.workMinutes) : override.endTime ? clockToDayMinutes(override.endTime) : end;
    if (overrideStart === null || overrideEnd === null || overrideEnd <= overrideStart) return;
    const normalizedStart = normalizePlannerMinute(overrideStart, timelineStart);
    const normalizedEnd = normalizePlannerMinute(overrideEnd, timelineStart);
    if (normalizedEnd <= timelineStart || normalizedStart >= timelineEnd) return;
    const categoryId = plannerCategoryId({ categoryId: override.categoryId || extra.categoryId, category: override.category || category });
    const clampedStart = Math.max(timelineStart, normalizedStart);
    const clampedEnd = Math.min(timelineEnd, normalizedEnd);
    blocks.push({
      id,
      title: override.title || title,
      start: clampedStart,
      end: clampedEnd,
      categoryId,
      locked: cardOverride.locked ?? override.locked ?? true,
      status: cardOverride.status || "pending",
      constraint: override.constraint || extra.constraint || "hard",
      source: "system-life-card",
    });
  };
  if (!hasCustomMorningAnchor) add("wake-prep", "起床｜洗漱 + 到学习地点", timelineStart, timelineStart + Number(effectiveMorningPrepMinutes || 0), "晨间洗漱", "系统预留", { categoryId: LIFE_CATEGORY_IDS.morningRoutine });
  const lunchStart = clockToDayMinutes(draft.lunchStartTime) ?? 12 * 60 + 30;
  add("lunch", "午餐", lunchStart, lunchStart + Math.min(40, Number(draft.lunchBlockMinutes || 40)), "午餐", "午餐安排", { categoryId: LIFE_CATEGORY_IDS.lunch });
  const lunchEnd = lunchStart + Number(draft.lunchBlockMinutes || 0);
  add("startup", "午休与启动缓冲", lunchStart + 40, lunchEnd + Number(draft.startupBufferMinutes || 0), "午休", "进入下午前缓冲", { categoryId: LIFE_CATEGORY_IDS.nap });
  add("dinner", "晚餐", 18 * 60, 18 * 60 + Number(draft.dinnerMinutes ?? 40), "晚餐", "晚餐安排", { categoryId: LIFE_CATEGORY_IDS.dinner });
  add("daily-review", "复盘 + 收束", 21 * 60 + 40, 22 * 60 + 5, "睡前收尾", "每日收尾", { categoryId: LIFE_CATEGORY_IDS.bedtimeClose });
  add("bed-prep", "上床前洗漱", timelineEnd - 20, timelineEnd, "睡前收尾", "保护睡眠", { categoryId: LIFE_CATEGORY_IDS.bedtimeClose });
  return blocks;
}

/**
 * Resolves today's morning-prep buffer minutes (wake-prep card duration).
 * Moved from App.jsx (was `resolveMorningPrepMinutes`, a module-level
 * function only ScheduleAssistant's render body called) so the exact same
 * rule is available server-side for conflict-checking the wake-prep card's
 * real bounds instead of the previous `draft.morningPrepMinutes || 0`
 * approximation, which silently dropped the "school + no commute -> 40min
 * default" rule and always got 0 for a draft that never set the field
 * explicitly.
 */
export function resolveMorningPrepMinutes(draft) {
  if (draft.morningPrepMinutes !== undefined && draft.morningPrepMinutes !== null && draft.morningPrepMinutes !== "") {
    return Math.max(0, Number(draft.morningPrepMinutes || 0));
  }
  if ((draft.scene === "school" || draft.scene === "school_with_exercise") && draft.commuteStatus === "no") {
    return 40;
  }
  return 20;
}

/**
 * The one piece of `autoContext` that's structurally load-bearing for
 * buildPlannerTaskGroups (everything else `autoContext` carries only
 * affects display `note:` text — see that function's own comments): whether
 * a `reading` task group exists at all today. Deliberately NOT a port of
 * the full review/settlement pipeline that produces the rest of
 * `autoContext` (buildScheduleAutoContext in App.jsx, which reads
 * settlements/subjects/blockers/etc for display text no server-side task-
 * identity resolution needs) — just this one field, computed the exact same
 * way App.jsx does: the currently-"reading"-status book's title, falling
 * back to the most recent reading session's book title.
 */
export function resolveRecentReadingTitle({ books = [], readingSessions = [] } = {}) {
  const activeBook = (Array.isArray(books) ? books : []).find((book) => book?.status === "reading");
  if (activeBook?.title) return activeBook.title;
  return (Array.isArray(readingSessions) ? readingSessions : [])[0]?.bookTitle || "";
}

/**
 * Resolves the SAME (timelineStart, timelineEnd) boundary
 * buildAutoSchedulePlan computes client-side, from raw draft fields only —
 * needed to check "does this proposed time fall outside today's timeline".
 * Deliberately does not need `existingTimelineCards`/`findDayStartAnchor`'s
 * custom-day-start-anchor path for THIS use — a proposal can only ever
 * reference an already-existing movable task, never invent a new day-start
 * anchor, so the plain wake-time-derived start is always the correct
 * boundary for validating an apply.
 */
export function resolvePlannerTimelineBounds(draft) {
  const timelineStart = resolveWakeRoutineStart(draft);
  const timelineEndRaw = clockToDayMinutes(draft.targetBedTime) ?? 23 * 60 + 20;
  const timelineEnd = timelineEndRaw <= timelineStart ? timelineEndRaw + 24 * 60 : timelineEndRaw;
  return { timelineStart, timelineEnd };
}
