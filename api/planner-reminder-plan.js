// Server-side reminder-plan projection for Snow-dust's reliability watchdog.
// Unlike the browser sender, this endpoint remains available when the planner
// tab is closed. It rebuilds reminders only from the persisted Catkeeper draft;
// it never treats schedule state as evidence that an activity actually happened.
import { getDb, readRawBody } from "../src/server/adminFirestore.js";
import { verifyHmacSignature, isTimestampFresh } from "../src/server/hmacAuth.js";
import { buildPersistedPlannerFallback } from "../src/server/plannerAutonomyContext.js";
import { buildReminderPlan } from "../src/agent/buildReminderPlan.js";
import { prepareReminderPlanForSync } from "../src/agent/reminderPlanRevision.js";
import { normalizeDeskVerificationSettings } from "../src/agent/deskVerificationSettings.js";

export const config = { api: { bodyParser: false } };

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function draftDate(draft) {
  return typeof draft?.targetDate === "string" && draft.targetDate
    ? draft.targetDate
    : (typeof draft?.savedOn === "string" ? draft.savedOn : "");
}

function clock(value) {
  if (typeof value === "string" && /^\d{1,2}:\d{2}$/.test(value)) return value.padStart(5, "0");
  const raw = Number(value);
  if (!Number.isFinite(raw)) return "";
  const minutes = ((Math.round(raw) % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function minute(value, fallback = 0) {
  if (typeof value === "string" && /^\d{1,2}:\d{2}$/.test(value)) {
    const [hour, minutes] = value.split(":").map(Number);
    return hour * 60 + minutes;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function reminderCard(card = {}) {
  return {
    ...card,
    start: clock(card.start),
    end: clock(card.end),
    statGroup: card.statGroup || card.categoryStatGroup || null,
    plannedMinutes: Number(card.plannedMinutes || card.studyMinutes || card.duration || 0) || 0,
  };
}

// PR #38 split the old combined `startup` life card into lunch, optional
// midday-rest, a dedicated nap card, and a separate startup buffer. The older
// server conflict fallback still exposes the pre-split `startup`; for reminder
// recovery we reconstruct only this small life-card slice from the persisted
// draft so server-generated reminders match the actual planner UI semantics.
function reminderSystemCards(draft = {}, fallbackCards = []) {
  const retained = (Array.isArray(fallbackCards) ? fallbackCards : [])
    .filter((card) => !["lunch", "startup", "midday-rest", "nap"].includes(String(card?.id || "")));
  const lunchStart = minute(draft.lunchStartTime, 12 * 60 + 30);
  const lunchBlockMinutes = Math.max(0, Number(draft.lunchBlockMinutes || 0));
  const lunchMealMinutes = Math.min(40, lunchBlockMinutes || 40);
  const lunchEnd = lunchStart + lunchBlockMinutes;
  const napMinutes = Math.max(0, Math.min(30, lunchEnd - (lunchStart + lunchMealMinutes)));
  const napEnd = lunchEnd;
  const napStart = napEnd - napMinutes;
  const middayRestStart = lunchStart + lunchMealMinutes;
  const startupMinutes = Math.max(0, Number(draft.startupBufferMinutes || 0));
  const rows = [
    { id: "lunch", title: "午餐", start: lunchStart, end: lunchStart + lunchMealMinutes, categoryId: "life.lunch", statGroup: "life", systemRole: "lunch" },
  ];
  if (napStart > middayRestStart) {
    rows.push({ id: "midday-rest", title: "午间休息", start: middayRestStart, end: napStart, categoryId: "life.other", statGroup: "life", systemRole: "midday_rest" });
  }
  if (napMinutes > 0) {
    rows.push({ id: "nap", title: "午睡", start: napStart, end: napEnd, categoryId: "life.nap", statGroup: "life", systemRole: "nap" });
  }
  if (startupMinutes > 0) {
    rows.push({ id: "startup", title: "午间启动缓冲", start: lunchEnd, end: lunchEnd + startupMinutes, categoryId: "life.other", statGroup: "life", systemRole: "midday_startup" });
  }
  return [...retained, ...rows];
}

export function resolvePersistedDraft(profile = {}, date = "") {
  const live = profile?.scheduleAssistantDraft && typeof profile.scheduleAssistantDraft === "object"
    ? profile.scheduleAssistantDraft
    : {};
  if (draftDate(live) === date) return live;
  const archive = Array.isArray(profile?.scheduleAssistantDraftArchive) ? profile.scheduleAssistantDraftArchive : [];
  const archived = archive.find((item) => draftDate(item) === date);
  return archived && typeof archived === "object" ? archived : { targetDate: date, savedOn: date };
}

export function buildPersistedReminderPlan({ profile = {}, date = "", accountId = "claire", now = new Date() } = {}) {
  if (!validDate(date)) throw new Error("date must be YYYY-MM-DD");
  const draft = resolvePersistedDraft(profile, date);
  const settings = profile?.scheduleAssistantSettings && typeof profile.scheduleAssistantSettings === "object"
    ? profile.scheduleAssistantSettings
    : {};
  const fallback = buildPersistedPlannerFallback({ draft, settings });
  // The server fallback uses numeric minute offsets for conflict math, while
  // the canonical reminder generator intentionally consumes HH:mm timeline
  // cards (the same shape as AgentDaySnapshot). Normalize that boundary here
  // instead of teaching either subsystem two time representations.
  const cards = [
    ...(Array.isArray(fallback?.plan?.blocks) ? fallback.plan.blocks : []),
    ...reminderSystemCards(draft, fallback?.systemCards),
  ].map(reminderCard);
  const base = buildReminderPlan({
    accountId: String(accountId || "claire").trim() || "claire",
    localDate: date,
    revision: 1,
    cards,
    timezone: profile?.timezone || draft?.timezone || "Asia/Shanghai",
    generatedAt: now.toISOString(),
    // Browser sync uses the persisted Snow reminder settings too. Keeping the
    // same normalized defaults prevents the recovery endpoint from inventing
    // a content change/revision solely because the planner tab is closed.
    deskVerification: normalizeDeskVerificationSettings(profile?.snowdustDeskVerification),
  });
  return prepareReminderPlanForSync(draft?.reminderPlanSyncByDate || {}, base).plan;
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }
  const secret = process.env.CATKEEPER_PLANNER_BRIDGE_SECRET || process.env.CATKEEPER_FOCUS_SYNC_SECRET;
  const uid = process.env.CATKEEPER_USER_UID;
  if (!secret || !uid) {
    res.status(500).json({ error: "server is not configured (missing planner bridge secret or CATKEEPER_USER_UID)" });
    return;
  }
  const rawBody = await readRawBody(req);
  const timestamp = req.headers["x-catkeeper-timestamp"];
  const signature = req.headers["x-catkeeper-signature"];
  if (!isTimestampFresh(timestamp)) { res.status(401).json({ error: "timestamp missing or outside the allowed window" }); return; }
  if (!verifyHmacSignature({ secret, timestamp, rawBody, signature })) { res.status(401).json({ error: "invalid signature" }); return; }

  let body;
  try { body = JSON.parse(rawBody); }
  catch { res.status(400).json({ error: "body is not valid JSON" }); return; }
  const date = typeof body?.date === "string" ? body.date.trim() : "";
  const accountId = typeof body?.accountId === "string" ? body.accountId.trim() : "claire";
  if (!validDate(date)) { res.status(400).json({ error: "date must be YYYY-MM-DD" }); return; }

  try {
    const snap = await getDb().collection("users").doc(uid).get();
    const profile = snap.exists ? snap.data() : {};
    const reminderPlan = buildPersistedReminderPlan({ profile, date, accountId });
    res.status(200).json({ reminderPlan });
  } catch (error) {
    res.status(500).json({ error: error?.message || "internal error" });
  }
}
