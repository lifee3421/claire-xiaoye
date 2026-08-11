// Server-side reminder-plan projection for Snow-dust's reliability watchdog.
// Unlike the browser sender, this endpoint remains available when the planner
// tab is closed. It rebuilds reminders only from the persisted Catkeeper draft;
// it never treats schedule state as evidence that an activity actually happened.
import { getDb, readRawBody } from "../src/server/adminFirestore.js";
import { verifyHmacSignature, isTimestampFresh } from "../src/server/hmacAuth.js";
import { buildPersistedPlannerFallback } from "../src/server/plannerAutonomyContext.js";
import { buildReminderPlan } from "../src/agent/buildReminderPlan.js";
import { prepareReminderPlanForSync } from "../src/agent/reminderPlanRevision.js";

export const config = { api: { bodyParser: false } };

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function draftDate(draft) {
  return typeof draft?.targetDate === "string" && draft.targetDate
    ? draft.targetDate
    : (typeof draft?.savedOn === "string" ? draft.savedOn : "");
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
  const cards = [
    ...(Array.isArray(fallback?.plan?.blocks) ? fallback.plan.blocks : []),
    ...(Array.isArray(fallback?.systemCards) ? fallback.systemCards : []),
  ];
  const base = buildReminderPlan({
    accountId: String(accountId || "claire").trim() || "claire",
    localDate: date,
    revision: 1,
    cards,
    timezone: profile?.timezone || draft?.timezone || "Asia/Shanghai",
    generatedAt: now.toISOString(),
    // Per-card reminder metadata remains authoritative when present. The
    // server fallback deliberately does not invent browser-only supervision
    // state merely to make a reminder sendable.
    deskVerification: {},
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
