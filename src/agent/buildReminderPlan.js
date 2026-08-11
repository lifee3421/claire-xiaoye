export const REMINDER_PLAN_SCHEMA_VERSION = 1;

import { resolveEffectiveReminderConfig } from "./reminderConfigResolver.js";

const STUDY_GROUPS = new Set(["study", "reading"]);
const DEFAULT_ROLES = new Set(["wake_routine", "morning_study", "lunch", "dinner", "nap", "afternoon_study", "evening_study", "daily_review", "wash"]);

const minute = (value) => {
  const [hour, minutes] = String(value || "").split(":").map(Number);
  return Number.isFinite(hour) && Number.isFinite(minutes) ? hour * 60 + minutes : null;
};
const compareCards = (left, right) => minute(left.start) - minute(right.start) || String(left.id).localeCompare(String(right.id));
const isMeal = (card, categoryId) => card.categoryId === categoryId || card.specialRole === categoryId.replace("life.", "");
const uniqueReasons = (reasons) => [...new Set(reasons)];

/** Resolves timeline-derived defaults without inventing fixed clock boundaries. */
export function resolveTimelineStartCheckDefaults(cards = []) {
  const ordered = [...cards].filter((card) => minute(card.start) !== null && minute(card.end) !== null).sort(compareCards);
  const lunches = ordered.filter((card) => isMeal(card, "life.lunch"));
  const firstLunch = lunches[0] || null;
  const allDinners = ordered.filter((card) => isMeal(card, "life.dinner"));
  const dinners = firstLunch ? allDinners.filter((card) => minute(card.start) >= minute(firstLunch.end)) : [];
  const firstDinner = dinners[0] || null;
  const warnings = [];
  const errors = [];

  if (lunches.length > 1 || allDinners.length > 1) warnings.push("检测到重复午餐/晚餐卡，请检查时间轴。");
  if (firstLunch && allDinners.some((card) => minute(card.start) <= minute(firstLunch.end))) {
    errors.push("午餐结束时间晚于或等于晚餐开始时间，无法计算阶段边界。");
  } else if (!firstLunch && !firstDinner) {
    warnings.push("今日缺少午餐和晚餐卡，未生成阶段开始检查。");
  } else if (!firstLunch) {
    warnings.push("今日未安排午餐卡，上午/下午阶段检查未生成。");
  } else if (!firstDinner) {
    warnings.push("今日未安排晚餐卡，未生成晚间阶段检查。");
  }

  const reasons = new Map();
  const addReason = (card, reason) => {
    const id = String(card.id);
    reasons.set(id, uniqueReasons([...(reasons.get(id) || []), reason]));
  };
  const firstMatchingStudyCard = (predicate) => ordered.find((card) => STUDY_GROUPS.has(card.statGroup) && predicate(card));

  for (const card of ordered) if (card.statGroup === "exercise") addReason(card, "exercise_default");
  if (!errors.length && firstLunch) {
    const card = firstMatchingStudyCard((candidate) => minute(candidate.start) < minute(firstLunch.start));
    if (card) addReason(card, "stage_first");
  }
  if (!errors.length && firstLunch && firstDinner) {
    const card = firstMatchingStudyCard((candidate) => minute(candidate.start) >= minute(firstLunch.end) && minute(candidate.start) < minute(firstDinner.start));
    if (card) addReason(card, "stage_first");
  }
  if (!errors.length && firstDinner) {
    const card = firstMatchingStudyCard((candidate) => minute(candidate.start) >= minute(firstDinner.end));
    if (card) addReason(card, "stage_first");
  }
  for (const card of ordered) {
    const breakMinutes = Number(card.breakMinutes ?? card.restAfterMinutes ?? card.breakAfter);
    if (!Number.isFinite(breakMinutes) || breakMinutes < 20) continue;
    const nextStudyCard = ordered.find((candidate) => STUDY_GROUPS.has(candidate.statGroup) && minute(candidate.start) >= minute(card.end));
    if (nextStudyCard) addReason(nextStudyCard, "long_rest_resume");
  }

  return {
    reasons,
    warnings,
    errors,
    boundaries: {
      lunch: firstLunch && { start: firstLunch.start, end: firstLunch.end },
      dinner: firstDinner && { start: firstDinner.start, end: firstDinner.end },
    },
  };
}

