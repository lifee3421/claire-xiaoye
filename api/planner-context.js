// Vercel serverless endpoint. Snow-dust calls this when it needs PlannerContext.
// mode="quick" returns only revision/timeline/taskPool for high-frequency small
// edits; the default full mode adds templates/rules/shared ledger/review facts
// and projects TrackerFacts into planner stickers in the SAME request.
//
// IMPORTANT: scheduleAssistantDraft on the USER document is the planner's
// source of truth. dailyReviewDrafts/{date} is the evening-review workspace
// and must never be used to compute PlannerContext.baseRevision.
import { getDb, readRawBody } from "../src/server/adminFirestore.js";
import { verifyHmacSignature, isTimestampFresh } from "../src/server/hmacAuth.js";
import { buildPlannerContext } from "../src/agent/buildPlannerContext.js";
import { buildPersistedPlannerFallback } from "../src/server/plannerAutonomyContext.js";
import { syncTrackerStickersIntoDraft } from "../src/server/plannerTrackerStickerSync.js";
import { buildPlannerDateWritePatch } from "../src/schedule/plannerDatePersistence.js";
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
  const userRef = db.collection("users").doc(uid);
  const settlementPromise = userRef.collection("settlements")
    .where("reviewDate", "==", date)
    .limit(1)
    .get();
  const eventPromises = trackers.map((tracker) => userRef.collection("completionEvents")
    .where("trackerId", "==", tracker.id)
    .where("state", "==", "active")
    .get());
  const [settlementSnapshot, ...eventSnapshots] = await Promise.all([settlementPromise, ...eventPromises]);
  const todaySettlementExists = !settlementSnapshot.empty;
  return trackers.map((tracker, index) => {
    const events = eventSnapshots[index].docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    return resolveTrackerEvidence(tracker, { events, today: date, todaySettlementExists });
  });
}

async function syncTrackerStickersForContext({ db, uid, date, trackers, trackerFacts, now }) {
  const userRef = db.collection("users").doc(uid);
  return db.runTransaction(async (transaction) => {
    const latestSnap = await transaction.get(userRef);
    const latestProfile = latestSnap.exists ? latestSnap.data() : {};
    const latestDraft = resolvePersistedPlannerDraft(latestProfile, date);
    const sync = syncTrackerStickersIntoDraft({ draft: latestDraft, trackers, trackerFacts, localDate: date });
    if (!sync.changed) return { profile: latestProfile, draft: latestDraft, actions: [] };
    const finalDraft = { ...sync.draft, targetDate: date, savedOn: date, updatedAt: now.toISOString() };
    transaction.set(userRef, buildPlannerDateWritePatch(latestProfile, date, finalDraft), { merge: true });
    return { profile: latestProfile, draft: finalDraft, actions: sync.actions };
  });
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

export function buildQuickPlannerContext({ profile = {}, date = "", now = new Date() } = {}) {
  const draft = resolvePersistedPlannerDraft(profile, date);
  const settings = profile.scheduleAssistantSettings && typeof profile.scheduleAssistantSettings === "object"
    ? profile.scheduleAssistantSettings
    : {};
  const fallback = buildPersistedPlannerFallback({ draft, settings });
  const full = buildPlannerContext({
    date,
    timezone: profile.timezone || draft.timezone || "Asia/Shanghai",
    now,
    draft,
    plan: fallback.plan,
    effectiveStudyTarget: null,
    studyTargetProgress: [],
    dailyFacts: null,
    trackerDefs: [],
    trackerFacts: [],
    trackerFactsStatus: "not_requested",
    reviewContext: {},
  });
  return {
    schemaVersion: full.schemaVersion,
    date: full.date,
    timezone: full.timezone,
    baseRevision: full.baseRevision,
    timeline: full.timeline,
    taskPool: full.taskPool,
    contextSource: "server_quick",
  };
}

export async function handlePlannerContextRequest({ db, uid, date, mode = "full", now = new Date() } = {}) {
  if (!isDateString(date)) return { outcome: "invalid_date", date };

  const firstProfileSnap = await db.collection("users").doc(uid).get();
  const firstProfile = firstProfileSnap.exists ? firstProfileSnap.data() : {};
  if (mode === "quick") {
    return { outcome: "ok", context: buildQuickPlannerContext({ profile: firstProfile, date, now }) };
  }

  const trackers = resolveEffectiveTrackers(firstProfile);
  const trackerFacts = await loadTrackerFactsForDate(db, uid, trackers, date);
  const synced = await syncTrackerStickersForContext({ db, uid, date, trackers, trackerFacts, now });
  const profile = synced.profile;
  const draft = synced.draft;
  const settings = profile.scheduleAssistantSettings && typeof profile.scheduleAssistantSettings === "object"
    ? profile.scheduleAssistantSettings
    : {};

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
  context.trackerStickerSyncActions = synced.actions;
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
  const mode = body?.mode === "quick" ? "quick" : "full";
  if (!isDateString(date)) { res.status(400).json({ error: "invalid request body", details: ["date must be YYYY-MM-DD"] }); return; }

  try {
    const result = await handlePlannerContextRequest({ db: getDb(), uid, date, mode });
    if (result.outcome !== "ok") { res.status(400).json({ error: "invalid_date", date }); return; }
    res.status(200).json({ context: result.context });
  } catch (error) {
    res.status(500).json({ error: error?.message || "internal error" });
  }
}
