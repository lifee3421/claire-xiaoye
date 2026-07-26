export const REMINDER_PLAN_SCHEMA_VERSION = 1;

const DEFAULT_ROLES = new Set(["wake_routine", "morning_study", "lunch", "afternoon_study", "evening_study", "daily_review", "wash"]);

/** Pure, semantic reminder-plan builder. Titles are display-only fallbacks. */
export function buildReminderPlan({ accountId = "claire", localDate, revision = 1, cards = [], timezone = "Asia/Shanghai", generatedAt = new Date().toISOString() } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate || "")) throw new Error("localDate must be YYYY-MM-DD");
  const reminders = cards.flatMap((card) => buildCardReminders(card, localDate));
  return { schemaVersion: REMINDER_PLAN_SCHEMA_VERSION, source: "catkeeper", accountId, localDate, timezone, revision: Math.max(1, Number(revision) || 1), generatedAt, cards: cards.map(publicCard), reminders };
}

function buildCardReminders(card, localDate) {
  const setting = card?.snowdustReminder;
  const role = semanticRole(card);
  const defaultEnabled = DEFAULT_ROLES.has(role);
  if (setting?.enabled === false || (!setting?.enabled && !defaultEnabled)) return [];
  const anchor = setting?.anchor === "end" ? "end" : "start";
  const base = anchor === "end" ? card?.end : card?.start;
  if (!card?.id || !/^\d{2}:\d{2}$/.test(base || "")) return [];
  const offsetMinutes = Number(setting?.offsetMinutes) || 0;
  const scheduledAt = isoAt(localDate, base, offsetMinutes);
  const purpose = setting?.purpose || defaultPurpose(role, anchor);
  const text = setting?.note || defaultText(card, purpose);
  const requiresResponse = setting?.requiresResponse !== false;
  const followUpPolicy = { enabled: setting?.followUp?.enabled !== false && requiresResponse, delayMinutes: Math.max(1, Number(setting?.followUp?.delayMinutes) || 10), maxCount: 1 };
  return [{ sourceCardId: String(card.id), kind: "schedule_reminder", purpose, scheduledAt, deliveryMode: "must_send", requiresResponse, followUpPolicy, offsetMinutes, anchor, text }];
}

function semanticRole(card = {}) {
  const value = String(card.systemRole || card.cardType || card.categoryId || card.statGroup || "").trim().toLowerCase();
  if (/morning.*routine|wake/.test(value)) return "wake_routine";
  if (/lunch/.test(value)) return "lunch";
  if (/wash|hygiene/.test(value)) return "wash";
  if (/review/.test(value)) return "daily_review";
  if (value === "study") return "evening_study";
  return value;
}
function defaultPurpose(role, anchor) { if (role === "lunch") return "eat"; if (role === "wash") return "confirm_completion"; return anchor === "end" ? "finish_task" : "start_task"; }
function defaultText(card, purpose) { return purpose === "eat" ? `该吃饭了：${card.title || "午饭"}` : purpose === "confirm_completion" ? `该洗漱了：${card.title || "洗漱"}` : `开始${card.title || "计划事项"}`; }
function isoAt(date, clock, offsetMinutes) { const ms = Date.parse(`${date}T${clock}:00+08:00`) + offsetMinutes * 60_000; const shifted = new Date(ms + 8 * 60 * 60_000).toISOString().slice(0, 19); return `${shifted}+08:00`; }
function publicCard(card = {}) { return { id: String(card.id || ""), title: String(card.title || ""), start: card.start || "", end: card.end || "", categoryId: card.categoryId || null, statGroup: card.statGroup || null, systemRole: card.systemRole || null, plannedFocusMinutes: Number(card.plannedFocusMinutes) || 0 }; }
