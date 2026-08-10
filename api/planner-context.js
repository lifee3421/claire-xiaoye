// Vercel serverless endpoint. Snow-dust calls this when it needs a
// PlannerContext for a date but has no usable cached browser copy. The response
// uses the same core PlannerContext schema as the browser push, plus compact
// server-only templates/rules/systemCards, the shared planner ledger, and a
// pre-digested reviewAttention list.
//
// IMPORTANT: scheduleAssistantDraft on the USER document is the planner's
// source of truth. dailyReviewDrafts/{date} is the evening-review workspace
// and must never be used to compute PlannerContext.baseRevision.
import { getDb, readRawBody } from "../src/server/adminFirestore.js";
import { verifyHmacSignature, isTimestampFresh } from "../src/server/hmacAuth.js";
import { buildPlannerContext } from "../src/agent/buildPlannerContext.js";
import { buildPersistedPlannerFallback } from "../src/server/plannerAutonomyContext.js";
import { resolveEffectiveTrackers } from "../src/utils/trackerDefaults.js";
import { resolveTrackerEvidence } from "../src/utils/trackerFacts.js";
import { selectSharedLedgerItems } from "../src/utils/plannerInbox.js";
import { resolveDailyStudyTargets, resolveEffectiveTarget } from "../src/schedule/studyTargetResolver.js";

export const config = { api: { bodyParser: false } };

function isDateString(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function plannerDraftDate(draft) {
  return typeof draft?.targetDate === "string" && draft.targetDate
    ? draft.targetDate
    : (typeof draft?.savedOn === "string" ? draft.savedOn : "");
}

export function resolvePersistedPlannerDraft(profile = {}, date = "") {
  const live = profile?.scheduleAssistantDraft && typeof profile.scheduleAssistantDraft === "object"
    ? profile.scheduleAssistantDraft
    : {};
  if (plannerDraftDate(live) === date) return live;
  const archive = Array.isArray(profile?.scheduleAssistantDraftArchive) ? profile.scheduleAssistantDraftArchive : [];
  const archived = archive.find((item) => plannerDraftDate(item) === date);
  return archived && typeof archived === "object" ? archived : { targetDate: date, savedOn: date };
}

async function loadTrackerFactsForDate(db, uid, trackers, date) {
  const snapshot = await db.collection("users").doc(uid).collection("completionEvents")
    .where("occurredOn", "==", date)
    .where("state", "==", "active")
    .get();
  const eventsByTracker = new Map();
  for (const docSnap of snapshot.docs) {
    const event = { id: docSnap.id, ...docSnap.data() };
    if (!eventsByTracker.has(event.trackerId)) eventsByTracker.set(event.trackerId, []);
    eventsByTracker.get(event.trackerId).push(event);
  }
  return trackers.map((tracker) =>
    resolveTrackerEvidence(tracker, { events: eventsByTracker.get(tracker.id) || [], today: date }),
  );
}

function compactLedgerItem(item) {
  return {
    id: item.id,
    title: item.title,
    kind: item.kind,
    source: item.source,
    status: item.status,
    targetDate: item.targetDate || null,
    dueAt: item.dueAt || null,
    triggerType: item.triggerType || "none",
    boundBlockId: item.boundBlockId || null,
    reminderId: item.reminderId || null,
    followupText: item.followupText || null,
    completedAt: item.completedAt || null,
    estimatedMinutes: item.estimatedMinutes,
    priority: item.priority,
    deadline: item.deadline || null,
    note: item.note || "",
  };
}

function buildReviewAttention(context, draft) {
  const attentionStatuses = new Set(["due_today", "overdue", "behind"]);
  const stickers = Array.isArray(draft?.stickers) ? draft.stickers : [];
  return (Array.isArray(context?.trackers) ? context.trackers : [])
    .filter((tracker) => tracker.factsStatus === "ready")
    .filter((tracker) => attentionStatuses.has(tracker.scheduleStatus))
    .filter((tracker) => tracker.todayReviewStatus !== "confirmed_complete")
    .map((tracker) => {
      const sticker = stickers.find((item) => item?.origin === "tracker" && item.trackerId === tracker.id) || null;
      return {
        trackerId: tracker.id,
        title: tracker.title,
        scheduleStatus: tracker.scheduleStatus,
        nextDueDate: tracker.nextDueDate,
        progress: tracker.progress,
        sticker: sticker ? {
          id: sticker.id,
          title: sticker.title,
          emoji: sticker.emoji,
          status: sticker.status,
          placementMode: sticker.placementMode || "timeline",
          anchorMinute: Number.isFinite(Number(sticker.anchorMinute)) ? Number(sticker.anchorMinute) : null,
        } : null,
      };
    });
}

export async function handlePlannerContextRequest({ db, uid, date, now = new Date() } = {}) {
  if (!isDateString(date)) return { outcome: "invalid_date", date };

  const profileSnap = await db.collection("users").doc(uid).get();
  const profile = profileSnap.exists ? profileSnap.data() : {};
  const draft = resolvePersistedPlannerDraft(profile, date);
  const settings = profile.scheduleAssistantSettings && typeof profile.scheduleAssistantSettings === "object"
    ? profile.scheduleAssistantSettings
    : {};

  const trackers = resolveEffectiveTrackers(profile);
  const trackerFacts = await loadTrackerFactsForDate(db, uid, trackers, date);

  const draftResolved = resolveDailyStudyTargets({
    defaults: settings.studyTargetDefaults || profile.studyTargetDefaults,
    overrides: draft.studyTargetOverrides,
    categoryTree: profile.classificationTaxonomy,
  });
  const effectiveStudyTarget = resolveEffectiveTarget({ snapshot: draft.studyTargetSnapshot, draftResolved });

  const fallback = buildPersistedPlannerFallback({ draft, settings });
  const timezone = profile.timezone || draft.timezone || "Asia/Shanghai";

  const context = buildPlannerContext({
    date,
    timezone,
    now,
    draft,
    plan: fallback.plan,
    effectiveStudyTarget,
    studyTargetProgress: [],
    dailyFacts: null,
    trackerDefs: trackers,
    trackerFacts,
    trackerFactsStatus: "ready",
    reviewContext: {},
  });

  context.templates = fallback.templates;
  context.rules = fallback.rules;
  context.systemCards = fallback.systemCards;
  context.sharedLedger = selectSharedLedgerItems(profile.plannerInbox, date).map(compactLedgerItem);
  context.reviewAttention = buildReviewAttention(context, draft);
  context.contextSource = "server_persisted";
  return { outcome: "ok", context };
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "method not allowed" }); return; }
  const secret = process.env.CATKEEPER_PLANNER_BRIDGE_SECRET || process.env.CATKEEPER_FOCUS_SYNC_SECRET;
  const uid = process.env.CATKEEPER_USER_UID;
  if (!secret || !uid) {
    res.status(500).json({ error: "server is not configured (missing CATKEEPER_PLANNER_BRIDGE_SECRET/CATKEEPER_FOCUS_SYNC_SECRET or CATKEEPER_USER_UID)" });
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
  if (!isDateString(date)) { res.status(400).json({ error: "invalid request body", details: ["date must be YYYY-MM-DD"] }); return; }

  try {
    const result = await handlePlannerContextRequest({ db: getDb(), uid, date });
    if (result.outcome !== "ok") { res.status(400).json({ error: "invalid_date", date }); return; }
    res.status(200).json({ context: result.context });
  } catch (error) {
    res.status(500).json({ error: error?.message || "internal error" });
  }
}