export function buildReminderPlan({ accountId = "claire", localDate, revision = 1, cards = [], timezone = "Asia/Shanghai", generatedAt = new Date().toISOString(), deskVerification = {} } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate || "")) throw new Error("localDate must be YYYY-MM-DD");
  const defaults = resolveTimelineStartCheckDefaults(cards);
  const enriched = enrichCards(cards, deskVerification, defaults);
  const reminders = enriched.flatMap((card) => buildCardReminder(card, localDate));
  return {
    schemaVersion: REMINDER_PLAN_SCHEMA_VERSION,
    source: "catkeeper",
    accountId,
    localDate,
    timezone,
    revision: Math.max(1, Number(revision) || 1),
    generatedAt,
    cards: enriched.map(publicCard),
    reminders,
    diagnostics: { warnings: defaults.warnings, errors: defaults.errors },
  };
}

/** Validates the generated payload, without rerunning config resolution. */
export function validateReminderPlan(plan = {}) {
  const remindersByCard = new Map((Array.isArray(plan.reminders) ? plan.reminders : []).map((item) => [String(item.sourceCardId), item]));
  return (Array.isArray(plan.cards) ? plan.cards : []).flatMap((card) => {
    const verification = card?.startVerification;
    const needsReminder = verification?.mode === "on" && (card?.isFirstStudyCardOfStage === true || (card?.startVerificationReasons || []).length > 0 || ["card", "taskGroup"].includes(verification.source));
    if (!needsReminder) return [];
    const reminder = remindersByCard.get(String(card.id));
    if (!reminder?.startVerification) return [`Configuration error: ${card.title || card.id} requires start verification but its reminder is missing startVerification.`];
    if (reminder.startVerification.method !== verification.method || reminder.startVerification.kind !== verification.kind) {
      return [`Configuration error: ${card.title || card.id} start verification differs from its reminder payload.`];
    }
    if (reminder.requiresStartVerification !== Boolean(reminder.startVerification)) {
      return [`Configuration error: ${card.title || card.id} requiresStartVerification differs from its startVerification payload.`];
    }
    return [];
  });
}

function enrichCards(cards, settings, defaults) {
  const ordered = (Array.isArray(cards) ? cards : []).map((card) => ({
    ...card,
    cardType: deriveCardType(card),
    stage: stageFor(card, defaults.boundaries),
    plannedFocusMinutes: Number(card.plannedMinutes || card.plannedFocusMinutes) || 0,
  })).sort(compareCards);

  return ordered.map((card) => {
    const reasons = uniqueReasons(defaults.reasons.get(String(card.id)) || []);
    const stageCards = ordered.filter((candidate) => candidate.stage === card.stage);
    const isFirstStudyCardOfStage = stageCards.filter((candidate) => STUDY_GROUPS.has(candidate.statGroup))[0]?.id === card.id;
    const explicitReminderOff = card.snowdustReminder?.mode === "off" || card.snowdustReminder?.enabled === false;
    const explicitVerification = card.startVerification || card.studyStartVerification || card.deskVerification;
    const defaultsAllowed = !explicitReminderOff || explicitVerification?.mode === "on";
    const effectiveReminder = resolveEffectiveReminderConfig({
      card: {
        ...card,
        defaultStartVerificationReasons: defaultsAllowed ? reasons : [],
        defaultReminderEnabled: DEFAULT_ROLES.has(semanticRole(card)) || reasons.includes("stage_first"),
        isFirstStudyCardOfStage,
      },
      taskGroup: card.taskGroup || card.taskGroupReminderConfig || {},
      stage: card.stage,
      globalSettings: settings,
      cardsOfStage: stageCards,
    });
    const startVerification = effectiveReminder.startVerification.mode === "on"
      ? { required: true, ...effectiveReminder.startVerification, ...(reasons.length ? { reasons } : {}) }
      : null;
    return {
      ...card,
      stageEndsAt: stageEnd(card.stage, defaults.boundaries),
      isFirstStudyCardOfStage,
      snowdustReminder: { ...card.snowdustReminder, mode: effectiveReminder.reminder.mode, advanceMinutes: effectiveReminder.reminder.advanceMinutes },
      startVerification,
      effectiveReminder,
      startVerificationReasons: reasons,
    };
  });
}

