export const REMINDER_PLAN_SCHEMA_VERSION = 1;

const DEFAULT_ROLES = new Set(["wake_routine", "morning_study", "lunch", "afternoon_study", "evening_study", "daily_review", "wash"]);

/** Pure, semantic reminder-plan builder. Titles are display-only fallbacks. */
import { resolveEffectiveReminderConfig } from "./reminderConfigResolver.js";

export function buildReminderPlan({ accountId = "claire", localDate, revision = 1, cards = [], timezone = "Asia/Shanghai", generatedAt = new Date().toISOString(), deskVerification = {} } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate || "")) throw new Error("localDate must be YYYY-MM-DD");
  const enriched = enrichCards(cards, deskVerification);
  const reminders = enriched.flatMap((card) => buildCardReminders(card, localDate));
  return { schemaVersion: REMINDER_PLAN_SCHEMA_VERSION, source: "catkeeper", accountId, localDate, timezone, revision: Math.max(1, Number(revision) || 1), generatedAt, cards: enriched.map(publicCard), reminders };
}

/**
 * Validates the already-built plan without rerunning resolver logic. The
 * preview, counters and request all use plan.reminders; this only checks that
 * the plan's own resolved card metadata agrees with that exact reminder list.
 */
export function validateReminderPlan(plan = {}) {
  const remindersByCard = new Map((Array.isArray(plan.reminders) ? plan.reminders : []).map((item) => [String(item.sourceCardId), item]));
  return (Array.isArray(plan.cards) ? plan.cards : []).flatMap((card) => {
    const verification = card?.startVerification;
    const needsReminder = verification?.mode === "on" && (card?.isFirstStudyCardOfStage === true || ["card", "taskGroup"].includes(verification.source));
    if (!needsReminder) return [];
    const reminder = remindersByCard.get(String(card.id));
    if (!reminder?.startVerification) return [`Configuration error: ${card.title || card.id} requires start verification but its reminder is missing startVerification.`];
    if (reminder.startVerification.method !== verification.method || reminder.startVerification.kind !== verification.kind) {
      return [`Configuration error: ${card.title || card.id} start verification differs from its reminder payload.`];
    }
    return [];
  });
}

function buildCardReminders(card, localDate) {
  const setting = { ...(card?.snowdustReminder || {}), ...(card?.effectiveReminder?.reminder || {}) };
  const role = semanticRole(card);
  const defaultEnabled = role === "study" ? card.isFirstStudyCardOfStage === true : DEFAULT_ROLES.has(role);
  const explicitlyEnabled = setting?.mode === "on" || setting?.enabled === true;
  const explicitlyDisabled = setting?.mode === "off" || setting?.enabled === false;
  // A requested start verification always has an initiating reminder, even when
  // the card's ordinary reminder is explicitly off.
  // An explicit card/task-group verification needs delivery even when its
  // ordinary reminder is off. An inherited default does not defeat an
  // explicit ordinary-reminder opt-out.
  const verificationSource = card?.effectiveReminder?.startVerification?.source;
  const verificationRequired = (card?.startVerification?.required === true || card?.effectiveReminder?.startVerification?.mode === "on")
    && ["card", "taskGroup"].includes(verificationSource);
  if ((!explicitlyEnabled && !defaultEnabled && !verificationRequired) || (explicitlyDisabled && !verificationRequired)) return [];
  const anchor = setting?.anchor === "end" ? "end" : "start";
  const base = anchor === "end" ? card?.end : card?.start;
  if (!card?.id || !/^\d{2}:\d{2}$/.test(base || "")) return [];
  const advanceMinutes = Math.max(0, Number(setting?.advanceMinutes ?? setting?.offsetMinutes ?? 5) || 0);
  const offsetMinutes = -advanceMinutes;
  const scheduledAt = isoAt(localDate, base, offsetMinutes);
  const purpose = setting?.purpose || defaultPurpose(role, anchor);
  const text = setting?.note || defaultText(card, purpose);
  const requiresResponse = setting?.requiresResponse !== false;
  const followUpPolicy = { enabled: setting?.followUp?.enabled !== false && requiresResponse, delayMinutes: Math.max(1, Number(setting?.followUp?.delayMinutes) || 10), maxCount: 1 };
  const startVerification = card.effectiveReminder?.startVerification?.mode === "on" ? { required: true, ...card.effectiveReminder.startVerification } : null;
  return [{ sourceCardId: String(card.id), kind: "schedule_reminder", purpose, scheduledAt, deliveryMode: "must_send", requiresResponse, followUpPolicy, offsetMinutes, advanceMinutes, anchor, text, cardType: card.cardType, stage: card.stage || null, stageEndsAt: card.stageEndsAt || null, isFirstStudyCardOfStage: card.isFirstStudyCardOfStage === true, plannedFocusMinutes: card.plannedFocusMinutes, reminderSource: card.effectiveReminder?.reminder?.source || "globalDefault", startVerificationSource: card.effectiveReminder?.startVerification?.source || "globalDefault", startVerification, studyStartVerification: startVerification }];
}