function buildCardReminder(card, localDate) {
  const setting = { ...(card.snowdustReminder || {}), ...(card.effectiveReminder?.reminder || {}) };
  const role = semanticRole(card);
  const explicitlyEnabled = setting.mode === "on" || setting.enabled === true;
  const explicitlyDisabled = setting.mode === "off" || setting.enabled === false;
  const verification = card.startVerification;
  const verificationRequired = Boolean(verification?.required);
  const defaultEnabled = DEFAULT_ROLES.has(role) || card.isFirstStudyCardOfStage === true || card.startVerificationReasons.length > 0;
  if ((!explicitlyEnabled && !defaultEnabled && !verificationRequired) || (explicitlyDisabled && !verificationRequired)) return [];

  const requiresResponse = setting.requiresResponse !== false;
  const followUpPolicy = { enabled: setting.followUp?.enabled !== false && requiresResponse, delayMinutes: Math.max(1, Number(setting.followUp?.delayMinutes) || 10), maxCount: 1 };
  const common = {
    sourceCardId: String(card.id),
    kind: "schedule_reminder",
    deliveryMode: "must_send",
    requiresResponse,
    followUpPolicy,
    cardType: card.cardType,
    stage: card.stage || null,
    stageEndsAt: card.stageEndsAt || null,
    isFirstStudyCardOfStage: card.isFirstStudyCardOfStage === true,
    plannedFocusMinutes: card.plannedFocusMinutes,
    reminderSource: card.effectiveReminder?.reminder?.source || "globalDefault",
    startVerificationSource: card.effectiveReminder?.startVerification?.source || "globalDefault",
    startVerification: verification,
    requiresStartVerification: Boolean(verification),
    studyStartVerification: verification,
    startVerificationReasons: card.startVerificationReasons,
  };

  if (role === "nap") {
    if (!card.id || minute(card.start) === null || minute(card.end) === null) return [];
    const advanceMinutes = Math.max(0, Number(setting.advanceMinutes ?? setting.offsetMinutes ?? 5) || 0);
    return [
      {
        ...common,
        purpose: "rest",
        scheduledAt: isoAt(localDate, card.start, -advanceMinutes),
        offsetMinutes: -advanceMinutes,
        advanceMinutes,
        anchor: "start",
        text: setting.note || defaultText(card, "rest"),
      },
      {
        ...common,
        purpose: "wake_up",
        scheduledAt: isoAt(localDate, card.end, 0),
        offsetMinutes: 0,
        advanceMinutes: 0,
        anchor: "end",
        text: "午睡结束啦，该起来了：" + (card.title || "午睡"),
        // Waking is a delivery action, not a start-verification surface.
        startVerification: null,
        requiresStartVerification: false,
        studyStartVerification: null,
        startVerificationReasons: [],
      },
    ];
  }

  const anchor = setting.anchor === "end" ? "end" : "start";
  const base = anchor === "end" ? card.end : card.start;
  if (!card.id || minute(base) === null) return [];
  const advanceMinutes = Math.max(0, Number(setting.advanceMinutes ?? setting.offsetMinutes ?? 5) || 0);
  const offsetMinutes = -advanceMinutes;
  const purpose = setting.purpose || defaultPurpose(role, anchor);
  return [{
    ...common,
    purpose,
    scheduledAt: isoAt(localDate, base, offsetMinutes),
    offsetMinutes,
    advanceMinutes,
    anchor,
    text: setting.note || defaultText(card, purpose),
  }];
}

function semanticRole(card = {}) {
  if (card.specialRole === "daily_review") return "daily_review";
  const value = String(card.systemRole || card.cardType || card.categoryId || card.statGroup || "").trim().toLowerCase();
  if (/morning.*routine|wake/.test(value)) return "wake_routine";
  if (/lunch/.test(value)) return "lunch";
  if (/dinner/.test(value)) return "dinner";
  if (/nap/.test(value) || /午睡|午休/.test(String(card.title || ""))) return "nap";
  if (/wash|hygiene/.test(value)) return "wash";
  if (/review/.test(value)) return "daily_review";
  if (value === "study" || card.cardType === "study") return "study";
  return value;
}
function defaultPurpose(role, anchor) { if (role === "lunch" || role === "dinner") return "eat"; if (role === "nap") return "rest"; if (role === "wash") return "confirm_completion"; return anchor === "end" ? "finish_task" : "start_task"; }
function defaultText(card, purpose) { return purpose === "eat" ? `该吃饭了：${card.title || "吃饭"}` : purpose === "rest" ? `该午睡啦：${card.title || "午睡"}` : purpose === "confirm_completion" ? `该洗漱了：${card.title || "洗漱"}` : `开始${card.title || "计划事项"}`; }
function isoAt(date, clock, offsetMinutes) { const ms = Date.parse(`${date}T${clock}:00+08:00`) + offsetMinutes * 60_000; const shifted = new Date(ms + 8 * 60 * 60_000).toISOString().slice(0, 19); return `${shifted}+08:00`; }
function deriveCardType(card = {}) { if (STUDY_GROUPS.has(card.statGroup)) return "study"; if (String(card.categoryId || "").includes("lunch") || String(card.categoryId || "").includes("dinner")) return "meal"; if (String(card.categoryId || "").includes("shower") || String(card.categoryId || "").includes("hygiene")) return "hygiene"; return "other"; }
function stageFor(card, bounds) { const start = minute(card.start); if (!Number.isFinite(start)) return null; if (bounds.lunch && start < minute(bounds.lunch.start)) return "morning"; if (bounds.lunch && bounds.dinner && start >= minute(bounds.lunch.end) && start < minute(bounds.dinner.start)) return "afternoon"; if (bounds.dinner && start >= minute(bounds.dinner.end)) return "evening"; return null; }
function stageEnd(stage, bounds) { return stage === "morning" ? bounds.lunch?.start || null : stage === "afternoon" ? bounds.dinner?.start || null : null; }
function publicCard(card = {}) { return { id: String(card.id || ""), title: String(card.title || ""), start: card.start || "", end: card.end || "", categoryId: card.categoryId || null, statGroup: card.statGroup || null, systemRole: card.systemRole || null, specialRole: card.specialRole || null, cardType: card.cardType || "other", stage: card.stage || null, isFirstStudyCardOfStage: card.isFirstStudyCardOfStage === true, startVerification: card.startVerification || null, studyStartVerification: card.startVerification || null, startVerificationReasons: card.startVerificationReasons || [], snowdustReminder: card.snowdustReminder || null, deskVerification: card.deskVerification || null, plannedFocusMinutes: Number(card.plannedFocusMinutes) || 0 }; }

export function normalizeStartVerification(value, { statGroup, isFirstStudyCardOfStage = false, stage, settings = {} } = {}) {
  const legacyMode = value?.mode || (value?.required === true || value?.type === "desk_photo" ? "on" : null);
  const mode = ["inherit", "off", "on"].includes(legacyMode) ? legacyMode : "inherit";
  if (mode === "off") return null;
  const smartKind = STUDY_GROUPS.has(statGroup) ? "study_ready" : statGroup === "exercise" ? "exercise_ready" : "text_ack";
  const explicitMethod = value?.method === "text" || value?.method === "photo" ? value.method : null;
  const method = explicitMethod || (smartKind === "text_ack" ? "text" : "photo");
  const kind = explicitMethod && ["study_ready", "exercise_ready", "text_ack"].includes(value?.kind) ? value.kind : smartKind;
  const inheritedRequired = STUDY_GROUPS.has(statGroup) && isFirstStudyCardOfStage && settings?.[stage]?.enabled !== false;
  if (mode !== "on" && !inheritedRequired) return null;
  return { required: true, mode: "on", method, kind, firstFollowUpMinutes: Number(settings.firstFollowUpMinutes) || 10, reminderIntervalMinutes: Number(settings.reminderIntervalMinutes) || 20 };
}