function semanticRole(card = {}) {
  const value = String(card.systemRole || card.cardType || card.categoryId || card.statGroup || "").trim().toLowerCase();
  if (/morning.*routine|wake/.test(value)) return "wake_routine";
  if (/lunch/.test(value)) return "lunch";
  if (/wash|hygiene/.test(value)) return "wash";
  if (/review/.test(value)) return "daily_review";
  if (value === "study" || card.cardType === "study") return "study";
  return value;
}
function defaultPurpose(role, anchor) { if (role === "lunch") return "eat"; if (role === "wash") return "confirm_completion"; return anchor === "end" ? "finish_task" : "start_task"; }
function defaultText(card, purpose) { return purpose === "eat" ? `该吃饭了：${card.title || "午饭"}` : purpose === "confirm_completion" ? `该洗漱了：${card.title || "洗漱"}` : `开始${card.title || "计划事项"}`; }
function isoAt(date, clock, offsetMinutes) { const ms = Date.parse(`${date}T${clock}:00+08:00`) + offsetMinutes * 60_000; const shifted = new Date(ms + 8 * 60 * 60_000).toISOString().slice(0, 19); return `${shifted}+08:00`; }
export function normalizeStartVerification(value, { statGroup, isFirstStudyCardOfStage = false, stage, settings = {} } = {}) {
  const legacyMode = value?.mode || (value?.required === true || value?.type === "desk_photo" ? "on" : null);
  const mode = ["inherit", "off", "on"].includes(legacyMode) ? legacyMode : "inherit";
  if (mode === "off") return null;
  const smartKind = ["study", "reading"].includes(statGroup) ? "study_ready" : statGroup === "exercise" ? "exercise_ready" : "text_ack";
  // `smart` deliberately stores no kind. It is resolved from the current
  // card's statGroup each time, so legacy smart:study_ready data cannot
  // misclassify an exercise card as a study-photo check.
  const explicitMethod = value?.method === "text" || value?.method === "photo" ? value.method : null;
  const method = explicitMethod || (smartKind === "text_ack" ? "text" : "photo");
  const kind = explicitMethod && ["study_ready", "exercise_ready", "text_ack"].includes(value?.kind) ? value.kind : smartKind;
  const inheritedRequired = ["study", "reading"].includes(statGroup) && isFirstStudyCardOfStage && settings?.[stage]?.enabled !== false;
  if (mode !== "on" && !inheritedRequired) return null;
  return { required: true, mode: "on", method, kind, firstFollowUpMinutes: Number(settings.firstFollowUpMinutes) || 10, reminderIntervalMinutes: Number(settings.reminderIntervalMinutes) || 20 };
}
function enrichCards(cards, settings) {
  const ordered = (Array.isArray(cards) ? cards : []).map((card) => ({ ...card, cardType: deriveCardType(card), stage: deriveStage(card), plannedFocusMinutes: Number(card.plannedMinutes || card.plannedFocusMinutes) || 0 })).sort((a, b) => String(a.start).localeCompare(String(b.start)));
  return ordered.map((card) => {
    const cardsOfStage = ordered.filter((candidate) => candidate.stage === card.stage);
    const isFirstStudyCardOfStage = cardsOfStage.filter((candidate) => ["study", "reading"].includes(candidate.statGroup)).sort((a, b) => String(a.start).localeCompare(String(b.start)))[0]?.id === card.id;
    const effectiveReminder = resolveEffectiveReminderConfig({ card: { ...card, defaultReminderEnabled: DEFAULT_ROLES.has(semanticRole(card)), isFirstStudyCardOfStage }, taskGroup: card.taskGroup || card.taskGroupReminderConfig || {}, stage: card.stage, globalSettings: settings, cardsOfStage });
    const startVerification = effectiveReminder.startVerification.mode === "on" ? { required: true, ...effectiveReminder.startVerification } : null;
    return { ...card, stageEndsAt: card.stage ? stageEnd(card.stage) : null, isFirstStudyCardOfStage, snowdustReminder: { ...card.snowdustReminder, mode: effectiveReminder.reminder.mode, advanceMinutes: effectiveReminder.reminder.advanceMinutes }, startVerification, effectiveReminder };
  });
}
function stageEnd(stage){return stage==="morning"?"12:30":stage==="afternoon"?"18:00":"23:59";}
function deriveCardType(card={}) { if(card.statGroup==="study"||card.statGroup==="reading")return "study";if(String(card.categoryId||"").includes("lunch")||String(card.categoryId||"").includes("dinner"))return "meal";if(String(card.categoryId||"").includes("shower")||String(card.categoryId||"").includes("hygiene"))return "hygiene";return "other"; }
function deriveStage(card={}) { if(deriveCardType(card)!=="study")return null;const [h,m]=String(card.start||"").split(":").map(Number),minute=h*60+m;if(!Number.isFinite(minute))return null;return minute<750?"morning":minute<1080?"afternoon":"evening"; }
function publicCard(card = {}) { return { id: String(card.id || ""), title: String(card.title || ""), start: card.start || "", end: card.end || "", categoryId: card.categoryId || null, statGroup: card.statGroup || null, systemRole: card.systemRole || null, cardType:card.cardType||"other",stage:card.stage||null,isFirstStudyCardOfStage:card.isFirstStudyCardOfStage===true,startVerification:card.startVerification||null, studyStartVerification:card.startVerification||null, snowdustReminder:card.snowdustReminder||null, deskVerification:card.deskVerification||null, plannedFocusMinutes: Number(card.plannedFocusMinutes) || 0 }; }
